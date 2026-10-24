/**
 * Participants: signed-up users per event, their form answers, status, blocking.
 * Composite identity: (event_id, user_id).
 */
import type { Db } from '../../shared/db.js';
import { audit } from '../../shared/audit.js';
import { err, ok, type Result } from '../../shared/result.js';
import { validateCustomAnswers, type ValidatedSignup } from '../form/domain.js';
import { getEvent, getEventForm } from '../events/data.js';
import { getForm } from '../form/data.js';
import { deleteRegistrationAnswers, getRegistrationAnswers } from '../registration/data.js';
import { projectMatchingParticipant } from '../matching/domain.js';
import { isCurrentMember } from './eligibility.js';
import { getTeam, removeFromTeam, type Team } from '../teams/data.js';
import { signupAdmission } from './domain.js';

export interface PendingTeamRoleRevocation {
  id: number;
  guildId: string;
  eventId: string;
  userId: string;
  teamId: string;
  roleId: string;
  attemptCount: number;
}

/** Claim at most limit due rows; abandoned claims become eligible after lease expiry. */
export async function claimTeamRoleRevocations(db: Db, guildId: string, now = Date.now(), limit = 100): Promise<PendingTeamRoleRevocation[]> {
  return db.transaction(async () => {
    const rows = await db.all<{ id: number; guild_id: string; event_id: string; user_id: string; team_id: string; role_id: string; attempt_count: number }>(
      `SELECT id,guild_id,event_id,user_id,team_id,role_id,attempt_count FROM team_role_revocations
       WHERE guild_id=? AND next_attempt_at<=? AND (status='pending' OR (status='processing' AND lease_until<=?))
       ORDER BY id LIMIT ? FOR UPDATE SKIP LOCKED`, guildId, now, now, Math.min(Math.max(limit, 1), 100),
    );
    const claimed: PendingTeamRoleRevocation[] = [];
    for (const row of rows) {
      await db.run(`UPDATE team_role_revocations SET status='processing',attempt_count=attempt_count+1,lease_until=?,updated_at=? WHERE id=? AND guild_id=?`, now + 120_000, now, row.id, guildId);
      claimed.push({ id: row.id, guildId: row.guild_id, eventId: row.event_id, userId: row.user_id, teamId: row.team_id, roleId: row.role_id, attemptCount: row.attempt_count + 1 });
    }
    return claimed;
  });
}

export async function completeTeamRoleRevocation(db: Db, id: number, guildId: string, status: 'complete' | 'superseded'): Promise<void> {
  await db.run("UPDATE team_role_revocations SET status=?,lease_until=0,last_error_code=NULL,updated_at=? WHERE id=? AND guild_id=? AND status='processing'", status, Date.now(), id, guildId);
}

export async function resolveTeamRoleRevocations(db: Db, eventId: string, guildId: string, userId: string, teamId: string, roleId: string, status: 'complete' | 'superseded'): Promise<void> {
  await db.run("UPDATE team_role_revocations SET status=?,lease_until=0,last_error_code=NULL,updated_at=? WHERE event_id=? AND guild_id=? AND user_id=? AND team_id=? AND role_id=? AND status IN ('pending','processing')", status, Date.now(), eventId, guildId, userId, teamId, roleId);
}

export async function failTeamRoleRevocation(db: Db, id: number, guildId: string, attemptCount: number): Promise<void> {
  const now = Date.now();
  const delay = Math.min(60 * 60 * 1000, 30_000 * (2 ** Math.min(Math.max(attemptCount - 1, 0), 7)));
  await db.run("UPDATE team_role_revocations SET status='pending',next_attempt_at=?,lease_until=0,last_error_code='discord_api_failure',updated_at=? WHERE id=? AND guild_id=? AND status='processing'", now + delay, now, id, guildId);
}

/** Retain resolved outbox identifiers for 30 days, pruning at most 500 per pass. */
export async function pruneResolvedTeamRoleRevocations(db: Db, guildId: string, now = Date.now()): Promise<number> {
  const cutoff = now - 30 * 24 * 60 * 60 * 1000;
  const result = await db.run(`DELETE FROM team_role_revocations WHERE id IN (
    SELECT id FROM team_role_revocations WHERE guild_id=? AND status IN ('complete','superseded') AND updated_at<? ORDER BY id LIMIT 500
  )`, guildId, cutoff);
  return Number(result.changes);
}

