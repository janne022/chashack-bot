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

export async function createTeam(
  db: Db,
  actor: string,
  eventId: string,
  guildId: string,
  name: string,
  kind: TeamKind,
  ownerId: string,
  colorId: string | null = null,
): Promise<Result<Team>> {
  const cleanName = name.trim().replace(/\s+/g, ' ').slice(0, 60);
  if (cleanName.length < 3) return err('bad_name', 'Team name must be at least 3 characters.');

  // Membership check → insert → assign owner: a read-modify-write pair, wrapped
  // so two concurrent creates cannot both pass the check.
  return db.transaction(async () => {
    const existingMembership = await getTeamForUser(db, eventId, ownerId);
    if (existingMembership !== null) return err('already_in_team', 'You are already in a team. Leave it first.');

    const id = newId('team');
    const joinCode = kind === 'private' ? newJoinCode() : null;
    await db.run(
      'INSERT INTO teams (id, event_id, guild_id, name, kind, owner_id, join_code, color, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      id,
      eventId,
      guildId,
      cleanName,
      kind,
      ownerId,
      joinCode,
      colorId,
      Date.now(),
    );
    await db.run('UPDATE participants SET team_id = ?, updated_at = ? WHERE event_id = ? AND user_id = ?', id, Date.now(), eventId, ownerId);
    await audit(db, actor, 'team.create', eventId, { teamId: id, name: cleanName, kind, colorId });
    const created = await db.get<TeamRow>('SELECT * FROM teams WHERE id = ?', id);
    return ok(toTeam(created!));
  });
}

export async function getTeam(db: Db, teamId: string): Promise<Team | null> {
  const row = await db.get<TeamRow>('SELECT * FROM teams WHERE id = ?', teamId);
  return row === undefined ? null : toTeam(row);
}

export async function getTeamByJoinCode(db: Db, eventId: string, code: string): Promise<Team | null> {
  const clean = code.trim().toUpperCase();
  if (!/^[A-Z0-9]{6}$/.test(clean)) return null;
  const row = await db.get<TeamRow>('SELECT * FROM teams WHERE join_code = ? AND event_id = ?', clean, eventId);
  return row === undefined ? null : toTeam(row);
}

export async function getTeamForUser(db: Db, eventId: string, userId: string): Promise<Team | null> {
  const row = await db.get<TeamRow>(
    `SELECT t.* FROM teams t JOIN participants p ON p.team_id = t.id
       WHERE p.event_id = ? AND p.user_id = ?`,
    eventId,
    userId,
  );
  return row === undefined ? null : toTeam(row);
}

export async function listTeams(db: Db, eventId: string, kind?: Team['kind']): Promise<TeamWithMembers[]> {
  const rows =
    kind === undefined
      ? await db.all<TeamRow>('SELECT * FROM teams WHERE event_id = ? ORDER BY created_at', eventId)
      : await db.all<TeamRow>('SELECT * FROM teams WHERE event_id = ? AND kind = ? ORDER BY created_at', eventId, kind);
  const teams: TeamWithMembers[] = [];
  for (const row of rows) {
    const team = toTeam(row);
    const members = await db.all<{
      user_id: string;
      display_name: string;
      role_track: string;
      experience: string;
      skills: string;
    }>(
      `SELECT user_id, display_name, role_track, experience, skills FROM participants
         WHERE team_id = ? AND status = 'active' ORDER BY created_at`,
      team.id,
    );
    teams.push({
      ...team,
      members: members.map((m) => ({
        userId: m.user_id,
        displayName: m.display_name,
        roleTrack: m.role_track,
        experience: m.experience,
        skills: JSON.parse(m.skills) as string[],
      })),
    });
  }
  return teams;
}

/** Open (not full, public) teams for the join browser. */
export async function listOpenPublicTeams(db: Db, eventId: string, teamSize: number): Promise<TeamWithMembers[]> {
  const teams = await listTeams(db, eventId, 'public');
  return teams.filter((t) => t.members.length < teamSize);
}

