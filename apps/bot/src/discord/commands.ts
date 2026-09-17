/**
 * Slash command definitions. Handlers live in user-commands.ts,
 * event-commands.ts, admin-commands.ts and components.ts.
 *
 * Two commands instead of one:
 * - `/hackathon` — participant actions (join, teams, status…), usable by anyone.
 * - `/hackathon-admin` — organizer tools, carrying `default_member_permissions`
 *   so Discord hides it from participants entirely.
 *
 * Why two: Discord supports `default_member_permissions` only on the top-level
 * command, not on subcommands or groups (a per-subcommand value is silently
 * dropped on registration — verified by reading the registration back). One
 * command with an `admin` subgroup therefore either exposes organizer tools to
 * everyone or hides the participant flow too.
 *
 * Text comes from the bot's i18n catalog (`cmd.*.desc`), so each string is
 * written once and the Swedish variant is whatever `sv` has for the same key.
 * Subcommand **names** stay English on purpose: they are identifiers people type
 * and docs quote, and Discord always accepts the base name regardless of the
 * client language.
 */
import {
  ApplicationIntegrationType,
  InteractionContextType,
  PermissionFlagsBits,
  SlashCommandBuilder,
  SlashCommandSubcommandBuilder,
} from 'discord.js';
import { t, translation } from '../shared/i18n.js';

/** Command names — shared with the dispatcher so both agree on one constant. */
export const HACKATHON_NAME = 'hackathon';
export const HACKATHON_ADMIN_NAME = 'hackathon-admin';

/** English description for a subcommand — the base text Discord shows. */
const d = (name: string): string => t('en', `cmd.${name}.desc`);

/** Swedish localization, but only when the catalog actually has one. */
const dloc = (name: string): Record<string, string> => {
  const sv = translation('sv', `cmd.${name}.desc`);
  return sv === undefined ? {} : { 'sv-SE': sv };
};

/** Subcommand with its text pulled from the catalog. */
const sub = (
  name: string,
  build?: (b: SlashCommandSubcommandBuilder) => SlashCommandSubcommandBuilder,
): SlashCommandSubcommandBuilder => {
  const base = new SlashCommandSubcommandBuilder()
    .setName(name)
    .setDescription(d(name))
    .setDescriptionLocalizations(dloc(name));
  return build === undefined ? base : build(base);
};

export const HACKATHON_COMMAND = new SlashCommandBuilder()
  .setName(HACKATHON_NAME)
  .setDescription(d('root'))
  .setDescriptionLocalizations(dloc('root'))
  .setContexts(InteractionContextType.Guild)
  .setIntegrationTypes(ApplicationIntegrationType.GuildInstall)

  .addSubcommand((b) => sub('join', (x) => x))
  .addSubcommand((b) => sub('leave', (x) => x))
  .addSubcommand((b) => sub('status', (x) => x))
  .addSubcommand((b) => sub('event', (x) => x))
  .addSubcommand((b) => sub('create-team', (x) => x))
  .addSubcommand((b) => sub('teams', (x) => x))
  .addSubcommand((b) =>
    sub('invite', (x) => x.addUserOption((o) => o.setName('user').setDescription('Who to invite').setRequired(true))),
  )
  .addSubcommand((b) => sub('team-settings', (x) => x))
  .addSubcommand((b) => sub('invitations', (x) => x))
  .addSubcommand((b) => sub('team-requests', (x) => x))
  .addSubcommand((b) => sub('leave-team', (x) => x))
  .addSubcommand((b) =>
    sub('join-code', (x) =>
      x.addStringOption((o) =>
        o.setName('code').setDescription('The 6-character team code').setRequired(true).setMaxLength(6),
      ),
    ),
  )
  .addSubcommand((b) => sub('team-code', (x) => x))
  .addSubcommand((b) =>
    sub('teammates', (x) =>
      x
        .addUserOption((o) => o.setName('friend1').setDescription('Teammate'))
        .addUserOption((o) => o.setName('friend2').setDescription('Teammate'))
        .addUserOption((o) => o.setName('friend3').setDescription('Teammate'))
        .addUserOption((o) => o.setName('friend4').setDescription('Teammate'))
        .addUserOption((o) => o.setName('friend5').setDescription('Teammate')),
    ),
  )
  .toJSON();

