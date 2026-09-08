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
import { labelFor } from '../features/form/domain.js';
import { IDS } from './shared.js';

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

export function buildPanelPayload(config: FormConfig): {
  embeds: EmbedBuilder[];
  components: ActionRowBuilder<ButtonBuilder>[];
} {
  const experienceList = config.experiences.map((e) => e.label).join(' · ');
  const tracks = config.roleTracks.map((r) => r.label).join(' · ');
  const embed = new EmbedBuilder()
    .setTitle(`🏁 ${config.title}`)
    .setDescription(
      [
        config.description,
        '',
        '**How teams happen here:**',
        '🛠️ **Create your own team** — get a colored role, private text + voice channels and invite links.',
        '🤝 **Ask to join a team** — browse open teams, owners accept from their DMs.',
        '🎲 **Get matched** — we build a balanced team around your skills.',
        '',
        `**Team size:** up to ${config.teamSize}`,
        `**Roles people sign up for:** ${tracks}`,
        `**Experience levels:** ${experienceList}`,
      ].join('\n'),
    )
    .setColor(0x5865f2)
    .setFooter({ text: `Form v${config.version} · updates apply instantly` });

  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(IDS.signupButton).setLabel('Sign up').setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId(IDS.teamsButton)
      .setLabel('Browse teams')
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
): Promise<{ channelId: string; messageId: string; edited: boolean } | { error: string }> {
  if (channelId === '') {
    const ref = getPanelRef(db, guildId);
    if (ref === null) return { error: 'No panel exists yet.' };
    channelId = ref.channelId;
  }
  const guild = await client.guilds.fetch(guildId).catch(() => null);
  if (guild === null) return { error: 'Guild not found.' };

  const channel = await guild.channels.fetch(channelId).catch(() => null);
  if (channel === null || !channel.isTextBased()) {
    return { error: 'That channel is not a text channel.' };
  }

  const payload = buildPanelPayload(getForm(db));
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
    return { error: 'Could not post the panel — check my permissions there.' };
  }
}

/** Refresh after form edits (fire-and-forget friendly; silent when no panel exists). */
export async function refreshSignupPanel(db: Db, client: Client, guildId: string): Promise<void> {
  const ref = getPanelRef(db, guildId);
  if (ref === null) return;
  await postOrUpdatePanel(db, client, guildId, ref.channelId);
}

/** Ephemeral status reply content for the panel's status button, if used later. */
export const PANEL_BUTTON_FLAG = MessageFlags.Ephemeral;
export { labelFor };
