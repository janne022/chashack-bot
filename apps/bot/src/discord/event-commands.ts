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
  templateToEventInput,
} from '../features/events/service.js';
import { DEFAULT_FORM } from '../features/form/domain.js';
import { listParticipants } from '../features/signup/store.js';
import { listTeams } from '../features/teams/service.js';
import { postOrUpdatePanel } from './signup-panel.js';
import { displayErr, embedOk, eph, type Ctx } from './shared.js';

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
): EmbedBuilder {
  const lines: string[] = [];
  if (event.description !== '') lines.push(event.description, '');
  if (event.startsAt !== null) lines.push(`🗓️ **Starts:** <t:${Math.floor(event.startsAt / 1000)}:F> (<t:${Math.floor(event.startsAt / 1000)}:R>)`);
  if (event.endsAt !== null) lines.push(`🏁 **Ends:** <t:${Math.floor(event.endsAt / 1000)}:F> (<t:${Math.floor(event.endsAt / 1000)}:R>)`);
  lines.push(`📝 **Signups:** ${stats.signups}  ·  👥 **Teams:** ${stats.teams}`);
  lines.push(`**Status:** ${event.status}`);
  if (event.panelChannelId !== null) lines.push(`Signup panel: <#${event.panelChannelId}>`);
  return new EmbedBuilder().setTitle(`🏆 ${event.name}`).setDescription(lines.join('\n')).setColor(0x5865f2);
}

/** GET /hackathon event — the public event card. */
export function handleEventInfo(ctx: Ctx): EmbedBuilder {
  const participants = listParticipants(ctx.db, ctx.eventId, 'active');
  const teams = listTeams(ctx.db, ctx.eventId);
  const event = getEvent(ctx.db, ctx.eventId);
  return eventInfoEmbed(
    event ?? {
      name: ctx.eventName,
      description: 'No event configured yet — organizers can create one with `/hackathon admin event-create`.',
      startsAt: null,
      endsAt: null,
      panelChannelId: null,
      status: 'draft',
    },
    { signups: participants.length, teams: teams.length },
  );
}

