import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import Fastify from 'fastify';
import type { Db } from '../../shared/db.js';
import type { Env } from '../../shared/env.js';
import { openTestDb } from '../../shared/test-db.js';
import { DEFAULT_FORM } from '../form/domain.js';
import { createTeam, joinTeam, adminAssign, getTeam, joinPrivateTeam } from './data.js';
import { createJoinRequest, createInvite, decideRequest } from './requests-data.js';
import { setMembershipLookup } from '../signup/eligibility.js';
import { blockParticipant } from '../signup/data.js';
import { deleteGuildMemberData } from '../signup/departures.js';
import { previewMatch, commitMatch } from '../matching/data.js';
import { createSession, getSession } from '../auth/data.js';
import { makeDiscordToken } from '../auth/domain.js';
import { registerRoutes } from '../../adminweb/routes.js';
import { handleUserCommand } from '../../discord/user-commands.js';
import { onComponent } from '../../discord/components.js';
import { IDS, type Ctx } from '../../discord/shared.js';
import { t } from '../../shared/i18n.js';

const GUILD = '11111111111111111';
async function seedUser(db: Db, user: string, at = 1) {
  await db.run("INSERT INTO participants (event_id,user_id,guild_id,display_name,experience,role_track,skills,team_pref,teammates,status,created_at,updated_at) VALUES ('ev',?,?,?,'some_experience','backend','[]','random_team','[]','active',?,1)", user, GUILD, user, at);
}
async function fixture(users = ['owner', 'member', 'other'], size = 2) {
  const db = await openTestDb();
  await db.run("INSERT INTO events (id,guild_id,name,status,form_json,created_at,updated_at) VALUES ('ev',?,'Repair','active',?,1,1)", GUILD, JSON.stringify({ ...DEFAULT_FORM, teamSize: size }));
  for (const user of users) await seedUser(db, user);
  return db;
}

// QA1: real authenticated organizer route, not just the service's supplied size.
test('QA1 organizer HTTP refuses pinned-capacity overflow without any writes', async () => {
  const db = await fixture();
  const app = Fastify();
  try {
    await db.run('INSERT INTO form_config (guild_id,json,updated_at) VALUES (?,?,1)', GUILD, JSON.stringify({ ...DEFAULT_FORM, teamSize: 4 }));
    const guild = { id: GUILD, ownerId: 'admin', members: { fetch: async () => ({ permissions: { has: () => false, bitfield: 0n }, roles: { cache: new Map() } }) } };
    const key = 'repair-test-signing-key-32-characters';
    registerRoutes(app, { db, config: { adminSessionSecret: key, adminIds: [], botLanguage: 'en', skipDiscord: true } as unknown as Env, client: { guilds: { fetch: async () => guild } } as never, announce: async () => undefined });
    const team = await createTeam(db, 'test', 'ev', GUILD, 'Alpha', 'public', 'owner');
    assert.ok(team.ok);
    assert.ok((await joinTeam(db, 'test', 'ev', 'member', team.value.id, 2)).ok);
    const session = await createSession(db, { userId: 'admin', username: 'Admin', avatar: null, guilds: [{ id: GUILD, name: 'A', icon: null }] });
    const audit = await db.all('SELECT * FROM audit_log ORDER BY id');
    const response = await app.inject({ method: 'POST', url: '/api/participants/other/team', headers: { cookie: `hacksess=${encodeURIComponent(makeDiscordToken(key, session.id))}` }, payload: { eventId: 'ev', teamId: team.value.id } });
    assert.equal(response.statusCode, 400, response.body);
    assert.equal(response.json().code, 'team_full');
    assert.equal((await db.get<{ team_id: string | null }>("SELECT team_id FROM participants WHERE user_id='other'"))!.team_id, null);
    assert.deepEqual(await db.all('SELECT * FROM audit_log ORDER BY id'), audit);
    assert.deepEqual(await db.all('SELECT * FROM team_requests'), []);
  } finally { await app.close(); await db.close(); }
});

