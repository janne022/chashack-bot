/**
 * User-facing subcommands of /hackathon (everything outside the admin group).
 */
import {
  ActionRowBuilder,
  EmbedBuilder,
  MessageFlags,
  StringSelectMenuBuilder,
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
import { TEAM_COLORS, labelFor } from '../features/form/domain.js';
import { buildSignupModal, buildCreateTeamModal, buildTeamSettingsModal } from './modal.js';
import { IDS, cancelRow, decideRow, displayErr, embedOk, eph, type Ctx } from './shared.js';

/** Browser: pick a public team with space → send join request. Shared with the panel button. */
export function teamsBrowser(ctx: Ctx): { embeds: EmbedBuilder[]; components: ActionRowBuilder<StringSelectMenuBuilder>[] } | null {
  const open = listOpenPublicTeams(ctx.db, ctx.eventId, ctx.config.teamSize);
  if (open.length === 0) return null;
  const select = new StringSelectMenuBuilder()
    .setCustomId(IDS.teamsSelect)
    .setPlaceholder('Pick a team to ask to join')
    .addOptions(
      open.slice(0, 25).map((t) =>
        new StringSelectMenuOptionBuilder()
          .setLabel(`${t.name} (${t.members.length}/${ctx.config.teamSize})`)
          .setDescription(t.kind === 'private' ? 'private — needs invite or code' : 'public team')
          .setValue(t.id),
      ),
    );
  return {
    embeds: [
      embedOk(
        'Teams looking for people',
        'Pick a team to send a join request. The owner gets your request and accepts or declines — you will get a DM with the decision.',
      ),
    ],
    components: [new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select)],
  };
}

