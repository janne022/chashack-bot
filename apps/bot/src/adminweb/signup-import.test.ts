import assert from 'node:assert/strict';
import test from 'node:test';
import Fastify from 'fastify';
import { makeDiscordToken } from '../features/auth/domain.js';
import { createSession } from '../features/auth/data.js';
import { createEvent } from '../features/events/data.js';
import { openTestDb } from '../shared/test-db.js';
import { withGuildContext } from '../shared/postgres.js';
import type { Env } from '../shared/env.js';
import { registerRoutes } from './routes.js';

const secret = 'x'.repeat(48);
const guildId = '11111111111111111';

test('organizer preview is read-only; confirmed rows persist and only a verified member can activate them', async () => {
  const db = await openTestDb();
  const session = await createSession(db, { userId: '99999999999999999', username: 'Organizer', avatar: null, guilds: [{ id: guildId, name: 'Guild', icon: null }] });
  const guild = {
    id: guildId, name: 'Guild', ownerId: session.userId,
    members: { fetch: async (id: string | { user: string }) => {
      if (typeof id === 'string' && id === '22345678901234567') throw new Error('Unknown Member');
      return { id: typeof id === 'string' ? id : id.user, permissions: { has: () => false, bitfield: 0n }, roles: { cache: new Map() } };
    } },
  };
  const client = { guilds: { cache: new Map([[guildId, guild]]), fetch: async () => guild } } as never;
  const app = Fastify({ logger: false });
  registerRoutes(app, { db, config: { adminSessionSecret: secret, adminIds: [], botLanguage: 'en' } as unknown as Env, client, announce: async () => undefined });
  const headers = { cookie: `hacksess=${encodeURIComponent(makeDiscordToken(secret, session.id))}` };
  try {
    const created = await withGuildContext(db, guildId, () => createEvent(db, 'test', guildId, { name: 'Import API test', form: { version: 1, title: 'T', description: '', teamSize: 4, experiences: [], roleTracks: [], skills: [], teamPrefs: [], customQuestions: [{ id: 'diet', kind: 'text', label: { en: 'Diet' }, help: { en: '' }, required: true, presentation: 'web', visibility: 'self_and_organizer' }] } }));
    assert.equal(created.ok, true);
    if (!created.ok) return;
    const eventId = created.value.id;
    const preview = await app.inject({ method: 'POST', url: `/api/events/${eventId}/signup-import/preview`, headers, payload: { csv: 'Timestamp,Name,Chas email,Dietary\r\n"31 Oct",Synthetic,Ada@example.test,""', mapping: { Dietary: 'diet' } } });
    assert.equal(preview.statusCode, 200, preview.body);
    assert.equal((await withGuildContext(db, guildId, () => db.get('SELECT id FROM imported_signups WHERE event_id=?', eventId))), undefined);
    assert.equal(preview.json().rows[0].values.name, 'Synthetic');
    const swedishPreview = await app.inject({ method: 'POST', url: `/api/events/${eventId}/signup-import/preview`, headers, payload: { csv: 'Tidstämpel,Ditt namn och klass,Din Chas-mail,Har du några allergier vi ska ta hänsyn till när vi köper fika?,Hur vill du delta i Hackoween?,Vilket område vill du helst jobba med under Hackatonet?\n2026-10-16,Ada,ada@example.test,Nej,Jag vill bli tilldelad en grupp,Backend' } });
    assert.equal(swedishPreview.statusCode, 200, swedishPreview.body);
    assert.deepEqual(swedishPreview.json().suggestedMapping, { Tidstämpel: 'sourceTimestamp', 'Ditt namn och klass': 'name', 'Din Chas-mail': 'email', 'Har du några allergier vi ska ta hänsyn till när vi köper fika?': 'allergies', 'Hur vill du delta i Hackoween?': 'teamPref', 'Vilket område vill du helst jobba med under Hackatonet?': 'skills' });
    const fullSwedishHeader = 'Tidstämpel,Ditt namn och klass,Din Chas-mail,Har du några allergier vi ska ta hänsyn till när vi köper fika?,Hur vill du delta i Hackoween?,Hur många är ni i er grupp?,Gruppnamn för dig som anmäler en färdig grupp,Namn på medlemmarna i gruppen,Vilket område vill du helst jobba med under Hackatonet?';
    const fullSwedish = await app.inject({ method: 'POST', url: `/api/events/${eventId}/signup-import/preview`, headers, payload: { csv: `${fullSwedishHeader}${String.fromCharCode(10)}2026-10-16,Ada,ada@example.test,Nej,random_team,2,Group A,Member A; Member B,frontend_react` } });
    assert.deepEqual(fullSwedish.json().suggestedMapping, { Tidstämpel: 'sourceTimestamp', 'Ditt namn och klass': 'name', 'Din Chas-mail': 'email', 'Har du några allergier vi ska ta hänsyn till när vi köper fika?': 'allergies', 'Hur vill du delta i Hackoween?': 'teamPref', 'Hur många är ni i er grupp?': 'groupSize', 'Gruppnamn för dig som anmäler en färdig grupp': 'groupName', 'Namn på medlemmarna i gruppen': 'members', 'Vilket område vill du helst jobba med under Hackatonet?': 'skills' });
    assert.equal(fullSwedish.json().rows[0].values['source:Vilket område vill du helst jobba med under Hackatonet?'], 'frontend_react');
    const row = preview.json().rows[0];
    const saved = await app.inject({ method: 'POST', url: `/api/events/${eventId}/signup-import`, headers, payload: { rows: [{ sourceRow: row.rowNumber, values: row.values, answers: row.answers }] } });
    assert.equal(saved.statusCode, 200, saved.body);
    const id = saved.json().rows[0].id;
    await withGuildContext(db, guildId, () => db.run("UPDATE events SET status='active' WHERE id=?", eventId));
    const incomplete = await app.inject({ method: 'PATCH', url: `/api/events/${eventId}/imported-signups/${id}`, headers, payload: { linkDiscordUserId: '12345678901234567' } });
    assert.equal(incomplete.statusCode, 200, incomplete.body);
    assert.deepEqual(incomplete.json().missingFields, ['diet']);
    assert.equal((await withGuildContext(db, guildId, () => db.get('SELECT user_id FROM participants WHERE event_id=?', eventId))), undefined);
    const linked = await app.inject({ method: 'PATCH', url: `/api/events/${eventId}/imported-signups/${id}`, headers, payload: { answers: { diet: 'vegetarian' }, linkDiscordUserId: '12345678901234567' } });
    assert.equal(linked.statusCode, 200, linked.body);
    assert.equal(linked.json().activated, true);
    assert.equal((await withGuildContext(db, guildId, () => db.get<{ user_id: string }>('SELECT user_id FROM participants WHERE event_id=?', eventId)))?.user_id, '12345678901234567');
    const beforeFailedLink = await withGuildContext(db, guildId, () => db.get<{ values_json: string; answers_json: string; discord_username: string | null }>('SELECT values_json,answers_json,discord_username FROM imported_signups WHERE id=?', id));
    const failedLink = await app.inject({ method: 'PATCH', url: `/api/events/${eventId}/imported-signups/${id}`, headers, payload: { values: { name: 'Must roll back' }, answers: { diet: 'changed' }, linkDiscordUserId: '22345678901234567' } });
    assert.equal(failedLink.statusCode, 400, failedLink.body);
    assert.deepEqual(await withGuildContext(db, guildId, () => db.get('SELECT values_json,answers_json,discord_username FROM imported_signups WHERE id=?', id)), beforeFailedLink);
    const foreignUrl = ['/api/events/', 'missing', '/imported-signups'].join('');
    const foreign = await app.inject({ method: 'GET', url: foreignUrl, headers });
    assert.equal(foreign.statusCode, 200);
    assert.deepEqual(foreign.json().records, []);
    const secondEvent = await withGuildContext(db, '22222222222222222', () => createEvent(db, 'test', '22222222222222222', { name: 'Other tenant' }));
    assert.equal(secondEvent.ok, true);
    if (secondEvent.ok) {
      const secondRow = await withGuildContext(db, '22222222222222222', () => db.run(`INSERT INTO imported_signups (id,event_id,guild_id,source_row,source_timestamp,form_version,values_json,answers_json,created_at,updated_at)
        VALUES (?,?,?,?,?,?,?,?,?,?)`, 'foreign-import', secondEvent.value.id, '22222222222222222', 2, '', 1, JSON.stringify({ name: 'Private foreign row' }), '{}', Date.now(), Date.now()));
      assert.equal(secondRow.changes, 1);
      const foreignPreview = await app.inject({ method: 'POST', url: `/api/events/${secondEvent.value.id}/signup-import/preview`, headers, payload: { csv: 'Name\nNope' } });
      assert.equal(foreignPreview.statusCode, 404);
      const foreignPatch = await app.inject({ method: 'PATCH', url: `/api/events/${secondEvent.value.id}/imported-signups/foreign-import`, headers, payload: { values: { name: 'Tampered' } } });
      assert.equal(foreignPatch.statusCode, 404);
      assert.equal((await withGuildContext(db, '22222222222222222', () => db.get<{ values_json: string }>('SELECT values_json FROM imported_signups WHERE id=?', 'foreign-import')))?.values_json, JSON.stringify({ name: 'Private foreign row' }));
    }
  } finally { await app.close(); await db.close(); }
});

