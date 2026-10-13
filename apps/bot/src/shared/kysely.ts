import {
  Kysely,
  PostgresAdapter,
  PostgresIntrospector,
  PostgresQueryCompiler,
  type Dialect,
  type Driver,
  type DatabaseConnection,
  type QueryResult,
} from 'kysely';
import { AsyncLocalStorage } from 'node:async_hooks';
import type { Db } from './db.js';

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

/** A Kysely lease occupies the existing facade queue, on the same connection. */
class FacadeDriver implements Driver {
  constructor(private readonly db: Db) {}
  private readonly leases = new WeakMap<DatabaseConnection, { release: () => void; done: Promise<void>; rollback: boolean }>();
  async init(): Promise<void> {}

  async acquireConnection(): Promise<DatabaseConnection> {
    let publish!: (connection: DatabaseConnection) => void;
    let fail!: (error: unknown) => void;
    const ready = new Promise<DatabaseConnection>((resolve, reject) => { publish = resolve; fail = reject; });
    let release!: () => void;
    const released = new Promise<void>((resolve) => { release = resolve; });
    const aborted = new Error('Kysely rollback');
    let lease!: { release: () => void; done: Promise<void>; rollback: boolean };
    const done = this.db.transaction(async () => {
      const run = AsyncLocalStorage.snapshot();
      const connection: DatabaseConnection = {
        executeQuery: <R>(compiled: { sql: string; parameters: readonly unknown[] }): Promise<QueryResult<R>> => run(async () => {
          const { sql, parameters } = compiled;
          if (/^\s*(SELECT|WITH)\b/i.test(sql) || /\bRETURNING\b/i.test(sql)) {
            return { rows: await this.db.all<R>(sql, ...parameters) };
          }
          const info = await this.db.run(sql, ...parameters);
          return { rows: [], numAffectedRows: BigInt(info.changes) };
        }),
        async *streamQuery<R>(): AsyncIterableIterator<QueryResult<R>> {
          throw new Error('Streaming queries are not supported');
        },
      };
      this.leases.set(connection, lease);
      publish(connection);
      await released;
      if (lease.rollback) throw aborted;
    }).then(() => undefined).catch((error: unknown) => {
      fail(error);
      if (error !== aborted) throw error;
    });
    lease = { release, done, rollback: false };
    // Observe startup errors even when acquisition fails before a lease exists.
    void done.catch(() => undefined);
    return ready;
  }

  async beginTransaction(_connection: DatabaseConnection, settings: { isolationLevel?: string; accessMode?: string }): Promise<void> {
    if (settings.isolationLevel || settings.accessMode) throw new Error('Custom transaction settings are not supported by the shared facade');
  }
  async commitTransaction(): Promise<void> {}
  async rollbackTransaction(connection: DatabaseConnection): Promise<void> { this.leases.get(connection)!.rollback = true; }
  async releaseConnection(connection: DatabaseConnection): Promise<void> {
    const lease = this.leases.get(connection)!;
    lease.release();
    await lease.done;
    this.leases.delete(connection);
  }
  async destroy(): Promise<void> {}
}

export function createKysely(db: Db): KyselyDb {
  const dialect: Dialect = {
    createAdapter: () => new PostgresAdapter(),
    createDriver: () => new FacadeDriver(db),
    createIntrospector: (k) => new PostgresIntrospector(k),
    createQueryCompiler: () => new PostgresQueryCompiler(),
  };
  return new Kysely<DbSchema>({ dialect });
}
