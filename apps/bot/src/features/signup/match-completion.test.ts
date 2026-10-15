import assert from 'node:assert/strict';
import { test } from 'node:test';
import { openTestDb } from '../../shared/test-db.js';
import { DEFAULT_FORM } from '../form/domain.js';
import { listMatchable } from './data.js';

test('matching excludes participants with incomplete required web answers', async () => {
  const db = await openTestDb();
  try {
    const form = { ...DEFAULT_FORM, version: 3, customQuestions: [{ id: 'required', kind: 'text', label: { en: 'Required' }, help: { en: '' }, required: true,
      presentation: 'web', visibility: 'self_and_organizer' }] };
    await db.run('INSERT INTO events (id,guild_id,name,description,status,form_json,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)',
      'match-event', 'guild-match', 'Event', '', 'active', JSON.stringify(form), 1, 1);
    for (const userId of ['complete-user', 'incomplete-user']) await db.run(
      "INSERT INTO participants (event_id,user_id,guild_id,display_name,experience,role_track,skills,team_pref,teammates,status,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,'active',1,1)",
      'match-event', userId, 'guild-match', userId, 'first_timer', 'frontend', '[]', 'random_team', '[]');
    await db.run('INSERT INTO registration_answers (event_id,user_id,form_version,answers_json,updated_at) VALUES (?,?,?,?,?)',
      'match-event', 'complete-user', form.version, JSON.stringify({ required: 'ready' }), 1);
    assert.deepEqual((await listMatchable(db, 'match-event')).map((p) => p.userId), ['complete-user']);
  } finally { await db.close(); }
});
