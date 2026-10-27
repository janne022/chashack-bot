import assert from 'node:assert/strict';
import test from 'node:test';
import Fastify from 'fastify';
import { makeDiscordToken } from '../features/auth/domain.js';
import { createSession } from '../features/auth/data.js';
import { createEvent } from '../features/events/data.js';
import { DEFAULT_FORM } from '../features/form/domain.js';
import { openTestDb } from '../shared/test-db.js';
import { withGuildContext } from '../shared/postgres.js';
import type { Db } from '../shared/db.js';
import type { Env } from '../shared/env.js';
import { registerRoutes } from './routes.js';

const secret = 'x'.repeat(48);
const guildId = '11111111111111111';
const otherGuildId = '22222222222222222';
const ADA = '12345678901234567';
const BOB = '22345678901234567';
const CAROL = '32345678901234567';
const members = [ADA, BOB, CAROL];

const memberFake = (id: string) => ({ id, permissions: { has: () => false, bitfield: 0n }, roles: { cache: new Map() } });

async function setup() {
  const db = await openTestDb();
  const session = await createSession(db, { userId: '99999999999999999', username: 'Organizer', avatar: null, guilds: [{ id: guildId, name: 'Guild', icon: null }] });
  const guild = {
    id: guildId, name: 'Guild', ownerId: session.userId,
    members: { fetch: async (id: string | { user: string }) => {
      const userId = typeof id === 'string' ? id : id.user;
      if (userId !== session.userId && !members.includes(userId)) throw new Error('Unknown Member');
      return memberFake(userId);
    } },
  };
  const otherGuild = { ...guild, id: otherGuildId, ownerId: 'someone-else' };
  const client = { guilds: { cache: new Map([[guildId, guild], [otherGuildId, otherGuild]]), fetch: async (id: string) => id === otherGuildId ? otherGuild : guild } } as never;
  const app = Fastify({ logger: false });
  registerRoutes(app, { db, config: { adminSessionSecret: secret, adminIds: [], botLanguage: 'en' } as unknown as Env, client, announce: async () => undefined });
  const headers = { cookie: `hacksess=${encodeURIComponent(makeDiscordToken(secret, session.id))}` };
  return { db, app, headers, close: async () => { await app.close(); await db.close(); } };
}

async function newEvent(db: Db, guild: string, name: string): Promise<string> {
  const created = await withGuildContext(db, guild, () => createEvent(db, 'test', guild, { name, form: DEFAULT_FORM }));
  assert.equal(created.ok, true);
  if (!created.ok) throw new Error('event not created');
  return created.value.id;
}

/** Seed an imported row as it looks after a sheet import, without going through a CSV. */
let seededRow = 0;
async function insertRow(db: Db, eventId: string, id: string, values: Record<string, string>, formVersion = 1, guild = guildId): Promise<void> {
  await withGuildContext(db, guild, () => db.run(`INSERT INTO imported_signups (id,event_id,guild_id,source_row,source_timestamp,form_version,values_json,answers_json,created_at,updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?)`, id, eventId, guild, ++seededRow, '', formVersion, JSON.stringify(values), '{}', Date.now(), Date.now()));
}

const linkPatch = (app: Awaited<ReturnType<typeof setup>>['app'], eventId: string, id: string, payload: Record<string, unknown>, headers: Record<string, string>) =>
  app.inject({ method: 'PATCH', url: `/api/events/${eventId}/imported-signups/${id}`, headers, payload });

const ADA_ROW = { name: 'Ada Andersson', email: 'ada@example.test', experience: 'first_timer', skills: 'frontend_react', teamPref: 'random_team' };
const BOB_ROW = { name: 'Bob Bsson', email: 'bob@example.test', experience: 'veteran', skills: 'backend_node', teamPref: 'join_team' };
const CAROL_ROW = { name: 'Carol Csson', email: 'carol@example.test', experience: 'some_experience', skills: 'devops', teamPref: 'random_team' };

