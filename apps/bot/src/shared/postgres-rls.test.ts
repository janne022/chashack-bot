import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { openTestDb } from './test-db.js';
import { migratePostgres, openPostgres, withGuildContext } from './postgres.js';
import { openDatabase } from './db.js';
import { createKysely } from './kysely.js';

test('RLS hides tenant rows without context and rejects cross-tenant writes as app role', async (t) => {
  const db = await openTestDb(1);
  const role = `rls_${randomUUID().replaceAll('-', '')}`;
  const password = randomUUID();
  let appDb: Awaited<ReturnType<typeof openPostgres>> | undefined;
  try {
    await migratePostgres(db);
    await db.run("INSERT INTO events (id,guild_id,name,created_at,updated_at) VALUES ('a','guild-a','A',1,1),('b','guild-b','B',1,1)");
    await db.run("INSERT INTO audit_log (ts,actor,action,details,guild_id) VALUES (1,'host','host.action','{}',NULL),(1,'a','tenant.action','{}','guild-a'),(1,'b','tenant.action','{}','guild-b')");
    await db.run("INSERT INTO event_templates (id,guild_id,name,kind,json,created_at) VALUES ('global',NULL,'Global','event','{}',1),('template-b','guild-b','B','event','{}',1)");
    const schema = (await db.get<{name: string}>('SELECT current_schema() AS name'))!.name;
    await db.run(`CREATE ROLE ${role} LOGIN PASSWORD '${password}' NOSUPERUSER NOBYPASSRLS`);
    await db.run(`GRANT USAGE ON SCHEMA ${schema} TO ${role}`);
    await db.run(`GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA ${schema} TO ${role}`);
    await db.run(`GRANT USAGE ON ALL SEQUENCES IN SCHEMA ${schema} TO ${role}`);
    const attributes = await db.get<{rolsuper: boolean; rolbypassrls: boolean}>(`SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = '${role}'`);
    assert.deepEqual(attributes, { rolsuper: false, rolbypassrls: false });
    const appUrl = new URL(process.env.DATABASE_URL!);
    appUrl.username = role;
    appUrl.password = password;
    appDb = await openPostgres(appUrl.toString(), schema, 1);
    try {
      const policies = () => db.all('SELECT tablename,policyname,cmd,qual,with_check FROM pg_policies WHERE schemaname=current_schema() ORDER BY tablename,policyname');
      const before = await policies();
      await assert.rejects(db.transaction(async () => { await migratePostgres(db); throw new Error('migration rollback'); }), /migration rollback/);
      assert.deepEqual(await policies(), before);
      await migratePostgres(db);
      assert.deepEqual(await policies(), before);
      await assert.rejects(migratePostgres(appDb), /permission denied|must be owner/i);
      const migrationUrl = new URL(process.env.DATABASE_URL!);
      migrationUrl.searchParams.set('options', `-c search_path=${schema}`);
      appUrl.searchParams.set('options', `-c search_path=${schema}`);
      const runtime = await openDatabase(appUrl.toString(), migrationUrl.toString());
      try {
        assert.equal((await runtime.get<{ name: string }>('SELECT current_user AS name'))!.name, role);
        assert.deepEqual(await runtime.all('SELECT * FROM events'), []);
      } finally { await runtime.close(); }
      const fixtures: Record<string, Record<string, unknown>> = {
        form_config: { guild_id: 'guild-a', json: '{}', updated_at: 1 },
        guild_settings: { guild_id: 'guild-a', updated_at: 1 },
        teams: { id: 'team-a', event_id: 'a', guild_id: 'guild-a', name: 'A', kind: 'public', created_at: 1 },
        participants: { event_id: 'a', user_id: 'user', guild_id: 'guild-a', display_name: 'A', experience: '', role_track: '', skills: '[]', team_pref: '', teammates: '[]', created_at: 1, updated_at: 1 },
        registration_answers: { event_id: 'a', user_id: 'user', form_version: 1, answers_json: '{}', updated_at: 1 },
        imported_signups: { id: 'import-a', event_id: 'a', guild_id: 'guild-a', source_row: 2, source_timestamp: 'unknown', form_version: 1, values_json: '{}', answers_json: '{}', created_at: 1, updated_at: 1 },
        team_requests: { event_id: 'a', guild_id: 'guild-a', team_id: 'team-a', requester_id: 'user', target_id: 'other', kind: 'invite', created_at: 1 },
        member_deletions: { guild_id: 'guild-a', user_id: 'deleted', deleted_at: 1 },
        private_answer_deletions: { guild_id: 'guild-a', event_id: 'a', user_id: 'deleted', deleted_at: 1 },
      };
      const insert = (target: typeof db, table: string, row: Record<string, unknown>) => target.run(`INSERT INTO ${table} (${Object.keys(row).join(',')}) VALUES (${Object.keys(row).map(() => '?').join(',')})`, ...Object.values(row));
      for (const [table, own] of Object.entries(fixtures)) {
        const foreign = Object.fromEntries(Object.entries(own).map(([key, value]) => [key, key === 'id' && value === 'import-a' ? 'import-b' : value === 'guild-a' ? 'guild-b' : value === 'team-a' ? 'team-b' : key === 'event_id' ? 'b' : value]));
        await insert(db, table, foreign);
        assert.deepEqual(await appDb.all(`SELECT * FROM ${table}`), [], `${table}: no context`);
        await withGuildContext(appDb, 'guild-a', async () => {
          assert.deepEqual(await appDb!.all(`SELECT * FROM ${table}`), [], `${table}: foreign read`);
          assert.equal((await appDb!.run(`UPDATE ${table} SET ${Object.keys(own)[0]} = ${Object.keys(own)[0]}`)).changes, 0, `${table}: foreign update`);
          assert.equal((await appDb!.run(`DELETE FROM ${table}`)).changes, 0, `${table}: foreign delete`);
          await assert.rejects(insert(appDb!, table, foreign), /row-level security/i, `${table}: foreign insert`);
          await insert(appDb!, table, own);
          assert.equal((await appDb!.all(`SELECT * FROM ${table}`)).length, 1, `${table}: positive own read/write`);
        });
        await assert.rejects(insert(appDb, table, own), /row-level security/i, `${table}: no-context insert`);
        if ('guild_id' in own) {
          const { guild_id: _guild, ...missingGuild } = own;
          await withGuildContext(appDb, 'guild-a', () => assert.rejects(insert(appDb!, table, missingGuild), /row-level security|not-null/i, `${table}: omitted guild`));
        }
      }
      await assert.rejects(appDb.transaction(() => withGuildContext(appDb!, 'guild-a', () => appDb!.all('SELECT * FROM events'))), /guild.*transaction/i);
      await withGuildContext(appDb, 'guild-a', async () => {
        await assert.rejects(insert(appDb!, 'participants', { ...fixtures.participants, event_id: 'b', user_id: 'forged' }), /row-level security/i);
        await assert.rejects(insert(appDb!, 'teams', { ...fixtures.teams, id: 'forged-team', event_id: 'b' }), /row-level security/i);
        await assert.rejects(insert(appDb!, 'team_requests', { ...fixtures.team_requests, team_id: 'team-b' }), /row-level security/i);
        await assert.rejects(withGuildContext(appDb!, 'guild-b', async () => undefined), /Cannot change guild/);
      });
      const ownership = await appDb.get<{ owns: boolean; create_schema: boolean }>(`SELECT EXISTS (SELECT 1 FROM pg_class WHERE relnamespace=current_schema()::regnamespace AND relowner=(SELECT oid FROM pg_roles WHERE rolname=current_user)) AS owns, has_schema_privilege(current_user,current_schema(),'CREATE') AS create_schema`);
      assert.deepEqual(ownership, { owns: false, create_schema: false });
      const grants = await appDb.all<{ privilege_type: string }>('SELECT DISTINCT privilege_type FROM information_schema.role_table_grants WHERE grantee=current_user AND table_schema=current_schema() ORDER BY privilege_type');
      assert.deepEqual(grants.map((row) => row.privilege_type), ['DELETE', 'INSERT', 'SELECT', 'UPDATE']);
      t.diagnostic(`app_role=${role}; superuser=false; bypassrls=false; owns_tables=false; schema_create=false; table_grants=${grants.map((row) => row.privilege_type).join(',')}`);
      await appDb.run("INSERT INTO audit_log (ts,actor,action,guild_id) VALUES (1,'discord','web.login',NULL)");
      await assert.rejects(appDb.run("INSERT INTO audit_log (ts,actor,action,guild_id) VALUES (1,'host','unapproved.maintenance',NULL)"), /row-level security/i);
      assert.deepEqual(await appDb.all('SELECT * FROM audit_log'), []);
      await assert.rejects(appDb.run("INSERT INTO events (id,guild_id,name,created_at,updated_at) VALUES ('no-context','guild-a','Denied',1,1)"), /row-level security/i);
      const pid = await appDb.transaction(async () => {
        await appDb!.run("SELECT set_config('app.system_mode','true',true)");
        await assert.rejects(appDb!.transaction(() => appDb!.run('SET ROLE postgres')), /permission denied/i);
        assert.equal((await appDb!.get<{user: string}>('SELECT current_user AS user'))?.user, role);
        assert.deepEqual((await appDb!.all<{id: string}>('SELECT id FROM events')).map((row) => row.id), []);
        assert.deepEqual(await appDb!.all('SELECT * FROM audit_log'), []);
        assert.deepEqual((await appDb!.all<{id: string}>('SELECT id FROM event_templates ORDER BY id')).map((row) => row.id), ['global']);
        return (await appDb!.get<{pid: number}>('SELECT pg_backend_pid() AS pid'))!.pid;
      });
      await withGuildContext(appDb, 'guild-a', () => appDb!.transaction(async () => {
        assert.deepEqual((await appDb!.all<{id: string}>('SELECT id FROM events')).map((row) => row.id), ['a']);
        assert.deepEqual((await appDb!.all<{actor: string}>('SELECT actor FROM audit_log ORDER BY actor')).map((row) => row.actor), ['a']);
        assert.deepEqual((await appDb!.all<{id: string}>('SELECT id FROM event_templates ORDER BY id')).map((row) => row.id), ['global']);
        assert.equal((await appDb!.run("DELETE FROM event_templates WHERE id = 'global'")).changes, 0);
        assert.equal((await appDb!.run("UPDATE audit_log SET actor='forged' WHERE guild_id='guild-b' OR guild_id IS NULL")).changes, 0);
        assert.equal((await appDb!.run("DELETE FROM audit_log WHERE guild_id='guild-b' OR guild_id IS NULL")).changes, 0);
        await assert.rejects(appDb!.transaction(() => appDb!.run("INSERT INTO audit_log (ts,actor,action,guild_id) VALUES (1,'a','forged','guild-b')")), /row-level security/i);
        await assert.rejects(appDb!.transaction(() => appDb!.run("INSERT INTO events (id,name,created_at,updated_at) VALUES ('missing-guild','Denied',1,1)")), /row-level security|not-null/i);
        assert.equal((await appDb!.run("UPDATE events SET name = 'cross' WHERE id = 'b'")).changes, 0);
        assert.equal((await appDb!.run("DELETE FROM events WHERE id = 'b'")).changes, 0);
        assert.equal((await appDb!.run("UPDATE events SET name = 'own write' WHERE id = 'a'")).changes, 1);
        await appDb!.transaction(async () => {
          assert.equal((await appDb!.get<{ name: string }>("SELECT name FROM events WHERE id='a'"))!.name, 'own write');
          await assert.rejects(appDb!.transaction(async () => { await appDb!.run("UPDATE events SET name='rolled back' WHERE id='a'"); throw new Error('nested rollback'); }), /nested rollback/);
          assert.equal((await appDb!.get<{ name: string }>("SELECT name FROM events WHERE id='a'"))!.name, 'own write');
        });
        await assert.rejects(appDb!.transaction(() => appDb!.run("INSERT INTO events (id,guild_id,name,created_at,updated_at) VALUES ('forged','guild-b','forged',1,1)")), /row-level security/i);
        await assert.rejects(appDb!.transaction(() => appDb!.run('CREATE TABLE forbidden_ddl (id INTEGER)')), /permission denied/i);
      }));
      await withGuildContext(appDb, 'guild-b', () => appDb!.transaction(async () => {
        assert.deepEqual((await appDb!.all<{id: string}>('SELECT id FROM events')).map((row) => row.id), ['b']);
      }));
      const kysely = createKysely(appDb);
      try {
        assert.deepEqual(await withGuildContext(appDb, 'guild-a', () => kysely.selectFrom('events').select('id').execute()), [{ id: 'a' }]);
        assert.deepEqual(await kysely.selectFrom('events').select('id').execute(), []);
      } finally { await kysely.destroy(); }
      await assert.rejects(withGuildContext(appDb, 'guild-a', () => appDb!.transaction(async () => {
        assert.deepEqual((await appDb!.all<{id: string}>('SELECT id FROM events')).map((row) => row.id), ['a']);
        throw new Error('rollback probe');
      })), /rollback probe/);
      await appDb.transaction(async () => {
        assert.deepEqual((await appDb!.all<{id: string}>('SELECT id FROM events')).map((row) => row.id), []);
        assert.equal((await appDb!.get<{pid: number}>('SELECT pg_backend_pid() AS pid'))!.pid, pid);
      });
      await withGuildContext(appDb, 'guild-a', async () => {
        await appDb!.run("INSERT INTO event_templates (id,guild_id,name,kind,json,created_at) VALUES ('own','guild-a','Own','event','{}',1)");
        assert.equal((await appDb!.run("UPDATE event_templates SET name='Updated' WHERE id='own'")).changes, 1);
        assert.equal((await appDb!.run("DELETE FROM event_templates WHERE id='own'")).changes, 1);
        await assert.rejects(appDb!.run("INSERT INTO event_templates (id,guild_id,name,kind,json,created_at) VALUES ('forged-template','guild-b','No','event','{}',1)"), /row-level security/i);
        await assert.rejects(appDb!.run("INSERT INTO event_templates (id,guild_id,name,kind,json,created_at) VALUES ('forged-global',NULL,'No','event','{}',1)"), /row-level security/i);
        await assert.rejects(appDb!.run("UPDATE events SET guild_id='guild-b' WHERE id='a'"), /row-level security/i);
      });
      const peer = await openPostgres(appUrl.toString(), schema, 1);
      try {
        let entered = 0;
        let release!: () => void;
        const both = new Promise<void>((resolve) => { release = resolve; });
        const overlap = async () => { if (++entered === 2) release(); await both; };
        const [a, b] = await Promise.all([
          withGuildContext(appDb, 'guild-a', () => appDb!.transaction(async () => { await overlap(); return ({
            id: (await appDb!.get<{id: string}>('SELECT id FROM events'))!.id,
            pid: (await appDb!.get<{pid: number}>('SELECT pg_backend_pid() AS pid'))!.pid,
          }); })),
          withGuildContext(peer, 'guild-b', () => peer.transaction(async () => { await overlap(); return ({
            id: (await peer.get<{id: string}>('SELECT id FROM events'))!.id,
            pid: (await peer.get<{pid: number}>('SELECT pg_backend_pid() AS pid'))!.pid,
          }); })),
        ]);
        assert.equal(a.id, 'a');
        assert.equal(b.id, 'b');
        assert.notEqual(a.pid, b.pid);
      } finally { await peer.close(); }
    } finally {
      await appDb?.close();
      await db.run(`DROP OWNED BY ${role}`);
      await db.run(`DROP ROLE ${role}`);
    }
  } finally { await db.close(); }
});
