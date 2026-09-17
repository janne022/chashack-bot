/**
 * Slash command registration (used by the CLI script and on bot startup).
 *
 * The bot serves every guild it has been invited to, so commands are registered
 * per guild for *all* of them: that is instant (guild-scoped commands propagate
 * immediately, global ones can take an hour) and complete — an organizer in the
 * second guild gets `/hackathon` just like the first. `DISCORD_GUILD_ID` no longer
 * decides the scope; it is only the fallback guild for password sessions and the
 * value used when the guild list cannot be fetched.
 *
 * The previous opposite registration is always cleared first (global ↔ guild),
 * because Discord keeps both layers at once and would otherwise show the command
 * twice in every guild.
 */
import { REST, Routes } from 'discord.js';
import type { Guild } from 'discord.js';
import { env } from './shared/env.js';
import { COMMANDS } from './discord/commands.js';

const body = COMMANDS;

export type RegistrationPlan = { kind: 'guild'; guildIds: string[] } | { kind: 'global' };

/**
 * Where the commands should live, given the guilds the bot is actually in.
 * Nowhere to put them → global, so they exist the moment the bot is invited.
 */
export function registrationPlan(botGuildIds: readonly string[]): RegistrationPlan {
  if (botGuildIds.length === 0) return { kind: 'global' };
  return { kind: 'guild', guildIds: [...botGuildIds].sort() };
}

/**
 * Register the commands in one guild — used when the bot is invited somewhere new.
 * Goes through REST (not `guild.commands.set`) because `HACKATHON_COMMAND` is
 * already the REST body that `registerCommands` PUTs.
 */
export async function registerCommandsInGuild(guild: Guild): Promise<void> {
  const config = env();
  const rest = new REST().setToken(config.discordToken);
  await rest.put(Routes.applicationGuildCommands(config.clientId, guild.id), { body });
}

async function botGuildIds(rest: REST, fallbackGuildId: string | undefined): Promise<string[]> {
  try {
    const guilds = (await rest.get(Routes.userGuilds())) as { id: string }[];
    return guilds.map((g) => g.id);
  } catch (err) {
    console.warn(
      `[commands] could not list the bot's guilds (${err instanceof Error ? err.message : String(err)}) — ` +
        `falling back to ${fallbackGuildId ?? 'global registration'}`,
    );
    return fallbackGuildId !== undefined ? [fallbackGuildId] : [];
  }
}

async function clearGuildCommands(rest: REST, clientId: string, guildIds: readonly string[]): Promise<void> {
  for (const guildId of guildIds) {
    const route = Routes.applicationGuildCommands(clientId, guildId);
    const existing = (await rest.get(route)) as { name: string }[];
    if (existing.length === 0) continue;
    await rest.put(route, { body: [] });
    console.log(`[commands] cleared ${existing.length} guild-scoped command(s) in ${guildId} — now registered globally.`);
  }
}

async function clearGlobalCommands(rest: REST, clientId: string): Promise<void> {
  const route = Routes.applicationCommands(clientId);
  const existing = (await rest.get(route)) as { name: string }[];
  if (existing.length === 0) return;
  await rest.put(route, { body: [] });
  console.log(`[commands] cleared ${existing.length} global command(s) — now registered per guild.`);
}

/** Idempotent: puts the exact command set where it belongs, removing anything stale. */
export async function registerCommands(): Promise<void> {
  const config = env();
  const rest = new REST().setToken(config.discordToken);
  const guildIds = await botGuildIds(rest, config.guildId);
  const plan = registrationPlan(guildIds);

  if (plan.kind === 'global') {
    await clearGuildCommands(rest, config.clientId, guildIds);
    await rest.put(Routes.applicationCommands(config.clientId), { body });
    console.log(`[commands] registered ${body.length} command(s) globally — no guilds yet, propagation can take up to 1h.`);
    return;
  }

  await clearGlobalCommands(rest, config.clientId);
  for (const guildId of plan.guildIds) {
    const route = Routes.applicationGuildCommands(config.clientId, guildId);
    const existing = (await rest.get(route)) as { name: string }[];
    await rest.put(route, { body });
    console.log(
      `[commands] registered ${body.length} command(s) in guild ${guildId} — before: ${existing.map((c) => c.name).join(', ') || 'none'}`,
    );
  }
}
