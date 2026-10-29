import { test } from 'node:test';
import assert from 'node:assert/strict';
import { gzipSync, gunzipSync } from 'node:zlib';
import { openTestDb } from '../../shared/test-db.js';
import { recoverFakeFixture } from '../../shared/fixture-recovery.js';
import { DEFAULT_FORM } from '../form/domain.js';
import { purgeEventPrivateAnswers, purgeExpiredPrivateAnswers, replayPrivateAnswerDeletions } from './retention.js';
import { deleteRegistrationAnswers } from './data.js';

function verifyFixtureArchive(bytes: Buffer, deletedAt: number, checkedAt: number, sentinel: string): void {
  const archive = JSON.parse(gunzipSync(bytes).toString('utf8')) as { createdAt: number; payload: string };
  if (checkedAt >= deletedAt + 30 * 86_400_000 && archive.payload.includes(sentinel)) {
    throw new Error('backup retains a deleted private answer beyond 30 days');
  }
}

test('fixture backup-retention check rejects a stale archive retaining a deletion sentinel', () => {
  const deletedAt = 1_700_000_000_000;
  const bytes = gzipSync(JSON.stringify({ createdAt: deletedAt - 10 * 86_400_000, payload: 'old-answer-marker' }));
  verifyFixtureArchive(bytes, deletedAt, deletedAt + 29 * 86_400_000, 'old-answer-marker');
  assert.throws(() => verifyFixtureArchive(bytes, deletedAt, deletedAt + 30 * 86_400_000, 'old-answer-marker'), /beyond 30 days/);
});

test('purges private answers at end plus seven days and replays without touching other events or fresh registrations', async () => {
  const db = await openTestDb();
  const restored = await openTestDb();
  const end = 1_700_000_000_000;
  try {
    const form = { ...DEFAULT_FORM, customQuestions: [
      { id: 'diet', kind: 'text', label: { en: 'Diet' }, help: { en: '' }, required: false, presentation: 'web', visibility: 'organizer_only' },
      { id: 'intro', kind: 'text', label: { en: 'Intro' }, help: { en: '' }, required: false, presentation: 'web', visibility: 'self_and_organizer' },
    ] };
    for (const [id, eventEnd] of [['ev', end], ['other', end + 86_400_000]]) {
      await db.run('INSERT INTO events (id,guild_id,name,status,ends_at,form_json,created_at,updated_at) VALUES (?,\'guild\',\'Test\',\'ended\',?,?,1,1)', id, eventEnd, JSON.stringify(form));
      await db.run('INSERT INTO registration_answers VALUES (?,?,?,?,?)', id, 'same-user', form.version, JSON.stringify({ diet: 'PRIVATE_SENTINEL', intro: 'keep' }), end + 7 * 86_400_000 - 1);
    }
    await db.run("INSERT INTO meta VALUES ('fake_fixture','true')");
    await recoverFakeFixture(db, restored);

    assert.deepEqual(await purgeExpiredPrivateAnswers(db, end + 7 * 86_400_000 - 1), []);
    assert.equal((await db.get<{ answers_json: string }>("SELECT answers_json FROM registration_answers WHERE event_id='ev'"))?.answers_json.includes('PRIVATE_SENTINEL'), true);
    assert.deepEqual(await purgeExpiredPrivateAnswers(db, end + 7 * 86_400_000), ['ev']);
    assert.deepEqual(JSON.parse((await db.get<{ answers_json: string }>("SELECT answers_json FROM registration_answers WHERE event_id='ev'"))!.answers_json), { intro: 'keep' });
    assert.equal((await db.get<{ answers_json: string }>("SELECT answers_json FROM registration_answers WHERE event_id='other'"))?.answers_json.includes('PRIVATE_SENTINEL'), true);
    const records = await db.all<{ event_id: string; guild_id: string; user_id: string; deleted_at: number }>('SELECT * FROM private_answer_deletions');
    assert.equal(records.length, 1);
    assert.equal(JSON.stringify(records).includes('PRIVATE_SENTINEL'), false);

    await replayPrivateAnswerDeletions(restored, records.map((r) => ({ eventId: r.event_id, guildId: r.guild_id, userId: r.user_id, deletedAt: Number(r.deleted_at) })));
    assert.deepEqual(JSON.parse((await restored.get<{ answers_json: string }>("SELECT answers_json FROM registration_answers WHERE event_id='ev'"))!.answers_json), { intro: 'keep' });
    assert.equal((await restored.get<{ answers_json: string }>("SELECT answers_json FROM registration_answers WHERE event_id='other'"))?.answers_json.includes('PRIVATE_SENTINEL'), true);

    await restored.run('UPDATE registration_answers SET answers_json=?,updated_at=? WHERE event_id=? AND user_id=?', JSON.stringify({ diet: 'FRESH_SENTINEL' }), end + 8 * 86_400_000, 'ev', 'same-user');
    await replayPrivateAnswerDeletions(restored, records.map((r) => ({ eventId: r.event_id, guildId: r.guild_id, userId: r.user_id, deletedAt: Number(r.deleted_at) })));
    assert.equal((await restored.get<{ answers_json: string }>("SELECT answers_json FROM registration_answers WHERE event_id='ev'"))?.answers_json.includes('FRESH_SENTINEL'), true);
    assert.deepEqual(await purgeExpiredPrivateAnswers(db, end + 9 * 86_400_000), ['other']);
    assert.deepEqual(await purgeExpiredPrivateAnswers(db, end + 10 * 86_400_000), []);
  } finally { await restored.close(); await db.close(); }
});

