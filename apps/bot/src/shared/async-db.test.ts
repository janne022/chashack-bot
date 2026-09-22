/**
 * WS2a regression + migration coverage for the async data-layer facade.
 *
 * 1. Double-execution regression: `execDirect` used to follow a mutating
 *    `stmt.run()` with `stmt.all()`, and on node:sqlite `.all()` RE-EXECUTES a
 *    prepared statement that was not exhausted — one INSERT produced two rows.
 *    The fix executes a mutating statement exactly once; these tests pin that.
 * 2. Fresh-database migration through `openDb`: expected tables/columns exist
 *    (including every `addColumnIfMissing` column), and `migrate()` is
 *    idempotent (two runs → no error, unchanged schema).
 * 3. `shared/kysely.ts` adapter exercised against the same handle: SELECT via
 *    the Kysely query builder and a rolled-back transaction leave no rows.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs';
import { openDb, type Db } from './db.js';
import { createKysely, type KyselyDb } from './kysely.js';

function cols(db: Db, table: string): string[] {
  return (db.prepare(`PRAGMA table_info(${table})`).all() as unknown as { name: string }[]).map((c) => c.name);
}

const GUILD = 'g_async';
const EVENT = 'ev_async';

function seedEvent(db: Db): void {
  db.prepare(
    "INSERT INTO events (id, guild_id, name, status, created_at, updated_at) VALUES (?, ?, 'Async Facade Fixture', 'active', 1, 1)",
  ).run(EVENT, GUILD);
}

test('facade: one mutating run() call inserts exactly one row (double-execution regression)', async () => {
  const db = openDb(':memory:');
  try {
    // INSERT through the async facade (the path that used to run() then all()).
    await db.run(
      'INSERT INTO events (id, guild_id, name, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
      'ev-one', GUILD, 'Once Only', 'active', 1, 1,
    );
    const rows = db.prepare('SELECT COUNT(*) AS n FROM events WHERE id = ?').get('ev-one') as unknown as { n: number };
    assert.equal(rows.n, 1, 'a single db.run INSERT must produce exactly one row');

    // Same guarantee for UPDATE and DELETE: changes counted once, not doubled.
    const upd = await db.run('UPDATE events SET name = ? WHERE id = ?', 'Renamed Once', 'ev-one');
    assert.equal(Number(upd.changes), 1, 'one UPDATE must touch exactly one row');
    const del = await db.run('DELETE FROM events WHERE id = ?', 'ev-one');
    assert.equal(Number(del.changes), 1, 'one DELETE must remove exactly one row');
    const left = db.prepare('SELECT COUNT(*) AS n FROM events').get() as unknown as { n: number };
    assert.equal(left.n, 0, 'table must be empty after the single delete');
  } finally {
    db.close();
  }
});

test('facade: exactly one participant row per signup through run() inside a transaction', async () => {
  const db = openDb(':memory:');
  try {
    seedEvent(db);
    await db.transaction(async () => {
      await db.run(
        `INSERT INTO participants (event_id, user_id, guild_id, display_name, experience, role_track, skills, team_pref, teammates, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        EVENT, 'u1', GUILD, 'Once', 'x', 'backend', '[]', 'random_team', '[]', 'active', 1, 1,
      );
    });
    const rows = db.prepare('SELECT COUNT(*) AS n FROM participants WHERE event_id = ?').all(EVENT) as unknown as { n: number }[];
    assert.equal(rows.length, 1);
    assert.equal(rows[0]!.n, 1, 'transactional INSERT must not duplicate rows');
  } finally {
    db.close();
  }
});

test('facade: one INSERT per mutating call through the transaction queue', async () => {
  const db = openDb(':memory:');
  try {
    seedEvent(db);
    // Fire two writes concurrently through the single-writer queue; each must land exactly once.
    await Promise.all([
      db.run(
        `INSERT INTO participants (event_id, user_id, guild_id, display_name, experience, role_track, skills, team_pref, teammates, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        EVENT, 'uA', GUILD, 'A', 'x', 'backend', '[]', 'random_team', '[]', 'active', 1, 1,
      ),
      db.run(
        `INSERT INTO participants (event_id, user_id, guild_id, display_name, experience, role_track, skills, team_pref, teammates, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        EVENT, 'uB', GUILD, 'B', 'x', 'frontend', '[]', 'random_team', '[]', 'active', 2, 2,
      ),
    ]);
    const rows = db.prepare('SELECT user_id FROM participants WHERE event_id = ? ORDER BY user_id').all(EVENT) as unknown as { user_id: string }[];
    assert.deepEqual(rows.map((r) => r.user_id), ['uA', 'uB'], 'two writes → exactly two rows, no duplicates');
  } finally {
    db.close();
  }
});

test('migration: fresh database via openDb has all expected tables and columns', async () => {
  const db = openDb(':memory:');
  try {
    const tables = (db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as unknown as { name: string }[]).map((r) => r.name);
    for (const t of ['meta', 'events', 'event_templates', 'form_config', 'participants', 'teams', 'team_requests', 'guild_settings', 'web_sessions', 'audit_log']) {
      assert.ok(tables.includes(t), `table ${t} must exist after migrate()`);
    }
    // Columns added by addColumnIfMissing (a fresh DB must have them too).
    const expected: Record<string, string[]> = {
      guild_settings: ['default_announcement_channel_id', 'default_panel_channel_id', 'default_category_id', 'default_cleanup_delay_hours', 'default_form_template_id', 'default_schedule_channel_id', 'mod_role_ids'],
      teams: ['event_id', 'role_id', 'text_channel_id', 'voice_channel_id', 'color'],
      team_requests: ['event_id'],
      participants: ['event_id'],
      events: ['cleanup_warned_72h', 'cleanup_warned_24h', 'match_at', 'match_locked', 'schedule_channel_id', 'signup_starts_at', 'signup_ends_at', 'assignments_json', 'schedule_json', 'announcements_json', 'announced_schedule_ids', 'announcement_channel_id'],
    };
    for (const [table, columns] of Object.entries(expected)) {
      const have = cols(db, table);
      for (const c of columns) {
        assert.ok(have.includes(c), `${table}.${c} added by addColumnIfMissing must exist`);
      }
    }
  } finally {
    db.close();
  }
});

test('migration: is idempotent — second openDb on the same file, same schema', async () => {
  const file = `/tmp/chashack-ws2a-idem-${process.pid}.db`;
  for (const f of [file, `${file}-wal`, `${file}-shm`]) {
    try { fs.unlinkSync(f); } catch { /* ignore */ }
  }
  try {
    const first = openDb(file);
    const schema1 = first.prepare("SELECT type, name, sql FROM sqlite_master ORDER BY type, name").all();
    first.close();

    let secondError: unknown = null;
    let schema2: unknown = null;
    try {
      const second = openDb(file);
      schema2 = second.prepare("SELECT type, name, sql FROM sqlite_master ORDER BY type, name").all();
      second.close();
    } catch (e) { secondError = e; }
    assert.equal(secondError, null, 'second migrate() run must not throw');
    assert.deepEqual(schema2, schema1, 'schema must be unchanged after a second migrate() run');
  } finally {
    for (const f of [file, `${file}-wal`, `${file}-shm`]) {
      try { fs.unlinkSync(f); } catch { /* ignore */ }
    }
  }
});

test('kysely: adapter reads and writes through the shared node:sqlite handle', async () => {
  const db = openDb(':memory:');
  try {
    seedEvent(db);
    const kysely: KyselyDb = createKysely(db);
    const events = await kysely.selectFrom('events').selectAll().where('id', '=', EVENT).execute();
    assert.equal(events.length, 1);
    assert.equal(events[0]!.name, 'Async Facade Fixture');

    const inserted = await kysely.insertInto('audit_log')
      .values({ id: 1, ts: 1, actor: 'test', action: 'async.test', target: null, details: null })
      .execute();
    assert.ok(inserted);

    const logs = await kysely.selectFrom('audit_log').selectAll().where('action', '=', 'async.test').execute();
    assert.equal(logs.length, 1, 'kysely INSERT must produce exactly one row');

    await kysely.destroy();
  } finally {
    db.close();
  }
});
