import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  type TextChannel,
} from 'discord.js';
import type { ProvisionDeps } from './provision.js';
import type { Team } from '../features/teams/data.js';
import { eventTeamSize, getTeam } from '../features/teams/data.js';
import { listTeamRoster } from '../features/signup/data.js';
import { DEFAULT_FORM } from '../features/form/domain.js';
import { getMessageRef, setMessageRef } from '../features/events/data.js';
import { t, type BotLocale } from '../shared/i18n.js';


export function buildTeamPanel(
  team: Team,
  roster: { userId: string; displayName: string }[],
  locale: BotLocale,
  teamSize = DEFAULT_FORM.teamSize,
): { embeds: EmbedBuilder[]; components: ActionRowBuilder<ButtonBuilder>[] } {
  const lines = roster.map(({ userId, displayName }) => `• ${displayName} <@${userId}>`);
  const status = team.kind === 'matched' ? t(locale, 'discord.team_panel.matched')
    : roster.length >= teamSize ? t(locale, 'discord.team_panel.full') : t(locale, 'discord.team_panel.open');
  const embed = new EmbedBuilder()
    .setTitle(t(locale, 'discord.team_panel.title', { team: team.name }))
    .setDescription([
      t(locale, 'discord.team_panel.status', { status }),
      t(locale, 'discord.team_panel.roster', { count: roster.length, size: teamSize }),
      ...lines,
    ].join('\n').slice(0, 4000))
    .setColor(0x5865f2)
    .setFooter({ text: t(locale, 'discord.team_panel.unpinned_hint') });
  const id = (action: string) => `hack:team-panel:${team.eventId}:${team.id}:${action}`;
  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(id('invite')).setLabel(t(locale, 'discord.team_panel.invite')).setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId(id('settings')).setLabel(t(locale, 'discord.team_panel.settings')).setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(id('requests')).setLabel(t(locale, 'discord.team_panel.requests')).setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(id('leave')).setLabel(t(locale, 'discord.team_panel.leave')).setStyle(ButtonStyle.Danger),
  );
  return { embeds: [embed], components: [row] };
}

export async function refreshTeamPanel(deps: ProvisionDeps, source: Team, locale: BotLocale = 'en'): Promise<void> {
  try {
    if (source.textChannelId === null) return;
    const team = await getTeam(deps.db, source.id);
    if (team === null || team.textChannelId === null) return;
    const guild = await deps.client.guilds.fetch(team.guildId);
    const channel = await guild.channels.fetch(team.textChannelId);
    if (channel === null || !channel.isTextBased()) return;
    const refKey = `team_panel:${team.id}`;
    const ref = await getMessageRef(deps.db, refKey);
    const payload = buildTeamPanel(team, await listTeamRoster(deps.db, team.id), locale, await eventTeamSize(deps.db, team.eventId, DEFAULT_FORM.teamSize));
    const message = ref?.channelId === team.textChannelId
      ? await (channel as TextChannel).messages.fetch(ref.messageId).catch(() => null)
      : null;
    if (message !== null && message.author.id === deps.client.user?.id) {
      await message.edit(payload);
      if (!message.pinned) await message.pin().catch(() => console.warn(`team panel pin denied for ${team.id}; controls remain available in ${team.textChannelId}`));
      return;
    }
    const sent = await (channel as TextChannel).send(payload);
    await setMessageRef(deps.db, refKey, { channelId: team.textChannelId, messageId: sent.id });
    await sent.pin().catch(() => console.warn(`team panel pin denied for ${team.id}; controls remain available in ${team.textChannelId}`));
  } catch (error) {
    console.warn(`team panel refresh failed for ${source.id}:`, error);
  }
}
