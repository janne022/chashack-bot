/**
 * User-facing subcommands of /hackathon (everything outside the admin group).
 */
import {
  ActionRowBuilder,
  EmbedBuilder,
  MessageFlags,
  StringSelectMenuBuilder,
  StringSelectMenuBuilder as SelectBuilder,
  StringSelectMenuOptionBuilder,
  type ChatInputCommandInteraction,
} from 'discord.js';
import { getParticipant, withdrawParticipant, setTeammates } from '../features/signup/data.js';
import {
  createTeam,
  getTeamForUser,
  getTeam,
  listOpenPublicTeams,
  updateTeamSettings,
  rotateJoinCode,
  countMembers,
} from '../features/teams/data.js';
import { createJoinRequest, listRequestsForUser } from '../features/teams/requests-data.js';
import { TEAM_COLORS } from '../features/form/domain.js';
import { buildSignupModal, buildCreateTeamModal, buildTeamSettingsModal, optionLabel } from './modal.js';
import { IDS, cancelRow, decideRow, displayErr, embedOk, eph, type Ctx } from './shared.js';
import { t } from '../shared/i18n.js';

/** Browser: pick a public team with space → send join request. Shared with the panel button. */
export function teamsBrowser(
  ctx: Ctx,
): { embeds: EmbedBuilder[]; components: ActionRowBuilder<StringSelectMenuBuilder>[] } | null {
  const locale = ctx.botLocale;
  const open = listOpenPublicTeams(ctx.db, ctx.eventId, ctx.config.teamSize);
  if (open.length === 0) return null;
  const select = new SelectBuilder()
    .setCustomId(IDS.teamsSelect)
    .setPlaceholder(t(locale, 'discord.teams.browser_placeholder'))
    .addOptions(
      open.slice(0, 25).map((team) =>
        new StringSelectMenuOptionBuilder()
          .setLabel(`${team.name} (${team.members.length}/${ctx.config.teamSize})`)
          .setDescription(
            team.kind === 'private'
              ? t(locale, 'discord.teams.desc_private')
              : t(locale, 'discord.teams.desc_public'),
          )
          .setValue(team.id),
      ),
    );
  return {
    embeds: [
      embedOk(t(locale, 'discord.teams.browser_title'), t(locale, 'discord.teams.browser_desc')),
    ],
    components: [new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select)],
  };
}

