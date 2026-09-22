/**
 * SQLite bootstrap + idempotent migrations via node:sqlite (built into Node 24).
 * No native deps, nothing to compile.
 *
 * Events are first-class: participants, teams and requests are scoped to an
 * event. The signup form config lives on the event. Templates allow reuse.
 */
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { AsyncLocalStorage } from 'node:async_hooks';
import { DatabaseSync } from 'node:sqlite';
import { randomBytes } from 'node:crypto';

/**
 * Async statement facade over the dialect's connection.
 *
 * `all`/`get`/`run` mirror the prepared-statement primitives with positional
 * parameters; `transaction` runs a callback atomically and is serialised against
 * every other async statement and transaction on the handle, so a
 * read-modify-write sequence inside it cannot interleave with concurrent
 * callers (the guarantee the old synchronous code had for free).
 *
 * Dialect-portability contract for WS2b: a Postgres driver implements this same
 * interface (`all/get/run/transaction` over a pooled client); slices never see
 * the driver. `exec` is deliberately NOT part of this facade — multi-statement
 * DDL and PRAGMAs stay on the driver-specific open/migrate path.
 */
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
 * The database handle: the raw driver face (used by migrations, tests, the
 * Kysely adapter and index.ts bootstrap) PLUS the async facade used by every
 * slice data module.
 */
export type Db = DatabaseSync & AsyncDb;

export function openDb(dbPath: string): Db {
  if (dbPath !== ':memory:') {
    mkdirSync(dirname(dbPath), { recursive: true });
  }
  const db = new DatabaseSync(dbPath) as Db;
  db.exec('PRAGMA journal_mode = WAL;');
  db.exec('PRAGMA foreign_keys = ON;');
  attachAsyncFacade(db);
  migrate(db);
  return db;
}

// ─── async facade plumbing ───────────────────────────────────────────────────

interface FacadeState {
  /** Tail of the single-writer queue: every transaction chains onto it. */
  queue: Promise<unknown>;
  /** AsyncLocalStorage marking statements that belong to the open transaction. */
  tx: AsyncLocalStorage<{ depth: number }>;
}

const facadeStates = new WeakMap<DatabaseSync, FacadeState>();

function stateOf(db: DatabaseSync): FacadeState {
  let s = facadeStates.get(db);
  if (s === undefined) {
    s = { queue: Promise.resolve(), tx: new AsyncLocalStorage() };
    facadeStates.set(db, s);
  }
  return s;
}

