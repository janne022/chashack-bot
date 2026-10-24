import type { Db } from '../../shared/db.js';
import { audit } from '../../shared/audit.js';
import type { Team } from '../teams/data.js';
import { claimTeamRoleRevocations, completeTeamRoleRevocation, failTeamRoleRevocation, participantStillHasTeamRole, resolveTeamRoleRevocations } from './data.js';

/** Complete the Discord side of a committed departure. A false result is
 * explicit so callers never claim role revocation succeeded when it did not. */
export async function finishParticipantDeparture(
  db: Db,
  guildId: string,
  eventId: string,
  userId: string,
  oldTeam: Team | null,
  revokeRole: (team: Team, userId: string) => Promise<void>,
): Promise<boolean> {
  if (oldTeam === null || oldTeam.roleId === null) return true;
  if (await participantStillHasTeamRole(db, eventId, guildId, userId, oldTeam.id, oldTeam.roleId)) {
    await resolveTeamRoleRevocations(db, eventId, guildId, userId, oldTeam.id, oldTeam.roleId, 'superseded');
    await audit(db, 'system', 'participant.team_role_revoke_superseded', eventId, { userId, teamId: oldTeam.id, roleId: oldTeam.roleId }, guildId);
    return true;
  }
  try { await revokeRole(oldTeam, userId); }
  catch {
    try {
      await audit(db, 'system', 'participant.team_role_revoke_failed', eventId, {
        userId, teamId: oldTeam.id, roleId: oldTeam.roleId, error: 'discord_api_failure',
      }, guildId);
    } catch { /* The transactional outbox remains the durable failure record. */ }
    return false;
  }
  await resolveTeamRoleRevocations(db, eventId, guildId, userId, oldTeam.id, oldTeam.roleId, 'complete');
  await audit(db, 'system', 'participant.team_role_revoked', eventId, { userId, teamId: oldTeam.id, roleId: oldTeam.roleId }, guildId);
  return true;
}

/** Retry bounded, tenant-scoped outbox rows. The callback receives only guild,
 * user, and role identifiers captured before team cleanup. */
export async function retryFailedParticipantRoleRevocations(
  db: Db,
  guildId: string,
  revoke: (guildId: string, userId: string, roleId: string) => Promise<void>,
): Promise<{ attempted: number; succeeded: number }> {
  const pending = await claimTeamRoleRevocations(db, guildId);
  let attempted = 0;
  let succeeded = 0;
  for (const item of pending) {
    attempted++;
    try {
      if (await participantStillHasTeamRole(db, item.eventId, item.guildId, item.userId, item.teamId, item.roleId)) {
        await audit(db, 'system', 'participant.team_role_revoke_superseded', item.eventId, { userId: item.userId, teamId: item.teamId, roleId: item.roleId }, item.guildId);
        await completeTeamRoleRevocation(db, item.id, item.guildId, 'superseded');
        succeeded++;
        continue;
      }
      await revoke(item.guildId, item.userId, item.roleId);
      await audit(db, 'system', 'participant.team_role_revoked', item.eventId, { userId: item.userId, teamId: item.teamId, roleId: item.roleId, retried: true }, item.guildId);
      await completeTeamRoleRevocation(db, item.id, item.guildId, 'complete');
      succeeded++;
    } catch (error) {
      await audit(db, 'system', 'participant.team_role_revoke_failed', item.eventId, {
        userId: item.userId, teamId: item.teamId, roleId: item.roleId, error: 'discord_api_failure',
      }, item.guildId);
      await failTeamRoleRevocation(db, item.id, item.guildId, item.attemptCount);
    }
  }
  return { attempted, succeeded };
}
