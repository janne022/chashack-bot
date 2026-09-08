/**
 * Discord provisioning for teams: role with color, private text channel +
 * voice channel under the configured category, member role management and
 * the kickoff/welcome message when someone joins.
 *
 * All Discord-API concerns live here; services stay pure. Every function is
 * best-effort with logged warnings — a failed channel create must never break
 * the team join itself.
 */
import {
  ChannelType,
  PermissionFlagsBits,
  type CategoryChannelResolvable,
  type Client,
  type Guild,
} from 'discord.js';
import type { Db } from '../shared/db.js';
import { setProvisioning, setRole, setTextChannel, setVoiceChannel } from '../features/teams/data.js';
import type { Team } from '../features/teams/data.js';
import { teamColor } from '../features/form/domain.js';
import { t } from '../shared/i18n.js';
import { env } from '../shared/env.js';

const MANAGE_FLAGS = [
  PermissionFlagsBits.ViewChannel,
  PermissionFlagsBits.SendMessages,
  PermissionFlagsBits.Connect,
  PermissionFlagsBits.CreatePublicThreads,
  PermissionFlagsBits.CreatePrivateThreads,
  PermissionFlagsBits.AddReactions,
  PermissionFlagsBits.AttachFiles,
  PermissionFlagsBits.UseExternalEmojis,
];

export interface ProvisionDeps {
  db: Db;
  client: Client;
  /** Category for team spaces (guild_settings or env fallback). */
  categoryIdFor: (guildId: string) => string | undefined;
}

async function ensureCategory(guild: Guild, categoryId: string | undefined): Promise<CategoryChannelResolvable | undefined> {
  if (categoryId === undefined) return undefined;
  try {
    const channel = await guild.channels.fetch(categoryId);
    if (channel !== null && channel.type === ChannelType.GuildCategory) return channel;
  } catch {
    /* category deleted or not visible — fall through to uncategorized */
  }
  return undefined;
}

/** Bot locale from env, read lazily so tests without env setup still work. */
export function botLocale(): 'en' | 'sv' {
  try {
    return env().botLanguage;
  } catch {
    return 'en';
  }
}

/**
 * Create role + text/voice channels for a team and persist the ids.
 * Skips parts that already exist (idempotent, also used after partial failures).
 */
export async function provisionTeamSpace(deps: ProvisionDeps, team: Team): Promise<Team> {
  const locale = botLocale();
  const guild = await deps.client.guilds.fetch(team.guildId).catch(() => null);
  if (guild === null) return team;

  const members = await guild.members.fetch().catch(() => null);
  const botMember = guild.members.me;

  // ── role ─────────────────────────────────────────────────────────────────
  let roleId = team.roleId;
  if (roleId === null) {
    try {
      const color = teamColor(team.colorId);
      const role = await guild.roles.create({
        name: team.name.slice(0, 100),
        color: color.int,
        mentionable: true,
        reason: t(locale, 'discord.provision.reason_create_role', { team: team.name }),
      });
      roleId = role.id;
      setRole(deps.db, team.id, roleId);
    } catch (error) {
      console.warn(`provision role failed for ${team.name}:`, error);
    }
  }

  // Permission overwrites: team role sees it, everyone else does not.
  const overwrites: { id: string; allow?: bigint[]; deny?: bigint[] }[] = [];
  if (roleId !== null) overwrites.push({ id: roleId, allow: MANAGE_FLAGS });
  if (botMember !== null) {
    overwrites.push({
      id: botMember.id,
      allow: [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.Connect,
        PermissionFlagsBits.ManageChannels,
        PermissionFlagsBits.ManageRoles,
      ],
    });
  }
  overwrites.push({ id: guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] });

  const category = await ensureCategory(guild, deps.categoryIdFor(team.guildId));

  // ── text channel ─────────────────────────────────────────────────────────
  let textChannelId = team.textChannelId;
  if (textChannelId === null) {
    try {
      const channel = await guild.channels.create({
        name: team.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 90) || 'team',
        type: ChannelType.GuildText,
        topic: t(locale, 'discord.provision.channel_topic', { team: team.name }),
        parent: category ?? null,
        permissionOverwrites: overwrites,
      });
      textChannelId = channel.id;
      setTextChannel(deps.db, team.id, textChannelId);
    } catch (error) {
      console.warn(`provision text channel failed for ${team.name}:`, error);
    }
  }

  // ── voice channel ────────────────────────────────────────────────────────
  let voiceChannelId = team.voiceChannelId;
  if (voiceChannelId === null) {
    try {
      const channel = await guild.channels.create({
        name: team.name.slice(0, 90),
        type: ChannelType.GuildVoice,
        parent: category ?? null,
        permissionOverwrites: overwrites,
      });
      voiceChannelId = channel.id;
      setVoiceChannel(deps.db, team.id, voiceChannelId);
    } catch (error) {
      console.warn(`provision voice channel failed for ${team.name}:`, error);
    }
  }

  if (roleId !== null && textChannelId !== null && voiceChannelId !== null) {
    setProvisioning(deps.db, team.id, { roleId, textChannelId, voiceChannelId });
  }

  return {
    ...team,
    roleId,
    textChannelId,
    voiceChannelId,
  };
}

