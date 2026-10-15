import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openTestDb } from '../../shared/test-db.js';
import { DEFAULT_FORM } from '../form/domain.js';
import { commitMatch, previewMatch } from './data.js';

const GUILD = 'g1';
const EVENT = 'ev1';

/**
 * Regression: commitMatch used to run two insert loops — a legacy one without
 * event_id (which left an orphan team row with event_id NULL on every match) plus
 * the event-scoped one. One match must create exactly the previewed teams, all
 * scoped to the event.
 */
async function seed(): ReturnType<typeof openTestDb> {
  const db = await openTestDb();
  await db.run(
    "INSERT INTO events (id, guild_id, name, status, created_at, updated_at) VALUES (?, ?, 'Match Test', 'active', 1, 1)",
    EVENT, GUILD,
  );
  const insert = (
    `INSERT INTO participants
       (event_id, user_id, guild_id, display_name, experience, role_track, skills, team_pref, teammates, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, 'some_experience', 'backend', '["backend_node"]', ?, '[]', 'active', ?, ?)`
  );
  // only random_team opt-ins are matchable
  await db.run(insert, EVENT, 'u1', GUILD, 'Opted One', 'random_team', 1, 1);
  await db.run(insert, EVENT, 'u2', GUILD, 'Opted Two', 'random_team', 2, 2);
  await db.run(insert, EVENT, 'u3', GUILD, 'Not Opted', 'create_team', 3, 3);
  return db;
}

test('commitMatch creates one team row per previewed team, all event-scoped', async () => {
  const db = await seed();
  const preview = await previewMatch(db, EVENT, DEFAULT_FORM);
  assert.equal(preview.ok, true, 'preview should succeed');
  if (!preview.ok) return;
  assert.equal(preview.value.teams.length, 1, 'two opt-ins make one team');

  const res = await commitMatch(db, 'test', EVENT, GUILD, DEFAULT_FORM);
  assert.equal(res.ok, true);

  const forEvent = await db.all<{ id: string }>('SELECT id FROM teams WHERE event_id = ?', EVENT);
  assert.equal(forEvent.length, preview.value.teams.length, 'one row per previewed team');

  const orphans = await db.all('SELECT id FROM teams WHERE event_id IS NULL');
  assert.equal(orphans.length, 0, 'no orphan teams without event_id');

  const members = await db.all<{ user_id: string }>("SELECT user_id FROM participants WHERE event_id = ? AND team_id = ? ORDER BY user_id", EVENT, forEvent[0]!.id);
  assert.deepEqual(members.map((m) => m.user_id), ['u1', 'u2'], 'opt-ins land in the team');
});

test('commitMatch replaces previous matched teams instead of stacking them', async () => {
  const db = await seed();
  await commitMatch(db, 'test', EVENT, GUILD, DEFAULT_FORM);
  await commitMatch(db, 'test', EVENT, GUILD, DEFAULT_FORM);
  const rows = await db.all('SELECT id FROM teams WHERE event_id = ?', EVENT);
  assert.equal(rows.length, 1, 'second commit must not stack teams');
});

test('preview and commit use the event-pinned mapped answers with legacy fallback', async () => {
  const db = await seed();
  const form = { ...DEFAULT_FORM, version: 4, customQuestions: [{ id: 'exp', kind: 'single_choice' as const, label: { en: 'Experience' }, help: { en: '' }, required: false, presentation: 'web' as const, visibility: 'self_and_organizer' as const, choices: [{ id: 'expert', label: { en: 'Expert' } }], mapping: { field: 'experience' as const, importance: 'high' as const, choiceValues: { expert: 'veteran' } } }] };
  await db.run('UPDATE events SET form_json = ? WHERE id = ?', JSON.stringify(form), EVENT);
  await db.run('INSERT INTO registration_answers (event_id,user_id,form_version,answers_json,updated_at) VALUES (?,?,?,?,?)', EVENT, 'u1', form.version, JSON.stringify({ exp: 'expert' }), 1);
  try {
    const preview = await previewMatch(db, EVENT, DEFAULT_FORM);
    assert.equal(preview.ok, true);
    if (!preview.ok) return;
    const committed = await commitMatch(db, 'test', EVENT, GUILD, DEFAULT_FORM);
    assert.equal(committed.ok, true);
    if (committed.ok) assert.deepEqual(committed.value, preview.value);
  } finally { await db.close(); }
});