export async function joinTeam(db: Db, actor: string, eventId: string, userId: string, teamId: string, teamSize: number): Promise<Result<Team>> {
  // Capacity check → insert is a read-modify-write: two concurrent joins could
  // both pass the full check without the transaction. The single-writer queue
  // serialises them, preserving the atomicity the sync code had implicitly.
  return db.transaction(async () => {
    const team = await getTeam(db, teamId);
    if (team === null || team.eventId !== eventId) return err('not_found', 'Team not found in this event.');
    if (team.kind === 'private') return err('private_team', 'That team is private — an invite or join code is required.');

    const participant = await db.get<{ status: string }>('SELECT status FROM participants WHERE event_id = ? AND user_id = ?', eventId, userId);
    if (participant === undefined) return err('no_signup', 'Sign up first with /hackathon join.');
    if (participant.status !== 'active') return err('not_active', 'Your signup is not active.');

    const current = await getTeamForUser(db, eventId, userId);
    if (current !== null) return err('already_in_team', 'You are already in a team. Leave it first.');

    const members = await countMembers(db, teamId);
    if (members >= teamSize) return err('team_full', `Team is full (${teamSize}/${teamSize}).`);

    await db.run('UPDATE participants SET team_id = ?, updated_at = ? WHERE event_id = ? AND user_id = ?', teamId, Date.now(), eventId, userId);
    await audit(db, actor, 'team.join', eventId, { teamId, userId });
    return ok(team);
  });
}

export async function joinPrivateTeam(
  db: Db,
  actor: string,
  eventId: string,
  userId: string,
  code: string,
  teamSize: number,
): Promise<Result<Team>> {
  // Same capacity check → insert race as joinTeam; atomic via transaction.
  return db.transaction(async () => {
    const team = await getTeamByJoinCode(db, eventId, code);
    if (team === null) return err('not_found', 'No team with that code in this event.');
    const current = await getTeamForUser(db, eventId, userId);
    if (current !== null) return err('already_in_team', 'You are already in a team. Leave it first.');
    const members = await countMembers(db, team.id);
    if (members >= teamSize) return err('team_full', `Team is full (${teamSize}/${teamSize}).`);
    await db.run('UPDATE participants SET team_id = ?, updated_at = ? WHERE event_id = ? AND user_id = ?', team.id, Date.now(), eventId, userId);
    await audit(db, actor, 'team.join_code', eventId, { teamId: team.id, userId });
    return ok(team);
  });
}

export async function leaveTeam(db: Db, actor: string, eventId: string, userId: string): Promise<Result<Team>> {
  // Owner path reads the member count and may delete the team — atomic.
  return db.transaction(async () => {
    const team = await getTeamForUser(db, eventId, userId);
    if (team === null) return err('no_team', 'You are not in a team.');
    if (team.ownerId === userId) {
      const members = await countMembers(db, team.id);
      if (members > 1) return err('owner_leave', 'You own this team. Members must leave first, or ask an organizer to delete it.');
      return deleteTeam(db, actor, team.id);
    }
    await db.run('UPDATE participants SET team_id = NULL, updated_at = ? WHERE event_id = ? AND user_id = ?', Date.now(), eventId, userId);
    await audit(db, actor, 'team.leave', eventId, { teamId: team.id, userId });
    return ok(team);
  });
}

export async function removeMember(db: Db, actor: string, teamId: string, userId: string): Promise<Result<void>> {
  const team = await getTeam(db, teamId);
  if (team === null) return err('not_found', 'Team not found.');
  await db.run('UPDATE participants SET team_id = NULL, updated_at = ? WHERE user_id = ? AND team_id = ?', Date.now(), userId, teamId);
  await audit(db, actor, 'team.remove_member', team.eventId, { teamId, userId });
  return ok(undefined);
}

/** Admin move: silently assigns a participant to a team (no capacity check — admin override). */
export async function adminAssign(db: Db, actor: string, eventId: string, userId: string, teamId: string | null): Promise<Result<void>> {
  if (teamId !== null) {
    const team = await getTeam(db, teamId);
    if (team === null || team.eventId !== eventId) return err('not_found', 'Team not found in this event.');
  }
  const res = await db.run('UPDATE participants SET team_id = ?, updated_at = ? WHERE event_id = ? AND user_id = ?', teamId, Date.now(), eventId, userId);
  if (res.changes === 0) return err('not_found', 'Participant not found in this event.');
  await audit(db, actor, 'team.assign', eventId, { userId, teamId });
  return ok(undefined);
}

export async function deleteTeam(db: Db, actor: string, teamId: string): Promise<Result<Team>> {
  // Reads the team then deletes its rows — kept atomic so a concurrent join to
  // the same team cannot land between the read and the deletes.
  return db.transaction(async () => {
    const team = await getTeam(db, teamId);
    if (team === null) return err('not_found', 'Team not found.');
    await db.run('UPDATE participants SET team_id = NULL WHERE team_id = ?', teamId);
    await db.run('DELETE FROM team_requests WHERE team_id = ?', teamId);
    await db.run('DELETE FROM teams WHERE id = ?', teamId);
    await audit(db, actor, 'team.delete', team.eventId, { teamId, name: team.name });
    return ok(team);
  });
}

