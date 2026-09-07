/**
 * Teams: public teams (open to join via listing), private teams (invite/join code only).
 * Matched teams are created by the matching engine, also stored here.
 */
import type { Db } from '../../shared/db.js';
import { audit } from '../../shared/audit.js';
import { err, ok, type Result } from '../../shared/result.js';
import { newId, newJoinCode } from '../../shared/db.js';
import type { TeamKind } from '../form/domain.js';

export interface Team {
  id: string;
  guildId: string;
  name: string;
  kind: TeamKind | 'matched';
  ownerId: string | null;
  joinCode: string | null;
  createdAt: number;
}

export interface TeamWithMembers extends Team {
  members: { userId: string; displayName: string; roleTrack: string; experience: string; skills: string[] }[];
}

interface TeamRow {
  id: string;
  guild_id: string;
  name: string;
  kind: string;
  owner_id: string | null;
  join_code: string | null;
  created_at: number;
}

function toTeam(row: TeamRow): Team {
  return {
    id: row.id,
    guildId: row.guild_id,
    name: row.name,
    kind: row.kind as Team['kind'],
    ownerId: row.owner_id,
    joinCode: row.join_code,
    createdAt: row.created_at,
  };
}

export function createTeam(
  db: Db,
  actor: string,
  guildId: string,
  name: string,
  kind: TeamKind,
  ownerId: string,
): Result<Team> {
  const cleanName = name.trim().replace(/\s+/g, ' ').slice(0, 60);
  if (cleanName.length < 3) return err('bad_name', 'Team name must be at least 3 characters.');

  const existingMembership = getTeamForUser(db, guildId, ownerId);
  if (existingMembership !== null) return err('already_in_team', 'You are already in a team. Leave it first.');

  // Private teams get a join code; public teams are joinable from the listing.
  const id = newId('team');
  const joinCode = kind === 'private' ? newJoinCode() : null;
  db.prepare(
    'INSERT INTO teams (id, guild_id, name, kind, owner_id, join_code, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
  ).run(id, guildId, cleanName, kind, ownerId, joinCode, Date.now());
  db.prepare('UPDATE participants SET team_id = ?, updated_at = ? WHERE user_id = ? AND guild_id = ?').run(
    id,
    Date.now(),
    ownerId,
    guildId,
  );
  audit(db, actor, 'team.create', id, { name: cleanName, kind });
  const created = db.prepare('SELECT * FROM teams WHERE id = ?').get(id) as unknown as TeamRow;
  return ok(toTeam(created));
}

export function getTeam(db: Db, teamId: string): Team | null {
  const row = db
    .prepare('SELECT * FROM teams WHERE id = ?')
    .get(teamId) as unknown as TeamRow | undefined;
  return row === undefined ? null : toTeam(row);
}

export function getTeamByJoinCode(db: Db, guildId: string, code: string): Team | null {
  const clean = code.trim().toUpperCase();
  if (!/^[A-Z0-9]{6}$/.test(clean)) return null;
  const row = db
    .prepare('SELECT * FROM teams WHERE join_code = ? AND guild_id = ?')
    .get(clean, guildId) as unknown as TeamRow | undefined;
  return row === undefined ? null : toTeam(row);
}

export function getTeamForUser(db: Db, guildId: string, userId: string): Team | null {
  const row = db
    .prepare(
      `SELECT t.* FROM teams t JOIN participants p ON p.team_id = t.id
       WHERE p.user_id = ? AND p.guild_id = ?`,
    )
    .get(userId, guildId) as TeamRow | undefined;
  return row === undefined ? null : toTeam(row);
}

export function listTeams(db: Db, guildId: string, kind?: Team['kind']): TeamWithMembers[] {
  const rows = (
    kind === undefined
      ? (db.prepare('SELECT * FROM teams WHERE guild_id = ? ORDER BY created_at').all(guildId) as unknown as TeamRow[])
      : (db.prepare('SELECT * FROM teams WHERE guild_id = ? AND kind = ? ORDER BY created_at').all(guildId, kind) as unknown as TeamRow[])
  );
  return rows.map((row) => {
    const team = toTeam(row);
    const members = db
      .prepare(
        `SELECT user_id, display_name, role_track, experience, skills FROM participants
         WHERE team_id = ? AND status = 'active' ORDER BY created_at`,
      )
      .all(team.id) as { user_id: string; display_name: string; role_track: string; experience: string; skills: string }[];
    return {
      ...team,
      members: members.map((m) => ({
        userId: m.user_id,
        displayName: m.display_name,
        roleTrack: m.role_track,
        experience: m.experience,
        skills: JSON.parse(m.skills) as string[],
      })),
    };
  });
}

/** Open (not full) public teams, for the join listing. */
export function listOpenPublicTeams(db: Db, guildId: string, teamSize: number): TeamWithMembers[] {
  return listTeams(db, guildId, 'public').filter((t) => t.members.length < teamSize);
}

