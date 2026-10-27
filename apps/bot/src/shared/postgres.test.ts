import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { AsyncLocalStorage } from 'node:async_hooks';
import { postgresSql, migratePostgres, openPostgres } from './postgres.js';
import { openTestDb } from './test-db.js';

test('Postgres binding ignores quoted text, identifiers, comments and dollar strings', () => {
  assert.equal(postgresSql(`SELECT ?, '?', "?", $$?$$, $tag$?$tag$ /* ? /* ? */ */ -- ?\n, ?`), `SELECT $1, '?', "?", $$?$$, $tag$?$tag$ /* ? /* ? */ */ -- ?\n, $2`);
});

test('session advisory locks release after errors and do not consume the application pool', async () => {
  const db = await openTestDb(1);
  const schema = (await db.get<{ name: string }>('SELECT current_schema() AS name'))!.name;
  const peer = await openPostgres(process.env.DATABASE_URL!, schema, 1);
  try {
    await assert.rejects(db.tryAdvisoryLock('delivery:test', async () => {
      assert.equal((await db.get<{ value: number }>('SELECT 1 AS value'))?.value, 1);
      assert.equal(await peer.tryAdvisoryLock('delivery:test', async () => assert.fail('lock should be held')), false);
      throw new Error('delivery failed');
    }), /delivery failed/);
    assert.equal(await peer.tryAdvisoryLock('delivery:test', async () => undefined), true);
    await assert.rejects(db.transaction(() => db.tryAdvisoryLock('delivery:test', async () => undefined)), /inside a transaction/);
  } finally { await peer.close(); await db.close(); }
});