for (const operation of ['join', 'code', 'invite', 'request', 'assign'] as const) test(`QA1 ${operation} uses affected event capacity rather than caller default`, async () => {
  const db = await fixture(['owner', 'member', 'other'], 3);
  try {
    const team = await createTeam(db, 'test', 'ev', GUILD, 'Alpha', operation === 'join' || operation === 'assign' ? 'public' : 'private', 'owner');
    assert.ok(team.ok);
    let requestId = 0;
    if (operation === 'invite' || operation === 'request') {
      const request = operation === 'invite' ? await createInvite(db, 'discord:owner', 'ev', GUILD, team.value.id, 'other', 4) : await createJoinRequest(db, 'discord:other', 'ev', GUILD, 'other', team.value.id, 4);
      assert.ok(request.ok);
      requestId = request.value.id;
    }
    assert.ok((await adminAssign(db, 'test', 'ev', 'member', team.value.id, 4)).ok);
    await db.run('UPDATE events SET form_json=? WHERE id=?', JSON.stringify({ ...DEFAULT_FORM, teamSize: 2 }), 'ev');
    const audit = await db.all('SELECT * FROM audit_log ORDER BY id');
    const requests = await db.all('SELECT * FROM team_requests ORDER BY id');
    const result = operation === 'join' ? await joinTeam(db, 'discord:other', 'ev', 'other', team.value.id, 4)
      : operation === 'code' ? await joinPrivateTeam(db, 'discord:other', 'ev', 'other', team.value.joinCode!, 4)
      : operation === 'assign' ? await adminAssign(db, 'test', 'ev', 'other', team.value.id, 4)
      : await decideRequest(db, operation === 'invite' ? 'discord:other' : 'discord:owner', requestId, 'accept', 4);
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, 'team_full');
    assert.deepEqual(await db.all('SELECT * FROM audit_log ORDER BY id'), audit);
    assert.deepEqual(await db.all('SELECT * FROM team_requests ORDER BY id'), requests);
    assert.equal((await db.get<{ team_id: string | null }>("SELECT team_id FROM participants WHERE user_id='other'"))!.team_id, null);
  } finally { await db.close(); }
});

for (const state of ['blocked', 'incomplete', 'absent', 'lookup-error', 'detached'] as const) test(`QA2 ${state} owner cannot accept a join request`, async () => {
  const db = await fixture();
  try {
    if (state === 'incomplete') {
      const form = { ...DEFAULT_FORM, teamSize: 2, customQuestions: [{ id: 'required', kind: 'text', label: { en: 'Required' }, help: { en: '' }, required: true, presentation: 'web', visibility: 'self_and_organizer' }] };
      await db.run("UPDATE events SET form_json=? WHERE id='ev'", JSON.stringify(form));
      for (const user of ['owner', 'member']) await db.run("INSERT INTO registration_answers VALUES ('ev',?,1,?,1)", user, JSON.stringify({ required: 'done' }));
    }
    const team = await createTeam(db, 'test', 'ev', GUILD, 'Alpha', 'private', 'owner');
    assert.ok(team.ok);
    const request = await createJoinRequest(db, 'discord:member', 'ev', GUILD, 'member', team.value.id, 2);
    assert.ok(request.ok);
    if (state === 'blocked') assert.ok((await blockParticipant(db, 'test', 'ev', 'owner', 'blocked')).ok);
    if (state === 'incomplete') await db.run("DELETE FROM registration_answers WHERE user_id='owner'");
    if (state === 'detached') await db.run("UPDATE participants SET team_id=NULL WHERE user_id='owner'");
    if (state === 'absent' || state === 'lookup-error') setMembershipLookup(db, async (_guild, user) => { if (user !== 'owner') return true; if (state === 'lookup-error') throw new Error('unavailable'); return false; });
    const before = await db.all('SELECT * FROM audit_log ORDER BY id');
    const result = await decideRequest(db, 'discord:owner', request.value.id, 'accept', 2);
    assert.equal(result.ok, false);
    assert.equal((await db.get<{ status: string }>('SELECT status FROM team_requests WHERE id=?', request.value.id))!.status, 'pending');
    assert.equal((await db.get<{ team_id: string | null }>("SELECT team_id FROM participants WHERE user_id='member'"))!.team_id, null);
    assert.deepEqual(await db.all('SELECT * FROM audit_log ORDER BY id'), before);
  } finally { await db.close(); }
});