test('organizer member search is bounded, guild-scoped and returns only identity fields', async () => {
  const db = await openTestDb();
  const session = await createSession(db, { userId: '99999999999999999', username: 'Organizer', avatar: null, guilds: [{ id: guildId, name: 'Guild', icon: null }] });
  let searchArgs: unknown;
  const guild = {
    id: guildId, name: 'Guild', ownerId: session.userId,
    members: {
      search: async (options: unknown) => { searchArgs = options; return new Map([['12345678901234567', { id: '12345678901234567', displayName: 'Ada Example', user: { username: 'ada', globalName: 'Ada Example', email: 'private@example.test' }, roles: { cache: new Map([['role', {}]]) } }]]); },
      fetch: async () => ({ id: session.userId, permissions: { has: () => false, bitfield: 0n }, roles: { cache: new Map() } }),
    },
  };
  const client = { guilds: { cache: new Map([[guildId, guild]]), fetch: async () => guild } } as never;
  const app = Fastify({ logger: false });
  registerRoutes(app, { db, config: { adminSessionSecret: secret, adminIds: [], botLanguage: 'en' } as unknown as Env, client, announce: async () => undefined });
  const headers = { cookie: `hacksess=${encodeURIComponent(makeDiscordToken(secret, session.id))}` };
  try {
    const anonymous = await app.inject({ method: 'GET', url: '/api/guild/members?query=ada' });
    assert.equal(anonymous.statusCode, 401);
    const result = await app.inject({ method: 'GET', url: '/api/guild/members?query=ada', headers });
    assert.equal(result.statusCode, 200, result.body);
    assert.deepEqual(searchArgs, { query: 'ada', limit: 10 });
    assert.deepEqual(result.json(), { members: [{ id: '12345678901234567', username: 'ada', displayName: 'Ada Example' }] });
    const short = await app.inject({ method: 'GET', url: '/api/guild/members?query=a', headers });
    assert.equal(short.statusCode, 400);
  } finally { await app.close(); await db.close(); }
});
