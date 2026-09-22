/**
 * Participants: signed-up users per event, their form answers, status, blocking.
 * Composite identity: (event_id, user_id).
 */
import type { Db } from '../../shared/db.js';
import { audit } from '../../shared/audit.js';
import { err, ok, type Result } from '../../shared/result.js';
import type { ValidatedSignup } from '../form/domain.js';

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
    const eventRow = await db.get<{ status: string }>('SELECT status FROM events WHERE id = ?', eventId);
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
    await audit(db, actor, 'participant.upsert', eventId, { userId, displayName: signup.displayName, teamPref: signup.teamPref });
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
       WHERE event_id = ? AND status = 'active' AND team_id IS NULL AND team_pref = 'random_team'`,
    eventId,
  );
  return rows.map(toParticipant);
}

export async function setTeammates(db: Db, actor: string, eventId: string, userId: string, teammateIds: string[]): Promise<Result<Participant>> {
  const participant = await getParticipant(db, eventId, userId);
  if (participant === null) return err('not_found', 'Sign up first with /hackathon join.');
  const clean = [...new Set(teammateIds.map((id) => id.trim()).filter((id) => /^\d{5,25}$/.test(id)))].slice(0, 10);
  await db.run('UPDATE participants SET teammates = ?, updated_at = ? WHERE event_id = ? AND user_id = ?', JSON.stringify(clean), Date.now(), eventId, userId);
  await audit(db, actor, 'participant.teammates', eventId, { userId, count: clean.length });
  return ok((await getParticipant(db, eventId, userId))!);
}

export async function blockParticipant(db: Db, actor: string, eventId: string, userId: string, reason: string): Promise<Result<void>> {
  const res = await db.run(
    "UPDATE participants SET status = 'blocked', block_reason = ?, team_id = NULL, updated_at = ? WHERE event_id = ? AND user_id = ?",
    reason.trim().slice(0, 200) || 'No reason given',
    Date.now(),
    eventId,
    userId,
  );
  if (res.changes === 0) return err('not_found', 'Participant not found in this event.');
  await audit(db, actor, 'participant.block', eventId, { userId, reason });
  return ok(undefined);
}

export async function unblockParticipant(db: Db, actor: string, eventId: string, userId: string): Promise<Result<void>> {
  const res = await db.run(
    "UPDATE participants SET status = 'active', block_reason = NULL, updated_at = ? WHERE event_id = ? AND user_id = ? AND status = 'blocked'",
    Date.now(),
    eventId,
    userId,
  );
  if (res.changes === 0) return err('not_found', 'No blocked participant with that ID in this event.');
  await audit(db, actor, 'participant.unblock', eventId, { userId });
  return ok(undefined);
}

export async function withdrawParticipant(db: Db, actor: string, eventId: string, userId: string): Promise<Result<void>> {
  const res = await db.run(
    "UPDATE participants SET status = 'withdrawn', team_id = NULL, updated_at = ? WHERE event_id = ? AND user_id = ? AND status = 'active'",
    Date.now(),
    eventId,
    userId,
  );
  if (res.changes === 0) return err('not_found', 'No active signup found in this event.');
  await audit(db, actor, 'participant.withdraw', eventId, { userId });
  return ok(undefined);
}

/** Purge participants of an event (event reset). */
export async function purgeEventParticipants(db: Db, actor: string, eventId: string): Promise<number> {
  return db.transaction(async () => {
    const row = await db.get<{ n: number }>('SELECT COUNT(*) AS n FROM participants WHERE event_id = ?', eventId);
    const count = row?.n ?? 0;
    await db.run('DELETE FROM participants WHERE event_id = ?', eventId);
    await audit(db, actor, 'participant.purge', eventId, { count });
    return count;
  });
}
