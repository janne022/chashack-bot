import assert from 'node:assert/strict';
import { test } from 'node:test';
import Fastify from 'fastify';
import { makeDiscordToken } from '../features/auth/domain.js';
import { createSession, getSession } from '../features/auth/data.js';
import { openTestDb } from '../shared/test-db.js';
import { EXPENSIVE_LIMIT } from '../shared/rate-limit.js';
import type { Env } from '../shared/env.js';
import { registerRoutes } from './routes.js';
import { DEFAULT_FORM } from '../features/form/domain.js';
import { registerInteractionHandlers } from '../discord/dispatch.js';
import { saveSubmissionForm } from '../features/submission/data.js';
import { saveTemplate } from '../features/events/data.js';

const signingKey = 'test-session-signing-key-at-least-32-characters';
const config = {
  adminSessionSecret: signingKey,
  guildId: '11111111111111111',
  skipDiscord: true,
  adminIds: [],
  adminPort: 0,
  discordToken: '',
  clientId: '',
  discordClientSecret: undefined,
  oauthRedirectUri: undefined,
  publicUrl: undefined,
  announceChannelId: undefined,
  auditChannelId: undefined,
  teamCategoryId: undefined,
  botLanguage: 'en',
} as Env;

const sessionCookie = (id: string) => `hacksess=${encodeURIComponent(makeDiscordToken(signingKey, id))}`;
const route = (...parts: string[]) => `/${parts.join('/')}`;

test('event creation resolves tenant assignment collections and honors explicit overrides', async () => {
  const db = await openTestDb();
  const guildId = '11111111111111111', otherGuild = '22222222222222222';
  const session = await createSession(db, { userId: 'template-owner', username: 'owner', avatar: null, guilds: [{ id: guildId, name: 'Guild', icon: null }] });
  const guild = { id: guildId, ownerId: 'template-owner', members: { fetch: async (id: string) => ({ id, permissions: { has: () => false, bitfield: 0n }, roles: { cache: new Map() } }) } };
  const app = Fastify({ logger: false });
  registerRoutes(app, { db, config, announce: async () => undefined, client: { guilds: { cache: new Map([[guildId, guild]]), fetch: async () => guild } } as never });
  try {
    const pool = [{ id: 'brief', title: 'Build', instructions: 'Make a demo' }];
    const collection = await saveTemplate(db, 'test', guildId, 'Pool', 'assignments', JSON.stringify({ assignments: pool }));
    const foreign = await saveTemplate(db, 'test', otherGuild, 'Foreign pool', 'assignments', JSON.stringify({ assignments: pool }));
    const malformed = await saveTemplate(db, 'test', guildId, 'Broken pool', 'assignments', JSON.stringify({ assignments: [{ title: 'Incomplete' }] }));
    assert.ok(collection.ok && foreign.ok && malformed.ok);
    if (!collection.ok || !foreign.ok || !malformed.ok) return;
    const eventTemplate = await saveTemplate(db, 'test', guildId, 'Event template', 'event', JSON.stringify({ assignmentCollectionId: collection.value.id, assignmentStrategy: 'same' }));
    const foreignTemplate = await saveTemplate(db, 'test', guildId, 'Foreign reference', 'event', JSON.stringify({ assignmentCollectionId: foreign.value.id }));
    const legacy = await saveTemplate(db, 'test', guildId, 'Legacy embedded', 'event', JSON.stringify({ assignments: pool }));
    const malformedTemplate = await saveTemplate(db, 'test', guildId, 'Broken reference', 'event', JSON.stringify({ assignmentCollectionId: malformed.value.id }));
    assert.ok(eventTemplate.ok && foreignTemplate.ok && legacy.ok && malformedTemplate.ok);
    if (!eventTemplate.ok || !foreignTemplate.ok || !legacy.ok || !malformedTemplate.ok) return;
    const headers = { cookie: sessionCookie(session.id) }, startsAt = Date.now() + 86400000;
    const create = (templateId: string, assignments?: typeof pool) => app.inject({ method: 'POST', url: '/api/events', headers, payload: { name: 'Test event', templateId, startsAt, endsAt: startsAt + 3600000, ...(assignments !== undefined ? { assignments } : {}) } });
    const fromCollection = await create(eventTemplate.value.id);
    assert.equal(fromCollection.statusCode, 200);
    assert.equal(fromCollection.json().event.assignments[0].id, 'brief');
    assert.ok(fromCollection.json().event.schedule.some((item: { actions?: { type: string; mode?: string }[] }) => item.actions?.some(action => action.type === 'distribute_assignments' && action.mode === 'same')));
    const cloned = await app.inject({ method: 'POST', url: '/api/templates', headers, payload: { kind: 'event', name: 'Cloned event', eventId: fromCollection.json().event.id } });
    assert.equal(cloned.statusCode, 200);
    const cloneJson = JSON.parse(cloned.json().template.json);
    assert.equal(cloneJson.assignments[0].id, 'brief');
    assert.equal(cloneJson.assignmentStrategy, 'same');
    assert.equal(cloneJson.schedule.find((item: { id: string }) => item.id === '__start__').anchor, 'hackathon_start');
    const emptyOverride = await create(eventTemplate.value.id, []);
    assert.equal(emptyOverride.statusCode, 200);
    assert.deepEqual(emptyOverride.json().event.assignments, []);
    const fromLegacy = await create(legacy.value.id);
    assert.equal(fromLegacy.statusCode, 200);
    assert.equal(fromLegacy.json().event.assignments[0].id, 'brief');
    const refused = await create(foreignTemplate.value.id);
    assert.equal(refused.statusCode, 400);
    assert.equal(refused.json().code, 'assignment_collection_missing');
    const broken = await create(malformedTemplate.value.id);
    assert.equal(broken.statusCode, 400);
    assert.equal(broken.json().code, 'assignment_collection_invalid');
    assert.equal((await create(foreignTemplate.value.id, [])).statusCode, 200, 'explicit removal does not require the old collection');
  } finally { await app.close(); await db.close(); }
});

