import { randomBytes } from 'node:crypto';
export interface AsyncDb {
  /** Run a SELECT (or any row-returning statement) → all rows. */
  all<T = Record<string, unknown>>(sql: string, ...params: unknown[]): Promise<T[]>;
  /** Run a statement expected to return at most one row. */
  get<T = Record<string, unknown>>(sql: string, ...params: unknown[]): Promise<T | undefined>;
  /** Run a mutating statement → { changes, lastInsertRowid }. */
  run(sql: string, ...params: unknown[]): Promise<{ changes: number | bigint; lastInsertRowid: number | bigint }>;
  /**
   * Run fn atomically: BEGIN … COMMIT, ROLLBACK on throw. Nested calls become
   * SAVEPOINTs. Serialised per handle (single-writer queue) — statements issued
   * from inside fn join the transaction; statements from outside queue until it
   * finishes, which is what keeps check-then-write sequences safe at await points.
   */
  transaction<T>(fn: () => Promise<T>): Promise<T>;
}

/**
 * The database handle: the PostgreSQL handle (used by migrations, tests, the
 * Kysely adapter and index.ts bootstrap) PLUS the async facade used by every
 * slice data module.
 */
export interface Db extends AsyncDb {
  close(): void | Promise<void>;
}

/** PostgreSQL is the only runtime database; never fall back to a local file. */
export async function openDatabase(databaseUrl: string | undefined): Promise<Db> {
  if (databaseUrl === undefined) throw new Error('DATABASE_URL is required');
  const { openPostgres, migratePostgres } = await import('./postgres.js');
  const db = await openPostgres(databaseUrl);
  try { await migratePostgres(db); return db; }
  catch (error) { await db.close(); throw error; }
}

/** Short readable id for events/teams. */
export function newId(prefix: string): string {
  return `${prefix}_${randomBytes(6).toString('base64url')}`;
}

/** Human join code: 6 chars, no ambiguous glyphs (0/O/1/I/L). */
export function newJoinCode(): string {
  const alphabet = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  let code = '';
  const bytes = randomBytes(6);
  for (let i = 0; i < 6; i++) {
    code += alphabet[bytes[i]! % alphabet.length];
  }
  return code;
}
