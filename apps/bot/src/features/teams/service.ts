/**
 * Teams (per event): owner-created public/private teams and matched teams.
 * Team membership is stored on participants (team_id), scoped by event.
 */
import type { Db } from '../../shared/db.js';
import { audit } from '../../shared/audit.js';
import { err, ok, type Result } from '../../shared/result.js';
import { newId, newJoinCode } from '../../shared/db.js';
import type { TeamKind } from '../form/domain.js';

export interface Team {
  id: string;
  eventId: string;
  guildId: string;
  name: string;
  kind: TeamKind | 'matched';
  ownerId: string | null;
  joinCode: string | null;
  roleId: string | null;
  textChannelId: string | null;
  voiceChannelId: string | null;
  colorId: string | null;
  createdAt: number;
}

export interface TeamWithMembers extends Team {
  members: { userId: string; displayName: string; roleTrack: string; experience: string; skills: string[] }[];
}

interface TeamRow {
  id: string;
  event_id: string | null;
  guild_id: string;
  name: string;
  kind: string;
  owner_id: string | null;
  join_code: string | null;
  role_id: string | null;
  text_channel_id: string | null;
  voice_channel_id: string | null;
  color: string | null;
  created_at: number;
}

function toTeam(row: TeamRow): Team {
  return {
    id: row.id,
    eventId: row.event_id ?? '',
    guildId: row.guild_id,
    name: row.name,
    kind: row.kind as Team['kind'],
    ownerId: row.owner_id,
    joinCode: row.join_code,
    roleId: row.role_id,
    textChannelId: row.text_channel_id,
    voiceChannelId: row.voice_channel_id,
    colorId: row.color,
    createdAt: row.created_at,
  };
}

export function createTeam(
  db: Db,
  actor: string,
  eventId: string,
  guildId: string,
  name: string,
  kind: TeamKind,
  ownerId: string,
  colorId: string | null = null,
): Result<Team> {
  const cleanName = name.trim().replace(/\s+/g, ' ').slice(0, 60);
  if (cleanName.length < 3) return err('bad_name', 'Team name must be at least 3 characters.');

  const existingMembership = getTeamForUser(db, eventId, ownerId);
  if (existingMembership !== null) return err('already_in_team', 'You are already in a team. Leave it first.');

  const id = newId('team');
  const joinCode = kind === 'private' ? newJoinCode() : null;
  db.prepare(
    'INSERT INTO teams (id, event_id, guild_id, name, kind, owner_id, join_code, color, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
  ).run(id, eventId, guildId, cleanName, kind, ownerId, joinCode, colorId, Date.now());
  db.prepare('UPDATE participants SET team_id = ?, updated_at = ? WHERE event_id = ? AND user_id = ?').run(
    id,
    Date.now(),
    eventId,
    ownerId,
  );
  audit(db, actor, 'team.create', eventId, { teamId: id, name: cleanName, kind, colorId });
  const created = db.prepare('SELECT * FROM teams WHERE id = ?').get(id) as unknown as TeamRow;
  return ok(toTeam(created));
}

export function getTeam(db: Db, teamId: string): Team | null {
  const row = db.prepare('SELECT * FROM teams WHERE id = ?').get(teamId) as unknown as TeamRow | undefined;
  return row === undefined ? null : toTeam(row);
}

export function getTeamByJoinCode(db: Db, eventId: string, code: string): Team | null {
  const clean = code.trim().toUpperCase();
  if (!/^[A-Z0-9]{6}$/.test(clean)) return null;
  const row = db
    .prepare('SELECT * FROM teams WHERE join_code = ? AND event_id = ?')
    .get(clean, eventId) as unknown as TeamRow | undefined;
  return row === undefined ? null : toTeam(row);
}

export function getTeamForUser(db: Db, eventId: string, userId: string): Team | null {
  const row = db
    .prepare(
      `SELECT t.* FROM teams t JOIN participants p ON p.team_id = t.id
       WHERE p.event_id = ? AND p.user_id = ?`,
    )
    .get(eventId, userId) as TeamRow | undefined;
  return row === undefined ? null : toTeam(row);
}