test('Postgres facade binds once, leases transactions, recovers rollback and closes', async (t) => {
  const db = await openTestDb();
  try {
    const version = await db.get<{ version: string }>('SELECT version() AS version');
    assert.match(version?.version ?? '', /^PostgreSQL /);
    t.diagnostic(`engine=${version?.version}; driver=pg ${createRequire(import.meta.url)('pg/package.json').version}`);
    await db.run('CREATE TEMP TABLE driver_probe (id INTEGER PRIMARY KEY, value TEXT)');
    assert.equal((await db.run('INSERT INTO driver_probe VALUES (?, ?)', 1, 'one')).changes, 1);
    assert.deepEqual({ ...await db.get('INSERT INTO driver_probe VALUES (?, ?) RETURNING id', 2, 'two') }, { id: 2 });
    await db.transaction(async () => {
      const identity = 'SELECT pg_backend_pid() AS pid';
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
    const columns = () => db.all("SELECT table_name, column_name, data_type, is_nullable, column_default FROM information_schema.columns WHERE table_schema = current_schema() ORDER BY table_name, ordinal_position");
    const before = await columns();
    const constraints = () => db.all("SELECT c.conname, pg_get_constraintdef(c.oid) AS definition FROM pg_constraint c JOIN pg_namespace n ON n.oid = c.connamespace WHERE n.nspname = current_schema() ORDER BY c.conname");
    const constraintsBefore = await constraints();
    await migratePostgres(db);
    assert.deepEqual(await columns(), before);
    assert.deepEqual(await constraints(), constraintsBefore);
    assert.ok(before.some((c) => c.table_name === 'audit_log' && c.column_name === 'guild_id'));
    assert.ok(before.some((c) => c.table_name === 'events' && c.column_name === 'starts_at' && c.data_type === 'bigint'));
    await assert.rejects(db.run("INSERT INTO participants (event_id, user_id, guild_id, display_name, experience, role_track, skills, team_pref, teammates, team_id, created_at, updated_at) VALUES ('fake', 'fake', 'fake', 'fake', 'fake', 'fake', '[]', 'random_team', '[]', 'missing', 1, 1)"), /foreign key/i);
  } finally { await db.close(); }
});

test('Postgres nested contexts expire with their savepoint and cannot join a later lease', async () => {
  const db = await openTestDb();
  try {
    let resume!: ReturnType<typeof AsyncLocalStorage.snapshot>;
    let callbacks = 0;
    const rejectExpired = async () => {
      await assert.rejects(resume(() => db.run("INSERT INTO meta VALUES ('stale-context', 'bad')")), /Transaction is closed/);
      await assert.rejects(resume(() => db.transaction(async () => { callbacks++; })), /Transaction is closed/);
    };
    await db.transaction(async () => {
      await db.transaction(async () => { resume = AsyncLocalStorage.snapshot(); });
      await rejectExpired();
      assert.ok(await db.get('SELECT 1'));
    });
    await rejectExpired();
    await db.transaction(async () => {
      await db.run("INSERT INTO meta VALUES ('later-lease', 'good')");
      await rejectExpired();
      assert.ok(await db.get("SELECT value FROM meta WHERE key = 'later-lease'"));
    });
    assert.equal(callbacks, 0);
    assert.equal(await db.get("SELECT value FROM meta WHERE key = 'stale-context'"), undefined);
  } finally { await db.close(); }
});

test('Postgres migration repairs indexed and nullable columns before indexes without losing rows', async () => {
  const db = await openTestDb();
  try {
    await db.run("INSERT INTO events (id,guild_id,name,created_at,updated_at) VALUES ('fake','fake','sentinel',1,1)");
    await db.run("INSERT INTO teams (id,guild_id,name,kind,created_at) VALUES ('fake-team','fake','sentinel','open',1)");
    await db.run("INSERT INTO team_requests (event_id,guild_id,team_id,requester_id,target_id,kind,created_at) VALUES ('fake','fake','fake-team','from','to','join',1)");
    const schema = () => db.all("SELECT type, name, definition FROM (SELECT 'constraint' AS type, c.conname AS name, pg_get_constraintdef(c.oid) AS definition FROM pg_constraint c JOIN pg_namespace n ON n.oid=c.connamespace WHERE n.nspname=current_schema() UNION ALL SELECT 'index', indexname, indexdef FROM pg_indexes WHERE schemaname=current_schema()) s ORDER BY type,name");
    const before = await schema();
    await db.run('ALTER TABLE events DROP COLUMN announcement_channel_id');
    await db.run('ALTER TABLE team_requests DROP COLUMN status CASCADE');
    await migratePostgres(db);
    assert.equal((await db.get<{ name: string }>("SELECT name,announcement_channel_id FROM events WHERE id='fake'"))?.name, 'sentinel');
    assert.equal((await db.get<{ status: string }>("SELECT status FROM team_requests WHERE requester_id='from'"))?.status, 'pending');
    assert.deepEqual(await schema(), before);
    const columns = () => db.all("SELECT table_name,column_name,data_type,is_nullable,column_default FROM information_schema.columns WHERE table_schema=current_schema() ORDER BY table_name,column_name");
    const repaired = await columns();
    await migratePostgres(db);
    assert.deepEqual(await columns(), repaired);
    assert.deepEqual(await schema(), before);
  } finally { await db.close(); }
});

test('populated legacy event survives additive submission upgrade and repeat migration', async () => {
  const db = await openTestDb();
  try {
    const schedule = JSON.stringify([{ id: 'kickoff', time: 1000, title: 'Kickoff', actions: [{ id: 'handout', type: 'distribute_assignments', mode: 'same' }] }]);
    const assignments = JSON.stringify([{ id: 'brief', title: 'Build', instructions: 'Make a game' }]);
    await db.run("INSERT INTO events(id,guild_id,name,status,schedule_json,assignments_json,discord_event_ids,panel_channel_id,created_at,updated_at) VALUES ('legacy','guild','Legacy','active',?,?,'[\"discord-event\"]','panel',1,1)", schedule, assignments);
    await db.run("INSERT INTO teams(id,event_id,guild_id,name,kind,text_channel_id,created_at) VALUES ('legacy-team','legacy','guild','Team','public','team-channel',1)");
    await db.run("INSERT INTO participants(event_id,user_id,guild_id,display_name,experience,role_track,skills,team_pref,teammates,team_id,status,created_at,updated_at) VALUES ('legacy','member','guild','Member','','','[]','','[]','legacy-team','active',1,1)");
    await db.run("INSERT INTO registration_answers VALUES ('legacy','member',1,'{\"answer\":\"preserved\"}',1)");
    await db.run("INSERT INTO meta VALUES ('signup_panel_event:guild:legacy','{\"channelId\":\"panel\",\"messageId\":\"message\"}')");
    const tables = ['events', 'teams', 'participants', 'registration_answers', 'meta'];
    const before = await Promise.all(tables.map(table => db.all(`SELECT * FROM ${table}`)));
    // Only empty new tables are dropped, inside openTestDb's disposable schema.
    await db.run('DROP TABLE submission_answers, submission_forms'); // db-guard:allow:db-name-guard t_25580df8 - fixture tables created by this test inside openTestDb's disposable schema.
    await migratePostgres(db);
    await migratePostgres(db);
    const after = await Promise.all(tables.map(table => db.all(`SELECT * FROM ${table}`)));
    assert.deepEqual(after, before);
    assert.deepEqual(await db.all('SELECT * FROM submission_forms'), []);
    assert.deepEqual(await db.all('SELECT * FROM submission_answers'), []);
  } finally { await db.close(); }
});