export function joinTeam(db: Db, actor: string, guildId: string, userId: string, teamId: string, teamSize: number): Result<Team> {
  const team = getTeam(db, teamId);
  if (team === null || team.guildId !== guildId) return err('not_found', 'Team not found.');
  if (team.kind === 'private') return err('private_team', 'That team is private — a join code is required.');

  const participant = db
    .prepare("SELECT status FROM participants WHERE user_id = ? AND guild_id = ?")
    .get(userId, guildId) as { status: string } | undefined;
  if (participant === undefined) return err('not_found', 'Sign up first with /hackathon join.');
  if (participant.status !== 'active') return err('not_active', 'Your signup is not active.');

  const current = getTeamForUser(db, guildId, userId);
  if (current !== null) return err('already_in_team', 'You are already in a team. Leave it first.');

  const members = countMembers(db, teamId);
  if (members >= teamSize) return err('team_full', `Team is full (${teamSize}/${teamSize}).`);

  db.prepare('UPDATE participants SET team_id = ?, updated_at = ? WHERE user_id = ? AND guild_id = ?').run(
    teamId,
    Date.now(),
    userId,
    guildId,
  );
  audit(db, actor, 'team.join', teamId, { userId });
  return ok(team);
}

export function joinPrivateTeam(
  db: Db,
  actor: string,
  guildId: string,
  userId: string,
  code: string,
  teamSize: number,
): Result<Team> {
  const team = getTeamByJoinCode(db, guildId, code);
  if (team === null) return err('not_found', 'No team with that code.');
  const current = getTeamForUser(db, guildId, userId);
  if (current !== null) return err('already_in_team', 'You are already in a team. Leave it first.');
  const members = countMembers(db, team.id);
  if (members >= teamSize) return err('team_full', `Team is full (${teamSize}/${teamSize}).`);
  db.prepare('UPDATE participants SET team_id = ?, updated_at = ? WHERE user_id = ? AND guild_id = ?').run(
    team.id,
    Date.now(),
    userId,
    guildId,
  );
  audit(db, actor, 'team.join_code', team.id, { userId });
  return ok(team);
}

export function leaveTeam(db: Db, actor: string, guildId: string, userId: string): Result<Team> {
  const team = getTeamForUser(db, guildId, userId);
  if (team === null) return err('no_team', 'You are not in a team.');
  if (team.ownerId === userId) {
    const members = countMembers(db, team.id);
    if (members > 1) return err('owner_leave', 'You own this team. Remove other members first, or delete the team.');
    return deleteTeam(db, actor, team.id);
  }
  db.prepare('UPDATE participants SET team_id = NULL, updated_at = ? WHERE user_id = ?').run(Date.now(), userId);
  audit(db, actor, 'team.leave', team.id, { userId });
  return ok(team);
}

export function removeMember(db: Db, actor: string, teamId: string, userId: string): Result<void> {
  const team = getTeam(db, teamId);
  if (team === null) return err('not_found', 'Team not found.');
  db.prepare('UPDATE participants SET team_id = NULL, updated_at = ? WHERE user_id = ? AND team_id = ?').run(
    Date.now(),
    userId,
    teamId,
  );
  audit(db, actor, 'team.remove_member', teamId, { userId });
  return ok(undefined);
}

/** Admin move: silently assigns a participant to a team (no capacity check — admin override). */
export function adminAssign(db: Db, actor: string, guildId: string, userId: string, teamId: string | null): Result<void> {
  if (teamId !== null) {
    const team = getTeam(db, teamId);
    if (team === null || team.guildId !== guildId) return err('not_found', 'Team not found in this guild.');
  }
  const res = db
    .prepare('UPDATE participants SET team_id = ?, updated_at = ? WHERE user_id = ? AND guild_id = ?')
    .run(teamId, Date.now(), userId, guildId);
  if (res.changes === 0) return err('not_found', 'Participant not found.');
  audit(db, actor, 'team.assign', userId, { teamId });
  return ok(undefined);
}

export function deleteTeam(db: Db, actor: string, teamId: string): Result<Team> {
  const team = getTeam(db, teamId);
  if (team === null) return err('not_found', 'Team not found.');
  db.prepare('UPDATE participants SET team_id = NULL WHERE team_id = ?').run(teamId);
  db.prepare('DELETE FROM teams WHERE id = ?').run(teamId);
  audit(db, actor, 'team.delete', teamId, { name: team.name });
  return ok(team);
}

export function rotateJoinCode(db: Db, actor: string, teamId: string): Result<string> {
  const team = getTeam(db, teamId);
  if (team === null) return err('not_found', 'Team not found.');
  if (team.kind !== 'private') return err('not_private', 'Only private teams have join codes.');
  const code = newJoinCode();
  db.prepare('UPDATE teams SET join_code = ? WHERE id = ?').run(code, teamId);
  audit(db, actor, 'team.rotate_code', teamId, null);
  return ok(code);
}

export function countMembers(db: Db, teamId: string): number {
  const row = db
    .prepare("SELECT COUNT(*) AS n FROM participants WHERE team_id = ? AND status = 'active'")
    .get(teamId) as { n: number };
  return row.n;
}