test('guild switch refusal awaits authorization and leaves selected guild unchanged', async () => {
  const db = await openTestDb();
  const session = await createSession(db, {
    userId: 'user-1', username: 'tester', avatar: null,
    guilds: [{ id: '11111111111111111', name: 'Allowed', icon: null }],
  });
  const app = Fastify({ logger: false });
  registerRoutes(app, { db, config, announce: async () => undefined, client: null });
  const response = await app.inject({
    method: 'POST', url: '/api/auth/guild', headers: { cookie: sessionCookie(session.id) },
    payload: { guildId: '22222222222222222' },
  });
  assert.equal(response.statusCode, 403);
  assert.equal((await getSession(db, session.id))?.selectedGuildId, '11111111111111111');
  await app.close();
  await db.close();
});

test('delegated organizer authority is rechecked against current bot membership on every request', async () => {
  const db = await openTestDb();
  const guildId = '11111111111111111';
  const session = await createSession(db, {
    userId: 'delegate-user', username: 'delegate', avatar: null,
    guilds: [{ id: guildId, name: 'Guild', icon: null }],
  });
  await db.run('INSERT INTO guild_settings (guild_id, mod_role_ids, updated_at) VALUES (?, ?, ?)', guildId, JSON.stringify(['delegate-role']), Date.now());
  const roles = new Map([['delegate-role', {}]]);
  const guild = {
    id: guildId, name: 'Guild', ownerId: 'guild-owner',
    members: { fetch: async (userId: string) => ({
      id: userId, permissions: { has: () => false, bitfield: 0n }, roles: { cache: roles },
    }) },
  };
  const client = { guilds: { cache: new Map([[guildId, guild]]), fetch: async () => guild } } as never;
  const app = Fastify({ logger: false });
  registerRoutes(app, { db, config, announce: async () => undefined, client });
  const headers = { cookie: sessionCookie(session.id) };
  assert.equal((await app.inject({ url: '/api/state', headers })).statusCode, 200);
  roles.clear();
  const refused = await app.inject({ url: '/api/state', headers });
  assert.equal(refused.statusCode, 403);
  assert.equal(refused.json().code, 'access_refused');
  await app.close();
  await db.close();
});

test('delegated organizers cannot change delegation, while owner/admin can', async () => {
  const db = await openTestDb();
  const guildId = '11111111111111111';
  await db.run('INSERT INTO guild_settings (guild_id, mod_role_ids, updated_at) VALUES (?, ?, ?)', guildId, JSON.stringify(['delegate-role']), Date.now());
  const makeClient = (ownerId: string, permissions: bigint) => {
    const guild = {
      id: guildId, name: 'Guild', ownerId,
      members: { fetch: async (id: string) => ({ id, permissions: { has: (p: string) => p === 'Administrator' && permissions === 8n, bitfield: permissions }, roles: { cache: new Map([['delegate-role', {}]]) } }) },
    };
    return { guilds: { cache: new Map([[guildId, guild]]), fetch: async () => guild } } as never;
  };
  const app = Fastify({ logger: false });
  registerRoutes(app, { db, config, announce: async () => undefined, client: makeClient('other-owner', 0n) });
  const delegated = await createSession(db, { userId: 'delegate-user', username: 'delegate', avatar: null, guilds: [{ id: guildId, name: 'Guild', icon: null }] });
  const post = (id: string) => app.inject({
    method: 'POST', url: '/api/guild/settings', headers: { cookie: sessionCookie(id) },
    payload: { modRoleIds: ['33333333333333333'] },
  });
  assert.equal((await post(delegated.id)).statusCode, 403);
  await app.close();

  const adminApp = Fastify({ logger: false });
  registerRoutes(adminApp, { db, config, announce: async () => undefined, client: makeClient('other-owner', 8n) });
  const admin = await createSession(db, { userId: 'admin-user', username: 'admin', avatar: null, guilds: [{ id: guildId, name: 'Guild', icon: null }] });
  assert.equal((await adminApp.inject({ method: 'POST', url: '/api/guild/settings', headers: { cookie: sessionCookie(admin.id) }, payload: { modRoleIds: ['33333333333333333'] } })).statusCode, 200);
  await adminApp.close();
  await db.close();
});

