import assert from 'node:assert/strict';
import test from 'node:test';
import Fastify from 'fastify';
import { makeDiscordToken } from '../features/auth/domain.js';
import { createSession } from '../features/auth/data.js';
import { createEvent, activateEvent } from '../features/events/data.js';
import { DEFAULT_FORM } from '../features/form/domain.js';
import { getParticipant, blockParticipant } from '../features/signup/data.js';
import { eligibleParticipant } from '../features/signup/eligibility.js';
import { openTestDb } from '../shared/test-db.js';
import { withGuildContext } from '../shared/postgres.js';
import type { Env } from '../shared/env.js';
import { registerRoutes } from './routes.js';

test('organizer adds only current guild members and grants team eligibility without fabricating answers', async () => {
  const db = await openTestDb();
  const guildId = '11111111111111111', userId = '12345678901234567', secret = 'x'.repeat(48);
  const session = await createSession(db, { userId: '99999999999999999', username: 'Organizer', avatar: null, guilds: [{ id: guildId, name: 'Guild', icon: null }] });
  const guild = { id: guildId, ownerId: session.userId, members: { fetch: async (arg: string | { user: string }) => {
    const id = typeof arg === 'string' ? arg : arg.user;
    if (id === '22345678901234567') throw Object.assign(new Error('Unknown member'), { code: 10007 });
    return { id, displayName: 'Member', user: { bot: false }, permissions: { has: () => false, bitfield: 0n }, roles: { cache: new Map() } };
  } } };
  const client = { guilds: { cache: new Map([[guildId, guild]]), fetch: async () => guild } } as never;
  const app = Fastify({ logger: false });
  registerRoutes(app, { db, config: { adminSessionSecret: secret, adminIds: [], botLanguage: 'en' } as unknown as Env, client, announce: async () => undefined });
  const headers = { cookie: `hacksess=${encodeURIComponent(makeDiscordToken(secret, session.id))}` };
  try {
    const form = { ...DEFAULT_FORM, customQuestions: [{ id: 'required', kind: 'text' as const, label: { en: 'Question' }, help: { en: '' }, required: true, presentation: 'web' as const, visibility: 'self_and_organizer' as const }] };
    const created = await withGuildContext(db, guildId, () => createEvent(db, 'test', guildId, { name: 'Admin add', form }));
    assert.ok(created.ok);
    if (!created.ok) return;
    const eventId = created.value.id;
    assert.ok((await withGuildContext(db, guildId, () => activateEvent(db, 'test', eventId))).ok);
    const url = `/api/events/${eventId}/participants`;
    assert.equal((await app.inject({ method: 'POST', url, payload: { userId } })).statusCode, 401);
    assert.equal((await app.inject({ method: 'POST', url, headers, payload: { userId: '22345678901234567' } })).statusCode, 404);
    assert.equal((await app.inject({ method: 'POST', url, headers, payload: { userId } })).statusCode, 200);
    const participant = await withGuildContext(db, guildId, () => eligibleParticipant(db, eventId, userId));
    assert.equal(participant?.adminAdded, true);
    assert.equal(await withGuildContext(db, guildId, () => db.get('SELECT * FROM registration_answers WHERE event_id=? AND user_id=?', eventId, userId)), undefined);
    await withGuildContext(db, guildId, () => db.run("UPDATE participants SET experience='kept' WHERE event_id=? AND user_id=?", eventId, userId));
    assert.equal((await app.inject({ method: 'POST', url, headers, payload: { userId } })).statusCode, 200);
    assert.equal((await withGuildContext(db, guildId, () => getParticipant(db, eventId, userId)))?.experience, 'kept');
    await withGuildContext(db, guildId, () => blockParticipant(db, 'test', eventId, userId, 'blocked'));
    assert.equal((await app.inject({ method: 'POST', url, headers, payload: { userId } })).json().error, 'blocked');
    const other = await withGuildContext(db, '22222222222222222', () => createEvent(db, 'test', '22222222222222222', { name: 'Other guild' }));
    assert.ok(other.ok);
    if (other.ok) assert.equal((await app.inject({ method: 'POST', url: `/api/events/${other.value.id}/participants`, headers, payload: { userId } })).statusCode, 404);
  } finally { await app.close(); await db.close(); }
});
