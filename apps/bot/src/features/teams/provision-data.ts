import type { Db } from '../../shared/db.js';
import { randomUUID } from 'node:crypto';

/** A marker exists only for teams whose provisioning has been requested. */
const key = (guildId: string, eventId: string, teamId: string) => `team_provision:${guildId}:${eventId}:${teamId}`;

export async function markTeamProvisionPending(db: Db, guildId: string, eventId: string, teamId: string): Promise<string> {
  const revision = randomUUID();
  await db.run('INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', key(guildId, eventId, teamId), revision);
  return revision;
}

export async function clearTeamProvisionPending(db: Db, guildId: string, eventId: string, teamId: string): Promise<void> {
  await db.run('DELETE FROM meta WHERE key = ?', key(guildId, eventId, teamId));
}

/** Do not clear work requested after the reconciliation pass began. */
export async function clearTeamProvisionRevision(db: Db, guildId: string, eventId: string, teamId: string, revision: string): Promise<void> {
  await db.run('DELETE FROM meta WHERE key = ? AND value = ?', key(guildId, eventId, teamId), revision);
}

/** The join through RLS-protected teams limits recovery to the caller's event. */
export async function listPendingTeamProvisionIds(db: Db, eventId: string): Promise<string[]> {
  const rows = await db.all<{ id: string }>(`SELECT t.id FROM teams t JOIN meta m
    ON m.key = 'team_provision:' || t.guild_id || ':' || t.event_id || ':' || t.id
    WHERE t.event_id = ? ORDER BY t.created_at, t.id`, eventId);
  return rows.map(row => row.id);
}

export async function clearEventTeamProvisionMarkers(db: Db, eventId: string): Promise<void> {
  await db.run(`DELETE FROM meta WHERE key IN (SELECT 'team_provision:' || guild_id || ':' || event_id || ':' || id
    FROM teams WHERE event_id = ?)`, eventId);
}
