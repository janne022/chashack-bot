import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Events, type Client } from 'discord.js';
import { openTestDb } from '../shared/test-db.js';
import { lookupGuildMember, registerMemberLifecycle } from './member-lifecycle.js';
import { DEFAULT_FORM } from '../features/form/domain.js';
import { createImportedSignups, listImportedSignups } from '../features/signup-import/data.js';
import { importedParticipantId, reconcileImportedParticipants } from '../features/signup-import/sync.js';
import { getParticipant } from '../features/signup/data.js';
import { listPendingTeamProvisionIds } from '../features/teams/provision-data.js';

 test('gateway departure deletes immediately; offline errors and bot absence are not member departure', async () => {
  const db = await openTestDb();
  const handlers = new Map<string, (...args: any[]) => unknown>();
  let failure: unknown = null;
  const guild = { id: 'g', available: true, members: { fetch: async () => { if (failure) throw failure; return { id: 'user' }; } } };
  const client = { on: (name: string, fn: (...args: any[]) => unknown) => handlers.set(name, fn), guilds: { cache: new Map([['g', guild]]), fetch: async () => guild } } as unknown as Client;
  try {
    await db.run("INSERT INTO events (id,guild_id,name,status,created_at,updated_at) VALUES ('ev','g','test','active',1,1)");
    const seed = () => db.run("INSERT INTO participants (event_id,user_id,guild_id,display_name,experience,role_track,skills,team_pref,teammates,status,created_at,updated_at) VALUES ('ev','user','g','Name','','','[]','','[]','active',1,1)");
    await seed();
    const reconcile = registerMemberLifecycle(db, client);
    failure = { code: 50013 };
    await assert.rejects(() => lookupGuildMember(client, 'g', 'user'));
    await reconcile();
    assert.equal((await db.all('SELECT * FROM participants')).length, 1);
    failure = { code: 10007 };
    assert.equal(await lookupGuildMember(client, 'g', 'user'), false);
    await reconcile();
    assert.equal((await db.all('SELECT * FROM participants')).length, 0);
    await seed();
    await handlers.get(Events.GuildMemberRemove)!({ guild: { id: 'g' }, id: 'user' });
    assert.equal((await db.all('SELECT * FROM participants')).length, 0);
    assert.ok(handlers.has(Events.ClientReady));
    assert.ok(handlers.has(Events.ShardResume));
    assert.equal(handlers.has(Events.GuildDelete), false);
  } finally { await db.close(); }
});

