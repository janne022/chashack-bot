/**
 * Typed environment configuration. Fails fast on missing required values,
 * except when RUN_DRY (bot not started) — used by typecheck/tests.
 */
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

function loadDotEnv(): void {
  const envPath = join(root, '.env');
  if (!existsSync(envPath)) return;
  for (const line of readFileSync(envPath, 'utf8').split('\n')) {
    const trimmed = line.trim();
    if (trimmed === '' || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (value.length >= 2 && (value.startsWith('"') || value.startsWith("'")) && value.endsWith(value[0]!)) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined || process.env[key] === '') {
      process.env[key] = value;
    }
  }
}

export interface Env {
  discordToken: string;
  clientId: string;
  guildId: string | undefined;
  adminIds: string[];
  adminPort: number;
  adminPassword: string;
  adminSessionSecret: string;
  dbPath: string;
  announceChannelId: string | undefined;
  auditChannelId: string | undefined;
  /** Run the admin panel without the Discord gateway (container smoke tests, UI-only deploys). */
  skipDiscord: boolean;
}

let cached: Env | undefined;

export function env(): Env {
  if (cached) return cached;
  loadDotEnv();

  const get = (key: string): string => (process.env[key] ?? '').trim();

  const token = get('DISCORD_TOKEN');
  const clientId = get('DISCORD_CLIENT_ID');
  const adminPassword = get('ADMIN_PASSWORD');
  const skipDiscord = get('SKIP_DISCORD') === '1' || process.env.RUN_DRY === '1';

  const missing: string[] = [];
  if (!skipDiscord) {
    if (token === '') missing.push('DISCORD_TOKEN');
    if (clientId === '') missing.push('DISCORD_CLIENT_ID');
    if (adminPassword === '') missing.push('ADMIN_PASSWORD');
  } else if (adminPassword === '') {
    missing.push('ADMIN_PASSWORD');
  }
  if (missing.length > 0) {
    throw new Error(`Missing required environment variables: ${missing.join(', ')} (see .env.example)`);
  }

  cached = {
    discordToken: token,
    clientId: clientId,
    guildId: get('DISCORD_GUILD_ID') || undefined,
    adminIds: get('ADMIN_IDS')
      .split(/[\s,]+/)
      .filter((s) => s !== ''),
    adminPort: Number(get('ADMIN_PORT') || '8420'),
    adminPassword: adminPassword,
    adminSessionSecret: get('ADMIN_SESSION_SECRET') || adminPassword,
    dbPath: get('DB_PATH') || 'data/chashack.db',
    announceChannelId: get('ANNOUNCE_CHANNEL_ID') || undefined,
    auditChannelId: get('AUDIT_CHANNEL_ID') || undefined,
    skipDiscord,
  };
  return cached;
}

/** For tests / tooling only. */
export function resetEnvCache(): void {
  cached = undefined;
}
