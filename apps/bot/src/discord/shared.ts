/**
 * Shared helpers for Discord handlers: context, embed builders, component ids.
 */
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  MessageFlags,
  type Client,
} from 'discord.js';
import type { Db } from '../shared/db.js';
import type { FormConfig } from '../features/form/domain.js';
import { labelForLocale } from '../features/form/domain.js';
import { t, type BotLocale } from '../shared/i18n.js';
import { countMembers, getTeam } from '../features/teams/data.js';
import type { Participant } from '../features/signup/data.js';
import type { MatchResult } from '../features/matching/domain.js';

/** Component customIds for buttons/selects attached to bot replies. */
export const IDS = {
  teamsSelect: 'hack:teams:select',
  adminMoveSelect: 'hack:admin:move',
  matchConfirm: 'hack:match:confirm',
  matchCancel: 'hack:match:cancel',
  resetConfirm: 'hack:reset:confirm',
  resetCancel: 'hack:reset:cancel',
  // request buttons carry the request id: hack:req:accept:<id>
  reqAccept: 'hack:req:accept',
  reqDecline: 'hack:req:decline',
  reqCancel: 'hack:req:cancel',
  // signup panel buttons
  signupButton: 'hack:panel:signup',
  teamsButton: 'hack:panel:teams',
  // post-signup follow-up actions (in-modal continuation)
  followCreateTeam: 'hack:follow:create-team',
  followBrowseTeams: 'hack:follow:browse-teams',
} as const;

export interface Ctx {
  db: Db;
  config: FormConfig;
  /** Bot UI language for all Discord-facing strings (BOT_LANGUAGE, default 'en'). */
  botLocale: BotLocale;
  /** Active event (or the one the admin explicitly selected). */
  eventId: string;
  eventName: string;
  /** False when no event is active: user-facing signup/team flows must gate on this. */
  hasActiveEvent: boolean;
  guildId: string;
  actor: string;
  isAdmin: boolean;
  client: Client;
  /** Category for team channels: guild setting, with env fallback applied by the host. */
  categoryIdFor: (guildId: string) => string | undefined;
  /** DM a user; returns false when the user has DMs closed. */
  dm: (userId: string, payload: { content?: string; embeds?: EmbedBuilder[]; components?: ActionRowBuilder<ButtonBuilder>[] }) => Promise<boolean>;
}

export function eph(content: string): { content: string; flags: number } {
  return { content, flags: MessageFlags.Ephemeral };
}

export function embedOk(title: string, description: string): EmbedBuilder {
  return new EmbedBuilder().setTitle(title).setDescription(description).setColor(0x57f287);
}

export function embedErr(title: string, description: string): EmbedBuilder {
  return new EmbedBuilder().setTitle(title).setDescription(description).setColor(0xed4245);
}

export function embedInfo(title: string, description: string, color = 0x5865f2): EmbedBuilder {
  return new EmbedBuilder().setTitle(title).setDescription(description).setColor(color);
}

const FRIENDLY: Record<string, { key: string }> = {
  blocked: { key: 'errors.blocked' },
  already_in_team: { key: 'errors.already_in_team' },
  team_full: { key: 'errors.team_full' },
  not_found: { key: 'errors.not_found' },
  no_team: { key: 'errors.no_team' },
  owner_leave: { key: 'errors.owner_leave' },
  not_enough: { key: 'errors.not_enough' },
  already_requested: { key: 'errors.already_requested' },
  not_your_decision: { key: 'errors.not_your_decision' },
  already_decided: { key: 'errors.already_decided' },
  not_active: { key: 'errors.not_active' },
  no_signup: { key: 'errors.no_signup' },
  not_joinable: { key: 'errors.not_joinable' },
  matched_team: { key: 'errors.matched_team' },
};

export function displayErr(locale: BotLocale, code: string, message: string): EmbedBuilder {
  const entry = FRIENDLY[code];
  const text = entry !== undefined ? t(locale, entry.key) : message;
  return embedErr(t(locale, 'discord.admin.something_broke_title'), text);
}

export function buildParticipantEmbed(db: Db, config: FormConfig, p: Participant, locale: BotLocale): EmbedBuilder {
  const team = p.teamId === null ? null : getTeam(db, p.teamId);
  const teamLine =
    team === null
      ? t(locale, 'discord.join.no_team_yet')
      : `**${team.name}** (${team.kind}, ${countMembers(db, team.id)}/${config.teamSize} ${t(locale, 'discord.join.members_suffix')})`;
  return new EmbedBuilder()
    .setTitle(t(locale, 'discord.join.your_signup'))
    .setColor(0x5865f2)
    .addFields(
      { name: t(locale, 'discord.join.field_name'), value: p.displayName, inline: true },
      { name: t(locale, 'discord.join.field_experience'), value: labelForLocale(config, 'experiences', p.experience, locale), inline: true },
      { name: t(locale, 'discord.join.field_role'), value: labelForLocale(config, 'roleTracks', p.roleTrack, locale), inline: true },
      { name: t(locale, 'discord.join.field_skills'), value: p.skills.map((s) => labelForLocale(config, 'skills', s, locale)).join(', ') || '—', inline: false },
      { name: t(locale, 'discord.join.field_team'), value: teamLine, inline: false },
      {
        name: t(locale, 'discord.join.field_teammates'),
        value: p.teammates.map((id) => `<@${id}>`).join(', ') || t(locale, 'discord.join.none_listed'),
        inline: false,
      },
    );
}

export function matchPreviewEmbed(result: MatchResult, config: FormConfig, locale: BotLocale): EmbedBuilder {
  const lines = result.teams.map((team) => {
    const members = team.memberIds.map((id) => `<@${id}>`).join(', ');
    const notes = team.notes.length > 0 ? ` · ⚠️ ${team.notes.join('; ')}` : '';
    return `**${team.name}** — ${t(locale, 'discord.events.score', { score: team.score })}${notes}\n${members}`;
  });
  const conflicts =
    result.conflicts.length > 0 ? `\n\n${t(locale, 'discord.events.match_notes')}\n${result.conflicts.map((c) => `• ${c}`).join('\n')}` : '';
  return new EmbedBuilder()
    .setTitle(
      t(locale, 'discord.events.match_preview_title', { count: result.teams.length, size: config.teamSize }),
    )
    .setDescription(lines.join('\n\n') + conflicts)
    .setColor(0xfee75c);
}

export function confirmRow(
  confirmId: string,
  cancelId: string,
  confirmLabel: string,
  locale: BotLocale,
): ActionRowBuilder<ButtonBuilder> {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(confirmId).setLabel(confirmLabel).setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(cancelId).setLabel(t(locale, 'discord.teams.cancel_btn_short')).setStyle(ButtonStyle.Secondary),
  );
}

/** Accept/Decline pair for a specific pending request. */
export function decideRow(base: string, requestId: number, locale: BotLocale): ActionRowBuilder<ButtonBuilder> {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(`${base}:${requestId}`).setLabel(t(locale, 'discord.teams.accept_btn')).setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId(`hack:req:decline:${requestId}`)
      .setLabel(t(locale, 'discord.teams.decline_btn'))
      .setStyle(ButtonStyle.Secondary),
  );
}

/** Cancel button for a sent request. */
export function cancelRow(requestId: number, locale: BotLocale): ActionRowBuilder<ButtonBuilder> {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(`hack:req:cancel:${requestId}`).setLabel(t(locale, 'discord.teams.cancel_btn')).setStyle(ButtonStyle.Secondary),
  );
}
