import { test } from 'node:test';
import assert from 'node:assert/strict';
import { gzipSync, gunzipSync } from 'node:zlib';
import { openTestDb } from '../../shared/test-db.js';
import { recoverFakeFixture } from '../../shared/fixture-recovery.js';
import { DEFAULT_FORM } from '../form/domain.js';
import { purgeExpiredPrivateAnswers, replayPrivateAnswerDeletions } from './retention.js';

function verifyFixtureArchive(bytes: Buffer, deletedAt: number, checkedAt: number, sentinel: string): void {
  const archive = JSON.parse(gunzipSync(bytes).toString('utf8')) as { createdAt: number; payload: string };
  if (checkedAt >= deletedAt + 30 * 86_400_000 && archive.payload.includes(sentinel)) {
    throw new Error('backup retains a deleted private answer beyond 30 days');
  }
}

test('fixture backup-retention check rejects a stale archive retaining a deletion sentinel', () => {
  const deletedAt = 1_700_000_000_000;
  const bytes = gzipSync(JSON.stringify({ createdAt: deletedAt - 10 * 86_400_000, payload: 'PRIVATE_BACKUP_SENTINEL' }));
  verifyFixtureArchive(bytes, deletedAt, deletedAt + 29 * 86_400_000, 'PRIVATE_BACKUP_SENTINEL');
  assert.throws(() => verifyFixtureArchive(bytes, deletedAt, deletedAt + 30 * 86_400_000, 'PRIVATE_BACKUP_SENTINEL'), /beyond 30 days/);
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