test('expiry erases private answers from each archived definition while preserving newer reused-ID answers and imported values', async () => {
  const db = await openTestDb();
  const restored = await openTestDb();
  const end = 1_710_000_000_000;
  const cutoff = end + 7 * 86_400_000;
  try {
    const oldForm = { ...DEFAULT_FORM, version: 1, customQuestions: [
      { id: 'diet', kind: 'text' as const, label: { en: 'Diet' }, help: { en: '' }, required: false, presentation: 'web' as const, visibility: 'organizer_only' as const },
    ] };
    const newForm = { ...oldForm, version: 2, customQuestions: [
      { ...oldForm.customQuestions[0]!, label: { en: 'Public intro' }, visibility: 'self_and_organizer' as const },
    ] };
    await db.run('INSERT INTO events (id,guild_id,name,status,ends_at,form_json,created_at,updated_at) VALUES (?,?,?,\'ended\',?,?,1,1)', 'versioned', 'guild', 'Versioned', end, JSON.stringify(newForm));
    await db.run('INSERT INTO registration_form_versions VALUES (?,?,?,1),(?,?,?,2)', 'versioned', 1, JSON.stringify(oldForm), 'versioned', 2, JSON.stringify(newForm));
    await db.run('INSERT INTO registration_answer_history VALUES (?,?,?,?,?)', 'versioned', 'same-user', 1, JSON.stringify({ diet: 'OLD_PRIVATE', intro: 'retain' }), cutoff - 1);
    await db.run('INSERT INTO registration_answers VALUES (?,?,?,?,?)', 'versioned', 'same-user', 2, JSON.stringify({ diet: 'FRESH_PUBLIC' }), cutoff + 1);
    await db.run('INSERT INTO imported_signups (id,event_id,guild_id,source_row,form_version,values_json,answers_json,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)',
      'versioned-import', 'versioned', 'guild', 2, 1, JSON.stringify({ allergies: 'OLD_ALLERGIES', name: 'Keep name' }), JSON.stringify({ diet: 'OLD_IMPORTED_PRIVATE' }), 1, cutoff - 1); // g0:allow:secrets PR #73 - synthetic retention filler, not a credential.
    await db.run('INSERT INTO imported_signup_answer_history VALUES (?,?,?,?,?,?)', 'versioned', 'versioned-import', 1,
      JSON.stringify({ diet: 'OLD_IMPORTED_ARCHIVE', intro: 'retain' }), JSON.stringify({ allergies: 'OLD_ARCHIVED_ALLERGIES', name: 'Keep archived name' }), cutoff - 2); // g0:allow:secrets PR #73 - synthetic retention filler, not a credential.
    await db.run("INSERT INTO meta VALUES ('fake_fixture','true')");
    await recoverFakeFixture(db, restored);

    assert.deepEqual(await purgeExpiredPrivateAnswers(db, cutoff - 1), []);
    assert.deepEqual(await purgeExpiredPrivateAnswers(db, cutoff), ['versioned']);
    assert.deepEqual(JSON.parse((await db.get<{ answers_json: string }>("SELECT answers_json FROM registration_answer_history WHERE event_id='versioned' AND user_id='same-user'"))!.answers_json), { intro: 'retain' });
    assert.deepEqual(JSON.parse((await db.get<{ answers_json: string }>("SELECT answers_json FROM registration_answers WHERE event_id='versioned' AND user_id='same-user'"))!.answers_json), { diet: 'FRESH_PUBLIC' });
    const imported = await db.get<{ answers_json: string; values_json: string }>("SELECT answers_json,values_json FROM imported_signups WHERE id='versioned-import'");
    assert.deepEqual(JSON.parse(imported!.answers_json), {});
    assert.deepEqual(JSON.parse(imported!.values_json), { name: 'Keep name' });
    const importedHistory = await db.get<{ answers_json: string; values_json: string }>("SELECT answers_json,values_json FROM imported_signup_answer_history WHERE import_id='versioned-import'");
    assert.deepEqual(JSON.parse(importedHistory!.answers_json), { intro: 'retain' });
    assert.deepEqual(JSON.parse(importedHistory!.values_json), { name: 'Keep archived name' });
    const records = await db.all<{ event_id: string; guild_id: string; user_id: string; deleted_at: number }>('SELECT * FROM private_answer_deletions');
    assert.ok(records.some((record) => record.user_id === 'same-user'));
    assert.ok(records.some((record) => record.user_id === 'import:versioned-import'));

    let replayAmbiguous = false;
    try { await replayPrivateAnswerDeletions(restored, records.map((record) => ({ guildId: record.guild_id, eventId: record.event_id, userId: record.user_id, deletedAt: Number(record.deleted_at) }))); }
    catch { replayAmbiguous = true; }
    assert.equal(replayAmbiguous, false);
    assert.deepEqual(JSON.parse((await restored.get<{ answers_json: string }>("SELECT answers_json FROM registration_answer_history WHERE event_id='versioned' AND user_id='same-user'"))!.answers_json), { intro: 'retain' });
    assert.deepEqual(JSON.parse((await restored.get<{ values_json: string }>("SELECT values_json FROM imported_signup_answer_history WHERE import_id='versioned-import'"))!.values_json), { name: 'Keep archived name' });

    await restored.run('UPDATE registration_answers SET answers_json=?,updated_at=? WHERE event_id=? AND user_id=?', JSON.stringify({ diet: 'NEW_AFTER_DELETE' }), cutoff + 2, 'versioned', 'same-user');
    await replayPrivateAnswerDeletions(restored, records.map((record) => ({ guildId: record.guild_id, eventId: record.event_id, userId: record.user_id, deletedAt: Number(record.deleted_at) })));
    assert.equal((await restored.get<{ answers_json: string }>("SELECT answers_json FROM registration_answers WHERE event_id='versioned' AND user_id='same-user'"))?.answers_json.includes('NEW_AFTER_DELETE'), true);
  } finally { await restored.close(); await db.close(); }
});

