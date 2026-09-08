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
import type { FormConfig } from '../features/form/domain.js';
import { IDS } from './shared.js';
import { t, type BotLocale } from '../shared/i18n.js';

interface PanelRef {
  channelId: string;
  messageId: string;
}

const key = (guildId: string) => `signup_panel:${guildId}`;

function getPanelRef(db: Db, guildId: string): PanelRef | null {
  const row = db.prepare('SELECT value FROM meta WHERE key = ?').get(key(guildId)) as
    | { value: string }
    | undefined;
  if (row === undefined) return null;
  try {
    const parsed = JSON.parse(row.value) as PanelRef;
    return parsed.channelId !== '' && parsed.messageId !== '' ? parsed : null;
  } catch {
    return null;
  }
}

function setPanelRef(db: Db, guildId: string, ref: PanelRef): void {
  db.prepare(
    'INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
  ).run(key(guildId), JSON.stringify(ref));
}

export function buildPanelPayload(config: FormConfig, locale: BotLocale = 'en'): {
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
    new ButtonBuilder().setCustomId(IDS.signupButton).setLabel(t(locale, 'discord.panel.signup_btn')).setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId(IDS.teamsButton)
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
): Promise<{ channelId: string; messageId: string; edited: boolean } | { error: string }> {
  if (channelId === '') {
    const ref = getPanelRef(db, guildId);
    if (ref === null) return { error: t(locale, 'discord.events.no_panel_yet') };
    channelId = ref.channelId;
  }
  const guild = await client.guilds.fetch(guildId).catch(() => null);
  if (guild === null) return { error: t(locale, 'discord.events.guild_not_found') };

  const channel = await guild.channels.fetch(channelId).catch(() => null);
  if (channel === null || !channel.isTextBased()) {
    return { error: t(locale, 'discord.events.not_text_channel') };
  }

  const payload = buildPanelPayload(getForm(db), locale);
  const existing = getPanelRef(db, guildId);

  try {
    if (existing !== null && existing.channelId === channelId) {
      const message = await channel.messages.fetch(existing.messageId).catch(() => null);
      if (message !== null && message.author.id === client.user?.id) {
        await message.edit(payload);
        return { channelId, messageId: existing.messageId, edited: true };
      }
    }
    const sent = await (channel as TextChannel).send(payload);
    setPanelRef(db, guildId, { channelId, messageId: sent.id });
    return { channelId, messageId: sent.id, edited: false };
  } catch (error) {
    console.error('signup panel post failed:', error);
    return { error: t(locale, 'discord.events.panel_post_failed') };
  }
}

/** Refresh after form edits (fire-and-forget friendly; silent when no panel exists). */
export async function refreshSignupPanel(db: Db, client: Client, guildId: string, locale: BotLocale = 'en'): Promise<void> {
  const ref = getPanelRef(db, guildId);
  if (ref === null) return;
  await postOrUpdatePanel(db, client, guildId, ref.channelId, locale);
}

/** Ephemeral status reply content for the panel's status button, if used later. */
export const PANEL_BUTTON_FLAG = MessageFlags.Ephemeral;