function attachAsyncFacade(db: Db): void {
  const state = stateOf(db);

  const execDirect = (sql: string, params: unknown[]): { rows: Record<string, unknown>[]; changes: number | bigint; lastInsertRowid: number | bigint } => {
    const stmt = db.prepare(sql);
    const isRead = /^\s*(SELECT|WITH|PRAGMA|RETURNING)\b/i.test(sql);
    if (isRead) {
      return { rows: stmt.all(...(params as never[])) as unknown as Record<string, unknown>[], changes: 0, lastInsertRowid: 0 };
    }
    // A mutating statement executes exactly ONCE, via stmt.run. Never follow it
    // with stmt.all to "collect rows": on node:sqlite a prepared INSERT is not
    // exhausted by run(), so .all() would execute the write a second time
    // (duplicate rows). Statements that return rows (RETURNING) must go through
    // db.all/db.get, which take the read branch above.
    const info = stmt.run(...(params as never[]));
    return { rows: [], changes: info.changes, lastInsertRowid: info.lastInsertRowid };
  };

  const execute = async <T>(
    sql: string,
    params: unknown[],
    mode: 'all' | 'get' | 'run',
  ): Promise<T> => {
    // Inside a transaction's async context: run directly — we are already
    // serialised by the transaction slot and must join its connection state.
    if (state.tx.getStore() !== undefined) {
      return finish(sql, params, mode);
    }
    // Outside: still never interleave with an open transaction. Because
    // node:sqlite is synchronous the queue only ever gates on an in-flight
    // transaction — plain statements remain effectively immediate.
    const s = state;
    const result = s.queue.then(() => finish(sql, params, mode)) as Promise<T>;
    s.queue = result.catch(() => undefined);
    return result;
  };

  const finish = <T>(sql: string, params: unknown[], mode: 'all' | 'get' | 'run'): Promise<T> => {
    try {
      const { rows, changes, lastInsertRowid } = execDirect(sql, params);
      if (mode === 'all') return Promise.resolve(rows as T);
      if (mode === 'get') return Promise.resolve(rows[0] as T);
      return Promise.resolve({ changes, lastInsertRowid } as T);
    } catch (error) {
      return Promise.reject(error);
    }
  };

  const runDirect = (sql: string, params: unknown[]): { changes: number | bigint; lastInsertRowid: number | bigint } => {
    return execDirect(sql, params);
  };

  db.all = async <T = Record<string, unknown>>(sql: string, ...params: unknown[]): Promise<T[]> =>
    execute<T>(sql, params, 'all');
  db.get = async <T = Record<string, unknown>>(sql: string, ...params: unknown[]): Promise<T | undefined> =>
    execute<T | undefined>(sql, params, 'get');
  db.run = async (sql: string, ...params: unknown[]): Promise<{ changes: number | bigint; lastInsertRowid: number | bigint }> => {
    if (state.tx.getStore() !== undefined) return runDirect(sql, params);
    const s = state;
    const result = s.queue.then(() => runDirect(sql, params));
    s.queue = result.catch(() => undefined);
    return result;
  };

  db.transaction = <T>(fn: () => Promise<T>): Promise<T> => {
    const store = state.tx.getStore();
    if (store !== undefined) {
      // Nested transaction → savepoint, so an inner failure rolls back only
      // the inner part while the outer transaction stays in control.
      const sp = `sp_${store.depth + 1}`;
      store.depth += 1;
      db.exec(`SAVEPOINT ${sp}`);
      return (async () => {
        try {
          const value = await fn();
          db.exec(`RELEASE SAVEPOINT ${sp}`);
          store.depth -= 1;
          return value;
        } catch (error) {
          db.exec(`ROLLBACK TO SAVEPOINT ${sp}`);
          store.depth -= 1;
          throw error;
        }
      })();
    }
    // Top-level transaction: take the single-writer slot for the whole body.
    const s = state;
    const result = s.queue.then(
      () =>
        state.tx.run({ depth: 0 }, async () => {
          db.exec('BEGIN');
          try {
            const value = await fn();
            db.exec('COMMIT');
            return value;
          } catch (error) {
            try {
              db.exec('ROLLBACK');
            } catch (rollbackError) {
              console.warn('transaction rollback failed:', rollbackError);
            }
            throw error;
          }
        }) as Promise<T>,
    );
    s.queue = result.catch(() => undefined);
    return result;
  };
}

