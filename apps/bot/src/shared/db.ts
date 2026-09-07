/**
 * SQLite bootstrap + idempotent migrations via node:sqlite (built into Node 22+).
 * No native deps, nothing to compile.
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

function migrate(db: Db): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS form_config (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      json TEXT NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS participants (
      user_id TEXT PRIMARY KEY,
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
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS teams (
      id TEXT PRIMARY KEY,
      guild_id TEXT NOT NULL,
      name TEXT NOT NULL,
      kind TEXT NOT NULL,
      owner_id TEXT,
      join_code TEXT UNIQUE,
      created_at INTEGER NOT NULL
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
    CREATE INDEX IF NOT EXISTS idx_participants_team ON participants(team_id);
  `);
}

/** Short readable id for teams. */
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
