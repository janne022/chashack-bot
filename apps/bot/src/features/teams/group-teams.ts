/**
 * Pre-formed groups from an imported signup sheet.
 *
 * The Hackoween Google Form asks for a group name ("Gruppnamn för dig som
 * anmäler i en färdig grupp"). The people in that group already decided they are
 * a team, so linking one of them to a Discord member should build the team
 * instead of waiting for a manual organizer step. The first person from a group
 * name to arrive creates the team and owns it; everyone else with the same group
 * name joins it.
 *
 * The CSV carries no team id, so the group name is the join key: matched
 * case-insensitively inside one event. A team an organizer named by hand is
 * adopted on purpose — "Group A" is "Group A".
 */
import { newId, newJoinCode, type Db } from '../../shared/db.js';
import { audit } from '../../shared/audit.js';
import { markTeamProvisionPending } from './provision-data.js';

export interface GroupTeamMembership {
  teamId: string;
  teamName: string;
  created: boolean;
}

/** Team names are user text: collapse whitespace and keep the column's budget. */
export function normalizeGroupName(raw: string | null | undefined): string {
  if (typeof raw !== 'string') return '';
  return raw.replace(/\s+/g, ' ').trim().slice(0, 60);
}

/**
 * Put an already-registered participant on their group's team, creating the team
 * when this is the first member to arrive.
 *
 * Runs inside the caller's transaction, which already holds the event row lock,
 * so two simultaneous links cannot both create the same group team.
 */
export async function joinGroupTeam(
  db: Db,
  actor: string,
  eventId: string,
  guildId: string,
  userId: string,
  groupName: string | null | undefined,
): Promise<GroupTeamMembership | null> {
  const name = normalizeGroupName(groupName);
  if (name.length < 2) return null;

  const participant = await db.get<{ team_id: string | null }>(
    'SELECT team_id FROM participants WHERE event_id = ? AND user_id = ?', eventId, userId);
  // A participant who already joined (or was placed on) a team keeps that team.
  if (participant === undefined || participant.team_id !== null) return null;

  const now = Date.now();
  const existing = await db.get<{ id: string; name: string }>(
    'SELECT id, name FROM teams WHERE event_id = ? AND lower(name) = lower(?) ORDER BY created_at, id LIMIT 1 FOR UPDATE',
    eventId, name);

  if (existing !== undefined) {
    await db.run('UPDATE participants SET team_id = ?, updated_at = ? WHERE event_id = ? AND user_id = ?', existing.id, now, eventId, userId);
    await markTeamProvisionPending(db, guildId, eventId, existing.id);
    await audit(db, actor, 'team.join_group', eventId, { teamId: existing.id, userId, groupName: name }, guildId);
    return { teamId: existing.id, teamName: existing.name, created: false };
  }

  const teamId = newId('team');
  await db.run(
    'INSERT INTO teams (id, event_id, guild_id, name, kind, owner_id, join_code, color, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
    teamId, eventId, guildId, name, 'private', userId, newJoinCode(), null, now);
  await db.run('UPDATE participants SET team_id = ?, updated_at = ? WHERE event_id = ? AND user_id = ?', teamId, now, eventId, userId);
  await markTeamProvisionPending(db, guildId, eventId, teamId);
  await audit(db, actor, 'team.create_group', eventId, { teamId, userId, groupName: name }, guildId);
  return { teamId, teamName: name, created: true };
}