test('password requests do not authenticate; callback without state and PKCE is refused', async () => {
  const db = await openTestDb();
  const app = Fastify({ logger: false });
  registerRoutes(app, { db, config: { ...config, clientId: '123456789012345678', discordClientSecret: 'test' }, announce: async () => undefined, client: null });
  assert.equal(app.hasRoute({ method: 'POST', url: '/api/login' }), false);
  const callback = await app.inject({ url: '/auth/discord/callback?code=synthetic&state=forged' });
  assert.equal(callback.statusCode, 302);
  assert.match(callback.headers.location ?? '', /^\/events\?auth=bad_state$/);
  await app.close();
  await db.close();
});

test('participant identity is isolated from organizer APIs and registrations are subject-scoped', async () => {
  const db = await openTestDb();
  const session = await createSession(db, {
    userId: 'subject-user', username: 'Subject', avatar: null, guilds: [], audience: 'participant',
  });
  await db.run("INSERT INTO events (id, guild_id, name, description, status, created_at, updated_at) VALUES (?, ?, ?, ?, 'active', ?, ?)", 'event-a', 'guild-a', 'Event A', 'Public description', Date.now(), Date.now());
  await db.run('UPDATE events SET schedule_json = ? WHERE id = ?', JSON.stringify([
    { id: '__start__', time: 0, title: 'Pending start', anchor: 'hackathon_start', offsetMinutes: 0, actions: [{ id: 'pending', type: 'distribute_assignments' }] },
    { id: 'pending-activity', time: 0, title: 'Pending activity', anchor: 'hackathon_end', offsetMinutes: -60 },
    { id: 'later', time: 2000, title: 'Later', actions: [{ id: 'private', type: 'announce', message: 'organizer-only sentinel', channelId: 'private-channel' }] },
    { id: 'first', time: 1000, title: 'First', description: 'Welcome', kind: 'talk' },
  ]), 'event-a');
  for (const userId of ['subject-user', 'other-user']) {
    await db.run(
      "INSERT INTO participants (event_id, user_id, guild_id, display_name, experience, role_track, skills, team_pref, teammates, status, created_at, updated_at) VALUES (?, ?, ?, ?, '', '', '[]', '', '[]', 'active', ?, ?)",
      'event-a', userId, 'guild-a', userId, Date.now(), Date.now(),
    );
  }
  const app = Fastify({ logger: false });
  const guild = { id: 'guild-a', members: { fetch: async () => ({ id: 'subject-user' }) } };
  const client = { guilds: { cache: new Map([[guild.id, guild]]), fetch: async () => guild } } as never;
  registerRoutes(app, { db, config, announce: async () => undefined, client });
  const cookie = `hackpartsess=${encodeURIComponent(makeDiscordToken(signingKey, session.id, Date.now(), 'participant'))}`;
  const me = await app.inject({ url: '/api/participant/me', headers: { cookie } });
  assert.deepEqual(me.json(), { user: { id: 'subject-user', username: 'Subject', avatar: null } });
  const registrations = await app.inject({ url: '/api/participant/registrations?userId=other-user&guildId=foreign', headers: { cookie } });
  assert.deepEqual(registrations.json().registrations, [{
    eventId: 'event-a', name: 'Event A', description: 'Public description',
    startsAt: null, endsAt: null, status: 'active', teamId: null,
  }]);
  assert.equal((await app.inject({ url: '/api/participant/events/event-a/schedule' })).statusCode, 401); // g0:allow:secrets t_33947af2 - synthetic participant API paths, no credentials.
  const schedule = await app.inject({ url: '/api/participant/events/event-a/schedule', headers: { cookie } }); // g0:allow:secrets t_33947af2 - synthetic participant API paths, no credentials.
  assert.equal(schedule.statusCode, 200);
  assert.deepEqual(schedule.json().schedule, [
    { id: 'first', time: 1000, title: 'First', description: 'Welcome', kind: 'talk' },
    { id: 'later', time: 2000, title: 'Later' },
  ]);
  assert.doesNotMatch(schedule.body, /organizer-only sentinel|private-channel/);
  await db.run("UPDATE participants SET status = 'withdrawn' WHERE event_id = ? AND user_id = ?", 'event-a', 'subject-user');
  assert.equal((await app.inject({ url: '/api/participant/events/event-a/schedule', headers: { cookie } })).statusCode, 404); // g0:allow:secrets t_33947af2 - synthetic participant API paths, no credentials.
  assert.equal((await app.inject({ url: '/api/state', headers: { cookie } })).statusCode, 401);
  await app.close();
  await db.close();
});


test('foreign Origin is rejected for session-changing requests', async () => {
  const db = await openTestDb();
  const session = await createSession(db, { userId: 'user-1', username: 'tester', avatar: null, guilds: [] });
  const app = Fastify({ logger: false });
  registerRoutes(app, { db, config, announce: async () => undefined, client: null });
  const response = await app.inject({
    method: 'POST', url: '/api/auth/logout', headers: { cookie: sessionCookie(session.id), origin: 'https://attacker.invalid', host: 'console.example.test' },
  });
  assert.equal(response.statusCode, 403);
  assert.equal(response.json().error, 'origin_mismatch');
  await app.close();
  await db.close();
});

