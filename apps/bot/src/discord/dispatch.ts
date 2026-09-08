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
import { getActiveEvent, getEvent, getEventForm } from '../features/events/service.js';
import { handleUserCommand } from './user-commands.js';
import { handleAdminCommand } from './admin-commands.js';
import { handleEventAdminCommand, handleEventInfo } from './event-commands.js';
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

      const activeEvent = getActiveEvent(deps.db, guildId);
      const guildDefault = getForm(deps.db);
      const ctx: Ctx = {
        db: deps.db,
        config: getEventForm(deps.db, activeEvent, guildDefault),
        eventId: activeEvent?.id ?? guildId,
        eventName: activeEvent?.name ?? 'the hackathon',
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
        if (sub === 'event' && group === null) {
          // Public event info card.
          await interaction.reply({ embeds: [handleEventInfo(ctx)], flags: 64 });
          return;
        }
        const eventAdminSubs = [
          'event-create',
          'event-config',
          'event-activate',
          'event-end',
          'announce',
          'discord-event',
          'template-save',
          'templates',
        ];
        if (group === 'admin' && eventAdminSubs.includes(sub)) {
          if (!ctx.isAdmin) {
            await interaction.reply(eph('Organizer only — you need **Manage Server** or be in ADMIN_IDS.'));
            return;
          }
          await handleEventAdminCommand(interaction, ctx, sub);
          return;
        }
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
  const { listEvents, listTemplates } = await import('../features/events/service.js');
  if (focused.name === 'team') {
    const activeEvent = getActiveEvent(deps.db, interaction.guildId);
    if (activeEvent === null) {
      await interaction.respond([]);
      return;
    }
    const teams = listTeams(deps.db, activeEvent.id);
    await interaction.respond(
      teams.slice(0, 25).map((t) => ({ name: `${t.name} (${t.kind})`, value: t.id })),
    );
    return;
  }
  if (focused.name === 'template') {
    const templates = listTemplates(deps.db, interaction.guildId, 'event');
    await interaction.respond(
      templates.slice(0, 25).map((t) => ({ name: `${t.name} (event template)`, value: t.id })),
    );
    return;
  }
  if (focused.name === 'id') {
    const events = listEvents(deps.db, interaction.guildId).filter((e) => e.status === 'draft');
    await interaction.respond(
      events.slice(0, 25).map((e) => ({ name: `${e.name} (${e.status})`, value: e.id })),
    );
    return;
  }
  await interaction.respond([]);
}
