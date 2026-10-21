import assert from 'node:assert/strict';
import test from 'node:test';
import { openTestDb } from '../../shared/test-db.js';
import { activateEvent, createEvent, getEvent, getEventForm } from '../events/data.js';
import { getForm } from '../form/data.js';
import { createImportedSignups, editImportedSignup, listImportedSignups, purgeImportedSignups } from './data.js';
import { linkImportedSignup } from './link.js';

test('imported signup saves privately, replays by event-local email, edits and reloads incomplete row', async () => {
  const db = await openTestDb();
  try {
    const created = await createEvent(db, 'test', 'signup-import-guild', { name: 'Import test' });
    assert.equal(created.ok, true);
    if (!created.ok) return;
    const eventId = created.value.id;
    const payload = [{ sourceRow: 2, sourceTimestamp: '31 Oct, unknown timezone', values: { name: 'Synthetic Ada', email: 'ADA@example.test', allergies: 'nuts' }, answers: { required: '' } }];
    const first = await createImportedSignups(db, eventId, 'signup-import-guild', 1, payload);
    const exactReplay = await createImportedSignups(db, eventId, 'signup-import-guild', 1, [{ ...payload[0]!, sourceRow: 3 }]);
    const replay = await createImportedSignups(db, eventId, 'signup-import-guild', 1, [{ ...payload[0]!, sourceRow: 3, values: { ...payload[0]!.values, name: 'Edited upload' } }]);
    assert.deepEqual([first.saved, exactReplay.skipped, exactReplay.conflicts, replay.saved, replay.skipped, replay.conflicts], [1, 1, 0, 0, 0, 1]);
    const id = first.rows[0]!.id!;
    await editImportedSignup(db, eventId, id, { discordUsername: 'ada.verified?', answers: { required: 'answered' } });
    const records = await listImportedSignups(db, eventId);
    assert.equal(records.length, 1);
    assert.equal(records[0]!.values.name, 'Synthetic Ada');
    assert.equal(records[0]!.values.allergies, 'nuts');
    assert.equal(records[0]!.discordUsername, 'ada.verified?');
    assert.equal(records[0]!.discordUserId, null);
    assert.equal(records[0]!.answers.required, 'answered');
    assert.equal(await purgeImportedSignups(db, eventId), 1);
    assert.deepEqual(await listImportedSignups(db, eventId), []);
  } finally { await db.close(); }
});

test('explicit member linking creates only the selected identity and never trusts imported ids', async () => {
  const db = await openTestDb();
  try {
    const created = await createEvent(db, 'test', 'link-guild', { name: 'Link test' });
    assert.equal(created.ok, true);
    if (!created.ok) return;
    const eventId = created.value.id;
    await activateEvent(db, 'test', eventId);
    const imported = await createImportedSignups(db, eventId, 'link-guild', 1, [{ sourceRow: 2, values: { name: 'Synthetic Bea', email: 'bea@example.test', discordUserId: 'untrusted-text' }, answers: {} }]);
    const id = imported.rows[0]!.id!;
    const event = await getEvent(db, eventId);
    assert.ok(event);
    const form = getEventForm(db, event!, await getForm(db, 'link-guild'));
    const linked = await linkImportedSignup(db, eventId, 'link-guild', id, '12345678901234567', form);
    assert.deepEqual(linked, { linked: true, activated: true, missingFields: [] });
    assert.equal((await db.get<{ user_id: string }>('SELECT user_id FROM participants WHERE event_id=?', eventId))?.user_id, '12345678901234567');
    assert.equal((await listImportedSignups(db, eventId))[0]!.discordUserId, '12345678901234567');
    const conflict = await linkImportedSignup(db, eventId, 'link-guild', id, '22345678901234567', form);
    assert.equal(conflict.error, 'identity_conflict');
    assert.equal((await db.all('SELECT * FROM participants WHERE event_id=?', eventId)).length, 1);
  } finally { await db.close(); }
});

test('a failed member link does not persist accompanying edits', async () => {
  const db = await openTestDb();
  try {
    const created = await createEvent(db, 'test', 'link-atomic-guild', { name: 'Atomic link test' });
    assert.equal(created.ok, true);
    if (!created.ok) return;
    const eventId = created.value.id;
    await activateEvent(db, 'test', eventId);
    const imported = await createImportedSignups(db, eventId, 'link-atomic-guild', 1, [{ sourceRow: 2, values: { name: 'Before', email: 'before@example.test' }, answers: {} }]);
    const id = imported.rows[0]!.id!;
    const event = await getEvent(db, eventId);
    assert.ok(event);
    const form = getEventForm(db, event!, await getForm(db, 'link-atomic-guild'));
    const before = await listImportedSignups(db, eventId);
    const failedLink = await linkImportedSignup(db, eventId, 'foreign-guild', id, '12345678901234567', form);
    assert.equal(failedLink.error, 'event_not_found');
    assert.deepEqual(await listImportedSignups(db, eventId), before);
    assert.equal((await db.get('SELECT user_id FROM participants WHERE event_id=?', eventId)), undefined);
  } finally { await db.close(); }
});

test('concurrent identical email commits save once and verified identity conflicts do not link twice', async () => {
  const db = await openTestDb();
  try {
    const created = await createEvent(db, 'test', 'signup-race-guild', { name: 'Race test' });
    assert.equal(created.ok, true);
    if (!created.ok) return;
    const eventId = created.value.id;
    const row = { sourceRow: 2, values: { name: 'Synthetic', email: 'race@example.test' }, answers: {} };
    const results = await Promise.all([
      createImportedSignups(db, eventId, 'signup-race-guild', 1, [row]),
      createImportedSignups(db, eventId, 'signup-race-guild', 1, [row]),
    ]);
    assert.deepEqual(results.map((result) => [result.saved, result.skipped, result.conflicts]).sort(), [[0, 1, 0], [1, 0, 0]]);
    const records = await listImportedSignups(db, eventId);
    assert.equal(records.length, 1);
    await activateEvent(db, 'test', eventId);
    await db.run('UPDATE imported_signups SET discord_user_id=? WHERE id=?', '12345678901234567', records[0]!.id);
    const other = await createImportedSignups(db, eventId, 'signup-race-guild', 1, [{ sourceRow: 3, values: { name: 'Other', email: 'other@example.test' }, answers: {} }]);
    const event = await getEvent(db, eventId);
    assert.ok(event);
    const form = getEventForm(db, event!, await getForm(db, 'signup-race-guild'));
    const conflict = await linkImportedSignup(db, eventId, 'signup-race-guild', other.rows[0]!.id!, '12345678901234567', form);
    assert.equal(conflict.error, 'identity_conflict');
    assert.equal((await listImportedSignups(db, eventId))[1]!.discordUserId, null);
  } finally { await db.close(); }
});
