import { AsyncLocalStorage } from 'node:async_hooks';
import { Pool, types, type PoolClient } from 'pg';
import type { Db } from './db.js';
import { schemaSql } from './postgres-schema.js';
import { parseDatabaseUrl } from './db-config.js';
import { registerChangeSource, closeChangeSource, migrateLiveChanges } from './live-changes.js';

/** Convert only positional bindings, never question marks inside SQL tokens. */
export function postgresSql(sql: string): string {
  let result = '';
  let parameter = 0;
  for (let i = 0; i < sql.length;) {
    const rest = sql.slice(i);
    const dollar = /^\$(?:[A-Za-z_][A-Za-z_0-9]*)?\$/.exec(rest)?.[0];
    if (dollar) {
      const end = sql.indexOf(dollar, i + dollar.length);
      if (end < 0) throw new Error('Unterminated SQL dollar string');
      result += sql.slice(i, end + dollar.length);
      i = end + dollar.length;
    } else if (rest.startsWith('--')) {
      const end = sql.indexOf('\n', i);
      result += sql.slice(i, end < 0 ? sql.length : end);
      i = end < 0 ? sql.length : end;
    } else if (rest.startsWith('/*')) {
      const start = i;
      let depth = 1;
      i += 2;
      while (i < sql.length && depth > 0) {
        if (sql.slice(i, i + 2) === '/*') { depth++; i += 2; }
        else if (sql.slice(i, i + 2) === '*/') { depth--; i += 2; }
        else i++;
      }
      if (depth) throw new Error('Unterminated SQL comment');
      result += sql.slice(start, i);
    } else if (sql[i] === "'" || sql[i] === '"') {
      const start = i;
      const quote = sql[i++]!;
      // PostgreSQL E'...' strings additionally escape with backslashes.
      const escaped = quote === "'" && /(?:^|\W)[eE]$/.test(sql.slice(0, start));
      let closed = false;
      while (i < sql.length) {
        if (escaped && sql[i] === '\\') { i += 2; continue; }
        if (sql[i++] === quote) {
          if (sql[i] === quote) i++;
          else { closed = true; break; }
        }
      }
      if (!closed) throw new Error('Unterminated SQL quote');
      result += sql.slice(start, i);
    } else {
      result += sql[i] === '?' ? `$${++parameter}` : sql[i];
      i++;
    }
  }
  return result;
}

export interface PostgresDb extends Db {
  close(): Promise<void>;
}

const guildContext = new AsyncLocalStorage<{ db: Db; guildId: string }>();

/** Scope database calls to one guild; PostgreSQL context lives only for each leased transaction. */
export function withGuildContext<T>(db: Db, guildId: string, fn: () => Promise<T>): Promise<T> {
  try { return Promise.resolve(runWithGuildContext(db, guildId, fn)); }
  catch (error) { return Promise.reject(error); }
}

/** Bind a callback-style request lifecycle to a guild's async context. */
export function runWithGuildContext<T>(db: Db, guildId: string, fn: () => T): T {
  if (!guildId) throw new Error('Guild context is required');
  const active = guildContext.getStore();
  if (active?.db === db && active.guildId !== guildId) throw new Error('Cannot change guild inside an active guild context');
  return guildContext.run({ db, guildId }, fn);
}