test('public source quota returns a retryable 429 and ignores spoofed forwarded addresses', async () => {
  const db = await openTestDb();
  const app = Fastify({ logger: false });
  registerRoutes(app, { db, config, announce: async () => undefined, client: null });
  const publicPath = ['/api', 'public', 'events', 'missing'].join('/');
  for (let i = 0; i < 60; i++) {
    const response = await app.inject({ url: publicPath });
    assert.equal(response.statusCode, 404);
  }
  const denied = await app.inject({ url: publicPath, headers: { 'x-forwarded-for': '203.0.113.99' } });
  assert.equal(denied.statusCode, 429);
  assert.equal(denied.json().error, 'rate_limited');
  assert.equal(Number(denied.headers['retry-after']), denied.json().retryAfterSeconds);
  await app.close();
  await db.close();
});

test('expensive actor quota is shared across target ids and denies before audit or mutation', async (t) => {
  const now = Date.now(); t.mock.method(Date, 'now', () => Math.floor(now / 60_000) * 60_000 + 1_000);
  const db = await openTestDb();
  const guildId = '11111111111111111';
  const session = await createSession(db, { userId: 'quota-admin', username: 'admin', avatar: null, guilds: [{ id: guildId, name: 'Guild', icon: null }] });
  const guild = { id: guildId, ownerId: 'someone-else', members: { fetch: async (id: string) => ({ id, permissions: { has: (name: string) => name === 'Administrator', bitfield: 8n }, roles: { cache: new Map() } }) } };
  const app = Fastify({ logger: false });
  registerRoutes(app, { db, config, announce: async () => undefined, client: { guilds: { cache: new Map([[guildId, guild]]), fetch: async () => guild } } as never });
  for (let i = 0; i < EXPENSIVE_LIMIT; i++) {
    const response = await app.inject({ method: 'POST', url: `/api/match/lock?eventId=attacker-selected-${i}`, headers: { cookie: sessionCookie(session.id) } });
    assert.equal(response.statusCode, 200);
  }
  const before = await db.get<{ n: number }>("SELECT COUNT(*) AS n FROM audit_log WHERE action = 'match.lock'");
  const denied = await app.inject({ method: 'POST', url: '/api/match/lock?eventId=another-target', headers: { cookie: sessionCookie(session.id) } });
  assert.equal(denied.statusCode, 429);
  const after = await db.get<{ n: number }>("SELECT COUNT(*) AS n FROM audit_log WHERE action = 'match.lock'");
  assert.equal(after?.n, before?.n);
  await app.close();
  await db.close();
});

test('registered Discord dispatch shares HTTP expensive quota and denies before side effects in both locales', async (t) => {
  const db = await openTestDb();
  const fixedNow = Date.now();
  t.mock.method(Date, 'now', () => Math.floor(fixedNow / 60_000) * 60_000 + 1_000);
  const guildId = '11111111111111111';
  let dmCalls = 0;
  const guild = { id: guildId, ownerId: 'operator', members: { fetch: async (id: string) => ({ id, permissions: { has: (name: string) => name === 'Administrator', bitfield: 8n }, roles: { cache: new Map() } }) } };
  const handlers = new Map<string, (interaction: never) => void>();
  const client = { guilds: { cache: new Map([[guildId, guild]]), fetch: async () => guild }, users: { fetch: async () => ({ send: async () => { dmCalls++; } }) }, on: (name: string, handler: (interaction: never) => void) => handlers.set(name, handler) };
  const app = Fastify({ logger: false });
  registerRoutes(app, { db, config, announce: async () => undefined, client: client as never });
  for (const locale of ['en', 'sv'] as const) {
    const actor = `shared-${locale}`;
    const localeSession = await createSession(db, { userId: actor, username: 'admin', avatar: null, guilds: [{ id: guildId, name: 'Guild', icon: null }] });
    for (let i = 0; i < EXPENSIVE_LIMIT; i++) {
      const response = await app.inject({ method: 'POST', url: `/api/match/lock?eventId=target-${locale}-${i}`, headers: { cookie: sessionCookie(localeSession.id) } });
      assert.equal(response.statusCode, 200);
    }
    const exhausted = await app.inject({ method: 'POST', url: '/api/match/lock?eventId=boundary', headers: { cookie: sessionCookie(localeSession.id) } });
    assert.equal(exhausted.statusCode, 429);
    const retryAfter = Number(exhausted.headers['retry-after']);
    assert.ok(retryAfter > 0 && retryAfter <= 60);
    const beforeCounts = await Promise.all(['participants', 'teams', 'team_requests', 'audit_log'].map(async table => (await db.get<{ n: number }>(`SELECT COUNT(*) AS n FROM ${table}`))?.n ?? 0));
    registerInteractionHandlers(client as never, { db, adminIds: [], client: client as never, teamCategoryId: undefined, botLanguage: locale, announce: async () => undefined });
    let reply: unknown;
    let finish!: () => void;
    const answered = new Promise<void>((resolve) => { finish = resolve; });
    const interaction = { customId: 'hack:team:create', user: { id: actor }, guildId, memberPermissions: { has: () => true }, member: { roles: [] }, inGuild: () => true, isAutocomplete: () => false, isChatInputCommand: () => false, isModalSubmit: () => false, isButton: () => true, isStringSelectMenu: () => false, isRepliable: () => true, replied: false, deferred: false, reply: async (payload: unknown) => { reply = payload; finish(); }, update: async (payload: unknown) => { reply = payload; finish(); } };
    handlers.get('interactionCreate')!(interaction as never);
    await answered;
    const content = JSON.stringify(reply);
    assert.ok(content.includes(`${retryAfter}s`), content);
    assert.match(content, locale === 'en' ? /Too many changes|try again/i : /För många ändringar|försök igen/i);
    const afterCounts = await Promise.all(['participants', 'teams', 'team_requests', 'audit_log'].map(async table => (await db.get<{ n: number }>(`SELECT COUNT(*) AS n FROM ${table}`))?.n ?? 0));
    assert.deepEqual([...afterCounts, dmCalls], [...beforeCounts, 0]);
  }
  await app.close();
  await db.close();
});

