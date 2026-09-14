import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs';
import { openDb } from './db.js';

const LEGACY_EVENT_TEMPLATE = {
  name: 'ChasHack',
  description: '48-hour hackathon',
  cleanupDelayHours: 48,
  form: { title: 'Signup', teamSize: 4 },
  schedule: [{ id: 'sch_1', time: 1000, title: 'Dinner', kind: 'food' }],
  announcements: [
    { id: 'ann1', title: 'Signups open!', message: 'Go {event}', trigger: 'on_activate' },
  ],
  assignments: [{ id: 'asg1', title: 'Demo prep', instructions: 'Prep a demo' }],
};

function tmpPath(tag: string): string {
  return `/tmp/chashack-mig-${tag}-${process.pid}.db`;
}

function cleanup(file: string): void {
  for (const f of [file, `${file}-wal`, `${file}-shm`]) {
    try { fs.unlinkSync(f); } catch { /* ignore */ }
  }
}

/**
 * Legacy event templates embedded a top-level `announcements` array (old
 * trigger-driven model). Announcements are action-driven now, so opening the
 * DB must strip that key while leaving every other field intact.
 */
test('migration: strips legacy announcements from event templates', () => {
  const file = tmpPath('strip');
  cleanup(file);
  try {
    // Seed on a fresh DB, then close and re-open so migrate() runs again.
    const seedDb = openDb(file);
    seedDb
      .prepare(
        "INSERT INTO event_templates (id, guild_id, name, kind, json, created_at) VALUES ('t1', 'g1', 'Legacy', 'event', ?, 1)",
      )
      .run(JSON.stringify(LEGACY_EVENT_TEMPLATE));
    seedDb.close();

    const reopened = openDb(file);
    const row = reopened
      .prepare("SELECT json FROM event_templates WHERE id = 't1'")
      .get() as { json: string };
    const parsed = JSON.parse(row.json) as Record<string, unknown>;

    assert.equal('announcements' in parsed, false, 'announcements key must be stripped');
    // Everything else survives the rewrite.
    assert.equal(parsed.name, 'ChasHack');
    assert.equal(parsed.cleanupDelayHours, 48);
    assert.deepEqual(parsed.schedule, LEGACY_EVENT_TEMPLATE.schedule);
    assert.deepEqual(parsed.assignments, LEGACY_EVENT_TEMPLATE.assignments);

    // Idempotent: a second open changes nothing.
    reopened.close();
    const third = openDb(file);
    const again = JSON.parse(
      (third.prepare("SELECT json FROM event_templates WHERE id = 't1'").get() as { json: string }).json,
    ) as Record<string, unknown>;
    assert.equal('announcements' in again, false);
    assert.equal(again.name, 'ChasHack');
    third.close();
  } finally {
    cleanup(file);
  }
});

test('migration: non-event templates are not touched', () => {
  const file = tmpPath('form');
  cleanup(file);
  try {
    const seedDb = openDb(file);
    seedDb
      .prepare(
        "INSERT INTO event_templates (id, guild_id, name, kind, json, created_at) VALUES ('t2', 'g1', 'Formy', 'form', ?, 2)",
      )
      .run(JSON.stringify({ title: 'Form', announcements: [] }));
    seedDb.close();

    const reopened = openDb(file);
    const row = reopened
      .prepare("SELECT json FROM event_templates WHERE id = 't2'")
      .get() as { json: string };
    assert.deepEqual(JSON.parse(row.json), { title: 'Form', announcements: [] });
    reopened.close();
  } finally {
    cleanup(file);
  }
});

test('migration: unparseable template json is left alone', () => {
  const file = tmpPath('bad');
  cleanup(file);
  try {
    const seedDb = openDb(file);
    seedDb
      .prepare(
        "INSERT INTO event_templates (id, guild_id, name, kind, json, created_at) VALUES ('bad', 'g1', 'Broken', 'event', 'not json{', 1)",
      )
      .run();
    seedDb.close();

    const reopened = openDb(file);
    const row = reopened
      .prepare("SELECT json FROM event_templates WHERE id = 'bad'")
      .get() as { json: string };
    assert.equal(row.json, 'not json{', 'unparseable json must not be rewritten');
    reopened.close();
  } finally {
    cleanup(file);
  }
});

/**
 * commitMatch's legacy insert loop left a `matched` team row with `event_id` NULL
 * and no members on every match; the legacy backfill then adopted those rows into
 * "Imported event" as phantom teams. The migration purges them — both states —
 * while leaving a genuine pre-events team (which owns its members) untouched.
 */
test('migration: purges orphan matched teams but keeps legacy teams with members', () => {
  const file = tmpPath('orphans');
  cleanup(file);
  try {
    const seedDb = openDb(file);
    const now = 1;
    seedDb
      .prepare("INSERT INTO events (id, guild_id, name, status, created_at, updated_at) VALUES ('ev_legacy_g1', 'g1', 'Imported event', 'ended', 1, 1)")
      .run();
    // the bug's leftovers: one not-yet-adopted, one already adopted, both member-less
    seedDb.prepare("INSERT INTO teams (id, guild_id, name, kind, created_at) VALUES ('orphan1', 'g1', 'Team Alpha', 'matched', 1)").run();
    seedDb.prepare("INSERT INTO teams (id, event_id, guild_id, name, kind, created_at) VALUES ('orphan2', 'ev_legacy_g1', 'g1', 'Team Alpha', 'matched', 1)").run();
    // a genuine legacy team: matched, in the legacy event, and it owns a member
    seedDb.prepare("INSERT INTO teams (id, event_id, guild_id, name, kind, created_at) VALUES ('real', 'ev_legacy_g1', 'g1', 'Team Real', 'matched', 1)").run();
    seedDb
      .prepare(
        `INSERT INTO participants (event_id, user_id, guild_id, display_name, experience, role_track, skills, team_pref, teammates, status, created_at, updated_at, team_id)
         VALUES ('ev_legacy_g1', 'u1', 'g1', 'Legacy Person', 'veteran', 'backend', '[]', 'random_team', '[]', 'active', ?, ?, 'real')`,
      )
      .run(now, now);
    seedDb.close();

    const reopened = openDb(file);
    const ids = (reopened.prepare('SELECT id FROM teams ORDER BY id').all() as unknown as { id: string }[]).map((r) => r.id);
    assert.deepEqual(ids, ['real'], 'only the member-owning legacy team survives');
    reopened.close();
  } finally {
    cleanup(file);
  }
});
