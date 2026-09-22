/**
 * Event-centric admin subcommands and the user-facing /hackathon event view.
 */
import {
  EmbedBuilder,
  MessageFlags,
  type ChatInputCommandInteraction,
} from 'discord.js';
import { audit } from '../shared/audit.js';
import {
  createEvent,
  getActiveEvent,
  getEvent,
  getEventForm,
  listEvents,
  activateEvent,
  endEvent,
  updateEvent,
  saveTemplate,
  listTemplates,
  deleteTemplate,
  setMatchAt,
  markMatchLocked,
  markMatchUnlocked,
  templateToEventInput,
} from '../features/events/data.js';
import { DEFAULT_FORM } from '../features/form/domain.js';
import { listParticipants } from '../features/signup/data.js';
import { listTeams } from '../features/teams/data.js';
import { postOrUpdatePanel } from './signup-panel.js';
import { postOrUpdateScheduleItinerary } from './schedule-itinerary.js';
import { displayErr, embedOk, eph, type Ctx } from './shared.js';
import { t } from '../shared/i18n.js';
import { env } from '../shared/env.js';

function parseDate(raw: string | null): number | null | undefined {
  if (raw === null) return undefined;
  const trimmed = raw.trim();
  if (trimmed === '') return undefined;
  if (/^\d{10,}$/.test(trimmed)) return Number(trimmed);
  const parsed = Date.parse(trimmed);
  return Number.isNaN(parsed) ? undefined : parsed;
}

export function eventInfoEmbed(
  event: { name: string; description: string; startsAt: number | null; endsAt: number | null; panelChannelId: string | null; status: string },
  stats: { signups: number; teams: number },
  locale: import('../shared/i18n.js').BotLocale = 'en',
): EmbedBuilder {
  const lines: string[] = [];
  if (event.description !== '') lines.push(event.description, '');
  if (event.startsAt !== null)
    lines.push(`🗓️ **${t(locale, 'discord.events.starts')}:** <t:${Math.floor(event.startsAt / 1000)}:F> (<t:${Math.floor(event.startsAt / 1000)}:R>)`);
  if (event.endsAt !== null)
    lines.push(`🏁 **${t(locale, 'discord.events.ends')}:** <t:${Math.floor(event.endsAt / 1000)}:F> (<t:${Math.floor(event.endsAt / 1000)}:R>)`);
  lines.push(t(locale, 'discord.events.signups_line', { signups: stats.signups, teams: stats.teams }));
  lines.push(t(locale, 'discord.events.status_line', { status: event.status }));
  if (event.panelChannelId !== null) lines.push(t(locale, 'discord.events.panel_line', { channel: event.panelChannelId }));
  return new EmbedBuilder().setTitle(`🏆 ${event.name}`).setDescription(lines.join('\n')).setColor(0x5865f2);
}

/** GET /hackathon event — the public event card. */
export async function handleEventInfo(ctx: Ctx): Promise<EmbedBuilder> {
  const locale = ctx.botLocale;
  const participants = await listParticipants(ctx.db, ctx.eventId, 'active');
  const teams = await listTeams(ctx.db, ctx.eventId);
  const event = await getEvent(ctx.db, ctx.eventId);
  return eventInfoEmbed(
    event ?? {
      name: ctx.eventName,
      description: t(locale, 'discord.events.no_event_configured'),
      startsAt: null,
      endsAt: null,
      panelChannelId: null,
      status: 'draft',
    },
    { signups: participants.length, teams: teams.length },
    locale,
  );
}

