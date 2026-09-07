/**
 * Registers slash commands with Discord. Guild-scoped when DISCORD_GUILD_ID is
 * set (instant), otherwise global (may take up to an hour to propagate).
 *
 * Run after build: pnpm register:commands
 */
import { REST, Routes } from 'discord.js';
import { env } from './shared/env.js';
import { HACKATHON_COMMAND } from './discord/commands.js';

const config = env();
const rest = new REST().setToken(config.discordToken);

const body = [HACKATHON_COMMAND];
const route =
  config.guildId !== undefined
    ? Routes.applicationGuildCommands(config.clientId, config.guildId)
    : Routes.applicationCommands(config.clientId);

const existing = (await rest.get(route)) as { id: string; name: string }[];
console.log(`Existing commands: ${existing.map((c) => c.name).join(', ') || 'none'}`);

await rest.put(route, { body });
console.log(`Registered ${body.length} command(s) ${config.guildId !== undefined ? `in guild ${config.guildId}` : 'globally'}.`);