/** Grant the team role to a member (join/accept). */
export async function grantTeamRole(deps: ProvisionDeps, team: Team, userId: string): Promise<void> {
  if (team.roleId === null) return;
  try {
    const guild = await deps.client.guilds.fetch(team.guildId);
    const member = await guild.members.fetch(userId);
    if (!member.roles.cache.has(team.roleId)) {
      await member.roles.add(team.roleId, t(botLocale(), 'discord.provision.reason_grant'));
    }
  } catch (error) {
    console.warn(`grant role failed:`, error);
  }
}

/** Revoke the team role (leave/kick/delete). */
export async function revokeTeamRole(deps: ProvisionDeps, team: Team, userId: string): Promise<void> {
  if (team.roleId === null) return;
  try {
    const guild = await deps.client.guilds.fetch(team.guildId);
    const member = await guild.members.fetch(userId).catch(() => null);
    if (member !== null && member.roles.cache.has(team.roleId)) {
      await member.roles.remove(team.roleId, t(botLocale(), 'discord.provision.reason_revoke'));
    }
  } catch (error) {
    console.warn(`revoke role failed:`, error);
  }
}

/** Kickoff message in the team channel: who is here, what to do next. */
export async function sendJoinWelcome(
  deps: ProvisionDeps,
  team: Team,
  joinerId: string,
  roster: { userId: string; displayName: string }[],
): Promise<void> {
  if (team.textChannelId === null) return;
  const locale = botLocale();
  try {
    const guild = await deps.client.guilds.fetch(team.guildId);
    const channel = await guild.channels.fetch(team.textChannelId);
    if (channel === null || !channel.isTextBased()) return;

    const names = roster.map((m) => `<@${m.userId}>`).join(', ');
    const isFounder = team.ownerId === joinerId;
    const lines = isFounder
      ? [t(locale, 'discord.provision.welcome_live', { team: team.name }), ``, t(locale, 'discord.provision.welcome_founder', { user: joinerId }), t(locale, 'discord.provision.welcome_roster', { names })]
      : [t(locale, 'discord.provision.welcome_joined', { user: joinerId, team: team.name }), ``, t(locale, 'discord.provision.welcome_roster', { names })];
    if (isFounder) {
      lines.push(
        ``,
        t(locale, 'discord.provision.welcome_invite_hint'),
        t(locale, 'discord.provision.welcome_settings_hint'),
      );
    }
    await channel.send({ content: lines.join('\n') });
  } catch (error) {
    console.warn('welcome message failed:', error);
  }
}

/** Delete role and channels when a team is deleted or the event resets. */
export async function destroyTeamSpace(deps: ProvisionDeps, team: Team): Promise<void> {
  const locale = botLocale();
  const guild = await deps.client.guilds.fetch(team.guildId).catch(() => null);
  if (guild === null) return;

  for (const channelId of [team.textChannelId, team.voiceChannelId]) {
    if (channelId === null) continue;
    await guild.channels.delete(channelId, t(locale, 'discord.provision.reason_delete')).catch(() => undefined);
  }
  if (team.roleId !== null) {
    const role = await guild.roles.fetch(team.roleId).catch(() => null);
    if (role !== null) await role.delete(t(locale, 'discord.provision.reason_delete')).catch(() => undefined);
  }
}

/** Update the role color after team-settings changes. */
export async function syncRoleColor(deps: ProvisionDeps, team: Team): Promise<void> {
  if (team.roleId === null) return;
  const locale = botLocale();
  try {
    const guild = await deps.client.guilds.fetch(team.guildId);
    const role = await guild.roles.fetch(team.roleId);
    if (role !== null) {
      await role.setColor(teamColor(team.colorId).int, t(locale, 'discord.provision.reason_color'));
      await role.setName(team.name.slice(0, 100), t(locale, 'discord.provision.reason_rename')).catch(() => undefined);
    }
  } catch (error) {
    console.warn('role color sync failed:', error);
  }
}

/** Re-grant roles to all members (used when provisioning runs late, e.g. after a failure). */
export async function grantAllTeamRoles(deps: ProvisionDeps, team: Team, memberIds: string[]): Promise<void> {
  for (const id of memberIds) {
    await grantTeamRole(deps, team, id);
  }
}

/**
 * Everything that happens when someone becomes part of a team: provision the
 * space (idempotent), grant the role, announce in the team channel.
 * Returns the (possibly updated) team.
 */
export async function applyTeamJoin(
  deps: ProvisionDeps,
  team: Team,
  joinerId: string,
): Promise<Team> {
  const provisioned = await provisionTeamSpace(deps, team);
  await grantTeamRole(deps, provisioned, joinerId);

  const roster = (
    deps.db
      .prepare(
        "SELECT user_id, display_name FROM participants WHERE team_id = ? AND status = 'active' ORDER BY created_at",
      )
      .all(provisioned.id) as unknown as { user_id: string; display_name: string }[]
  ).map((r) => ({ userId: r.user_id, displayName: r.display_name }));
  await sendJoinWelcome(deps, provisioned, joinerId, roster);
  return provisioned;
}
