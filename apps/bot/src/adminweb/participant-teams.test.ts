import { test } from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import { openTestDb } from '../shared/test-db.js';
import { createSession } from '../features/auth/data.js';
import { makeDiscordToken } from '../features/auth/domain.js';
import { registerRoutes } from './routes.js';
import type { Env } from '../shared/env.js';

 test('participant team lifecycle uses session identity, safe DTOs and event-scoped invitations', async () => {
  const db = await openTestDb();
  const key = 'participant-team-test-signing-key-32-characters';
  const config = { adminSessionSecret: key, adminIds: [], botLanguage: 'en', skipDiscord: true } as unknown as Env;
  const members = new Set(['owner', 'joiner', 'invitee', 'other']);
  const guild = { members: { fetch: async (input: string | { user: string }) => { const id = typeof input === 'string' ? input : input.user; if (!members.has(id)) throw new Error('unknown member'); return { id }; } } };
  const client = { guilds: { fetch: async () => guild } } as never;
  const app = Fastify();
  registerRoutes(app, { db, config, client, announce: async () => undefined });
  try {
    for (const event of ['ev', 'foreign']) await db.run("INSERT INTO events (id,guild_id,name,status,created_at,updated_at) VALUES (?,'g','test','active',1,1)", event);
    const cookies: Record<string, string> = {};
    for (const user of members) {
      await db.run("INSERT INTO participants (event_id,user_id,guild_id,display_name,experience,role_track,skills,team_pref,teammates,status,created_at,updated_at) VALUES ('ev',?,'g',?,'some_experience','backend','[]','random_team','[]','active',1,1)", user, user);
      const session = await createSession(db, { userId: user, username: user, avatar: null, guilds: [], audience: 'participant' });
      cookies[user] = `hackpartsess=${encodeURIComponent(makeDiscordToken(key, session.id, Date.now(), 'participant'))}`;
    }
    const call = (user: string, method: 'POST' | 'GET' | 'DELETE', suffix: string, payload?: object, event = 'ev') => app.inject({ method, url: `/api/participant/events/${event}/${suffix}`, headers: { cookie: cookies[user]! }, ...(payload ? { payload } : {}) });
    const created = await call('owner', 'POST', 'teams', { name: 'Alpha', kind: 'public', userId: 'other', guildId: 'foreign' });
    assert.equal(created.statusCode, 200, created.body);
    const team = created.json().team;
    assert.equal(team.ownerId, 'owner');
    const listing = await call('other', 'GET', 'teams');
    assert.equal(listing.statusCode, 200);
    assert.equal(listing.body.includes('experience'), false);
    assert.equal(listing.body.includes('joinCode'), false);
    assert.equal((await call('joiner', 'POST', `teams/${team.id}/join`)).statusCode, 200);
    const invite = await call('owner', 'POST', `teams/${team.id}/invites`, { targetId: 'invitee' });
    assert.equal(invite.statusCode, 200, invite.body);
    const id = invite.json().request.id;
    assert.equal((await call('other', 'POST', `invitations/${id}/respond`, { decision: 'accept' })).statusCode, 404);
    assert.equal((await call('invitee', 'POST', `invitations/${id}/respond`, { decision: 'accept' }, 'foreign')).statusCode, 404);
    assert.equal((await call('invitee', 'POST', `invitations/${id}/respond`, { decision: 'accept' })).statusCode, 200);
    assert.equal((await call('owner', 'DELETE', 'team')).statusCode, 200);
    const remaining = await db.all<{ user_id: string }>('SELECT user_id FROM participants WHERE team_id=?', team.id);
    assert.deepEqual(remaining.map((r) => r.user_id).sort(), ['invitee', 'joiner']);
    members.delete('other');
    assert.equal((await call('other', 'POST', 'teams', { name: 'Absent', kind: 'public' })).statusCode, 404);
  } finally { await app.close(); await db.close(); }
});