test('expired ambiguous payloads are erased without stalling cleanup or deleting import identity', async () => {
  const db = await openTestDb();
  const end = 1_720_000_000_000;
  const cutoff = end + 7 * 86_400_000;
  try {
    const currentForm = { ...DEFAULT_FORM, version: 2, customQuestions: [] };
    await db.run('INSERT INTO events (id,guild_id,name,status,ends_at,form_json,created_at,updated_at) VALUES (?,?,?,\'ended\',?,?,1,1)', 'legacy-ambiguous', 'guild', 'Legacy', end, JSON.stringify(currentForm));
    await db.run('INSERT INTO registration_answer_history VALUES (?,?,?,?,?)', 'legacy-ambiguous', 'legacy-user', 1, JSON.stringify({ old: 'UNCLASSIFIED_ANSWER' }), cutoff - 1);
    await db.run('INSERT INTO imported_signups (id,event_id,guild_id,source_row,form_version,values_json,answers_json,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)',
      'legacy-import', 'legacy-ambiguous', 'guild', 2, 1, JSON.stringify({ name: 'Ada', email: 'ada@example.test', allergies: 'KNOWN_PRIVATE', 'source:Food notes': 'UNKNOWN_PRIVATE' }), JSON.stringify({ old: 'UNCLASSIFIED_ANSWER' }), 1, cutoff - 1);
    await db.run('INSERT INTO imported_signup_answer_history VALUES (?,?,?,?,?,?)', 'legacy-ambiguous', 'legacy-import', 1,
      JSON.stringify({ old: 'UNCLASSIFIED_ARCHIVE' }), JSON.stringify({ allergies: 'KNOWN_ARCHIVED_PRIVATE', 'source:Food notes': 'UNKNOWN_ARCHIVED_PRIVATE' }), cutoff - 2); // g0:allow:secrets PR #73 - synthetic retention filler, not a credential.

    const knownForm = { ...DEFAULT_FORM, customQuestions: [{ id: 'private', kind: 'text' as const, label: { en: 'Private' }, help: { en: '' }, required: false, presentation: 'web' as const, visibility: 'organizer_only' as const }] };
    await db.run('INSERT INTO events (id,guild_id,name,status,ends_at,form_json,created_at,updated_at) VALUES (?,?,?,\'ended\',?,?,1,1)', 'known-event', 'guild', 'Known', end, JSON.stringify(knownForm));
    await db.run('INSERT INTO registration_form_versions VALUES (?,?,?,1)', 'known-event', knownForm.version, JSON.stringify(knownForm));
    await db.run('INSERT INTO registration_answer_history VALUES (?,?,?,?,?)', 'known-event', 'known-user', knownForm.version, JSON.stringify({ private: 'KNOWN_PRIVATE_ANSWER' }), cutoff - 1); // g0:allow:secrets PR #73 - synthetic retention filler, not a credential.

    assert.deepEqual(await purgeExpiredPrivateAnswers(db, cutoff), ['legacy-ambiguous', 'known-event']);
    assert.deepEqual(JSON.parse((await db.get<{ answers_json: string }>("SELECT answers_json FROM registration_answer_history WHERE event_id='known-event'"))!.answers_json), {});
    assert.deepEqual(JSON.parse((await db.get<{ answers_json: string }>("SELECT answers_json FROM registration_answer_history WHERE event_id='legacy-ambiguous'"))!.answers_json), {});
    const liveImport = await db.get<{ answers_json: string; values_json: string }>("SELECT answers_json,values_json FROM imported_signups WHERE id='legacy-import'");
    assert.deepEqual(JSON.parse(liveImport!.answers_json), {});
    assert.deepEqual(JSON.parse(liveImport!.values_json), { name: 'Ada', email: 'ada@example.test' });
    const archivedValues = JSON.parse((await db.get<{ values_json: string }>("SELECT values_json FROM imported_signup_answer_history WHERE import_id='legacy-import'"))!.values_json);
    assert.deepEqual(archivedValues, {});
    assert.ok(await db.get("SELECT id FROM imported_signups WHERE id='legacy-import'"));
  } finally { await db.close(); }
});