export async function handleUserCommand(
  i: ChatInputCommandInteraction,
  ctx: Ctx,
  sub: string,
): Promise<void> {
  const { db, config, guildId, actor, botLocale: locale } = ctx;

  switch (sub) {
    case 'join': {
      if (!ctx.hasActiveEvent) {
        await i.reply(eph(t(locale, 'discord.gate.no_active')));
        return;
      }
      const existing = getParticipant(db, ctx.eventId, i.user.id);
      if (existing?.status === 'blocked') {
        await i.reply(eph(t(locale, 'errors.blocked')));
        return;
      }
      await i.showModal(buildSignupModal(config, locale));
      return;
    }

    case 'create-team': {
      if (!ctx.hasActiveEvent) {
        await i.reply(eph(t(locale, 'discord.gate.no_active')));
        return;
      }
      if (getParticipant(db, ctx.eventId, i.user.id) === null) {
        await i.reply(eph(t(locale, 'discord.teams.signup_first')));
        return;
      }
      if (getTeamForUser(db, ctx.eventId, i.user.id) !== null) {
        await i.reply(eph(t(locale, 'errors.already_in_team')));
        return;
      }
      await i.showModal(buildCreateTeamModal(locale));
      return;
    }

    case 'team-settings': {
      const team = getTeamForUser(db, ctx.eventId, i.user.id);
      if (team === null) {
        await i.reply(eph(t(locale, 'discord.teams.not_in_team')));
        return;
      }
      if (team.ownerId !== i.user.id) {
        await i.reply(eph(t(locale, 'discord.teams.not_owner')));
        return;
      }
      await i.showModal(buildTeamSettingsModal(team.name, team.kind, team.colorId, locale));
      return;
    }

    case 'teams': {
      if (!ctx.hasActiveEvent) {
        await i.reply(eph(t(locale, 'discord.gate.no_active')));
        return;
      }
      const browser = teamsBrowser(ctx);
      if (browser === null) {
        await i.reply(eph(t(locale, 'discord.teams.none_open')));
        return;
      }
      await i.reply({ ...browser, flags: MessageFlags.Ephemeral });
      return;
    }

    case 'invite': {
      const team = getTeamForUser(db, ctx.eventId, i.user.id);
      if (team === null) {
        await i.reply(eph(t(locale, 'discord.teams.not_in_team_create')));
        return;
      }
      if (team.kind === 'matched') {
        await i.reply(eph(t(locale, 'discord.teams.matched_no_invite')));
        return;
      }
      const target = i.options.getUser('user', true);
      if (target.id === i.user.id) {
        await i.reply(eph(t(locale, 'discord.teams.self_on_team')));
        return;
      }
      if (target.bot) {
        await i.reply(eph(t(locale, 'discord.teams.bots_no_join')));
        return;
      }
      const { createInvite } = await import('../features/teams/requests-data.js');
      const res = createInvite(db, actor, ctx.eventId, guildId, team.id, target.id, config.teamSize);
      if (!res.ok) {
        await i.reply({ embeds: [displayErr(locale, res.code, res.message)], flags: MessageFlags.Ephemeral });
        return;
      }
      // DM the invitee with accept/decline.
      const inviter = `${i.user.username} (from **${team.name}**)`;
      const dmSent = await ctx.dm(target.id, {
        content: t(locale, 'discord.teams.invite_dm', { inviter }),
        embeds: [inviteEmbed(ctx, team.name, team.id)],
        components: [decideRow(IDS.reqAccept, res.value.id, locale)],
      });
      await i.reply({
        embeds: [
          dmSent
            ? embedOk(t(locale, 'discord.teams.invite_sent_title'), t(locale, 'discord.teams.invite_sent_body', { name: target.username }))
            : embedOk(
                t(locale, 'discord.teams.invite_saved_title'),
                t(locale, 'discord.teams.invite_saved_body', { name: target.username }),
              ),
        ],
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    case 'invitations':
    case 'team-requests': {
      const { incoming, outgoing } = listRequestsForUser(db, ctx.eventId, i.user.id, 'pending');
      if (incoming.length === 0 && outgoing.length === 0) {
        await i.reply(eph(t(locale, 'discord.teams.nothing_pending')));
        return;
      }
      const embed = new EmbedBuilder().setTitle(t(locale, 'discord.teams.pending_title')).setColor(0x5865f2);
      const waitingOnMe = incoming.map((r) => {
        const team = getTeam(db, r.teamId);
        const label = r.kind === 'invite' ? t(locale, 'discord.teams.kind_invite') : t(locale, 'discord.teams.kind_join_request');
        return `**${label}** — ${team?.name ?? t(locale, 'discord.teams.unknown_team')} (from <@${r.requesterId}>)`;
      });
      const sent = outgoing.map((r) => {
        const team = getTeam(db, r.teamId);
        return r.kind === 'invite'
          ? `Invite → <@${r.targetId}> for **${team?.name ?? '?'}**`
          : `Join request → **${team?.name ?? '?'}**`;
      });
      if (waitingOnMe.length > 0) embed.addFields({ name: t(locale, 'discord.teams.waiting_on_you'), value: waitingOnMe.join('\n').slice(0, 1024) });
      if (sent.length > 0) embed.addFields({ name: t(locale, 'discord.teams.you_sent'), value: sent.join('\n').slice(0, 1024) });

      const rows: ActionRowBuilder<import('discord.js').ButtonBuilder>[] = [];
      for (const r of incoming.slice(0, 5)) rows.push(decideRow(IDS.reqAccept, r.id, locale));
      for (const r of outgoing.slice(0, 5)) rows.push(cancelRow(r.id, locale));
      await i.reply({ embeds: [embed], components: rows, flags: MessageFlags.Ephemeral });
      return;
    }

    case 'leave': {
      const res = withdrawParticipant(db, actor, ctx.eventId, i.user.id);
      if (!res.ok) {
        await i.reply({ embeds: [displayErr(locale, res.code, res.message)], flags: MessageFlags.Ephemeral });
        return;
      }
      await i.reply({
        embeds: [embedOk(t(locale, 'discord.join.withdrawn_title'), t(locale, 'discord.join.withdrawn_body'))],
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    case 'leave-team': {
      const { leaveTeam } = await import('../features/teams/data.js');
      const res = leaveTeam(db, actor, ctx.eventId, i.user.id);
      if (!res.ok) {
        await i.reply({ embeds: [displayErr(locale, res.code, res.message)], flags: MessageFlags.Ephemeral });
        return;
      }
      await i.reply({
        embeds: [
          embedOk(t(locale, 'discord.teams.left_title'), t(locale, 'discord.teams.left_body', { name: res.value.name })),
        ],
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    case 'join-code': {
      const code = i.options.getString('code', true);
      const { joinPrivateTeam } = await import('../features/teams/data.js');
      const res = joinPrivateTeam(db, actor, ctx.eventId, i.user.id, code, config.teamSize);
      if (!res.ok) {
        await i.reply({ embeds: [displayErr(locale, res.code, res.message)], flags: MessageFlags.Ephemeral });
        return;
      }
      await i.reply({
        embeds: [embedOk(t(locale, 'discord.teams.joined_title'), t(locale, 'discord.teams.joined_body', { name: res.value.name }))],
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    case 'team-code': {
      const team = getTeamForUser(db, ctx.eventId, i.user.id);
      if (team === null) {
        await i.reply(eph(t(locale, 'discord.teams.not_in_team')));
        return;
      }
      if (team.kind !== 'private' || team.joinCode === null) {
        await i.reply(eph(t(locale, 'discord.teams.public_find')));
        return;
      }
      await i.reply(eph(t(locale, 'discord.teams.code_for', { name: team.name, code: team.joinCode })));
      return;
    }

    case 'teammates': {
      if (getParticipant(db, ctx.eventId, i.user.id) === null) {
        await i.reply(eph(t(locale, 'discord.teams.signup_first')));
        return;
      }
      const friendIds = [1, 2, 3, 4, 5]
        .map((n) => i.options.getUser(`friend${n}`)?.id)
        .filter((id): id is string => id !== undefined && id !== i.user.id);
      const res = setTeammates(db, actor, ctx.eventId, i.user.id, friendIds);
      if (!res.ok) {
        await i.reply({ embeds: [displayErr(locale, res.code, res.message)], flags: MessageFlags.Ephemeral });
        return;
      }
      const names = friendIds.map((id) => `<@${id}>`).join(', ') || t(locale, 'discord.teams.nobody_cleared');
      await i.reply({
        embeds: [
          embedOk(
            t(locale, 'discord.teams.teammates_saved_title'),
            t(locale, 'discord.teams.teammates_saved_body', { names }),
          ),
        ],
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    case 'status': {
      const p = getParticipant(db, ctx.eventId, i.user.id);
      if (p === null || p.status === 'withdrawn') {
        await i.reply(eph(t(locale, 'discord.join.no_signup')));
        return;
      }
      const { buildParticipantEmbed } = await import('./shared.js');
      await i.reply({ embeds: [buildParticipantEmbed(db, config, p, locale)], flags: MessageFlags.Ephemeral });
      return;
    }

    default:
      await i.reply(eph(t(locale, 'discord.admin.unknown_sub')));
  }
}

export function inviteEmbed(ctx: Ctx, teamName: string, teamId: string): EmbedBuilder {
  const locale = ctx.botLocale;
  const members = countMembers(ctx.db, teamId);
  return new EmbedBuilder()
    .setTitle(t(locale, 'discord.teams.invite_embed_title', { name: teamName }))
    .setDescription(
      t(locale, 'discord.teams.invite_embed_desc', { count: members, size: ctx.config.teamSize }),
    )
    .setColor(0x5865f2);
}

/** Re-export for other discord modules. */
export { optionLabel, TEAM_COLORS };