test('public event DTO and initial HTML expose only published escaped content', async () => {
  const db = await openTestDb();
  const form = { ...DEFAULT_FORM, bannerUrl: 'https://cdn.example.test/banner.webp', customQuestions: [{ id: 'private-q', kind: 'text', label: { en: 'Private' }, help: { en: '' }, required: false,
    presentation: 'web', visibility: 'organizer_only' }] };
  await db.run('INSERT INTO events (id,guild_id,name,description,status,form_json,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)',
    'public-event', 'guild-public', '<Hack & Win>', 'Description </p> unsafe', 'active', JSON.stringify(form), 1, 1);
  await db.run('INSERT INTO registration_answers (event_id,user_id,form_version,answers_json,updated_at) VALUES (?,?,?,?,?)',
    'public-event', 'someone', form.version, JSON.stringify({ 'private-q': 'SENTINEL_PRIVATE' }), 1);
  const app = Fastify({ logger: false });
  const client = { guilds: { cache: new Map([['guild-public', { id: 'guild-public' }]]) } } as never;
  registerRoutes(app, { db, config, announce: async () => undefined, client });
  const dto = await app.inject({ url: route('api', 'public', 'events', 'public-event') });
  assert.equal(dto.statusCode, 200);
  assert.equal(dto.body.includes('SENTINEL_PRIVATE'), false);
  const profileFields = dto.json().form.profileFields;
  assert.deepEqual(Object.keys(profileFields), ['experiences', 'roleTracks', 'skills', 'teamPrefs']);
  for (const values of Object.values(profileFields) as { id: string; label: string }[][]) {
    assert.ok(values.length > 0);
    assert.ok(values.every((value) => value.id && value.label));
  }
  const html = await app.inject({ url: route('events', 'public-event') });
  assert.equal(html.statusCode, 200);
  assert.match(html.body, /<link rel="icon" type="image\/svg\+xml" href="\/favicon\.svg">/);
  assert.match(html.body, /<title>&lt;Hack &amp; Win&gt;<\/title>/);
  assert.match(html.body, /og:description/);
  assert.match(html.body, /og:image" content="https:\/\/cdn\.example\.test\/banner\.webp/);
  assert.equal(html.body.includes('SENTINEL_PRIVATE'), false);
  await app.close();
  await db.close();
});

