/**
 * Console authorisation: current-request checks plus OAuth guild candidates.
 *
 * OAuth permissions are a login snapshot, not authority. Candidate guilds only
 * constrain where the member can act; freshGuildAccess checks authority per request.
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

/** Current-request authority; OAuth guild permissions are only a login snapshot. */
export function hasGuildManageAuthority(
  userId: string,
  ownerId: string,
  permissions: string | number | bigint,
  memberRoleIds: readonly string[],
  delegatedRoleIds: readonly string[],
): boolean {
  if (userId === ownerId) return true;
  let bits: bigint;
  try {
    bits = BigInt(permissions);
  } catch {
    return false;
  }
  return (bits & ADMINISTRATOR) !== 0n || memberRoleIds.some((id) => delegatedRoleIds.includes(id));
}

/** Session candidates are OAuth guild memberships where the bot is present. */
export function candidateGuilds(userGuilds: OAuthGuild[], botGuildIds: ReadonlySet<string> | null): ManageableGuild[] {
  return userGuilds
    .filter((g) => botGuildIds !== null && botGuildIds.has(g.id))
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

export type SessionRef = { kind: 'discord'; sessionId: string; audience: 'organizer' | 'participant' };

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

export function makeDiscordToken(secret: string, sessionId: string, now: number = Date.now(), audience: 'organizer' | 'participant' = 'organizer'): string {
  const exp = now + SESSION_TTL_MS;
  return `${exp}.d.${audience}.${sessionId}.${sign(secret, `${DISCORD_SCOPE}:${audience}`, `${exp}:${sessionId}`)}`;
}

export function verifyToken(secret: string, token: string, now: number = Date.now()): SessionRef | null {
  const parts = token.split('.');
  const exp = Number(parts[0]);
  if (!Number.isFinite(exp) || exp < now) return null;


  if (parts.length === 5 && parts[1] === 'd' && (parts[2] === 'organizer' || parts[2] === 'participant')) {
    const audience = parts[2];
    const sessionId = parts[3] ?? '';
    const mac = parts[4] ?? '';
    if (sessionId === '') return null;
    return macMatches(sign(secret, `${DISCORD_SCOPE}:${audience}`, `${exp}:${sessionId}`), mac) ? { kind: 'discord', sessionId, audience } : null;
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

export function participantReturnPath(value: unknown): string {
  return typeof value === 'string' && /^\/events\/[A-Za-z0-9_-]{1,100}\/signup$/.test(value) ? value : '/my-hackathons';
}

/** Return destination is authenticated, expires, and is also bound to the state cookie. */
export function makeParticipantState(secret: string, path: unknown, now = Date.now()): string {
  const payload = Buffer.from(JSON.stringify({ nonce: makeState(), path: participantReturnPath(path), exp: now + 600_000 })).toString('base64url');
  return `${payload}.${sign(secret, 'participant-oauth', payload)}`;
}

export function participantStateReturn(secret: string, state: string, now = Date.now()): string | null {
  const [payload, mac, extra] = state.split('.');
  if (!payload || !mac || extra !== undefined || !macMatches(sign(secret, 'participant-oauth', payload), mac)) return null;
  try {
    const value = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as { path: unknown; exp: unknown };
    return typeof value.exp === 'number' && value.exp >= now ? participantReturnPath(value.path) : null;
  } catch { return null; }
}
