/**
 * Signup panel: a persistent embed with buttons posted into a channel by
 * admins. The primary entry point for signups (modals can only open from
 * interactions, so a button click is the trigger — never a proactive DM).
 *
 * Each event's panel message id is stored in `meta` so re-posting edits only
 * that event's panel. Legacy guild refs supply fallback channels, not messages.
 */
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  MessageFlags,
  type Client,
  type TextChannel,
} from 'discord.js';
import type { Db } from '../shared/db.js';
import { getForm } from '../features/form/data.js';
import { getActiveEvent, getEventForm, getMessageRef, setMessageRef } from '../features/events/data.js';
import type { FormConfig } from '../features/form/domain.js';
import { IDS } from './shared.js';
import { t, type BotLocale } from '../shared/i18n.js';

interface PanelRef {
  channelId: string;
  messageId: string;
}

const key = (guildId: string, eventId?: string) => eventId ? `signup_panel:${guildId}:${eventId}` : `signup_panel:${guildId}`;

export function getSignupPanelRef(db: Db, guildId: string, eventId?: string): Promise<PanelRef | null> {
  return getMessageRef(db, key(guildId, eventId));
}

function setPanelRef(db: Db, guildId: string, ref: PanelRef, eventId?: string): Promise<void> {
  return setMessageRef(db, key(guildId, eventId), ref);
}

export function buildPanelPayload(config: FormConfig, locale: BotLocale = 'en', eventId?: string): {
  embeds: EmbedBuilder[];
  components: ActionRowBuilder<ButtonBuilder>[];
} {
  const experienceList = config.experiences.map((e) => e.label_sv ?? e.label).join(' · ');
  const tracks = config.roleTracks.map((r) => r.label_sv ?? r.label).join(' · ');
  const embed = new EmbedBuilder()
    .setTitle(`🏁 ${config.title}`)
    .setDescription(
      [
        config.description,
        '',
        t(locale, 'discord.panel.how_title'),
        t(locale, 'discord.panel.how_create'),
        t(locale, 'discord.panel.how_join'),
        t(locale, 'discord.panel.how_match'),
        '',
        t(locale, 'discord.panel.team_size', { size: config.teamSize }),
        t(locale, 'discord.panel.roles_line', { tracks }),
        t(locale, 'discord.panel.experience_line', { list: experienceList }),
      ].join('\n'),
    )
    .setColor(0x5865f2)
    .setFooter({ text: t(locale, 'discord.panel.footer', { version: config.version }) });

  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(eventId ? `hack:panel:${eventId}:signup` : IDS.signupButton).setLabel(t(locale, 'discord.panel.signup_btn')).setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId(eventId ? `hack:panel:${eventId}:teams` : IDS.teamsButton)
      .setLabel(t(locale, 'discord.panel.browse_btn'))
      .setStyle(ButtonStyle.Secondary),
  );
  return { embeds: [embed], components: [row] };
}

/**
 * Post or refresh the panel in a channel. Called by the admin command
 * (explicit target channel) and after web form edits (stored channel).
 */
export async function postOrUpdatePanel(
  db: Db,
  client: Client,
  guildId: string,
  channelId: string,
  locale: BotLocale = 'en',
  config?: FormConfig,
  eventId?: string,
): Promise<{ channelId: string; messageId: string; edited: boolean } | { error: string }> {
  const activeEvent = eventId === undefined ? await getActiveEvent(db, guildId) : null;
  const panelEventId = eventId ?? activeEvent?.id;
  const existing = await getSignupPanelRef(db, guildId, panelEventId);
  if (channelId === '') {
    // A legacy guild panel can supply a channel, but never an event's message to edit.
    const ref = existing ?? await getSignupPanelRef(db, guildId);
    if (ref === null) return { error: t(locale, 'discord.events.no_panel_yet') };
    channelId = ref.channelId;
  }
  const guild = await client.guilds.fetch(guildId).catch(() => null);
  if (guild === null) return { error: t(locale, 'discord.events.guild_not_found') };

  const channel = await guild.channels.fetch(channelId).catch(() => null);
  if (channel === null || !channel.isTextBased()) {
    return { error: t(locale, 'discord.events.not_text_channel') };
  }

  const fallback = config ?? await getForm(db, guildId);
  const payload = buildPanelPayload(activeEvent ? getEventForm(db, activeEvent, fallback) : fallback, locale, panelEventId);

  try {
    if (existing !== null && existing.channelId === channelId) {
      const message = await channel.messages.fetch(existing.messageId).catch(() => null);
      if (message !== null && message.author.id === client.user?.id) {
        await message.edit(payload);
        return { channelId, messageId: existing.messageId, edited: true };
      }
    }
    const sent = await (channel as TextChannel).send(payload);
    await setPanelRef(db, guildId, { channelId, messageId: sent.id }, panelEventId);
    return { channelId, messageId: sent.id, edited: false };
  } catch (error) {
    console.error('signup panel post failed:', error);
    return { error: t(locale, 'discord.events.panel_post_failed') };
  }
}

/** Refresh after form edits (fire-and-forget friendly; silent when no panel exists). */
export async function refreshSignupPanel(db: Db, client: Client, guildId: string, locale: BotLocale = 'en'): Promise<void> {
  const active = await getActiveEvent(db, guildId);
  const ref = await getSignupPanelRef(db, guildId, active?.id);
  if (ref === null) return;
  const config = active ? getEventForm(db, active, await getForm(db, guildId)) : undefined;
  await postOrUpdatePanel(db, client, guildId, ref.channelId, locale, config, active?.id);
}

/** Ephemeral status reply content for the panel's status button, if used later. */
export const PANEL_BUTTON_FLAG = MessageFlags.Ephemeral;
