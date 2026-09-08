/**
 * Slash command registration (used by the CLI script and on bot startup).
 * Guild-scoped when DISCORD_GUILD_ID is set (instant), otherwise global
 * (may take up to an hour to propagate).
 */
import { REST, Routes } from 'discord.js';
import { env } from './shared/env.js';
import { HACKATHON_COMMAND } from './discord/commands.js';

const body = [HACKATHON_COMMAND];

/** Idempotent: puts the exact command set, removing anything stale. */
export async function registerCommands(): Promise<void> {
  const config = env();
  const rest = new REST().setToken(config.discordToken);
  const route =
    config.guildId !== undefined
      ? Routes.applicationGuildCommands(config.clientId, config.guildId)
      : Routes.applicationCommands(config.clientId);

  const existing = (await rest.get(route)) as { id: string; name: string }[];
  console.log(
    `Registering ${body.length} command(s) ${config.guildId !== undefined ? `in guild ${config.guildId}` : 'globally'} — before: ${existing.map((c) => c.name).join(', ') || 'none'}`,
  );
  await rest.put(route, { body });
  console.log('Commands registered.');
}
