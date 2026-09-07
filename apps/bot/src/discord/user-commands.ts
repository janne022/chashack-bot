/**
 * User-facing subcommands of /hackathon (everything outside the admin group).
 */
import {
  ActionRowBuilder,
  MessageFlags,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  type ChatInputCommandInteraction,
} from 'discord.js';
import { getParticipant, withdrawParticipant, setTeammates } from '../features/signup/store.js';
import {
  createTeam,
  joinPrivateTeam,
  leaveTeam,
  getTeamForUser,
  listOpenPublicTeams,
} from '../features/teams/service.js';
import { buildSignupModal } from './modal.js';
import { IDS, buildParticipantEmbed, displayErr, embedOk, eph, type Ctx } from './shared.js';

export async function handleUserCommand(
  i: ChatInputCommandInteraction,
  ctx: Ctx,
  sub: string,
): Promise<void> {
  const { db, config, guildId, actor } = ctx;

  switch (sub) {
    case 'join': {
      const existing = getParticipant(db, guildId, i.user.id);
      if (existing?.status === 'blocked') {
        await i.reply(eph('You are blocked from signing up. Contact an organizer.'));
        return;
      }
      await i.showModal(buildSignupModal(config));
      return;
    }

    case 'status': {
      const p = getParticipant(db, guildId, i.user.id);
      if (p === null || p.status === 'withdrawn') {
        await i.reply(eph('You have no signup. Use `/hackathon join` to sign up.'));
        return;
      }
      await i.reply({ embeds: [buildParticipantEmbed(db, config, p)], flags: MessageFlags.Ephemeral });
      return;
    }

    case 'teams': {
      const open = listOpenPublicTeams(db, guildId, config.teamSize);
      if (open.length === 0) {
        await i.reply(eph('No open public teams yet. Create one with `/hackathon create-team`!'));
        return;
      }
      const select = new StringSelectMenuBuilder()
        .setCustomId(IDS.teamsSelect)
        .setPlaceholder('Pick a team to join')
        .addOptions(
          open.slice(0, 25).map((t) =>
            new StringSelectMenuOptionBuilder()
              .setLabel(`${t.name} (${t.members.length}/${config.teamSize})`)
              .setValue(t.id),
          ),
        );
      const row = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select);
      await i.reply({
        embeds: [embedOk('Open public teams', 'Pick a team below to join it.')],
        components: [row],
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    case 'leave': {
      const res = withdrawParticipant(db, actor, guildId, i.user.id);
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
      const res = leaveTeam(db, actor, guildId, i.user.id);
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

    case 'create-team': {
      if (getParticipant(db, guildId, i.user.id) === null) {
        await i.reply(eph('Sign up first with `/hackathon join`.'));
        return;
      }
      const name = i.options.getString('name', true);
      const kind = i.options.getString('kind', true) as 'public' | 'private';
      const res = createTeam(db, actor, guildId, name, kind, i.user.id);
      if (!res.ok) {
        await i.reply({ embeds: [displayErr(res.code, res.message)], flags: MessageFlags.Ephemeral });
        return;
      }
      const extra =
        kind === 'private'
          ? `\n**Join code:** \`${res.value.joinCode}\` — share it with your teammates.`
          : '\nOthers can join from `/hackathon teams`.';
      await i.reply({
        embeds: [embedOk('Team created', `**${res.value.name}** (${kind}) is live.${extra}`)],
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    case 'join-code': {
      const code = i.options.getString('code', true);
      const res = joinPrivateTeam(db, actor, guildId, i.user.id, code, config.teamSize);
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
      const team = getTeamForUser(db, guildId, i.user.id);
      if (team === null) {
        await i.reply(eph('You are not in a team.'));
        return;
      }
      if (team.kind !== 'private' || team.joinCode === null) {
        await i.reply(eph('Your team is not private — anyone can join from `/hackathon teams`.'));
        return;
      }
      await i.reply(eph(`Join code for **${team.name}**: \`${team.joinCode}\` — keep it inside the team.`));
      return;
    }

    case 'teammates': {
      if (getParticipant(db, guildId, i.user.id) === null) {
        await i.reply(eph('Sign up first with `/hackathon join`.'));
        return;
      }
      const friendIds = [1, 2, 3, 4, 5]
        .map((n) => i.options.getUser(`friend${n}`)?.id)
        .filter((id): id is string => id !== undefined && id !== i.user.id);
      const res = setTeammates(db, actor, guildId, i.user.id, friendIds);
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

    default:
      await i.reply(eph('Unknown subcommand.'));
  }
}
