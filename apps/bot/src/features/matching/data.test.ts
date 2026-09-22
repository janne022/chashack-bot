import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../../shared/db.js';
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
async function seed(): ReturnType<typeof openDb> {
  const db = openDb(':memory:');
  db.prepare(
    "INSERT INTO events (id, guild_id, name, status, created_at, updated_at) VALUES (?, ?, 'Match Test', 'active', 1, 1)",
  ).run(EVENT, GUILD);
  const insert = db.prepare(
    `INSERT INTO participants
       (event_id, user_id, guild_id, display_name, experience, role_track, skills, team_pref, teammates, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, 'some_experience', 'backend', '["backend_node"]', ?, '[]', 'active', ?, ?)`,
  );
  // only random_team opt-ins are matchable
  insert.run(EVENT, 'u1', GUILD, 'Opted One', 'random_team', 1, 1);
  insert.run(EVENT, 'u2', GUILD, 'Opted Two', 'random_team', 2, 2);
  insert.run(EVENT, 'u3', GUILD, 'Not Opted', 'create_team', 3, 3);
  return db;
}

test('commitMatch creates one team row per previewed team, all event-scoped', () => {
  const db = seed();
  const preview = await previewMatch(db, EVENT, DEFAULT_FORM);
  assert.equal(preview.ok, true, 'preview should succeed');
  if (!preview.ok) return;
  assert.equal(preview.value.teams.length, 1, 'two opt-ins make one team');

  const res = await commitMatch(db, 'test', EVENT, GUILD, DEFAULT_FORM);
  assert.equal(res.ok, true);

  const forEvent = db.prepare('SELECT id FROM teams WHERE event_id = ?').all(EVENT) as unknown as { id: string }[];
  assert.equal(forEvent.length, preview.value.teams.length, 'one row per previewed team');

  const orphans = db.prepare('SELECT id FROM teams WHERE event_id IS NULL').all() as unknown as { id: string }[];
  assert.equal(orphans.length, 0, 'no orphan teams without event_id');

  const members = db
    .prepare("SELECT user_id FROM participants WHERE event_id = ? AND team_id = ? ORDER BY user_id")
    .all(EVENT, forEvent[0]!.id) as unknown as { user_id: string }[];
  assert.deepEqual(members.map((m) => m.user_id), ['u1', 'u2'], 'opt-ins land in the team');
});

test('commitMatch replaces previous matched teams instead of stacking them', () => {
  const db = seed();
  await commitMatch(db, 'test', EVENT, GUILD, DEFAULT_FORM);
  await commitMatch(db, 'test', EVENT, GUILD, DEFAULT_FORM);
  const rows = db.prepare('SELECT id FROM teams WHERE event_id = ?').all(EVENT) as unknown as { id: string }[];
  assert.equal(rows.length, 1, 'second commit must not stack teams');
});