for (const detach of ['organizer', 'blocked', 'legacy'] as const) test(`QA3 ${detach} detached owner departure preserves eligible successor`, async () => {
  const db = await fixture();
  try {
    const team = await createTeam(db, 'test', 'ev', GUILD, 'Alpha', 'public', 'owner');
    assert.ok(team.ok);
    assert.ok((await joinTeam(db, 'test', 'ev', 'member', team.value.id, 2)).ok);
    if (detach === 'organizer') {
      assert.ok((await adminAssign(db, 'web', 'ev', 'owner', null, 2)).ok);
      assert.equal((await getTeam(db, team.value.id))?.ownerId, 'member');
    } else if (detach === 'blocked') await blockParticipant(db, 'web', 'ev', 'owner', 'blocked');
    else await db.run("UPDATE participants SET team_id=NULL WHERE user_id='owner'");
    await deleteGuildMemberData(db, GUILD, 'owner');
    assert.equal((await getTeam(db, team.value.id))?.ownerId, 'member');
    assert.equal((await db.get<{ team_id: string }>("SELECT team_id FROM participants WHERE user_id='member'"))!.team_id, team.value.id);
  } finally { await db.close(); }
});

test('QA3 detached owner with no eligible successor returns deleted resources', async () => {
  const db = await fixture(['owner']);
  try {
    const team = await createTeam(db, 'test', 'ev', GUILD, 'Alpha', 'private', 'owner');
    assert.ok(team.ok);
    await db.run("UPDATE participants SET team_id=NULL WHERE user_id='owner'");
    await db.run("UPDATE teams SET role_id='role' WHERE id=?", team.value.id);
    const deleted = await deleteGuildMemberData(db, GUILD, 'owner');
    assert.equal(await getTeam(db, team.value.id), null);
    assert.equal(deleted[0]?.roleId, 'role');
  } finally { await db.close(); }
});

for (const operation of ['leave', 'move-select'] as const) for (const remaining of [false, true]) test(`QA4 Discord ${operation} revokes leaver and ${remaining ? 'preserves surviving' : 'destroys empty'} resources`, async () => {
  const db = await fixture();
  const deleted: string[] = [];
  const revoked: string[] = [];
  try {
    const team = await createTeam(db, 'test', 'ev', GUILD, 'Alpha', 'private', 'owner');
    assert.ok(team.ok);
    if (remaining) assert.ok((await adminAssign(db, 'web', 'ev', 'member', team.value.id, 2)).ok);
    await db.run("UPDATE teams SET role_id='role',text_channel_id='text',voice_channel_id='voice' WHERE id=?", team.value.id);
    const guild = { channels: { delete: async (id: string) => deleted.push(id) }, roles: { fetch: async () => ({ delete: async () => deleted.push('role') }) }, members: { fetch: async (user: string) => ({ roles: { cache: new Map([['role', {}]]), remove: async () => revoked.push(user) } }) } };
    const ctx = { db, actor: 'discord:owner', eventId: 'ev', guildId: GUILD, config: DEFAULT_FORM, botLocale: 'en', hasActiveEvent: true, isAdmin: true, client: { guilds: { fetch: async () => guild } }, categoryIdFor: () => undefined } as unknown as Ctx;
    if (operation === 'leave') await handleUserCommand({ user: { id: 'owner' }, reply: async () => undefined } as never, ctx, 'leave-team');
    else await onComponent({ customId: `${IDS.adminMoveSelect}:owner`, values: ['__none__'], update: async () => undefined } as never, ctx as Ctx & { announce: () => Promise<void> });
    assert.deepEqual(revoked, ['owner']);
    assert.deepEqual(deleted.sort(), remaining ? [] : ['role', 'text', 'voice']);
    assert.equal((await getTeam(db, team.value.id))?.ownerId ?? null, remaining ? 'member' : null);
  } finally { await db.close(); }
});