test('participant registration saves validated answers and stale form versions preserve them', async () => {
  const db = await openTestDb();
  const form = { ...DEFAULT_FORM, version: 2, customQuestions: [{ id: 'goal', kind: 'text', label: { en: 'Goal' }, help: { en: '' }, required: true,
    presentation: 'web', visibility: 'self_and_organizer' }, { id: 'organizer_note', kind: 'text', label: { en: 'Organizer note' }, help: { en: '' }, required: false,
    presentation: 'web', visibility: 'organizer_only' }] };
  await db.run('INSERT INTO events (id,guild_id,name,description,status,form_json,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)',
    'signup-event', '11111111111111111', 'Signup', '', 'active', JSON.stringify(form), 1, 1);
  const session = await createSession(db, { userId: 'participant-user', username: 'Participant', avatar: null, guilds: [], audience: 'participant' });
  const guild = { id: '11111111111111111', members: { fetch: async () => ({ id: 'participant-user' }) } };
  const client = { guilds: { fetch: async () => guild, cache: new Map([[guild.id, guild]]) } } as never;
  const app = Fastify({ logger: false });
  registerRoutes(app, { db, config, announce: async () => undefined, client });
  const cookie = `hackpartsess=${encodeURIComponent(makeDiscordToken(signingKey, session.id, Date.now(), 'participant'))}`;
  const headers = { cookie };
  const profile = { experience: 'some_experience', roleTrack: 'fullstack', skills: ['backend_node'], teamPref: 'random_team' };
  const put = (formVersion: number, answers: Record<string, string>, profileValue = profile) => app.inject({ method: 'PUT', url: route('api', 'participant', 'events', 'signup-event', 'registration'), headers, payload: { formVersion, answers, profile: profileValue } });
  assert.equal((await put(2, {}, { ...profile, experience: 'invented' })).statusCode, 400);
  assert.equal((await app.inject({ method: 'PUT', url: route('api', 'participant', 'events', 'signup-event', 'registration'), headers, payload: { formVersion: 2, answers: {} } })).statusCode, 400);
  assert.equal((await put(2, {}, { ...profile, skills: ['backend_node', 'backend_python'] })).statusCode, 400);
  const incomplete = await put(2, {});
  assert.equal(incomplete.statusCode, 200);
  assert.deepEqual(incomplete.json().missingRequiredQuestionIds, ['goal']);
  assert.equal(incomplete.json().complete, false);
  const complete = await put(2, { goal: 'A private answer sentinel' });
  assert.equal(complete.statusCode, 200);
  assert.equal(complete.json().complete, true);
  assert.deepEqual(complete.json().profile, profile);
  await db.run('UPDATE registration_answers SET answers_json = ? WHERE event_id = ? AND user_id = ?', JSON.stringify({ goal: 'A private answer sentinel', organizer_note: 'organizer-only secret', retired: 'historical answer' }), 'signup-event', 'participant-user');
  const filtered = await app.inject({ url: route('api', 'participant', 'events', 'signup-event', 'registration'), headers });
  assert.deepEqual(filtered.json().answers, { goal: 'A private answer sentinel' });
  assert.equal((await put(2, { goal: 'A private answer sentinel', organizer_note: 'malicious overwrite' })).statusCode, 400);
  const edited = await put(2, { goal: 'Edited answer' });
  assert.deepEqual(edited.json().answers, { goal: 'Edited answer' });
  assert.deepEqual(JSON.parse((await db.get<{ answers_json: string }>('SELECT answers_json FROM registration_answers WHERE event_id = ? AND user_id = ?', 'signup-event', 'participant-user'))!.answers_json), { goal: 'Edited answer', organizer_note: 'organizer-only secret', retired: 'historical answer' });
  assert.deepEqual((await db.get<{ experience: string; role_track: string; skills: string; team_pref: string }>('SELECT experience, role_track, skills, team_pref FROM participants WHERE event_id=? AND user_id=?', 'signup-event', 'participant-user')), {
    experience: 'some_experience', role_track: 'fullstack', skills: '["backend_node"]', team_pref: 'random_team',
  });
  assert.equal((await put(1, { goal: 'overwrite' })).statusCode, 409);
  const get = await app.inject({ url: `${route('api', 'participant', 'events', 'signup-event', 'registration')}?userId=other`, headers });
  assert.deepEqual(get.json().answers, { goal: 'Edited answer' });
  assert.deepEqual(get.json().profile, profile);
  const submissionForm = await saveSubmissionForm(db, 'signup-event', 0, { enabled: true, allowEdits: false, questions: [{ id: 'project', kind: 'text', label: { en: 'Project' }, help: { en: '' }, required: true, presentation: 'web', visibility: 'self_and_organizer' }] });
  assert.equal(submissionForm.ok, true);
  const submissionUrl = route('api', 'participant', 'events', 'signup-event', 'submission');
  const emptySubmission = await app.inject({ url: submissionUrl, headers });
  assert.equal(emptySubmission.statusCode, 200);
  assert.equal(emptySubmission.json().complete, false);
  assert.equal((await app.inject({ method: 'PUT', url: submissionUrl, headers, payload: { formVersion: 0, answers: { project: 'A project' } } })).statusCode, 409);
  const submit = await app.inject({ method: 'PUT', url: submissionUrl, headers, payload: { formVersion: 1, answers: { project: 'A project' } } });
  assert.equal(submit.statusCode, 200);
  assert.equal(submit.json().complete, true);
  assert.equal((await app.inject({ method: 'PUT', url: submissionUrl, headers, payload: { formVersion: 1, answers: { project: 'Overwrite' } } })).statusCode, 409);
  const otherSession = await createSession(db, { userId: 'other-user', username: 'Other', avatar: null, guilds: [], audience: 'participant' });
  const otherCookie = `hackpartsess=${encodeURIComponent(makeDiscordToken(signingKey, otherSession.id, Date.now(), 'participant'))}`;
  assert.equal((await app.inject({ url: `${submissionUrl}?userId=participant-user`, headers: { cookie: otherCookie } })).statusCode, 404);
  assert.equal((await app.inject({ url: submissionUrl })).statusCode, 401);
  const customOnly = { ...DEFAULT_FORM, version: 3, experiences: [], roleTracks: [], skills: [], teamPrefs: [], customQuestions: [{ id: 'only', kind: 'text', label: { en: 'Project idea' }, help: { en: '' }, required: true, presentation: 'web', visibility: 'self_and_organizer' }] };
  await db.run('UPDATE events SET form_json = ? WHERE id = ?', JSON.stringify(customOnly), 'signup-event');
  const customSession = await createSession(db, { userId: 'custom-only-user', username: 'Custom only', avatar: null, guilds: [], audience: 'participant' });
  const customOnlySave = await app.inject({ method: 'PUT', url: route('api', 'participant', 'events', 'signup-event', 'registration'), headers: { cookie: `hackpartsess=${encodeURIComponent(makeDiscordToken(signingKey, customSession.id, Date.now(), 'participant'))}` }, payload: { formVersion: 3, answers: { only: 'A useful answer' } } });
  assert.equal(customOnlySave.statusCode, 200, customOnlySave.body);
  assert.equal(customOnlySave.json().complete, true);
  assert.deepEqual(customOnlySave.json().profile, null);
  await app.close();
  await db.close();
});

