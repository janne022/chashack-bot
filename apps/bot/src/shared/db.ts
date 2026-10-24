import { randomBytes } from 'node:crypto';
import { parseDatabaseUrl } from './db-config.js';
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
export async function openDatabase(databaseUrl: string | undefined, migrationDatabaseUrl: string | undefined, skipMigrations = false): Promise<Db> {
  if (databaseUrl === undefined) throw new Error('DATABASE_URL is required');
  const { openPostgres, migratePostgres } = await import('./postgres.js');
  if (!skipMigrations) {
  if (migrationDatabaseUrl === undefined) throw new Error('MIGRATION_DATABASE_URL is required');
  const appConfig = parseDatabaseUrl(databaseUrl);
  const migrationConfig = parseDatabaseUrl(migrationDatabaseUrl);
  if (appConfig.host !== migrationConfig.host || appConfig.port !== migrationConfig.port || appConfig.database !== migrationConfig.database || appConfig.user === migrationConfig.user) {
    throw new Error('MIGRATION_DATABASE_URL must use a distinct role on the same PostgreSQL database');
  }
  const migrationDb = await openPostgres(migrationDatabaseUrl);
  try { await migratePostgres(migrationDb); } finally { await migrationDb.close(); }
  }
  const db = await openPostgres(databaseUrl);
  try {
    // MEMBER includes transitive/NOINHERIT memberships, not just active privileges.
    // Conservatively refuse elevated membership even when SET is currently disabled.
    const role = await db.get<{ unsafe_authority: boolean }>(`
      SELECT EXISTS (
        SELECT 1 FROM pg_roles r WHERE pg_has_role(current_user, r.oid, 'MEMBER') AND (
          r.rolsuper OR r.rolbypassrls OR r.rolcreaterole OR r.rolcreatedb OR r.rolreplication
          OR EXISTS (SELECT 1 FROM pg_class c WHERE c.relnamespace = current_schema()::regnamespace AND c.relowner = r.oid)
          OR EXISTS (SELECT 1 FROM pg_proc p WHERE p.pronamespace = current_schema()::regnamespace AND p.proowner = r.oid)
          OR has_schema_privilege(r.oid, current_schema(), 'CREATE')
          OR has_database_privilege(r.oid, current_database(), 'CREATE')
        )
      ) AS unsafe_authority`);
    if (!role || role.unsafe_authority) throw new Error('DATABASE_URL role must be non-owner, non-superuser, NOBYPASSRLS, and have no DDL or elevated role memberships');
    return db;
  } catch (error) { await db.close(); throw error; }
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