test('joining and reconnecting link only unique imported usernames and preserve teams', async () => {
  const db = await openTestDb();
  const handlers = new Map<string, (...args: any[]) => unknown>();
  const userId = '12345678901234567';
  const otherId = '22345678901234567';
  const catchupId = '32345678901234567';
  const members = new Map<string, any>();
  let failList = false;
  const guild = { id: 'g', available: true, members: { cache: new Map(), fetch: async (options?: { user?: string }) => { if (!options?.user && failList) throw new Error('member list unavailable'); return options?.user ? members.get(options.user) : members; } } };
  const client = { on: (name: string, fn: (...args: any[]) => unknown) => handlers.set(name, fn), guilds: { cache: new Map([['g', guild]]), fetch: async () => guild } } as unknown as Client;
  const member = (id: string, username: string, globalName: string | null = null) => ({ id, guild, user: { id, username, tag: username, globalName, bot: false } });
  const ada = member(userId, 'ada');
  const other = member(otherId, 'other', 'shared display');
  try {
    await db.run("INSERT INTO events (id,guild_id,name,status,form_json,created_at,updated_at) VALUES ('ev','g','Event','active',?,1,1)", JSON.stringify(DEFAULT_FORM));
    await db.run("INSERT INTO events (id,guild_id,name,status,form_json,created_at,updated_at) VALUES ('foreign','other-guild','Other','active',?,1,1)", JSON.stringify(DEFAULT_FORM));
    await createImportedSignups(db, 'foreign', 'other-guild', DEFAULT_FORM.version, [{ sourceRow: 2, values: { name: 'Ada', discordUsername: 'ada' }, answers: {} }]);
    const imported = await createImportedSignups(db, 'ev', 'g', DEFAULT_FORM.version, [
      { sourceRow: 2, values: { name: 'Ada', discordUsername: 'ada' }, answers: {} },
      { sourceRow: 3, values: { name: 'Other', discordUsername: 'other' }, answers: {} },
      { sourceRow: 4, values: { name: 'Duplicate', discordUsername: 'other' }, answers: {} },
      { sourceRow: 5, values: { name: 'Display only', discordUsername: 'shared display' }, answers: {} },
      { sourceRow: 6, values: { name: 'Cleo', discordUsername: 'cleo' }, answers: {} },
    ]);
    await reconcileImportedParticipants(db, 'ev', 'g', DEFAULT_FORM);
    const placeholder = importedParticipantId(imported.rows[0]!.id!);
    await db.run("INSERT INTO teams (id,event_id,guild_id,name,kind,owner_id,created_at) VALUES ('team','ev','g','Team','private',?,1)", placeholder);
    await db.run("UPDATE participants SET team_id='team' WHERE event_id='ev' AND user_id=?", placeholder);
    const reconcile = registerMemberLifecycle(db, client);
    members.set(userId, ada); members.set(otherId, other);
    await handlers.get(Events.GuildMemberAdd)!(ada);
    const linked = await getParticipant(db, 'ev', userId);
    assert.equal(linked?.teamId, 'team');
    assert.equal(linked?.importedSignupId, imported.rows[0]!.id);
    assert.equal(await getParticipant(db, 'ev', placeholder), null);
    assert.equal((await db.get<{ owner_id: string }>("SELECT owner_id FROM teams WHERE id='team'"))?.owner_id, userId);
    assert.deepEqual(await listPendingTeamProvisionIds(db, 'ev'), ['team']);
    await handlers.get(Events.GuildMemberAdd)!(other);
    assert.equal((await listImportedSignups(db, 'ev')).filter(row => row.discordUserId !== null).length, 1, 'duplicate rows and display names must not be guessed');
    members.set(catchupId, member(catchupId, 'cleo'));
    failList = true;
    await handlers.get(Events.GuildMemberAdd)!(members.get(catchupId));
    assert.equal((await listImportedSignups(db, 'ev')).filter(row => row.discordUserId !== null).length, 1, 'an unavailable member list never guesses');
    failList = false;
    await reconcile();
    assert.equal((await listImportedSignups(db, 'ev')).filter(row => row.discordUserId !== null).length, 2, 'catch-up links a join missed while offline');
    await reconcile();
    assert.equal((await listImportedSignups(db, 'ev')).filter(row => row.discordUserId !== null).length, 2, 'catch-up remains safe and idempotent');
    assert.equal((await listImportedSignups(db, 'foreign'))[0]?.discordUserId, null, 'another server is never linked');
  } finally { await db.close(); }
});

test('joining a provisioned imported team grants its Discord role', async () => {
  const db = await openTestDb();
  const handlers = new Map<string, (...args: any[]) => unknown>();
  const userId = '42345678901234567';
  const roles = new Set<string>();
  const member: any = { id: userId, user: { username: 'joined', tag: 'joined', globalName: null, bot: false }, roles: { cache: roles, add: async (id: string) => { roles.add(id); } } };
  const members = new Map([[userId, member]]);
  const guild = { id: 'g', available: true, roles: { everyone: { id: 'g' } }, channels: { fetch: async () => null }, members: { cache: members, me: null, fetch: async (arg?: string | { user?: string }) => typeof arg === 'string' ? members.get(arg) : arg?.user ? members.get(arg.user) : members } };
  member.guild = guild;
  const client = { on: (name: string, fn: (...args: any[]) => unknown) => handlers.set(name, fn), guilds: { cache: new Map([['g', guild]]), fetch: async () => guild } } as unknown as Client;
  try {
    await db.run("INSERT INTO events (id,guild_id,name,status,form_json,created_at,updated_at) VALUES ('ev','g','Event','active',?,1,1)", JSON.stringify(DEFAULT_FORM));
    const imported = await createImportedSignups(db, 'ev', 'g', DEFAULT_FORM.version, [{ sourceRow: 2, values: { name: 'Joined', discordUsername: 'joined' }, answers: {} }]);
    await reconcileImportedParticipants(db, 'ev', 'g', DEFAULT_FORM);
    const placeholder = importedParticipantId(imported.rows[0]!.id!);
    await db.run("INSERT INTO teams (id,event_id,guild_id,name,kind,role_id,text_channel_id,voice_channel_id,created_at) VALUES ('team','ev','g','Team','matched','role','text','voice',1)");
    await db.run("UPDATE participants SET team_id='team' WHERE event_id='ev' AND user_id=?", placeholder);
    registerMemberLifecycle(db, client);
    await handlers.get(Events.GuildMemberAdd)!(member);
    assert.equal((await getParticipant(db, 'ev', userId))?.teamId, 'team');
    assert.ok(roles.has('role'), 'the real member receives their existing team role');
    assert.deepEqual(await listPendingTeamProvisionIds(db, 'ev'), [], 'successful provisioning clears the retry marker');
  } finally { await db.close(); }
});
