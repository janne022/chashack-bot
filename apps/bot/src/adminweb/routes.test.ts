import assert from 'node:assert/strict';
import { test } from 'node:test';
import Fastify from 'fastify';
import { makeDiscordToken } from '../features/auth/domain.js';
import { createSession, getSession } from '../features/auth/data.js';
import { openTestDb } from '../shared/test-db.js';
import type { Env } from '../shared/env.js';
import { registerRoutes } from './routes.js';

const signingKey = 'test-session-signing-key-at-least-32-characters';
const config = {
  adminSessionSecret: signingKey,
  guildId: '11111111111111111',
  skipDiscord: true,
  adminIds: [],
  adminPort: 0,
  discordToken: '',
  clientId: '',
  discordClientSecret: undefined,
  oauthRedirectUri: undefined,
  publicUrl: undefined,
  announceChannelId: undefined,
  auditChannelId: undefined,
  teamCategoryId: undefined,
  botLanguage: 'en',
} as Env;

const sessionCookie = (id: string) => `hacksess=${encodeURIComponent(makeDiscordToken(signingKey, id))}`;

test('guild switch refusal awaits authorization and leaves selected guild unchanged', async () => {
  const db = await openTestDb();
  const session = await createSession(db, {
    userId: 'user-1', username: 'tester', avatar: null,
    guilds: [{ id: '11111111111111111', name: 'Allowed', icon: null }],
  });
  const app = Fastify({ logger: false });
  registerRoutes(app, { db, config, announce: async () => undefined, client: null });
  const response = await app.inject({
    method: 'POST', url: '/api/auth/guild', headers: { cookie: sessionCookie(session.id) },
    payload: { guildId: '22222222222222222' },
  });
  assert.equal(response.statusCode, 403);
  assert.equal((await getSession(db, session.id))?.selectedGuildId, '11111111111111111');
  await app.close();
  await db.close();
});

test('delegated organizer authority is rechecked against current bot membership on every request', async () => {
  const db = await openTestDb();
  const guildId = '11111111111111111';
  const session = await createSession(db, {
    userId: 'delegate-user', username: 'delegate', avatar: null,
    guilds: [{ id: guildId, name: 'Guild', icon: null }],
  });
  await db.run('INSERT INTO guild_settings (guild_id, mod_role_ids, updated_at) VALUES (?, ?, ?)', guildId, JSON.stringify(['delegate-role']), Date.now());
  const roles = new Map([['delegate-role', {}]]);
  const guild = {
    id: guildId, name: 'Guild', ownerId: 'guild-owner',
    members: { fetch: async (userId: string) => ({
      id: userId, permissions: { has: () => false, bitfield: 0n }, roles: { cache: roles },
    }) },
  };
  const client = { guilds: { cache: new Map([[guildId, guild]]), fetch: async () => guild } } as never;
  const app = Fastify({ logger: false });
  registerRoutes(app, { db, config, announce: async () => undefined, client });
  const headers = { cookie: sessionCookie(session.id) };
  assert.equal((await app.inject({ url: '/api/state', headers })).statusCode, 200);
  roles.clear();
  const refused = await app.inject({ url: '/api/state', headers });
  assert.equal(refused.statusCode, 403);
  assert.equal(refused.json().code, 'access_refused');
  await app.close();
  await db.close();
});

