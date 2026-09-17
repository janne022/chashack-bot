/**
 * Admin web routes. Session auth via HMAC-signed cookie; all state-changing
 * routes are POST + JSON. UI files served from public/.
 */
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { Db } from '../shared/db.js';
import type { Env } from '../shared/env.js';
import {
  makeDiscordToken,
  makeOperatorToken,
  makePkcePair,
  makeState,
  manageableGuilds,
  safeEqual,
  verifyToken,
  type OAuthGuild,
  type SessionRef,
} from '../features/auth/domain.js';
import {
  createSession,
  deleteSession,
  getSession,
  purgeExpiredSessions,
  selectGuild,
  type WebSession,
} from '../features/auth/data.js';
import { audit } from '../shared/audit.js';
import { auditList } from '../shared/audit.js';
import {
  blockParticipant,
  unblockParticipant,
  withdrawParticipant,
  listParticipants,
  getParticipant,
} from '../features/signup/data.js';
import {
  createTeam,
  deleteTeam,
  rotateJoinCode,
  adminAssign,
  listTeams,
  removeMember,
  updateTeamSettings,
  setGuildCategory,
  getGuildSettings,
  updateGuildSettings,
} from '../features/teams/data.js';
import { previewMatch, commitMatch, lastMatchInfo, listTeamsWithMembers } from '../features/matching/data.js';
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
} from '../features/events/data.js';
import { getForm, updateForm, resetForm } from '../features/form/data.js';
import { refreshSignupPanel, postOrUpdatePanel } from '../discord/signup-panel.js';
import { sendAnnouncement, createDiscordEvents } from '../discord/notify.js';
import type { FormConfig } from '../features/form/domain.js';

export interface WebDeps {
  db: Db;
  config: Env;
  announce: (guildId: string, content: string) => Promise<void>;
  /** Live Discord client, used to auto-refresh the signup panel on form edits. May be null in SKIP_DISCORD mode. */
  client: import('discord.js').Client | null;
}

const COOKIE = 'hacksess';
const STATE_COOKIE = 'hackstate';
const PKCE_COOKIE = 'hackpkce';
const OAUTH_STATE_TTL_MS = 10 * 60 * 1000;
const OAUTH_STATE_TTL_S = Math.floor(OAUTH_STATE_TTL_MS / 1000);

function sessionRefFrom(req: FastifyRequest, config: Env): SessionRef | null {
  const raw = readCookie(req, COOKIE);
  if (raw === null) return null;
  return verifyToken(config.adminSessionSecret, raw);
}

function readCookie(req: FastifyRequest, name: string): string | null {
  const cookie = req.headers.cookie ?? '';
  const m = new RegExp(`(?:^|;\\s*)${name}=([^;]+)`).exec(cookie);
  return m === null ? null : decodeURIComponent(m[1]!);
}

