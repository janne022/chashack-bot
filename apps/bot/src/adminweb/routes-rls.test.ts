import assert from 'node:assert/strict';
import { test } from 'node:test';
import { randomUUID } from 'node:crypto';
import Fastify from 'fastify';
import type { Client } from 'discord.js';
import { openTestDb } from '../shared/test-db.js';
import { openPostgres, withGuildContext } from '../shared/postgres.js';
import { createSession, deleteSession } from '../features/auth/data.js';
import { makeDiscordToken } from '../features/auth/domain.js';
import { DEFAULT_FORM } from '../features/form/domain.js';
import type { Env } from '../shared/env.js';
import { registerRoutes } from './routes.js';
import { runMaintenance } from '../discord/notify.js';
import { registerMemberLifecycle } from '../discord/member-lifecycle.js';
import { replayPrivateAnswerDeletions } from '../features/registration/retention.js';
import { replayMemberDeletions } from '../features/signup/departures.js';

const secret = randomUUID().repeat(2);
const route = (...parts: string[]) => `/${parts.join('/')}`;
const guildA = '11111111111111111';
const guildB = '22222222222222222';

test('real app-role handlers bind fresh participant authority, public projections and maintenance to guild context', async (t) => {
  const owner = await openTestDb();

  const schema = (await owner.get<{ name: string }>('SELECT current_schema() AS name'))!.name;
  const role = `rls_${randomUUID().replaceAll('-', '')}`;
  const password = randomUUID();
  await owner.run(`CREATE ROLE ${role} LOGIN PASSWORD '${password}' NOSUPERUSER NOBYPASSRLS`);

  await owner.run(`GRANT USAGE ON SCHEMA ${schema} TO ${role}`);
  await owner.run(`GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA ${schema} TO ${role}`);
  await owner.run(`GRANT USAGE ON ALL SEQUENCES IN SCHEMA ${schema} TO ${role}`);
  const url = new URL(process.env.DATABASE_URL!);
  url.username = role;
  url.password = password;
  const db = await openPostgres(url.toString(), schema, 1);
  t.after(async () => {
    await db.close();
    await owner.run(`DROP OWNED BY ${role}`);
    await owner.run(`DROP ROLE ${role}`);
    await owner.close();
  });
  const form = { ...DEFAULT_FORM, customQuestions: [{ id: 'private', kind: 'text', label: { en: 'Private' }, help: { en: '' }, required: false, presentation: 'web', visibility: 'organizer_only' }] };
  for (const [id, guild] of [['a', guildA], ['b', guildB], ['draft', guildA]]) {
    await owner.run('INSERT INTO events (id,guild_id,name,status,form_json,created_at,updated_at) VALUES (?,?,?,?,?,1,1)', id, guild, id, id === 'draft' ? 'draft' : 'active', JSON.stringify(form));
    await owner.run("INSERT INTO participants (event_id,user_id,guild_id,display_name,experience,role_track,skills,team_pref,teammates,created_at,updated_at) VALUES (?,'subject',?,'Subject','','','[]','random_team','[]',1,1)", id, guild);
    await owner.run("INSERT INTO registration_answers (event_id,user_id,form_version,answers_json,updated_at) VALUES (?,'subject',1,?,1)", id, JSON.stringify({ private: `PRIVATE_${id}` }));
  }
  const participant = await createSession(owner, { userId: 'subject', username: 'Subject', avatar: null, guilds: [], audience: 'participant' });
  const organizer = await createSession(owner, { userId: 'organizer', username: 'Organizer', avatar: null, guilds: [{ id: guildA, name: 'A', icon: null }, { id: guildB, name: 'B', icon: null }] });
  const allowed = new Set([guildA]);
  let unavailable = false;
  const guilds = new Map([guildA, guildB].map((id) => [id, {
    id, name: id, ownerId: 'organizer', available: true,
    members: { fetch: async (input: string | { user: string }) => {
      const user = typeof input === 'string' ? input : input.user;
      if (unavailable) throw new Error('Discord unavailable');
      if (user !== 'organizer' && !allowed.has(id)) throw Object.assign(new Error('Unknown Member'), { code: 10007 });
      return { id: user, permissions: { has: () => false, bitfield: 0n }, roles: { cache: new Map() } };
    } },
  }]));
  const client = { guilds: { cache: guilds, fetch: async (id: string) => guilds.get(id) }, on: () => undefined } as unknown as Client;
  const config = { adminSessionSecret: secret, skipDiscord: true, adminIds: [], botLanguage: 'en' } as unknown as Env;
  const app = Fastify({ logger: false });
  registerRoutes(app, { db, config, client, announce: async () => undefined });
  t.after(() => app.close());
  const headers = { cookie: `hackpartsess=${encodeURIComponent(makeDiscordToken(secret, participant.id, Date.now(), 'participant'))}` };
  const get = (id: string) => app.inject({ url: `/api/participant/events/${id}/registration`, headers });

  await t.test('participant can read and edit their own private answers; team path inherits the context', async () => {
    const response = await get('a');
    assert.equal(response.statusCode, 200, response.body);
    assert.deepEqual(response.json().answers, { private: 'PRIVATE_a' });
    assert.equal(response.json().questions[0].id, 'private');
    const profile = { experience: 'veteran', roleTrack: 'backend', skills: ['ui_design'], teamPref: 'random_team' };
    const updated = await app.inject({ method: 'PUT', url: '/api/participant/events/a/registration', headers, payload: { formVersion: 1, answers: { private: 'UPDATED' }, profile } });
    assert.equal(updated.statusCode, 200);
    const saved = await app.inject({ method: 'PUT', url: '/api/participant/events/a/registration', headers, payload: { formVersion: 1, answers: { private: 'PRIVATE_a' }, profile, guildId: guildB, userId: 'forged' } });
    assert.equal(saved.statusCode, 200, saved.body);
    assert.deepEqual((await get('a')).json().answers, { private: 'PRIVATE_a' });
    assert.equal(JSON.parse((await owner.get<{ answers_json: string }>("SELECT answers_json FROM registration_answers WHERE event_id='a'"))!.answers_json).private, 'PRIVATE_a');
    const teams = await app.inject({ url: '/api/participant/events/a/teams', headers });
    assert.equal(teams.statusCode, 200, teams.body);
    assert.deepEqual(await db.all('SELECT * FROM events'), []);
  });
  await t.test('foreign, draft, revoked membership and unavailable Discord fail closed', async () => {
    assert.equal((await get('b')).statusCode, 404);
    assert.equal((await get('draft')).statusCode, 404);
    allowed.clear();
    assert.equal((await get('a')).statusCode, 404);
    allowed.add(guildA);
    unavailable = true;
    assert.equal((await get('a')).statusCode, 404);
    unavailable = false;
  });
  await t.test('My hackathons iterates only fresh permitted installed guilds and ignores forged authority', async () => {
    const registrations = async () => (await app.inject({ url: '/api/participant/registrations?guildId=forged&userId=forged', headers })).json().registrations;
    assert.deepEqual((await registrations()).map((r: { eventId: string }) => r.eventId), ['a']);
    allowed.add(guildB);
    assert.deepEqual((await registrations()).map((r: { eventId: string }) => r.eventId).sort(), ['a', 'b']);
    allowed.delete(guildB);
    const cached = guilds.get(guildA)!;
    guilds.delete(guildA);
    assert.deepEqual(await registrations(), []);
    assert.equal((await get('a')).statusCode, 404);
    guilds.set(guildA, cached);
  });
  await t.test('public bootstrap exposes published projections only and rejects drafts/missing inventory', async () => {
    const dto = await app.inject({ url: route('api', 'public', 'events', 'a') });
    assert.equal(dto.statusCode, 200, dto.body);
    assert.ok(!dto.body.includes('UPDATED') && !dto.body.includes('PRIVATE_'));
    assert.deepEqual(dto.json().form.questions, []);
    const page = await app.inject({ url: '/events/a' });
    assert.equal(page.statusCode, 200);
    assert.match(page.body, /<main[^>]*>/);
    assert.match(page.body, /Sign up|Anmäl/);
    assert.match(page.body, /<script type="module"[^>]+src="\/assets\//);
    assert.equal((await app.inject({ url: route('api', 'public', 'events', 'draft') })).statusCode, 404);
    assert.equal((await app.inject({ url: '/events/draft' })).statusCode, 404);
    const unavailableApp = Fastify({ logger: false });
    try {
      registerRoutes(unavailableApp, { db, config, client: null, announce: async () => undefined });
      assert.equal((await unavailableApp.inject({ url: route('api', 'public', 'events', 'a') })).statusCode, 404);
      assert.equal((await unavailableApp.inject({ url: '/api/participant/events/a/registration', headers })).statusCode, 404);
    } finally { await unavailableApp.close(); }
  });
  await t.test('individual answer inspection requires current organizer authority in the selected guild and audits no answer values', async () => {
    const orgHeaders = { cookie: `hacksess=${encodeURIComponent(makeDiscordToken(secret, organizer.id))}` };
    const response = await app.inject({ url: '/api/events/a/registrations/subject', headers: orgHeaders }); // g0:allow:secrets t_33947af2 - synthetic API paths, no credentials
    assert.equal(response.statusCode, 200, response.body);
    assert.equal(response.headers['cache-control'], 'no-store');
    assert.deepEqual(response.json().answers, { private: 'PRIVATE_a' });
    assert.equal(response.json().questions[0].id, 'private');
    assert.equal((await app.inject({ url: '/api/events/b/registrations/subject', headers: orgHeaders })).statusCode, 404); // g0:allow:secrets t_33947af2 - synthetic API paths, no credentials
    assert.equal((await app.inject({ url: '/api/events/a/registrations/missing', headers: orgHeaders })).statusCode, 404);
    assert.equal((await app.inject({ url: '/api/events/a/registrations/subject', headers })).statusCode, 401); // g0:allow:secrets t_33947af2 - synthetic API paths, no credentials
    assert.equal((await app.inject({ url: '/api/events/a/registrations/subject' })).statusCode, 401); // g0:allow:secrets t_33947af2 - synthetic API paths, no credentials
    const entry = await owner.get<{ actor: string; details: string }>("SELECT actor, details FROM audit_log WHERE action='registration.read' AND target='a'");
    assert.equal(entry?.actor, 'discord:organizer');
    assert.deepEqual(JSON.parse(entry!.details), { userId: 'subject' });
    await owner.run("UPDATE registration_answers SET form_version=99 WHERE event_id='a' AND user_id='subject'");
    const historical = (await app.inject({ url: '/api/events/a/registrations/subject', headers: orgHeaders })).json(); // g0:allow:secrets t_33947af2 - synthetic API paths, no credentials
    assert.equal(historical.historicalDefinitionUnavailable, true);
    assert.deepEqual(historical.questions, []);
    await owner.run("UPDATE registration_answers SET form_version=1 WHERE event_id='a' AND user_id='subject'");
  });
  await t.test('organizer session works across guild switch without leaking context', async () => {
    const orgHeaders = { cookie: `hacksess=${encodeURIComponent(makeDiscordToken(secret, organizer.id))}` };
    const a = await app.inject({ url: '/api/state', headers: orgHeaders });
    assert.equal(a.statusCode, 200, a.body);
    assert.ok(!a.body.includes('PRIVATE_'));
    const switched = await app.inject({ method: 'POST', url: '/api/auth/guild', headers: orgHeaders, payload: { guildId: guildB } });
    assert.equal(switched.statusCode, 200, switched.body);
    const b = await app.inject({ url: '/api/state', headers: orgHeaders });
    assert.equal(b.statusCode, 200, b.body);
    assert.deepEqual(b.json().events.map((e: { id: string }) => e.id), ['b']);
    assert.deepEqual(await db.all('SELECT * FROM events'), []);
  });
  await t.test('unrelated scheduler and departure reconciliation read/write only installed scopes', async () => {
    const now = Date.now() + 10 * 86_400_000;
    await owner.run("UPDATE events SET status='ended',ends_at=?,cleanup_done=1 WHERE id IN ('a','b')", Date.now());
    const cached = guilds.get(guildB)!;
    guilds.delete(guildB);
    await runMaintenance({ db, client, now });
    assert.equal(JSON.parse((await owner.get<{ answers_json: string }>("SELECT answers_json FROM registration_answers WHERE event_id='a'"))!.answers_json).private, undefined);
    assert.equal(JSON.parse((await owner.get<{ answers_json: string }>("SELECT answers_json FROM registration_answers WHERE event_id='b'"))!.answers_json).private, 'PRIVATE_b');
    guilds.set(guildB, cached);
    await runMaintenance({ db, client, now });
    assert.equal(JSON.parse((await owner.get<{ answers_json: string }>("SELECT answers_json FROM registration_answers WHERE event_id='b'"))!.answers_json).private, undefined);
    allowed.clear();
    await registerMemberLifecycle(db, client)();
    assert.deepEqual(await owner.all("SELECT * FROM participants WHERE user_id='subject'"), []);
    assert.deepEqual(await db.all('SELECT * FROM member_deletions'), []);
  });
  await t.test('restore replay uses app-role per-record scopes, preserves other guild and rejects tenant escalation', async () => {
    for (const eventId of ['a', 'b']) await owner.run("INSERT INTO registration_answers (event_id,user_id,form_version,answers_json,updated_at) VALUES (?,'restored',1,?,1)", eventId, JSON.stringify({ private: 'RESTORED_PRIVATE' }));
    const record = { guildId: guildA, eventId: 'a', userId: 'restored', deletedAt: 2 };
    await replayPrivateAnswerDeletions(db, [record]);
    assert.deepEqual(JSON.parse((await owner.get<{ answers_json: string }>("SELECT answers_json FROM registration_answers WHERE event_id='a' AND user_id='restored'"))!.answers_json), {});
    assert.equal(JSON.parse((await owner.get<{ answers_json: string }>("SELECT answers_json FROM registration_answers WHERE event_id='b' AND user_id='restored'"))!.answers_json).private, 'RESTORED_PRIVATE');
    await assert.rejects(withGuildContext(db, guildA, () => replayPrivateAnswerDeletions(db, [{ ...record, guildId: guildB, eventId: 'b' }])), /Cannot change guild/);
    await replayMemberDeletions(db, [record]);
    assert.equal((await owner.all("SELECT * FROM registration_answers WHERE event_id='a' AND user_id='restored'")).length, 0);
    assert.equal((await owner.all("SELECT * FROM registration_answers WHERE event_id='b' AND user_id='restored'")).length, 1);
  });
  await t.test('revoked live session and missing authentication refuse', async () => {
    await deleteSession(owner, participant.id);
    assert.equal((await get('a')).statusCode, 401);
    assert.equal((await app.inject({ url: '/api/participant/events/a/registration' })).statusCode, 401);
  });
});
