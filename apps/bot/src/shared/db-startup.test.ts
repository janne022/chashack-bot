import assert from 'node:assert/strict';
import { test } from 'node:test';
import { randomUUID } from 'node:crypto';
import { openDatabase } from './db.js';
import { openTestDb } from './test-db.js';

test('PostgreSQL startup requires DATABASE_URL and never falls back', async () => {
  await assert.rejects(openDatabase('', undefined), /DATABASE_URL/);
  await assert.rejects(openDatabase('not a database', 'not a database'), /DATABASE_URL|connection string/);
  await assert.rejects(openDatabase(undefined, undefined), /DATABASE_URL/);
  await assert.rejects(openDatabase('postgresql://app@localhost/chashack_test', undefined), /MIGRATION_DATABASE_URL/);
});

test('PostgreSQL startup rejects effective owner and elevated role memberships', async (t) => {
  for (const authority of ['owner', 'schema', 'bypass', 'createrole', 'createdb', 'replication', 'safe'] as const) {
    await t.test(authority, async () => {
      const db = await openTestDb(1);
      const suffix = randomUUID().replaceAll('-', '');
      const app = `app_${suffix}`;
      const bridge = `bridge_${suffix}`;
      const elevated = `authority_${suffix}`;
      const password = randomUUID();
      const roles: string[] = [];
      try {
        const schema = (await db.get<{ name: string }>('SELECT current_schema() AS name'))!.name;
        for (const role of [app, bridge, elevated]) {
          await db.run(`CREATE ROLE ${role} NOSUPERUSER NOBYPASSRLS`);
          roles.push(role);
        }
        await db.run(`ALTER ROLE ${app} LOGIN PASSWORD '${password}' ${authority === 'owner' || authority === 'safe' ? 'INHERIT' : 'NOINHERIT'}`);
        await db.run(`GRANT USAGE ON SCHEMA ${schema} TO ${app}`);
        await db.run(`GRANT ${elevated} TO ${bridge}`);
        await db.run(`GRANT ${bridge} TO ${app}`);
        if (authority === 'owner') await db.run(`ALTER TABLE events OWNER TO ${elevated}`);
        else if (authority === 'schema') await db.run(`GRANT CREATE ON SCHEMA ${schema} TO ${elevated}`);
        else if (authority === 'safe') await db.run(`GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA ${schema} TO ${elevated}`);
        else await db.run(`ALTER ROLE ${elevated} ${authority === 'bypass' ? 'BYPASSRLS' : authority.toUpperCase()}`);
        const migrationUrl = new URL(process.env.DATABASE_URL!);
        migrationUrl.searchParams.set('options', `-c search_path=${schema}`);
        const appUrl = new URL(migrationUrl);
        appUrl.username = app;
        appUrl.password = password;
        const start = async (skipMigrations = false) => {
          const runtime = await openDatabase(appUrl.toString(), skipMigrations ? undefined : migrationUrl.toString(), skipMigrations);
          try {
            assert.equal((await runtime.get<{ name: string }>('SELECT current_user AS name'))!.name, app);
            if (authority === 'safe') assert.deepEqual(await runtime.all('SELECT * FROM events'), []);
          }
          finally { await runtime.close(); }
        };
        if (authority === 'safe') { await start(); await start(true); }
        else {
          await assert.rejects(start(), /DATABASE_URL role must be/);
          await assert.rejects(start(true), /DATABASE_URL role must be/);
        }
      } finally {
        try {
          await db.run('ALTER TABLE events OWNER TO CURRENT_USER');
          for (const role of roles) await db.run(`DROP OWNED BY ${role}`);
          for (const role of roles) await db.run(`DROP ROLE ${role}`);
        } finally { await db.close(); }
      }
    });
  }
});