export async function rotateJoinCode(db: Db, actor: string, teamId: string): Promise<Result<string>> {
  const team = await getTeam(db, teamId);
  if (team === null) return err('not_found', 'Team not found.');
  if (team.kind !== 'private') return err('not_private', 'Only private teams have join codes.');
  const code = newJoinCode();
  await db.run('UPDATE teams SET join_code = ? WHERE id = ?', code, teamId);
  await audit(db, actor, 'team.rotate_code', team.eventId, { teamId });
  return ok(code);
}

export async function countMembers(db: Db, teamId: string): Promise<number> {
  const row = await db.get<{ n: number }>("SELECT COUNT(*) AS n FROM participants WHERE team_id = ? AND status = 'active'", teamId);
  return row?.n ?? 0;
}

/** Delete all teams of an event (event reset / cleanup). Returns count. */
export async function deleteEventTeams(db: Db, actor: string, eventId: string): Promise<number> {
  return db.transaction(async () => {
    const row = await db.get<{ n: number }>('SELECT COUNT(*) AS n FROM teams WHERE event_id = ?', eventId);
    const count = row?.n ?? 0;
    await db.run('UPDATE participants SET team_id = NULL WHERE team_id IN (SELECT id FROM teams WHERE event_id = ?)', eventId);
    await db.run('DELETE FROM team_requests WHERE event_id = ?', eventId);
    await db.run('DELETE FROM teams WHERE event_id = ?', eventId);
    await audit(db, actor, 'team.purge', eventId, { count });
    return count;
  });
}

// ─── provisioning persistence ────────────────────────────────────────────────

export async function setProvisioning(
  db: Db,
  teamId: string,
  ids: { roleId: string; textChannelId: string; voiceChannelId: string },
): Promise<void> {
  await db.run('UPDATE teams SET role_id = ?, text_channel_id = ?, voice_channel_id = ? WHERE id = ?', ids.roleId, ids.textChannelId, ids.voiceChannelId, teamId);
}

export async function setTextChannel(db: Db, teamId: string, channelId: string | null): Promise<void> {
  await db.run('UPDATE teams SET text_channel_id = ? WHERE id = ?', channelId, teamId);
}

export async function setVoiceChannel(db: Db, teamId: string, channelId: string | null): Promise<void> {
  await db.run('UPDATE teams SET voice_channel_id = ? WHERE id = ?', channelId, teamId);
}

export async function setRole(db: Db, teamId: string, roleId: string | null): Promise<void> {
  await db.run('UPDATE teams SET role_id = ? WHERE id = ?', roleId, teamId);
}

/** Owner settings: visibility (public/private), name, color. */
export async function updateTeamSettings(
  db: Db,
  actor: string,
  teamId: string,
  update: { name?: string; kind?: TeamKind; colorId?: string | null | undefined },
): Promise<Result<Team>> {
  // Read current → merge → write → read back: atomic so the returned row is
  // the one this call wrote.
  return db.transaction(async () => {
    const team = await getTeam(db, teamId);
    if (team === null) return err('not_found', 'Team not found.');
    if (team.kind === 'matched') return err('matched_team', 'Matched teams cannot be edited here.');

    const name = update.name !== undefined ? update.name.trim().replace(/\s+/g, ' ').slice(0, 60) : team.name;
    if (name.length < 3) return err('bad_name', 'Team name must be at least 3 characters.');
    const kind = update.kind ?? (team.kind as TeamKind);
    const colorId = update.colorId !== undefined ? update.colorId : team.colorId;

    await db.run('UPDATE teams SET name = ?, kind = ?, color = ? WHERE id = ?', name, kind, colorId, teamId);
    await audit(db, actor, 'team.settings', team.eventId, { teamId, name, kind, colorId });
    const row = await db.get<TeamRow>('SELECT * FROM teams WHERE id = ?', teamId);
    return ok(toTeam(row!));
  });
}

// ─── guild-level settings (fallback category etc.) ──────────────────────────

export interface GuildSettings {
  teamCategoryId: string | null;
  defaultAnnouncementChannelId: string | null;
  defaultPanelChannelId: string | null;
  defaultCategoryId: string | null;
  defaultCleanupDelayHours: number | null;
  defaultFormTemplateId: string | null;
  defaultScheduleChannelId: string | null;
  modRoleIds: string[];
}

