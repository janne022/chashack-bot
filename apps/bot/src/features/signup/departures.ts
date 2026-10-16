import type { Db } from '../../shared/db.js';
import { withGuildContext } from '../../shared/postgres.js';
import { getTeam, leaveTeam, removeFromTeam, type Team } from '../teams/data.js';

/** Confirmed personal departure only; bot uninstall/lookup errors never call this. */
export async function deleteGuildMemberData(db: Db, guildId: string, userId: string, now = Date.now()): Promise<Team[]> {
  return db.transaction(async () => {
    const events = await db.all<{ id: string }>('SELECT id FROM events WHERE guild_id = ? ORDER BY id FOR UPDATE', guildId);
    const deletedTeams: Team[] = [];
    for (const event of events) {
      const result = await leaveTeam(db, 'system:departure', event.id, userId);
      if (result.ok && await getTeam(db, result.value.id) === null) deletedTeams.push(result.value);
      const owned = await db.all<{ id: string }>('SELECT id FROM teams WHERE event_id = ? AND owner_id = ?', event.id, userId);
      for (const team of owned) {
        const removed = await removeFromTeam(db, 'system:departure', team.id, userId);
        if (removed.ok && await getTeam(db, team.id) === null) deletedTeams.push(removed.value);
      }
    }
    await db.run('DELETE FROM registration_answers WHERE user_id = ? AND event_id IN (SELECT id FROM events WHERE guild_id = ?)', userId, guildId);
    await db.run('DELETE FROM team_requests WHERE guild_id = ? AND (target_id = ? OR requester_id IN (?, ?, ?))', guildId, userId, userId, `discord:${userId}`, `web:${userId}`);
    await db.run('DELETE FROM participants WHERE guild_id = ? AND user_id = ?', guildId, userId);

    for (const participant of await db.all<{ event_id: string; user_id: string; teammates: string }>('SELECT event_id,user_id,teammates FROM participants WHERE guild_id = ?', guildId)) {
      const before = JSON.parse(participant.teammates) as string[];
      const after = before.filter((id) => id !== userId);
      if (after.length !== before.length) await db.run('UPDATE participants SET teammates = ? WHERE event_id = ? AND user_id = ?', JSON.stringify(after), participant.event_id, participant.user_id);
    }
    // Audit payloads may embed names/IDs under arbitrary keys: remove the whole
    // matching row, never retain a redacted copy of private answers.
    for (const row of await db.all<{ id: number; actor: string; target: string | null; details: string | null }>('SELECT id,actor,target,details FROM audit_log WHERE guild_id = ?', guildId)) {
      if ([userId, `discord:${userId}`, `web:${userId}`].includes(row.actor) || row.target === userId || (row.details?.includes(userId) ?? false)) await db.run('DELETE FROM audit_log WHERE id = ?', row.id);
    }
    // Organizer sessions contain identifying guild references; revoke only this
    // subject's sessions for this guild, not their participant identity elsewhere.
    await db.run('DELETE FROM web_sessions WHERE user_id = ? AND selected_guild_id = ?', userId, guildId);
    for (const session of await db.all<{ id: string; guild_ids: string }>('SELECT id,guild_ids FROM web_sessions WHERE user_id = ? FOR UPDATE', userId)) {
      const guilds = JSON.parse(session.guild_ids) as { id: string }[];
      await db.run('UPDATE web_sessions SET guild_ids = ? WHERE id = ?', JSON.stringify(guilds.filter((guild) => guild.id !== guildId)), session.id);
    }
    await db.run(`INSERT INTO member_deletions (guild_id,user_id,deleted_at) VALUES (?,?,?)
      ON CONFLICT (guild_id,user_id) DO UPDATE SET deleted_at = GREATEST(member_deletions.deleted_at,EXCLUDED.deleted_at)`, guildId, userId, now);
    return deletedTeams;
  });
}

/** Lookup must return confirmed presence/absence; unavailable lookups are skipped. */
export async function reconcileGuildMembers(db: Db, guildId: string, lookup: (userId: string) => Promise<boolean>, cleanup: (team: Team) => Promise<void> = async () => undefined): Promise<void> {
  const users = await db.all<{ user_id: string }>(`SELECT user_id FROM participants WHERE guild_id = ?
    UNION SELECT user_id FROM registration_answers WHERE event_id IN (SELECT id FROM events WHERE guild_id = ?)`, guildId, guildId);
  for (const { user_id: userId } of users) {
    let present: boolean;
    try { present = await lookup(userId); } catch { continue; }
    if (present !== false) continue;
    for (const team of await deleteGuildMemberData(db, guildId, userId)) await cleanup(team);
  }
}

/** Feed the durable identifier ledger from outside a restored snapshot. */
export async function replayMemberDeletions(db: Db, records: { guildId: string; userId: string; deletedAt: number }[]): Promise<void> {
  for (const record of records) {
    await withGuildContext(db, record.guildId, async () => {
    const freshRegistration = await db.get(`SELECT 1 FROM participants p JOIN events e ON e.id=p.event_id
      WHERE p.guild_id=? AND p.user_id=? AND p.created_at>? LIMIT 1`, record.guildId, record.userId, record.deletedAt);
    if (freshRegistration !== undefined) return;
    await deleteGuildMemberData(db, record.guildId, record.userId, record.deletedAt);
    });
  }
}
