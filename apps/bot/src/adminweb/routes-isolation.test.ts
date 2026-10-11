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
  db.prepare(`INSERT INTO participants (event_id, user_id, guild_id, display_name, experience, role_track, skills, team_pref, teammates, status, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(eventA.value.id, 'participant-a', guildA, 'A participant', 'veteran', 'backend', '[]', 'random_team', '[]', 'blocked', 1, 1);
  const foreignSignup = await app.inject({ method: 'POST', url: `/api/participants/participant-a/status?eventId=${eventA.value.id}`, headers: { cookie: `hacksess=${encodeURIComponent(makeDiscordToken(secret, sessionB.id))}` }, payload: { action: 'reactivate' } });
  assert.equal(foreignSignup.statusCode, 404);
  assert.equal((db.prepare('SELECT status FROM participants WHERE user_id = ?').get('participant-a') as { status: string }).status, 'blocked');
  db.prepare('INSERT INTO event_templates (id, guild_id, name, kind, json, created_at) VALUES (?, ?, ?, ?, ?, ?)').run('template-a', guildA, 'A form', 'form', '{}', Date.now());
  const eventCountBefore = (db.prepare('SELECT count(*) AS count FROM events').get() as { count: number }).count;
  const foreignTemplate = await app.inject({ method: 'POST', url: '/api/events', headers: { cookie: `hacksess=${encodeURIComponent(makeDiscordToken(secret, sessionB.id))}` }, payload: { name: 'B attempted clone', formTemplateId: 'template-a' } });
  assert.equal(foreignTemplate.statusCode, 404);
  assert.equal((db.prepare('SELECT count(*) AS count FROM events').get() as { count: number }).count, eventCountBefore);
  db.prepare('INSERT INTO event_templates (id, guild_id, name, kind, json, created_at) VALUES (?, NULL, ?, ?, ?, ?)').run('host-template', 'Host default', 'form', '{}', Date.now());
  const templateList = await app.inject({ method: 'GET', url: '/api/templates', headers: { cookie: `hacksess=${encodeURIComponent(makeDiscordToken(secret, sessionB.id))}` } });
  assert.equal(templateList.statusCode, 200);
  assert.equal(templateList.json().templates.some((template: { id: string }) => template.id === 'host-template'), true);
  assert.equal(templateList.json().templates.some((template: { id: string }) => template.id === 'template-a'), false);
  const hostClone = await app.inject({ method: 'POST', url: '/api/events', headers: { cookie: `hacksess=${encodeURIComponent(makeDiscordToken(secret, sessionB.id))}` }, payload: { name: 'B host-template clone', formTemplateId: 'host-template' } });
  assert.equal(hostClone.statusCode, 200);
  assert.equal((db.prepare('SELECT guild_id FROM events WHERE id = ?').get(hostClone.json().event.id) as { guild_id: string }).guild_id, guildB);
  for (const method of ['PATCH', 'DELETE'] as const) {
    const response = await app.inject({ method, url: '/api/templates/host-template', headers: { cookie: `hacksess=${encodeURIComponent(makeDiscordToken(secret, sessionB.id))}` }, payload: { name: 'stolen' } });
    assert.equal(response.statusCode, 404);
  }
  assert.equal((db.prepare('SELECT name FROM event_templates WHERE id = ?').get('host-template') as { name: string }).name, 'Host default');
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