test('an organizer can link on a draft event, adopt a registration and re-bind a row', async () => {
  const { db, app, headers, close } = await setup();
  try {
    const eventId = await newEvent(db, guildId, 'Draft linking');
    await insertRow(db, eventId, 'row-ada', ADA_ROW);
    await insertRow(db, eventId, 'row-bob', BOB_ROW);
    await insertRow(db, eventId, 'row-carol', CAROL_ROW);

    // Pre-registering people before launch is an organizer action, not an error.
    const draft = await linkPatch(app, eventId, 'row-ada', { linkDiscordUserId: ADA }, headers);
    assert.equal(draft.statusCode, 200, draft.body);
    assert.equal(draft.json().activated, true);
    assert.equal(draft.json().error, undefined);
    assert.equal((await withGuildContext(db, guildId, () => db.get<{ user_id: string }>('SELECT user_id FROM participants WHERE event_id=?', eventId)))?.user_id, ADA);

    // Bob already signed up through the web form; linking his import adopts that
    // row instead of creating a second participant or answering a conflict.
    await withGuildContext(db, guildId, () => db.run(`INSERT INTO participants (event_id,user_id,guild_id,display_name,experience,role_track,skills,team_pref,teammates,status,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,'[]','active',?,?)`, eventId, BOB, guildId, 'Bob Bsson', 'veteran', 'backend', '["backend_node"]', 'join_team', Date.now(), Date.now()));
    const adopted = await linkPatch(app, eventId, 'row-bob', { linkDiscordUserId: BOB }, headers);
    assert.equal(adopted.statusCode, 200, adopted.body);
    assert.equal(adopted.json().activated, true);
    assert.equal(adopted.json().alreadyRegistered, true);
    const bobRows = await withGuildContext(db, guildId, () => db.get<{ count: string }>('SELECT COUNT(*) AS count FROM participants WHERE event_id=? AND user_id=?', eventId, BOB));
    assert.equal(Number(bobRows?.count), 1);

    // Correcting a mis-linked row: the same row may move to another member.
    const rebound = await linkPatch(app, eventId, 'row-bob', { linkDiscordUserId: CAROL }, headers);
    assert.equal(rebound.statusCode, 200, rebound.body);
    assert.equal((await withGuildContext(db, guildId, () => db.get<{ discord_user_id: string }>('SELECT discord_user_id FROM imported_signups WHERE id=?', 'row-bob')))?.discord_user_id, CAROL);

    // A member already claimed by another row is still a duplicate worth stopping.
    const duplicate = await linkPatch(app, eventId, 'row-carol', { linkDiscordUserId: CAROL }, headers);
    assert.equal(duplicate.statusCode, 400, duplicate.body);
    assert.equal(duplicate.json().error, 'identity_conflict');
    assert.equal(typeof duplicate.json().message, 'string');
  } finally { await close(); }
});

test('a stale imported row is re-normalized against the current form instead of failing the link', async () => {
  const { db, app, headers, close } = await setup();
  try {
    const eventId = await newEvent(db, guildId, 'Stale row');
    await insertRow(db, eventId, 'row-stale', {
      name: 'Ada Andersson',
      experience: 'retired_experience',
      skills: 'frontend_react, telepathy',
      teamPref: 'dance_off',
    }, 0);

    const linked = await linkPatch(app, eventId, 'row-stale', { linkDiscordUserId: ADA }, headers);
    assert.equal(linked.statusCode, 200, linked.body);
    assert.equal(linked.json().activated, true);
    assert.ok((linked.json().warnings as string[]).length > 0, linked.body);

    const stored = await withGuildContext(db, guildId, () => db.get<{ values_json: string; form_version: number }>('SELECT values_json,form_version FROM imported_signups WHERE id=?', 'row-stale'));
    assert.equal(stored?.form_version, DEFAULT_FORM.version);
    const values = JSON.parse(stored!.values_json) as Record<string, string>;
    assert.equal(values.experience, undefined);
    assert.equal(values.teamPref, undefined);
    assert.equal(values.skills, 'frontend_react');
  } finally { await close(); }
});

test('a CSV group name becomes one team: the first linked member owns it, the rest join', async () => {
  const { db, app, headers, close } = await setup();
  try {
    const eventId = await newEvent(db, guildId, 'Group teams');
    await insertRow(db, eventId, 'row-ada', { ...ADA_ROW, groupName: 'Group A' });
    await insertRow(db, eventId, 'row-bob', { ...BOB_ROW, groupName: '  group   a ' });
    await insertRow(db, eventId, 'row-carol', { ...CAROL_ROW, groupName: 'Group B' });

    const first = await linkPatch(app, eventId, 'row-ada', { linkDiscordUserId: ADA }, headers);
    assert.equal(first.statusCode, 200, first.body);
    assert.equal(first.json().groupTeam.created, true);
    const teamId = first.json().groupTeam.teamId as string;

    // Case, spacing and exact wording of the group name all resolve to the same team.
    const second = await linkPatch(app, eventId, 'row-bob', { linkDiscordUserId: BOB }, headers);
    assert.equal(second.statusCode, 200, second.body);
    assert.equal(second.json().groupTeam.created, false);
    assert.equal(second.json().groupTeam.teamId, teamId);

    const third = await linkPatch(app, eventId, 'row-carol', { linkDiscordUserId: CAROL }, headers);
    assert.equal(third.statusCode, 200, third.body);
    assert.equal(third.json().groupTeam.created, true);
    assert.notEqual(third.json().groupTeam.teamId, teamId);

    const teams = await withGuildContext(db, guildId, () => db.all<{ id: string; name: string; kind: string; owner_id: string | null; join_code: string | null }>('SELECT id,name,kind,owner_id,join_code FROM teams WHERE event_id=? ORDER BY name', eventId));
    assert.equal(teams.length, 2, JSON.stringify(teams));
    assert.deepEqual(teams.map(team => team.name), ['Group A', 'Group B']);
    assert.deepEqual(teams.map(team => team.kind), ['private', 'private']);
    assert.equal(teams[0]!.owner_id, ADA);
    assert.ok(teams[0]!.join_code, 'a group team needs a join code');

    const placed = await withGuildContext(db, guildId, () => db.all<{ user_id: string; team_id: string }>('SELECT user_id,team_id FROM participants WHERE event_id=? ORDER BY user_id', eventId));
    assert.deepEqual(placed.map(row => row.team_id), [teamId, teamId, third.json().groupTeam.teamId]);
  } finally { await close(); }
});

