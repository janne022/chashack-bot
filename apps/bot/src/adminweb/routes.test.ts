import assert from 'node:assert/strict';
import { test } from 'node:test';
import Fastify from 'fastify';
import { makeDiscordToken } from '../features/auth/domain.js';
import { createSession, getSession } from '../features/auth/data.js';
import { openDb } from '../shared/db.js';
import type { Env } from '../shared/env.js';
import { registerRoutes } from './routes.js';

const signingKey = 'test';
const config = {
  adminSessionSecret: signingKey,
  guildId: '11111111111111111',
  skipDiscord: true,
  adminPassword: 'test',
  adminIds: [],
  adminPort: 0,
  discordToken: '',
  clientId: '',
  discordClientSecret: undefined,
  oauthRedirectUri: undefined,
  publicUrl: undefined,
  dbPath: ':memory:',
  announceChannelId: undefined,
  auditChannelId: undefined,
  teamCategoryId: undefined,
  botLanguage: 'en',
} as Env;

test('guild switch refusal awaits authorization and leaves selected guild unchanged', async () => {
  const db = openDb(':memory:');
  const session = await createSession(db, {
    userId: 'user-1',
    username: 'tester',
    avatar: null,
    guilds: [{ id: '11111111111111111', name: 'Allowed', icon: null }],
  });
  const app = Fastify({ logger: false });
  registerRoutes(app, { db, config, announce: async () => undefined, client: null });
  const response = await app.inject({
    method: 'POST',
    url: '/api/auth/guild',
    headers: { cookie: `hacksess=${encodeURIComponent(makeDiscordToken(signingKey, session.id))}` },
    payload: { guildId: '22222222222222222' },
  });
  assert.equal(response.statusCode, 403);
  assert.equal((await getSession(db, session.id))?.selectedGuildId, '11111111111111111');
  await app.close();
  db.close();
});
