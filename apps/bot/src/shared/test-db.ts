import { randomUUID } from 'node:crypto';
import { after } from 'node:test';
import type { Db } from './db.js';
import { parseDatabaseUrl } from './db-config.js';
import { assertDisposableDatabase } from './database-guard.js';
import { openPostgres, migratePostgres } from './postgres.js';

const handles = new Set<Db>();
after(async () => { for (const db of handles) await db.close(); });

function track(db: Db): Db {
  const close = db.close.bind(db);
  let closing: Promise<void> | undefined;
  db.close = () => closing ??= Promise.resolve().then(close).finally(() => handles.delete(db));
  handles.add(db);
  return db;
}

/** Same feature fixtures, isolated schemas so concurrent test handles never collide. */
export async function openTestDb(): Promise<Db> {
  const url = process.env.DATABASE_URL;
  if (url === undefined) throw new Error('DATABASE_URL is required for PostgreSQL fixtures');
  assertDisposableDatabase(parseDatabaseUrl(url).database);
  const schema = `fixture_${randomUUID().replaceAll('-', '')}`;
  const admin = await openPostgres(url);
  try {
    const connected = await admin.get<{ name: string }>('SELECT current_database() AS name');
    assertDisposableDatabase(connected?.name ?? '');
    if (connected?.name !== parseDatabaseUrl(url).database) throw new Error('Fixture database does not match DATABASE_URL');
  } catch (error) { await admin.close(); throw error; }
  try {
    await admin.run(`CREATE SCHEMA ${schema}`);
    const db = await openPostgres(url, schema);
    try { await migratePostgres(db); } catch (error) { await db.close(); throw error; }
    const close = db.close.bind(db);
    db.close = async () => {
      await close();
      try { await admin.run(`DROP SCHEMA IF EXISTS ${schema} CASCADE`); } finally { await admin.close(); } // db-guard:allow:db-name-guard t_25580df8: scanner reads IF as database; configured/connected database guarded, local UUID schema only.
    };
    return track(db);
  } catch (error) {
    try { await admin.run(`DROP SCHEMA IF EXISTS ${schema} CASCADE`); } finally { await admin.close(); } // db-guard:allow:db-name-guard t_25580df8: scanner reads IF as database; configured/connected database guarded, local UUID schema only.
    throw error;
  }
}