test('deleting imported signups removes the paperwork, never the participant', async () => {
  const { db, app, headers, close } = await setup();
  try {
    const eventId = await newEvent(db, guildId, 'Import cleanup');
    await insertRow(db, eventId, 'row-ada', ADA_ROW);
    await insertRow(db, eventId, 'row-bob', BOB_ROW);
    await insertRow(db, eventId, 'row-carol', CAROL_ROW);
    const linked = await linkPatch(app, eventId, 'row-ada', { linkDiscordUserId: ADA }, headers);
    assert.equal(linked.statusCode, 200, linked.body);

    const single = await app.inject({ method: 'DELETE', url: `/api/events/${eventId}/imported-signups/row-ada`, headers });
    assert.equal(single.statusCode, 200, single.body);
    assert.equal(single.json().deleted, 1);
    assert.equal(await withGuildContext(db, guildId, () => db.get('SELECT id FROM imported_signups WHERE id=?', 'row-ada')), undefined);
    assert.equal((await withGuildContext(db, guildId, () => db.get<{ user_id: string }>('SELECT user_id FROM participants WHERE event_id=? AND user_id=?', eventId, ADA)))?.user_id, ADA);
    assert.ok(await withGuildContext(db, guildId, () => db.get('SELECT user_id FROM registration_answers WHERE event_id=? AND user_id=?', eventId, ADA)));

    const bulk = await app.inject({ method: 'POST', url: `/api/events/${eventId}/imported-signups/delete`, headers, payload: { ids: ['row-bob', 'row-carol'] } });
    assert.equal(bulk.statusCode, 200, bulk.body);
    assert.equal(bulk.json().deleted, 2);
    assert.equal(Number((await withGuildContext(db, guildId, () => db.get<{ count: string }>('SELECT COUNT(*) AS count FROM imported_signups WHERE event_id=?', eventId)))?.count), 0);

    for (const payload of [{ ids: [] }, { ids: ['ok', 5] }, { ids: Array.from({ length: 201 }, (_, index) => `row-${index}`) }, {}]) {
      const invalid = await app.inject({ method: 'POST', url: `/api/events/${eventId}/imported-signups/delete`, headers, payload });
      assert.equal(invalid.statusCode, 400, `${JSON.stringify(payload).slice(0, 40)}: ${invalid.body}`);
    }

    // Another guild's rows stay invisible and undeletable.
    const foreignEvent = await newEvent(db, otherGuildId, 'Other tenant');
    await insertRow(db, foreignEvent, 'foreign-row', ADA_ROW, 1, otherGuildId);
    const foreignSingle = await app.inject({ method: 'DELETE', url: `/api/events/${foreignEvent}/imported-signups/foreign-row`, headers });
    assert.equal(foreignSingle.statusCode, 404);
    const foreignBulk = await app.inject({ method: 'POST', url: `/api/events/${foreignEvent}/imported-signups/delete`, headers, payload: { ids: ['foreign-row'] } });
    assert.equal(foreignBulk.statusCode, 404);
    const foreignEventUrl = `/api/events/${eventId}/imported-signups/foreign-row`;
    assert.equal((await app.inject({ method: 'DELETE', url: foreignEventUrl, headers })).statusCode, 404);
    assert.ok(await withGuildContext(db, otherGuildId, () => db.get('SELECT id FROM imported_signups WHERE id=?', 'foreign-row')));

    const audited = await withGuildContext(db, guildId, () => db.get<{ count: string }>("SELECT COUNT(*) AS count FROM audit_log WHERE action='imported_signup.delete'"));
    assert.ok(Number(audited?.count ?? 0) >= 2);
  } finally { await close(); }
});