/** Organizer-only. Hidden from participants by Discord itself. */
export const HACKATHON_ADMIN_COMMAND = new SlashCommandBuilder()
  .setName(HACKATHON_ADMIN_NAME)
  .setDescription(d('admin-root'))
  .setDescriptionLocalizations(dloc('admin-root'))
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
  .setContexts(InteractionContextType.Guild)
  .setIntegrationTypes(ApplicationIntegrationType.GuildInstall)

  .addSubcommand((b) =>
    sub('block', (x) =>
      x
        .addUserOption((o) => o.setName('user').setDescription('Who').setRequired(true))
        .addStringOption((o) => o.setName('reason').setDescription('Why').setMaxLength(200)),
    ),
  )
  .addSubcommand((b) => sub('unblock', (x) => x.addUserOption((o) => o.setName('user').setDescription('Who').setRequired(true))))
  .addSubcommand((b) => sub('remove', (x) => x.addUserOption((o) => o.setName('user').setDescription('Who').setRequired(true))))
  .addSubcommand((b) =>
    sub('move', (x) =>
      x
        .addUserOption((o) => o.setName('user').setDescription('Who').setRequired(true))
        .addStringOption((o) => o.setName('team').setDescription('Team name or id; leave empty to unassign').setAutocomplete(true)),
    ),
  )
  .addSubcommand((b) =>
    sub('team-category', (x) =>
      x.addChannelOption((o) =>
        o.setName('category').setDescription('Leave empty to use the server default / unset').addChannelTypes(4),
      ),
    ),
  )
  .addSubcommand((b) =>
    sub('panel', (x) =>
      x.addChannelOption((o) =>
        o.setName('channel').setDescription('Channel for the panel; omit to refresh in its current channel').addChannelTypes(0),
      ),
    ),
  )
  .addSubcommand((b) => sub('match-preview', (x) => x))
  .addSubcommand((b) => sub('match-run', (x) => x))
  .addSubcommand((b) => sub('match-lock', (x) => x))
  .addSubcommand((b) => sub('match-unlock', (x) => x))
  .addSubcommand((b) => sub('itinerary', (x) => x))
  .addSubcommand((b) => sub('reset', (x) => x))
  .addSubcommand((b) => sub('form', (x) => x))
  .addSubcommand((b) => sub('console', (x) => x))
  .addSubcommand((b) =>
    sub('event-create', (x) =>
      x
        .addStringOption((o) => o.setName('name').setDescription('Event name').setRequired(true).setMaxLength(100))
        .addStringOption((o) => o.setName('description').setDescription('What is this event?').setMaxLength(1000))
        .addStringOption((o) => o.setName('starts').setDescription('Start (ISO or unix ms)').setRequired(false))
        .addStringOption((o) => o.setName('ends').setDescription('End (ISO or unix ms)').setRequired(false))
        .addStringOption((o) => o.setName('template').setDescription('Start from a template').setAutocomplete(true)),
    ),
  )
  .addSubcommand((b) =>
    sub('event-config', (x) =>
      x
        .addStringOption((o) => o.setName('name').setDescription('Rename').setMaxLength(100))
        .addStringOption((o) => o.setName('description').setDescription('Description').setMaxLength(1000))
        .addStringOption((o) => o.setName('starts').setDescription('Start (ISO or unix ms)'))
        .addStringOption((o) => o.setName('ends').setDescription('End (ISO or unix ms)'))
        .addIntegerOption((o) =>
          o.setName('cleanup-hours').setDescription('Hours after end to clean up channels/roles').setMinValue(0).setMaxValue(720),
        ),
    ),
  )
  .addSubcommand((b) =>
    sub('event-activate', (x) =>
      x.addStringOption((o) => o.setName('id').setDescription('Event id (omit = latest draft)').setAutocomplete(true)),
    ),
  )
  .addSubcommand((b) => sub('event-end', (x) => x))
  .addSubcommand((b) =>
    sub('auto-match', (x) =>
      x
        .addStringOption((o) =>
          o.setName('at').setDescription('When to auto-match (ISO date or unix ms); omit with clear to inspect').setRequired(false),
        )
        .addBooleanOption((o) => o.setName('clear').setDescription('Cancel the scheduled auto-match').setRequired(false)),
    ),
  )
  .addSubcommand((b) =>
    sub('announce', (x) =>
      x
        .addStringOption((o) => o.setName('title').setDescription('Headline').setRequired(true).setMaxLength(100))
        .addStringOption((o) => o.setName('message').setDescription('What to say').setRequired(true).setMaxLength(800))
        .addBooleanOption((o) => o.setName('dm').setDescription('Also DM every signed-up user (default false)')),
    ),
  )
  .addSubcommand((b) =>
    sub('discord-event', (x) =>
      x
        .addIntegerOption((o) => o.setName('days').setDescription('How many daily events (default 1)').setMinValue(1).setMaxValue(10))
        .addIntegerOption((o) => o.setName('duration-hours').setDescription('Hours each (default 24)').setMinValue(1).setMaxValue(72)),
    ),
  )
  .addSubcommand((b) =>
    sub('template-save', (x) =>
      x.addStringOption((o) => o.setName('name').setDescription('Template name').setRequired(true).setMaxLength(80)),
    ),
  )
  .addSubcommand((b) => sub('templates', (x) => x))
  .toJSON();

/** Everything the bot registers, in one list. */
export const COMMANDS = [HACKATHON_COMMAND, HACKATHON_ADMIN_COMMAND];
