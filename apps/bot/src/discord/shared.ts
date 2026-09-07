/**
 * Shared helpers for Discord handlers: context, embed builders, component ids.
 */
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  MessageFlags,
} from 'discord.js';
import type { Db } from '../shared/db.js';
import type { FormConfig } from '../features/form/domain.js';
import { labelFor } from '../features/form/domain.js';
import { countMembers, getTeam } from '../features/teams/service.js';
import type { Participant } from '../features/signup/store.js';
import type { MatchResult } from '../features/matching/engine.js';

/** Component customIds for buttons/selects attached to bot replies. */
export const IDS = {
  teamsSelect: 'hack:teams:select',
  adminMoveSelect: 'hack:admin:move',
  matchConfirm: 'hack:match:confirm',
  matchCancel: 'hack:match:cancel',
  resetConfirm: 'hack:reset:confirm',
  resetCancel: 'hack:reset:cancel',
} as const;

export interface Ctx {
  db: Db;
  config: FormConfig;
  guildId: string;
  actor: string;
  isAdmin: boolean;
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

const FRIENDLY: Record<string, string> = {
  blocked: 'You are blocked from signing up. Contact an organizer.',
  already_in_team: 'You are already in a team. Use `/hackathon leave-team` first.',
  team_full: 'That team is full.',
  not_found: 'Not found.',
  no_team: 'You are not in a team.',
  owner_leave: 'You own this team. Members must leave first, or ask an admin to delete it.',
  not_enough: 'Not enough unteamed, matching-opted participants yet.',
};

export function displayErr(code: string, message: string): EmbedBuilder {
  return embedErr('Something went wrong', FRIENDLY[code] ?? message);
}

export function buildParticipantEmbed(
  db: Db,
  config: FormConfig,
  p: Participant,
): EmbedBuilder {
  const team = p.teamId === null ? null : getTeam(db, p.teamId);
  const teamLine =
    team === null
      ? 'No team yet'
      : `**${team.name}** (${team.kind}, ${countMembers(db, team.id)}/${config.teamSize} members)`;
  return new EmbedBuilder()
    .setTitle('Your signup')
    .setColor(0x5865f2)
    .addFields(
      { name: 'Name', value: p.displayName, inline: true },
      { name: 'Experience', value: labelFor(config, 'experiences', p.experience), inline: true },
      { name: 'Role', value: labelFor(config, 'roleTracks', p.roleTrack), inline: true },
      { name: 'Skills', value: p.skills.map((s) => labelFor(config, 'skills', s)).join(', ') || '—', inline: false },
      { name: 'Team', value: teamLine, inline: false },
      {
        name: 'Teammates wanted',
        value: p.teammates.map((id) => `<@${id}>`).join(', ') || 'none listed',
        inline: false,
      },
    );
}

export function matchPreviewEmbed(result: MatchResult, config: FormConfig): EmbedBuilder {
  const lines = result.teams.map((t) => {
    const members = t.memberIds.map((id) => `<@${id}>`).join(', ');
    const notes = t.notes.length > 0 ? ` · ⚠️ ${t.notes.join('; ')}` : '';
    return `**${t.name}** — score ${t.score}${notes}\n${members}`;
  });
  const conflicts =
    result.conflicts.length > 0 ? `\n\n**Notes:**\n${result.conflicts.map((c) => `• ${c}`).join('\n')}` : '';
  return new EmbedBuilder()
    .setTitle(`Match preview — ${result.teams.length} teams (team size ${config.teamSize})`)
    .setDescription(lines.join('\n\n') + conflicts)
    .setColor(0xfee75c);
}

export function confirmRow(
  confirmId: string,
  cancelId: string,
  confirmLabel: string,
): ActionRowBuilder<ButtonBuilder> {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(confirmId).setLabel(confirmLabel).setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(cancelId).setLabel('Cancel').setStyle(ButtonStyle.Secondary),
  );
}
