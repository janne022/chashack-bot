import assert from 'node:assert/strict';
import { test } from 'node:test';
import Fastify from 'fastify';
import { makeDiscordToken } from '../features/auth/domain.js';
import { createSession } from '../features/auth/data.js';
import { createEvent } from '../features/events/data.js';
import { openTestDb } from '../shared/test-db.js';
import type { Env } from '../shared/env.js';
import { registerRoutes } from './routes.js';

const secret = 'test';
const config = {
  adminSessionSecret: secret, guildId: '11111111111111111', skipDiscord: true,
  adminPassword: 'test', adminIds: [], adminPort: 0, discordToken: '', clientId: '',
  discordClientSecret: undefined, oauthRedirectUri: undefined, publicUrl: undefined,
  announceChannelId: undefined, auditChannelId: undefined,
  teamCategoryId: undefined, botLanguage: 'en',
} as Env;

test('two guild handlers isolate default form and audit IDs', async (t) => {
  const db = await openTestDb();
  const guildA = '11111111111111111';
  const guildB = '22222222222222222';
  const eventA = await createEvent(db, 'test', guildA, { name: 'A event' });
  const eventB = await createEvent(db, 'test', guildB, { name: 'B event' });
  assert.ok(eventA.ok && eventB.ok);
  const sessionA = await createSession(db, { userId: 'a', username: 'a', avatar: null, guilds: [{ id: guildA, name: 'A', icon: null }] });
  const sessionB = await createSession(db, { userId: 'b', username: 'b', avatar: null, guilds: [{ id: guildB, name: 'B', icon: null }] });
  const app = Fastify({ logger: false });
  t.after(async () => { await app.close(); await db.close(); });
  let announcements = 0;
  registerRoutes(app, { db, config, announce: async () => { announcements++; }, client: null });
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
  await db.run('INSERT INTO teams (id, event_id, guild_id, name, kind, created_at) VALUES (?, ?, ?, ?, ?, ?)', 'team-a', eventA.value.id, guildA, 'A team', 'open', Date.now());
  const foreignForm = await app.inject({ method: 'POST', url: `/api/events/${eventA.value.id}/form`, headers: { cookie: `hacksess=${encodeURIComponent(makeDiscordToken(secret, sessionB.id))}` }, payload: { formJson: JSON.stringify({ title: 'forged' }) } });
  assert.equal(foreignForm.statusCode, 404);
  const foreignEnd = await app.inject({ method: 'POST', url: `/api/events/${eventA.value.id}/end`, headers: { cookie: `hacksess=${encodeURIComponent(makeDiscordToken(secret, sessionB.id))}` } });
  assert.equal(foreignEnd.statusCode, 404);
  const foreignTeam = await app.inject({ method: 'POST', url: '/api/teams/team-a/delete', headers: { cookie: `hacksess=${encodeURIComponent(makeDiscordToken(secret, sessionB.id))}` } });
  assert.equal(foreignTeam.statusCode, 404);
  assert.equal((await db.get('SELECT status FROM events WHERE id = ?', eventA.value.id))?.status, 'draft');
  assert.equal((await db.get('SELECT count(*) AS count FROM teams WHERE id = ?', 'team-a'))?.count, 1);
  await db.run(`INSERT INTO participants (event_id, user_id, guild_id, display_name, experience, role_track, skills, team_pref, teammates, status, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, eventA.value.id, 'participant-a', guildA, 'A participant', 'veteran', 'backend', '[]', 'random_team', '[]', 'blocked', 1, 1);
  const foreignSignup = await app.inject({ method: 'POST', url: `/api/participants/participant-a/status?eventId=${eventA.value.id}`, headers: { cookie: `hacksess=${encodeURIComponent(makeDiscordToken(secret, sessionB.id))}` }, payload: { action: 'reactivate' } });
  assert.equal(foreignSignup.statusCode, 404);
  assert.equal((await db.get('SELECT status FROM participants WHERE user_id = ?', 'participant-a'))?.status, 'blocked');
  await db.run('INSERT INTO event_templates (id, guild_id, name, kind, json, created_at) VALUES (?, ?, ?, ?, ?, ?)', 'template-a', guildA, 'A form', 'form', '{}', Date.now());
  const eventCountBefore = (await db.get('SELECT count(*) AS count FROM events'))?.count;
  const foreignTemplate = await app.inject({ method: 'POST', url: '/api/events', headers: { cookie: `hacksess=${encodeURIComponent(makeDiscordToken(secret, sessionB.id))}` }, payload: { name: 'B attempted clone', formTemplateId: 'template-a' } });
  assert.equal(foreignTemplate.statusCode, 404);
  assert.equal((await db.get('SELECT count(*) AS count FROM events'))?.count, eventCountBefore);
  await db.run('INSERT INTO event_templates (id, guild_id, name, kind, json, created_at) VALUES (?, NULL, ?, ?, ?, ?)', 'host-template', 'Host default', 'form', '{}', Date.now());
  const templateList = await app.inject({ method: 'GET', url: '/api/templates', headers: { cookie: `hacksess=${encodeURIComponent(makeDiscordToken(secret, sessionB.id))}` } });
  assert.equal(templateList.statusCode, 200);
  assert.equal(templateList.json().templates.some((template: { id: string }) => template.id === 'host-template'), true);
  assert.equal(templateList.json().templates.some((template: { id: string }) => template.id === 'template-a'), false);
  const hostClone = await app.inject({ method: 'POST', url: '/api/events', headers: { cookie: `hacksess=${encodeURIComponent(makeDiscordToken(secret, sessionB.id))}` }, payload: { name: 'B host-template clone', formTemplateId: 'host-template' } });
  assert.equal(hostClone.statusCode, 200);
  assert.equal((await db.get('SELECT guild_id FROM events WHERE id = ?', hostClone.json().event.id))?.guild_id, guildB);
  for (const method of ['PATCH', 'DELETE'] as const) {
    const response = await app.inject({ method, url: '/api/templates/host-template', headers: { cookie: `hacksess=${encodeURIComponent(makeDiscordToken(secret, sessionB.id))}` }, payload: { name: 'stolen' } });
    assert.equal(response.statusCode, 404);
  }
  assert.equal((await db.get('SELECT name FROM event_templates WHERE id = ?', 'host-template'))?.name, 'Host default');
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
  // Exercise the actual registered handlers, not just the preHandler helper.
  const headers = { cookie: `hacksess=${encodeURIComponent(makeDiscordToken(secret, sessionB.id))}` };
  const snapshot = () => Promise.all(['events', 'teams', 'participants', 'team_requests', 'event_templates', 'audit_log']
    .map((table) => db.all(`SELECT * FROM ${table} ORDER BY 1`)));
  const denied = async (method: 'POST' | 'PATCH' | 'DELETE', url: string, payload: Record<string, unknown> = {}) => {
    const before = await snapshot();
    const response = await app.inject({ method, url, headers, payload });
    assert.equal(response.statusCode, 404, `${method} ${url}: ${response.body}`);
    assert.deepEqual(await snapshot(), before, `${method} ${url} changed persisted rows`);
    assert.equal(announcements, 0, `${method} ${url} emitted an announcement`);
  };
  await t.test('foreign path locators refuse every event and team mutation without side effects', async () => {
    for (const suffix of ['activate', 'schedule-itinerary', 'end', 'panel', 'discord-events', 'form']) {
      await denied('POST', `/api/events/${eventA.value.id}/${suffix}`, { channelId: 'channel-a', formJson: '{}' });
    }
    await denied('PATCH', `/api/events/${eventA.value.id}`, { name: 'forged event' });
    for (const suffix of ['delete', 'settings', 'rotate-code', 'remove-member']) {
      await denied('POST', `/api/teams/team-a/${suffix}`, { name: 'forged team', userId: 'participant-a' });
    }
    await denied('PATCH', '/api/templates/template-a', { name: 'forged template' });
    await denied('DELETE', '/api/templates/template-a');
  });
  await t.test('foreign query and body event locators refuse participant, team, matching and reset handlers', async () => {
    const cases: [string, Record<string, unknown>][] = [
      ['/api/participants/participant-a/status', { action: 'reactivate' }],
      ['/api/participants/participant-a/team', { teamId: null }],
      ['/api/teams', { name: 'forged team', kind: 'public' }],
      ['/api/match/preview', {}], ['/api/match/commit', {}],
      ['/api/match/' + 'suggestions', {
        participantId: 'participant-a',
      }],
      ['/api/match/lock', {}], ['/api/match/unlock', {}], ['/api/event/reset', {}],
      ['/api/templates', { name: 'forged clone', kind: 'event' }],
      ['/api/events/announce', { title: 'forged', message: 'foreign event' }],
    ];
    for (const [url, payload] of cases) {
      await denied('POST', `${url}?eventId=${eventA.value.id}`, { ...payload, eventId: eventA.value.id });
      await denied('POST', url, { ...payload, eventId: eventA.value.id });
    }
    await denied('POST', '/api/participants/participant-a/team', { eventId: eventB.value.id, teamId: 'team-a' });
    await denied('POST', '/api/events', { name: 'forged clone', templateId: 'template-a' });
  });
  await t.test('own-guild query locators cannot mask foreign body targets', async () => {
    await denied('POST', `/api/events/announce?eventId=${eventB.value.id}`, {
      eventId: eventA.value.id, title: 'forged', message: 'foreign event',
    });
    await db.run('INSERT INTO teams (id, event_id, guild_id, name, kind, created_at) VALUES (?, ?, ?, ?, ?, ?)',
      'team-b', eventB.value.id, guildB, 'B team', 'open', Date.now());
    await denied('POST', '/api/participants/participant-a/team?teamId=team-b', {
      eventId: eventB.value.id, teamId: 'team-a',
    });
    await denied('POST', '/api/events?templateId=host-template', {
      name: 'forged clone', formTemplateId: 'template-a',
    });
  });
});