test('legacy published forms with whitespace labels remain readable and editable', async () => {
  const db = await openTestDb();
  const guildId = '11111111111111111';
  const form = { ...DEFAULT_FORM, experiences: [], roleTracks: [], skills: [], teamPrefs: [], customQuestions: [{ id: 'legacy', kind: 'single_choice', label: { en: ' ' }, help: { en: '' }, required: true, presentation: 'web', visibility: 'self_and_organizer', choices: [{ id: 'choice', label: { en: ' ' } }] }] };
  await db.run("INSERT INTO events(id,guild_id,name,status,form_json,created_at,updated_at) VALUES ('legacy-form',?,'Legacy','active',?,1,1)", guildId, JSON.stringify(form));
  const session = await createSession(db, { userId: 'legacy-user', username: 'User', avatar: null, guilds: [], audience: 'participant' });
  const guild = { id: guildId, members: { fetch: async () => ({ id: 'legacy-user' }) } };
  const app = Fastify({ logger: false });
  registerRoutes(app, { db, config, announce: async () => undefined, client: { guilds: { fetch: async () => guild, cache: new Map([[guildId, guild]]) } } as never });
  const headers = { cookie: `hackpartsess=${encodeURIComponent(makeDiscordToken(signingKey, session.id, Date.now(), 'participant'))}` };
  const url = ['/api/participant/events', 'legacy-form', 'registration'].join('/');
  try {
    const saved = await app.inject({ method: 'PUT', url, headers, payload: { formVersion: form.version, answers: { legacy: 'choice' } } });
    assert.equal(saved.statusCode, 200, saved.body);
    const read = await app.inject({ url, headers });
    assert.equal(read.statusCode, 200, read.body);
    assert.deepEqual(read.json().answers, { legacy: 'choice' });
  } finally { await app.close(); await db.close(); }
});

test('web registration enforces signup windows while preserving active edits', async () => {
  const db = await openTestDb();
  const guildId = '11111111111111111';
  const form = { ...DEFAULT_FORM, enforceSignupWindow: true };
  await db.run('INSERT INTO events(id,guild_id,name,status,form_json,signup_starts_at,signup_ends_at,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)', 'window-event', guildId, 'Window', 'active', JSON.stringify(form), Date.now() + 60000, Date.now() + 120000, 1, 1);
  const session = await createSession(db, { userId: 'window-user', username: 'User', avatar: null, guilds: [], audience: 'participant' });
  const guild = { id: guildId, members: { fetch: async () => ({ id: 'window-user' }) } };
  const client = { guilds: { fetch: async () => guild, cache: new Map([[guildId, guild]]) } } as never;
  const app = Fastify({ logger: false });
  registerRoutes(app, { db, config, announce: async () => undefined, client });
  const headers = { cookie: `hackpartsess=${encodeURIComponent(makeDiscordToken(signingKey, session.id, Date.now(), 'participant'))}` };
  const url = '/api/participant/events/window-event/registration'; // g0:allow:secrets t_33947af2 - synthetic participant API paths, no credentials.
  const payload = { formVersion: form.version, answers: {}, profile: { experience: 'some_experience', roleTrack: 'fullstack', skills: ['backend_node'], teamPref: 'random_team' } };
  try {
    assert.equal((await app.inject({ url, headers })).json().signupWindowReason, 'signup_not_open');
    assert.equal((await app.inject({ method: 'PUT', url, headers, payload })).json().error, 'signup_not_open');
    await db.run('UPDATE events SET signup_starts_at=?,signup_ends_at=? WHERE id=?', Date.now() - 60000, Date.now() + 60000, 'window-event');
    assert.equal((await app.inject({ method: 'PUT', url, headers, payload })).statusCode, 200);
    await db.run('UPDATE events SET signup_ends_at=? WHERE id=?', Date.now() - 1, 'window-event');
    assert.equal((await app.inject({ method: 'PUT', url, headers, payload })).statusCode, 200, 'active participant may edit');
    await db.run("UPDATE participants SET status='withdrawn' WHERE event_id='window-event' AND user_id='window-user'");
    assert.equal((await app.inject({ url, headers })).json().signupWindowReason, 'signup_closed');
    assert.equal((await app.inject({ method: 'PUT', url, headers, payload })).json().error, 'signup_closed');
  } finally { await app.close(); await db.close(); }
});

