/**
 * Bot entrypoint: login, wire handlers, start admin web server.
 */
import { Client, Events, GatewayIntentBits, Partials } from 'discord.js';
import { env } from './shared/env.js';
import { openDb, resolveDbPath } from './shared/db.js';
import { audit } from './shared/audit.js';
import { registerInteractionHandlers } from './discord/dispatch.js';
import { startAdminServer } from './adminweb/server.js';

const config = env();
const db = openDb(resolveDbPath(config.dbPath));

const client = new Client({
  intents: [GatewayIntentBits.Guilds],
  partials: [Partials.Channel],
});

client.once(Events.ClientReady, async (ready) => {
  console.log(`Logged in as ${ready.user.tag}`);
  if (config.guildId) {
    console.log(`Single-guild mode: ${config.guildId}`);
  }
});

/** Mirror audit lines to a Discord channel when configured. */
async function announce(guildId: string, content: string): Promise<void> {
  audit(db, 'system', 'announce', guildId, { content: content.slice(0, 200) });
  if (config.auditChannelId === undefined) return;
  try {
    const channel = await client.channels.fetch(config.auditChannelId);
    if (channel !== null && channel.isTextBased() && 'send' in channel) {
      await channel.send({ content: content.slice(0, 2000) });
    }
  } catch (error) {
    console.error('audit channel send failed:', error);
  }
}

registerInteractionHandlers(client, {
  db,
  adminIds: config.adminIds,
  announce,
});

if (config.skipDiscord) {
  console.log('SKIP_DISCORD set — starting admin server without the Discord gateway.');
} else {
  await client.login(config.discordToken);
}

const server = await startAdminServer({ db, config, announce });

async function shutdown(signal: string): Promise<void> {
  console.log(`${signal} received, shutting down…`);
  try {
    await server.stop();
    await client.destroy();
  } finally {
    db.close();
    process.exit(0);
  }
}
process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));