test('QA5 fresh same-choice rejoin changes allocation revision and rejects old preview without writes', async () => {
  const db = await fixture(['one', 'two', 'three']);
  try {
    await db.run("UPDATE participants SET created_at=CASE user_id WHEN 'one' THEN 1 WHEN 'two' THEN 2 ELSE 3 END");
    const before = await previewMatch(db, 'ev', DEFAULT_FORM);
    assert.ok(before.ok);
    await deleteGuildMemberData(db, GUILD, 'one');
    await seedUser(db, 'one', 10);
    const after = await previewMatch(db, 'ev', DEFAULT_FORM);
    assert.ok(after.ok);
    assert.notDeepEqual(after.value.teams, before.value.teams);
    const result = await commitMatch(db, 'test', 'ev', GUILD, DEFAULT_FORM, before.value.revision);
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, 'stale_preview');
    assert.notEqual(after.value.revision, before.value.revision);
    assert.deepEqual(await db.all('SELECT * FROM teams'), []);
    assert.deepEqual(await db.all('SELECT * FROM participants WHERE team_id IS NOT NULL'), []);
  } finally { await db.close(); }
});

test('QA6 departure removes A session metadata while preserving selected B access', async () => {
  const db = await fixture(['owner']);
  try {
    const session = await createSession(db, { userId: 'owner', username: 'Owner', avatar: null, guilds: [{ id: 'b', name: 'B', icon: null }, { id: GUILD, name: 'A', icon: null }] });
    const unrelated = await createSession(db, { userId: 'other', username: 'Other', avatar: null, guilds: [{ id: GUILD, name: 'A', icon: null }] });
    await deleteGuildMemberData(db, GUILD, 'owner');
    await deleteGuildMemberData(db, GUILD, 'owner');
    const after = await getSession(db, session.id);
    assert.ok(after);
    assert.equal(after.selectedGuildId, 'b');
    assert.deepEqual(after.guilds, [{ id: 'b', name: 'B', icon: null }]);
    assert.deepEqual((await getSession(db, unrelated.id))?.guilds, [{ id: GUILD, name: 'A', icon: null }]);
  } finally { await db.close(); }
});

test('QA7 Swedish invitation refusal uses localized error presentation', async () => {
  const db = await fixture();
  let response: unknown;
  try {
    const team = await createTeam(db, 'test', 'ev', GUILD, 'Alpha', 'private', 'owner');
    assert.ok(team.ok);
    const invite = await createInvite(db, 'discord:owner', 'ev', GUILD, team.value.id, 'member', 2);
    assert.ok(invite.ok);
    await blockParticipant(db, 'web', 'ev', 'member', 'blocked');
    const ctx = { db, actor: 'discord:member', eventId: 'ev', guildId: GUILD, config: DEFAULT_FORM, botLocale: 'sv' } as Ctx & { announce: () => Promise<void> };
    await onComponent({ customId: `${IDS.reqAccept}:${invite.value.id}`, user: { id: 'member' }, update: async (payload: unknown) => { response = payload; } } as never, ctx);
    assert.ok(JSON.stringify(response).includes(t('sv', 'errors.ineligible')), JSON.stringify(response));
    assert.equal(JSON.stringify(response).includes('Complete an active registration'), false);
  } finally { await db.close(); }
});

for (const [locale, preservation, eligible] of [
  ['en', 'Existing teams stay together.', 'eligible, unteamed participants who opted into matching'],
  ['sv', 'Befintliga team hålls ihop.', 'behöriga deltagare utan team som har valt matchning'],
]) test(`QA8 ${locale} confirmation discloses preservation and eligible unmatched allocation`, async () => {
  const catalog = JSON.parse(await readFile(new URL(`../../../../admin-ui/src/lib/i18n/${locale}.json`, import.meta.url), 'utf8')) as Record<string, string>;
  assert.ok(catalog['matching.commit_desc']?.includes(preservation!));
  assert.ok(catalog['matching.commit_desc']?.includes(eligible!));
});
