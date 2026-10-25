/**
 * Admin web routes. Session auth via HMAC-signed cookie; all state-changing
 * routes are POST + JSON. UI files served from public/.
 */
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Db } from '../shared/db.js';
import type { Env } from '../shared/env.js';
import { mutationBodyError } from './validation.js';
import {
  makeDiscordToken,
  makePkcePair,
  makeState,
  makeParticipantState,
  participantStateReturn,
  candidateGuilds,
  hasGuildManageAuthority,
  safeEqual,
  verifyToken,
  type OAuthGuild,
  type SessionRef,
} from '../features/auth/domain.js';
import {
  createSession,
  deleteSession,
  deleteUserSessions,
  getSession,
  purgeExpiredSessions,
  selectGuild,
  type WebSession,
} from '../features/auth/data.js';
import { audit } from '../shared/audit.js';
import { finishParticipantDeparture } from '../features/signup/lifecycle.js';
import { signupAdmission } from '../features/signup/domain.js';
import { auditList } from '../shared/audit.js';
import {
  blockParticipant,
  unblockParticipant,
  withdrawParticipant,
  listParticipants,
  getParticipant,
  reactivateParticipant,
} from '../features/signup/data.js';
import {
  createTeam,
  deleteTeam,
  rotateJoinCode,
  adminAssign,
  getTeam,
  listTeams,
  removeMember,
  updateTeamSettings,
  setGuildCategory,
  getGuildSettings,
  updateGuildSettings,
} from '../features/teams/data.js';
import { previewMatch, commitMatch, lastMatchInfo, listTeamsWithMembers } from '../features/matching/data.js';
import { projectParticipantForMatching } from '../features/signup/data.js';
import { suggestTeamsForParticipant } from '../features/matching/domain.js';
import {
  createEvent,
  getActiveEvent,
  getEvent,
  getEventForm,
  listEvents,
  activateEvent,
  endEvent,
  updateEvent,
  markMatchLocked,
  markMatchUnlocked,
  saveTemplate,
  listTemplates,
  deleteTemplate,
  updateTemplateContent,
} from '../features/events/data.js';
import { getForm, updateForm, resetForm } from '../features/form/data.js';
import { refreshSignupPanel, postOrUpdatePanel } from '../discord/signup-panel.js';
import { sendAnnouncement, createDiscordEvents } from '../discord/notify.js';
import type { FormConfig } from '../features/form/domain.js';
import { validateCustomAnswers, validateCustomQuestions, validBannerUrl, normalizeAppearance, resolveAppearance } from '../features/form/domain.js';
import { getRegistrationAnswers, listRegistrationAnswers, saveRegistrationAnswers } from '../features/registration/data.js';
import { registerParticipantTeamRoutes } from './participant-teams.js';
import { registerLiveRoute } from './live.js';
import type { ChangeHint } from '../shared/live-changes.js';
import { applyTeamLeave } from '../discord/provision.js';
import { refreshTeamPanel } from '../discord/team-panel.js';
import { eligibleParticipant, setMembershipLookup } from '../features/signup/eligibility.js';
import { lookupGuildMember } from '../discord/member-lifecycle.js';
import { runWithGuildContext, withGuildContext } from '../shared/postgres.js';
import { consumeQuota } from '../shared/rate-limit.js';
import { parseSignupCsv } from '../features/signup-import/domain.js';
import { createImportedSignups, editImportedSignup, listImportedSignups, purgeImportedSignups, summarizeImportedRows } from '../features/signup-import/data.js';
import { linkImportedSignup } from '../features/signup-import/link.js';

export interface WebDeps {
  db: Db;
  config: Env;
  announce: (guildId: string, content: string) => Promise<void>;
  /** Live Discord client, used to auto-refresh the signup panel on form edits. May be null in SKIP_DISCORD mode. */
  client: import('discord.js').Client | null;
}

const COOKIE = 'hacksess';
const PARTICIPANT_COOKIE = 'hackpartsess';
const STATE_COOKIE = 'hackstate';
const PKCE_COOKIE = 'hackpkce';
const PARTICIPANT_STATE_COOKIE = 'hackpartstate';
const PARTICIPANT_PKCE_COOKIE = 'hackpartpkce';
const OAUTH_STATE_TTL_MS = 10 * 60 * 1000;
const OAUTH_STATE_TTL_S = Math.floor(OAUTH_STATE_TTL_MS / 1000);

function sessionRefFrom(req: FastifyRequest, config: Env, audience: 'organizer' | 'participant' = 'organizer'): SessionRef | null {
  const raw = readCookie(req, audience === 'organizer' ? COOKIE : PARTICIPANT_COOKIE);
  if (raw === null) return null;
  const ref = verifyToken(config.adminSessionSecret, raw);
  return ref?.audience === audience ? ref : null;
}

function readCookie(req: FastifyRequest, name: string): string | null {
  const cookie = req.headers.cookie ?? '';
  const m = new RegExp(`(?:^|;\\s*)${name}=([^;]+)`).exec(cookie);
  try { return m === null ? null : decodeURIComponent(m[1]!); } catch { return null; }
}

function sessionCookie(token: string, secure: boolean, name = COOKIE): string {
  return `${name}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${7 * 24 * 3600}${secure ? '; Secure' : ''}`;
}

/**
 * The OAuth round trip returns as a cross-site navigation, so the state/PKCE
 * cookies must be SameSite=Lax or the browser withholds them; the session cookie
 * stays Strict. Both are HttpOnly — nothing in the page ever needs to read them.
 */
function transientCookie(name: string, value: string, maxAgeSeconds: number, secure: boolean): string {
  return `${name}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSeconds}${secure ? '; Secure' : ''}`;
}

function clearCookie(name: string, secure: boolean): string {
  return `${name}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure ? '; Secure' : ''}`;
}

function isSnowflake(id: string): boolean {
  return /^[0-9]{17,20}$/.test(id);
}

