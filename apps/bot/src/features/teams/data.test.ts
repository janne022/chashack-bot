import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openTestDb } from '../../shared/test-db.js';
import { openPostgres } from '../../shared/postgres.js';
import { DEFAULT_FORM, TEAM_COLORS, validateSignupInput } from '../form/domain.js';
import { upsertParticipant } from '../signup/data.js';
import { adminAssign, createTeam, joinTeam, listTeams, nextTeamColor } from './data.js';
import { createInvite, decideRequest } from './requests-data.js';
import { setMembershipLookup } from '../signup/eligibility.js';

test('organizer reassignment enforces team capacity', async () => {
  const db = await openTestDb();
  try {
    await db.run("INSERT INTO events (id,guild_id,name,status,created_at,updated_at) VALUES ('ev','g','test','active',1,1)");
    for (const userId of ['owner', 'member', 'overflow']) {
      const input = validateSignupInput(DEFAULT_FORM, { displayName: userId, experience: 'some_experience', roleTrack: 'fullstack', skills: ['devops'], teamPref: 'random_team' });
      assert.ok(input.ok);
      if (input.ok) assert.ok((await upsertParticipant(db, 'test', 'ev', 'g', userId, input.value)).ok);
    }
    const team = await createTeam(db, 'test', 'ev', 'g', 'Alpha', 'public', 'owner');
    assert.ok(team.ok);
    if (!team.ok) return;
    await adminAssign(db, 'test', 'ev', 'member', team.value.id, 2);
    const result = await adminAssign(db, 'test', 'ev', 'overflow', team.value.id, 2);
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, 'team_full');
    const member = await db.get<{ team_id: string | null }>('SELECT team_id FROM participants WHERE event_id=? AND user_id=?', 'ev', 'overflow');
    assert.equal(member?.team_id, null);
  } finally { await db.close(); }
});

test('pooled invite acceptance cannot exceed team capacity', async () => {
  const db = await openTestDb();
  const url = process.env.DATABASE_URL;
  assert.ok(url);
  const schema = (await db.get<{ schema: string }>('SELECT current_schema() AS schema'))!.schema;
  const peer = await openPostgres(url!, schema);
  setMembershipLookup(peer, async () => true);
  try {
    await db.run("INSERT INTO events (id,guild_id,name,status,created_at,updated_at) VALUES ('ev','g','test','active',1,1)");
    for (const userId of ['owner', 'one', 'two']) {
      const input = validateSignupInput(DEFAULT_FORM, { displayName: userId, experience: 'some_experience', roleTrack: 'fullstack', skills: ['devops'], teamPref: 'random_team' });
      assert.ok(input.ok);
      if (input.ok) assert.ok((await upsertParticipant(db, 'test', 'ev', 'g', userId, input.value)).ok);
    }
    const team = await createTeam(db, 'test', 'ev', 'g', 'Alpha', 'public', 'owner');
    assert.ok(team.ok);
    if (!team.ok) return;
    const invites = await Promise.all(['one', 'two'].map((user) => createInvite(db, 'discord:owner', 'ev', 'g', team.value.id, user, 2)));
    assert.ok(invites.every((invite) => invite.ok));
    if (!invites[0]!.ok || !invites[1]!.ok) return;
    const results = await Promise.all([
      decideRequest(db, 'discord:one', invites[0]!.value.id, 'accept', 2),
      decideRequest(peer, 'discord:two', invites[1]!.value.id, 'accept', 2),
    ]);
    assert.equal(results.filter((result) => result.ok).length, 1);
    assert.equal((await listTeams(db, 'ev')).find((item) => item.id === team.value.id)?.members.length, 2);
  } finally { await peer.close(); await db.close(); }
});