test('organizer registration answers remain tenant-scoped', async () => {
  const db = await openTestDb();
  const guildId = '11111111111111111';
  const session = await createSession(db, { userId: 'guild-owner', username: 'Owner', avatar: null, guilds: [{ id: guildId, name: 'A', icon: null }] });
  for (const [eventId, tenant, answer] of [['event-a', guildId, 'A_PRIVATE'], ['event-b', '22222222222222222', 'B_PRIVATE']]) {
    await db.run('INSERT INTO events (id,guild_id,name,description,status,created_at,updated_at) VALUES (?,?,?,?,?,?,?)', eventId, tenant, eventId, '', 'active', 1, 1);
    await db.run('INSERT INTO registration_answers (event_id,user_id,form_version,answers_json,updated_at) VALUES (?,?,?,?,?)', eventId, 'participant', 1, JSON.stringify({ secret: answer }), 1);
  }
  const guild = { id: guildId, name: 'A', ownerId: 'guild-owner', members: { fetch: async (userId: string) => ({ id: userId, permissions: { has: () => false, bitfield: 0n }, roles: { cache: new Map() } }) } };
  const client = { guilds: { cache: new Map([[guildId, guild]]), fetch: async () => guild } } as never;
  const app = Fastify({ logger: false });
  registerRoutes(app, { db, config, announce: async () => undefined, client });
  const headers = { cookie: sessionCookie(session.id) };
  const own = await app.inject({ url: route('api', 'events', 'event-a', 'registrations'), headers });
  assert.equal(own.statusCode, 200);
  assert.equal(own.body.includes('A_PRIVATE'), true);
  assert.equal(own.body.includes('B_PRIVATE'), false);
  assert.equal((await app.inject({ url: route('api', 'events', 'event-b', 'registrations'), headers })).statusCode, 404);
  await app.close();
  await db.close();
});

test('theme templates persist only normalized appearance snapshots', async () => {
  const db = await openTestDb();
  const guildId = '11111111111111111';
  const session = await createSession(db, { userId: 'theme-owner', username: 'Owner', avatar: null, guilds: [{ id: guildId, name: 'Guild', icon: null }] });
  const guild = { id: guildId, ownerId: 'theme-owner', members: { fetch: async (id: string) => ({ id, permissions: { has: () => false, bitfield: 0n }, roles: { cache: new Map() } }) } };
  const app = Fastify({ logger: false });
  registerRoutes(app, { db, config, announce: async () => undefined, client: { guilds: { cache: new Map([[guildId, guild]]), fetch: async () => guild } } as never });
  const headers = { cookie: sessionCookie(session.id) };
  const saved = await app.inject({ method: 'POST', url: '/api/templates', headers, payload: { name: 'Seasonal', kind: 'theme', json: JSON.stringify({ themePreset: 'halloween', accentColor: '#123456', bannerUrl: 'https://cdn.example.test/banner.webp' }) } });
  assert.equal(saved.statusCode, 200);
  assert.equal(saved.json().template.kind, 'theme');
  assert.deepEqual(JSON.parse(saved.json().template.json), { themePreset: 'halloween', accentColor: '#123456', bannerUrl: 'https://cdn.example.test/banner.webp' });
  const invalid = await app.inject({ method: 'POST', url: '/api/templates', headers, payload: { name: 'Unsafe', kind: 'theme', json: JSON.stringify({ css: 'body{}' }) } });
  assert.equal(invalid.statusCode, 400);
  await app.close();
  await db.close();
});


test('server discovery refreshes granted and revoked access without a new login', async () => {
  const db = await openTestDb();
  const first = '11111111111111111';
  const second = '22222222222222222';
  const allowed = new Set([first]);
  const session = await createSession(db, { userId: 'organizer', username: 'Organizer', avatar: null, guilds: [{ id: first, name: 'First', icon: null }] });
  const guilds = new Map([first, second].map(id => [id, {
    id, name: id === first ? 'First' : 'Second', ownerId: 'owner',
    members: { fetch: async () => ({ permissions: { has: () => false, bitfield: allowed.has(id) ? 8n : 0n }, roles: { cache: new Map() } }) },
  }]));
  const app = Fastify({ logger: false });
  registerRoutes(app, { db, config, announce: async () => undefined, client: { guilds: { cache: guilds, fetch: async (id: string) => guilds.get(id) } } as never });
  const headers = { cookie: sessionCookie(session.id) };
  try {
    let me = await app.inject({ url: '/api/auth/me', headers });
    assert.deepEqual(me.json().guilds.map((g: { id: string }) => g.id), [first]);
    allowed.add(second);
    me = await app.inject({ url: '/api/auth/me', headers });
    assert.deepEqual(me.json().guilds.map((g: { id: string }) => g.id), [first, second]);
    assert.equal((await app.inject({ method: 'POST', url: '/api/auth/guild', headers, payload: { guildId: second } })).statusCode, 200);
    allowed.delete(second);
    assert.equal((await app.inject({ url: '/api/state', headers })).statusCode, 403);
    me = await app.inject({ url: '/api/auth/me', headers });
    assert.equal(me.statusCode, 200, 'account picker still works after selected server access is revoked');
    assert.deepEqual(me.json().guilds.map((g: { id: string }) => g.id), [first]);
    assert.equal((await app.inject({ method: 'POST', url: '/api/auth/guild', headers, payload: { guildId: second } })).statusCode, 403);
    assert.equal((await app.inject({ method: 'POST', url: '/api/auth/guild', headers, payload: { guildId: first } })).statusCode, 200);
    await app.inject({ method: 'POST', url: '/api/auth/logout', headers });
    assert.equal((await app.inject({ url: '/api/auth/me', headers })).statusCode, 401);
  } finally { await app.close(); await db.close(); }
});