/** Return true only while this active participant still has the original team assignment. */
export async function participantStillHasTeamRole(db: Db, eventId: string, guildId: string, userId: string, teamId: string, roleId: string): Promise<boolean> {
  const current = await db.get<{ status: string; team_id: string | null }>(
    'SELECT status,team_id FROM participants WHERE event_id=? AND user_id=? AND guild_id=?', eventId, userId, guildId,
  );
  if (current?.status !== 'active' || current.team_id !== teamId) return false;
  return (await db.get<{ role_id: string | null }>('SELECT role_id FROM teams WHERE id=? AND event_id=? AND guild_id=?', teamId, eventId, guildId))?.role_id === roleId;
}

export type ParticipantStatus = 'active' | 'blocked' | 'withdrawn';

export interface Participant {
  eventId: string;
  userId: string;
  guildId: string;
  displayName: string;
  experience: string;
  roleTrack: string;
  skills: string[];
  teamPref: string;
  /** Discord user IDs of friends they signed up with. */
  teammates: string[];
  teamId: string | null;
  status: ParticipantStatus;
  blockReason: string | null;
  createdAt: number;
  updatedAt: number;
  matchingImportance?: Partial<Record<'experience' | 'role' | 'skills', number>>;
}

interface ParticipantRow {
  event_id: string;
  user_id: string;
  guild_id: string;
  display_name: string;
  experience: string;
  role_track: string;
  skills: string;
  team_pref: string;
  teammates: string;
  team_id: string | null;
  status: string;
  block_reason: string | null;
  created_at: number;
  updated_at: number;
}

