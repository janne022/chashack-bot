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
import { DatabaseSync } from 'node:sqlite';
import { randomBytes } from 'node:crypto';

export type Db = DatabaseSync;

export function openDb(dbPath: string): Db {
  if (dbPath !== ':memory:') {
    mkdirSync(dirname(dbPath), { recursive: true });
  }
  const db = new DatabaseSync(dbPath);
  db.exec('PRAGMA journal_mode = WAL;');
  db.exec('PRAGMA foreign_keys = ON;');
  migrate(db);
  return db;
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
      status TEXT NOT NULL DEFAULT 'draft',
      form_json TEXT,
      panel_channel_id TEXT,
      category_id TEXT,
      cleanup_delay_hours INTEGER NOT NULL DEFAULT 48,
      cleanup_done INTEGER NOT NULL DEFAULT 0,
      cleanup_warned_72h INTEGER NOT NULL DEFAULT 0,
      cleanup_warned_24h INTEGER NOT NULL DEFAULT 0,
      reminded_24h INTEGER NOT NULL DEFAULT 0,
      discord_event_ids TEXT NOT NULL DEFAULT '[]',
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
      updated_at INTEGER NOT NULL
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
  addColumnIfMissing(db, 'teams', 'event_id', 'TEXT');
  addColumnIfMissing(db, 'team_requests', 'event_id', 'TEXT');
  addColumnIfMissing(db, 'participants', 'event_id', 'TEXT');
  addColumnIfMissing(db, 'teams', 'role_id', 'TEXT');
  addColumnIfMissing(db, 'teams', 'text_channel_id', 'TEXT');
  addColumnIfMissing(db, 'teams', 'voice_channel_id', 'TEXT');
  addColumnIfMissing(db, 'teams', 'color', 'TEXT');
  addColumnIfMissing(db, 'events', 'cleanup_warned_72h', 'INTEGER NOT NULL DEFAULT 0');
  addColumnIfMissing(db, 'events', 'cleanup_warned_24h', 'INTEGER NOT NULL DEFAULT 0');

  backfillLegacyEvents(db);
  recreateParticipantsTable(db);
  migrateTeamPrefs(db);
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
