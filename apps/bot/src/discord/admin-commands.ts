/**
 * Organizer subcommands (/hackathon admin ...).
 */
import {
  ActionRowBuilder,
  MessageFlags,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  type ChatInputCommandInteraction,
} from 'discord.js';
import { getParticipant, listParticipants, resetEvent, blockParticipant, unblockParticipant, withdrawParticipant } from '../features/signup/store.js';
import { adminAssign, listTeams, setGuildCategory, getTeam } from '../features/teams/service.js';
import { previewMatch, commitMatch } from '../features/matching/service.js';
import { getForm } from '../features/form/service.js';
import { postOrUpdatePanel } from './signup-panel.js';
import { provisionTeamSpace, grantTeamRole, destroyTeamSpace } from './provision.js';
import { IDS, confirmRow, displayErr, embedOk, eph, matchPreviewEmbed, type Ctx } from './shared.js';

export async function handleAdminCommand(
  i: ChatInputCommandInteraction,
  ctx: Ctx,
  sub: string,
): Promise<void> {
  const { db, config, guildId, actor } = ctx;

  switch (sub) {
    case 'form': {
      const c = getForm(db);
      const lines = [
        `**Title:** ${c.title}`,
        `**Team size:** ${c.teamSize}`,
        `**Experience options:** ${c.experiences.map((e) => e.label).join(', ')}`,
        `**Role tracks:** ${c.roleTracks.map((r) => r.label).join(', ')}`,
        `**Skills:** ${c.skills.map((s) => s.label).join(', ')}`,
        `**Team prefs:** ${c.teamPrefs.map((t) => t.label).join(', ')}`,
        ``,
        `Edit this in the admin web UI (Form tab).`,
      ];
      await i.reply({ embeds: [embedOk('Current form config', lines.join('\n'))], flags: MessageFlags.Ephemeral });
      return;
    }

    case 'block': {
      const user = i.options.getUser('user', true);
      const reason = i.options.getString('reason') ?? 'No reason given';
      const res = blockParticipant(db, actor, guildId, user.id, reason);
      if (!res.ok) {
        await i.reply({ embeds: [displayErr(res.code, res.message)], flags: MessageFlags.Ephemeral });
        return;
      }
      await i.reply({
        content: `<@${user.id}>`,
        embeds: [embedOk('Blocked', `**${user.username}** can no longer sign up. Reason: ${reason}`)],
      });
      return;
    }

    case 'unblock': {
      const user = i.options.getUser('user', true);
      const res = unblockParticipant(db, actor, guildId, user.id);
      if (!res.ok) {
        await i.reply({ embeds: [displayErr(res.code, res.message)], flags: MessageFlags.Ephemeral });
        return;
      }
      await i.reply({ embeds: [embedOk('Unblocked', `**${user.username}** can sign up again.`)], flags: MessageFlags.Ephemeral });
      return;
    }

    case 'remove': {
      const user = i.options.getUser('user', true);
      const p = getParticipant(db, guildId, user.id);
      if (p === null) {
        await i.reply(eph('They have no signup.'));
        return;
      }
      await withdrawParticipant(db, actor, guildId, user.id);
      await i.reply({
        embeds: [embedOk('Signup removed', `Removed **${p.displayName}**'s signup and took them off any team.`)],
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    case 'move': {
      const user = i.options.getUser('user', true);
      const teamArg = i.options.getString('team');
      if (teamArg === null) {
        // No team argument: show a team picker select.
        const teams = listTeams(db, guildId);
        if (teams.length === 0) {
          await i.reply(eph('No teams exist yet. Run matching or let users create teams first.'));
          return;
        }
        const select = new StringSelectMenuBuilder()
          .setCustomId(`${IDS.adminMoveSelect}:${user.id}`)
          .setPlaceholder(`Move ${user.username} to…`)
          .addOptions(
            new StringSelectMenuOptionBuilder().setLabel('🚫 No team (unassign)').setValue('__none__'),
            ...teams.slice(0, 24).map((t) =>
              new StringSelectMenuOptionBuilder().setLabel(`${t.name} (${t.kind})`).setValue(t.id),
            ),
          );
        const row = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select);
        await i.reply({ content: `Which team for **${user.username}**?`, components: [row], flags: MessageFlags.Ephemeral });
        return;
      }
      const teams = listTeams(db, guildId);
      const found = teams.find((t) => t.id === teamArg || t.name.toLowerCase() === teamArg.toLowerCase());
      if (found === undefined) {
        await i.reply(eph(`No team named "${teamArg}". Use /hackathon admin move with no team to get a picker.`));
        return;
      }
      const res = adminAssign(db, actor, guildId, user.id, found.id);
      if (!res.ok) {
        await i.reply({ embeds: [displayErr(res.code, res.message)], flags: MessageFlags.Ephemeral });
        return;
      }
      // Provision + role + welcome, best effort (never block the reply).
      const moved = getTeam(db, found.id);
      if (moved !== null) {
        const provisionDeps = { db, client: ctx.client, categoryIdFor: ctx.categoryIdFor };
        void provisionTeamSpace(provisionDeps, moved)
          .then((t) => grantTeamRole(provisionDeps, t, user.id))
          .catch((err) => console.warn('admin move provisioning failed:', err));
      }
      await i.reply({
        embeds: [embedOk('Moved', `**${user.username}** → **${found.name}**.`)],
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    case 'team-category': {
      const category = i.options.getChannel('category');
      if (category === null) {
        setGuildCategory(db, actor, guildId, null);
        await i.reply({ embeds: [embedOk('Category cleared', 'Team channels will be created at the server top level (or TEAM_CATEGORY_ID env fallback).')], flags: MessageFlags.Ephemeral });
        return;
      }
      setGuildCategory(db, actor, guildId, category.id);
      await i.reply({
        embeds: [embedOk('Category set', `Team text/voice channels will be created under **${category.name}**.`)],
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    case 'panel': {
      const channel = i.options.getChannel('channel');
      const target = channel !== null ? channel.id : undefined;
      if (target === undefined) {
        // Refresh in the stored channel.
        const res = await postOrUpdatePanel(db, ctx.client, guildId, '');
        if ('error' in res) {
          await i.reply(eph(res.error === 'No panel exists yet.' ? 'No panel exists yet — pass a channel.' : res.error));
          return;
        }
        await i.reply({
          embeds: [embedOk('Panel refreshed', `Updated in <#${res.channelId}>.`)],
          flags: MessageFlags.Ephemeral,
        });
        return;
      }
      const res = await postOrUpdatePanel(db, ctx.client, guildId, target);
      if ('error' in res) {
        await i.reply(eph(res.error));
        return;
      }
      await i.reply({
        embeds: [
          embedOk(
            res.edited ? 'Panel updated' : 'Panel posted',
            `${res.edited ? 'Edited the existing panel' : 'Posted a new panel'} in <#${res.channelId}>. It auto-refreshes when the form config changes.`,
          ),
        ],
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    case 'match-preview': {
      const res = previewMatch(db, guildId, config);
      if (!res.ok) {
        await i.reply({ embeds: [displayErr(res.code, res.message)], flags: MessageFlags.Ephemeral });
        return;
      }
      await i.reply({
        embeds: [matchPreviewEmbed(res.value, config)],
        components: [confirmRow(IDS.matchConfirm, IDS.matchCancel, 'Commit these teams')],
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    case 'match-run': {
      const res = previewMatch(db, guildId, config);
      if (!res.ok) {
        await i.reply({ embeds: [displayErr(res.code, res.message)], flags: MessageFlags.Ephemeral });
        return;
      }
      await i.reply({
        embeds: [matchPreviewEmbed(res.value, config)],
        components: [confirmRow(IDS.matchConfirm, IDS.matchCancel, 'Commit these teams')],
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    case 'reset': {
      const counts = listParticipants(db, guildId).length;
      const teams = listTeams(db, guildId).length;
      await i.reply({
        content: `⚠️ **Reset the event?** This permanently deletes **${counts} signups** and **${teams} teams**. The form config is kept.`,
        components: [confirmRow(IDS.resetConfirm, IDS.resetCancel, 'Yes, reset everything')],
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    default:
      await i.reply(eph('Unknown admin subcommand.'));
  }
}

/** Commit handler shared with the confirm-button flow. */
export async function commitMatchAndAnnounce(
  i: import('discord.js').ButtonInteraction | import('discord.js').StringSelectMenuInteraction,
  ctx: Ctx,
  announce: (guildId: string, content: string) => Promise<void>,
): Promise<void> {
  const res = commitMatch(ctx.db, ctx.actor, ctx.guildId, ctx.config);
  if (!res.ok) {
    await i.update({ embeds: [displayErr(res.code, res.message)], components: [] });
    return;
  }

  // Provision every matched team space and grant roles to all members.
  const provisionDeps = { db: ctx.db, client: ctx.client, categoryIdFor: ctx.categoryIdFor };
  const { getTeam } = await import('../features/teams/service.js');
  const { listParticipants } = await import('../features/signup/store.js');
  const allParticipants = listParticipants(ctx.db, ctx.guildId);
  for (const matchTeam of res.value.teams) {
    const stored = (await import('../features/teams/service.js')).listTeams(ctx.db, ctx.guildId).find((t) => t.name === matchTeam.name);
    if (stored === undefined) continue;
    const provisioned = await provisionTeamSpace(provisionDeps, stored);
    for (const memberId of matchTeam.memberIds) {
      await grantTeamRole(provisionDeps, provisioned, memberId);
    }
    const roster = matchTeam.memberIds.map((id) => ({
      userId: id,
      displayName: allParticipants.find((p) => p.userId === id)?.displayName ?? id,
    }));
    const first = matchTeam.memberIds[0];
    if (first !== undefined) {
      await (await import('./provision.js')).sendJoinWelcome(provisionDeps, provisioned, first, roster);
    }
  }

  await i.update({
    embeds: [embedOk('Teams committed', `${res.value.teams.length} teams created, provisioned and announced.`)],
    components: [],
  });
  const lines = res.value.teams.map((t) => {
    const members = t.memberIds.map((id) => `<@${id}>`).join(', ');
    return `**${t.name}** — compatibility ${t.score}\n${members}`;
  });
  await announce(ctx.guildId, `🏁 **Teams are locked in!**\n\n${lines.join('\n\n')}`);
}

/** Reset handler shared with the confirm-button flow. */
export async function resetEventConfirmed(
  i: import('discord.js').ButtonInteraction | import('discord.js').StringSelectMenuInteraction,
  ctx: Ctx,
): Promise<void> {
  // Tear down Discord spaces for all teams first (we lose the ids after reset).
  const teams = listTeams(ctx.db, ctx.guildId);
  const provisionDeps = { db: ctx.db, client: ctx.client, categoryIdFor: ctx.categoryIdFor };
  for (const team of teams) {
    await destroyTeamSpace(provisionDeps, team);
  }
  const res = resetEvent(ctx.db, ctx.actor, ctx.guildId);
  if (!res.ok) {
    await i.update({ content: `Reset failed: ${res.message}`, components: [] });
    return;
  }
  await i.update({
    content: `✅ Event reset. Removed ${res.value.participants} signups, ${res.value.teams} teams and their channels/roles. Ready for a new event.`,
    components: [],
  });
}