export async function openPostgres(value: string, schema?: string, poolSize = 10): Promise<PostgresDb> {
  if (schema !== undefined && !/^fixture_[a-f0-9]+$/.test(schema)) throw new Error('Invalid fixture schema');
  const pool = new Pool({ max: poolSize, connectionTimeoutMillis: 5000, ...parseDatabaseUrl(value),
    ...(schema === undefined ? {} : { options: `-c search_path=${schema}` }),
    types: { getTypeParser(oid: number, format?: 'text' | 'binary') {
      if (oid === 20 && format !== 'binary') return (value: string) => {
        const number = Number(value);
        if (!Number.isSafeInteger(number)) throw new Error('PostgreSQL integer exceeds JavaScript safe range');
        return number;
      };
      return types.getTypeParser(oid, format);
    } },
  });
  pool.on('error', () => console.error('PostgreSQL idle connection failed'));
  type TransactionContext = { client: PoolClient; depth: number; active: boolean; guildId: string | undefined; parent?: TransactionContext };
  const context = new AsyncLocalStorage<TransactionContext>();
  const isActive = (tx: TransactionContext): boolean => tx.active && (tx.parent === undefined || isActive(tx.parent));
  // ponytail: per-handle queue preserves check/write semantics; relax only with explicit slice concurrency contracts.
  let queue: Promise<unknown> = Promise.resolve();
  let closed = false;
  let lockPool: Pool | undefined;
  const enqueue = <T>(fn: () => Promise<T>): Promise<T> => {
    if (closed) return Promise.reject(new Error('Database is closed'));
    const result = queue.then(fn);
    queue = result.catch(() => undefined);
    return result;
  };
  const query = (sql: string, params: unknown[]): Promise<import('pg').QueryResult> => {
    const tx = context.getStore();
    const tenant = guildContext.getStore();
    if (!tx && tenant?.db === db) return db.transaction(() => query(sql, params));
    const execute = () => (tx?.client ?? pool).query(postgresSql(sql), params);
    if (tx) {
      if (!isActive(tx) || closed) return Promise.reject(new Error('Transaction is closed'));
      if ((tenant?.db === db ? tenant.guildId : undefined) !== tx.guildId) return Promise.reject(new Error('Cannot change guild inside an active transaction'));
      return execute();
    }
    return enqueue(execute);
  };
  const db: PostgresDb = {
    async all<T>(sql: string, ...params: unknown[]): Promise<T[]> { return (await query(sql, params)).rows as T[]; },
    async get<T>(sql: string, ...params: unknown[]): Promise<T | undefined> { return (await db.all<T>(sql, ...params))[0]; },
    async run(sql, ...params) {
      const result = await query(sql, params);
      return { changes: result.rowCount ?? 0, lastInsertRowid: 0 };
    },
    async tryAdvisoryLock(key, fn) {
      if (closed) throw new Error('Database is closed');
      if (context.getStore()) throw new Error('Cannot acquire a session lock inside a transaction');
      // A separate pool avoids holding the application queue or exhausting a
      // single-connection application pool during external network calls.
      if (!lockPool) {
        lockPool = new Pool({ max: 4, connectionTimeoutMillis: 5000, ...parseDatabaseUrl(value),
          ...(schema === undefined ? {} : { options: `-c search_path=${schema}` }) });
        lockPool.on('error', () => console.error('PostgreSQL idle lock connection failed'));
      }
      const client = await lockPool.connect();
      let broken = false, acquired = false;
      const connectionError = () => { broken = true; };
      client.on('error', connectionError);
      try {
        const lockKey = `chashack:${currentSchema}:${key}`;
        acquired = (await client.query<{ acquired: boolean }>('SELECT pg_try_advisory_lock(hashtextextended($1, 0)) AS acquired', [lockKey])).rows[0]?.acquired === true;
        if (!acquired) return false;
        await fn();
        if (broken) throw new Error('PostgreSQL advisory lock connection was lost');
        return true;
      } finally {
        if (acquired && !broken) {
          try {
            const result = await client.query<{ released: boolean }>('SELECT pg_advisory_unlock(hashtextextended($1, 0)) AS released', [`chashack:${currentSchema}:${key}`]);
            if (result.rows[0]?.released !== true) broken = true;
          } catch { broken = true; }
        }
        client.removeListener('error', connectionError);
        client.release(broken);
      }
    },
    transaction<T>(fn: () => Promise<T>): Promise<T> {
      const parent = context.getStore();
      if (parent) {
        if (!isActive(parent) || closed) return Promise.reject(new Error('Transaction is closed'));
        const name = `sp_${parent.depth + 1}`;
        const tx = { client: parent.client, depth: parent.depth + 1, active: true, guildId: parent.guildId, parent };
        return context.run(tx, async () => {
          try {
            await parent.client.query(`SAVEPOINT ${name}`);
            try {
              const result = await fn();
              await parent.client.query(`RELEASE SAVEPOINT ${name}`);
              return result;
            } catch (error) {
              await parent.client.query(`ROLLBACK TO SAVEPOINT ${name}`);
              await parent.client.query(`RELEASE SAVEPOINT ${name}`);
              throw error;
            }
          } finally { tx.active = false; }
        });
      }
      return enqueue(async () => {
        const client = await pool.connect();
        const tenant = guildContext.getStore();
        const tx = { client, depth: 0, active: true, guildId: tenant?.db === db ? tenant.guildId : undefined };
        let broken = false;
        try {
          await client.query('BEGIN');
          return await context.run(tx, async () => {
            try {
              await client.query("SELECT set_config('app.guild_id', $1, true)", [tx.guildId ?? '']);
              const result = await fn();
              await client.query('COMMIT');
              return result;
            } catch (error) {
              try { await client.query('ROLLBACK'); } catch { broken = true; }
              throw error;
            }
          });
        } finally { tx.active = false; client.release(broken); }
      });
    },
    async close() {
      if (context.getStore()) throw new Error('Cannot close database inside transaction');
      if (closed) return;
      closed = true;
      await closeChangeSource(db);
      await queue;
      if (lockPool) await lockPool.end();
      await pool.end();
    },
  };
  try { await db.get('SELECT 1'); } catch {
    await db.close();
    throw new Error('DATABASE_URL: PostgreSQL connection failed');
  }
  const currentSchema = (await db.get<{ name: string }>('SELECT current_schema() AS name'))!.name;
  registerChangeSource(db, { ...parseDatabaseUrl(value), connectionTimeoutMillis: 5000, application_name: `chashack-live:${currentSchema}` }, currentSchema);
  return db;
}