function addColumnIfMissing(db: Db, table: string, column: string, definition: string): void {
  const tableExists = (
    db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?").get(table) as
      | { name: string }
      | undefined
  );
  if (tableExists === undefined) return;
  const cols = db.prepare(`PRAGMA table_info(${table})`).all() as unknown as { name: string }[];
  if (!cols.some((c) => c.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}

function migrate(db: Db): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS events (
      id TEXT PRIMARY KEY,
      guild_id TEXT NOT NULL,
      name TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      starts_at INTEGER,
      ends_at INTEGER,
      signup_starts_at INTEGER,
      signup_ends_at INTEGER,
      status TEXT NOT NULL DEFAULT 'draft',
      form_json TEXT,
      panel_channel_id TEXT,
      category_id TEXT,
      cleanup_delay_hours INTEGER NOT NULL DEFAULT 48,
      cleanup_done INTEGER NOT NULL DEFAULT 0,
      cleanup_warned_72h INTEGER NOT NULL DEFAULT 0,
      cleanup_warned_24h INTEGER NOT NULL DEFAULT 0,
      reminded_24h INTEGER NOT NULL DEFAULT 0,
      match_at INTEGER,
      match_locked INTEGER NOT NULL DEFAULT 0,
      discord_event_ids TEXT NOT NULL DEFAULT '[]',
      announcement_channel_id TEXT,
      schedule_channel_id TEXT,
      schedule_json TEXT NOT NULL DEFAULT '[]',
      announcements_json TEXT NOT NULL DEFAULT '[]',
      assignments_json TEXT NOT NULL DEFAULT '[]',
      announced_schedule_ids TEXT NOT NULL DEFAULT '[]',
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_events_guild ON events(guild_id, status);

    CREATE TABLE IF NOT EXISTS event_templates (
      id TEXT PRIMARY KEY,
      guild_id TEXT,
      name TEXT NOT NULL,
      kind TEXT NOT NULL,
      json TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS form_config (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      json TEXT NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS participants (
      event_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      guild_id TEXT NOT NULL,
      display_name TEXT NOT NULL,
      experience TEXT NOT NULL,
      role_track TEXT NOT NULL,
      skills TEXT NOT NULL,
      team_pref TEXT NOT NULL,
      teammates TEXT NOT NULL,
      team_id TEXT REFERENCES teams(id) ON DELETE SET NULL,
      status TEXT NOT NULL DEFAULT 'active',
      block_reason TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      PRIMARY KEY (event_id, user_id)
    );

    CREATE TABLE IF NOT EXISTS teams (
      id TEXT PRIMARY KEY,
      event_id TEXT,
      guild_id TEXT NOT NULL,
      name TEXT NOT NULL,
      kind TEXT NOT NULL,
      owner_id TEXT,
      join_code TEXT UNIQUE,
      role_id TEXT,
      text_channel_id TEXT,
      voice_channel_id TEXT,
      color TEXT,
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS team_requests (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      event_id TEXT,
      guild_id TEXT NOT NULL,
      team_id TEXT NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
      requester_id TEXT NOT NULL,
      target_id TEXT NOT NULL,
      kind TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      created_at INTEGER NOT NULL,
      decided_at INTEGER
    );
    CREATE INDEX IF NOT EXISTS idx_requests_team ON team_requests(team_id, status);
    CREATE INDEX IF NOT EXISTS idx_requests_target ON team_requests(target_id, status);

    CREATE TABLE IF NOT EXISTS guild_settings (
      guild_id TEXT PRIMARY KEY,
      team_category_id TEXT,
      default_announcement_channel_id TEXT,
      default_panel_channel_id TEXT,
      default_category_id TEXT,
      default_cleanup_delay_hours INTEGER,
      default_form_template_id TEXT,
      default_schedule_channel_id TEXT,
      mod_role_ids TEXT NOT NULL DEFAULT '[]',
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS web_sessions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      username TEXT NOT NULL,
      avatar TEXT,
      guild_ids TEXT NOT NULL DEFAULT '[]',
      selected_guild_id TEXT,
      created_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS audit_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ts INTEGER NOT NULL,
      actor TEXT NOT NULL,
      action TEXT NOT NULL,
      target TEXT,
      details TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_audit_ts ON audit_log(ts DESC);
  `);

  // Legacy columns from earlier schemas.
  addColumnIfMissing(db, 'guild_settings', 'default_announcement_channel_id', 'TEXT');
  addColumnIfMissing(db, 'guild_settings', 'default_panel_channel_id', 'TEXT');
  addColumnIfMissing(db, 'guild_settings', 'default_category_id', 'TEXT');
  addColumnIfMissing(db, 'guild_settings', 'default_cleanup_delay_hours', 'INTEGER');
  addColumnIfMissing(db, 'guild_settings', 'default_form_template_id', 'TEXT');
  addColumnIfMissing(db, 'guild_settings', 'default_schedule_channel_id', 'TEXT');
  addColumnIfMissing(db, 'guild_settings', 'mod_role_ids', `TEXT NOT NULL DEFAULT '[]'`);
  addColumnIfMissing(db, 'teams', 'event_id', 'TEXT');
  addColumnIfMissing(db, 'team_requests', 'event_id', 'TEXT');
  addColumnIfMissing(db, 'participants', 'event_id', 'TEXT');
  addColumnIfMissing(db, 'teams', 'role_id', 'TEXT');
  addColumnIfMissing(db, 'teams', 'text_channel_id', 'TEXT');
  addColumnIfMissing(db, 'teams', 'voice_channel_id', 'TEXT');
  addColumnIfMissing(db, 'teams', 'color', 'TEXT');
  addColumnIfMissing(db, 'events', 'cleanup_warned_72h', 'INTEGER NOT NULL DEFAULT 0');
  addColumnIfMissing(db, 'events', 'cleanup_warned_24h', 'INTEGER NOT NULL DEFAULT 0');
  addColumnIfMissing(db, 'events', 'match_at', 'INTEGER');
  addColumnIfMissing(db, 'events', 'match_locked', 'INTEGER NOT NULL DEFAULT 0');
  addColumnIfMissing(db, 'events', 'schedule_channel_id', 'TEXT');
  addColumnIfMissing(db, 'events', 'signup_starts_at', 'INTEGER');
  addColumnIfMissing(db, 'events', 'signup_ends_at', 'INTEGER');
  addColumnIfMissing(db, 'events', 'assignments_json', 'TEXT NOT NULL DEFAULT \'[]\'');
  addColumnIfMissing(db, 'events', 'schedule_json', 'TEXT NOT NULL DEFAULT \'[]\'');
  addColumnIfMissing(db, 'events', 'announcements_json', 'TEXT NOT NULL DEFAULT \'[]\'');
  addColumnIfMissing(db, 'events', 'announced_schedule_ids', 'TEXT NOT NULL DEFAULT \'[]\'');

  backfillLegacyEvents(db);
  addEventColumns(db);
  recreateParticipantsTable(db);
  migrateTeamPrefs(db);
  stripTemplateAnnouncements(db);
  purgeOrphanTeams(db);
}

/**
 * commitMatch used to run a legacy insert loop without `event_id`, so every match
 * left one extra `matched` team row with `event_id` NULL and **no members** (the
 * event-scoped insert that followed took the members). `backfillLegacyEvents`
 * then adopted those rows into the per-guild "Imported event", where they showed
 * up as phantom teams.
 *
 * A `matched` team with no members is never legitimate, so purge those: both the
 * not-yet-adopted (`event_id IS NULL`) and already-adopted (`ev_legacy_*`) ones.
 * Real pre-events teams keep their members and are left alone. Idempotent.
 */
function purgeOrphanTeams(db: Db): void {
  const has = (table: string): boolean =>
    db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?").get(table) !== undefined;
  if (!has('teams') || !has('participants')) return;
  const res = db
    .prepare(
      `DELETE FROM teams
        WHERE kind = 'matched'
          AND (event_id IS NULL OR event_id LIKE 'ev_legacy_%')
          AND id NOT IN (SELECT team_id FROM participants WHERE team_id IS NOT NULL)`,
    )
    .run();
  if (Number(res.changes) > 0) {
    console.log(`migration: purged ${res.changes} orphan matched team row(s) with no members`);
  }
}

/**
 * Event templates used to embed a top-level `announcements` array (the old
 * trigger-driven model). Announcements are now action-driven — they live in
 * schedule blocks as `announce` actions. Strip the stale key so templates
 * don't carry dead config. Idempotent: rewrites only rows that still have it.
 */
function stripTemplateAnnouncements(db: Db): void {
  const tableExists = db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'event_templates'")
    .get();
  if (tableExists === undefined) return;
  const rows = db
    .prepare("SELECT id, json FROM event_templates WHERE kind = 'event'")
    .all() as unknown as { id: string; json: string }[];
  for (const row of rows) {
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(row.json) as Record<string, unknown>;
    } catch {
      continue; // unparseable — leave it alone
    }
    if (!('announcements' in parsed)) continue;
    delete parsed.announcements;
    db.prepare('UPDATE event_templates SET json = ? WHERE id = ?').run(JSON.stringify(parsed), row.id);
  }
}

/**
 * Pre-events data gets grouped into an ended "Imported event" per guild so
 * nothing is orphaned.
 */
function backfillLegacyEvents(db: Db): void {
  // Nothing to backfill on a fresh database.
  const participantsTable = db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'participants'")
    .get();
  if (participantsTable === undefined) return;
  const participantCols = db.prepare('PRAGMA table_info(participants)').all() as unknown as { name: string }[];
  if (!participantCols.some((c) => c.name === 'event_id')) return;

  const now = Date.now();
  const guilds = new Set<string>();
  for (const row of db.prepare('SELECT DISTINCT guild_id FROM participants').all() as unknown as { guild_id: string }[]) {
    guilds.add(row.guild_id);
  }
  for (const row of db.prepare('SELECT DISTINCT guild_id FROM teams').all() as unknown as { guild_id: string }[]) {
    guilds.add(row.guild_id);
  }
  for (const guildId of guilds) {
    const id = `ev_legacy_${guildId}`;
    db.prepare(
      `INSERT OR IGNORE INTO events (id, guild_id, name, status, created_at, updated_at)
       VALUES (?, ?, 'Imported event', 'ended', ?, ?)`,
    ).run(id, guildId, now, now);
    db.prepare('UPDATE participants SET event_id = ? WHERE event_id IS NULL AND guild_id = ?').run(id, guildId);
    db.prepare('UPDATE teams SET event_id = ? WHERE event_id IS NULL AND guild_id = ?').run(id, guildId);
  }
  db.prepare(
    `UPDATE team_requests SET event_id = (SELECT event_id FROM teams WHERE teams.id = team_requests.team_id)
     WHERE event_id IS NULL`,
  ).run();
}

/**
 * Participants become per-event: composite PK (event_id, user_id) so the same
 * person can sign up to multiple events.
 */
function addEventColumns(db: Db): void {
  addColumnIfMissing(db, 'events', 'announcement_channel_id', 'TEXT');
}

function recreateParticipantsTable(db: Db): void {
  const participantsTable = db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'participants'")
    .get();
  if (participantsTable === undefined) return; // fresh DB — created with composite PK already

  const cols = db.prepare('PRAGMA table_info(participants)').all() as unknown as { name: string; pk: number }[];
  const isComposite = cols.some((c) => c.name === 'event_id' && c.pk > 0);
  if (isComposite) return;

  db.exec(`
    CREATE TABLE participants_new (
      event_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      guild_id TEXT NOT NULL,
      display_name TEXT NOT NULL,
      experience TEXT NOT NULL,
      role_track TEXT NOT NULL,
      skills TEXT NOT NULL,
      team_pref TEXT NOT NULL,
      teammates TEXT NOT NULL,
      team_id TEXT REFERENCES teams(id) ON DELETE SET NULL,
      status TEXT NOT NULL DEFAULT 'active',
      block_reason TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      PRIMARY KEY (event_id, user_id)
    );
    INSERT INTO participants_new (event_id, user_id, guild_id, display_name, experience, role_track, skills, team_pref, teammates, team_id, status, block_reason, created_at, updated_at)
      SELECT COALESCE(event_id, 'ev_unknown'), user_id, guild_id, display_name, experience, role_track, skills, team_pref, teammates, team_id, status, block_reason, created_at, updated_at
      FROM participants;
    DROP TABLE participants;
    ALTER TABLE participants_new RENAME TO participants;
    CREATE INDEX IF NOT EXISTS idx_participants_team ON participants(team_id);
    CREATE INDEX IF NOT EXISTS idx_participants_event ON participants(event_id, status);
  `);
}

/** Old preference ids → the create/join/random flow. */
function migrateTeamPrefs(db: Db): void {
  const participantsTable = db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'participants'")
    .get();
  if (participantsTable === undefined) return;
  db.exec(`
    UPDATE participants SET team_pref = CASE team_pref
      WHEN 'private_team' THEN 'random_team'
      WHEN 'public_team'  THEN 'join_team'
      WHEN 'with_friends' THEN 'create_team'
      ELSE team_pref
    END;
  `);
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

/** Resolve DB path relative to project root when not absolute. */
export function resolveDbPath(dbPath: string): string {
  if (dbPath === ':memory:' || dbPath.startsWith('/')) return dbPath;
  return join(dirname(fileURLToPath(import.meta.url)), '..', '..', dbPath);
}
