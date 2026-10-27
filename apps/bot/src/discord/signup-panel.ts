/**
 * Signup panel: a persistent embed with buttons posted into a channel by
 * admins. The primary entry point for signups (modals can only open from
 * interactions, so a button click is the trigger — never a proactive DM).
 *
 * The panel message id is stored in `meta` so re-posting EDITS the existing
 * panel instead of spamming duplicates, and form edits refresh it.
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
import { getActiveEvent, getEvent, getEventForm, getMessageRef, setMessageRef } from '../features/events/data.js';
import type { FormConfig } from '../features/form/domain.js';
import { IDS } from './shared.js';
import { env } from '../shared/env.js';
import { needsWebSignup } from './signup-entry.js';
import { t, type BotLocale } from '../shared/i18n.js';
import { createHash } from 'node:crypto';

interface PanelRef {
  channelId: string;
  messageId: string;
}

const key = (guildId: string) => `signup_panel:${guildId}`;

function getPanelRef(db: Db, guildId: string): Promise<PanelRef | null> {
  return getMessageRef(db, key(guildId));
}

function setPanelRef(db: Db, guildId: string, ref: PanelRef): Promise<void> {
  return setMessageRef(db, key(guildId), ref);
}

export function buildPanelPayload(config: FormConfig, locale: BotLocale = 'en', eventId?: string, webUrl?: string): {
  embeds: EmbedBuilder[];
  components: ActionRowBuilder<ButtonBuilder>[];
} {
  const experienceList = config.experiences.map((e) => locale === 'sv' ? e.label_sv ?? e.label : e.label).join(' · ');
  const tracks = config.roleTracks.map((r) => locale === 'sv' ? r.label_sv ?? r.label : r.label).join(' · ');
  const embed = new EmbedBuilder()
    .setTitle(`🏁 ${config.title}`)
    .setDescription(
      [
        config.description,
        needsWebSignup(config) ? t(locale, webUrl ? 'discord.join.web_only' : 'discord.join.web_unavailable') : (config.customQuestions ?? []).some(q => q.visibility !== 'organizer_only') ? t(locale, 'discord.panel.web_questions') : '',
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
    needsWebSignup(config) && webUrl ? new ButtonBuilder().setURL(webUrl).setLabel(t(locale, 'discord.panel.signup_btn')).setStyle(ButtonStyle.Link) : new ButtonBuilder().setCustomId(eventId ? `hack:panel:${eventId}:signup` : IDS.signupButton).setLabel(t(locale, 'discord.panel.signup_btn')).setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId(eventId ? `hack:panel:${eventId}:teams` : IDS.teamsButton)
      .setLabel(t(locale, 'discord.panel.browse_btn'))
      .setStyle(ButtonStyle.Secondary),
  );
  if (eventId) row.addComponents(
    new ButtonBuilder().setCustomId(`${IDS.followCreateTeam}:${eventId}`).setLabel(t(locale, 'discord.join.actions_create')).setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(`${IDS.followInvitations}:${eventId}`).setLabel(t(locale, 'discord.join.actions_invitations')).setStyle(ButtonStyle.Secondary),
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
  eventId?: string,
  actionRef?: PanelRef,
): Promise<{ channelId: string; messageId: string; edited: boolean } | { error: string }> {
  if (channelId === '') {
    const ref = await getPanelRef(db, guildId);
    if (ref === null) return { error: t(locale, 'discord.events.no_panel_yet') };
    channelId = ref.channelId;
  }
  const guild = await client.guilds.fetch(guildId).catch(() => null);
  if (guild === null) return { error: t(locale, 'discord.events.guild_not_found') };

  const channel = await guild.channels.fetch(channelId).catch(() => null);
  if (channel === null || !channel.isTextBased()) {
    return { error: t(locale, 'discord.events.not_text_channel') };
  }

  const event = eventId ? await getEvent(db, eventId) : await getActiveEvent(db, guildId);
  if (!event || event.guildId !== guildId || event.status !== 'active') return { error: t(locale, 'discord.gate.no_active') };
  const config = getEventForm(db, event, await getForm(db, guildId));
  let webUrl: string | undefined;
  try { const base = env().publicUrl; if (base) webUrl = base.replace(/\/$/, '') + '/events/' + encodeURIComponent(event.id) + '/signup'; } catch { /* missing runtime config */ }
  const payload = buildPanelPayload(config, locale, event.id, webUrl);
  const eventKey = `signup_panel_event:${guildId}:${event.id}`;
  // Legacy scheduled actions can target different channels for the same event.
  // Prefer the action's own tracked message so that refreshing one action does
  // not replace the reference used by another. Old records without a reference
  // can still adopt the existing event panel.
  const existing = actionRef?.channelId === channelId ? actionRef : await getMessageRef(db, eventKey);

  try {
    if (existing !== null && existing.channelId === channelId) {
      const message = await channel.messages.fetch(existing.messageId).catch(error => { if (error?.code === 10008) return null; throw error; });
      if (message !== null && message.author.id === client.user?.id) {
        await message.edit(payload);
        return { channelId, messageId: existing.messageId, edited: true };
      }
      if (message !== null) return { error: t(locale, 'discord.events.panel_post_failed') };
    }
    const nonce = createHash('sha256').update(JSON.stringify([eventKey, channelId, payload])).digest('hex').slice(0, 24);
    const sent = await (channel as TextChannel).send({ ...payload, nonce, enforceNonce: true });
    await setMessageRef(db, eventKey, { channelId, messageId: sent.id });
    await setPanelRef(db, guildId, { channelId, messageId: sent.id });
    return { channelId, messageId: sent.id, edited: false };
  } catch (error) {
    console.error('signup panel post failed:', error);
    return { error: t(locale, 'discord.events.panel_post_failed') };
  }
}

/** Refresh after form edits (fire-and-forget friendly; silent when no panel exists). */
export async function refreshSignupPanel(db: Db, client: Client, guildId: string, locale: BotLocale = 'en', eventId?: string): Promise<void> {
  const ref = eventId ? await getMessageRef(db, `signup_panel_event:${guildId}:${eventId}`) : await getPanelRef(db, guildId);
  if (ref === null) return;
  await postOrUpdatePanel(db, client, guildId, ref.channelId, locale, eventId);
}

/** Ephemeral status reply content for the panel's status button, if used later. */
export const PANEL_BUTTON_FLAG = MessageFlags.Ephemeral;