test('withdrawal deletion replays after restore and preserves later registrations', async () => {
  const db = await openTestDb();
  const restored = await openTestDb();
  try {
    const form = { ...DEFAULT_FORM, customQuestions: [] };
    await db.run('INSERT INTO events (id,guild_id,name,status,form_json,created_at,updated_at) VALUES (?,?,?,?,?,?,?)', 'withdraw-event', 'guild', 'Withdraw', 'active', JSON.stringify(form), 1, 1);
    await db.run('INSERT INTO registration_answers VALUES (?,?,?,?,?)', 'withdraw-event', 'withdraw-user', 1, JSON.stringify({ old: 'WITHDRAWN_ANSWER' }), 100);
    await db.run('INSERT INTO registration_answer_history VALUES (?,?,?,?,?)', 'withdraw-event', 'withdraw-user', 0, JSON.stringify({ old: 'WITHDRAWN_ARCHIVE' }), 90);
    await db.run('INSERT INTO imported_signups (id,event_id,guild_id,source_row,form_version,values_json,answers_json,discord_user_id,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)',
      'withdraw-import', 'withdraw-event', 'guild', 2, 1, JSON.stringify({ name: 'Ada', email: 'ada@example.test', 'source:private': 'WITHDRAWN_SOURCE' }), JSON.stringify({ q: 'WITHDRAWN_IMPORT_ANSWER' }), 'withdraw-user', 1, 100); // g0:allow:secrets PR #73 - synthetic withdrawal fixture, not a credential.
    await db.run('INSERT INTO imported_signup_answer_history VALUES (?,?,?,?,?,?)', 'withdraw-event', 'withdraw-import', 0, JSON.stringify({ q: 'WITHDRAWN_IMPORT_ARCHIVE' }), JSON.stringify({ 'source:private': 'WITHDRAWN_ARCHIVED_SOURCE' }), 90); // g0:allow:secrets PR #73 - synthetic withdrawal fixture, not a credential.
    await db.run("INSERT INTO meta VALUES ('fake_fixture','true')");
    await recoverFakeFixture(db, restored);
    await deleteRegistrationAnswers(db, 'withdraw-event', 'withdraw-user');
    assert.deepEqual(JSON.parse((await db.get<{ answers_json: string; values_json: string }>("SELECT answers_json,values_json FROM imported_signups WHERE id='withdraw-import'"))!.answers_json), {});
    assert.deepEqual(JSON.parse((await db.get<{ answers_json: string; values_json: string }>("SELECT answers_json,values_json FROM imported_signups WHERE id='withdraw-import'"))!.values_json), { name: 'Ada', email: 'ada@example.test' });
    assert.deepEqual(JSON.parse((await db.get<{ values_json: string }>("SELECT values_json FROM imported_signup_answer_history WHERE import_id='withdraw-import'"))!.values_json), {});
    const records = await db.all<{ event_id: string; guild_id: string; user_id: string; deleted_at: number }>("SELECT * FROM private_answer_deletions WHERE user_id LIKE 'withdraw:%'");
    assert.equal(records.length, 1);
    await replayPrivateAnswerDeletions(restored, records.map((r) => ({ eventId: r.event_id, guildId: r.guild_id, userId: r.user_id, deletedAt: Number(r.deleted_at) })));
    assert.equal(await restored.get("SELECT 1 FROM registration_answers WHERE event_id='withdraw-event' AND user_id='withdraw-user'"), undefined);
    assert.equal(await restored.get("SELECT 1 FROM registration_answer_history WHERE event_id='withdraw-event' AND user_id='withdraw-user'"), undefined);
    const deletedAt = Number(records[0]!.deleted_at);
    await restored.run('UPDATE imported_signups SET answers_json=?,values_json=?,updated_at=? WHERE id=?', JSON.stringify({ q: 'REJOINED_IMPORT_ANSWER' }), JSON.stringify({ name: 'Ada', email: 'ada@example.test', 'source:new': 'NEW_SOURCE' }), deletedAt + 1, 'withdraw-import'); // g0:allow:secrets PR #73 - synthetic rejoin fixture, not a credential.
    await restored.run('INSERT INTO registration_answers VALUES (?,?,?,?,?)', 'withdraw-event', 'withdraw-user', 2, JSON.stringify({ new: 'REJOINED_ANSWER' }), deletedAt + 1);
    await restored.run('INSERT INTO registration_answer_history VALUES (?,?,?,?,?)', 'withdraw-event', 'withdraw-user', 1, JSON.stringify({ old: 'OLD_ARCHIVE' }), deletedAt);
    await replayPrivateAnswerDeletions(restored, records.map((r) => ({ eventId: r.event_id, guildId: r.guild_id, userId: r.user_id, deletedAt: Number(r.deleted_at) })));
    assert.equal((await restored.get<{ answers_json: string }>("SELECT answers_json FROM registration_answers WHERE event_id='withdraw-event' AND user_id='withdraw-user'"))?.answers_json, JSON.stringify({ new: 'REJOINED_ANSWER' }));
    assert.equal((await restored.get<{ answers_json: string }>("SELECT answers_json FROM imported_signups WHERE id='withdraw-import'"))?.answers_json, JSON.stringify({ q: 'REJOINED_IMPORT_ANSWER' })); // g0:allow:secrets PR #73 - synthetic rejoin assertion, not a credential.
    assert.equal(await restored.get("SELECT 1 FROM registration_answer_history WHERE event_id='withdraw-event' AND user_id='withdraw-user'"), undefined);
  } finally { await restored.close(); await db.close(); }
});
