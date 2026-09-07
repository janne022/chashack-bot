/**
 * Slash command definitions for /hackathon. Handlers live in handlers.ts.
 */
import {
  SlashCommandBuilder,
  SlashCommandSubcommandBuilder,
  SlashCommandSubcommandGroupBuilder,
} from 'discord.js';

export const HACKATHON_COMMAND = new SlashCommandBuilder()
  .setName('hackathon')
  .setDescription('Hackathon signup, teams and matching')

  .addSubcommand((sub: SlashCommandSubcommandBuilder) =>
    sub.setName('join').setDescription('Sign up (or update your signup) — opens the form'),
  )
  .addSubcommand((sub: SlashCommandSubcommandBuilder) =>
    sub.setName('leave').setDescription('Withdraw your signup completely'),
  )
  .addSubcommand((sub: SlashCommandSubcommandBuilder) =>
    sub.setName('status').setDescription('Show your signup and team'),
  )
  .addSubcommand((sub: SlashCommandSubcommandBuilder) =>
    sub.setName('teams').setDescription('Browse public teams and join one'),
  )
  .addSubcommand((sub: SlashCommandSubcommandBuilder) =>
    sub.setName('leave-team').setDescription('Leave your current team (keeps your signup)'),
  )
  .addSubcommand((sub: SlashCommandSubcommandBuilder) =>
    sub
      .setName('create-team')
      .setDescription('Create your own team')
      .addStringOption((o) => o.setName('name').setDescription('Team name').setRequired(true).setMaxLength(60))
      .addStringOption((o) =>
        o
          .setName('kind')
          .setDescription('Public teams are listed for anyone to join; private need a code')
          .setRequired(true)
          .addChoices({ name: 'Public — listed for others', value: 'public' }, { name: 'Private — join code only', value: 'private' }),
      ),
  )
  .addSubcommand((sub: SlashCommandSubcommandBuilder) =>
    sub
      .setName('join-code')
      .setDescription('Join a private team with its code')
      .addStringOption((o) => o.setName('code').setDescription('The 6-character team code').setRequired(true).setMaxLength(6)),
  )
  .addSubcommand((sub: SlashCommandSubcommandBuilder) =>
    sub.setName('team-code').setDescription('Show the join code for your private team'),
  )
  .addSubcommand((sub: SlashCommandSubcommandBuilder) =>
    sub
      .setName('teammates')
      .setDescription('Say who you want on your team (they must sign up too)')
      .addUserOption((o) => o.setName('friend1').setDescription('Teammate'))
      .addUserOption((o) => o.setName('friend2').setDescription('Teammate'))
      .addUserOption((o) => o.setName('friend3').setDescription('Teammate'))
      .addUserOption((o) => o.setName('friend4').setDescription('Teammate'))
      .addUserOption((o) => o.setName('friend5').setDescription('Teammate')),
  )

  .addSubcommandGroup((group: SlashCommandSubcommandGroupBuilder) =>
    group
      .setName('admin')
      .setDescription('Organizer tools')
      .addSubcommand((sub: SlashCommandSubcommandBuilder) =>
        sub
          .setName('block')
          .setDescription('Block a user from signing up')
          .addUserOption((o) => o.setName('user').setDescription('Who').setRequired(true))
          .addStringOption((o) => o.setName('reason').setDescription('Why').setMaxLength(200)),
      )
      .addSubcommand((sub: SlashCommandSubcommandBuilder) =>
        sub.setName('unblock').setDescription('Unblock a user').addUserOption((o) => o.setName('user').setDescription('Who').setRequired(true)),
      )
      .addSubcommand((sub: SlashCommandSubcommandBuilder) =>
        sub.setName('remove').setDescription('Remove a signup entirely').addUserOption((o) => o.setName('user').setDescription('Who').setRequired(true)),
      )
      .addSubcommand((sub: SlashCommandSubcommandBuilder) =>
        sub
          .setName('move')
          .setDescription('Move a user into a team (or out of one)')
          .addUserOption((o) => o.setName('user').setDescription('Who').setRequired(true))
          .addStringOption((o) => o.setName('team').setDescription('Team name or id; leave empty to unassign').setAutocomplete(true)),
      )
      .addSubcommand((sub: SlashCommandSubcommandBuilder) =>
        sub.setName('match-preview').setDescription('Preview team matching without changing anything'),
      )
      .addSubcommand((sub: SlashCommandSubcommandBuilder) =>
        sub.setName('match-run').setDescription('Run team matching and commit the teams'),
      )
      .addSubcommand((sub: SlashCommandSubcommandBuilder) =>
        sub.setName('reset').setDescription('Reset the event — clears signups and teams (form stays)'),
      )
      .addSubcommand((sub: SlashCommandSubcommandBuilder) =>
        sub.setName('form').setDescription('Show the current signup form configuration'),
      ),
  )
  .toJSON();
