import { AsyncLocalStorage } from 'node:async_hooks';
import { Pool, types, type PoolClient } from 'pg';
import { schemaSql, type AsyncDb } from './db.js';
import { parseDatabaseUrl } from './db-config.js';

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

export interface PostgresDb extends AsyncDb {
  readonly dialect: 'postgres';
  close(): Promise<void>;
}

export async function openPostgres(value: string, schema?: string): Promise<PostgresDb> {
  if (schema !== undefined && !/^fixture_[a-f0-9]+$/.test(schema)) throw new Error('Invalid fixture schema');
  const pool = new Pool({ connectionTimeoutMillis: 5000, ...parseDatabaseUrl(value),
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
  type TransactionContext = { client: PoolClient; depth: number; active: boolean; parent?: TransactionContext };
  const context = new AsyncLocalStorage<TransactionContext>();
  const isActive = (tx: TransactionContext): boolean => tx.active && (tx.parent === undefined || isActive(tx.parent));
  // ponytail: per-handle queue preserves SQLite check/write semantics; relax only with explicit slice concurrency contracts.
  let queue: Promise<unknown> = Promise.resolve();
  let closed = false;
  const enqueue = <T>(fn: () => Promise<T>): Promise<T> => {
    if (closed) return Promise.reject(new Error('Database is closed'));
    const result = queue.then(fn);
    queue = result.catch(() => undefined);
    return result;
  };
  const query = (sql: string, params: unknown[]) => {
    const tx = context.getStore();
    const execute = () => (tx?.client ?? pool).query(postgresSql(sql), params);
    if (tx) {
      if (!isActive(tx) || closed) return Promise.reject(new Error('Transaction is closed'));
      return execute();
    }
    return enqueue(execute);
  };
  const db: PostgresDb = {
    dialect: 'postgres',
    async all<T>(sql: string, ...params: unknown[]): Promise<T[]> { return (await query(sql, params)).rows as T[]; },
    async get<T>(sql: string, ...params: unknown[]): Promise<T | undefined> { return (await db.all<T>(sql, ...params))[0]; },
    async run(sql, ...params) {
      const result = await query(sql, params);
      return { changes: result.rowCount ?? 0, lastInsertRowid: 0 };
    },
    transaction<T>(fn: () => Promise<T>): Promise<T> {
      const parent = context.getStore();
      if (parent) {
        if (!isActive(parent) || closed) return Promise.reject(new Error('Transaction is closed'));
        const name = `sp_${parent.depth + 1}`;
        const tx = { client: parent.client, depth: parent.depth + 1, active: true, parent };
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
        const tx = { client, depth: 0, active: true };
        let broken = false;
        try {
          await client.query('BEGIN');
          return await context.run(tx, async () => {
            try {
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
      await queue;
      await pool.end();
    },
  };
  try { await db.get('SELECT 1'); } catch {
    await db.close();
    throw new Error('DATABASE_URL: PostgreSQL connection failed');
  }
  return db;
}

/** Current schema shared with SQLite; SQLite's legacy rebuilds stay in its driver. */
export async function migratePostgres(db: PostgresDb): Promise<void> {
  const ddl = schemaSql.replace(/INTEGER PRIMARY KEY AUTOINCREMENT/g, 'BIGINT GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY').replace(/\bINTEGER\b/g, 'BIGINT');
  const statements = ddl.split(';').map((sql) => sql.trim()).filter(Boolean);
  // PostgreSQL resolves REFERENCES immediately, unlike SQLite.
  const teams = statements.findIndex((sql) => sql.startsWith('CREATE TABLE IF NOT EXISTS teams '));
  const [teamSql] = statements.splice(teams, 1);
  statements.unshift(teamSql!);
  await db.transaction(async () => {
    const tables = statements.filter((sql) => sql.startsWith('CREATE TABLE'));
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
    await db.run('ALTER TABLE audit_log ADD COLUMN IF NOT EXISTS guild_id TEXT');
    for (const sql of statements.filter((sql) => !sql.startsWith('CREATE TABLE'))) await db.run(sql);
    await db.run('CREATE INDEX IF NOT EXISTS idx_participants_team ON participants(team_id)');
    await db.run('CREATE INDEX IF NOT EXISTS idx_participants_event ON participants(event_id, status)');
  });
}
