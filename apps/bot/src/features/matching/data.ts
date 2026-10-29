/**
 * Matching service: preview (no writes) and commit (write matched teams).
 * Existing formed teams are never rebuilt by a later match.
 */
import type { Db } from '../../shared/db.js';
import { newId } from '../../shared/db.js';
import { audit } from '../../shared/audit.js';
import { err, ok, type Result } from '../../shared/result.js';
import type { FormConfig } from '../form/domain.js';
import { getParticipant, listMatchable, projectParticipantForMatching } from '../signup/data.js';
import { getEvent, getEventForm } from '../events/data.js';
import { getForm } from '../form/data.js';
import { assignMissingMatchedOwners, listTeams, lockEventTeams, nextTeamColor, type TeamWithMembers } from '../teams/data.js';
import { markTeamProvisionPending } from '../teams/provision-data.js';
import { buildTeams, type MatchResult } from './domain.js';
import { createHash } from 'node:crypto';

/** Teams for an event with their active members — input for placement suggestions. */
export async function listTeamsWithMembers(db: Db, eventId: string, config?: FormConfig): Promise<TeamWithMembers[]> {
  const teams = await listTeams(db, eventId);
  if (config === undefined) return teams;
  return Promise.all(teams.map(async (team) => ({
    ...team,
    members: (await Promise.all(team.members.map(async (member) => {
    const participant = await getParticipant(db, eventId, member.userId);
    const projected = participant === null ? null : await projectParticipantForMatching(db, participant, config);
    if (projected === null) return null;
    return { ...member, experience: projected.experience, roleTrack: projected.roleTrack, skills: projected.skills, ...(projected.matchingImportance ? { matchingImportance: projected.matchingImportance } : {}) };
    }))).filter((member): member is NonNullable<typeof member> => member !== null),
  })));
}

export async function previewMatch(db: Db, eventId: string, config: FormConfig): Promise<Result<MatchResult>> {
  const participants = await listMatchable(db, eventId);
  if (participants.length < 2) return err('not_enough', 'Need at least 2 unteamed participants opted into random matching.');
  const event = await getEvent(db, eventId);
  const pinnedForm = event === null ? config : getEventForm(db, event, await getForm(db, event.guildId));
  const formed = (await listTeams(db, eventId)).map((team) => ({ id: team.id, members: team.members.map((member) => member.userId).sort() })).sort((a, b) => a.id.localeCompare(b.id));
  const inputs = participants.map(({ userId, experience, roleTrack, skills, teammates, matchingImportance, createdAt }) => ({ userId, experience, roleTrack, skills, teammates, matchingImportance, createdAt })).sort((a, b) => a.userId.localeCompare(b.userId));
  const revision = createHash('sha256').update(JSON.stringify([eventId, pinnedForm, inputs, formed])).digest('hex');
  return ok({ ...buildTeams(participants, pinnedForm), revision });
}

export async function commitMatch(db: Db, actor: string, eventId: string, guildId: string, config: FormConfig, expectedRevision?: string): Promise<Result<MatchResult>> {
  // The whole clear → insert → assign sequence was implicitly atomic when this
  // module was synchronous: an interleaved join/leave could desync the member
  // updates (participant assigned to a matched team id that the next
  // statement deletes). The event row lock serializes pooled mutations.
  return db.transaction(async () => {
    if (!(await lockEventTeams(db, eventId))) return err('not_found', 'Event not found in this guild.');
    const event = await db.get<{ guild_id: string }>('SELECT guild_id FROM events WHERE id = ?', eventId);
    if (event === undefined || event.guild_id !== guildId) return err('not_found', 'Event not found in this guild.');
    const preview = await previewMatch(db, eventId, config);
    if (expectedRevision !== undefined && (!preview.ok || preview.value.revision !== expectedRevision)) return err('stale_preview', 'The preview changed. Preview again before committing.');
    if (!preview.ok) return preview;

    // Create the new matched teams and assign members. Event-scoped on purpose:
    // the row carries event_id and the member update is filtered by it, so a match
    // in one event can never hijack that user's team in another.
    for (const team of preview.value.teams) {
      const id = newId('team');
      const color = await nextTeamColor(db, eventId);
      await db.run(
        "INSERT INTO teams (id, event_id, guild_id, name, kind, owner_id, join_code, color, created_at) VALUES (?, ?, ?, ?, 'matched', NULL, NULL, ?, ?)",
        id,
        eventId,
        guildId,
        team.name,
        color,
        Date.now(),
      );
      await markTeamProvisionPending(db, guildId, eventId, id);
      for (const userId of team.memberIds) {
        await db.run('UPDATE participants SET team_id = ?, updated_at = ? WHERE event_id = ? AND user_id = ?', id, Date.now(), eventId, userId);
      }
    }

    await assignMissingMatchedOwners(db, eventId);

    await db.run(
      'INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
      `last_match:${eventId}`,
      JSON.stringify({ at: Date.now(), teams: preview.value.teams.length }),
    );
    await audit(db, actor, 'match.commit', eventId, { teams: preview.value.teams.length }, event.guild_id);

    return ok(preview.value);
  });
}

export async function lastMatchInfo(db: Db, eventId: string): Promise<{ at: number; teams: number } | null> {
  const row = await db.get<{ value: string }>('SELECT value FROM meta WHERE key = ?', `last_match:${eventId}`);
  if (row === undefined) return null;
  try {
    return JSON.parse(row.value) as { at: number; teams: number };
  } catch {
    return null;
  }
}