export function registerRoutes(app: FastifyInstance, deps: WebDeps): void {
  const { db, config } = deps;
  app.addHook('onRequest', async (req, reply) => {
    if (req.url.startsWith('/api/') || req.url.startsWith('/auth/')) reply.header('Cache-Control', 'no-store');
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method) && req.headers['sec-fetch-site'] === 'cross-site') {
      return reply.code(403).send({ error: 'origin_mismatch' });
    }
  });
  app.addHook('preValidation', async (req, reply) => {
    if (!req.url.startsWith('/api/') || ['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return;
    const field = mutationBodyError(req.body);
    if (field) return reply.code(400).send({ error: 'invalid_input', code: 'invalid_input', field });
  });
  app.addHook('onRequest', async (req, reply) => {
    const isPublicEntry = req.url.startsWith('/auth/') || req.url.startsWith('/api/public/') || req.url.startsWith('/events/');
    const isApi = req.url.startsWith('/api/');
    if (!isPublicEntry && !isApi) return;
    if (isApi || req.url.startsWith('/auth/')) reply.header('Cache-Control', 'no-store');
    try {
      // Source bound before session/database and Discord lookups; proxy trust is configured in server.ts.
      const signed = sessionRefFrom(req, config) ?? sessionRefFrom(req, config, 'participant');
      const result = await consumeQuota(db, 'source', req.ip, signed ? 240 : 60);
      if (!result.allowed) return reply.header('Retry-After', result.retryAfterSeconds).code(429).send({ error: 'rate_limited', retryAfterSeconds: result.retryAfterSeconds });
      const session = req.url.startsWith('/api/participant/') ? await participantSessionFrom(req) : (await sessionFrom(req))?.session;
      if (!session) return;
      const write = !['GET', 'HEAD', 'OPTIONS'].includes(req.method);
      const identity = `${session.userId}:${session.selectedGuildId ?? ''}`;
      const ordinary = await consumeQuota(db, write ? 'ordinary' : 'web-read', identity, write ? 30 : 90);
      const path = req.url.split('?')[0]!;
      // Routine team reads share the bounded read quota, not the much smaller
      // provisioning/fan-out quota. Query values never determine route cost.
      const expensive = path === '/api/guild/members' || (write && /invite|invitation|teams?|match|announce|discord-events|signup-import|channel-test|\/panel|schedule-itinerary/i.test(path));
      const costly = ordinary.allowed && expensive ? await consumeQuota(db, 'expensive', identity, 5) : ordinary;
      const denied = !ordinary.allowed ? ordinary : costly;
      if (!denied.allowed) return reply.header('Retry-After', denied.retryAfterSeconds).code(429).send({ error: 'rate_limited', retryAfterSeconds: denied.retryAfterSeconds });
    } catch { reply.code(503).send({ error: 'rate_limiter_unavailable', retryable: true }); }
  });

  /**
   * An authenticated request. A Discord token only counts while its row exists:
   * the row IS the session, so logout, expiry or a leaked cookie for a deleted
   * session must stop working immediately — the HMAC alone is not authorisation.
   */
  const sessionFrom = async (req: FastifyRequest): Promise<{ ref: SessionRef; session: WebSession } | null> => {
    const ref = sessionRefFrom(req, config);
    if (ref === null) return null;
    const session = await getSession(db, ref.sessionId);
    return session === null || session.audience !== 'organizer' ? null : { ref, session };
  };
  const actorOf = async (req: FastifyRequest): Promise<string> => `discord:${(await sessionFrom(req))!.session.userId}`;
  const completeDeparture = async (eventId: string, guildId: string, userId: string, team: import('../features/teams/data.js').Team | null) =>
    finishParticipantDeparture(db, guildId, eventId, userId, team, async (oldTeam, departed) => {
      if (deps.client === null || config.skipDiscord) throw new Error('Discord unavailable');
      await applyTeamLeave({ db, client: deps.client, categoryIdFor: () => undefined }, oldTeam, departed);
    });
  const participantSessionFrom = async (req: FastifyRequest): Promise<WebSession | null> => {
    const ref = sessionRefFrom(req, config, 'participant');
    if (ref === null) return null;
    const session = await getSession(db, ref.sessionId);
    return session?.audience === 'participant' ? session : null;
  };

  /**
   * The guild a request acts on. A Discord session carries the guild its user
   * picked. The client never names the guild, which is what
   * keeps one guild's console from reading another's data.
   */
  const guildOf = async (req: FastifyRequest): Promise<string> => {
    const live = await sessionFrom(req);
    return live?.session?.selectedGuildId ?? '';
  };

  app.addHook('preValidation', (req, reply, done) => {
    if (req.url.startsWith('/api/participant/events/')) {
      void (async () => {
        const session = await participantSessionFrom(req);
        const eventId = (req.params as { eventId?: string }).eventId;
        if (session && eventId) {
          for (const guildId of installedGuildIds()) {
            if (!await currentMember(guildId, session.userId)) continue;
            const event = await withGuildContext(db, guildId, () => getEvent(db, eventId));
            if (event?.guildId === guildId && event.status === 'active') {
              runWithGuildContext(db, guildId, done);
              return;
            }
          }
          void reply.code(404).send({ error: 'event_unavailable' });
          return;
        }
        done();
      })().catch(done);
      return;
    }
    if (!req.url.startsWith('/api/') || req.url.startsWith('/api/public/') || req.url.startsWith('/api/participant/')) {
      done();
      return;
    }
    void sessionFrom(req).then((live) => {
      const requested = req.url === '/api/auth/guild' ? (req.body as { guildId?: string } | null)?.guildId : undefined;
      const guildId = requested ?? live?.session.selectedGuildId ?? '';
      if (!live || !guildId) { done(); return; }
      runWithGuildContext(db, guildId, done);
    }).catch(done);
  });

  // ponytail: O(installed guilds) discovery; index the trusted inventory only if this ceiling matters.
  const installedGuildIds = (): string[] => deps.client === null ? [] : [...deps.client.guilds.cache.values()]
    .filter((guild) => guild.available !== false).map((guild) => guild.id);
  const currentMember = async (guildId: string, userId: string): Promise<boolean> => {
    if (deps.client === null) return false;
    try { return await lookupGuildMember(deps.client, guildId, userId); }
    catch { return false; }
  };
  const publishedEvent = async (eventId: string) => {
    for (const guildId of installedGuildIds()) {
      const projection = await withGuildContext(db, guildId, async () => {
        const event = await getEvent(db, eventId);
        if (event === null || event.guildId !== guildId || event.status === 'draft') return null;
        return { event, form: getEventForm(db, event, await getForm(db, guildId)) };
      });
      if (projection !== null) return projection;
    }
    return null;
  };

  const ownerAdminRequests = new WeakSet<FastifyRequest>();
  const freshGuildAccess = async (userId: string, guildId: string): Promise<{ allowed: boolean; ownerOrAdmin: boolean }> => {
    if (deps.client === null || !isSnowflake(guildId)) return { allowed: false, ownerOrAdmin: false };
    try {
      const guild = await deps.client.guilds.fetch(guildId);
      const member = await guild.members.fetch({ user: userId, force: true });
      const setting = await withGuildContext(db, guildId, () => db.get<{ mod_role_ids: string }>('SELECT mod_role_ids FROM guild_settings WHERE guild_id = ?', guildId));
      const decoded: unknown = setting === undefined ? [] : JSON.parse(setting.mod_role_ids);
      const delegated = Array.isArray(decoded) ? decoded.filter((id): id is string => typeof id === 'string') : [];
      const ownerOrAdmin = guild.ownerId === userId || member.permissions.has('Administrator');
      return {
        allowed: hasGuildManageAuthority(userId, guild.ownerId, member.permissions.bitfield, [...member.roles.cache.keys()], delegated),
        ownerOrAdmin,
      };
    } catch {
      return { allowed: false, ownerOrAdmin: false };
    }
  };

  /**
   * The event the admin web UI operates on when the caller doesn't name one.
   * Prefers the newest active event so single-event setups keep working, then
   * falls back to the newest event of any status (so a guild with only drafts
   * still resolves to a real event rather than the guild id).
   */
  const activeEventId = async (guild: string): Promise<string> => {
    return (await getActiveEvent(db, guild))?.id ?? (await listEvents(db, guild))[0]?.id ?? guild;
  };

  /**
   * Resolve the event an endpoint should act on. An explicit `eventId` (query
   * param or body field) always wins so multiple concurrent events are
   * addressable; otherwise fall back to the default event.
   */
  const resolveEventId = async (req: { query?: unknown; body?: unknown }, guild: string): Promise<string> => {
    const q = req.query as Record<string, unknown> | undefined;
    if (q && typeof q.eventId === 'string' && q.eventId !== '') return q.eventId;
    const b = req.body as Record<string, unknown> | null | undefined;
    if (b && typeof b.eventId === 'string' && b.eventId !== '') return b.eventId;
    return activeEventId(guild);
  };

  app.addHook('preHandler', async (req, reply) => {
    const isApi = req.url.startsWith('/api/');
    if (!isApi) return;
    if (req.url.startsWith('/api/public/events/')) return;
    if (req.url.startsWith('/api/participant/')) {
      if ((await participantSessionFrom(req)) === null) await reply.code(401).send({ error: 'unauthorized' });
      return;
    }
    const live = await sessionFrom(req);
    if (live === null) {
      await reply.code(401).send({ error: 'unauthorized' });
      return;
    }
    if (['/api/auth/logout', '/api/auth/logout-all'].includes(req.url.split('?')[0]!)) return;
    const targetGuild = req.url === '/api/auth/guild'
      ? ((req.body as { guildId?: string } | null)?.guildId ?? '')
      : live.session.selectedGuildId ?? '';
    if (targetGuild === '' && req.url === '/api/auth/me') return;
    const access = await freshGuildAccess(live.session.userId, targetGuild);
    if (!access.allowed) {
      await reply.code(403).send({ ok: false, code: 'access_refused', message: 'Your current server access is no longer valid. Refresh access or ask a server administrator for help.' });
      return;
    }
    if (access.ownerOrAdmin) ownerAdminRequests.add(req);
    if (req.url === '/api/auth/guild') return;
    if (live.session.selectedGuildId === null) {
      await reply.code(403).send({ ok: false, code: 'no_guild_selected', message: 'Choose a server you can manage to continue.' });
      return;
    }
    const params = req.params as Record<string, unknown> | undefined;
    const query = req.query as Record<string, unknown> | undefined;
    const body = req.body as Record<string, unknown> | null | undefined;
    const guildId = await guildOf(req);
    for (const eventId of [params?.eventId, query?.eventId, body?.eventId].filter((id): id is string => typeof id === 'string')) {
      const event = await getEvent(db, eventId);
      if (event !== null && event.guildId !== guildId) {
        await reply.code(404).send({ ok: false, code: 'not_found', message: 'Event not found.' });
        return;
      }
    }
    for (const teamId of [params?.teamId, query?.teamId, body?.teamId].filter((id): id is string => typeof id === 'string')) {
      const team = await db.get<{ guild_id: string }>('SELECT guild_id FROM teams WHERE id = ?', teamId);
      if (team !== undefined && team.guild_id !== guildId) {
        await reply.code(404).send({ ok: false, code: 'not_found', message: 'Team not found.' });
        return;
      }
    }
    for (const templateId of [params?.templateId, query?.templateId, body?.templateId, body?.formTemplateId].filter((id): id is string => typeof id === 'string')) {
      const template = await db.get<{ guild_id: string | null }>('SELECT guild_id FROM event_templates WHERE id = ?', templateId);
      if (template !== undefined && ((template.guild_id !== null && template.guild_id !== guildId) || (template.guild_id === null && (req.method === 'PATCH' || req.method === 'DELETE')))) {
        await reply.code(404).send({ ok: false, code: 'not_found', message: 'Template not found.' });
        return;
      }
    }
  });


  // ─── Discord OAuth2 ────────────────────────────────────────────────────────
  //
  // Authorization-code flow, hand-rolled against the REST API: the whole dance
  // is one redirect plus three fetches, so it does not justify a dependency.
  // The access token is used once (read the user + their guilds) and dropped;
  // what we keep is our own opaque session id.

  const oauthConfigured = config.discordClientSecret !== undefined && config.clientId !== '';

  /**
   * Cookie `Secure` follows the public origin: an https console sets it, and a
   * localhost dev run must not (the browser would never send the cookie back).
   */
  const secureCookies = [config.publicUrl ?? '', config.oauthRedirectUri ?? ''].some((o) =>
    o.startsWith('https://'),
  );

  /**
   * CSRF, defence in depth. The session cookie is `SameSite=Strict`, which already
   * blocks cross-site writes in modern browsers; this additionally rejects a
   * request whose `Origin` disagrees with the host we serve — covering the case
   * SameSite cannot, a sibling app on the same registrable domain.
   */
  app.addHook('preHandler', async (req, reply) => {
    const method = req.method.toUpperCase();
    if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') return;
    const origin = req.headers.origin;
    if (origin === undefined) return; // same-origin fetch in older browsers, or curl
    let originHost: string;
    try {
      originHost = new URL(origin).origin;
    } catch {
      await reply.code(403).send({ error: 'bad_origin' });
      return;
    }
    const expected =
      config.publicUrl !== undefined ? new URL(config.publicUrl).origin : `${req.protocol}://${req.headers.host ?? ''}`;
    if (originHost !== expected) {
      console.warn(JSON.stringify({ event: 'http.origin_rejected', requestId: req.id, method }));
      await reply.code(403).send({ error: 'origin_mismatch' });
    }
  });


  /**
   * Where Discord sends the code back. Never derived from an attacker-controlled
   * Host header when we know our public origin — otherwise a spoofed Host could
   * aim the redirect (and the code) at someone else's domain. The Host fallback
   * exists for local development only and is refused for anything but loopback.
   */
  const redirectUri = (req: FastifyRequest, audience: 'organizer' | 'participant' = 'organizer'): string | null => {
    const callbackPath = audience === 'organizer' ? '/auth/discord/callback' : '/auth/participant/callback'; // g0:allow:secrets t_026e28f9
    if (config.oauthRedirectUri !== undefined) {
      return audience === 'organizer' ? config.oauthRedirectUri : config.oauthRedirectUri.replace('/auth/discord/callback', callbackPath); // g0:allow:secrets t_026e28f9
    }
    if (config.publicUrl !== undefined) return `${config.publicUrl.endsWith('/') ? config.publicUrl.slice(0, -1) : config.publicUrl}${callbackPath}`;
    const host = req.headers.host ?? '';
    const loopback = /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(host);
    if (!loopback) return null;
    return `http://${host}${callbackPath}`;
  };

  app.get('/auth/discord', async (req, reply) => {
    if (!oauthConfigured) {
      await reply.code(404).send({ error: 'oauth_not_configured' });
      return;
    }
    const callback = redirectUri(req);
    if (callback === null) {
      await reply
        .code(500)
        .send({ error: 'redirect_uri_unconfigured', message: 'Set OAUTH_REDIRECT_URI (or PUBLIC_URL) to the URL registered in the Discord Developer Portal.' });
      return;
    }
    const state = makeState();
    const pkce = makePkcePair();
    const url = new URL('https://discord.com/oauth2/authorize');
    url.searchParams.set('client_id', config.clientId);
    url.searchParams.set('redirect_uri', callback);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('scope', 'identify guilds');
    url.searchParams.set('state', state);
    url.searchParams.set('code_challenge', pkce.challenge);
    url.searchParams.set('code_challenge_method', 'S256');
    url.searchParams.set('prompt', 'consent');
    reply.header('set-cookie', [
      transientCookie(STATE_COOKIE, state, OAUTH_STATE_TTL_S, secureCookies),
      transientCookie(PKCE_COOKIE, pkce.verifier, OAUTH_STATE_TTL_S, secureCookies),
    ]);
    reply.header('cache-control', 'no-store');
    await audit(db, 'web', 'web.oauth_start', 'discord', null, null);
    await reply.redirect(url.toString());
  });

  app.get('/auth/discord/callback', async (req, reply) => {
    reply.header('cache-control', 'no-store');
    if (!oauthConfigured) {
      await reply.code(404).send({ error: 'oauth_not_configured' });
      return;
    }
    const query = req.query as { code?: string; state?: string; error?: string };
    const expectedState = readCookie(req, STATE_COOKIE);
    const verifier = readCookie(req, PKCE_COOKIE);
    const fail = async (reason: string): Promise<void> => {
      reply.header('set-cookie', [
        clearCookie(STATE_COOKIE, secureCookies),
        clearCookie(PKCE_COOKIE, secureCookies),
      ]);
      console.warn(`[oauth] login refused: ${reason}`);
      await reply.redirect(`/events?auth=${reason}`);
    };

    if (query.error !== undefined) return void (await fail('cancelled'));
    // CSRF: the nonce we set before redirecting must come back unchanged, and it
    // is compared in constant time.
    if (
      query.state === undefined ||
      expectedState === null ||
      !safeEqual(query.state, expectedState) ||
      verifier === null
    ) {
      return void (await fail('bad_state'));
    }
    if (query.code === undefined || query.code === '') return void (await fail('no_code'));
    const callback = redirectUri(req);
    if (callback === null) return void (await fail('redirect_uri_unconfigured'));

    try {
      const tokenRes = await fetch('https://discord.com/api/v10/oauth2/token', {
        method: 'POST',
        signal: AbortSignal.timeout(10_000),
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id: config.clientId,
          client_secret: config.discordClientSecret!,
          grant_type: 'authorization_code',
          code: query.code,
          redirect_uri: callback,
          code_verifier: verifier,
        }),
      });
      if (!tokenRes.ok) {
        // Status only — a token response body can carry credentials.
        console.warn(`[oauth] token exchange failed: ${tokenRes.status}`);
        return void (await fail('exchange_failed'));
      }
      const token = (await tokenRes.json()) as { access_token?: string; token_type?: string };
      if (token.access_token === undefined || (token.token_type ?? '').toLowerCase() !== 'bearer') {
        return void (await fail('exchange_failed'));
      }
      // Used once, never stored, never logged. Any refresh_token is deliberately
      // dropped: the console does not need long-lived access to the account.
      const accessToken = token.access_token;

      const auth = { Authorization: `Bearer ${accessToken}` };
      const [userRes, guildsRes] = await Promise.all([
        fetch('https://discord.com/api/v10/users/@me', { headers: auth, signal: AbortSignal.timeout(10_000) }),
        fetch('https://discord.com/api/v10/users/@me/guilds', { headers: auth, signal: AbortSignal.timeout(10_000) }),
      ]);
      if (!userRes.ok || !guildsRes.ok) {
        console.warn(`[oauth] identity fetch failed: user=${userRes.status} guilds=${guildsRes.status}`);
        return void (await fail('identity_failed'));
      }
      const user = (await userRes.json()) as { id: string; username: string; avatar: string | null };
      const userGuilds = (await guildsRes.json()) as OAuthGuild[];

      // OAuth permissions are stale/non-authoritative; freshGuildAccess checks
      // current owner/admin/delegated-role authority on each request.
      const botGuildIds = deps.client === null ? null : new Set(deps.client.guilds.cache.keys());
      const candidates = candidateGuilds(userGuilds, botGuildIds);
      const access = await Promise.all(candidates.map(async (guild) => ({
        guild,
        allowed: (await freshGuildAccess(user.id, guild.id)).allowed,
      })));
      const guilds = access.filter((entry) => entry.allowed).map((entry) => entry.guild);
      if (guilds.length === 0) return void (await fail('no_guild'));

      // Session fixation: never adopt a session presented by the client. Any
      // pre-existing one dies here, and the new id is minted server-side.
      const presented = sessionRefFrom(req, config);
      if (presented !== null && presented.kind === 'discord') await deleteSession(db, presented.sessionId);

      await purgeExpiredSessions(db);
      const session = await createSession(db, {
        userId: user.id,
        username: user.username,
        avatar: user.avatar,
        guilds,
      });
      await audit(db, 'discord', 'web.login', user.id, { guilds: guilds.length, via: 'oauth' }, null);
      reply.header('set-cookie', [
        sessionCookie(makeDiscordToken(config.adminSessionSecret, session.id), secureCookies),
        clearCookie(STATE_COOKIE, secureCookies),
        clearCookie(PKCE_COOKIE, secureCookies),
      ]);
      await reply.redirect('/');
    } catch (error) {
      console.warn('[oauth] callback failed');
      await fail('error');
    }
  });

  app.get('/auth/participant', async (req, reply) => {
    if (!oauthConfigured) return reply.code(404).send({ error: 'oauth_not_configured' });
    const callback = redirectUri(req, 'participant');
    if (callback === null) return reply.code(500).send({ error: 'redirect_uri_unconfigured' });
    const state = makeParticipantState(config.adminSessionSecret, (req.query as { returnTo?: unknown }).returnTo);
    const pkce = makePkcePair();
    const url = new URL('https://discord.com/oauth2/authorize');
    url.searchParams.set('client_id', config.clientId);
    url.searchParams.set('redirect_uri', callback);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('scope', 'identify');
    url.searchParams.set('state', state);
    url.searchParams.set('code_challenge', pkce.challenge);
    url.searchParams.set('code_challenge_method', 'S256');
    reply.header('set-cookie', [
      transientCookie(PARTICIPANT_STATE_COOKIE, state, OAUTH_STATE_TTL_S, secureCookies),
      transientCookie(PARTICIPANT_PKCE_COOKIE, pkce.verifier, OAUTH_STATE_TTL_S, secureCookies),
    ]);
    reply.header('cache-control', 'no-store');
    return reply.redirect(url.toString());
  });

  app.get('/auth/participant/callback', async (req, reply) => {
    reply.header('cache-control', 'no-store');
    if (!oauthConfigured) return reply.code(404).send({ error: 'oauth_not_configured' });
    const query = req.query as { code?: string; state?: string; error?: string };
    const expectedState = readCookie(req, PARTICIPANT_STATE_COOKIE);
    const verifier = readCookie(req, PARTICIPANT_PKCE_COOKIE);
    const fail = async (reason: string) => {
      reply.header('set-cookie', [clearCookie(PARTICIPANT_STATE_COOKIE, secureCookies), clearCookie(PARTICIPANT_PKCE_COOKIE, secureCookies)]);
      return reply.redirect(`/my-hackathons?participant_auth=${reason}`);
    };
    if (query.error !== undefined) return fail('cancelled');
    if (query.state === undefined || expectedState === null || !safeEqual(query.state, expectedState) || verifier === null) return fail('bad_state');
    const returnPath = participantStateReturn(config.adminSessionSecret, query.state);
    if (returnPath === null) return fail('bad_state');
    if (!query.code) return fail('no_code');
    const callback = redirectUri(req, 'participant');
    if (callback === null) return fail('redirect_uri_unconfigured');
    try {
      const tokenRes = await fetch('https://discord.com/api/v10/oauth2/token', {
        method: 'POST', signal: AbortSignal.timeout(10_000), headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, // g0:allow:secrets t_026e28f9
        body: new URLSearchParams({
          client_id: config.clientId, client_secret: config.discordClientSecret!, grant_type: 'authorization_code',
          code: query.code, redirect_uri: callback, code_verifier: verifier,
        }),
      });
      if (!tokenRes.ok) return fail('exchange_failed');
      const token = await tokenRes.json() as { access_token?: string; token_type?: string };
      if (!token.access_token || (token.token_type ?? '').toLowerCase() !== 'bearer') return fail('exchange_failed');
      const userRes = await fetch('https://discord.com/api/v10/users/@me', { headers: { Authorization: `Bearer ${token.access_token}` }, signal: AbortSignal.timeout(10_000) });
      if (!userRes.ok) return fail('identity_failed');
      const user = await userRes.json() as { id?: string; username?: string; global_name?: string | null; avatar?: string | null };
      if (!user.id || !user.username) return fail('identity_failed');
      const presented = sessionRefFrom(req, config, 'participant');
      if (presented !== null) await deleteSession(db, presented.sessionId);
      await purgeExpiredSessions(db);
      const session = await createSession(db, {
        userId: user.id, username: user.global_name || user.username, avatar: user.avatar ?? null,
        guilds: [], audience: 'participant',
      });
      reply.header('set-cookie', [
        sessionCookie(makeDiscordToken(config.adminSessionSecret, session.id, Date.now(), 'participant'), secureCookies, PARTICIPANT_COOKIE),
        clearCookie(PARTICIPANT_STATE_COOKIE, secureCookies), clearCookie(PARTICIPANT_PKCE_COOKIE, secureCookies),
      ]);
      return reply.redirect(returnPath);
    } catch {
      return fail('error');
    }
  });

  app.get('/api/public/events/:eventId', async (req, reply) => {
    const eventId = (req.params as { eventId: string }).eventId;
    const published = await publishedEvent(eventId);
    if (published === null) return reply.code(404).send({ error: 'not_found' });
    const { event, form } = published;
    return {
      event: { id: event.id, name: event.name, description: event.description, startsAt: event.startsAt, endsAt: event.endsAt },
      form: { version: form.version, title: form.title, description: form.description,
        appearance: resolveAppearance(form),
        profileFields: { experiences: form.experiences, roleTracks: form.roleTracks, skills: form.skills, teamPrefs: form.teamPrefs },
        questions: (form.customQuestions ?? []).filter((q) => q.visibility === 'self_and_organizer' && (q.presentation === 'web' || q.presentation === 'both')) },
    };
  });

  app.get('/events/:eventId', async (req, reply) => {
    const published = await publishedEvent((req.params as { eventId: string }).eventId);
    if (published === null) return reply.code(404).type('text/html; charset=utf-8').send('<!doctype html><title>Event not found</title>');
    const { event, form } = published;
    const escape = (value: string): string => value.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
    const name = escape(event.name);
    const description = escape(event.description);
    const appearance = resolveAppearance(form);
    const image = appearance.bannerUrl ? `<meta property="og:image" content="${escape(appearance.bannerUrl)}">` : '';
    const metadata = `<title>${name}</title><link rel="icon" type="image/svg+xml" href="/favicon.svg"><meta name="description" content="${description}"><meta property="og:title" content="${name}"><meta property="og:description" content="${description}">${image}`;
    const date = (value: number | null): string => value === null ? '' : escape(new Intl.DateTimeFormat('en', { dateStyle: 'long', timeStyle: 'short', timeZone: 'UTC' }).format(value));
    const dates = event.startsAt === null && event.endsAt === null ? '' : `<dl class="event-details">${event.startsAt === null ? '' : `<div><dt>Starts</dt><dd><time datetime="${new Date(event.startsAt).toISOString()}">${date(event.startsAt)} UTC</time></dd></div>`}${event.endsAt === null ? '' : `<div><dt>Ends</dt><dd><time datetime="${new Date(event.endsAt).toISOString()}">${date(event.endsAt)} UTC</time></dd></div>`}</dl>`;
    const fallback = `<main><h1>${name}</h1><p>${description}</p>${dates}<a href="/events/${encodeURIComponent(event.id)}/signup">Sign up</a></main>`;
    const here = dirname(fileURLToPath(import.meta.url));
    const candidates = [process.env.ADMIN_UI_DIST, join(here, '..', '..', '..', 'admin-ui', 'dist'), join(here, '..', '..', 'admin-ui', 'dist')].filter((path): path is string => !!path);
    for (const path of candidates) {
      try {
        const shell = await readFile(join(path, 'index.html'), 'utf8');
        return reply.type('text/html; charset=utf-8').send(shell.replace('<title>Hackathon Admin</title>', metadata).replace('<div id="root"></div>', `<div id="root">${fallback}</div>`));
      } catch { /* API-only mode still serves accessible details. */ }
    }
    return reply.type('text/html; charset=utf-8').send(`<!doctype html><html lang="en"><head>${metadata}</head><body>${fallback}</body></html>`);
  });

  const participantEvent = async (eventId: string, userId: string) => {
    const event = await getEvent(db, eventId);
    if (event === null || event.status !== 'active' || deps.client === null) return null;
    try {
      if (!(await lookupGuildMember(deps.client, event.guildId, userId))) return null;
    } catch { return null; }
    return event;
  };

  setMembershipLookup(db, async (guildId, userId) => {
    if (deps.client === null) return false;
    return lookupGuildMember(deps.client, guildId, userId);
  });
  registerParticipantTeamRoutes(app, deps, participantSessionFrom, participantEvent);

  registerLiveRoute(app, db, '/api/live', async (req) => {
    const live = await sessionFrom(req);
    const guildId = live?.session.selectedGuildId;
    if (!live || !guildId || !(await freshGuildAccess(live.session.userId, guildId)).allowed) return null;
    return withGuildContext(db, guildId, async () => {
      const eventId = await resolveEventId(req, guildId);
      const event = await getEvent(db, eventId);
      if (eventId !== guildId && event?.guildId !== guildId) return null;
      return { sessionId: live.session.id, scope: `${guildId}/${eventId}`, accepts: async (hint: ChangeHint) =>
        hint.guildId === guildId && (hint.eventId === null || hint.eventId === eventId) };
    });
  }, 10_000, config.publicUrl);

  const ownHint = async (hint: ChangeHint, userId: string): Promise<boolean> => {
    if (!hint.guildId || !hint.eventId) return false;
    return withGuildContext(db, hint.guildId, async () => {
      const event = await getEvent(db, hint.eventId!);
      if (!event || event.status === 'draft') return false;
      if (hint.userId === userId || hint.targetId === userId || hint.requesterId === userId) return true;
      if (hint.table === 'team_requests' || hint.table === 'registration_answers') return false;
      const own = await getParticipant(db, hint.eventId!, userId);
      if (!own || own.status !== 'active') return false;
      if (hint.table === 'events') return true;
      if (hint.teamId && (hint.publicTeam || (await getTeam(db, hint.teamId))?.kind === 'public')) {
        return await eligibleParticipant(db, hint.eventId!, userId) !== null;
      }
      return hint.teamId !== null && hint.teamId === own.teamId;
    });
  };
  registerLiveRoute(app, db, '/api/participant/events/:eventId/live', async (req) => {
    const session = await participantSessionFrom(req);
    if (!session) return null;
    const eventId = (req.params as { eventId: string }).eventId;
    const event = await participantEvent(eventId, session.userId);
    if (!event || !installedGuildIds().includes(event.guildId)) return null;
    return { sessionId: session.id, scope: `${event.guildId}/${eventId}`, accepts: async (hint) =>
      hint.guildId === event.guildId && hint.eventId === eventId && (hint.table === 'events' || await ownHint(hint, session.userId)) };
  }, 10_000, config.publicUrl);
  registerLiveRoute(app, db, '/api/participant/live', async (req) => {
    const session = await participantSessionFrom(req);
    if (!session) return null;
    const guilds: string[] = [];
    for (const guildId of installedGuildIds()) if (await currentMember(guildId, session.userId)) guilds.push(guildId);
    return { sessionId: session.id, scope: guilds.sort().join('/'), accepts: async (hint) =>
      hint.guildId !== null && guilds.includes(hint.guildId) && await ownHint(hint, session.userId) };
  }, 10_000, config.publicUrl);

  app.get('/api/participant/events/:eventId/registration', async (req, reply) => {
    const session = await participantSessionFrom(req);
    const event = await participantEvent((req.params as { eventId: string }).eventId, session!.userId);
    if (event === null) return reply.code(404).send({ error: 'event_unavailable' });
    const form = getEventForm(db, event, await getForm(db, event.guildId));
    const stored = await getRegistrationAnswers(db, event.id, session!.userId);
    const participant = await getParticipant(db, event.id, session!.userId);
    const checked = validateCustomAnswers(form, stored?.answers ?? {});
    const profileRequired = form.experiences.length + form.roleTracks.length + form.skills.length + form.teamPrefs.length > 0;
    const hasQuestions = (form.customQuestions ?? []).some((question) => question.visibility !== 'organizer_only' && (question.presentation === 'web' || question.presentation === 'both'));
    return { eventId: event.id, formVersion: form.version, answers: stored?.answers ?? {},
      // Confidential definitions are available only to the authenticated subject, never the public projection.
      questions: form.customQuestions ?? [],
      profile: participant === null ? null : { experience: participant.experience, roleTrack: participant.roleTrack, skills: participant.skills, teamPref: participant.teamPref },
      missingRequiredQuestionIds: checked.ok ? checked.missingRequiredQuestionIds : [],
      complete: participant !== null && (profileRequired || hasQuestions) && checked.ok && checked.missingRequiredQuestionIds.length === 0 && (!profileRequired || ((form.experiences.length === 0 || !!participant.experience) && (form.roleTracks.length === 0 || !!participant.roleTrack) && (form.skills.length === 0 || !!participant.skills.length) && (form.teamPrefs.length === 0 || !!participant.teamPref))),
      teamPref: participant?.teamPref ?? null, status: participant?.status ?? 'not_registered' };
  });

  app.put('/api/participant/events/:eventId/registration', async (req, reply) => {
    const session = await participantSessionFrom(req);
    const event = await participantEvent((req.params as { eventId: string }).eventId, session!.userId);
    if (event === null) return reply.code(404).send({ error: 'event_unavailable' });
    const body = req.body as { formVersion?: unknown; answers?: unknown; profile?: { experience?: unknown; roleTrack?: unknown; skills?: unknown; teamPref?: unknown }; teamPref?: unknown } | null;
    const form = getEventForm(db, event, await getForm(db, event.guildId));
    if (!Number.isInteger(body?.formVersion) || body?.formVersion !== form.version) return reply.code(409).send({ error: 'stale_form_version' });
    const checked = validateCustomAnswers(form, body?.answers);
    if (!checked.ok) return reply.code(400).send({ error: 'invalid_answers', details: checked.errors });
    const teamPref = body?.teamPref;
    if (teamPref !== undefined && teamPref !== null && (typeof teamPref !== 'string' || !['create_team', 'join_team', 'random_team'].includes(teamPref))) return reply.code(400).send({ error: 'invalid_team_pref' });
    const profile = body?.profile;
    const profileRequired = form.experiences.length + form.roleTracks.length + form.skills.length + form.teamPrefs.length > 0;
    const hasQuestions = (form.customQuestions ?? []).some((question) => question.visibility !== 'organizer_only' && (question.presentation === 'web' || question.presentation === 'both'));
    if (!profileRequired && !hasQuestions) return reply.code(400).send({ error: 'empty_signup_form' });
    if (profile !== undefined && (!profile || (form.experiences.length > 0 ? typeof profile.experience !== 'string' || !form.experiences.some((item) => item.id === profile.experience) : !!profile.experience) || (form.roleTracks.length > 0 ? typeof profile.roleTrack !== 'string' || !form.roleTracks.some((item) => item.id === profile.roleTrack) : !!profile.roleTrack) || !Array.isArray(profile.skills) || (form.skills.length > 0 && profile.skills.length === 0) || profile.skills.some((id) => typeof id !== 'string' || !form.skills.some((item) => item.id === id)) || new Set(profile.skills).size !== profile.skills.length || [...new Set(profile.skills.map((id) => form.skills.find((item) => item.id === id)?.group).filter(Boolean))].length !== profile.skills.map((id) => form.skills.find((item) => item.id === id)?.group).filter(Boolean).length || (form.teamPrefs.length > 0 ? typeof profile.teamPref !== 'string' || !form.teamPrefs.some((item) => item.id === profile.teamPref) : !!profile.teamPref))) return reply.code(400).send({ error: 'invalid_profile' });
    return db.transaction(async () => {
      const existing = await getParticipant(db, event.id, session!.userId);
      if (existing?.status === 'blocked') return reply.code(403).send({ error: 'registration_blocked' });
      const admission = signupAdmission(event, existing?.status ?? null, Date.now());
      if (admission !== 'allowed') return reply.code(409).send({ error: admission, code: admission });
      const effectiveProfile = profile ?? (existing && existing.experience && existing.roleTrack && existing.skills.length && existing.teamPref ? { experience: existing.experience, roleTrack: existing.roleTrack, skills: existing.skills, teamPref: existing.teamPref } : null);
      if (profileRequired && effectiveProfile === null) return reply.code(400).send({ error: 'invalid_profile' });
      const saved = await saveRegistrationAnswers(db, event.id, session!.userId, form.version, checked.answers);
      if (!saved.ok) return reply.code(409).send({ error: saved.code });
      if (existing === null) {
        await db.run(`INSERT INTO participants (event_id,user_id,guild_id,display_name,experience,role_track,skills,team_pref,teammates,status,created_at,updated_at)
          VALUES (?,?,?,?,?,?,?,?,?,'active',?,?) ON CONFLICT (event_id,user_id) DO UPDATE SET team_pref = EXCLUDED.team_pref, status = 'active', updated_at = EXCLUDED.updated_at WHERE participants.status = 'withdrawn'`,
          event.id, session!.userId, event.guildId, session!.username, '', '', '[]', typeof profile?.teamPref === 'string' ? profile.teamPref : typeof teamPref === 'string' ? teamPref : '', '[]', Date.now(), Date.now());
      }
      if (profile !== undefined) {
        await db.run('UPDATE participants SET experience = ?, role_track = ?, skills = ?, team_pref = ?, status = CASE WHEN status = \'withdrawn\' THEN \'active\' ELSE status END, updated_at = ? WHERE event_id = ? AND user_id = ?', profile.experience, profile.roleTrack, JSON.stringify(profile.skills), profile.teamPref, Date.now(), event.id, session!.userId);
      } else if (typeof teamPref === 'string') {
        await db.run('UPDATE participants SET team_pref = ?, status = CASE WHEN status = \'withdrawn\' THEN \'active\' ELSE status END, updated_at = ? WHERE event_id = ? AND user_id = ?', teamPref, Date.now(), event.id, session!.userId);
      } else if (existing?.status === 'withdrawn') {
        await db.run("UPDATE participants SET status = 'active', updated_at = ? WHERE event_id = ? AND user_id = ?", Date.now(), event.id, session!.userId);
      }
      return { eventId: event.id, formVersion: form.version, answers: saved.value.answers,
        missingRequiredQuestionIds: checked.missingRequiredQuestionIds, complete: checked.missingRequiredQuestionIds.length === 0 && (!profileRequired || ((form.experiences.length === 0 || !!(profile?.experience ?? existing?.experience)) && (form.roleTracks.length === 0 || !!(profile?.roleTrack ?? existing?.roleTrack)) && (form.skills.length === 0 || (Array.isArray(profile?.skills) ? profile.skills.length > 0 : !!existing?.skills.length)) && (form.teamPrefs.length === 0 || !!(profile?.teamPref ?? teamPref ?? existing?.teamPref)))),
        profile: effectiveProfile,
        teamPref: typeof profile?.teamPref === 'string' ? profile.teamPref : typeof teamPref === 'string' ? teamPref : existing?.teamPref ?? null, status: existing?.status === 'withdrawn' ? 'active' : existing?.status ?? 'active' };
    });
  });

  app.delete('/api/participant/events/:eventId/registration', async (req, reply) => {
    const session = await participantSessionFrom(req);
    const event = await participantEvent((req.params as { eventId: string }).eventId, session!.userId);
    if (event === null) return reply.code(404).send({ error: 'event_unavailable' });
    const result = await withdrawParticipant(db, `discord:${session!.userId}`, event.id, session!.userId);
    if (!result.ok) return reply.code(404).send({ error: result.code });
    if (!await completeDeparture(event.id, event.guildId, session!.userId, result.value)) return reply.code(503).send({ error: 'role_revocation_pending', committed: true });
    return { ok: true };
  });

  app.get('/api/events/:eventId/registrations', async (req) => {
    const eventId = (req.params as { eventId: string }).eventId;
    const answers = await listRegistrationAnswers(db, eventId);
    return { registrations: answers.map(({ userId, formVersion, answers: values }) => ({ userId, formVersion, answers: values })) };
  });

  app.get('/api/events/:eventId/registrations/:userId', async (req, reply) => {
    const { eventId, userId } = req.params as { eventId: string; userId: string };
    const event = await getEvent(db, eventId);
    if (!event || event.guildId !== await guildOf(req)) return reply.code(404).send({ error: 'not_found' });
    const registration = await getRegistrationAnswers(db, eventId, userId);
    if (!registration) return reply.code(404).send({ error: 'not_found' });
    const form = getEventForm(db, event, await getForm(db, event.guildId));
    await audit(db, await actorOf(req), 'registration.read', eventId, { userId }, event.guildId);
    return { userId, ...registration, questions: registration.formVersion === form.version ? form.customQuestions ?? [] : [], historicalDefinitionUnavailable: registration.formVersion !== form.version };
  });

  app.get('/api/participant/me', async (req) => {
    const session = await participantSessionFrom(req);
    return { user: { id: session!.userId, username: session!.username, avatar: session!.avatar } };
  });

  app.get('/api/participant/registrations', async (req) => {
    const session = await participantSessionFrom(req);
    const rows: { event_id: string; name: string; description: string; starts_at: number | null; ends_at: number | null; status: string; team_id: string | null }[] = [];
    for (const guildId of installedGuildIds()) {
      if (!await currentMember(guildId, session!.userId)) continue;
      rows.push(...await withGuildContext(db, guildId, () => db.all<typeof rows[number]>(
      `SELECT e.id AS event_id, e.name, e.description, e.starts_at, e.ends_at, e.status, p.team_id
       FROM participants p JOIN events e ON e.id = p.event_id
       WHERE p.user_id = ? AND e.guild_id = ? AND p.guild_id = e.guild_id AND p.status <> 'withdrawn' AND e.status <> 'draft'
       ORDER BY e.starts_at DESC NULLS LAST, e.id`,
      session!.userId, guildId,
      )));
    }
    rows.sort((a, b) => (b.starts_at ?? -Infinity) - (a.starts_at ?? -Infinity) || a.event_id.localeCompare(b.event_id));
    return { registrations: rows.map((row) => ({
      eventId: row.event_id, name: row.name, description: row.description,
      startsAt: row.starts_at, endsAt: row.ends_at, status: row.status, teamId: row.team_id,
    })) };
  });

  /** Who am I, what am I managing, what may I switch to. */
  app.get('/api/auth/me', async (req) => {
    const live = await sessionFrom(req);
    const guildName = (id: string | null): string | null => {
      if (id === null || deps.client === null) return null;
      const cached = deps.client.guilds.cache.get(id);
      return cached?.name ?? null;
    };
    if (live !== null) {
      const session = live.session;
      return {
        kind: 'discord' as const,
        user: { id: session.userId, username: session.username, avatar: session.avatar },
        guild: {
          id: session.selectedGuildId,
          name: guildName(session.selectedGuildId),
        },
        guilds: session.guilds.map((g) => ({ ...g, name: guildName(g.id) ?? g.name })),
      };
    }
    return { kind: 'anonymous' as const, user: null, guild: { id: null, name: null }, guilds: [] };
  });

  /** Switch the guild this session manages. Validated server-side. */
  app.post('/api/auth/guild', async (req, reply) => {
    const live = await sessionFrom(req);
    const body = req.body as { guildId?: string } | null;
    const target = body?.guildId ?? '';
    if (live === null) {
      await reply.code(401).send({ ok: false, code: 'unauthorized', message: 'Sign in with Discord first.' });
      return;
    }
    if (!(await selectGuild(db, live.session.id, target))) {
      await reply.code(403).send({ ok: false, code: 'not_allowed', message: 'You do not manage that server.' });
      return;
    }
    await audit(db, await actorOf(req), 'web.switch_guild', target, null, target);
    return { ok: true, guildId: target };
  });

  app.post('/api/auth/logout', async (req, reply) => {
    const live = await sessionFrom(req);
    if (live !== null) {
      // Deleting the row is what actually revokes: the cookie stops resolving.
      await deleteSession(db, live.session.id);
      await audit(db, 'discord', 'web.logout', live.session.userId, null, null);
    }
    reply.header('set-cookie', clearCookie(COOKIE, secureCookies));
    return { ok: true };
  });

  app.post('/api/participant/logout', async (req, reply) => {
    const session = await participantSessionFrom(req);
    if (session) await deleteSession(db, session.id);
    reply.header('set-cookie', clearCookie(PARTICIPANT_COOKIE, secureCookies));
    return { ok: true };
  });
  for (const path of ['/api/auth/logout-all', '/api/participant/logout-all']) { // g0:allow:secrets t_33947af2 - public logout endpoint names, no credentials
    app.post(path, async (req, reply) => {
      const session = path.includes('/participant/') ? await participantSessionFrom(req) : (await sessionFrom(req))?.session;
      if (!session) return reply.code(401).send({ error: 'unauthorized' });
      await db.transaction(async () => {
        await deleteUserSessions(db, session.userId);
        // Host auth audit uses its narrowly permitted action; actor identity is
        // the authenticated subject, never a payload-supplied user ID.
        await audit(db, 'discord', 'web.logout', session.userId, { scope: 'all_sessions', audience: session.audience }, null);
      });
      reply.header('set-cookie', [clearCookie(COOKIE, secureCookies), clearCookie(PARTICIPANT_COOKIE, secureCookies)]);
      return { ok: true };
    });
  }

  app.get('/api/guild/members', async (req, reply) => {
    const query = (req.query as { query?: unknown } | undefined)?.query;
    const term = typeof query === 'string' ? query.trim() : '';
    if (term.length < 2 || term.length > 100) return reply.code(400).send({ error: 'invalid_query' });
    if (deps.client === null) return reply.code(503).send({ error: 'member_search_unavailable' });
    try {
      const guild = await deps.client.guilds.fetch(await guildOf(req));
      const members = await guild.members.search({ query: term, limit: 10 });
      return { members: [...members.values()].map((member) => ({ id: member.id, username: member.user.username, displayName: member.displayName })) };
    } catch (error) {
      const status = typeof error === 'object' && error !== null && 'status' in error ? error.status : undefined;
      return reply.code(status === 429 ? 429 : 503).send({ error: status === 429 ? 'member_search_rate_limited' : 'member_search_unavailable' });
    }
  });

  app.get('/api/guild/channels', async (req) => {
    if (deps.client === null) return { channels: [], categories: [], roles: [] };
    if (!isSnowflake(await guildOf(req))) {
      console.warn(`GET /api/guild/channels: DISCORD_GUILD_ID not set or invalid ("${await guildOf(req)}") — returning empty. Set it in .env.`);
      return { channels: [], categories: [], roles: [] };
    }
    try {
      const guild = await deps.client.guilds.fetch(await guildOf(req));
      const channels = await guild.channels.fetch();
      const textChannels = channels
        .filter((c) => c !== null && c.type === 0) // GUILD_TEXT
        .map((c) => ({ id: c!.id, name: c!.name, position: c!.position }))
        .sort((a, b) => a.position - b.position);
      const categories = channels
        .filter((c) => c !== null && c.type === 4) // GUILD_CATEGORY
        .map((c) => ({ id: c!.id, name: c!.name }))
        .sort((a, b) => a.name.localeCompare(b.name));
      const roles = [...guild.roles.cache.values()]
        .filter(r => r.id !== guild.roles.everyone.id)
        .map(r => ({ id: r.id, name: r.name, color: r.hexColor, position: r.position }))
        .sort((a,b)=>b.position-a.position);
      return { channels: textChannels, categories, roles };
    } catch {
      return { channels: [], categories: [], roles: [] };
    }
  });

  app.get('/api/guild/roles', async (req) => {
    if (deps.client === null) return { roles: [] };
    if (!isSnowflake(await guildOf(req))) return { roles: [] };
    try {
      const guild = await deps.client.guilds.fetch(await guildOf(req));
      const roles = [...guild.roles.cache.values()]
        .filter(r => r.id !== guild.roles.everyone.id)
        .map(r => ({ id: r.id, name: r.name, color: r.hexColor }))
        .sort((a,b)=>a.name.localeCompare(b.name));
      return { roles };
    } catch { return { roles: [] } }
  });

  app.post('/api/diag/channel-test', async (req, reply) => {
    const body = req.body as { channelId?: string } | null
    const channelId = body?.channelId?.trim() ?? ''
    if (!isSnowflake(await guildOf(req))) {
      await reply.code(400).send({ ok: false, code: 'guild_not_configured', message: `DISCORD_GUILD_ID="${await guildOf(req)}" is not a snowflake — set it in .env and restart.` })
      return
    }
    if (!isSnowflake(channelId)) {
      await reply.code(400).send({ ok: false, code: 'bad_channel', message: `channelId "${channelId}" is not a snowflake — copy the ID (right-click channel → Copy ID), not the name.` })
      return
    }
    if (deps.client === null) {
      await reply.code(503).send({ ok: false, code: 'no_discord', message: 'Bot not connected to Discord (SKIP_DISCORD=1 or offline).' })
      return
    }
    try {
      const guild = await deps.client.guilds.fetch(await guildOf(req))
      const channel = await guild.channels.fetch(channelId)
      if (channel === null) {
        await reply.code(404).send({ ok: false, code: 'not_found', message: `Channel ${channelId} not found in guild ${await guildOf(req)}. Is the ID correct?` })
        return
      }
      if (!channel.isTextBased()) {
        await reply.code(400).send({ ok: false, code: 'not_text', message: `Channel #${(channel as { name: string }).name} is not a text channel.` })
        return
      }
      const me = guild.members.me
      if (me !== null) {
        const perms = channel.permissionsFor(me)
        if (perms !== null && !perms.has('SendMessages')) {
          await reply.code(403).send({ ok: false, code: 'forbidden', message: `Bot lacks SendMessages in #${(channel as { name: string }).name}. Give it permission and try again.` })
          return
        }
        if (perms !== null && !perms.has('ViewChannel')) {
          await reply.code(403).send({ ok: false, code: 'forbidden', message: `Bot cannot see #${(channel as { name: string }).name}.` })
          return
        }
      }
      await channel.send({ content: `✅ chashack test — if you see this, <#${channelId}> is reachable ✅` })
      return { ok: true, channelId, name: (channel as { name: string }).name }
    } catch (e) {
      await reply.code(500).send({ ok: false, code: 'discord_error', message: 'Discord request failed.' })
    }
  });

  app.get('/api/state', async (req, reply) => {
    const eventId = await resolveEventId(req, await guildOf(req));
    const participants = await listParticipants(db, eventId);
    const teams = await listTeams(db, eventId);
    const events = await listEvents(db, await guildOf(req));
    const selected = events.find((e) => e.id === eventId) ?? null;
    // surface guild mis-config so UI can warn
    const guildOk = isSnowflake(await guildOf(req));
    if (!guildOk) {
      reply.header('x-guild-warning', 'DISCORD_GUILD_ID not set');
    }
    return {
      participants,
      teams,
      config: await getForm(db, await guildOf(req)),
      audit: await auditList(db, 100, await guildOf(req)),
      lastMatch: await lastMatchInfo(db, eventId),
      guildSettings: await getGuildSettings(db, await guildOf(req)),
      guildConfigured: guildOk,
      guildId: await guildOf(req),
      events,
      templates: await listTemplates(db, await guildOf(req)),
      // The event these participants/teams belong to (explicit pick, else default).
      activeEventId: selected?.id ?? null,
      selectedEventId: selected?.id ?? null,
      // Every live event, so the UI can offer a switcher when >1 is running.
      activeEventIds: events.filter((e) => e.status === 'active').map((e) => e.id),
      stats: {
        signups: participants.filter((p) => p.status !== 'withdrawn').length,
        active: participants.filter((p) => p.status === 'active').length,
        blocked: participants.filter((p) => p.status === 'blocked').length,
        unteamed: participants.filter((p) => p.status === 'active' && p.teamId === null).length,
        matchingOptIn: participants.filter((p) => p.status === 'active' && p.teamId === null && p.teamPref === 'random_team').length,
        teams: teams.length,
      },
    };
  });

  // ── events ────────────────────────────────────────────────────────────────

  app.post('/api/events', async (req, reply) => {
    if (!isSnowflake(await guildOf(req))) {
      await reply.code(400).send({ ok: false, code: 'guild_not_configured', message: 'DISCORD_GUILD_ID is not set or not a snowflake. Set it in .env and restart the bot.' });
      return;
    }
    const body = req.body as {
      name?: string;
      description?: string;
      startsAt?: number | null;
      endsAt?: number | null;
      signupStartsAt?: number | null;
      signupEndsAt?: number | null;
      cleanupDelayHours?: number;
      panelChannelId?: string | null;
      announcementChannelId?: string | null;
      scheduleChannelId?: string | null;
      templateId?: string;
      formTemplateId?: string;
      schedule?: { id: string; time: number; title: string; description?: string; kind?: string; actions?: { id: string; type: string; title?: string; message?: string; channelId?: string | null; mode?: string; assignmentId?: string }[] }[];
      announcements?: { id: string; title: string; message: string; trigger: string; channelId?: string | null }[];
      assignments?: { id: string; title: string; instructions: string; description?: string }[];
      assignmentStrategy?: 'random' | 'same';
      saveAsTemplate?: boolean;
      saveTemplateName?: string;
      /** Create & launch: activate the event immediately after creating it. */
      launch?: boolean;
    } | null;
    if (body?.name === undefined || body.name.trim().length < 3) {
      await reply.code(400).send({ ok: false, code: 'bad_name', message: 'Event name must be at least 3 characters.' });
      return;
    }
    let form: Parameters<typeof createEvent>[3]['form'];
    // Parse the event template once — it seeds form, schedule, assignments and strategy.
    let tplInput: Partial<Parameters<typeof createEvent>[3]> | undefined;
    if (body.templateId !== undefined) {
      const tpl = (await listTemplates(db, await guildOf(req), 'event')).find((t) => t.id === body.templateId);
      if (tpl === undefined) {
        await reply.code(400).send({ ok: false, code: 'not_found', message: 'Template not found.' });
        return;
      }
      const { templateToEventInput } = await import('../features/events/data.js');
      tplInput = templateToEventInput(tpl.json);
      form = tplInput.form;
    }
    if (body.formTemplateId !== undefined) {
      const tpl = (await listTemplates(db, await guildOf(req), 'form')).find((t) => t.id === body.formTemplateId);
      if (tpl === undefined) {
        await reply.code(400).send({ ok: false, code: 'not_found', message: 'Form template not found.' });
        return;
      }
      try {
        form = JSON.parse(tpl.json) as Parameters<typeof createEvent>[3]['form'];
      } catch {
        await reply.code(400).send({ ok: false, code: 'bad_template', message: 'Form template JSON is invalid.' });
        return;
      }
    }
    // Default form fallback: guild default form template → else global form_config fallback is handled inside createEvent
    if (form === undefined && body.formTemplateId === undefined) {
      const gs2 = await getGuildSettings(db, await guildOf(req))
      if (gs2.defaultFormTemplateId) {
        const tpl = (await listTemplates(db, await guildOf(req), 'form')).find(t => t.id === gs2.defaultFormTemplateId)
        if (tpl) {
          try { form = JSON.parse(tpl.json) as Parameters<typeof createEvent>[3]['form'] } catch { /* ignore */ }
        }
      }
    }
    // Fall back to guild defaults when not explicitly provided
    const gs = await getGuildSettings(db, await guildOf(req))
    // Template seeds the schedule + assignment pool when the caller didn't supply them.
    const schedule = body.schedule ?? tplInput?.schedule
    const assignments = body.assignments ?? tplInput?.assignments
    const strategy = body.assignmentStrategy ?? tplInput?.assignmentStrategy
    const res = await createEvent(db, await actorOf(req), await guildOf(req), {
      name: body.name,
      ...(body.description !== undefined ? { description: body.description } : {}),
      ...(body.startsAt != null ? { startsAt: body.startsAt } : {}),
      ...(body.endsAt != null ? { endsAt: body.endsAt } : {}),
      ...(body.signupStartsAt !== undefined ? { signupStartsAt: body.signupStartsAt } : {}),
      ...(body.signupEndsAt !== undefined ? { signupEndsAt: body.signupEndsAt } : {}),
      ...(body.panelChannelId !== undefined ? { panelChannelId: body.panelChannelId } : gs.defaultPanelChannelId ? { panelChannelId: gs.defaultPanelChannelId } : {}),
      ...(body.announcementChannelId !== undefined ? { announcementChannelId: body.announcementChannelId } : gs.defaultAnnouncementChannelId ? { announcementChannelId: gs.defaultAnnouncementChannelId } : {}),
      ...(body.scheduleChannelId !== undefined ? { scheduleChannelId: body.scheduleChannelId } : (gs as unknown as { defaultScheduleChannelId: string | null }).defaultScheduleChannelId ? { scheduleChannelId: (gs as unknown as { defaultScheduleChannelId: string | null }).defaultScheduleChannelId } : {}),
      ...(gs.defaultCategoryId && body.panelChannelId === undefined ? { categoryId: gs.defaultCategoryId } : {}),
      ...(body.cleanupDelayHours !== undefined ? { cleanupDelayHours: body.cleanupDelayHours } : tplInput?.cleanupDelayHours !== undefined ? { cleanupDelayHours: tplInput.cleanupDelayHours } : gs.defaultCleanupDelayHours != null ? { cleanupDelayHours: gs.defaultCleanupDelayHours } : {}),
      ...(form !== undefined ? { form } : {}),
      ...(schedule !== undefined ? { schedule: schedule as never } : {}),
      ...(body.announcements !== undefined ? { announcements: body.announcements as never } : {}),
      ...(assignments !== undefined ? { assignments: assignments as never } : {}),
      ...(strategy !== undefined ? { assignmentStrategy: strategy } : {}),
    });
    if (!res.ok) {
      await reply.code(400).send(res);
      return;
    }
    // Create & launch: activate immediately when the caller asked for it.
    if (body.launch === true) {
      await activateEvent(db, await actorOf(req), res.value.id);
    }
    // Optional: save as event template via checkbox in create dialog
    if (body.saveAsTemplate) {
      const tplName = (body.saveTemplateName ?? body.name).trim().slice(0, 80)
      if (tplName.length >= 2) {
        const { getEventForm } = await import('../features/events/data.js')
        const { DEFAULT_FORM } = await import('../features/form/domain.js')
        const savedEvent = await getEvent(db, res.value.id) ?? res.value
        // Read the strategy back off the Start block so the template round-trips it.
        const startBlock = savedEvent.schedule.find((s) => s.id === '__start__')
        const savedStrategy = startBlock?.actions?.find((a) => a.type === 'distribute_assignments')?.mode
        const { toRelativeSchedule } = await import('../features/events/data.js')
        const payload = {
          name: savedEvent.name,
          description: savedEvent.description,
          cleanupDelayHours: savedEvent.cleanupDelayHours,
          form: getEventForm(db, savedEvent, DEFAULT_FORM),
          // Store the itinerary relative to its anchors so the template adapts to
          // whatever dates the next event gets instead of freezing these epochs.
          schedule: toRelativeSchedule(savedEvent.schedule, savedEvent.startsAt),
          assignments: savedEvent.assignments,
          assignmentStrategy: savedStrategy === 'same' ? 'same' : 'random',
        }
        await saveTemplate(db, await actorOf(req), await guildOf(req), tplName, 'event', JSON.stringify(payload))
      }
    }
    return { ok: true, event: await getEvent(db, res.value.id) ?? res.value };
  });

  app.post('/api/events/:eventId/activate', async (req, reply) => {
    const res = await activateEvent(db, await actorOf(req), (req.params as { eventId: string }).eventId);
    if (!res.ok) {
      await reply.code(400).send(res);
      return;
    }
    const event = res.value
    // Schedule now owns all Discord posts (including the signup panel). Activate just flips status to active.
    // Add the signup panel as a schedule action (type post_signup) at the event's start time if you want it on a timer,
    // or trigger announcements manually. The itinerary is posted/updated when the schedule is edited on a live event.
    const panelResult: { ok: boolean; channelId?: string; edited?: boolean; reason?: string } = { ok: true, reason: 'schedule-driven — add a “Post signup” action to your Start block or any schedule item' }
    const announceResult: { posted: boolean; reason: string; channelId: string | null } | null = { posted: false, reason: 'schedule-driven — use Start/ schedule actions or manual Announce', channelId: null }
    const itineraryResult: { ok: boolean; channelId?: string; messageId?: string; edited?: boolean; reason?: string } | null = null

    return { ok: true, event, panel: panelResult, announce: announceResult, itinerary: itineraryResult };
  });

  app.patch('/api/events/:eventId', async (req, reply) => {
    const { eventId } = req.params as { eventId: string };
    const body = req.body as {
      name?: string;
      description?: string;
      startsAt?: number | null;
      endsAt?: number | null;
      signupStartsAt?: number | null;
      signupEndsAt?: number | null;
      panelChannelId?: string | null;
      announcementChannelId?: string | null;
      scheduleChannelId?: string | null;
      cleanupDelayHours?: number;
      matchAt?: number | null;
      schedule?: { id: string; time: number; title: string; description?: string; kind?: string; actions?: { id: string; type: string; title?: string; message?: string; channelId?: string | null; mode?: string; assignmentId?: string }[] }[];
      announcements?: { id: string; title: string; message: string; trigger: string; channelId?: string | null }[];
      assignments?: { id: string; title: string; instructions: string; description?: string }[];
    } | null;
    const res = await updateEvent(db, await actorOf(req), eventId, {
      ...(body?.name !== undefined ? { name: body.name } : {}),
      ...(body?.description !== undefined ? { description: body.description } : {}),
      ...(body?.startsAt !== undefined ? { startsAt: body.startsAt } : {}),
      ...(body?.endsAt !== undefined ? { endsAt: body.endsAt } : {}),
      ...(body?.signupStartsAt !== undefined ? { signupStartsAt: body.signupStartsAt } : {}),
      ...(body?.signupEndsAt !== undefined ? { signupEndsAt: body.signupEndsAt } : {}),
      ...(body?.panelChannelId !== undefined ? { panelChannelId: body.panelChannelId } : {}),
      ...(body?.announcementChannelId !== undefined ? { announcementChannelId: body.announcementChannelId } : {}),
      ...(body?.scheduleChannelId !== undefined ? { scheduleChannelId: body.scheduleChannelId } : {}),
      ...(body?.cleanupDelayHours !== undefined ? { cleanupDelayHours: body.cleanupDelayHours } : {}),
      ...(body?.matchAt !== undefined ? { matchAt: body.matchAt } : {}),
      ...(body?.schedule !== undefined ? { schedule: body.schedule as never } : {}),
      ...(body?.announcements !== undefined ? { announcements: body.announcements as never } : {}),
      ...(body?.assignments !== undefined ? { assignments: body.assignments as never } : {}),
    });
    if (!res.ok) {
      await reply.code(400).send(res);
      return;
    }
    // Auto-refresh schedule itinerary if schedule or schedule channel changed and event is active
    if ((body?.schedule !== undefined || body?.scheduleChannelId !== undefined) && res.value.status === 'active' && deps.client) {
      const { postOrUpdateScheduleItinerary } = await import('../discord/schedule-itinerary.js')
      await postOrUpdateScheduleItinerary(db, deps.client, res.value).catch(()=>undefined)
    }
    return { ok: true, event: res.value };
  });

  app.post('/api/events/:eventId/schedule-itinerary', async (req, reply) => {
    const event = await getEvent(db, (req.params as { eventId: string }).eventId)
    if (!event) { await reply.code(404).send({ ok: false, code: 'not_found', message: 'Event not found.' }); return }
    if (!deps.client) { await reply.code(503).send({ ok: false, code: 'no_discord', message: 'Bot not connected.' }); return }
    const body = req.body as { channelId?: string } | null
    const { postOrUpdateScheduleItinerary } = await import('../discord/schedule-itinerary.js')
    const res = await postOrUpdateScheduleItinerary(db, deps.client, event, body?.channelId ?? null)
    if ('error' in res) { await reply.code(400).send({ ok: false, code: 'schedule_error', message: res.error }); return }
    return { ok: true, ...res }
  });

  app.post('/api/events/:eventId/end', async (req, reply) => {
    const res = await endEvent(db, await actorOf(req), (req.params as { eventId: string }).eventId);
    if (!res.ok) {
      await reply.code(400).send(res);
      return;
    }
    return { ok: true, event: res.value };
  });

  app.post('/api/events/announce', async (req, reply) => {
    if (!isSnowflake(await guildOf(req))) {
      await reply.code(400).send({ ok: false, code: 'guild_not_configured', message: 'DISCORD_GUILD_ID is not set or not a snowflake. Configure it in .env or Config → Guild defaults.' });
      return;
    }
    const body = req.body as { eventId?: string; title?: string; message?: string; dm?: boolean; channelId?: string } | null
    const event = body?.eventId !== undefined ? await getEvent(db, body.eventId) : await getActiveEvent(db, await guildOf(req))
    if (event === null) {
      await reply.code(400).send({ ok: false, code: 'not_found', message: 'Event not found.' })
      return
    }
    if (deps.client === null) {
      await reply.code(503).send({ ok: false, code: 'no_discord', message: 'Bot is not connected to Discord (SKIP_DISCORD=1 or gateway offline).' })
      return
    }
    if (body?.title === undefined || body.message === undefined) {
      await reply.code(400).send({ ok: false, code: 'bad_input', message: 'title and message are required.' })
      return
    }
    const result = await sendAnnouncement({ db, client: deps.client }, await actorOf(req), event, body.title, body.message, body.dm ?? false, body.channelId)
    // Surface detailed reason to the UI so it can show "why not posted" instead of generic unreachable
    return { ok: true, ...result }
  })

  app.post('/api/events/:eventId/panel', async (req, reply) => {
    const event = await getEvent(db, (req.params as { eventId: string }).eventId);
    if (event === null) {
      await reply.code(404).send({ ok: false, code: 'not_found', message: 'Event not found.' });
      return;
    }
    const body = req.body as { channelId?: string } | null;
    const channelId = body?.channelId ?? '';
    if (channelId === '') {
      await reply.code(400).send({ ok: false, code: 'bad_input', message: 'channelId is required.' });
      return;
    }
    if (deps.client === null) {
      await reply.code(503).send({ ok: false, code: 'no_discord', message: 'Bot is not connected to Discord.' });
      return;
    }
    const res = await postOrUpdatePanel(db, deps.client, await guildOf(req), channelId).catch((e: unknown) => ({
      error: e instanceof Error ? e.message : 'Unknown error',
    }));
    if ('error' in res) {
      await reply.code(400).send({ ok: false, code: 'panel_error', message: res.error });
      return;
    }
    // Persist the channel on the event.
    await updateEvent(db, await actorOf(req), event.id, { panelChannelId: channelId });
    return { ok: true, channelId: res.channelId, edited: res.edited };
  });

  app.post('/api/events/:eventId/discord-events', async (req, reply) => {
    const event = await getEvent(db, (req.params as { eventId: string }).eventId);
    if (event === null) {
      await reply.code(404).send({ ok: false, code: 'not_found', message: 'Event not found.' });
      return;
    }
    if (deps.client === null) {
      await reply.code(503).send({ ok: false, code: 'no_discord', message: 'Bot is not connected to Discord.' });
      return;
    }
    const body = req.body as { days?: number; durationHours?: number } | null;
    const result = await createDiscordEvents({ db, client: deps.client }, await actorOf(req), event, body?.days ?? 1, body?.durationHours ?? 24);
    if (result.created.length === 0) {
      await reply.code(400).send({ ok: false, code: 'failed', message: result.errors.join('; ') || 'Nothing created.' });
      return;
    }
    return { ok: true, created: result.created, errors: result.errors };
  });

  // ── templates ─────────────────────────────────────────────────────────────

  app.get('/api/templates', async (req) => {
    const kind = (req.query as { kind?: string } | undefined)?.kind
    const templates = await listTemplates(db, await guildOf(req), kind as never)
    return { templates }
  })

  app.post('/api/templates', async (req, reply) => {
    const body = req.body as { eventId?: string; name?: string; kind?: string; formJson?: string; json?: string } | null
    const kind = body?.kind ?? 'event'
    if (kind !== 'event' && kind !== 'form' && kind !== 'announcement' && kind !== 'assignments' && kind !== 'theme') {
      await reply.code(400).send({ ok: false, code: 'bad_kind', message: 'kind must be event|form|announcement|assignments|theme' })
      return
    }
    let json: string
    if (kind === 'form') {
      if (body?.formJson === undefined && body?.json === undefined) {
        await reply.code(400).send({ ok: false, code: 'bad_input', message: 'formJson is required for form templates.' })
        return
      }
      json = (body.formJson ?? body.json)!
      // validate form shape
      try {
        const parsed = JSON.parse(json) as Record<string, unknown>
        if (parsed.appearance !== undefined && !normalizeAppearance(parsed.appearance)) throw new Error('Invalid appearance.');
        const { normalizeFormUpdate } = await import('../features/form/domain.js')
        const { DEFAULT_FORM } = await import('../features/form/domain.js')
        const normalized = normalizeFormUpdate(DEFAULT_FORM as never, parsed as never)
        json = JSON.stringify(normalized)
      } catch (e) {
        await reply.code(400).send({ ok: false, code: 'bad_json', message: e instanceof Error ? e.message : 'Invalid form JSON' })
        return
      }
    } else if (kind === 'theme') {
      let parsed: unknown = null;
      try { parsed = JSON.parse(body?.json ?? body?.formJson ?? 'null') } catch { /* rejected below */ }
      const appearance = normalizeAppearance(parsed);
      if (!appearance) { await reply.code(400).send({ ok: false, code: 'bad_appearance', message: 'Theme appearance is invalid.' }); return }
      json = JSON.stringify(appearance)
    } else if (kind === 'announcement') {
      if (body?.json === undefined && body?.formJson === undefined) {
        await reply.code(400).send({ ok: false, code: 'bad_input', message: 'json is required for announcement templates.' })
        return
      }
      json = (body.json ?? body.formJson)!
      try { const p = JSON.parse(json) as Record<string, unknown>; if (typeof p.title !== 'string' || typeof p.message !== 'string') throw new Error('title and message required'); if (typeof p.trigger !== 'string') (p as Record<string,unknown>).trigger='manual'; json = JSON.stringify(p) } catch (e) { await reply.code(400).send({ ok: false, code: 'bad_json', message: e instanceof Error ? e.message : 'Invalid announcement JSON' }); return }
    } else {
      // event template: allow direct json (from editor) or clone an existing event
      if (body?.json !== undefined) {
        try { JSON.parse(body.json); json = body.json } catch { await reply.code(400).send({ ok: false, code: 'bad_json', message: 'Event template json is not valid JSON.' }); return }
      } else {
        const event = body?.eventId !== undefined ? await getEvent(db, body.eventId) : await getActiveEvent(db, await guildOf(req))
        if (event === null) {
          await reply.code(400).send({ ok: false, code: 'not_found', message: 'Event not found. Provide json or eventId.' })
          return
        }
        const { getEventForm } = await import('../features/events/data.js')
        const { DEFAULT_FORM } = await import('../features/form/domain.js')
        const payload = {
          name: event.name,
          description: event.description,
          cleanupDelayHours: event.cleanupDelayHours,
          form: getEventForm(db, event, DEFAULT_FORM),
          schedule: event.schedule,
        }
        json = JSON.stringify(payload)
      }
    }
    const res = await saveTemplate(db, await actorOf(req), await guildOf(req), body?.name ?? '', kind, json)
    if (!res.ok) {
      await reply.code(400).send(res)
      return
    }
    return { ok: true, template: res.value }
  })

  app.patch('/api/templates/:templateId', async (req, reply) => {
    const { templateId } = req.params as { templateId: string }
    const body = req.body as { name?: string; json?: string; formJson?: string } | null
    const existing = (await listTemplates(db, await guildOf(req))).find(t => t.id === templateId)
    if (!existing) { await reply.code(404).send({ ok: false, code: 'not_found', message: 'Template not found.' }); return }
    const name = body?.name !== undefined ? body.name.trim().slice(0, 80) : existing.name
    if (name.length < 2) { await reply.code(400).send({ ok: false, code: 'bad_name', message: 'Name must be at least 2 characters.' }); return }
    let json = body?.json ?? body?.formJson ?? existing.json
    // validate
    try {
      const parsed = JSON.parse(json)
      if (existing.kind === 'form') {
        if (parsed.appearance !== undefined && !normalizeAppearance(parsed.appearance)) throw new Error('Invalid appearance.');
        const { normalizeFormUpdate } = await import('../features/form/domain.js')
        const { DEFAULT_FORM } = await import('../features/form/domain.js')
        json = JSON.stringify(normalizeFormUpdate(DEFAULT_FORM as never, parsed as never))
      } else if (existing.kind === 'theme') {
        const appearance = normalizeAppearance(parsed);
        if (!appearance) throw new Error('Theme appearance is invalid.');
        json = JSON.stringify(appearance);
      } else {
        JSON.stringify(parsed) // just check valid
      }
    } catch (e) { await reply.code(400).send({ ok: false, code: 'bad_json', message: e instanceof Error ? e.message : 'Invalid JSON' }); return }
    await updateTemplateContent(db, templateId, name, json)
    const updated = (await listTemplates(db, await guildOf(req))).find(t => t.id === templateId)!
    return { ok: true, template: updated }
  })

  app.delete('/api/templates/:templateId', async (req, reply) => {
    const res = await deleteTemplate(db, await actorOf(req), (req.params as { templateId: string }).templateId);
    if (!res.ok) {
      await reply.code(400).send(res);
      return;
    }
    return { ok: true };
  });

  // ── event form binding (put a template form onto an event) ────────────────
  app.post('/api/events/:eventId/form', async (req, reply) => {
    const { eventId } = req.params as { eventId: string }
    const body = req.body as { formTemplateId?: string; formJson?: string } | null
    const event = await getEvent(db, eventId)
    if (event === null) {
      await reply.code(404).send({ ok: false, code: 'not_found', message: 'Event not found.' })
      return
    }
    let form: Partial<FormConfig>
    if (body?.formTemplateId) {
      const tpl = (await listTemplates(db, await guildOf(req), 'form')).find((t) => t.id === body.formTemplateId)
      if (!tpl) {
        await reply.code(404).send({ ok: false, code: 'not_found', message: 'Form template not found.' })
        return
      }
      try {
        form = JSON.parse(tpl.json) as Partial<FormConfig>
      } catch {
        await reply.code(400).send({ ok: false, code: 'bad_template', message: 'Form template JSON invalid.' })
        return
      }
    } else if (body?.formJson) {
      try {
        form = JSON.parse(body.formJson) as Partial<FormConfig>
      } catch {
        await reply.code(400).send({ ok: false, code: 'bad_json', message: 'formJson is not valid JSON.' })
        return
      }
    } else {
      await reply.code(400).send({ ok: false, code: 'bad_input', message: 'Provide formTemplateId or formJson.' })
      return
    }
    if (form.customQuestions !== undefined) {
      const questions = validateCustomQuestions(form.customQuestions, form as FormConfig);
      if (!questions.ok) return reply.code(400).send({ ok: false, code: 'invalid_questions', errors: questions.errors });
    }
    if ((form.appearance !== undefined && !normalizeAppearance(form.appearance)) || !validBannerUrl(form.bannerUrl) || (form.themePreset !== undefined && !['default', 'halloween', 'christmas'].includes(form.themePreset)) ||
        (form.accentColor !== undefined && !/^#[0-9a-fA-F]{6}$/.test(form.accentColor))) {
      return reply.code(400).send({ ok: false, code: 'invalid_theme' });
    }
    const { updateEventForm } = await import('../features/events/data.js')
    const res = await updateEventForm(db, await actorOf(req), eventId, form)
    if (!res.ok) {
      await reply.code(res.code === 'form_version_conflict' ? 409 : 400).send(res)
      return
    }
    return { ok: true, form: res.value }
  });

  // ── guild defaults ────────────────────────────────────────────────────────
  app.post('/api/guild/settings', async (req, reply) => {
    const body = req.body as {
      teamCategoryId?: string | null
      defaultAnnouncementChannelId?: string | null
      defaultPanelChannelId?: string | null
      defaultCategoryId?: string | null
      defaultCleanupDelayHours?: number | null
      defaultFormTemplateId?: string | null
      defaultScheduleChannelId?: string | null
      modRoleIds?: string[] | null
    } | null
    if (!body) {
      await reply.code(400).send({ ok: false, code: 'bad_input', message: 'Body required.' })
      return
    }
    const cleaned: Parameters<typeof updateGuildSettings>[3] = {}
    if ('teamCategoryId' in body) cleaned.teamCategoryId = body.teamCategoryId ?? null
    if ('defaultAnnouncementChannelId' in body) cleaned.defaultAnnouncementChannelId = body.defaultAnnouncementChannelId ?? null
    if ('defaultPanelChannelId' in body) cleaned.defaultPanelChannelId = body.defaultPanelChannelId ?? null
    if ('defaultCategoryId' in body) cleaned.defaultCategoryId = body.defaultCategoryId ?? null
    if ('defaultScheduleChannelId' in body) cleaned.defaultScheduleChannelId = (body as unknown as { defaultScheduleChannelId?: string | null }).defaultScheduleChannelId ?? null
    if ('modRoleIds' in body) {
      if (!ownerAdminRequests.has(req)) {
        await reply.code(403).send({ ok: false, code: 'access_refused', message: 'Only the guild owner or an administrator can change delegated roles.' });
        return;
      }
      const arr = body.modRoleIds
      if (arr !== null && (!Array.isArray(arr) || arr.some(v=>typeof v !== 'string' || !isSnowflake(v)))) {
        await reply.code(400).send({ ok: false, code: 'bad_input', message: 'modRoleIds must be array of role snowflakes or null.' }); return
      }
      cleaned.modRoleIds = arr ?? []
    }
    if ('defaultFormTemplateId' in body) {
      const id = body.defaultFormTemplateId
      if (id !== null && id !== '' && (await listTemplates(db, await guildOf(req), 'form')).find(t => t.id === id) === undefined) {
        await reply.code(400).send({ ok: false, code: 'not_found', message: 'Form template not found.' }); return
      }
      cleaned.defaultFormTemplateId = id ?? null
    }
    if ('defaultCleanupDelayHours' in body) {
      const n = body.defaultCleanupDelayHours
      if (n !== null && (typeof n !== 'number' || !Number.isFinite(n) || n < 0 || n > 720)) {
        await reply.code(400).send({ ok: false, code: 'bad_input', message: 'defaultCleanupDelayHours must be 0-720 or null.' })
        return
      }
      cleaned.defaultCleanupDelayHours = n
    }
    const settings = await updateGuildSettings(db, await actorOf(req), await guildOf(req), cleaned)
    return { ok: true, settings }
  });

  app.post('/api/participants/:userId/status', async (req, reply) => {
    const { userId } = req.params as { userId: string };
    const body = req.body as { action?: string; reason?: string } | null;
    const actor = await actorOf(req);
    const eventId = await resolveEventId(req, await guildOf(req));
    let res;
    switch (body?.action) {
      case 'block':
        res = await blockParticipant(db, actor, eventId, userId, body.reason ?? 'No reason given');
        break;
      case 'unblock':
        res = await unblockParticipant(db, actor, eventId, userId);
        break;
      case 'withdraw':
        res = await withdrawParticipant(db, actor, eventId, userId);
        break;
      case 'reactivate': {
        res = await reactivateParticipant(db, actor, eventId, userId);
        break;
      }
      default:
        res = { ok: false, code: 'bad_action', message: 'Unknown action.' };
    }
    if (!res.ok) {
      await reply.code(400).send(res);
      return;
    }
    if ((body?.action === 'block' || body?.action === 'withdraw') && res.value !== undefined &&
        !await completeDeparture(eventId, await guildOf(req), userId, res.value)) {
      return reply.code(503).send({ error: 'role_revocation_pending', committed: true });
    }
    return { ok: true };
  });

  app.post('/api/participants/:userId/team', async (req, reply) => {
    const { userId } = req.params as { userId: string };
    const body = req.body as { teamId?: string | null } | null;
    const guildId = await guildOf(req);
    const eventId = await resolveEventId(req, guildId);
    const res = await adminAssign(db, await actorOf(req), eventId, userId, body?.teamId ?? null, (await getForm(db, guildId)).teamSize);
    if (!res.ok) {
      await reply.code(400).send(res);
      return;
    }
    if (res.value !== null && deps.client !== null && !deps.config.skipDiscord) {
      await applyTeamLeave({ db, client: deps.client, categoryIdFor: () => undefined }, res.value, userId);
    }
    if (body?.teamId && deps.client !== null && !deps.config.skipDiscord) {
      const team = await getTeam(db, body.teamId);
      if (team?.eventId === eventId) await refreshTeamPanel({ db, client: deps.client, categoryIdFor: () => undefined }, team);
    }
    return { ok: true };
  });

  app.post('/api/teams', async (req, reply) => {
    const body = req.body as { name?: string; kind?: string; ownerId?: string } | null;
    if (body?.kind !== 'public' && body?.kind !== 'private') {
      await reply.code(400).send({ ok: false, code: 'bad_kind', message: 'kind must be public|private' });
      return;
    }
    if (body.ownerId !== undefined && await getParticipant(db, await resolveEventId(req, await guildOf(req)), body.ownerId) === null) {
      await reply.code(400).send({ ok: false, code: 'not_found', message: 'Owner has no signup.' });
      return;
    }
    const ownerId = body.ownerId ?? `admin-${Date.now()}`;
    const res = await createTeam(db, await actorOf(req), await resolveEventId(req, await guildOf(req)), await guildOf(req), body.name ?? '', body.kind, ownerId);
    if (!res.ok) {
      await reply.code(400).send(res);
      return;
    }
    return { ok: true, team: res.value };
  });

  app.post('/api/teams/:teamId/delete', async (req, reply) => {
    const res = await deleteTeam(db, await actorOf(req), (req.params as { teamId: string }).teamId);
    if (!res.ok) {
      await reply.code(400).send(res);
      return;
    }
    return { ok: true };
  });

  app.post('/api/teams/:teamId/settings', async (req, reply) => {
    const { teamId } = req.params as { teamId: string };
    const body = req.body as { name?: string; kind?: string; colorId?: string | null } | null;
    const res = await updateTeamSettings(db, await actorOf(req), teamId, {
      ...(body?.name !== undefined ? { name: body.name } : {}),
      ...(body?.kind === 'public' || body?.kind === 'private' ? { kind: body.kind } : {}),
      ...(body?.colorId !== undefined ? { colorId: body.colorId } : {}),
    });
    if (!res.ok) {
      await reply.code(400).send(res);
      return;
    }
    if (deps.client !== null && !deps.config.skipDiscord) {
      await refreshTeamPanel({ db, client: deps.client, categoryIdFor: () => undefined }, res.value);
    }
    return { ok: true, team: res.value };
  });

  app.post('/api/teams/:teamId/rotate-code', async (req, reply) => {
    const res = await rotateJoinCode(db, await actorOf(req), (req.params as { teamId: string }).teamId);
    if (!res.ok) {
      await reply.code(400).send(res);
      return;
    }
    return { ok: true, code: res.value };
  });

  app.post('/api/teams/:teamId/remove-member', async (req, reply) => {
    const { teamId } = req.params as { teamId: string };
    const body = req.body as { userId?: string } | null;
    const previousTeam = await getTeam(db, teamId);
    const res = await removeMember(db, await actorOf(req), teamId, body?.userId ?? '');
    if (!res.ok) {
      await reply.code(400).send(res);
      return;
    }
    if (previousTeam !== null && deps.client !== null && !deps.config.skipDiscord) {
      await applyTeamLeave({ db, client: deps.client, categoryIdFor: () => undefined }, previousTeam, body?.userId ?? '');
    }
    return { ok: true };
  });

  app.post('/api/match/preview', async (req, reply) => {
    const res = await previewMatch(db, await resolveEventId(req, await guildOf(req)), await getForm(db, await guildOf(req)));
    if (!res.ok) {
      await reply.code(400).send(res);
      return;
    }
    return { ok: true, result: res.value };
  });

app.post('/api/match/commit', async (req, reply) => {
    const eventId = await resolveEventId(req, await guildOf(req));
    const revision = (req.body as { revision?: unknown } | null)?.revision;
    if (typeof revision !== 'string' || !/^[a-f0-9]{64}$/.test(revision)) return reply.code(409).send({ code: 'stale_preview' });
    const res = await commitMatch(db, await actorOf(req), eventId, await guildOf(req), await getForm(db, await guildOf(req)), revision);
    if (!res.ok) {
      return reply.code(409).send({ ok: false, code: res.code, message: res.message });
    }
    // Provision matched team spaces + roles (parity with the Discord commit flow).
    if (deps.client !== null) {
      const categoryId = (await getGuildSettings(db, await guildOf(req))).teamCategoryId ?? config.teamCategoryId;
      const provisionDeps = { db, client: deps.client, categoryIdFor: () => categoryId ?? undefined };
      const { provisionTeamSpace, grantTeamRole, sendJoinWelcome } = await import('../discord/provision.js');
      const matched = (await listTeams(db, eventId)).filter((t) => t.kind === 'matched');
      for (const team of matched) {
        const provisioned = await provisionTeamSpace(provisionDeps, team);
        for (const member of team.members) {
          await grantTeamRole(provisionDeps, provisioned, member.userId);
        }
        const first = team.members[0];
        if (first !== undefined) {
          await sendJoinWelcome(
            provisionDeps,
            provisioned,
            first.userId,
            team.members.map((m) => ({ userId: m.userId, displayName: m.displayName })),
          );
        }
      }
    }
    const lines = res.value.teams
      .map((t) => `**${t.name}** — compatibility ${t.score}\n${t.memberIds.map((id) => `<@${id}>`).join(', ')}`)
      .join('\n\n');
    await deps.announce(await guildOf(req), `🏁 **Teams are locked in!**\n\n${lines}`);
    return { ok: true, result: res.value };
  });

  /** Late-signup placement: top-3 team suggestions for one participant (pure read). */
  app.post('/api/match/suggestions', async (req, reply) => {
    const body = req.body as { participantId?: string } | null;
    const participantId = body?.participantId ?? '';
    const eventId = await resolveEventId(req, await guildOf(req));
    const participant = await getParticipant(db, eventId, participantId);
    if (participant === null) {
      await reply.code(404).send({ ok: false, code: 'not_found', message: 'Participant not found in this event.' });
      return;
    }
    if (participant.teamId !== null) {
      await reply.code(400).send({ ok: false, code: 'already_in_team', message: 'Participant is already on a team.' });
      return;
    }
    const event = await getEvent(db, eventId);
    const form = event === null ? await getForm(db, await guildOf(req)) : getEventForm(db, event, await getForm(db, event.guildId));
    const projected = await projectParticipantForMatching(db, participant, form);
    if (projected === null) return reply.code(400).send({ ok: false, code: 'registration_incomplete' });
    const suggestions = suggestTeamsForParticipant(projected, await listTeamsWithMembers(db, eventId, form), form);
    return { ok: true, suggestions };
  });

  /** Lock teams in now: skips future auto-match (manual match runs still allowed). */
app.post('/api/match/lock', async (req) => {
    await markMatchLocked(db, await resolveEventId(req, await guildOf(req)));
    await audit(db, await actorOf(req), 'match.lock', await resolveEventId(req, await guildOf(req)), null, await guildOf(req));
    return { ok: true };
  });

  /** Clear the lock so auto-match can fire again. */
  app.post('/api/match/unlock', async (req) => {
    await markMatchUnlocked(db, await resolveEventId(req, await guildOf(req)));
    await audit(db, await actorOf(req), 'match.unlock', await resolveEventId(req, await guildOf(req)), null, await guildOf(req));
    return { ok: true };
  });

  app.post('/api/form', async (req, reply) => {
    const body = req.body as Partial<FormConfig> | null;
    const res = await updateForm(db, await guildOf(req), 'web', body ?? {});
    if (!res.ok) {
      await reply.code(400).send(res);
      return;
    }
    // Keep the Discord signup panel in sync with the new form config.
    const formGuild = await guildOf(req);
    if (deps.client !== null && isSnowflake(formGuild)) {
      void refreshSignupPanel(db, deps.client, formGuild).catch(() => undefined);
    }
    return { ok: true, config: res.value };
  });

  app.post('/api/form/reset', async (req) => {
    const res = await resetForm(db, await guildOf(req), 'web');
    return { ok: res.ok, config: res.ok ? res.value : undefined };
  });

app.post('/api/event/reset', async (req) => {
    const eventId = await resolveEventId(req, await guildOf(req));
    const { purgeEventParticipants } = await import('../features/signup/data.js');
    const { deleteEventTeams } = await import('../features/teams/data.js');
    const participants = await purgeEventParticipants(db, await actorOf(req), eventId);
    const teams = await deleteEventTeams(db, await actorOf(req), eventId);
    const imported = await purgeImportedSignups(db, eventId);
    return { ok: true, removed: { participants, teams, imported } };
  });

  app.post('/api/guild/category', async (req) => {
    const body = req.body as { categoryId?: string | null } | null;
    await setGuildCategory(db, await actorOf(req), await guildOf(req), body?.categoryId ?? null);
    return { ok: true };
  });

  const validateImportCore = (values: Record<string, unknown>, form: FormConfig): string[] => {
    const issues: string[] = [];
    if (typeof values.experience === 'string' && values.experience && !form.experiences.some((option) => option.id === values.experience)) issues.push('Invalid experience choice');
    if (typeof values.role === 'string' && values.role && !form.roleTracks.some((option) => option.id === values.role)) issues.push('Invalid role choice');
    if (typeof values.teamPref === 'string' && values.teamPref && !form.teamPrefs.some((option) => option.id === values.teamPref)) issues.push('Invalid participation choice');
    if (typeof values.skills === 'string' && values.skills.split(',').map((value) => value.trim()).filter(Boolean).some((id) => !form.skills.some((option) => option.id === id))) issues.push('Invalid preferred-area choice');
    return issues;
  };

  app.post('/api/events/:eventId/signup-import/preview', async (req, reply) => {
    const { eventId } = req.params as { eventId: string };
    const event = await getEvent(db, eventId);
    if (!event || event.guildId !== await guildOf(req)) return reply.code(404).send({ error: 'event_not_found' });
    if (event.status === 'ended') return reply.code(409).send({ error: 'event_ended' });
    const importForm = getEventForm(db, event, await getForm(db, event.guildId));
    const body = req.body as { csv?: unknown; mapping?: unknown } | null;
    if (typeof body?.csv !== 'string') return reply.code(400).send({ error: 'invalid_csv', issues: ['csv must be text'] });
    try {
      const parsed = parseSignupCsv(body.csv);
      const mapping = body.mapping && typeof body.mapping === 'object' && !Array.isArray(body.mapping)
        ? body.mapping as Record<string, unknown> : {};
      if (Object.keys(mapping).some((header) => !parsed.headers.includes(header)) || Object.values(mapping).some((target) => typeof target !== 'string')) {
        return reply.code(400).send({ error: 'invalid_mapping', issues: ['Mapping headers must exist in the CSV and targets must be text.'] });
      }
      const suggestedMapping = Object.fromEntries(parsed.headers.map((header) => {
        const key = header.toLocaleLowerCase('sv-SE').normalize('NFD').replace(/\p{Diacritic}/gu, '').replace(/[^a-z]/g, '');
        const target = ({ timestamp: 'sourceTimestamp', tidstampel: 'sourceTimestamp', nameclass: 'name', dittnamnochklass: 'name', name: 'name', chasemail: 'email', dinchasmail: 'email', email: 'email', discordusername: 'discordUsername', allergies: 'allergies', dietary: 'allergies', hardunagrallergierviskatahansyntillnarkoperfika: 'allergies', hardunagraallergierviskatahansyntillnarvikoperfika: 'allergies', participationpreference: 'teamPref', hurvildeltaihackoween: 'teamPref', hurvilldudeltaihackoween: 'teamPref', groupsize: 'groupSize', hurmangaarnierergrupp: 'groupSize', hurmangaarniiergrupp: 'groupSize', groupname: 'groupName', gruppnamnfordiganmalerienfardiggrupp: 'groupName', gruppnamnfordigsomanmalerienfardiggrupp: 'groupName', gruppnamnfordigsomanmalerenfardiggrupp: 'groupName', members: 'members', namnpamedlemmarnaigruppen: 'members', preferredworkareas: 'skills', vilketomradevillduhelstjobbameddurhackatonet: 'skills', vilketomradevillduhelstjobbamedunderhackatonet: 'skills' } as Record<string, string>)[key];
        return [header, mapping[header] ?? target ?? ''];
      }).filter(([, target]) => target !== ''));
      const rows = parsed.rows.map((cells, index) => {
        const values: Record<string, string> = {};
        const answers: Record<string, string> = {};
        const raw = Object.fromEntries(parsed.headers.map((header, i) => [header, cells[i]!.trim()]));
        for (const [header, value] of Object.entries(raw)) {
          const target = suggestedMapping[header];
          if (!target) { values[`source:${header}`] = value; continue; }
          if (['experience', 'role', 'teamPref', 'skills'].includes(target)) values[`source:${header}`] = value;
          if (target === 'sourceTimestamp') values.sourceTimestamp = value;
          else if (['name', 'email', 'discordUsername', 'allergies', 'participationPreference', 'groupSize', 'groupName', 'members', 'preferredAreas', 'experience', 'role', 'teamPref', 'skills'].includes(target)) values[target] = value;
          else answers[target] = value;
        }
        const issues: string[] = [];
        if (!values.name) issues.push('Missing name');
        if (!values.email) issues.push('Missing email; this row needs explicit review');
        const checked = validateCustomAnswers(importForm, answers);
        if (!checked.ok) issues.push(...checked.errors);
        else issues.push(...checked.missingRequiredQuestionIds.map((id) => `Missing required answer: ${id}`));
        issues.push(...validateImportCore(values, importForm));
        return { rowNumber: index + 2, values, answers, issues };
      });
      const summary = await summarizeImportedRows(db, eventId, rows);
      return { headers: parsed.headers, suggestedMapping, rows: rows.map((row, index) => ({ ...row, duplicateStatus: summary.statuses[index] })), summary: { create: summary.create, duplicate: summary.duplicate, conflict: summary.conflict } };
    } catch (error) {
      return reply.code(400).send({ error: 'invalid_csv', issues: [error instanceof Error ? error.message : 'Invalid CSV'] });
    }
  });

  app.post('/api/events/:eventId/signup-import', async (req, reply) => {
    const { eventId } = req.params as { eventId: string };
    const event = await getEvent(db, eventId);
    if (!event || event.guildId !== await guildOf(req)) return reply.code(404).send({ error: 'event_not_found' });
    if (event.status === 'ended') return reply.code(409).send({ error: 'event_ended' });
    const importForm = getEventForm(db, event, await getForm(db, event.guildId));
    const body = req.body as { rows?: unknown } | null;
    if (!Array.isArray(body?.rows) || body.rows.length > 2000 || Buffer.byteLength(JSON.stringify(body.rows), 'utf8') > 1_000_000) {
      return reply.code(400).send({ error: 'invalid_rows', issues: ['rows must contain at most 2,000 records and 1 MB'] });
    }
    const rows: { sourceRow: number; sourceTimestamp?: string; values: Record<string, string>; answers: Record<string, string | string[]> }[] = [];
    for (const [index, raw] of body.rows.entries()) {
      if (!raw || typeof raw !== 'object') return reply.code(400).send({ error: 'invalid_row', row: index + 1 });
      const row = raw as Record<string, unknown>;
      if (!Number.isInteger(row.sourceRow) || !row.values || typeof row.values !== 'object' || Array.isArray(row.values) || !row.answers || typeof row.answers !== 'object' || Array.isArray(row.answers)) {
        return reply.code(400).send({ error: 'invalid_row', row: index + 1 });
      }
      const values = row.values as Record<string, unknown>;
      const answers = row.answers as Record<string, unknown>;
      if (Object.keys(values).some((key) => key.length > 100) || Object.keys(answers).some((key) => key.length > 100) || Object.values(values).some((v) => typeof v !== 'string' || v.length > 10_000) || Object.values(answers).some((v) => typeof v !== 'string' ? !Array.isArray(v) || v.length > 100 || v.some((x) => typeof x !== 'string' || x.length > 10_000) : v.length > 10_000)) {
        return reply.code(400).send({ error: 'invalid_row', row: index + 1, issues: ['Values must be bounded text'] });
      }
      const checked = validateCustomAnswers(importForm, answers);
      if (!checked.ok) return reply.code(400).send({ error: 'invalid_row', row: index + 1, issues: checked.errors });
      const coreIssues = validateImportCore(values, importForm);
      if (coreIssues.length) return reply.code(400).send({ error: 'invalid_row', row: index + 1, issues: coreIssues });
      rows.push({ sourceRow: row.sourceRow as number, ...(typeof values.sourceTimestamp === 'string' ? { sourceTimestamp: values.sourceTimestamp } : {}), values: values as Record<string, string>, answers: answers as Record<string, string | string[]> });
    }
    try {
      const result = await createImportedSignups(db, eventId, await guildOf(req), importForm.version, rows);
      return result;
    } catch (error) {
      const code = error instanceof Error ? error.message : 'import_failed';
      return reply.code(code === 'event_unavailable' ? 409 : 400).send({ error: code });
    }
  });

  app.get('/api/events/:eventId/imported-signups', async (req) => {
    const eventId = (req.params as { eventId: string }).eventId;
    const event = await getEvent(db, eventId);
    if (!event || event.guildId !== await guildOf(req)) return { records: [] };
    const form = getEventForm(db, event, await getForm(db, event.guildId));
    const required = (form.customQuestions ?? []).filter((question) => question.required && question.visibility !== 'organizer_only').map((question) => question.id);
    return { records: await listImportedSignups(db, eventId, required) };
  });

  app.patch('/api/events/:eventId/imported-signups/:id', async (req, reply) => {
    const params = req.params as { eventId: string; id: string };
    const event = await getEvent(db, params.eventId);
    if (!event || event.guildId !== await guildOf(req)) return reply.code(404).send({ error: 'event_not_found' });
    if (event.status === 'ended') return reply.code(409).send({ error: 'event_ended' });
    const body = req.body as { values?: unknown; answers?: unknown; discordUsername?: unknown; linkDiscordUserId?: unknown } | null;
    if (body?.linkDiscordUserId !== undefined && (typeof body.linkDiscordUserId !== 'string' || !isSnowflake(body.linkDiscordUserId))) return reply.code(400).send({ error: 'invalid_member_id' });
    if (body?.values !== undefined && (!body.values || typeof body.values !== 'object' || Array.isArray(body.values)) || body?.answers !== undefined && (!body.answers || typeof body.answers !== 'object' || Array.isArray(body.answers)) || body?.discordUsername !== undefined && body.discordUsername !== null && typeof body.discordUsername !== 'string') {
      return reply.code(400).send({ error: 'invalid_edit' });
    }
    const form = getEventForm(db, event, await getForm(db, event.guildId));
    if (body?.values && Object.values(body.values as Record<string, unknown>).some((value) => typeof value !== 'string' || value.length > 10_000)) return reply.code(400).send({ error: 'invalid_edit', issues: ['Values must be bounded text'] });
    if (body?.answers) {
      const checked = validateCustomAnswers(form, body.answers);
      if (!checked.ok) return reply.code(400).send({ error: 'invalid_edit', issues: checked.errors });
    }
    if (body?.values) {
      const coreIssues = validateImportCore(body.values as Record<string, unknown>, form);
      if (coreIssues.length) return reply.code(400).send({ error: 'invalid_edit', issues: coreIssues });
    }
    if (typeof body?.discordUsername === 'string' && body.discordUsername.length > 256) return reply.code(400).send({ error: 'invalid_edit' });
    const required = (form.customQuestions ?? []).filter((question) => question.required && question.visibility !== 'organizer_only').map((question) => question.id);
    if (typeof body?.linkDiscordUserId === 'string' && !(await currentMember(event.guildId, body.linkDiscordUserId))) return reply.code(400).send({ error: 'not_guild_member' });
    try {
      return await db.transaction(async () => {
        const edited = await editImportedSignup(db, params.eventId, params.id, {
          ...(body?.values ? { values: body.values as Record<string, string> } : {}),
          ...(body?.answers ? { answers: body.answers as Record<string, string | string[]> } : {}),
          ...(body?.discordUsername !== undefined ? { discordUsername: body.discordUsername as string | null } : {}),
          ...(body?.answers !== undefined ? { formVersion: form.version } : {}),
        });
        if (!edited) throw new Error('not_found');
        if (typeof body?.linkDiscordUserId === 'string') {
          const linked = await linkImportedSignup(db, event.id, event.guildId, params.id, body.linkDiscordUserId, form);
          if (linked.error) throw new Error(linked.error);
          const record = (await listImportedSignups(db, event.id, required)).find((item) => item.id === params.id) ?? edited;
          return { record, ...linked };
        }
        const record = (await listImportedSignups(db, event.id, required)).find((item) => item.id === params.id) ?? edited;
        return { record, linked: record.discordUserId !== null, missingFields: record.missingFields };
      });
    } catch (error) {
      const code = error instanceof Error ? error.message : 'edit_failed';
      return reply.code(code === 'event_not_active' ? 409 : code === 'not_found' || code === 'import_not_found' ? 404 : 400).send({ error: code });
    }
  });
}