function sessionCookie(token: string, secure: boolean): string {
  return `${COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${7 * 24 * 3600}${secure ? '; Secure' : ''}`;
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
  /** Guild used when a session has not selected one (single-guild installs). */
  const envGuildId = config.guildId ?? 'default';

  /**
   * An authenticated request. A Discord token only counts while its row exists:
   * the row IS the session, so logout, expiry or a leaked cookie for a deleted
   * session must stop working immediately — the HMAC alone is not authorisation.
   */
  const sessionFrom = (req: FastifyRequest): { ref: SessionRef; session: WebSession | null } | null => {
    const ref = sessionRefFrom(req, config);
    if (ref === null) return null;
    if (ref.kind === 'operator') return { ref, session: null };
    const session = getSession(db, ref.sessionId);
    return session === null ? null : { ref, session };
  };

  /**
   * The guild a request acts on. A Discord session carries the guild its user
   * picked; operator (password) sessions — and sessions that never picked — fall
   * back to the configured guild. The client never names the guild, which is what
   * keeps one guild's console from reading another's data.
   */
  const guildOf = (req: FastifyRequest): string => {
    const live = sessionFrom(req);
    if (live !== null && live.session !== null && live.session.selectedGuildId !== null) {
      return live.session.selectedGuildId;
    }
    return envGuildId;
  };
  if (!isSnowflake(envGuildId)) {
    console.warn(`[adminweb] DISCORD_GUILD_ID is not set or not a snowflake (got "${envGuildId}"). Discord features (announce, panel, guild channels) will fail until you set it in .env and restart. Admin UI still works.`);
  }

  /**
   * The event the admin web UI operates on when the caller doesn't name one.
   * Prefers the newest active event so single-event setups keep working, then
   * falls back to the newest event of any status (so a guild with only drafts
   * still resolves to a real event rather than the guild id).
   */
  const activeEventId = (guild: string): string => {
    const row =
      (db
        .prepare("SELECT id FROM events WHERE guild_id = ? AND status = 'active' ORDER BY created_at DESC LIMIT 1")
        .get(guild) as { id: string } | undefined) ??
      (db
        .prepare('SELECT id FROM events WHERE guild_id = ? ORDER BY created_at DESC LIMIT 1')
        .get(guild) as { id: string } | undefined);
    return row?.id ?? guild;
  };

  /**
   * Resolve the event an endpoint should act on. An explicit `eventId` (query
   * param or body field) always wins so multiple concurrent events are
   * addressable; otherwise fall back to the default event.
   */
  const resolveEventId = (req: { query?: unknown; body?: unknown }, guild: string): string => {
    const q = req.query as Record<string, unknown> | undefined;
    if (q && typeof q.eventId === 'string' && q.eventId !== '') return q.eventId;
    const b = req.body as Record<string, unknown> | null | undefined;
    if (b && typeof b.eventId === 'string' && b.eventId !== '') return b.eventId;
    return activeEventId(guild);
  };

  app.addHook('preHandler', async (req, reply) => {
    const isApi = req.url.startsWith('/api/');
    // Public: the login endpoints themselves. Everything else under /api needs a
    // session (operator or Discord).
    const isPublic = req.url === '/api/login' || req.url === '/api/auth/mode';
    if (!isApi || isPublic) return;
    if (sessionFrom(req) === null) {
      await reply.code(401).send({ error: 'unauthorized' });
    }
  });

  app.post('/api/login', async (req, reply) => {
    const body = req.body as { password?: string } | null;
    if (body?.password !== config.adminPassword) {
      await reply.code(401).send({ error: 'invalid_password' });
      return;
    }
    reply.header('set-cookie', sessionCookie(makeOperatorToken(config.adminSessionSecret), secureCookies));
    audit(db, 'web', 'web.login', 'admin', null);
    return { ok: true };
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
      originHost = new URL(origin).host;
    } catch {
      await reply.code(403).send({ error: 'bad_origin' });
      return;
    }
    const expected =
      config.publicUrl !== undefined ? new URL(config.publicUrl).host : (req.headers.host ?? '');
    if (originHost !== expected) {
      console.warn(`[adminweb] rejected ${method} ${req.url}: Origin ${originHost} != ${expected}`);
      await reply.code(403).send({ error: 'origin_mismatch' });
    }
  });

  /** Public: lets the login screen decide whether to offer "Sign in with Discord". */
  app.get('/api/auth/mode', async () => ({
    oauth: oauthConfigured,
    password: true,
  }));

  /**
   * Where Discord sends the code back. Never derived from an attacker-controlled
   * Host header when we know our public origin — otherwise a spoofed Host could
   * aim the redirect (and the code) at someone else's domain. The Host fallback
   * exists for local development only and is refused for anything but loopback.
   */
  const redirectUri = (req: FastifyRequest): string | null => {
    if (config.oauthRedirectUri !== undefined) return config.oauthRedirectUri;
    if (config.publicUrl !== undefined) return `${config.publicUrl.replace(/\/$/, '')}/auth/discord/callback`;
    const host = req.headers.host ?? '';
    const loopback = /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(host);
    if (!loopback) return null;
    return `http://${host}/auth/discord/callback`;
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
    audit(db, 'web', 'web.oauth_start', 'discord', null);
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
      await reply.redirect(`/?auth=${reason}`);
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
        fetch('https://discord.com/api/v10/users/@me', { headers: auth }),
        fetch('https://discord.com/api/v10/users/@me/guilds', { headers: auth }),
      ]);
      if (!userRes.ok || !guildsRes.ok) {
        console.warn(`[oauth] identity fetch failed: user=${userRes.status} guilds=${guildsRes.status}`);
        return void (await fail('identity_failed'));
      }
      const user = (await userRes.json()) as { id: string; username: string; avatar: string | null };
      const userGuilds = (await guildsRes.json()) as OAuthGuild[];

      // Only guilds where the person administers AND the bot is present.
      const botGuildIds = deps.client === null ? null : new Set(deps.client.guilds.cache.keys());
      const guilds = manageableGuilds(userGuilds, botGuildIds);
      if (guilds.length === 0) return void (await fail('no_guild'));

      // Session fixation: never adopt a session presented by the client. Any
      // pre-existing one dies here, and the new id is minted server-side.
      const presented = sessionRefFrom(req, config);
      if (presented !== null && presented.kind === 'discord') deleteSession(db, presented.sessionId);

      purgeExpiredSessions(db);
      const session = createSession(db, {
        userId: user.id,
        username: user.username,
        avatar: user.avatar,
        guilds,
      });
      audit(db, 'discord', 'web.login', user.id, { guilds: guilds.length, via: 'oauth' });
      reply.header('set-cookie', [
        sessionCookie(makeDiscordToken(config.adminSessionSecret, session.id), secureCookies),
        clearCookie(STATE_COOKIE, secureCookies),
        clearCookie(PKCE_COOKIE, secureCookies),
      ]);
      await reply.redirect('/');
    } catch (error) {
      console.warn('[oauth] callback failed:', error);
      await fail('error');
    }
  });

  /** Who am I, what am I managing, what may I switch to. */
  app.get('/api/auth/me', async (req) => {
    const live = sessionFrom(req);
    const guildName = (id: string | null): string | null => {
      if (id === null || deps.client === null) return null;
      const cached = deps.client.guilds.cache.get(id);
      return cached?.name ?? null;
    };
    if (live !== null && live.session !== null) {
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
    return {
      kind: 'password' as const,
      user: null,
      guild: { id: isSnowflake(envGuildId) ? envGuildId : null, name: guildName(envGuildId) },
      guilds: isSnowflake(envGuildId)
        ? [{ id: envGuildId, name: guildName(envGuildId) ?? envGuildId, icon: null }]
        : [],
    };
  });

  /** Switch the guild this session manages. Validated server-side. */
  app.post('/api/auth/guild', async (req, reply) => {
    const live = sessionFrom(req);
    const body = req.body as { guildId?: string } | null;
    const target = body?.guildId ?? '';
    if (live === null || live.session === null) {
      await reply.code(400).send({ ok: false, code: 'not_discord_session', message: 'Password sessions are pinned to the configured server.' });
      return;
    }
    if (!selectGuild(db, live.session.id, target)) {
      await reply.code(403).send({ ok: false, code: 'not_allowed', message: 'You do not manage that server.' });
      return;
    }
    audit(db, 'discord', 'web.switch_guild', target, null);
    return { ok: true, guildId: target };
  });

  app.post('/api/auth/logout', async (req, reply) => {
    const live = sessionFrom(req);
    if (live !== null && live.session !== null) {
      // Deleting the row is what actually revokes: the cookie stops resolving.
      deleteSession(db, live.session.id);
      audit(db, 'discord', 'web.logout', live.session.userId, null);
    }
    reply.header('set-cookie', clearCookie(COOKIE, secureCookies));
    return { ok: true };
  });

  app.get('/api/guild/channels', async (req) => {
    if (deps.client === null) return { channels: [], categories: [], roles: [] };
    if (!isSnowflake(guildOf(req))) {
      console.warn(`GET /api/guild/channels: DISCORD_GUILD_ID not set or invalid ("${guildOf(req)}") — returning empty. Set it in .env.`);
      return { channels: [], categories: [], roles: [] };
    }
    try {
      const guild = await deps.client.guilds.fetch(guildOf(req));
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
    if (!isSnowflake(guildOf(req))) return { roles: [] };
    try {
      const guild = await deps.client.guilds.fetch(guildOf(req));
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
    if (!isSnowflake(guildOf(req))) {
      await reply.code(400).send({ ok: false, code: 'guild_not_configured', message: `DISCORD_GUILD_ID="${guildOf(req)}" is not a snowflake — set it in .env and restart.` })
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
      const guild = await deps.client.guilds.fetch(guildOf(req))
      const channel = await guild.channels.fetch(channelId)
      if (channel === null) {
        await reply.code(404).send({ ok: false, code: 'not_found', message: `Channel ${channelId} not found in guild ${guildOf(req)}. Is the ID correct?` })
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
      const msg = e instanceof Error ? e.message : String(e)
      const code = (e as Record<string, unknown>)?.code !== undefined ? ` code=${(e as Record<string, unknown>).code}` : ''
      await reply.code(500).send({ ok: false, code: 'discord_error', message: `Discord error${code}: ${msg}` })
    }
  });

  app.get('/api/state', async (req, reply) => {
    const eventId = resolveEventId(req, guildOf(req));
    const participants = listParticipants(db, eventId);
    const teams = listTeams(db, eventId);
    const events = listEvents(db, guildOf(req));
    const selected = events.find((e) => e.id === eventId) ?? null;
    // surface guild mis-config so UI can warn
    const guildOk = isSnowflake(guildOf(req));
    if (!guildOk) {
      reply.header('x-guild-warning', 'DISCORD_GUILD_ID not set');
    }
    return {
      participants,
      teams,
      config: getForm(db),
      audit: auditList(db, 100),
      lastMatch: lastMatchInfo(db, eventId),
      guildSettings: getGuildSettings(db, guildOf(req)),
      guildConfigured: guildOk,
      guildId: guildOf(req),
      events,
      templates: listTemplates(db, guildOf(req)),
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
    if (!isSnowflake(guildOf(req))) {
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
      const tpl = listTemplates(db, guildOf(req), 'event').find((t) => t.id === body.templateId);
      if (tpl === undefined) {
        await reply.code(400).send({ ok: false, code: 'not_found', message: 'Template not found.' });
        return;
      }
      const { templateToEventInput } = await import('../features/events/data.js');
      tplInput = templateToEventInput(tpl.json);
      form = tplInput.form;
    }
    if (body.formTemplateId !== undefined) {
      const tpl = listTemplates(db, guildOf(req), 'form').find((t) => t.id === body.formTemplateId);
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
      const gs2 = getGuildSettings(db, guildOf(req))
      if (gs2.defaultFormTemplateId) {
        const tpl = listTemplates(db, guildOf(req), 'form').find(t => t.id === gs2.defaultFormTemplateId)
        if (tpl) {
          try { form = JSON.parse(tpl.json) as Parameters<typeof createEvent>[3]['form'] } catch { /* ignore */ }
        }
      }
    }
    // Fall back to guild defaults when not explicitly provided
    const gs = getGuildSettings(db, guildOf(req))
    // Template seeds the schedule + assignment pool when the caller didn't supply them.
    const schedule = body.schedule ?? tplInput?.schedule
    const assignments = body.assignments ?? tplInput?.assignments
    const strategy = body.assignmentStrategy ?? tplInput?.assignmentStrategy
    const res = createEvent(db, 'web', guildOf(req), {
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
      activateEvent(db, 'web', res.value.id);
    }
    // Optional: save as event template via checkbox in create dialog
    if (body.saveAsTemplate) {
      const tplName = (body.saveTemplateName ?? body.name).trim().slice(0, 80)
      if (tplName.length >= 2) {
        const { getEventForm } = await import('../features/events/data.js')
        const { DEFAULT_FORM } = await import('../features/form/domain.js')
        const savedEvent = getEvent(db, res.value.id) ?? res.value
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
        saveTemplate(db, 'web', guildOf(req), tplName, 'event', JSON.stringify(payload))
      }
    }
    return { ok: true, event: getEvent(db, res.value.id) ?? res.value };
  });

  app.post('/api/events/:eventId/activate', async (req, reply) => {
    const res = activateEvent(db, 'web', (req.params as { eventId: string }).eventId);
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
    const res = updateEvent(db, 'web', eventId, {
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
    const event = getEvent(db, (req.params as { eventId: string }).eventId)
    if (!event) { await reply.code(404).send({ ok: false, code: 'not_found', message: 'Event not found.' }); return }
    if (!deps.client) { await reply.code(503).send({ ok: false, code: 'no_discord', message: 'Bot not connected.' }); return }
    const body = req.body as { channelId?: string } | null
    const { postOrUpdateScheduleItinerary } = await import('../discord/schedule-itinerary.js')
    const res = await postOrUpdateScheduleItinerary(db, deps.client, event, body?.channelId ?? null)
    if ('error' in res) { await reply.code(400).send({ ok: false, code: 'schedule_error', message: res.error }); return }
    return { ok: true, ...res }
  });

  app.post('/api/events/:eventId/end', async (req, reply) => {
    const res = endEvent(db, 'web', (req.params as { eventId: string }).eventId);
    if (!res.ok) {
      await reply.code(400).send(res);
      return;
    }
    return { ok: true, event: res.value };
  });

  app.post('/api/events/announce', async (req, reply) => {
    if (!isSnowflake(guildOf(req))) {
      await reply.code(400).send({ ok: false, code: 'guild_not_configured', message: 'DISCORD_GUILD_ID is not set or not a snowflake. Configure it in .env or Config → Guild defaults.' });
      return;
    }
    const body = req.body as { eventId?: string; title?: string; message?: string; dm?: boolean; channelId?: string } | null
    const event = body?.eventId !== undefined ? getEvent(db, body.eventId) : getActiveEvent(db, guildOf(req))
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
    const result = await sendAnnouncement({ db, client: deps.client }, 'web', event, body.title, body.message, body.dm ?? false, body.channelId)
    // Surface detailed reason to the UI so it can show "why not posted" instead of generic unreachable
    return { ok: true, ...result }
  })

  app.post('/api/events/:eventId/panel', async (req, reply) => {
    const event = getEvent(db, (req.params as { eventId: string }).eventId);
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
    const res = await postOrUpdatePanel(db, deps.client, guildOf(req), channelId).catch((e: unknown) => ({
      error: e instanceof Error ? e.message : 'Unknown error',
    }));
    if ('error' in res) {
      await reply.code(400).send({ ok: false, code: 'panel_error', message: res.error });
      return;
    }
    // Persist the channel on the event.
    updateEvent(db, 'web', event.id, { panelChannelId: channelId });
    return { ok: true, channelId: res.channelId, edited: res.edited };
  });

  app.post('/api/events/:eventId/discord-events', async (req, reply) => {
    const event = getEvent(db, (req.params as { eventId: string }).eventId);
    if (event === null) {
      await reply.code(404).send({ ok: false, code: 'not_found', message: 'Event not found.' });
      return;
    }
    if (deps.client === null) {
      await reply.code(503).send({ ok: false, code: 'no_discord', message: 'Bot is not connected to Discord.' });
      return;
    }
    const body = req.body as { days?: number; durationHours?: number } | null;
    const result = await createDiscordEvents({ db, client: deps.client }, 'web', event, body?.days ?? 1, body?.durationHours ?? 24);
    if (result.created.length === 0) {
      await reply.code(400).send({ ok: false, code: 'failed', message: result.errors.join('; ') || 'Nothing created.' });
      return;
    }
    return { ok: true, created: result.created, errors: result.errors };
  });

  // ── templates ─────────────────────────────────────────────────────────────

  app.get('/api/templates', async (req) => {
    const kind = (req.query as { kind?: string } | undefined)?.kind
    const templates = listTemplates(db, guildOf(req), kind as never)
    return { templates }
  })

  app.post('/api/templates', async (req, reply) => {
    const body = req.body as { eventId?: string; name?: string; kind?: string; formJson?: string; json?: string } | null
    const kind = body?.kind ?? 'event'
    if (kind !== 'event' && kind !== 'form' && kind !== 'announcement' && kind !== 'assignments') {
      await reply.code(400).send({ ok: false, code: 'bad_kind', message: 'kind must be event|form|announcement|assignments' })
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
        const { normalizeFormUpdate } = await import('../features/form/domain.js')
        const { DEFAULT_FORM } = await import('../features/form/domain.js')
        const normalized = normalizeFormUpdate(DEFAULT_FORM as never, parsed as never)
        json = JSON.stringify(normalized)
      } catch (e) {
        await reply.code(400).send({ ok: false, code: 'bad_json', message: e instanceof Error ? e.message : 'Invalid form JSON' })
        return
      }
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
        const event = body?.eventId !== undefined ? getEvent(db, body.eventId) : getActiveEvent(db, guildOf(req))
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
    const res = saveTemplate(db, 'web', guildOf(req), body?.name ?? '', kind, json)
    if (!res.ok) {
      await reply.code(400).send(res)
      return
    }
    return { ok: true, template: res.value }
  })

  app.patch('/api/templates/:templateId', async (req, reply) => {
    const { templateId } = req.params as { templateId: string }
    const body = req.body as { name?: string; json?: string; formJson?: string } | null
    const existing = listTemplates(db, guildOf(req)).find(t => t.id === templateId)
    if (!existing) { await reply.code(404).send({ ok: false, code: 'not_found', message: 'Template not found.' }); return }
    const name = body?.name !== undefined ? body.name.trim().slice(0, 80) : existing.name
    if (name.length < 2) { await reply.code(400).send({ ok: false, code: 'bad_name', message: 'Name must be at least 2 characters.' }); return }
    let json = body?.json ?? body?.formJson ?? existing.json
    // validate
    try {
      const parsed = JSON.parse(json)
      if (existing.kind === 'form') {
        const { normalizeFormUpdate } = await import('../features/form/domain.js')
        const { DEFAULT_FORM } = await import('../features/form/domain.js')
        json = JSON.stringify(normalizeFormUpdate(DEFAULT_FORM as never, parsed as never))
      } else {
        JSON.stringify(parsed) // just check valid
      }
    } catch (e) { await reply.code(400).send({ ok: false, code: 'bad_json', message: e instanceof Error ? e.message : 'Invalid JSON' }); return }
    db.prepare('UPDATE event_templates SET name = ?, json = ? WHERE id = ?').run(name, json, templateId)
    const updated = listTemplates(db, guildOf(req)).find(t => t.id === templateId)!
    return { ok: true, template: updated }
  })

  app.delete('/api/templates/:templateId', async (req, reply) => {
    const res = deleteTemplate(db, 'web', (req.params as { templateId: string }).templateId);
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
    const event = getEvent(db, eventId)
    if (event === null) {
      await reply.code(404).send({ ok: false, code: 'not_found', message: 'Event not found.' })
      return
    }
    let form: Partial<FormConfig>
    if (body?.formTemplateId) {
      const tpl = listTemplates(db, guildOf(req), 'form').find((t) => t.id === body.formTemplateId)
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
    const { updateEventForm } = await import('../features/events/data.js')
    const res = updateEventForm(db, 'web', eventId, form)
    if (!res.ok) {
      await reply.code(400).send(res)
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
      const arr = body.modRoleIds
      if (arr !== null && (!Array.isArray(arr) || arr.some(v=>typeof v !== 'string' || !isSnowflake(v)))) {
        await reply.code(400).send({ ok: false, code: 'bad_input', message: 'modRoleIds must be array of role snowflakes or null.' }); return
      }
      cleaned.modRoleIds = arr ?? []
    }
    if ('defaultFormTemplateId' in body) {
      const id = body.defaultFormTemplateId
      if (id !== null && id !== '' && listTemplates(db, guildOf(req), 'form').find(t => t.id === id) === undefined) {
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
    const settings = updateGuildSettings(db, 'web', guildOf(req), cleaned)
    return { ok: true, settings }
  });

  app.post('/api/participants/:userId/status', async (req, reply) => {
    const { userId } = req.params as { userId: string };
    const body = req.body as { action?: string; reason?: string } | null;
    const actor = 'web';
    const eventId = resolveEventId(req, guildOf(req));
    let res;
    switch (body?.action) {
      case 'block':
        res = blockParticipant(db, actor, eventId, userId, body.reason ?? 'No reason given');
        break;
      case 'unblock':
        res = unblockParticipant(db, actor, eventId, userId);
        break;
      case 'withdraw':
        res = withdrawParticipant(db, actor, eventId, userId);
        break;
      case 'reactivate': {
        const p = getParticipant(db, eventId, userId);
        if (p === null) {
          res = { ok: false, code: 'not_found', message: 'Participant not found.' };
          break;
        }
        db.prepare("UPDATE participants SET status = 'active', block_reason = NULL, updated_at = ? WHERE event_id = ? AND user_id = ?").run(
          Date.now(),
          eventId,
          userId,
        );
        audit(db, actor, 'participant.reactivate', eventId, { userId });
        res = { ok: true, value: undefined };
        break;
      }
      default:
        res = { ok: false, code: 'bad_action', message: 'Unknown action.' };
    }
    if (!res.ok) {
      await reply.code(400).send(res);
      return;
    }
    return { ok: true };
  });

  app.post('/api/participants/:userId/team', async (req, reply) => {
    const { userId } = req.params as { userId: string };
    const body = req.body as { teamId?: string | null } | null;
    const res = adminAssign(db, 'web', resolveEventId(req, guildOf(req)), userId, body?.teamId ?? null);
    if (!res.ok) {
      await reply.code(400).send(res);
      return;
    }
    return { ok: true };
  });

  app.post('/api/teams', async (req, reply) => {
    const body = req.body as { name?: string; kind?: string; ownerId?: string } | null;
    if (body?.kind !== 'public' && body?.kind !== 'private') {
      await reply.code(400).send({ ok: false, code: 'bad_kind', message: 'kind must be public|private' });
      return;
    }
    if (body.ownerId !== undefined && getParticipant(db, resolveEventId(req, guildOf(req)), body.ownerId) === null) {
      await reply.code(400).send({ ok: false, code: 'not_found', message: 'Owner has no signup.' });
      return;
    }
    const ownerId = body.ownerId ?? `admin-${Date.now()}`;
    const res = createTeam(db, 'web', resolveEventId(req, guildOf(req)), guildOf(req), body.name ?? '', body.kind, ownerId);
    if (!res.ok) {
      await reply.code(400).send(res);
      return;
    }
    return { ok: true, team: res.value };
  });

  app.post('/api/teams/:teamId/delete', async (req, reply) => {
    const res = deleteTeam(db, 'web', (req.params as { teamId: string }).teamId);
    if (!res.ok) {
      await reply.code(400).send(res);
      return;
    }
    return { ok: true };
  });

  app.post('/api/teams/:teamId/settings', async (req, reply) => {
    const { teamId } = req.params as { teamId: string };
    const body = req.body as { name?: string; kind?: string; colorId?: string | null } | null;
    const res = updateTeamSettings(db, 'web', teamId, {
      ...(body?.name !== undefined ? { name: body.name } : {}),
      ...(body?.kind === 'public' || body?.kind === 'private' ? { kind: body.kind } : {}),
      ...(body?.colorId !== undefined ? { colorId: body.colorId } : {}),
    });
    if (!res.ok) {
      await reply.code(400).send(res);
      return;
    }
    return { ok: true, team: res.value };
  });

  app.post('/api/teams/:teamId/rotate-code', async (req, reply) => {
    const res = rotateJoinCode(db, 'web', (req.params as { teamId: string }).teamId);
    if (!res.ok) {
      await reply.code(400).send(res);
      return;
    }
    return { ok: true, code: res.value };
  });

  app.post('/api/teams/:teamId/remove-member', async (req, reply) => {
    const { teamId } = req.params as { teamId: string };
    const body = req.body as { userId?: string } | null;
    const res = removeMember(db, 'web', teamId, body?.userId ?? '');
    if (!res.ok) {
      await reply.code(400).send(res);
      return;
    }
    return { ok: true };
  });

  app.post('/api/match/preview', async (req, reply) => {
    const res = previewMatch(db, resolveEventId(req, guildOf(req)), getForm(db));
    if (!res.ok) {
      await reply.code(400).send(res);
      return;
    }
    return { ok: true, result: res.value };
  });

app.post('/api/match/commit', async (req) => {
    const eventId = resolveEventId(req, guildOf(req));
    const res = commitMatch(db, 'web', eventId, guildOf(req), getForm(db));
    if (!res.ok) {
      return { ok: false, code: res.code, message: res.message };
    }
    // Provision matched team spaces + roles (parity with the Discord commit flow).
    if (deps.client !== null) {
      const categoryId = getGuildSettings(db, guildOf(req)).teamCategoryId ?? config.teamCategoryId;
      const provisionDeps = { db, client: deps.client, categoryIdFor: () => categoryId ?? undefined };
      const { provisionTeamSpace, grantTeamRole, sendJoinWelcome } = await import('../discord/provision.js');
      const matched = listTeams(db, eventId).filter((t) => t.kind === 'matched');
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
    await deps.announce(guildOf(req), `🏁 **Teams are locked in!**\n\n${lines}`);
    return { ok: true, result: res.value };
  });

  /** Late-signup placement: top-3 team suggestions for one participant (pure read). */
  app.post('/api/match/suggestions', async (req, reply) => {
    const body = req.body as { participantId?: string } | null;
    const participantId = body?.participantId ?? '';
    const eventId = resolveEventId(req, guildOf(req));
    const participant = getParticipant(db, eventId, participantId);
    if (participant === null) {
      await reply.code(404).send({ ok: false, code: 'not_found', message: 'Participant not found in this event.' });
      return;
    }
    if (participant.teamId !== null) {
      await reply.code(400).send({ ok: false, code: 'already_in_team', message: 'Participant is already on a team.' });
      return;
    }
    const suggestions = suggestTeamsForParticipant(participant, listTeamsWithMembers(db, eventId), getForm(db));
    return { ok: true, suggestions };
  });

  /** Lock teams in now: skips future auto-match (manual match runs still allowed). */
app.post('/api/match/lock', async (req) => {
    markMatchLocked(db, resolveEventId(req, guildOf(req)));
    audit(db, 'web', 'match.lock', resolveEventId(req, guildOf(req)), null);
    return { ok: true };
  });

  /** Clear the lock so auto-match can fire again. */
  app.post('/api/match/unlock', async (req) => {
    markMatchUnlocked(db, resolveEventId(req, guildOf(req)));
    audit(db, 'web', 'match.unlock', resolveEventId(req, guildOf(req)), null);
    return { ok: true };
  });

  app.post('/api/form', async (req, reply) => {
    const body = req.body as Partial<FormConfig> | null;
    const res = updateForm(db, 'web', body ?? {});
    if (!res.ok) {
      await reply.code(400).send(res);
      return;
    }
    // Keep the Discord signup panel in sync with the new form config.
    const formGuild = guildOf(req);
    if (deps.client !== null && isSnowflake(formGuild)) {
      void refreshSignupPanel(db, deps.client, formGuild).catch(() => undefined);
    }
    return { ok: true, config: res.value };
  });

  app.post('/api/form/reset', async () => {
    const res = resetForm(db, 'web');
    return { ok: res.ok, config: res.ok ? res.value : undefined };
  });

app.post('/api/event/reset', async (req) => {
    const eventId = resolveEventId(req, guildOf(req));
    const { purgeEventParticipants } = await import('../features/signup/data.js');
    const { deleteEventTeams } = await import('../features/teams/data.js');
    const participants = purgeEventParticipants(db, 'web', eventId);
    const teams = deleteEventTeams(db, 'web', eventId);
    return { ok: true, removed: { participants, teams } };
  });

  app.post('/api/guild/category', async (req) => {
    const body = req.body as { categoryId?: string | null } | null;
    setGuildCategory(db, 'web', guildOf(req), body?.categoryId ?? null);
    return { ok: true };
  });
}