export async function getGuildSettings(db: Db, guildId: string): Promise<GuildSettings> {
  const row = await db.get<{
    team_category_id: string | null;
    default_announcement_channel_id: string | null;
    default_panel_channel_id: string | null;
    default_category_id: string | null;
    default_cleanup_delay_hours: number | null;
    default_form_template_id: string | null;
    default_schedule_channel_id: string | null;
    mod_role_ids: string | null;
  }>(
    'SELECT team_category_id, default_announcement_channel_id, default_panel_channel_id, default_category_id, default_cleanup_delay_hours, default_form_template_id, default_schedule_channel_id, mod_role_ids FROM guild_settings WHERE guild_id = ?',
    guildId,
  );
  let modRoleIds: string[] = [];
  try {
    modRoleIds = row?.mod_role_ids ? (JSON.parse(row.mod_role_ids) as string[]) : [];
  } catch {
    modRoleIds = [];
  }
  if (!Array.isArray(modRoleIds)) modRoleIds = [];
  return {
    teamCategoryId: row?.team_category_id ?? null,
    defaultAnnouncementChannelId: row?.default_announcement_channel_id ?? null,
    defaultPanelChannelId: row?.default_panel_channel_id ?? null,
    defaultCategoryId: row?.default_category_id ?? null,
    defaultCleanupDelayHours: row?.default_cleanup_delay_hours ?? null,
    defaultFormTemplateId: row?.default_form_template_id ?? null,
    defaultScheduleChannelId: row?.default_schedule_channel_id ?? null,
    modRoleIds,
  };
}

export async function setGuildCategory(db: Db, actor: string, guildId: string, categoryId: string | null): Promise<void> {
  await db.run(
    `INSERT INTO guild_settings (guild_id, team_category_id, updated_at) VALUES (?, ?, ?)
     ON CONFLICT(guild_id) DO UPDATE SET team_category_id = excluded.team_category_id, updated_at = excluded.updated_at`,
    guildId,
    categoryId,
    Date.now(),
  );
  await audit(db, actor, 'guild.set_category', guildId, { categoryId });
}

export async function updateGuildSettings(
  db: Db,
  actor: string,
  guildId: string,
  update: Partial<
    Pick<
      GuildSettings,
      | 'teamCategoryId'
      | 'defaultAnnouncementChannelId'
      | 'defaultPanelChannelId'
      | 'defaultCategoryId'
      | 'defaultCleanupDelayHours'
      | 'defaultFormTemplateId'
      | 'defaultScheduleChannelId'
      | 'modRoleIds'
    >
  >,
): Promise<GuildSettings> {
  // Read current → merge → upsert: the returned settings must reflect the row
  // this call wrote, not one a concurrent writer clobbered.
  return db.transaction(async () => {
    const cur = await getGuildSettings(db, guildId);
    const next: GuildSettings = {
      teamCategoryId: update.teamCategoryId !== undefined ? update.teamCategoryId : cur.teamCategoryId,
      defaultAnnouncementChannelId:
        update.defaultAnnouncementChannelId !== undefined ? update.defaultAnnouncementChannelId : cur.defaultAnnouncementChannelId,
      defaultPanelChannelId: update.defaultPanelChannelId !== undefined ? update.defaultPanelChannelId : cur.defaultPanelChannelId,
      defaultCategoryId: update.defaultCategoryId !== undefined ? update.defaultCategoryId : cur.defaultCategoryId,
      defaultCleanupDelayHours:
        update.defaultCleanupDelayHours !== undefined ? update.defaultCleanupDelayHours : cur.defaultCleanupDelayHours,
      defaultFormTemplateId: update.defaultFormTemplateId !== undefined ? update.defaultFormTemplateId : cur.defaultFormTemplateId,
      defaultScheduleChannelId: update.defaultScheduleChannelId !== undefined ? update.defaultScheduleChannelId : cur.defaultScheduleChannelId,
      modRoleIds: update.modRoleIds !== undefined ? update.modRoleIds : cur.modRoleIds,
    };
    await db.run(
      `INSERT INTO guild_settings (guild_id, team_category_id, default_announcement_channel_id, default_panel_channel_id, default_category_id, default_cleanup_delay_hours, default_form_template_id, default_schedule_channel_id, mod_role_ids, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(guild_id) DO UPDATE SET
         team_category_id = excluded.team_category_id,
         default_announcement_channel_id = excluded.default_announcement_channel_id,
         default_panel_channel_id = excluded.default_panel_channel_id,
         default_category_id = excluded.default_category_id,
         default_cleanup_delay_hours = excluded.default_cleanup_delay_hours,
         default_form_template_id = excluded.default_form_template_id,
         default_schedule_channel_id = excluded.default_schedule_channel_id,
         mod_role_ids = excluded.mod_role_ids,
         updated_at = excluded.updated_at`,
      guildId,
      next.teamCategoryId,
      next.defaultAnnouncementChannelId,
      next.defaultPanelChannelId,
      next.defaultCategoryId,
      next.defaultCleanupDelayHours,
      next.defaultFormTemplateId,
      next.defaultScheduleChannelId,
      JSON.stringify(next.modRoleIds),
      Date.now(),
    );
    await audit(db, actor, 'guild.update_settings', guildId, update as Record<string, unknown>);
    return next;
  });
}
