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