for (const operation of ['join', 'assign'] as const) test(`pooled ${operation} last-slot race has one winner`, async () => {
  const db = await openTestDb();
  const schema = (await db.get<{ schema: string }>('SELECT current_schema() AS schema'))!.schema;
  const peer = await openPostgres(process.env.DATABASE_URL!, schema);
  setMembershipLookup(peer, async () => true);
  try {
    await db.run("INSERT INTO events (id,guild_id,name,status,created_at,updated_at) VALUES ('ev','g','test','active',1,1)");
    for (const user of ['owner', 'one', 'two']) {
      const input = validateSignupInput(DEFAULT_FORM, { displayName: user, experience: 'some_experience', roleTrack: 'fullstack', skills: ['devops'], teamPref: 'random_team' });
      assert.ok(input.ok);
      if (input.ok) await upsertParticipant(db, 'test', 'ev', 'g', user, input.value);
    }
    const team = await createTeam(db, 'test', 'ev', 'g', 'Alpha', 'public', 'owner');
    assert.ok(team.ok);
    if (!team.ok) return;
    const mutate = operation === 'join' ? joinTeam : adminAssign;
    const results = await Promise.all([mutate(db, 'test', 'ev', 'one', team.value.id, 2), mutate(peer, 'test', 'ev', 'two', team.value.id, 2)]);
    assert.equal(results.filter((result) => result.ok).length, 1);
    assert.equal((await listTeams(db, 'ev'))[0]!.members.length, 2);
    assert.equal((await db.all("SELECT user_id FROM participants WHERE event_id='ev' AND team_id IS NULL")).length, 1);
  } finally { await peer.close(); await db.close(); }
});

test('teams created without an explicit colour get distinct palette colours', async () => {
  const db = await openTestDb();
  try {
    await db.run("INSERT INTO events (id,guild_id,name,status,created_at,updated_at) VALUES ('ev','g','test','active',1,1)");
    for (const user of ['a', 'b', 'c', 'd']) {
      const input = validateSignupInput(DEFAULT_FORM, { displayName: `user-${user}`, experience: 'some_experience', roleTrack: 'fullstack', skills: ['devops'], teamPref: 'random_team' });
      assert.ok(input.ok);
      if (input.ok) await upsertParticipant(db, 'test', 'ev', 'g', user, input.value);
    }
    const teams = [] as string[];
    for (const [user, name] of [['a', 'Alpha'], ['b', 'Beta'], ['c', 'Gamma'], ['d', 'Delta']] as const) {
      const created = await createTeam(db, 'test', 'ev', 'g', name, 'public', user);
      assert.ok(created.ok);
      if (created.ok) teams.push(created.value.colorId ?? '');
    }
    assert.equal(teams.length, 4);
    assert.equal(new Set(teams).size, teams.length, 'each team gets its own palette colour');
    assert.ok(teams.every((color) => TEAM_COLORS.some((palette) => palette.id === color)));
  } finally { await db.close(); }
});

test('an explicit team colour wins over the default', async () => {
  const db = await openTestDb();
  try {
    await db.run("INSERT INTO events (id,guild_id,name,status,created_at,updated_at) VALUES ('ev','g','test','active',1,1)");
    const input = validateSignupInput(DEFAULT_FORM, { displayName: 'owner', experience: 'some_experience', roleTrack: 'fullstack', skills: ['devops'], teamPref: 'random_team' });
    assert.ok(input.ok);
    if (input.ok) await upsertParticipant(db, 'test', 'ev', 'g', 'owner', input.value);
    const created = await createTeam(db, 'test', 'ev', 'g', 'Alpha', 'public', 'owner', 'red');
    assert.ok(created.ok);
    if (created.ok) assert.equal(created.value.colorId, 'red');
  } finally { await db.close(); }
});

test('legacy colourless teams reserve their visible blurple fallback', async () => {
  const db = await openTestDb();
  try {
    await db.run("INSERT INTO events (id,guild_id,name,status,created_at,updated_at) VALUES ('ev','g','test','active',1,1)");
    await db.run("INSERT INTO teams (id,event_id,guild_id,name,kind,color,created_at) VALUES ('old','ev','g','Old','matched',NULL,1)");
    assert.notEqual(await nextTeamColor(db, 'ev'), 'blurple');
  } finally { await db.close(); }
});