export async function handleUserCommand(
  i: ChatInputCommandInteraction,
  ctx: Ctx,
  sub: string,
): Promise<void> {
  const { db, config, guildId, actor } = ctx;

  switch (sub) {
    case 'join': {
      const existing = getParticipant(db, ctx.eventId, i.user.id);
      if (existing?.status === 'blocked') {
        await i.reply(eph('You are blocked from signing up. Contact an organizer.'));
        return;
      }
      await i.showModal(buildSignupModal(config));
      return;
    }

    case 'create-team': {
      if (getParticipant(db, ctx.eventId, i.user.id) === null) {
        await i.reply(eph('Sign up first with `/hackathon join`.'));
        return;
      }
      if (getTeamForUser(db, ctx.eventId, i.user.id) !== null) {
        await i.reply(eph('You are already in a team. Use `/hackathon leave-team` first.'));
        return;
      }
      await i.showModal(buildCreateTeamModal());
      return;
    }

    case 'team-settings': {
      const team = getTeamForUser(db, ctx.eventId, i.user.id);
      if (team === null) {
        await i.reply(eph('You are not in a team.'));
        return;
      }
      if (team.ownerId !== i.user.id) {
        await i.reply(eph('Only the team owner can change team settings.'));
        return;
      }
      await i.showModal(buildTeamSettingsModal(team.name, team.kind, team.colorId));
      return;
    }

    case 'teams': {
      const browser = teamsBrowser(ctx);
      if (browser === null) {
        await i.reply(eph('No teams with open space right now. Create one with `/hackathon create-team`!'));
        return;
      }
      await i.reply({ ...browser, flags: MessageFlags.Ephemeral });
      return;
    }

    case 'invite': {
      const team = getTeamForUser(db, ctx.eventId, i.user.id);
      if (team === null) {
        await i.reply(eph('You are not in a team. Create one with `/hackathon create-team`.'));
        return;
      }
      if (team.kind === 'matched') {
        await i.reply(eph('Matched teams cannot invite — the matching engine built them.'));
        return;
      }
      const target = i.options.getUser('user', true);
      if (target.id === i.user.id) {
        await i.reply(eph('You are already on the team 🙂'));
        return;
      }
      if (target.bot) {
        await i.reply(eph('Bots cannot join teams.'));
        return;
      }
      const { createInvite } = await import('../features/teams/requests-data.js');
      const res = createInvite(db, actor, ctx.eventId, guildId, team.id, target.id, config.teamSize);
      if (!res.ok) {
        await i.reply({ embeds: [displayErr(res.code, res.message)], flags: MessageFlags.Ephemeral });
        return;
      }
      // DM the invitee with accept/decline.
      const inviter = `${i.user.username} (from **${team.name}**)`;
      const dmSent = await ctx.dm(target.id, {
        content: `📨 **${inviter}** invited you to join their hackathon team!`,
        embeds: [inviteEmbed(ctx, team.name, team.id)],
        components: [decideRow(IDS.reqAccept, res.value.id)],
      });
      await i.reply({
        embeds: [
          dmSent
            ? embedOk('Invite sent', `**${target.username}** got a DM with accept/decline buttons.`)
            : embedOk(
                'Invite saved',
                `**${target.username}** has DMs closed, so they can accept via \`/hackathon invitations\`.`,
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
        await i.reply(eph('Nothing pending. Invites to you and join requests to your teams show up here.'));
        return;
      }
      const embed = new EmbedBuilder().setTitle('Pending requests').setColor(0x5865f2);
      const waitingOnMe = incoming.map((r) => {
        const team = getTeam(db, r.teamId);
        const label = r.kind === 'invite' ? 'Invite' : 'Join request';
        return `**${label}** — ${team?.name ?? 'unknown team'} (from <@${r.requesterId}>)`;
      });
      const sent = outgoing.map((r) => {
        const team = getTeam(db, r.teamId);
        return r.kind === 'invite' ? `Invite → <@${r.targetId}> for **${team?.name ?? '?'}**` : `Join request → **${team?.name ?? '?'}**`;
      });
      if (waitingOnMe.length > 0) embed.addFields({ name: 'Waiting on you', value: waitingOnMe.join('\n').slice(0, 1024) });
      if (sent.length > 0) embed.addFields({ name: 'You sent', value: sent.join('\n').slice(0, 1024) });

      const rows: ActionRowBuilder<import('discord.js').ButtonBuilder>[] = [];
      for (const r of incoming.slice(0, 5)) rows.push(decideRow(IDS.reqAccept, r.id));
      for (const r of outgoing.slice(0, 5)) rows.push(cancelRow(r.id));
      await i.reply({ embeds: [embed], components: rows, flags: MessageFlags.Ephemeral });
      return;
    }

    case 'leave': {
      const res = withdrawParticipant(db, actor, ctx.eventId, i.user.id);
      if (!res.ok) {
        await i.reply({ embeds: [displayErr(res.code, res.message)], flags: MessageFlags.Ephemeral });
        return;
      }
      await i.reply({
        embeds: [embedOk('Signup withdrawn', 'Your signup was removed. Sign up again any time with `/hackathon join`.')],
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    case 'leave-team': {
      const { leaveTeam } = await import('../features/teams/data.js');
      const res = leaveTeam(db, actor, ctx.eventId, i.user.id);
      if (!res.ok) {
        await i.reply({ embeds: [displayErr(res.code, res.message)], flags: MessageFlags.Ephemeral });
        return;
      }
      await i.reply({
        embeds: [
          embedOk('Left the team', `You left **${res.value.name}**. Your signup is kept — find another with \`/hackathon teams\`.`),
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
        await i.reply({ embeds: [displayErr(res.code, res.message)], flags: MessageFlags.Ephemeral });
        return;
      }
      await i.reply({
        embeds: [embedOk('Joined!', `You joined **${res.value.name}**.`)],
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    case 'team-code': {
      const team = getTeamForUser(db, ctx.eventId, i.user.id);
      if (team === null) {
        await i.reply(eph('You are not in a team.'));
        return;
      }
      if (team.kind !== 'private' || team.joinCode === null) {
        await i.reply(eph('Your team is public — people find it in `/hackathon teams`.'));
        return;
      }
      await i.reply(eph(`Join code for **${team.name}**: \`${team.joinCode}\` — keep it inside the team.`));
      return;
    }

    case 'teammates': {
      if (getParticipant(db, ctx.eventId, i.user.id) === null) {
        await i.reply(eph('Sign up first with `/hackathon join`.'));
        return;
      }
      const friendIds = [1, 2, 3, 4, 5]
        .map((n) => i.options.getUser(`friend${n}`)?.id)
        .filter((id): id is string => id !== undefined && id !== i.user.id);
      const res = setTeammates(db, actor, ctx.eventId, i.user.id, friendIds);
      if (!res.ok) {
        await i.reply({ embeds: [displayErr(res.code, res.message)], flags: MessageFlags.Ephemeral });
        return;
      }
      const names = friendIds.map((id) => `<@${id}>`).join(', ') || 'nobody (cleared)';
      await i.reply({
        embeds: [
          embedOk(
            'Teammates saved',
            `You want on a team with: ${names}.\nThey must sign up too and mention you back for it to count as mutual.`,
          ),
        ],
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    case 'status': {
      const p = getParticipant(db, ctx.eventId, i.user.id);
      if (p === null || p.status === 'withdrawn') {
        await i.reply(eph('You have no signup. Use `/hackathon join` to sign up.'));
        return;
      }
      const { buildParticipantEmbed } = await import('./shared.js');
      await i.reply({ embeds: [buildParticipantEmbed(db, config, p)], flags: MessageFlags.Ephemeral });
      return;
    }

    default:
      await i.reply(eph('Unknown subcommand.'));
  }
}

export function inviteEmbed(ctx: Ctx, teamName: string, teamId: string): EmbedBuilder {
  const members = countMembers(ctx.db, teamId);
  return new EmbedBuilder()
    .setTitle(`Team: ${teamName}`)
    .setDescription(
      `**${members}/${ctx.config.teamSize}** members so far.\nAccepting puts you on the team with a private text + voice channel.`,
    )
    .setColor(0x5865f2);
}

/** Exported for the admin panel label helpers. */
export { labelFor, TEAM_COLORS };
