import assert from 'node:assert/strict';
import test from 'node:test';
import Fastify from 'fastify';
import { makeDiscordToken } from '../features/auth/domain.js';
import { createSession } from '../features/auth/data.js';
import { createEvent } from '../features/events/data.js';
import { openTestDb } from '../shared/test-db.js';
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
    const created = await createEvent(db, 'test', guildId, { name: 'Import API test', form: { version: 1, title: 'T', description: '', teamSize: 4, experiences: [], roleTracks: [], skills: [], teamPrefs: [], customQuestions: [{ id: 'diet', kind: 'text', label: { en: 'Diet' }, help: { en: '' }, required: true, presentation: 'web', visibility: 'self_and_organizer' }] } });
    assert.equal(created.ok, true);
    if (!created.ok) return;
    const eventId = created.value.id;
    const preview = await app.inject({ method: 'POST', url: `/api/events/${eventId}/signup-import/preview`, headers, payload: { csv: 'Timestamp,Name,Chas email,Dietary\r\n"31 Oct",Synthetic,Ada@example.test,""', mapping: { Dietary: 'diet' } } });
    assert.equal(preview.statusCode, 200, preview.body);
    assert.equal((await db.get('SELECT id FROM imported_signups WHERE event_id=?', eventId)), undefined);
    assert.equal(preview.json().rows[0].values.name, 'Synthetic');
    const row = preview.json().rows[0];
    const saved = await app.inject({ method: 'POST', url: `/api/events/${eventId}/signup-import`, headers, payload: { rows: [{ sourceRow: row.rowNumber, values: row.values, answers: row.answers }] } });
    assert.equal(saved.statusCode, 200, saved.body);
    const id = saved.json().rows[0].id;
    await db.run("UPDATE events SET status='active' WHERE id=?", eventId);
    const incomplete = await app.inject({ method: 'PATCH', url: `/api/events/${eventId}/imported-signups/${id}`, headers, payload: { linkDiscordUserId: '12345678901234567' } });
    assert.equal(incomplete.statusCode, 200, incomplete.body);
    assert.deepEqual(incomplete.json().missingFields, ['diet']);
    assert.equal((await db.get('SELECT user_id FROM participants WHERE event_id=?', eventId)), undefined);
    const linked = await app.inject({ method: 'PATCH', url: `/api/events/${eventId}/imported-signups/${id}`, headers, payload: { answers: { diet: 'vegetarian' }, linkDiscordUserId: '12345678901234567' } });
    assert.equal(linked.statusCode, 200, linked.body);
    assert.equal(linked.json().activated, true);
    assert.equal((await db.get<{ user_id: string }>('SELECT user_id FROM participants WHERE event_id=?', eventId))?.user_id, '12345678901234567');
    const beforeFailedLink = await db.get<{ values_json: string; answers_json: string; discord_username: string | null }>('SELECT values_json,answers_json,discord_username FROM imported_signups WHERE id=?', id);
    const failedLink = await app.inject({ method: 'PATCH', url: `/api/events/${eventId}/imported-signups/${id}`, headers, payload: { values: { name: 'Must roll back' }, answers: { diet: 'changed' }, linkDiscordUserId: '22345678901234567' } });
    assert.equal(failedLink.statusCode, 400, failedLink.body);
    assert.deepEqual(await db.get('SELECT values_json,answers_json,discord_username FROM imported_signups WHERE id=?', id), beforeFailedLink);
    const foreignUrl = ['/api/events/', 'missing', '/imported-signups'].join('');
    const foreign = await app.inject({ method: 'GET', url: foreignUrl, headers });
    assert.equal(foreign.statusCode, 200);
    assert.deepEqual(foreign.json().records, []);
  } finally { await app.close(); await db.close(); }
});
