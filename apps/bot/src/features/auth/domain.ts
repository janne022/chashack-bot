/**
 * Console authorisation: who may manage which guild.
 *
 * Two conditions must both hold — the person must administer the guild, and the
 * bot must be in it. Admin rights alone can't run a hackathon the bot can't see;
 * bot presence alone is not permission.
 */
import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

export const ADMINISTRATOR = 1n << 3n;
export const MANAGE_GUILD = 1n << 5n;

export interface OAuthGuild {
  id: string;
  name: string;
  icon: string | null;
  /** Discord sends this as a decimal string. */
  permissions: string;
}

export interface ManageableGuild {
  id: string;
  name: string;
  icon: string | null;
}

/** A guild is manageable when the user administers it and the bot is present. */
export function canManage(permissions: string | number | bigint): boolean {
  let bits: bigint;
  try {
    bits = BigInt(permissions);
  } catch {
    return false;
  }
  return (bits & ADMINISTRATOR) !== 0n || (bits & MANAGE_GUILD) !== 0n;
}

/**
 * Intersect "guilds this user administers" with "guilds the bot is in".
 * `botGuildIds` is null when the gateway is down — then we trust the OAuth list
 * alone so a console without a gateway still lists something to manage.
 */
export function manageableGuilds(userGuilds: OAuthGuild[], botGuildIds: ReadonlySet<string> | null): ManageableGuild[] {
  return userGuilds
    .filter((g) => canManage(g.permissions))
    .filter((g) => botGuildIds === null || botGuildIds.has(g.id))
    .map((g) => ({ id: g.id, name: g.name, icon: g.icon }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

// ─── session tokens ──────────────────────────────────────────────────────────
//
// Two kinds, one cookie:
//   operator: `${exp}.${sig}`                    (password login — unchanged)
//   discord : `${exp}.d.${sessionId}.${sig}`
// The operator format is byte-identical to what earlier releases issued, so an
// upgrade does not log anyone out.

export type SessionRef = { kind: 'operator' } | { kind: 'discord'; sessionId: string };

const OPERATOR_SCOPE = 'admin';
const DISCORD_SCOPE = 'session';

function sign(secret: string, scope: string, payload: string): string {
  return createHmac('sha256', secret).update(`${scope}:${payload}`).digest('hex');
}

function macMatches(expected: string, given: string): boolean {
  const a = Buffer.from(expected);
  const b = Buffer.from(given);
  return a.length === b.length && timingSafeEqual(a, b);
}

export const SESSION_TTL_MS = 7 * 24 * 3600 * 1000;

export function makeOperatorToken(secret: string, now: number = Date.now()): string {
  const exp = now + SESSION_TTL_MS;
  return `${exp}.${sign(secret, OPERATOR_SCOPE, String(exp))}`;
}

export function makeDiscordToken(secret: string, sessionId: string, now: number = Date.now()): string {
  const exp = now + SESSION_TTL_MS;
  return `${exp}.d.${sessionId}.${sign(secret, DISCORD_SCOPE, `${exp}:${sessionId}`)}`;
}

export function verifyToken(secret: string, token: string, now: number = Date.now()): SessionRef | null {
  const parts = token.split('.');
  const exp = Number(parts[0]);
  if (!Number.isFinite(exp) || exp < now) return null;

  if (parts.length === 2) {
    const mac = parts[1] ?? '';
    return macMatches(sign(secret, OPERATOR_SCOPE, String(exp)), mac) ? { kind: 'operator' } : null;
  }

  if (parts.length === 4 && parts[1] === 'd') {
    const sessionId = parts[2] ?? '';
    const mac = parts[3] ?? '';
    if (sessionId === '') return null;
    return macMatches(sign(secret, DISCORD_SCOPE, `${exp}:${sessionId}`), mac) ? { kind: 'discord', sessionId } : null;
  }

  return null;
}

/** CSRF nonce for the OAuth round trip. */
export function makeState(): string {
  return randomBytes(16).toString('hex');
}

export function base64Url(buf: Buffer): string {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/**
 * PKCE (RFC 7636, S256). We are a confidential client so the code exchange is
 * already authenticated by the client secret — PKCE is the second lock: it binds
 * the authorization code to *this* browser, so a code that leaks (referrer,
 * logs, a co-tenant on the redirect host) is useless without the verifier, which
 * never leaves our cookie.
 */
export function makePkcePair(): { verifier: string; challenge: string } {
  const verifier = base64Url(randomBytes(32)); // 43 chars, inside the 43–128 range
  const challenge = base64Url(createHash('sha256').update(verifier).digest());
  return { verifier, challenge };
}

/** Constant-time string compare for nonces we did not generate ourselves. */
export function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}