/** All /hackathon admin event-* and related subcommands. */
export async function handleEventAdminCommand(
  i: ChatInputCommandInteraction,
  ctx: Ctx,
  sub: string,
): Promise<void> {
  const { db, guildId, actor } = ctx;

  switch (sub) {
    case 'event-create': {
      const name = i.options.getString('name', true);
      const description = i.options.getString('description') ?? '';
      const startsAt = parseDate(i.options.getString('starts')) ?? null;
      const endsAt = parseDate(i.options.getString('ends')) ?? null;
      const templateId = i.options.getString('template');

      let form: Parameters<typeof createEvent>[3]['form'];
      if (templateId !== null) {
        const tpl = listTemplates(db, guildId, 'event').find((t) => t.id === templateId);
        if (tpl === undefined) {
          await i.reply(eph('Template not found.'));
          return;
        }
        form = templateToEventInput(tpl.json).form;
      }

      const res = createEvent(db, actor, guildId, {
        name,
        ...(description !== '' ? { description } : {}),
        ...(startsAt !== null ? { startsAt } : {}),
        ...(endsAt !== null ? { endsAt } : {}),
        ...(form !== undefined ? { form } : {}),
      });
      if (!res.ok) {
        await i.reply({ embeds: [displayErr(res.code, res.message)], flags: MessageFlags.Ephemeral });
        return;
      }
      const activationHint =
        getActiveEvent(db, guildId) === null
          ? ' It is the first event — activate with `/hackathon admin event-activate`.'
          : ' Activate it with `/hackathon admin event-activate` when ready (this ends the current event).';
      await i.reply({
        embeds: [embedOk('Event created 🏆', `**${res.value.name}** (${res.value.id}) is in draft.${activationHint}`)],
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    case 'event-config': {
      const event = getActiveEvent(db, guildId) ?? getEvent(db, ctx.eventId);
      if (event === null) {
        await i.reply(eph('No event to configure. Create one with `/hackathon admin event-create`.'));
        return;
      }
      const name = i.options.getString('name') ?? undefined;
      const description = i.options.getString('description') ?? undefined;
      const startsAt = parseDate(i.options.getString('starts'));
      const endsAt = parseDate(i.options.getString('ends'));
      const cleanupHours = i.options.getInteger('cleanup-hours') ?? undefined;

      const res = updateEvent(db, actor, event.id, {
        ...(name !== undefined ? { name } : {}),
        ...(description !== undefined ? { description } : {}),
        ...(startsAt !== undefined ? { startsAt } : {}),
        ...(endsAt !== undefined ? { endsAt } : {}),
        ...(cleanupHours !== undefined ? { cleanupDelayHours: cleanupHours } : {}),
      });
      if (!res.ok) {
        await i.reply({ embeds: [displayErr(res.code, res.message)], flags: MessageFlags.Ephemeral });
        return;
      }
      await i.reply({
        embeds: [embedOk('Event updated', `**${res.value.name}** saved. Use the admin web UI for panel channel, category and form config.`)],
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    case 'event-activate': {
      const idArg = i.options.getString('id');
      let eventId = idArg ?? '';
      if (eventId === '') {
        const drafts = listEvents(db, guildId).filter((e) => e.status === 'draft');
        if (drafts.length === 0) {
          await i.reply(eph('No draft events. Create one with `/hackathon admin event-create`.'));
          return;
        }
        eventId = drafts[0]!.id;
      }
      const res = activateEvent(db, actor, eventId);
      if (!res.ok) {
        await i.reply({ embeds: [displayErr(res.code, res.message)], flags: MessageFlags.Ephemeral });
        return;
      }
      // Move the signup panel to the event if the event defines one, else refresh in place.
      if (res.value.panelChannelId !== null) {
        await postOrUpdatePanel(db, ctx.client, guildId, res.value.panelChannelId);
      } else {
        await postOrUpdatePanel(db, ctx.client, guildId, '').catch(() => undefined);
      }
      await i.reply({
        embeds: [embedOk('Event activated 🚀', `**${res.value.name}** is now live. The signup panel has been refreshed.`)],
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    case 'event-end': {
      const event = getActiveEvent(db, guildId);
      if (event === null) {
        await i.reply(eph('No active event.'));
        return;
      }
      const res = endEvent(db, actor, event.id);
      if (!res.ok) {
        await i.reply({ embeds: [displayErr(res.code, res.message)], flags: MessageFlags.Ephemeral });
        return;
      }
      await i.reply({
        embeds: [
          embedOk(
            'Event ended',
            `**${event.name}** is over. Team roles/channels will be cleaned up automatically ${event.cleanupDelayHours}h from its end time (or now + ${event.cleanupDelayHours}h if no end date was set).`,
          ),
        ],
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    case 'announce': {
      const event = getActiveEvent(db, guildId);
      if (event === null) {
        await i.reply(eph('No active event to announce for.'));
        return;
      }
      const title = i.options.getString('title', true);
      const message = i.options.getString('message', true);
      const dm = i.options.getBoolean('dm') ?? false;
      const { sendAnnouncement } = await import('./notify.js');
      await i.deferReply({ flags: MessageFlags.Ephemeral });
      const result = await sendAnnouncement({ db, client: ctx.client }, actor, event, title, message, dm);
      await i.editReply({
        content: `📣 ${result.posted ? 'Posted to the panel channel.' : 'Could not post to the panel channel.'}${
          dm ? `\nDMs: ${result.dmSent} delivered, ${result.dmFailed} failed (closed DMs).` : ''
        }`,
      });
      return;
    }

    case 'discord-event': {
      const event = getActiveEvent(db, guildId);
      if (event === null) {
        await i.reply(eph('No active event.'));
        return;
      }
      const days = i.options.getInteger('days') ?? 1;
      const durationHours = i.options.getInteger('duration-hours') ?? 24;
      const { createDiscordEvents } = await import('./notify.js');
      const result = await createDiscordEvents({ db, client: ctx.client }, actor, event, days, durationHours);
      if (result.created.length === 0) {
        await i.reply({ embeds: [displayErr('failed', result.errors.join('; ') || 'Nothing created.')], flags: MessageFlags.Ephemeral });
        return;
      }
      await i.reply({
        embeds: [
          embedOk(
            'Discord events created 📅',
            result.created.map((c) => `• **${c.name}** (\`${c.id}\`)`).join('\n') +
              (result.errors.length > 0 ? `\n\nFailures: ${result.errors.join('; ')}` : ''),
          ),
        ],
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    case 'template-save': {
      const event = getActiveEvent(db, guildId);
      if (event === null) {
        await i.reply(eph('No active event to save as a template.'));
        return;
      }
      const name = i.options.getString('name', true);
      const payload = {
        name: event.name,
        description: event.description,
        cleanupDelayHours: event.cleanupDelayHours,
        form: getEventFormLocal(db, event),
      };
      const res = saveTemplate(db, actor, guildId, name, 'event', JSON.stringify(payload));
      if (!res.ok) {
        await i.reply({ embeds: [displayErr(res.code, res.message)], flags: MessageFlags.Ephemeral });
        return;
      }
      await i.reply({
        embeds: [embedOk('Template saved 💾', `**${res.value.name}** — reuse it with \`/hackathon admin event-create … template:\`.`)],
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    case 'templates': {
      const templates = listTemplates(db, guildId);
      if (templates.length === 0) {
        await i.reply(eph('No templates yet. Save the current event with `/hackathon admin template-save`.'));
        return;
      }
      const lines = templates.map((t) => `• **${t.name}** (${t.kind}, \`${t.id}\`)`);
      await i.reply({ content: lines.join('\n'), flags: MessageFlags.Ephemeral });
      return;
    }

    default:
      await i.reply(eph('Unknown event admin subcommand.'));
  }
}

function getEventFormLocal(db: import('../shared/db.js').Db, event: { id: string; formJson: string | null }) {
  return getEventForm(db, { id: event.id, formJson: event.formJson } as never, DEFAULT_FORM);
}
