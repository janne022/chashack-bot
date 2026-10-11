import assert from 'node:assert/strict';
import { test } from 'node:test';
import Fastify from 'fastify';
import { makeDiscordToken } from '../features/auth/domain.js';
import { createSession } from '../features/auth/data.js';
import { createEvent } from '../features/events/data.js';
import { openDb } from '../shared/db.js';
import type { Env } from '../shared/env.js';
import { registerRoutes } from './routes.js';

const secret = 'test';
const config = {
  adminSessionSecret: secret, guildId: '11111111111111111', skipDiscord: true,
  adminPassword: 'test', adminIds: [], adminPort: 0, discordToken: '', clientId: '',
  discordClientSecret: undefined, oauthRedirectUri: undefined, publicUrl: undefined,
  dbPath: ':memory:', announceChannelId: undefined, auditChannelId: undefined,
  teamCategoryId: undefined, botLanguage: 'en',
} as Env;

test('two guild handlers isolate default form and audit IDs', async () => {
  const db = openDb(':memory:');
  const guildA = '11111111111111111';
  const guildB = '22222222222222222';
  const eventA = await createEvent(db, 'test', guildA, { name: 'A event' });
  const eventB = await createEvent(db, 'test', guildB, { name: 'B event' });
  assert.ok(eventA.ok && eventB.ok);
  const sessionA = await createSession(db, { userId: 'a', username: 'a', avatar: null, guilds: [{ id: guildA, name: 'A', icon: null }] });
  const sessionB = await createSession(db, { userId: 'b', username: 'b', avatar: null, guilds: [{ id: guildB, name: 'B', icon: null }] });
  const app = Fastify({ logger: false });
  registerRoutes(app, { db, config, announce: async () => undefined, client: null });
  const injectState = (sessionId: string) => app.inject({ url: '/api/state', headers: { cookie: `hacksess=${encodeURIComponent(makeDiscordToken(secret, sessionId))}` } });
  const stateA = await injectState(sessionA.id);
  const stateB = await injectState(sessionB.id);
  const bodyA = stateA.json();
  const bodyB = stateB.json();
  assert.equal(stateA.statusCode, 200);
  assert.equal(stateB.statusCode, 200);
  assert.equal(bodyA.events.some((event: { id: string }) => event.id === eventB.value.id), false);
  assert.equal(bodyB.events.some((event: { id: string }) => event.id === eventA.value.id), false);
  assert.equal(bodyA.audit.some((entry: { target: string }) => entry.target === eventB.value.id), false);
  assert.equal(bodyB.audit.some((entry: { target: string }) => entry.target === eventA.value.id), false);
  db.prepare('INSERT INTO teams (id, event_id, guild_id, name, kind, created_at) VALUES (?, ?, ?, ?, ?, ?)').run('team-a', eventA.value.id, guildA, 'A team', 'open', Date.now());
  const foreignForm = await app.inject({ method: 'POST', url: `/api/events/${eventA.value.id}/form`, headers: { cookie: `hacksess=${encodeURIComponent(makeDiscordToken(secret, sessionB.id))}` }, payload: { formJson: JSON.stringify({ title: 'forged' }) } });
  assert.equal(foreignForm.statusCode, 404);
  const foreignEnd = await app.inject({ method: 'POST', url: `/api/events/${eventA.value.id}/end`, headers: { cookie: `hacksess=${encodeURIComponent(makeDiscordToken(secret, sessionB.id))}` } });
  assert.equal(foreignEnd.statusCode, 404);
  const foreignTeam = await app.inject({ method: 'POST', url: '/api/teams/team-a/delete', headers: { cookie: `hacksess=${encodeURIComponent(makeDiscordToken(secret, sessionB.id))}` } });
  assert.equal(foreignTeam.statusCode, 404);
  assert.equal((db.prepare('SELECT status FROM events WHERE id = ?').get(eventA.value.id) as { status: string }).status, 'draft');
  assert.equal((db.prepare('SELECT count(*) AS count FROM teams WHERE id = ?').get('team-a') as { count: number }).count, 1);
  const update = (sessionId: string, title: string) => app.inject({
    method: 'POST', url: '/api/form',
    headers: { cookie: `hacksess=${encodeURIComponent(makeDiscordToken(secret, sessionId))}` },
    payload: { title },
  });
  assert.equal((await update(sessionA.id, 'Guild A sentinel')).statusCode, 200);
  assert.equal((await update(sessionB.id, 'Guild B form')).statusCode, 200);
  assert.equal((await (await injectState(sessionA.id)).json()).config.title, 'Guild A sentinel');
  assert.equal((await (await injectState(sessionB.id)).json()).config.title, 'Guild B form');
  const resetB = await app.inject({ method: 'POST', url: '/api/form/reset', headers: { cookie: `hacksess=${encodeURIComponent(makeDiscordToken(secret, sessionB.id))}` } });
  assert.equal(resetB.statusCode, 200);
  assert.equal((await (await injectState(sessionA.id)).json()).config.title, 'Guild A sentinel');
  await app.close();
  db.close();
});
