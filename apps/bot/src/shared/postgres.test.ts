import test from 'node:test';
import assert from 'node:assert/strict';
import { postgresSql, openPostgres, migratePostgres } from './postgres.js';
import { openTestDb } from './test-db.js';
import { openDb } from './db.js';

test('Postgres binding ignores quoted text, identifiers, comments and dollar strings', () => {
  assert.equal(postgresSql(`SELECT ?, '?', "?", $$?$$, $tag$?$tag$ /* ? /* ? */ */ -- ?\n, ?`), `SELECT $1, '?', "?", $$?$$, $tag$?$tag$ /* ? /* ? */ */ -- ?\n, $2`);
});

test('Postgres facade binds once, leases transactions, recovers rollback and closes', async () => {
  const db = await openTestDb();
  try {
    await db.run('CREATE TEMP TABLE driver_probe (id INTEGER PRIMARY KEY, value TEXT)');
    assert.equal((await db.run('INSERT INTO driver_probe VALUES (?, ?)', 1, 'one')).changes, 1);
    assert.deepEqual({ ...await db.get('INSERT INTO driver_probe VALUES (?, ?) RETURNING id', 2, 'two') }, { id: 2 });
    await db.transaction(async () => {
      const identity = process.env.DATABASE_URL === undefined ? 'SELECT 1 AS pid' : 'SELECT pg_backend_pid() AS pid';
      const before = await db.get<{ pid: number }>(identity);
      await assert.rejects(db.transaction(async () => {
        await db.run('INSERT INTO driver_probe VALUES (?, ?)', 3, 'rollback');
        await db.run('SELECT missing_column FROM driver_probe');
      }));
      assert.deepEqual(await db.get(identity), before);
      await db.run('INSERT INTO driver_probe VALUES (?, ?)', 4, 'four');
    });
    await assert.rejects(db.transaction(async () => {
      await db.run('INSERT INTO driver_probe VALUES (?, ?)', 5, 'rollback');
      throw new Error('rollback');
    }));
    assert.deepEqual((await db.all('SELECT id FROM driver_probe ORDER BY id')).map((row) => ({ ...row })), [{ id: 1 }, { id: 2 }, { id: 4 }]);
    await assert.rejects(db.run('SELECT missing_column FROM driver_probe'));
    assert.equal((await db.get<{ n: number }>('SELECT 1 AS n'))?.n, 1);
  } finally { await db.close(); }
  await assert.rejects(db.get('SELECT 1'), /closed|not open/i);
});

test('Postgres bootstrap preserves columns and constraints after two migrations', async () => {
  const db = await openTestDb();
  try {
    const postgres = 'dialect' in db && db.dialect === 'postgres';
    const columns = () => db.all(postgres ? "SELECT table_name, column_name, data_type, is_nullable, column_default FROM information_schema.columns WHERE table_schema = current_schema() ORDER BY table_name, ordinal_position" : "SELECT m.name AS table_name, p.name AS column_name, lower(p.type) AS data_type FROM sqlite_master m JOIN pragma_table_info(m.name) p WHERE m.type = 'table' ORDER BY m.name, p.cid");
    const before = await columns();
    if (postgres) await migratePostgres(db as Awaited<ReturnType<typeof openPostgres>>);
    else {
      const fresh = openDb(':memory:');
      assert.deepEqual(await fresh.all("SELECT m.name AS table_name, p.name AS column_name, lower(p.type) AS data_type FROM sqlite_master m JOIN pragma_table_info(m.name) p WHERE m.type = 'table' ORDER BY m.name, p.cid"), before);
      fresh.close();
    }
    assert.deepEqual(await columns(), before);
    assert.ok(before.some((c) => c.table_name === 'audit_log' && c.column_name === 'guild_id'));
    assert.ok(before.some((c) => c.table_name === 'events' && c.column_name === 'starts_at' && c.data_type === (postgres ? 'bigint' : 'integer')));
    await assert.rejects(db.run("INSERT INTO participants (event_id, user_id, guild_id, display_name, experience, role_track, skills, team_pref, teammates, team_id, created_at, updated_at) VALUES ('fake', 'fake', 'fake', 'fake', 'fake', 'fake', '[]', 'random_team', '[]', 'missing', 1, 1)"), /foreign key/i);
  } finally { await db.close(); }
});
