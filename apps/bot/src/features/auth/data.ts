/**
 * Console sessions: the identity behind a `hacksess` cookie.
 *
 * The row (not the cookie) is the source of truth for what a Discord session may
 * do: which guilds the person administers and which one they are currently
 * managing. Logout deletes the row, so a stolen cookie dies with it.
 */
import { randomBytes } from 'node:crypto';
import type { Db } from '../../shared/db.js';
import type { ManageableGuild } from './domain.js';
import { SESSION_TTL_MS } from './domain.js';

export interface WebSession {
  id: string;
  userId: string;
  username: string;
  avatar: string | null;
  guilds: ManageableGuild[];
  selectedGuildId: string | null;
  createdAt: number;
  expiresAt: number;
}

interface Row {
  id: string;
  user_id: string;
  username: string;
  avatar: string | null;
  guild_ids: string;
  selected_guild_id: string | null;
  created_at: number;
  expires_at: number;
}

function toSession(row: Row): WebSession {
  let guilds: ManageableGuild[] = [];
  try {
    const parsed = JSON.parse(row.guild_ids) as unknown;
    if (Array.isArray(parsed)) guilds = parsed as ManageableGuild[];
  } catch {
    guilds = [];
  }
  return {
    id: row.id,
    userId: row.user_id,
    username: row.username,
    avatar: row.avatar,
    guilds,
    selectedGuildId: row.selected_guild_id,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
  };
}

export async function createSession(
  db: Db,
  input: { userId: string; username: string; avatar: string | null; guilds: ManageableGuild[]; now?: number },
): Promise<WebSession> {
  const now = input.now ?? Date.now();
  const id = randomBytes(16).toString('hex');
  const selected = input.guilds[0]?.id ?? null;
  await db.run(
    `INSERT INTO web_sessions (id, user_id, username, avatar, guild_ids, selected_guild_id, created_at, expires_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    id,
    input.userId,
    input.username,
    input.avatar,
    JSON.stringify(input.guilds),
    selected,
    now,
    now + SESSION_TTL_MS,
  );
  return toSession({
    id,
    user_id: input.userId,
    username: input.username,
    avatar: input.avatar,
    guild_ids: JSON.stringify(input.guilds),
    selected_guild_id: selected,
    created_at: now,
    expires_at: now + SESSION_TTL_MS,
  });
}

/**
 * Single atomic step: read the session, delete it when expired, return it when
 * live. In the synchronous code the expiry check and the DELETE were implicitly
 * serialised; the transaction keeps that guarantee now that awaits interleave.
 */
export async function getSession(db: Db, id: string, now: number = Date.now()): Promise<WebSession | null> {
  return db.transaction(async () => {
    const row = await db.get<Row>('SELECT * FROM web_sessions WHERE id = ?', id);
    if (row === undefined) return null;
    if (row.expires_at < now) {
      await db.run('DELETE FROM web_sessions WHERE id = ?', id);
      return null;
    }
    return toSession(row);
  });
}

export async function deleteSession(db: Db, id: string): Promise<void> {
  await db.run('DELETE FROM web_sessions WHERE id = ?', id);
}

/**
 * Switch the guild a session is managing. Returns false when the session may not
 * manage that guild — the authorisation check lives here so no route can forget
 * it.
 */
export async function selectGuild(db: Db, id: string, guildId: string): Promise<boolean> {
  return db.transaction(async () => {
    const session = await getSession(db, id);
    if (session === null) return false;
    if (!session.guilds.some((g) => g.id === guildId)) return false;
    await db.run('UPDATE web_sessions SET selected_guild_id = ? WHERE id = ?', guildId, id);
    return true;
  });
}

/** Drop expired rows — called on boot and on login so the table can't grow. */
export async function purgeExpiredSessions(db: Db, now: number = Date.now()): Promise<number> {
  const res = await db.run('DELETE FROM web_sessions WHERE expires_at < ?', now);
  return Number(res.changes);
}
