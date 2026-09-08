/**
 * Participants: signed-up users, their form answers, status, blocking.
 */
import type { Db } from '../../shared/db.js';
import { audit } from '../../shared/audit.js';
import { err, ok, type Result } from '../../shared/result.js';
import type { ValidatedSignup } from '../form/domain.js';

export type ParticipantStatus = 'active' | 'blocked' | 'withdrawn';

export interface Participant {
  userId: string;
  guildId: string;
  displayName: string;
  experience: string;
  roleTrack: string;
  skills: string[];
  teamPref: string;
  /** Comma-separated Discord user IDs of friends they signed up with. */
  teammates: string[];
  teamId: string | null;
  status: ParticipantStatus;
  blockReason: string | null;
  createdAt: number;
  updatedAt: number;
}

interface ParticipantRow {
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
  guildId: string,
  userId: string,
  signup: ValidatedSignup,
): Result<Participant> {
  const blocked = db
    .prepare("SELECT status, block_reason FROM participants WHERE user_id = ? AND guild_id = ?")
    .get(userId, guildId) as { status: string; block_reason: string | null } | undefined;
  if (blocked !== undefined && blocked.status === 'blocked') {
    return err('blocked', 'You are blocked from signing up. Contact an organizer.');
  }

  const now = Date.now();
  db.prepare(
    `INSERT INTO participants
       (user_id, guild_id, display_name, experience, role_track, skills, team_pref, teammates, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?)
     ON CONFLICT(user_id) DO UPDATE SET
       display_name = excluded.display_name,
       experience = excluded.experience,
       role_track = excluded.role_track,
       skills = excluded.skills,
       team_pref = excluded.team_pref,
       teammates = excluded.teammates,
       status = 'active',
       updated_at = excluded.updated_at`,
  ).run(
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
  audit(db, actor, 'participant.upsert', userId, { displayName: signup.displayName, teamPref: signup.teamPref });
  return ok(getParticipant(db, guildId, userId)!);
}

export function getParticipant(db: Db, guildId: string, userId: string): Participant | null {
  const row = db
    .prepare('SELECT * FROM participants WHERE user_id = ? AND guild_id = ?')
    .get(userId, guildId) as ParticipantRow | undefined;
  return row === undefined ? null : toParticipant(row);
}

export function listParticipants(db: Db, guildId: string, status?: ParticipantStatus): Participant[] {
  const rows = (
    status === undefined
      ? (db.prepare('SELECT * FROM participants WHERE guild_id = ? ORDER BY created_at').all(guildId) as unknown as ParticipantRow[])
      : (db.prepare('SELECT * FROM participants WHERE guild_id = ? AND status = ? ORDER BY created_at').all(guildId, status) as unknown as ParticipantRow[])
  );
  return rows.map(toParticipant);
}

/** Matchable: active, not already on a team, and opted into random matching. */
export function listMatchable(db: Db, guildId: string): Participant[] {
  const rows = db
    .prepare(
      `SELECT * FROM participants
       WHERE guild_id = ? AND status = 'active' AND team_id IS NULL AND team_pref = 'random_team'`,
    )
    .all(guildId) as unknown as ParticipantRow[];
  return rows.map(toParticipant);
}

export function setTeammates(db: Db, actor: string, guildId: string, userId: string, teammateIds: string[]): Result<Participant> {
  const participant = getParticipant(db, guildId, userId);
  if (participant === null) return err('not_found', 'Sign up first with /hackathon join.');
  const clean = [...new Set(teammateIds.map((id) => id.trim()).filter((id) => /^\d{5,25}$/.test(id)))].slice(0, 10);
  db.prepare('UPDATE participants SET teammates = ?, updated_at = ? WHERE user_id = ? AND guild_id = ?').run(
    JSON.stringify(clean),
    Date.now(),
    userId,
    guildId,
  );
  audit(db, actor, 'participant.teammates', userId, { count: clean.length });
  return ok(getParticipant(db, guildId, userId)!);
}

export function blockParticipant(db: Db, actor: string, guildId: string, userId: string, reason: string): Result<void> {
  const res = db
    .prepare("UPDATE participants SET status = 'blocked', block_reason = ?, team_id = NULL, updated_at = ? WHERE user_id = ? AND guild_id = ?")
    .run(reason.trim().slice(0, 200) || 'No reason given', Date.now(), userId, guildId);
  if (res.changes === 0) return err('not_found', 'Participant not found.');
  audit(db, actor, 'participant.block', userId, { reason });
  return ok(undefined);
}

export function unblockParticipant(db: Db, actor: string, guildId: string, userId: string): Result<void> {
  const res = db
    .prepare("UPDATE participants SET status = 'active', block_reason = NULL, updated_at = ? WHERE user_id = ? AND guild_id = ? AND status = 'blocked'")
    .run(Date.now(), userId, guildId);
  if (res.changes === 0) return err('not_found', 'No blocked participant with that ID.');
  audit(db, actor, 'participant.unblock', userId, null);
  return ok(undefined);
}

export function withdrawParticipant(db: Db, actor: string, guildId: string, userId: string): Result<void> {
  const res = db
    .prepare("UPDATE participants SET status = 'withdrawn', team_id = NULL, updated_at = ? WHERE user_id = ? AND guild_id = ? AND status = 'active'")
    .run(Date.now(), userId, guildId);
  if (res.changes === 0) return err('not_found', 'No active signup found.');
  audit(db, actor, 'participant.withdraw', userId, null);
  return ok(undefined);
}

/** Remove everything for a new event (participants + teams + matching). */
export function resetEvent(db: Db, actor: string, guildId: string): Result<{ participants: number; teams: number }> {
  const pCount = (db.prepare('SELECT COUNT(*) AS n FROM participants WHERE guild_id = ?').get(guildId) as { n: number }).n;
  const tCount = (db.prepare('SELECT COUNT(*) AS n FROM teams WHERE guild_id = ?').get(guildId) as { n: number }).n;
  db.prepare('DELETE FROM participants WHERE guild_id = ?').run(guildId);
  db.prepare('DELETE FROM teams WHERE guild_id = ?').run(guildId);
  audit(db, actor, 'event.reset', guildId, { participants: pCount, teams: tCount });
  return ok({ participants: pCount, teams: tCount });
}
