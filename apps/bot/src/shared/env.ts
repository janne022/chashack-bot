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
    if (value.length >= 2 && (value.startsWith('"') || value.startsWith("'")) && value.endsWith(value[0]!)) value = value.slice(1, -1);
    if (process.env[key] === undefined || process.env[key] === '') process.env[key] = value;
  }
}

export interface Env {
  discordToken: string;
  clientId: string;
  guildId: string | undefined;
  adminIds: string[];
  adminPort: number;
  adminSessionSecret: string;
  discordClientSecret: string | undefined;
  oauthRedirectUri: string | undefined;
  publicUrl: string | undefined;
  databaseUrl?: string | undefined;
  migrationDatabaseUrl?: string | undefined;
  announceChannelId: string | undefined;
  auditChannelId: string | undefined;
  teamCategoryId: string | undefined;
  botLanguage: 'en' | 'sv';
  skipDiscord: boolean;
}

export function requireSessionSecret(secret: string): string {
  if (secret.length < 32) throw new Error('ADMIN_SESSION_SECRET is required and must be at least 32 characters (see .env.example)');
  return secret;
}

let cached: Env | undefined;

export function env(): Env {
  if (cached) return cached;
  loadDotEnv();
  const get = (key: string): string => (process.env[key] ?? '').trim();
  const token = get('DISCORD_TOKEN');
  const clientId = get('DISCORD_CLIENT_ID');
  const clientSecret = get('DISCORD_CLIENT_SECRET');
  const skipDiscord = get('SKIP_DISCORD') === '1' || process.env.RUN_DRY === '1';
  const botLanguage = get('BOT_LANGUAGE') === 'sv' ? 'sv' : 'en';
  const missing: string[] = [];
  if (!skipDiscord) {
    if (token === '') missing.push('DISCORD_TOKEN');
    if (clientId === '') missing.push('DISCORD_CLIENT_ID');
    if (clientSecret === '') missing.push('DISCORD_CLIENT_SECRET');
  }
  if (missing.length > 0) throw new Error(`Missing required environment variables: ${missing.join(', ')} (see .env.example)`);
  cached = {
    discordToken: token,
    clientId,
    guildId: get('DISCORD_GUILD_ID') || undefined,
    adminIds: get('ADMIN_IDS').split(/[\s,]+/).filter((s) => s !== ''),
    adminPort: Number(get('ADMIN_PORT') || '8420'),
    adminSessionSecret: requireSessionSecret(get('ADMIN_SESSION_SECRET')),
    discordClientSecret: clientSecret || undefined,
    oauthRedirectUri: get('OAUTH_REDIRECT_URI') || undefined,
    publicUrl: get('PUBLIC_URL') || undefined,
    databaseUrl: process.env.DATABASE_URL,
    migrationDatabaseUrl: process.env.MIGRATION_DATABASE_URL,
    announceChannelId: get('ANNOUNCE_CHANNEL_ID') || undefined,
    auditChannelId: get('AUDIT_CHANNEL_ID') || undefined,
    teamCategoryId: get('TEAM_CATEGORY_ID') || undefined,
    botLanguage,
    skipDiscord,
  };
  return cached;
}

/** For tests / tooling only. */
export function resetEnvCache(): void {
  cached = undefined;
}
