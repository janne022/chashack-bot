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
