/**
 * Kysely database layer — type-safe SQL under the slice repositories.
 *
 * Wraps node:sqlite's DatabaseSync in a Kysely Driver/Dialect (no better-sqlite3,
 * no native deps). The Kysely instance shares the SAME connection as the raw
 * prepared-statement layer, so transactions and WAL state are consistent.
 *
 * Plan (agreed with janne): slices keep simple raw SQL; complex/evolving
 * queries move to typed Kysely queries here. New tables get Kysely types.
 */
import {
  Kysely,
  SqliteAdapter,
  SqliteIntrospector,
  SqliteQueryCompiler,
  type Dialect,
  type Driver,
  type DatabaseConnection,
  type QueryResult,
} from 'kysely';
import type { DatabaseSync, StatementSync } from 'node:sqlite';

export interface ParticipantTable {
  event_id: string;
  user_id: string;
  guild_id: string;
  display_name: string;
  experience: string;
  role_track: string;
  skills: string; // JSON array
  team_pref: string;
  teammates: string; // JSON array
  team_id: string | null;
  status: string;
  block_reason: string | null;
  created_at: number;
  updated_at: number;
}

export interface TeamTable {
  id: string;
  event_id: string | null;
  guild_id: string;
  name: string;
  kind: string;
  owner_id: string | null;
  join_code: string | null;
  role_id: string | null;
  text_channel_id: string | null;
  voice_channel_id: string | null;
  color: string | null;
  created_at: number;
}

export interface EventTable {
  id: string;
  guild_id: string;
  name: string;
  description: string;
  starts_at: number | null;
  ends_at: number | null;
  status: string;
  form_json: string | null;
  panel_channel_id: string | null;
  category_id: string | null;
  cleanup_delay_hours: number;
  cleanup_done: number;
  reminded_24h: number;
  discord_event_ids: string; // JSON array
  created_at: number;
  updated_at: number;
}

export interface TeamRequestTable {
  id: number;
  event_id: string | null;
  guild_id: string;
  team_id: string;
  requester_id: string;
  target_id: string;
  kind: string;
  status: string;
  created_at: number;
  decided_at: number | null;
}

export interface AuditLogTable {
  id: number;
  ts: number;
  actor: string;
  action: string;
  target: string | null;
  details: string | null;
}

export interface MetaTable {
  key: string;
  value: string;
}

export interface DbSchema {
  participants: ParticipantTable;
  teams: TeamTable;
  events: EventTable;
  team_requests: TeamRequestTable;
  audit_log: AuditLogTable;
  meta: MetaTable;
}

export type KyselyDb = Kysely<DbSchema>;

/** Set by createKysely so the driver closures reach the open handle. */
let dbRef: DatabaseSync;

/** Single-connection driver over node:sqlite (sync API wrapped async). */
class NodeSqliteDriver implements Driver {
  #connection: DatabaseConnection | null = null;

  async init(): Promise<void> {}

  async acquireConnection(): Promise<DatabaseConnection> {
    if (this.#connection === null) {
      const conn: DatabaseConnection = {
        executeQuery: async <R>(compiled: { sql: string; parameters: readonly unknown[] }): Promise<QueryResult<R>> => {
          const { sql, parameters } = compiled;
          const head = sql.trimStart().slice(0, 7).toUpperCase();
          const isRead = head.startsWith('SELECT') || head.startsWith('PRAGMA') || head.startsWith('WITH');
          const stmt = dbRef.prepare(sql) as StatementSync;
          if (isRead) {
            const rows = stmt.all(...(parameters as never[])) as unknown as Record<string, unknown>[];
            return { rows: rows as R[] };
          }
          const info = stmt.run(...(parameters as never[]));
          return {
            rows: [],
            numAffectedRows: BigInt(info.changes),
          };
        },
        async *streamQuery<R>(): AsyncIterableIterator<QueryResult<R>> {
          throw new Error('streaming queries are not supported over node:sqlite');
          // eslint-disable-next-line no-unreachable
          yield {} as never;
        },
      };
      this.#connection = conn;
    }
    return this.#connection;
  }

  async beginTransaction(_connection: DatabaseConnection, _settings: { isolationLevel?: string }): Promise<void> {
    dbRef.exec('BEGIN');
  }

  async commitTransaction(_connection: DatabaseConnection): Promise<void> {
    dbRef.exec('COMMIT');
  }

  async rollbackTransaction(_connection: DatabaseConnection): Promise<void> {
    dbRef.exec('ROLLBACK');
  }

  async endTransaction(_connection: DatabaseConnection): Promise<void> {
    // Kysely calls commit/rollback directly; kept for interface completeness.
  }

  async releaseConnection(): Promise<void> {
    // single shared connection — nothing to release
  }

  async destroy(): Promise<void> {
    // the raw layer owns closing the DatabaseSync
  }
}

export function createKysely(db: DatabaseSync): KyselyDb {
  dbRef = db;
  const dialect: Dialect = {
    createAdapter: () => new SqliteAdapter(),
    createDriver: () => new NodeSqliteDriver(),
    createIntrospector: (k) => new SqliteIntrospector(k),
    createQueryCompiler: () => new SqliteQueryCompiler(),
  };
  return new Kysely<DbSchema>({ dialect });
}