function toParticipant(row: ParticipantRow): Participant {
  return {
    eventId: row.event_id,
    userId: row.user_id,
    guildId: row.guild_id,
    displayName: row.display_name,
    experience: row.experience,
    roleTrack: row.role_track,
    skills: JSON.parse(row.skills) as string[],
    teamPref: row.team_pref,
    teammates: row.teammates === '' ? [] : (JSON.parse(row.teammates) as string[]),
    teamId: row.team_id,
    status: row.status as ParticipantStatus,
    blockReason: row.block_reason,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function upsertParticipant(
  db: Db,
  actor: string,
  eventId: string,
  guildId: string,
  userId: string,
  signup: ValidatedSignup,
): Promise<Result<Participant>> {
  return db.transaction(async () => {
    // Data-layer gate: never write signups for events that are not active
    // (defense in depth — the interaction layer also gates, but a modal can
    // stay open across an event transition).
    const eventRow = await db.get<{ status: string; signup_starts_at: number | null; signup_ends_at: number | null }>('SELECT status, signup_starts_at, signup_ends_at FROM events WHERE id = ? FOR UPDATE', eventId);
    if (eventRow === undefined) {
      return err('no_event', 'This signup has no active event behind it. An organizer must activate an event first.');
    }
    if (eventRow.status !== 'active') {
      return err('event_not_active', 'This hackathon is not accepting signups right now.');
    }

    const blocked = await db.get<{ status: string; block_reason: string | null }>(
      'SELECT status, block_reason FROM participants WHERE event_id = ? AND user_id = ?',
      eventId,
      userId,
    );
    if (blocked !== undefined && blocked.status === 'blocked') {
      return err('blocked', 'You are blocked from signing up. Contact an organizer.');
    }
    const admission = signupAdmission({ signupStartsAt: eventRow.signup_starts_at, signupEndsAt: eventRow.signup_ends_at }, blocked?.status === 'active' ? 'active' : blocked?.status === 'withdrawn' ? 'withdrawn' : null, Date.now());
    if (admission === 'signup_not_open') return err('signup_not_open', 'Signups have not opened yet.');
    if (admission === 'signup_closed') return err('signup_closed', 'Signups are closed.');

    const now = Date.now();
    await db.run(
      `INSERT INTO participants
         (event_id, user_id, guild_id, display_name, experience, role_track, skills, team_pref, teammates, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?)
       ON CONFLICT(event_id, user_id) DO UPDATE SET
         display_name = excluded.display_name,
         experience = excluded.experience,
         role_track = excluded.role_track,
         skills = excluded.skills,
         team_pref = excluded.team_pref,
         teammates = excluded.teammates,
         status = 'active',
         updated_at = excluded.updated_at`,
      eventId,
      userId,
      guildId,
      signup.displayName,
      signup.experience,
      signup.roleTrack,
      JSON.stringify(signup.skills),
      signup.teamPref,
      JSON.stringify([]),
      now,
      now,
    );
    await audit(db, actor, 'participant.upsert', eventId, { userId, displayName: signup.displayName, teamPref: signup.teamPref }, guildId);
    const created = await getParticipant(db, eventId, userId);
    return ok(created!);
  });
}

export async function getParticipant(db: Db, eventId: string, userId: string): Promise<Participant | null> {
  const row = await db.get<ParticipantRow>('SELECT * FROM participants WHERE event_id = ? AND user_id = ?', eventId, userId);
  return row === undefined ? null : toParticipant(row);
}

export async function listParticipants(db: Db, eventId: string, status?: ParticipantStatus): Promise<Participant[]> {
  const rows =
    status === undefined
      ? await db.all<ParticipantRow>('SELECT * FROM participants WHERE event_id = ? ORDER BY created_at', eventId)
      : await db.all<ParticipantRow>('SELECT * FROM participants WHERE event_id = ? AND status = ? ORDER BY created_at', eventId, status);
  return rows.map(toParticipant);
}

/** Matchable: active, not already on a team, and opted into random matching. */
export async function listMatchable(db: Db, eventId: string): Promise<Participant[]> {
  const rows = await db.all<ParticipantRow>(
    `SELECT * FROM participants
       WHERE event_id = ? AND status = 'active' AND team_id IS NULL AND team_pref = 'random_team' ORDER BY user_id`,
    eventId,
  );
  const event = await getEvent(db, eventId);
  if (event === null || event.status !== 'active') return [];
  const form = getEventForm(db, event, await getForm(db, event.guildId));
  const eligible: Participant[] = [];
  for (const row of rows) {
    if (row.guild_id !== event.guildId || !(await isCurrentMember(db, event.guildId, row.user_id))) continue;
    const projected = await projectParticipantForMatching(db, toParticipant(row), form);
    if (projected !== null) eligible.push(projected);
  }
  return eligible;
}

export async function projectParticipantForMatching(db: Db, participant: Participant, form: import('../form/domain.js').FormConfig): Promise<Participant | null> {
  const stored = await getRegistrationAnswers(db, participant.eventId, participant.userId);
  if ((form.customQuestions ?? []).some((q) => q.required && q.visibility !== 'organizer_only') && stored?.formVersion !== form.version) return null;
  const answers = stored?.formVersion === form.version ? stored.answers : {};
  const checked = validateCustomAnswers(form, answers);
  if (!checked.ok || checked.missingRequiredQuestionIds.length > 0) return null;
  return projectMatchingParticipant(participant, form, checked.answers);
}

export async function setTeammates(db: Db, actor: string, eventId: string, userId: string, teammateIds: string[]): Promise<Result<Participant>> {
  return db.transaction(async () => {
  await db.get('SELECT id FROM events WHERE id = ? FOR UPDATE', eventId);
  const participant = await getParticipant(db, eventId, userId);
  if (participant === null) return err('not_found', 'Sign up first with /hackathon join.');
  const clean = [...new Set(teammateIds.map((id) => id.trim()).filter((id) => /^\d{5,25}$/.test(id)))].slice(0, 10);
  await db.run('UPDATE participants SET teammates = ?, updated_at = ? WHERE event_id = ? AND user_id = ?', JSON.stringify(clean), Date.now(), eventId, userId);
  await audit(db, actor, 'participant.teammates', eventId, { userId, count: clean.length }, participant.guildId);
  return ok((await getParticipant(db, eventId, userId))!);
  });
}

export async function blockParticipant(db: Db, actor: string, eventId: string, userId: string, reason: string): Promise<Result<Team | null>> {
  return db.transaction(async () => {
  const event = await db.get<{ guild_id: string }>('SELECT guild_id FROM events WHERE id = ? FOR UPDATE', eventId);
  if (event === undefined) return err('not_found', 'Event not found.');
  const participant = await db.get<{ team_id: string | null }>('SELECT team_id FROM participants WHERE event_id = ? AND user_id = ? FOR UPDATE', eventId, userId);
  if (participant === undefined) return err('not_found', 'Participant not found in this event.');
  const oldTeam = participant.team_id === null ? null : await getTeam(db, participant.team_id);
  if (participant.team_id !== null && (oldTeam === null || oldTeam.eventId !== eventId || oldTeam.guildId !== event.guild_id)) return err('not_found', 'Participant team not found in this event.');
  const detached = participant.team_id === null ? null : await removeFromTeam(db, actor, participant.team_id, userId);
  if (detached !== null && !detached.ok) return detached;
  const res = await db.run(
    "UPDATE participants SET status = 'blocked', block_reason = ?, updated_at = ? WHERE event_id = ? AND user_id = ?",
    reason.trim().slice(0, 200) || 'No reason given',
    Date.now(),
    eventId,
    userId,
  );
  if (res.changes === 0) return err('not_found', 'Participant not found in this event.');
  await audit(db, actor, 'participant.block', eventId, { userId, reason }, event.guild_id);
  return ok(oldTeam);
  });
}

export async function unblockParticipant(db: Db, actor: string, eventId: string, userId: string): Promise<Result<void>> {
  return db.transaction(async () => {
  const event = await db.get<{ guild_id: string }>('SELECT guild_id FROM events WHERE id = ? FOR UPDATE', eventId);
  if (event === undefined) return err('not_found', 'Event not found.');
  const res = await db.run(
    "UPDATE participants SET status = 'active', block_reason = NULL, updated_at = ? WHERE event_id = ? AND user_id = ? AND status = 'blocked'",
    Date.now(),
    eventId,
    userId,
  );
  if (res.changes === 0) return err('not_found', 'No blocked participant with that ID in this event.');
  await audit(db, actor, 'participant.unblock', eventId, { userId }, event.guild_id);
  return ok(undefined);
  });
}

export async function reactivateParticipant(db: Db, actor: string, eventId: string, userId: string): Promise<Result<void>> {
  return db.transaction(async () => {
  await db.get('SELECT id FROM events WHERE id = ? FOR UPDATE', eventId);
  const p = await getParticipant(db, eventId, userId);
  if (p === null) return err('not_found', 'Participant not found.');
  await db.run("UPDATE participants SET status = 'active', block_reason = NULL, updated_at = ? WHERE event_id = ? AND user_id = ?", Date.now(), eventId, userId);
  await audit(db, actor, 'participant.reactivate', eventId, { userId }, p.guildId);
  return ok(undefined);
  });
}

export async function listTeamRoster(db: Db, teamId: string): Promise<{ userId: string; displayName: string }[]> {
  return (await db.all<{ user_id: string; display_name: string }>("SELECT user_id, display_name FROM participants WHERE team_id = ? AND status = 'active' ORDER BY created_at", teamId)).map((r) => ({ userId: r.user_id, displayName: r.display_name }));
}

export async function withdrawParticipant(db: Db, actor: string, eventId: string, userId: string): Promise<Result<Team | null>> {
  return db.transaction(async () => {
    const event = await db.get<{ guild_id: string }>('SELECT guild_id FROM events WHERE id = ? FOR UPDATE', eventId);
    if (event === undefined) return err('not_found', 'Event not found.');
    const participant = await db.get<{ team_id: string | null }>("SELECT team_id FROM participants WHERE event_id = ? AND user_id = ? AND status = 'active' FOR UPDATE", eventId, userId);
    if (participant === undefined) return err('not_found', 'No active signup found in this event.');
    const oldTeam = participant.team_id === null ? null : await getTeam(db, participant.team_id);
    if (participant.team_id !== null && (oldTeam === null || oldTeam.eventId !== eventId || oldTeam.guildId !== event.guild_id)) return err('not_found', 'Participant team not found in this event.');
    const detached = participant.team_id === null ? null : await removeFromTeam(db, actor, participant.team_id, userId);
    if (detached !== null && !detached.ok) return detached;
    const res = await db.run(
      "UPDATE participants SET status = 'withdrawn', updated_at = ? WHERE event_id = ? AND user_id = ? AND status = 'active'",
      Date.now(), eventId, userId,
    );
    if (res.changes === 0) return err('not_found', 'No active signup found in this event.');
    await deleteRegistrationAnswers(db, eventId, userId);
    await audit(db, actor, 'participant.withdraw', eventId, { userId }, event.guild_id);
    return ok(oldTeam);
  });
}

/** Purge participants of an event (event reset). */
export async function purgeEventParticipants(db: Db, actor: string, eventId: string): Promise<number> {
  return db.transaction(async () => {
    const event = await db.get<{ guild_id: string }>('SELECT guild_id FROM events WHERE id = ?', eventId);
    if (event === undefined) return 0;
    const row = await db.get<{ n: number }>('SELECT COUNT(*) AS n FROM participants WHERE event_id = ?', eventId);
    const count = row?.n ?? 0;
    await db.run('DELETE FROM registration_answers WHERE event_id = ?', eventId);
    await db.run('DELETE FROM participants WHERE event_id = ?', eventId);
    if (count > 0) await audit(db, actor, 'participant.purge', eventId, { count }, event.guild_id);
    return count;
  });
}
