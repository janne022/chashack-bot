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
import { openTestDb } from './test-db.js';
import { createKysely, type KyselyDb } from './kysely.js';

async function cols(db: Db, table: string): Promise<string[]> {
  const rows = 'dialect' in db && db.dialect === 'postgres'
    ? await db.all<{ name: string }>('SELECT column_name AS name FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = ?', table)
    : await db.all<{ name: string }>(`PRAGMA table_info(${table})`);
  return rows.map((c) => c.name);
}

const GUILD = 'g_async';
const EVENT = 'ev_async';

async function seedEvent(db: Db): Promise<void> {
  await db.run(
    "INSERT INTO events (id, guild_id, name, status, created_at, updated_at) VALUES (?, ?, 'Async Facade Fixture', 'active', 1, 1)",
    EVENT, GUILD,
  );
}

test('facade: one mutating run() call inserts exactly one row (double-execution regression)', async () => {
  const db = await openTestDb();
  try {
    // INSERT through the async facade (the path that used to run() then all()).
    await db.run(
      'INSERT INTO events (id, guild_id, name, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
      'ev-one', GUILD, 'Once Only', 'active', 1, 1,
    );
    const rows = (await db.get<{ n: number }>('SELECT COUNT(*) AS n FROM events WHERE id = ?', 'ev-one'))!;
    assert.equal(rows.n, 1, 'a single db.run INSERT must produce exactly one row');

    // Same guarantee for UPDATE and DELETE: changes counted once, not doubled.
    const upd = await db.run('UPDATE events SET name = ? WHERE id = ?', 'Renamed Once', 'ev-one');
    assert.equal(Number(upd.changes), 1, 'one UPDATE must touch exactly one row');
    const del = await db.run('DELETE FROM events WHERE id = ?', 'ev-one');
    assert.equal(Number(del.changes), 1, 'one DELETE must remove exactly one row');
    const left = (await db.get<{ n: number }>('SELECT COUNT(*) AS n FROM events'))!;
    assert.equal(left.n, 0, 'table must be empty after the single delete');
  } finally {
    db.close();
  }
});

test('facade: exactly one participant row per signup through run() inside a transaction', async () => {
  const db = await openTestDb();
  try {
    await seedEvent(db);
    await db.transaction(async () => {
      await db.run(
        `INSERT INTO participants (event_id, user_id, guild_id, display_name, experience, role_track, skills, team_pref, teammates, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        EVENT, 'u1', GUILD, 'Once', 'x', 'backend', '[]', 'random_team', '[]', 'active', 1, 1,
      );
    });
    const rows = await db.all<{ n: number }>('SELECT COUNT(*) AS n FROM participants WHERE event_id = ?', EVENT);
    assert.equal(rows.length, 1);
    assert.equal(rows[0]!.n, 1, 'transactional INSERT must not duplicate rows');
  } finally {
    db.close();
  }
});

test('facade: one INSERT per mutating call through the transaction queue', async () => {
  const db = await openTestDb();
  try {
    await seedEvent(db);
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
    const rows = await db.all<{ user_id: string }>('SELECT user_id FROM participants WHERE event_id = ? ORDER BY user_id', EVENT);
    assert.deepEqual(rows.map((r) => r.user_id), ['uA', 'uB'], 'two writes → exactly two rows, no duplicates');
  } finally {
    db.close();
  }
});

test('migration: fresh database via openDb has all expected tables and columns', async () => {
  const db = await openTestDb();
  try {
    const sql = 'dialect' in db && db.dialect === 'postgres'
      ? 'SELECT table_name AS name FROM information_schema.tables WHERE table_schema = current_schema()'
      : "SELECT name FROM sqlite_master WHERE type = 'table'";
    const tables = (await db.all<{ name: string }>(sql)).map((r) => r.name);
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
      const have = await cols(db, table);
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

test('facade: transaction failure rolls back and does not poison queued writes', async () => {
  const db = await openTestDb();
  try {
    await seedEvent(db);
    await assert.rejects(db.transaction(async () => {
      await db.run(
        `INSERT INTO participants (event_id, user_id, guild_id, display_name, experience, role_track, skills, team_pref, teammates, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        EVENT, 'rolled-back', GUILD, 'Rolled Back', 'x', 'backend', '[]', 'random_team', '[]', 'active', 1, 1,
      );
      throw new Error('abort transaction');
    }), /abort transaction/);
    await db.run(
      `INSERT INTO participants (event_id, user_id, guild_id, display_name, experience, role_track, skills, team_pref, teammates, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      EVENT, 'after-error', GUILD, 'After Error', 'x', 'backend', '[]', 'random_team', '[]', 'active', 2, 2,
    );
    const rows = await db.all<{ user_id: string }>('SELECT user_id FROM participants WHERE event_id = ?', EVENT);
    assert.deepEqual(rows.map((row) => row.user_id), ['after-error']);
  } finally {
    db.close();
  }
});

test('kysely: adapter reads and writes through the shared node:sqlite handle', async () => {
  const db = await openTestDb();
  try {
    await seedEvent(db);
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

test('kysely handles remain isolated and rollback shares the facade queue', async () => {
  const a = await openTestDb();
  const b = await openTestDb();
  const ka = createKysely(a);
  const kb = createKysely(b);
  try {
    await seedEvent(a);
    assert.equal((await ka.selectFrom('events').selectAll().execute()).length, 1);
    assert.equal((await kb.selectFrom('events').selectAll().execute()).length, 0);
    await assert.rejects(ka.transaction().execute(async (tx) => {
      await tx.deleteFrom('events').execute();
      throw new Error('abort');
    }), /abort/);
    assert.equal((await a.all('SELECT id FROM events')).length, 1);
  } finally { await ka.destroy(); await kb.destroy(); await a.close(); await b.close(); }
});
