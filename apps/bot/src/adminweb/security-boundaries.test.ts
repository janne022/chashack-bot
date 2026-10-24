import assert from 'node:assert/strict';
import { test } from 'node:test';
import Fastify from 'fastify';
import { registerRoutes } from './routes.js';
import { mutationBodyError } from './validation.js';
import { openTestDb } from '../shared/test-db.js';
import { createSession, getSession } from '../features/auth/data.js';
import { makeDiscordToken, makeParticipantState, participantStateReturn, participantReturnPath } from '../features/auth/domain.js';
import type { Env } from '../shared/env.js';

const secret = 'synthetic-fixture-signing-material-32-plus'; // g0:allow:secrets t_33947af2 - synthetic test signing material and API paths only
const config = { adminSessionSecret: secret, clientId: '', skipDiscord: true, publicUrl: 'https://console.example.test' } as Env;
const cookie = (id: string, audience: 'organizer' | 'participant') => `${audience === 'participant' ? 'hackpartsess' : 'hacksess'}=${makeDiscordToken(secret, id, Date.now(), audience)}`;

test('OAuth return destinations are allowlisted, authenticated and expire', () => {
  for (const value of ['https://evil.test', '//evil.test', '/\\evil', '/events/%2f%2fevil/signup', '/events/a/signup?next=https://evil.test']) assert.equal(participantReturnPath(value), '/my-hackathons');
  const state = makeParticipantState(secret, '/events/ev_123/signup', 100); // g0:allow:secrets t_33947af2 - synthetic test signing material and API paths only
  assert.equal(participantStateReturn(secret, state, 101), '/events/ev_123/signup'); // g0:allow:secrets t_33947af2 - synthetic test signing material and API paths only
  assert.equal(participantStateReturn(secret, `${state}x`, 101), null);
  assert.equal(participantStateReturn('different secret', state, 101), null);
  assert.equal(participantStateReturn(secret, state, 600_101), null);
});

test('runtime shape validation rejects malformed and unbounded mutation fields', () => {
  for (const body of [[], 3, { name: {} }, { startsAt: 'tomorrow' }, { startsAt: Infinity }, { dm: 'true' }, { schedule: {} }, { rows: Array(1001).fill({}) }, JSON.parse('{"__proto__":{}}')]) assert.notEqual(mutationBodyError(body), null);
  assert.equal(mutationBodyError({ name: 'Hackathon', endsAt: null, dm: false, schedule: [] }), null);
});

test('participant logout revokes its row, logout-all revokes both audiences only for self', async (t) => {
  const db = await openTestDb(); const app = Fastify();
  t.after(async () => { await app.close(); await db.close(); });
  registerRoutes(app, { db, config, client: null, announce: async () => undefined });
  const input = { userId: 'subject', username: 'Subject', avatar: null, guilds: [] };
  const p = await createSession(db, { ...input, audience: 'participant' });
  const o = await createSession(db, input);
  const other = await createSession(db, { ...input, userId: 'other' });
  const logout = await app.inject({ method: 'POST', url: '/api/participant/logout', headers: { cookie: cookie(p.id, 'participant'), origin: config.publicUrl! } });
  assert.equal(logout.statusCode, 200);
  assert.equal(logout.headers['cache-control'], 'no-store');
  assert.equal(await getSession(db, p.id), null);
  assert.match(String(logout.headers['set-cookie']), /hackpartsess=.*Max-Age=0/);
  assert.equal((await app.inject({ url: '/api/participant/me', headers: { cookie: cookie(p.id, 'participant') } })).statusCode, 401);
  const p2 = await createSession(db, { ...input, audience: 'participant' });
  assert.equal((await app.inject({ method: 'POST', url: '/api/participant/logout-all', headers: { cookie: cookie(p2.id, 'participant') } })).statusCode, 200); // g0:allow:secrets t_33947af2 - synthetic test signing material and API paths only
  assert.equal(await getSession(db, p2.id), null); assert.equal(await getSession(db, o.id), null);
  assert.notEqual(await getSession(db, other.id), null);
});

test('wrong scheme and cross-site metadata cannot revoke a session; malformed cookies are unauthorized', async (t) => {
  const db = await openTestDb(); const app = Fastify();
  t.after(async () => { await app.close(); await db.close(); });
  registerRoutes(app, { db, config, client: null, announce: async () => undefined });
  const session = await createSession(db, { userId: 'subject', username: 'Subject', avatar: null, guilds: [], audience: 'participant' });
  for (const headers of [{ origin: 'http://console.example.test' }, { 'sec-fetch-site': 'cross-site' }]) {
    const response = await app.inject({ method: 'POST', url: '/api/participant/logout', headers: { ...headers, cookie: cookie(session.id, 'participant') } });
    assert.equal(response.statusCode, 403); assert.notEqual(await getSession(db, session.id), null);
  }
  assert.equal((await app.inject({ url: '/api/participant/me', headers: { cookie: 'hackpartsess=%XX' } })).statusCode, 401);
});

test('authenticated expensive reads are denied before fresh Discord lookups', async (t) => {
  const db = await openTestDb(); const app = Fastify();
  t.after(async () => { await app.close(); await db.close(); });
  const guildId = '11111111111111111'; let lookups = 0;
  const guild = { id: guildId, ownerId: 'owner', members: { fetch: async () => { lookups++; return { permissions: { has: () => true, bitfield: 8n }, roles: { cache: new Map() } }; }, search: async () => new Map() } };
  registerRoutes(app, { db, config, announce: async () => undefined, client: { guilds: { cache: new Map([[guildId, guild]]), fetch: async () => guild } } as never });
  const session = await createSession(db, { userId: 'owner', username: 'Owner', avatar: null, guilds: [{ id: guildId, name: 'Test', icon: null }] });
  const headers = { cookie: cookie(session.id, 'organizer') };
  for (let i = 0; i < 5; i++) assert.equal((await app.inject({ url: '/api/guild/members?query=Test', headers })).statusCode, 200);
  const before = lookups;
  const denied = await app.inject({ url: '/api/guild/members?query=Other', headers });
  assert.equal(denied.statusCode, 429); assert.equal(lookups, before); assert.ok(denied.headers['retry-after']);
});
