import assert from 'node:assert/strict';
import { test } from 'node:test';
import { getRegistrationAnswers, saveRegistrationAnswers } from './data.js';
import { openTestDb } from '../../shared/test-db.js';
import { migratePostgres } from '../../shared/postgres.js';

test('registration answers persist one event/user/version record and reject stale versions', async () => {
  const db = await openTestDb();
  try {
    await db.run("INSERT INTO events (id, guild_id, name, status, created_at, updated_at) VALUES ('form-event', 'guild-a', 'Event', 'active', 1, 1)");
    await db.run("INSERT INTO participants (event_id, user_id, guild_id, display_name, experience, role_track, skills, team_pref, teammates, status, created_at, updated_at) VALUES ('form-event', 'user-a', 'guild-a', 'User', '', '', '[]', 'random_team', '[]', 'active', 1, 1)");
    const saved = await saveRegistrationAnswers(db, 'form-event', 'user-a', 2, { q: 'first' });
    assert.equal(saved.ok, true);
    const stale = await saveRegistrationAnswers(db, 'form-event', 'user-a', 1, { q: 'overwrite' });
    assert.equal(stale.ok, false);
    await migratePostgres(db);
    await migratePostgres(db);
    assert.deepEqual(await getRegistrationAnswers(db, 'form-event', 'user-a'), { formVersion: 2, answers: { q: 'first' } });
  } finally { await db.close(); }
});