export function listTeams(db: Db, eventId: string, kind?: Team['kind']): TeamWithMembers[] {
  const rows = (
    kind === undefined
      ? (db.prepare('SELECT * FROM teams WHERE event_id = ? ORDER BY created_at').all(eventId) as unknown as TeamRow[])
      : (db.prepare('SELECT * FROM teams WHERE event_id = ? AND kind = ? ORDER BY created_at').all(eventId, kind) as unknown as TeamRow[])
  );
  return rows.map((row) => {
    const team = toTeam(row);
    const members = db
      .prepare(
        `SELECT user_id, display_name, role_track, experience, skills FROM participants
         WHERE team_id = ? AND status = 'active' ORDER BY created_at`,
      )
      .all(team.id) as unknown as { user_id: string; display_name: string; role_track: string; experience: string; skills: string }[];
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

/** Open (not full, public) teams for the join browser. */
export function listOpenPublicTeams(db: Db, eventId: string, teamSize: number): TeamWithMembers[] {
  return listTeams(db, eventId, 'public').filter((t) => t.members.length < teamSize);
}

export function joinTeam(db: Db, actor: string, eventId: string, userId: string, teamId: string, teamSize: number): Result<Team> {
  const team = getTeam(db, teamId);
  if (team === null || team.eventId !== eventId) return err('not_found', 'Team not found in this event.');
  if (team.kind === 'private') return err('private_team', 'That team is private — an invite or join code is required.');

  const participant = db
    .prepare('SELECT status FROM participants WHERE event_id = ? AND user_id = ?')
    .get(eventId, userId) as { status: string } | undefined;
  if (participant === undefined) return err('no_signup', 'Sign up first with /hackathon join.');
  if (participant.status !== 'active') return err('not_active', 'Your signup is not active.');

  const current = getTeamForUser(db, eventId, userId);
  if (current !== null) return err('already_in_team', 'You are already in a team. Leave it first.');

  const members = countMembers(db, teamId);
  if (members >= teamSize) return err('team_full', `Team is full (${teamSize}/${teamSize}).`);

  db.prepare('UPDATE participants SET team_id = ?, updated_at = ? WHERE event_id = ? AND user_id = ?').run(
    teamId,
    Date.now(),
    eventId,
    userId,
  );
  audit(db, actor, 'team.join', eventId, { teamId, userId });
  return ok(team);
}

export function joinPrivateTeam(
  db: Db,
  actor: string,
  eventId: string,
  userId: string,
  code: string,
  teamSize: number,
): Result<Team> {
  const team = getTeamByJoinCode(db, eventId, code);
  if (team === null) return err('not_found', 'No team with that code in this event.');
  const current = getTeamForUser(db, eventId, userId);
  if (current !== null) return err('already_in_team', 'You are already in a team. Leave it first.');
  const members = countMembers(db, team.id);
  if (members >= teamSize) return err('team_full', `Team is full (${teamSize}/${teamSize}).`);
  db.prepare('UPDATE participants SET team_id = ?, updated_at = ? WHERE event_id = ? AND user_id = ?').run(
    team.id,
    Date.now(),
    eventId,
    userId,
  );
  audit(db, actor, 'team.join_code', eventId, { teamId: team.id, userId });
  return ok(team);
}

export function leaveTeam(db: Db, actor: string, eventId: string, userId: string): Result<Team> {
  const team = getTeamForUser(db, eventId, userId);
  if (team === null) return err('no_team', 'You are not in a team.');
  if (team.ownerId === userId) {
    const members = countMembers(db, team.id);
    if (members > 1) return err('owner_leave', 'You own this team. Members must leave first, or ask an organizer to delete it.');
    return deleteTeam(db, actor, team.id);
  }
  db.prepare('UPDATE participants SET team_id = NULL, updated_at = ? WHERE event_id = ? AND user_id = ?').run(
    Date.now(),
    eventId,
    userId,
  );
  audit(db, actor, 'team.leave', eventId, { teamId: team.id, userId });
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
  audit(db, actor, 'team.remove_member', team.eventId, { teamId, userId });
  return ok(undefined);
}

/** Admin move: silently assigns a participant to a team (no capacity check — admin override). */
export function adminAssign(db: Db, actor: string, eventId: string, userId: string, teamId: string | null): Result<void> {
  if (teamId !== null) {
    const team = getTeam(db, teamId);
    if (team === null || team.eventId !== eventId) return err('not_found', 'Team not found in this event.');
  }
  const res = db
    .prepare('UPDATE participants SET team_id = ?, updated_at = ? WHERE event_id = ? AND user_id = ?')
    .run(teamId, Date.now(), eventId, userId);
  if (res.changes === 0) return err('not_found', 'Participant not found in this event.');
  audit(db, actor, 'team.assign', eventId, { userId, teamId });
  return ok(undefined);
}

export function deleteTeam(db: Db, actor: string, teamId: string): Result<Team> {
  const team = getTeam(db, teamId);
  if (team === null) return err('not_found', 'Team not found.');
  db.prepare('UPDATE participants SET team_id = NULL WHERE team_id = ?').run(teamId);
  db.prepare('DELETE FROM team_requests WHERE team_id = ?').run(teamId);
  db.prepare('DELETE FROM teams WHERE id = ?').run(teamId);
  audit(db, actor, 'team.delete', team.eventId, { teamId, name: team.name });
  return ok(team);
}

export function rotateJoinCode(db: Db, actor: string, teamId: string): Result<string> {
  const team = getTeam(db, teamId);
  if (team === null) return err('not_found', 'Team not found.');
  if (team.kind !== 'private') return err('not_private', 'Only private teams have join codes.');
  const code = newJoinCode();
  db.prepare('UPDATE teams SET join_code = ? WHERE id = ?').run(code, teamId);
  audit(db, actor, 'team.rotate_code', team.eventId, { teamId });
  return ok(code);
}

export function countMembers(db: Db, teamId: string): number {
  const row = db
    .prepare("SELECT COUNT(*) AS n FROM participants WHERE team_id = ? AND status = 'active'")
    .get(teamId) as { n: number };
  return row.n;
}

/** Delete all teams of an event (event reset / cleanup). Returns count. */
export function deleteEventTeams(db: Db, actor: string, eventId: string): number {
  const count = (db.prepare('SELECT COUNT(*) AS n FROM teams WHERE event_id = ?').get(eventId) as { n: number }).n;
  db.prepare('UPDATE participants SET team_id = NULL WHERE team_id IN (SELECT id FROM teams WHERE event_id = ?)').run(eventId);
  db.prepare('DELETE FROM team_requests WHERE event_id = ?').run(eventId);
  db.prepare('DELETE FROM teams WHERE event_id = ?').run(eventId);
  audit(db, actor, 'team.purge', eventId, { count });
  return count;
}

// ─── provisioning persistence ────────────────────────────────────────────────

export function setProvisioning(
  db: Db,
  teamId: string,
  ids: { roleId: string; textChannelId: string; voiceChannelId: string },
): void {
  db.prepare('UPDATE teams SET role_id = ?, text_channel_id = ?, voice_channel_id = ? WHERE id = ?').run(
    ids.roleId,
    ids.textChannelId,
    ids.voiceChannelId,
    teamId,
  );
}

export function setTextChannel(db: Db, teamId: string, channelId: string | null): void {
  db.prepare('UPDATE teams SET text_channel_id = ? WHERE id = ?').run(channelId, teamId);
}

export function setVoiceChannel(db: Db, teamId: string, channelId: string | null): void {
  db.prepare('UPDATE teams SET voice_channel_id = ? WHERE id = ?').run(channelId, teamId);
}

export function setRole(db: Db, teamId: string, roleId: string | null): void {
  db.prepare('UPDATE teams SET role_id = ? WHERE id = ?').run(roleId, teamId);
}

/** Owner settings: visibility (public/private), name, color. */
export function updateTeamSettings(
  db: Db,
  actor: string,
  teamId: string,
  update: { name?: string; kind?: TeamKind; colorId?: string | null | undefined },
): Result<Team> {
  const team = getTeam(db, teamId);
  if (team === null) return err('not_found', 'Team not found.');
  if (team.kind === 'matched') return err('matched_team', 'Matched teams cannot be edited here.');

  const name = update.name !== undefined ? update.name.trim().replace(/\s+/g, ' ').slice(0, 60) : team.name;
  if (name.length < 3) return err('bad_name', 'Team name must be at least 3 characters.');
  const kind = update.kind ?? (team.kind as TeamKind);
  const colorId = update.colorId !== undefined ? update.colorId : team.colorId;

  db.prepare('UPDATE teams SET name = ?, kind = ?, color = ? WHERE id = ?').run(name, kind, colorId, teamId);
  audit(db, actor, 'team.settings', team.eventId, { teamId, name, kind, colorId });
  const row = db.prepare('SELECT * FROM teams WHERE id = ?').get(teamId) as unknown as TeamRow;
  return ok(toTeam(row));
}

// ─── guild-level settings (fallback category etc.) ──────────────────────────

export function getGuildSettings(db: Db, guildId: string): { teamCategoryId: string | null } {
  const row = db.prepare('SELECT team_category_id FROM guild_settings WHERE guild_id = ?').get(guildId) as
    | { team_category_id: string | null }
    | undefined;
  return { teamCategoryId: row?.team_category_id ?? null };
}

export function setGuildCategory(db: Db, actor: string, guildId: string, categoryId: string | null): void {
  db.prepare(
    `INSERT INTO guild_settings (guild_id, team_category_id, updated_at) VALUES (?, ?, ?)
     ON CONFLICT(guild_id) DO UPDATE SET team_category_id = excluded.team_category_id, updated_at = excluded.updated_at`,
  ).run(guildId, categoryId, Date.now());
  audit(db, actor, 'guild.set_category', guildId, { categoryId });
}
