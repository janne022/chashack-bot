import assert from 'node:assert/strict';
import { test } from 'node:test';
import { randomUUID } from 'node:crypto';
import Fastify from 'fastify';
import type { Client } from 'discord.js';
import type { Env } from '../shared/env.js';
import { openTestDb } from '../shared/test-db.js';
import { openPostgres, withGuildContext } from '../shared/postgres.js';
import { createSession, deleteSession } from '../features/auth/data.js';
import { makeDiscordToken } from '../features/auth/domain.js';
import { registerRoutes } from './routes.js';


const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
async function until(check: () => boolean, ms = 5000) {
  const end = Date.now() + ms;
  while (!check() && Date.now() < end) await delay(25);
  assert.ok(check(), `condition within ${ms}ms`);
}

test('actual audience streams enforce fresh authority and app-role RLS across two tenants/events', async () => {
  const owner = await openTestDb();
  const schema = (await owner.get<{ name: string }>('SELECT current_schema() AS name'))!.name;
  const role = `rls_${randomUUID().replaceAll('-', '')}`;
  const password = randomUUID();
  await owner.run(`CREATE ROLE ${role} LOGIN PASSWORD '${password}' NOSUPERUSER NOBYPASSRLS`);
  await owner.run(`GRANT USAGE ON SCHEMA ${schema} TO ${role}`);
  await owner.run(`GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA ${schema} TO ${role}`);
  await owner.run(`GRANT USAGE ON ALL SEQUENCES IN SCHEMA ${schema} TO ${role}`);
  const url = new URL(process.env.DATABASE_URL!); url.username = role; url.password = password;
  const db = await openPostgres(url.toString(), schema, 1);
  const guildA = '11111111111111111', guildB = '22222222222222222';
  const secret = randomUUID().repeat(2);
  const members = new Set([`${guildA}:subject`, `${guildB}:other`, `${guildA}:admin`]);
  let admin = true;
  const guilds = new Map([guildA, guildB].map(id => [id, { id, available: true, ownerId: 'owner',
    members: { fetch: async (input: string | { user: string; force: boolean }) => {
      assert.equal(typeof input === 'object' && input.force, true, 'membership is never cache-only');
      const user = typeof input === 'string' ? input : input.user;
      if (!members.has(`${id}:${user}`)) throw Object.assign(new Error('Unknown Member'), { code: 10007 });
      return { id: user, permissions: { has: () => user === 'admin' && admin, bitfield: user === 'admin' && admin ? 8n : 0n }, roles: { cache: new Map() } };
    } } }]));
  const client = { guilds: { cache: guilds, fetch: async (id: string) => guilds.get(id) } as unknown as Client['guilds'] } as Client;
  for (const [id, guild] of [['a', guildA], ['a2', guildA], ['b', guildB]]) {
    await owner.run("INSERT INTO events(id,guild_id,name,status,created_at,updated_at) VALUES (?,?,?,'active',1,1)", id, guild, id);
    await owner.run("INSERT INTO participants(event_id,user_id,guild_id,display_name,experience,role_track,skills,team_pref,teammates,created_at,updated_at) VALUES (?,'subject',?,'Subject','','','[]','','[]',1,1)", id, guild);
  }
  const org = await createSession(db, { userId: 'admin', username: 'Admin', avatar: null, guilds: [{ id: guildA, name: 'A', icon: null }] });
  const subject = await createSession(db, { userId: 'subject', username: 'Subject', avatar: null, guilds: [], audience: 'participant' });
  const orgCookie = `hacksess=${makeDiscordToken(secret, org.id)}`;
  const partCookie = `hackpartsess=${makeDiscordToken(secret, subject.id, Date.now(), 'participant')}`;
  const app = Fastify();
  registerRoutes(app, { db, config: { adminSessionSecret: secret, skipDiscord: true, botLanguage: 'en', adminIds: [] } as unknown as Env, client, announce: async () => undefined });
  const base = await app.listen({ host: '127.0.0.1', port: 0 });
  const controllers: AbortController[] = [];
  const open = async (path: string, cookie: string) => {
    const controller = new AbortController(); controllers.push(controller);
    const response = await fetch(base + path, { headers: { cookie }, signal: controller.signal });
    assert.equal(response.status, 200, await (response.status === 200 ? Promise.resolve('') : response.text()));
    const stream = { text: '', done: false, dirty: () => (stream.text.match(/event: dirty/g) ?? []).length };
    void (async () => { try { for await (const chunk of response.body!) stream.text += new TextDecoder().decode(chunk); } catch { /* aborted */ } finally { stream.done = true; } })();
    await until(() => stream.text.includes('event: ready'));
    return stream;
  };
  try {
    assert.deepEqual(await db.all('SELECT * FROM events'), [], 'unscoped app role is empty');
    assert.equal((await fetch(base + '/api/live?eventId=b&probe=1', { headers: { cookie: orgCookie } })).status, 403);
    assert.equal((await fetch(base + '/api/participant/events/b/live?probe=1', { headers: { cookie: partCookie } })).status, 404);
    assert.equal((await fetch(base + '/api/live?probe=1', { headers: { cookie: partCookie } })).status, 401);
    const organizer = await open('/api/live?eventId=a', orgCookie);
    const participant = await open('/api/participant/events/a/live', partCookie);
    const aggregate = await open('/api/participant/live', partCookie);
    assert.equal((await fetch(base + '/api/participant/events/a/live', { headers: { cookie: partCookie } })).status, 429);
    await withGuildContext(db, guildA, () => db.run("UPDATE participants SET display_name='changed' WHERE event_id='a' AND user_id='subject'"));
    await until(() => organizer.dirty() > 0 && participant.dirty() > 0 && aggregate.dirty() > 0);
    const counts = [organizer.dirty(), participant.dirty(), aggregate.dirty()] as const;
    await owner.run("UPDATE events SET name='FOREIGN_SECRET' WHERE id='b'");
    await owner.run("UPDATE events SET name='OTHER_EVENT' WHERE id='a2'");
    await owner.run("INSERT INTO registration_answers(event_id,user_id,form_version,answers_json,updated_at) VALUES ('a','other',1,'{\"private\":\"TOP_SECRET\"}',1)");
    await assert.rejects(withGuildContext(db, guildA, () => db.transaction(async () => {
      await db.run("UPDATE participants SET display_name='ROLLBACK' WHERE event_id='a'"); throw new Error('rollback');
    })), /rollback/);
    await delay(200);
    assert.equal(organizer.dirty(), counts[0] + 1, 'only selected-event organizer sees private-answer mutation');
    assert.equal(participant.dirty(), counts[1], 'no foreign/private/rollback hint');
    assert.equal(aggregate.dirty(), counts[2] + 1, 'own permitted registration event metadata only');
    const beforePublic = participant.dirty();

    await owner.run("INSERT INTO teams(id,event_id,guild_id,name,kind,created_at) VALUES ('open','a',?,'Open team','public',1)", guildA);
    await until(() => participant.dirty() > beforePublic);
    for (const stream of [organizer, participant, aggregate]) assert.ok(!/SECRET|subject|guild|answers|joinCode|a2/.test(stream.text));
    const own = await fetch(base + '/api/participant/events/a/registration', { headers: { cookie: partCookie } });
    assert.ok(!(await own.text()).includes('TOP_SECRET'));
    members.delete(`${guildA}:subject`); admin = false;
    await until(() => participant.done && aggregate.done && organizer.done, 25_000);
    assert.match(participant.text, /event: denied/);
    assert.equal((await fetch(base + '/api/participant/events/a/registration', { headers: { cookie: partCookie } })).status, 404);
    assert.equal((await fetch(base + '/api/state', { headers: { cookie: orgCookie } })).status, 403);
    members.add(`${guildA}:subject`); admin = true;
    const logout = await open('/api/participant/events/a/live', partCookie);
    await deleteSession(db, subject.id);
    await until(() => logout.done, 25_000);
    assert.match(logout.text, /event: denied/);
    const expired = await open('/api/live?eventId=a', orgCookie);
    await db.run('UPDATE web_sessions SET expires_at=1 WHERE id=?', org.id);
    await until(() => expired.done, 25_000);
    assert.match(expired.text, /event: denied/);
  } finally {
    controllers.forEach(controller => controller.abort());
    await app.close(); await db.close();
    await owner.run(`DROP OWNED BY ${role}`); await owner.run(`DROP ROLE ${role}`); await owner.close();
  }
});
