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
import { getParticipant, listParticipants, purgeEventParticipants, blockParticipant, unblockParticipant, withdrawParticipant } from '../features/signup/data.js';
import { deleteEventTeams } from '../features/teams/data.js';
import { adminAssign, listTeams, setGuildCategory, getTeam } from '../features/teams/data.js';
import { previewMatch, commitMatch } from '../features/matching/data.js';
import { getForm } from '../features/form/data.js';
import { postOrUpdatePanel } from './signup-panel.js';
import { provisionTeamSpace, grantTeamRole, destroyTeamSpace } from './provision.js';
import {
  createEvent,
  getActiveEvent,
  getEvent,
  listEvents,
  activateEvent,
  endEvent,
  updateEvent,
  getEventForm,
  updateEventForm,
  saveTemplate,
  listTemplates,
  deleteTemplate,
  templateToEventInput,
} from '../features/events/data.js';
import { IDS, confirmRow, displayErr, embedOk, eph, matchPreviewEmbed, type Ctx } from './shared.js';
import { t } from '../shared/i18n.js';

export async function handleAdminCommand(
  i: ChatInputCommandInteraction,
  ctx: Ctx,
  sub: string,
): Promise<void> {
  const { db, config, guildId, actor, botLocale: locale } = ctx;

  switch (sub) {
    case 'form': {
      const c = getForm(db);
      const lines = [
        t(locale, 'discord.admin.form_title_line', { title: c.title }),
        t(locale, 'discord.admin.form_team_size', { size: c.teamSize }),
        t(locale, 'discord.admin.form_experiences', { list: c.experiences.map((e) => e.label).join(', ') }),
        t(locale, 'discord.admin.form_role_tracks', { list: c.roleTracks.map((r) => r.label).join(', ') }),
        t(locale, 'discord.admin.form_skills', { list: c.skills.map((s) => s.label).join(', ') }),
        t(locale, 'discord.admin.form_team_prefs', { list: c.teamPrefs.map((tp) => tp.label).join(', ') }),
        ``,
        t(locale, 'discord.admin.form_edit_hint'),
      ];
      await i.reply({ embeds: [embedOk(t(locale, 'discord.admin.form_title'), lines.join('\n'))], flags: MessageFlags.Ephemeral });
      return;
    }

    case 'block': {
      const user = i.options.getUser('user', true);
      const reason = i.options.getString('reason') ?? t(locale, 'discord.admin.no_reason');
      const res = blockParticipant(db, actor, ctx.eventId, user.id, reason);
      if (!res.ok) {
        await i.reply({ embeds: [displayErr(locale, res.code, res.message)], flags: MessageFlags.Ephemeral });
        return;
      }
      await i.reply({
        content: `<@${user.id}>`,
        embeds: [embedOk(t(locale, 'discord.admin.blocked_title'), t(locale, 'discord.admin.blocked_body', { name: user.username, reason }))],
      });
      return;
    }

    case 'unblock': {
      const user = i.options.getUser('user', true);
      const res = unblockParticipant(db, actor, ctx.eventId, user.id);
      if (!res.ok) {
        await i.reply({ embeds: [displayErr(locale, res.code, res.message)], flags: MessageFlags.Ephemeral });
        return;
      }
      await i.reply({ embeds: [embedOk(t(locale, 'discord.admin.unblocked_title'), t(locale, 'discord.admin.unblocked_body', { name: user.username }))], flags: MessageFlags.Ephemeral });
      return;
    }

    case 'remove': {
      const user = i.options.getUser('user', true);
      const p = getParticipant(db, ctx.eventId, user.id);
      if (p === null) {
        await i.reply(eph(t(locale, 'discord.admin.they_have_no_signup')));
        return;
      }
      await withdrawParticipant(db, actor, ctx.eventId, user.id);
      await i.reply({
        embeds: [embedOk(t(locale, 'discord.admin.removed_title'), t(locale, 'discord.admin.removed_body', { name: p.displayName }))],
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    case 'move': {
      const user = i.options.getUser('user', true);
      const teamArg = i.options.getString('team');
      if (teamArg === null) {
        // No team argument: show a team picker select.
        const teams = listTeams(db, ctx.eventId);
        if (teams.length === 0) {
          await i.reply(eph(t(locale, 'discord.admin.no_teams_yet')));
          return;
        }
        const select = new StringSelectMenuBuilder()
          .setCustomId(`${IDS.adminMoveSelect}:${user.id}`)
          .setPlaceholder(t(locale, 'discord.admin.move_placeholder', { name: user.username }))
          .addOptions(
            new StringSelectMenuOptionBuilder().setLabel(t(locale, 'discord.admin.move_no_team_opt')).setValue('__none__'),
            ...teams.slice(0, 24).map((team) =>
              new StringSelectMenuOptionBuilder().setLabel(`${team.name} (${team.kind})`).setValue(team.id),
            ),
          );
        const row = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select);
        await i.reply({ content: t(locale, 'discord.admin.move_which', { name: user.username }), components: [row], flags: MessageFlags.Ephemeral });
        return;
      }
      const teams = listTeams(db, ctx.eventId);
      const found = teams.find((team) => team.id === teamArg || team.name.toLowerCase() === teamArg.toLowerCase());
      if (found === undefined) {
        await i.reply(eph(t(locale, 'discord.admin.no_such_team', { arg: teamArg })));
        return;
      }
      const res = adminAssign(db, actor, ctx.eventId, user.id, found.id);
      if (!res.ok) {
        await i.reply({ embeds: [displayErr(locale, res.code, res.message)], flags: MessageFlags.Ephemeral });
        return;
      }
      // Provision + role + welcome, best effort (never block the reply).
      const moved = getTeam(db, found.id);
      if (moved !== null) {
        const provisionDeps = { db, client: ctx.client, categoryIdFor: ctx.categoryIdFor };
        void provisionTeamSpace(provisionDeps, moved)
          .then((team) => grantTeamRole(provisionDeps, team, user.id))
          .catch((err) => console.warn('admin move provisioning failed:', err));
      }
      await i.reply({
        embeds: [embedOk(t(locale, 'discord.admin.moved_title'), t(locale, 'discord.admin.moved_body', { user: user.username, team: found.name }))],
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    case 'team-category': {
      const category = i.options.getChannel('category');
      if (category === null) {
        setGuildCategory(db, actor, guildId, null);
        await i.reply({ embeds: [embedOk(t(locale, 'discord.admin.category_cleared_title'), t(locale, 'discord.admin.category_cleared_body'))], flags: MessageFlags.Ephemeral });
        return;
      }
      setGuildCategory(db, actor, guildId, category.id);
      const categoryName = category.name ?? category.id;
      await i.reply({
        embeds: [embedOk(t(locale, 'discord.admin.category_set_title'), t(locale, 'discord.admin.category_set_body', { name: categoryName }))],
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
          await i.reply(eph(res.error === 'No panel exists yet.' ? t(locale, 'discord.admin.panel_no_panel_yet') : res.error));
          return;
        }
        await i.reply({
          embeds: [embedOk(t(locale, 'discord.admin.panel_refreshed_title'), t(locale, 'discord.admin.panel_refreshed_body', { channel: res.channelId }))],
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
            res.edited ? t(locale, 'discord.admin.panel_updated_title') : t(locale, 'discord.admin.panel_posted_title'),
            `${res.edited ? t(locale, 'discord.admin.panel_edited_prefix') : t(locale, 'discord.admin.panel_posted_prefix')} ${t(locale, 'discord.admin.panel_suffix', { channel: res.channelId })}`,
          ),
        ],
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    case 'match-preview': {
      const res = previewMatch(db, ctx.eventId, config);
      if (!res.ok) {
        await i.reply({ embeds: [displayErr(locale, res.code, res.message)], flags: MessageFlags.Ephemeral });
        return;
      }
      await i.reply({
        embeds: [matchPreviewEmbed(res.value, config, locale)],
        components: [confirmRow(IDS.matchConfirm, IDS.matchCancel, t(locale, 'discord.admin.match_confirm_btn'), locale)],
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    case 'match-run': {
      const res = previewMatch(db, ctx.eventId, config);
      if (!res.ok) {
        await i.reply({ embeds: [displayErr(locale, res.code, res.message)], flags: MessageFlags.Ephemeral });
        return;
      }
      await i.reply({
        embeds: [matchPreviewEmbed(res.value, config, locale)],
        components: [confirmRow(IDS.matchConfirm, IDS.matchCancel, t(locale, 'discord.admin.match_confirm_btn'), locale)],
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    case 'reset': {
      const counts = listParticipants(db, ctx.eventId).length;
      const teams = listTeams(db, ctx.eventId).length;
      await i.reply({
        content: t(locale, 'discord.admin.reset_warning', { signups: counts, teams }),
        components: [confirmRow(IDS.resetConfirm, IDS.resetCancel, t(locale, 'discord.admin.reset_confirm_btn'), locale)],
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    default:
      await i.reply(eph(t(locale, 'discord.admin.unknown_admin_sub')));
  }
}

/** Commit handler shared with the confirm-button flow. */
export async function commitMatchAndAnnounce(
  i: import('discord.js').ButtonInteraction | import('discord.js').StringSelectMenuInteraction,
  ctx: Ctx,
  announce: (guildId: string, content: string) => Promise<void>,
): Promise<void> {
  const locale = ctx.botLocale;
  const res = commitMatch(ctx.db, ctx.actor, ctx.eventId, ctx.guildId, ctx.config);
  if (!res.ok) {
    await i.update({ embeds: [displayErr(locale, res.code, res.message)], components: [] });
    return;
  }

  // Provision every matched team space and grant roles to all members.
  const provisionDeps = { db: ctx.db, client: ctx.client, categoryIdFor: ctx.categoryIdFor };
  const { getTeam } = await import('../features/teams/data.js');
  const { listParticipants } = await import('../features/signup/data.js');
  const allParticipants = listParticipants(ctx.db, ctx.eventId);
  for (const matchTeam of res.value.teams) {
    const stored = (await import('../features/teams/data.js')).listTeams(ctx.db, ctx.eventId).find((team) => team.name === matchTeam.name);
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
    embeds: [embedOk(t(locale, 'discord.admin.committed_title'), t(locale, 'discord.admin.committed_body', { count: res.value.teams.length }))],
    components: [],
  });
  const lines = res.value.teams.map((team) => {
    const members = team.memberIds.map((id) => `<@${id}>`).join(', ');
    return `**${team.name}** — ${t(locale, 'discord.admin.compatibility')} ${team.score}\n${members}`;
  });
  await announce(ctx.guildId, `${t(locale, 'discord.admin.teams_locked_title')}\n\n${lines.join('\n\n')}`);
}

/** Reset handler shared with the confirm-button flow. */
export async function resetEventConfirmed(
  i: import('discord.js').ButtonInteraction | import('discord.js').StringSelectMenuInteraction,
  ctx: Ctx,
): Promise<void> {
  const locale = ctx.botLocale;
  // Tear down Discord spaces for all teams first (we lose the ids after reset).
  const teams = listTeams(ctx.db, ctx.guildId);
  const provisionDeps = { db: ctx.db, client: ctx.client, categoryIdFor: ctx.categoryIdFor };
  for (const team of teams) {
    await destroyTeamSpace(provisionDeps, team);
  }
  const participants = purgeEventParticipants(ctx.db, ctx.actor, ctx.eventId);
  const teamCount = deleteEventTeams(ctx.db, ctx.actor, ctx.eventId);
  await i.update({
    content: t(locale, 'discord.admin.reset_done', { signups: participants, teams: teamCount }),
    components: [],
  });
}
