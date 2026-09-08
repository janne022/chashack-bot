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

export function upsertParticipant(
  db: Db,
  actor: string,
  eventId: string,
  guildId: string,
  userId: string,
  signup: ValidatedSignup,
): Result<Participant> {
  // Data-layer gate: never write signups for events that are not active
  // (defense in depth — the interaction layer also gates, but a modal can
  // stay open across an event transition).
  const eventRow = db.prepare('SELECT status FROM events WHERE id = ?').get(eventId) as
    | { status: string }
    | undefined;
  if (eventRow === undefined) {
    return err('no_event', 'This signup has no active event behind it. An organizer must activate an event first.');
  }
  if (eventRow.status !== 'active') {
    return err('event_not_active', 'This hackathon is not accepting signups right now.');
  }

  const blocked = db
    .prepare('SELECT status, block_reason FROM participants WHERE event_id = ? AND user_id = ?')
    .get(eventId, userId) as { status: string; block_reason: string | null } | undefined;
  if (blocked !== undefined && blocked.status === 'blocked') {
    return err('blocked', 'You are blocked from signing up. Contact an organizer.');
  }

  const now = Date.now();
  db.prepare(
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
  ).run(
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
  audit(db, actor, 'participant.upsert', eventId, { userId, displayName: signup.displayName, teamPref: signup.teamPref });
  return ok(getParticipant(db, eventId, userId)!);
}

export function getParticipant(db: Db, eventId: string, userId: string): Participant | null {
  const row = db
    .prepare('SELECT * FROM participants WHERE event_id = ? AND user_id = ?')
    .get(eventId, userId) as unknown as ParticipantRow | undefined;
  return row === undefined ? null : toParticipant(row);
}

export function listParticipants(db: Db, eventId: string, status?: ParticipantStatus): Participant[] {
  const rows = (
    status === undefined
      ? (db.prepare('SELECT * FROM participants WHERE event_id = ? ORDER BY created_at').all(eventId) as unknown as ParticipantRow[])
      : (db.prepare('SELECT * FROM participants WHERE event_id = ? AND status = ? ORDER BY created_at').all(eventId, status) as unknown as ParticipantRow[])
  );
  return rows.map(toParticipant);
}

/** Matchable: active, not already on a team, and opted into random matching. */
export function listMatchable(db: Db, eventId: string): Participant[] {
  const rows = db
    .prepare(
      `SELECT * FROM participants
       WHERE event_id = ? AND status = 'active' AND team_id IS NULL AND team_pref = 'random_team'`,
    )
    .all(eventId) as unknown as ParticipantRow[];
  return rows.map(toParticipant);
}

export function setTeammates(db: Db, actor: string, eventId: string, userId: string, teammateIds: string[]): Result<Participant> {
  const participant = getParticipant(db, eventId, userId);
  if (participant === null) return err('not_found', 'Sign up first with /hackathon join.');
  const clean = [...new Set(teammateIds.map((id) => id.trim()).filter((id) => /^\d{5,25}$/.test(id)))].slice(0, 10);
  db.prepare('UPDATE participants SET teammates = ?, updated_at = ? WHERE event_id = ? AND user_id = ?').run(
    JSON.stringify(clean),
    Date.now(),
    eventId,
    userId,
  );
  audit(db, actor, 'participant.teammates', eventId, { userId, count: clean.length });
  return ok(getParticipant(db, eventId, userId)!);
}

export function blockParticipant(db: Db, actor: string, eventId: string, userId: string, reason: string): Result<void> {
  const res = db
    .prepare(
      "UPDATE participants SET status = 'blocked', block_reason = ?, team_id = NULL, updated_at = ? WHERE event_id = ? AND user_id = ?",
    )
    .run(reason.trim().slice(0, 200) || 'No reason given', Date.now(), eventId, userId);
  if (res.changes === 0) return err('not_found', 'Participant not found in this event.');
  audit(db, actor, 'participant.block', eventId, { userId, reason });
  return ok(undefined);
}

export function unblockParticipant(db: Db, actor: string, eventId: string, userId: string): Result<void> {
  const res = db
    .prepare(
      "UPDATE participants SET status = 'active', block_reason = NULL, updated_at = ? WHERE event_id = ? AND user_id = ? AND status = 'blocked'",
    )
    .run(Date.now(), eventId, userId);
  if (res.changes === 0) return err('not_found', 'No blocked participant with that ID in this event.');
  audit(db, actor, 'participant.unblock', eventId, { userId });
  return ok(undefined);
}

export function withdrawParticipant(db: Db, actor: string, eventId: string, userId: string): Result<void> {
  const res = db
    .prepare(
      "UPDATE participants SET status = 'withdrawn', team_id = NULL, updated_at = ? WHERE event_id = ? AND user_id = ? AND status = 'active'",
    )
    .run(Date.now(), eventId, userId);
  if (res.changes === 0) return err('not_found', 'No active signup found in this event.');
  audit(db, actor, 'participant.withdraw', eventId, { userId });
  return ok(undefined);
}

/** Purge participants of an event (event reset). */
export function purgeEventParticipants(db: Db, actor: string, eventId: string): number {
  const count = (db.prepare('SELECT COUNT(*) AS n FROM participants WHERE event_id = ?').get(eventId) as { n: number }).n;
  db.prepare('DELETE FROM participants WHERE event_id = ?').run(eventId);
  audit(db, actor, 'participant.purge', eventId, { count });
  return count;
}