test('delegated organizers cannot change delegation, while owner/admin can', async () => {
  const db = await openTestDb();
  const guildId = '11111111111111111';
  await db.run('INSERT INTO guild_settings (guild_id, mod_role_ids, updated_at) VALUES (?, ?, ?)', guildId, JSON.stringify(['delegate-role']), Date.now());
  const makeClient = (ownerId: string, permissions: bigint) => {
    const guild = {
      id: guildId, name: 'Guild', ownerId,
      members: { fetch: async (id: string) => ({ id, permissions: { has: (p: string) => p === 'Administrator' && permissions === 8n, bitfield: permissions }, roles: { cache: new Map([['delegate-role', {}]]) } }) },
    };
    return { guilds: { cache: new Map([[guildId, guild]]), fetch: async () => guild } } as never;
  };
  const app = Fastify({ logger: false });
  registerRoutes(app, { db, config, announce: async () => undefined, client: makeClient('other-owner', 0n) });
  const delegated = await createSession(db, { userId: 'delegate-user', username: 'delegate', avatar: null, guilds: [{ id: guildId, name: 'Guild', icon: null }] });
  const post = (id: string) => app.inject({
    method: 'POST', url: '/api/guild/settings', headers: { cookie: sessionCookie(id) },
    payload: { modRoleIds: ['33333333333333333'] },
  });
  assert.equal((await post(delegated.id)).statusCode, 403);
  await app.close();

  const adminApp = Fastify({ logger: false });
  registerRoutes(adminApp, { db, config, announce: async () => undefined, client: makeClient('other-owner', 8n) });
  const admin = await createSession(db, { userId: 'admin-user', username: 'admin', avatar: null, guilds: [{ id: guildId, name: 'Guild', icon: null }] });
  assert.equal((await adminApp.inject({ method: 'POST', url: '/api/guild/settings', headers: { cookie: sessionCookie(admin.id) }, payload: { modRoleIds: ['33333333333333333'] } })).statusCode, 200);
  await adminApp.close();
  await db.close();
});

test('password requests do not authenticate; callback without state and PKCE is refused', async () => {
  const db = await openTestDb();
  const app = Fastify({ logger: false });
  registerRoutes(app, { db, config: { ...config, clientId: '123456789012345678', discordClientSecret: 'synthetic-client-secret' }, announce: async () => undefined, client: null });
  assert.equal(app.hasRoute({ method: 'POST', url: '/api/login' }), false);
  const callback = await app.inject({ url: '/auth/discord/callback?code=synthetic&state=forged' });
  assert.equal(callback.statusCode, 302);
  assert.match(callback.headers.location ?? '', /auth=bad_state/);
  await app.close();
  await db.close();
});

test('participant identity is isolated from organizer APIs and registrations are subject-scoped', async () => {
  const db = await openTestDb();
  const session = await createSession(db, {
    userId: 'subject-user', username: 'Subject', avatar: null, guilds: [], audience: 'participant',
  });
  await db.run("INSERT INTO events (id, guild_id, name, description, status, created_at, updated_at) VALUES (?, ?, ?, ?, 'active', ?, ?)", 'event-a', 'guild-a', 'Event A', 'Public description', Date.now(), Date.now());
  for (const userId of ['subject-user', 'other-user']) {
    await db.run(
      "INSERT INTO participants (event_id, user_id, guild_id, display_name, experience, role_track, skills, team_pref, teammates, status, created_at, updated_at) VALUES (?, ?, ?, ?, '', '', '[]', '', '[]', 'active', ?, ?)",
      'event-a', userId, 'guild-a', userId, Date.now(), Date.now(),
    );
  }
  const app = Fastify({ logger: false });
  registerRoutes(app, { db, config, announce: async () => undefined, client: null });
  const cookie = `hackpartsess=${encodeURIComponent(makeDiscordToken(signingKey, session.id, Date.now(), 'participant'))}`;
  const me = await app.inject({ url: '/api/participant/me', headers: { cookie } });
  assert.deepEqual(me.json(), { user: { id: 'subject-user', username: 'Subject', avatar: null } });
  const registrations = await app.inject({ url: '/api/participant/registrations?userId=other-user&guildId=foreign', headers: { cookie } });
  assert.deepEqual(registrations.json().registrations, [{
    eventId: 'event-a', name: 'Event A', description: 'Public description',
    startsAt: null, endsAt: null, status: 'active', teamId: null,
  }]);
  assert.equal((await app.inject({ url: '/api/state', headers: { cookie } })).statusCode, 401);
  await app.close();
  await db.close();
});


test('foreign Origin is rejected for session-changing requests', async () => {
  const db = await openTestDb();
  const session = await createSession(db, { userId: 'user-1', username: 'tester', avatar: null, guilds: [] });
  const app = Fastify({ logger: false });
  registerRoutes(app, { db, config, announce: async () => undefined, client: null });
  const response = await app.inject({
    method: 'POST', url: '/api/auth/logout', headers: { cookie: sessionCookie(session.id), origin: 'https://attacker.invalid', host: 'console.example.test' },
  });
  assert.equal(response.statusCode, 403);
  assert.equal(response.json().error, 'origin_mismatch');
  await app.close();
  await db.close();
});
