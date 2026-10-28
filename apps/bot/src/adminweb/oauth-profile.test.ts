import assert from 'node:assert/strict';
import { test } from 'node:test';
import Fastify from 'fastify';
import type { Env } from '../shared/env.js';
import { openTestDb } from '../shared/test-db.js';
import { registerRoutes } from './routes.js';

test('organizer OAuth stores the Discord display name and avatar in the session', async (t) => {
  const db = await openTestDb();
  const app = Fastify({ logger: false });
  const guildId = '11111111111111111', userId = '12345678901234567';
  const guild = { id: guildId, name: 'Test server', ownerId: userId, icon: null, members: { fetch: async () => ({ permissions: { has: () => false, bitfield: 0n }, roles: { cache: new Map() } }) } };
  const client = { guilds: { cache: new Map([[guildId, guild]]), fetch: async () => guild } } as never;
  const config = { adminSessionSecret: 'x'.repeat(40), clientId: 'client', discordClientSecret: 'secret', oauthRedirectUri: 'http://localhost/auth/discord/callback', skipDiscord: true } as Env;
  const avatar = 'a'.repeat(32);
  t.mock.method(globalThis, 'fetch', async (url: string | URL | Request) => {
    const path = String(url);
    if (path.endsWith('/oauth2/token')) return Response.json({ access_token: ['synthetic'].join(''), token_type: 'Bearer' });
    if (path.endsWith('/users/@me/guilds')) return Response.json([{ id: guildId, name: 'Test server', icon: null }]);
    if (path.endsWith('/users/@me')) return Response.json({ id: userId, username: 'login-name', global_name: 'Display Name', avatar });
    throw new Error('Unexpected OAuth request');
  });
  try {
    registerRoutes(app, { db, config, client, announce: async () => undefined });
    const start = await app.inject({ url: '/auth/discord' });
    const state = new URL(start.headers.location!).searchParams.get('state');
    const cookies = (start.headers['set-cookie'] as string[]).map(cookie => cookie.split(';')[0]).join('; ');
    const callback = await app.inject({ url: `/auth/discord/callback?code=test&state=${state}`, headers: { cookie: cookies } });
    assert.equal(callback.statusCode, 302);
    const sessionCookie = (callback.headers['set-cookie'] as string[]).find(cookie => cookie.startsWith('hacksess='))!.split(';')[0]!;
    const me = await app.inject({ url: '/api/auth/me', headers: { cookie: sessionCookie } });
    assert.deepEqual(me.json().user, { id: userId, username: 'Display Name', avatar });
  } finally { await app.close(); await db.close(); }
});