/** Idempotent bootstrap and additive repair, within one PostgreSQL transaction. */
export async function migratePostgres(db: Db): Promise<void> {
  const statements = schemaSql.split(';').map((sql) => sql.trim()).filter(Boolean);
  await db.transaction(async () => {
    const tables = statements.filter((sql) => sql.startsWith('CREATE TABLE'));
    // Installs created before form-version history already have this table but
    // without the composite key its answer history references. The inline
    // UNIQUE only applies when the table is created, so add that key first.
    const importKey = await db.get(
      `SELECT 1 FROM pg_constraint c
       JOIN pg_class t ON t.oid = c.conrelid
       JOIN pg_namespace n ON n.oid = t.relnamespace
       WHERE n.nspname = current_schema() AND t.relname = 'imported_signups' AND c.contype IN ('p','u')
         AND (SELECT array_agg(a.attname ORDER BY a.attname)
              FROM unnest(c.conkey) AS key(attnum)
              JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = key.attnum) = ARRAY['event_id','id']::name[]`,
    );
    if ((await db.get<{ present: boolean }>("SELECT to_regclass('imported_signups') IS NOT NULL AS present"))?.present && !importKey) {
      await db.run('CREATE UNIQUE INDEX IF NOT EXISTS idx_imported_signups_event_id ON imported_signups(event_id, id)');
    }
    for (const sql of tables) await db.run(sql);
    const columns = await db.all<{ table_name: string; column_name: string }>("SELECT table_name, column_name FROM information_schema.columns WHERE table_schema = current_schema()");
    for (const sql of tables) {
      const table = /^CREATE TABLE IF NOT EXISTS (\w+)\s*\(/.exec(sql)?.[1];
      if (!table) continue;
      for (const line of sql.split('\n').slice(1)) {
        const column = /^\s+(\w+)\s+((?:TEXT|BIGINT)\b.*?)(?:,)?$/.exec(line);
        if (!column || columns.some((c) => c.table_name === table && c.column_name === column[1])) continue;
        await db.run(`ALTER TABLE ${table} ADD COLUMN ${column[1]} ${column[2]}`);
      }
    }
    for (const sql of statements.filter((sql) => !sql.startsWith('CREATE TABLE'))) await db.run(sql);
    await db.run('CREATE INDEX IF NOT EXISTS idx_participants_team ON participants(team_id)');
    await db.run('CREATE INDEX IF NOT EXISTS idx_participants_event ON participants(event_id, status)');
    await db.run('CREATE INDEX IF NOT EXISTS idx_participants_import ON participants(imported_signup_id)');
    await migrateLiveChanges(db);
  });
}