/** All /hackathon admin event-* and related subcommands. */
export async function handleEventAdminCommand(
  i: ChatInputCommandInteraction,
  ctx: Ctx,
  sub: string,
): Promise<void> {
  const { db, guildId, actor, botLocale: locale } = ctx;

  switch (sub) {
    case 'event-create': {
      const name = i.options.getString('name', true);
      const description = i.options.getString('description') ?? '';
      const startsAt = parseDate(i.options.getString('starts')) ?? null;
      const endsAt = parseDate(i.options.getString('ends')) ?? null;
      const templateId = i.options.getString('template');

      let form: Parameters<typeof createEvent>[3]['form'];
      if (templateId !== null) {
        const tpl = await listTemplates(db, guildId, 'event').find((tplItem) => tplItem.id === templateId);
        if (tpl === undefined) {
          await i.reply(eph(t(locale, 'discord.events.template_not_found')));
          return;
        }
        form = templateToEventInput(tpl.json).form;
      }

      const res = await createEvent(db, actor, guildId, {
        name,
        ...(description !== '' ? { description } : {}),
        ...(startsAt !== null ? { startsAt } : {}),
        ...(endsAt !== null ? { endsAt } : {}),
        ...(form !== undefined ? { form } : {}),
      });
      if (!res.ok) {
        await i.reply({ embeds: [displayErr(locale, res.code, res.message)], flags: MessageFlags.Ephemeral });
        return;
      }
      const activationHint =
        await getActiveEvent(db, guildId) === null
          ? t(locale, 'discord.events.created_first_hint')
          : t(locale, 'discord.events.created_activate_hint');
      await i.reply({
        embeds: [embedOk(t(locale, 'discord.events.created_title'), `${t(locale, 'discord.events.created_body', { name: res.value.name, id: res.value.id })}${activationHint}`)],
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    case 'event-config': {
      const event = await getActiveEvent(db, guildId) ?? await getEvent(db, ctx.eventId);
      if (event === null) {
        await i.reply(eph(t(locale, 'discord.events.none_to_configure')));
        return;
      }
      const name = i.options.getString('name') ?? undefined;
      const description = i.options.getString('description') ?? undefined;
      const startsAt = parseDate(i.options.getString('starts'));
      const endsAt = parseDate(i.options.getString('ends'));
      const cleanupHours = i.options.getInteger('cleanup-hours') ?? undefined;

      const res = await updateEvent(db, actor, event.id, {
        ...(name !== undefined ? { name } : {}),
        ...(description !== undefined ? { description } : {}),
        ...(startsAt !== undefined ? { startsAt } : {}),
        ...(endsAt !== undefined ? { endsAt } : {}),
        ...(cleanupHours !== undefined ? { cleanupDelayHours: cleanupHours } : {}),
      });
      if (!res.ok) {
        await i.reply({ embeds: [displayErr(locale, res.code, res.message)], flags: MessageFlags.Ephemeral });
        return;
      }
      await i.reply({
        embeds: [embedOk(t(locale, 'discord.events.updated_title'), t(locale, 'discord.events.updated_body', { name: res.value.name }))],
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    case 'event-activate': {
      const idArg = i.options.getString('id');
      let eventId = idArg ?? '';
      if (eventId === '') {
        const drafts = await listEvents(db, guildId).filter((e) => e.status === 'draft');
        if (drafts.length === 0) {
          await i.reply(eph(t(locale, 'discord.events.no_drafts')));
          return;
        }
        eventId = drafts[0]!.id;
      }
      const res = await activateEvent(db, actor, eventId);
      if (!res.ok) {
        await i.reply({ embeds: [displayErr(locale, res.code, res.message)], flags: MessageFlags.Ephemeral });
        return;
      }
      // Move the signup panel to the event if the event defines one, else refresh in place.
      if (res.value.panelChannelId !== null) {
        await postOrUpdatePanel(db, ctx.client, guildId, res.value.panelChannelId);
      } else {
        await postOrUpdatePanel(db, ctx.client, guildId, '').catch(() => undefined);
      }
      await i.reply({
        embeds: [embedOk(t(locale, 'discord.events.activated_title'), t(locale, 'discord.events.activated_body', { name: res.value.name }))],
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    case 'event-end': {
      const event = await getActiveEvent(db, guildId);
      if (event === null) {
        await i.reply(eph(t(locale, 'discord.events.no_active')));
        return;
      }
      const res = await endEvent(db, actor, event.id);
      if (!res.ok) {
        await i.reply({ embeds: [displayErr(locale, res.code, res.message)], flags: MessageFlags.Ephemeral });
        return;
      }
      await i.reply({
        embeds: [
          embedOk(
            t(locale, 'discord.events.ended_title'),
            t(locale, 'discord.events.ended_body', { name: event.name, hours: event.cleanupDelayHours }),
          ),
        ],
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    case 'auto-match': {
      const event = await getActiveEvent(db, guildId);
      if (event === null) {
        await i.reply(eph(t(locale, 'discord.match.no_active')));
        return;
      }
      const clear = i.options.getBoolean('clear') ?? false;
      if (clear) {
        const res = setMatchAt(db, actor, event.id, null);
        if (!res.ok) {
          await i.reply({ embeds: [displayErr(locale, res.code, res.message)], flags: MessageFlags.Ephemeral });
          return;
        }
        await i.reply({
          embeds: [
            embedOk(
              t(locale, 'discord.match.schedule_cleared_title'),
              t(locale, 'discord.match.schedule_cleared_body', {
                name: event.name,
                locked: event.matchLocked ? t(locale, 'discord.match.schedule_locked_yes') : t(locale, 'discord.match.schedule_locked_no'),
              }),
            ),
          ],
          flags: MessageFlags.Ephemeral,
        });
        return;
      }
      const raw = i.options.getString('at');
      if (raw === null) {
        // Inspect: show current schedule.
        const lines = [
          t(locale, 'discord.match.schedule_scheduled_line', {
            when:
              event.matchAt !== null
                ? `<t:${Math.floor(event.matchAt / 1000)}:F> (<t:${Math.floor(event.matchAt / 1000)}:R>)`
                : t(locale, 'discord.match.schedule_not_scheduled'),
          }),
          t(locale, 'discord.match.schedule_locked_line', {
            locked: event.matchLocked ? t(locale, 'discord.match.schedule_locked_yes') : t(locale, 'discord.match.schedule_locked_no'),
          }),
          '',
          t(locale, 'discord.match.schedule_hint'),
        ];
        await i.reply({ embeds: [embedOk(t(locale, 'discord.match.schedule_title'), lines.join('\n'))], flags: MessageFlags.Ephemeral });
        return;
      }
      const at = parseDate(raw);
      if (at === null || at === undefined) {
        await i.reply(eph(t(locale, 'discord.match.schedule_bad_time')));
        return;
      }
      const res = setMatchAt(db, actor, event.id, at);
      if (!res.ok) {
        await i.reply({ embeds: [displayErr(locale, res.code, res.message)], flags: MessageFlags.Ephemeral });
        return;
      }
      await i.reply({
        embeds: [
          embedOk(t(locale, 'discord.match.schedule_done_title'), t(locale, 'discord.match.schedule_done_body', { name: event.name, at: Math.floor(at / 1000) })),
        ],
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    case 'announce': {
      const event = await getActiveEvent(db, guildId);
      if (event === null) {
        await i.reply(eph(t(locale, 'discord.events.no_active_to_announce')));
        return;
      }
      const title = i.options.getString('title', true);
      const message = i.options.getString('message', true);
      const dm = i.options.getBoolean('dm') ?? false;
      const { sendAnnouncement } = await import('./notify.js');
      await i.deferReply({ flags: MessageFlags.Ephemeral });
      const result = await sendAnnouncement({ db, client: ctx.client }, actor, event, title, message, dm);
      await i.editReply({
        content: `📣 ${result.posted ? t(locale, 'discord.events.announce_posted') : t(locale, 'discord.events.announce_not_posted')}${
          dm ? `\n${t(locale, 'discord.events.announce_dms', { sent: result.dmSent, failed: result.dmFailed })}` : ''
        }`,
      });
      return;
    }

    case 'discord-event': {
      const event = await getActiveEvent(db, guildId);
      if (event === null) {
        await i.reply(eph(t(locale, 'discord.events.no_active')));
        return;
      }
      const days = i.options.getInteger('days') ?? 1;
      const durationHours = i.options.getInteger('duration-hours') ?? 24;
      const { createDiscordEvents } = await import('./notify.js');
      const result = await createDiscordEvents({ db, client: ctx.client }, actor, event, days, durationHours);
      if (result.created.length === 0) {
        await i.reply({ embeds: [displayErr(locale, 'failed', result.errors.join('; ') || t(locale, 'discord.events.nothing_created'))], flags: MessageFlags.Ephemeral });
        return;
      }
      await i.reply({
        embeds: [
          embedOk(
            t(locale, 'discord.events.discord_events_created'),
            result.created.map((c) => `• **${c.name}** (\`${c.id}\`)`).join('\n') +
              (result.errors.length > 0 ? `\n\n${t(locale, 'discord.events.failures', { list: result.errors.join('; ') })}` : ''),
          ),
        ],
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    case 'template-save': {
      const event = await getActiveEvent(db, guildId);
      if (event === null) {
        await i.reply(eph(t(locale, 'discord.events.no_active_to_save')));
        return;
      }
      const name = i.options.getString('name', true);
      const payload = {
        name: event.name,
        description: event.description,
        cleanupDelayHours: event.cleanupDelayHours,
        form: getEventFormLocal(db, event),
      };
      const res = await saveTemplate(db, actor, guildId, name, 'event', JSON.stringify(payload));
      if (!res.ok) {
        await i.reply({ embeds: [displayErr(locale, res.code, res.message)], flags: MessageFlags.Ephemeral });
        return;
      }
      await i.reply({
        embeds: [embedOk(t(locale, 'discord.events.template_saved_title'), t(locale, 'discord.events.template_saved_body', { name: res.value.name }))],
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    case 'templates': {
      const templates = await listTemplates(db, guildId);
      if (templates.length === 0) {
        await i.reply(eph(t(locale, 'discord.events.no_templates')));
        return;
      }
      const lines = templates.map((tpl) => `• **${tpl.name}** (${tpl.kind}, \`${tpl.id}\`)`);
      await i.reply({ content: lines.join('\n'), flags: MessageFlags.Ephemeral });
      return;
    }

    case 'match-lock': {
      const event = await getEvent(db, ctx.eventId);
      if (event === null) {
        await i.reply(eph(t(locale, 'discord.events.no_event_configured')));
        return;
      }
      markMatchLocked(db, event.id);
      await audit(db, actor, 'match.lock', event.id, null);
      await i.reply({ embeds: [embedOk(t(locale, 'discord.events.match_locked_title'), t(locale, 'discord.events.match_locked_body'))], flags: MessageFlags.Ephemeral });
      return;
    }

    case 'match-unlock': {
      const event = await getEvent(db, ctx.eventId);
      if (event === null) {
        await i.reply(eph(t(locale, 'discord.events.no_event_configured')));
        return;
      }
      markMatchUnlocked(db, event.id);
      await audit(db, actor, 'match.unlock', event.id, null);
      await i.reply({ embeds: [embedOk(t(locale, 'discord.events.match_unlocked_title'), t(locale, 'discord.events.match_unlocked_body'))], flags: MessageFlags.Ephemeral });
      return;
    }

    case 'itinerary': {
      const event = await getEvent(db, ctx.eventId);
      if (event === null) {
        await i.reply(eph(t(locale, 'discord.events.no_event_configured')));
        return;
      }
      const res = await postOrUpdateScheduleItinerary(db, ctx.client, event);
      if ('error' in res) {
        await i.reply({ embeds: [displayErr(locale, 'failed', t(locale, 'discord.events.itinerary_failed', { reason: res.error }))], flags: MessageFlags.Ephemeral });
        return;
      }
      await audit(db, actor, 'schedule.itinerary', event.id, { channelId: res.channelId, edited: res.edited });
      await i.reply({
        embeds: [
          embedOk(
            res.edited ? t(locale, 'discord.events.itinerary_updated_title') : t(locale, 'discord.events.itinerary_posted_title'),
            t(locale, 'discord.events.itinerary_body', { channel: res.channelId }),
          ),
        ],
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    case 'console': {
      // The rich editors (schedule blocks, signup form, assignment collections)
      // live in the web console — point organizers there instead of pretending a
      // slash command can replace them.
      const base = env().publicUrl ?? `http://localhost:${env().adminPort}`;
      const url = base.replace(/\/$/, '');
      await audit(db, actor, 'console.link', guildId, null);
      await i.reply({ content: t(locale, 'discord.events.console_link', { url }), flags: MessageFlags.Ephemeral });
      return;
    }

    default:
      await i.reply(eph(t(locale, 'discord.admin.unknown_event_admin_sub')));
  }
}

function getEventFormLocal(db: import('../shared/db.js').Db, event: { id: string; formJson: string | null }) {
  return getEventForm(db, { id: event.id, formJson: event.formJson } as never, DEFAULT_FORM);
}
