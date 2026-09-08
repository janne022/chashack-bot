/**
 * Central interaction router: builds Ctx, checks admin, dispatches.
 */
import {
  PermissionFlagsBits,
  type AutocompleteInteraction,
  type Client,
  type Interaction,
} from 'discord.js';
import type { Db } from '../shared/db.js';
import { getForm } from '../features/form/service.js';
import { listTeams, getGuildSettings } from '../features/teams/service.js';
import { handleUserCommand } from './user-commands.js';
import { handleAdminCommand } from './admin-commands.js';
import { onComponent, onModalSubmit } from './components.js';
import { eph, type Ctx } from './shared.js';

export interface RouterDeps {
  db: Db;
  adminIds: string[];
  client: Client;
  /** Env fallback for the team channel category (guild setting wins). */
  teamCategoryId: string | undefined;
  announce: (guildId: string, content: string) => Promise<void>;
}

export function isAdminMember(interaction: Interaction, adminIds: string[]): boolean {
  if (adminIds.includes(interaction.user.id)) return true;
  if (interaction.inGuild() && interaction.memberPermissions !== null) {
    return (
      interaction.memberPermissions.has(PermissionFlagsBits.ManageGuild) ||
      interaction.memberPermissions.has(PermissionFlagsBits.Administrator)
    );
  }
  return false;
}

export function makeDm(client: Client): Ctx['dm'] {
  return async (userId, payload) => {
    try {
      const user = await client.users.fetch(userId);
      await user.send(payload);
      return true;
    } catch {
      return false; // DMs closed / unknown user
    }
  };
}

export function registerInteractionHandlers(client: Client, deps: RouterDeps): void {
  const categoryIdFor = (guildId: string): string | undefined =>
    getGuildSettings(deps.db, guildId).teamCategoryId ?? deps.teamCategoryId;
  const dm = makeDm(client);

  client.on('interactionCreate', async (interaction: Interaction) => {
    try {
      if (interaction.isAutocomplete()) {
        await handleAutocomplete(interaction, deps);
        return;
      }
      const guildId = interaction.inGuild() ? interaction.guildId : null;
      if (guildId === null) {
        if (interaction.isRepliable() && !interaction.replied && !interaction.deferred) {
          await interaction.reply(eph('Use this inside a server.'));
        }
        return;
      }
      if (
        !interaction.isChatInputCommand() &&
        !interaction.isModalSubmit() &&
        !interaction.isButton() &&
        !interaction.isStringSelectMenu()
      ) {
        return;
      }

      const ctx: Ctx = {
        db: deps.db,
        config: getForm(deps.db),
        guildId,
        actor: `discord:${interaction.user.id}`,
        isAdmin: isAdminMember(interaction, deps.adminIds),
        client,
        categoryIdFor,
        dm,
      };

      if (interaction.isChatInputCommand()) {
        const group = interaction.options.getSubcommandGroup(false);
        const sub = interaction.options.getSubcommand(false) ?? '';
        if (group === 'admin') {
          if (!ctx.isAdmin) {
            await interaction.reply(eph('Organizer only — you need **Manage Server** or be in ADMIN_IDS.'));
            return;
          }
          await handleAdminCommand(interaction, ctx, sub);
        } else {
          await handleUserCommand(interaction, ctx, sub);
        }
        return;
      }

      if (interaction.isModalSubmit()) {
        await onModalSubmit(interaction, { ...ctx, announce: deps.announce });
        return;
      }
      await onComponent(interaction, { ...ctx, announce: deps.announce });
    } catch (error) {
      console.error('interaction handler failed:', error);
      try {
        const payload = { content: 'Something broke on our side. Try again, or ping an organizer.', flags: 64 };
        if (interaction.isRepliable() && !interaction.replied && !interaction.deferred) {
          await interaction.reply(payload);
        } else if (interaction.isRepliable() && interaction.deferred && !interaction.replied) {
          await interaction.editReply(payload);
        }
      } catch {
        /* interaction token expired */
      }
    }
  });
}

async function handleAutocomplete(interaction: AutocompleteInteraction, deps: RouterDeps): Promise<void> {
  if (!interaction.inGuild()) {
    await interaction.respond([]);
    return;
  }
  const focused = interaction.options.getFocused(true);
  if (focused.name === 'team') {
    const teams = listTeams(deps.db, interaction.guildId);
    await interaction.respond(
      teams.slice(0, 25).map((t) => ({ name: `${t.name} (${t.kind})`, value: t.id })),
    );
    return;
  }
  await interaction.respond([]);
}
