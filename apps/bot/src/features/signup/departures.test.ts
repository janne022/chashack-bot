import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openTestDb } from '../../shared/test-db.js';
import { createTeam, joinTeam, getTeam, leaveTeam, removeFromTeam, removeMember, adminAssign } from '../teams/data.js';
import { blockParticipant } from './data.js';
import { finishParticipantDeparture, retryFailedParticipantRoleRevocations } from './lifecycle.js';
import { claimTeamRoleRevocations, pruneResolvedTeamRoleRevocations } from './data.js';
import { setMembershipLookup } from './eligibility.js';
import { DEFAULT_FORM } from '../form/domain.js';
import { deleteGuildMemberData, reconcileGuildMembers, replayMemberDeletions } from './departures.js';
import { recoverFakeFixture } from '../../shared/fixture-recovery.js';

test('departure deletes one guild only, elects eligible successor, records identifiers and reconciles fail-closed', async () => {
  const db = await openTestDb();
  try {
    assert.ok(await db.get("SELECT to_regclass('member_deletions') AS name").then((row) => row?.name), 'deletion replay identifiers must persist');

    for (const guild of ['a', 'b']) {
      await db.run("INSERT INTO events (id,guild_id,name,status,created_at,updated_at) VALUES (?,?,'Test','active',1,1)", guild, guild);
      await db.run('UPDATE events SET form_json=? WHERE id=?', JSON.stringify({ ...DEFAULT_FORM, customQuestions: [{ id: 'private', kind: 'text', label: { en: 'Private' }, help: { en: '' }, required: false, presentation: 'web', visibility: 'organizer_only' }] }), guild);
      await db.run('INSERT INTO submission_forms(event_id,version,enabled,allow_edits,questions_json,updated_at) VALUES (?,1,1,1,?,1)', guild, '[]');
      for (const user of ['same', 'successor', 'blocked']) {
        await db.run("INSERT INTO participants (event_id,user_id,guild_id,display_name,experience,role_track,skills,team_pref,teammates,status,created_at,updated_at) VALUES (?,?,?,?,'some_experience','backend','[]','random_team',?,'active',1,1)", guild, user, guild, user, JSON.stringify(['same']));
        await db.run('INSERT INTO registration_answers VALUES (?,?,1,?,1)', guild, user, JSON.stringify({ private: 'SECRET_ANSWER' }));
        await db.run('INSERT INTO submission_answers VALUES (?,?,1,?,1,1)', guild, user, JSON.stringify({ project: 'SUBMISSION_SENTINEL' }));
      }
      const team = await createTeam(db, 'test', guild, guild, 'Alpha', 'public', 'same');
      assert.ok(team.ok);
      if (!team.ok) return;
      assert.ok((await joinTeam(db, 'test', guild, 'successor', team.value.id, 4)).ok);
      await db.run("UPDATE participants SET team_id=?,status='blocked' WHERE event_id=? AND user_id='blocked'", team.value.id, guild);
      await db.run("INSERT INTO team_requests (event_id,guild_id,team_id,requester_id,target_id,kind,status,created_at) VALUES (?,?,?,'discord:same','blocked','invite','pending',1)", guild, guild, team.value.id);
      await db.run("INSERT INTO audit_log (ts,actor,action,details,guild_id) VALUES (1,'discord:same','test',?,?)", JSON.stringify({ displayName: 'same', privateAnswer: 'SECRET_ANSWER' }), guild);
    }
    const restored = await openTestDb();
    try {
      await db.run("INSERT INTO meta VALUES ('fake_fixture','true')");
      await recoverFakeFixture(db, restored);
      await replayMemberDeletions(restored, [{ guildId: 'a', userId: 'same', deletedAt: 100 }]);
      assert.equal((await restored.all("SELECT * FROM registration_answers WHERE event_id='a' AND user_id='same'")).length, 0);
      assert.equal((await restored.all("SELECT * FROM registration_answers WHERE event_id='b' AND user_id='same'")).length, 1);
      assert.equal((await restored.all("SELECT * FROM submission_answers WHERE event_id='a' AND user_id='same'")).length, 0);
      assert.equal((await restored.all("SELECT * FROM submission_answers WHERE event_id='b' AND user_id='same'")).length, 1);
    } finally { await restored.close(); }
    await deleteGuildMemberData(db, 'a', 'same', 100);
    await deleteGuildMemberData(db, 'a', 'same', 100);
    assert.equal((await db.all("SELECT * FROM participants WHERE guild_id='a' AND user_id='same'")).length, 0);
    assert.equal((await db.all("SELECT * FROM registration_answers WHERE event_id='a' AND user_id='same'")).length, 0);
    assert.equal((await db.all("SELECT * FROM submission_answers WHERE event_id='a' AND user_id='same'")).length, 0);
    assert.equal((await db.all("SELECT * FROM team_requests WHERE guild_id='a'")).length, 0);
    assert.equal((await db.all("SELECT * FROM audit_log WHERE guild_id='a' AND actor='discord:same'")).length, 0);
    assert.equal((await db.all("SELECT * FROM participants WHERE guild_id='b' AND user_id='same'")).length, 1);
    assert.equal((await db.all("SELECT * FROM registration_answers WHERE event_id='b' AND user_id='same'")).length, 1);
    assert.equal((await db.all("SELECT * FROM submission_answers WHERE event_id='b' AND user_id='same'")).length, 1);
    assert.equal((await db.all("SELECT * FROM audit_log WHERE guild_id='b' AND actor='discord:same'")).length, 1);
    assert.equal((await db.get<{ owner_id: string }>("SELECT owner_id FROM teams WHERE event_id='a'"))!.owner_id, 'successor');
    const records = await db.all('SELECT * FROM member_deletions');
    assert.equal(records.length, 1);
    assert.equal(JSON.stringify(records).includes('SECRET_ANSWER'), false);
    await reconcileGuildMembers(db, 'b', async () => { throw new Error('lookup unavailable'); });
    assert.equal((await db.all("SELECT * FROM participants WHERE guild_id='b'")).length, 3);
    await reconcileGuildMembers(db, 'b', async (userId: string) => userId !== 'same');
    assert.equal((await db.all("SELECT * FROM participants WHERE guild_id='b' AND user_id='same'")).length, 0);
    assert.equal((await db.all("SELECT * FROM participants WHERE guild_id='b'")).length, 2);
    // Rejoin is a fresh signup, not resurrection of answers or invitations.
    await db.run("INSERT INTO participants (event_id,user_id,guild_id,display_name,experience,role_track,skills,team_pref,teammates,status,created_at,updated_at) VALUES ('a','same','a','New','','','[]','','[]','active',200,200)");
    await db.run("INSERT INTO registration_answers VALUES ('a','same',1,'{\"fresh\":\"NEW_REGISTRATION\"}',200)");
    await db.run("INSERT INTO submission_answers VALUES ('a','same',1,'{\"fresh\":\"NEW_SUBMISSION\"}',200,200)");
    await db.run("INSERT INTO events(id,guild_id,name,status,created_at,updated_at) VALUES ('older-a','a','Older event','ended',1,1)");
    await db.run("INSERT INTO registration_answers VALUES ('older-a','same',1,'{\"old\":\"OLD_REGISTRATION\"}',50)");
    await db.run("INSERT INTO submission_answers VALUES ('older-a','same',1,'{\"old\":\"OLD_SUBMISSION\"}',50,50)");
    await replayMemberDeletions(db, [{ guildId: 'a', userId: 'same', deletedAt: 100 }]);
    assert.equal((await db.all("SELECT * FROM participants WHERE event_id='a' AND user_id='same'")).length, 1);
    assert.equal((await db.get<{ answers_json: string }>("SELECT answers_json FROM registration_answers WHERE event_id='a' AND user_id='same'"))?.answers_json.includes('NEW_REGISTRATION'), true);
    assert.equal((await db.get<{ answers_json: string }>("SELECT answers_json FROM submission_answers WHERE event_id='a' AND user_id='same'"))?.answers_json.includes('NEW_SUBMISSION'), true);
    assert.equal(await db.get("SELECT * FROM registration_answers WHERE event_id='older-a' AND user_id='same'"), undefined);
    assert.equal(await db.get("SELECT * FROM submission_answers WHERE event_id='older-a' AND user_id='same'"), undefined);
    const team = (await db.get<{ id: string }>("SELECT id FROM teams WHERE event_id='a'"))!;
    await deleteGuildMemberData(db, 'a', 'successor', 300);
    assert.equal(await getTeam(db, team.id), null, 'no eligible remaining member uses team deletion');
  } finally { await db.close(); }
});

test('blocking captures old team before detaching and reports failed role revocation', async () => {
  const db = await openTestDb();
  try {
    const guild = '11111111111111111';
    await db.run("INSERT INTO events (id,guild_id,name,status,created_at,updated_at) VALUES ('block-event',?,'Block','active',1,1)", guild);
    for (const user of ['owner', 'successor']) {
      await db.run("INSERT INTO participants (event_id,user_id,guild_id,display_name,experience,role_track,skills,team_pref,teammates,status,created_at,updated_at) VALUES ('block-event',?,?,?,'some_experience','backend','[]','random_team','[]','active',1,1)", user, guild, user);
    }
    await db.run("INSERT INTO teams (id,event_id,guild_id,name,kind,owner_id,role_id,created_at) VALUES ('block-team','block-event',?,'Block Team','public','owner','role-id',1)", guild);
    await db.run("UPDATE participants SET team_id='block-team' WHERE event_id='block-event'");
    setMembershipLookup(db, async () => true);
    const blocked = await blockParticipant(db, 'admin', 'block-event', 'owner', 'test');
    assert.equal(blocked.ok, true);
    if (!blocked.ok) return;
    assert.equal(blocked.value?.id, 'block-team');
    assert.equal(blocked.value?.roleId, 'role-id');
    assert.equal((await db.get<{ status: string }>("SELECT status FROM team_role_revocations WHERE guild_id=? AND event_id='block-event'", guild))?.status, 'pending', 'intent commits with the participant transition before any Discord callback');
    assert.equal((await db.get<{ owner_id: string }>("SELECT owner_id FROM teams WHERE id='block-team'"))?.owner_id, 'successor');
    const failedRetry = await retryFailedParticipantRoleRevocations(db, guild, async () => { throw new Error('Discord unavailable'); });
    assert.deepEqual(failedRetry, { attempted: 1, succeeded: 0 });
    assert.equal((await db.get<{ status: string; last_error_code: string }>("SELECT status,last_error_code FROM team_role_revocations WHERE guild_id=? AND event_id='block-event'", guild))?.status, 'pending');
    await db.run("UPDATE team_role_revocations SET next_attempt_at=0 WHERE event_id='block-event'");
    await db.run("UPDATE participants SET status='active',team_id='block-team' WHERE event_id='block-event' AND user_id='owner'");
    let providerCalls = 0;
    const retry = await retryFailedParticipantRoleRevocations(db, guild, async () => { providerCalls++; });
    assert.deepEqual(retry, { attempted: 1, succeeded: 1 });
    assert.equal(providerCalls, 0, 'retry must preserve role access after the participant rejoins that team');
    assert.equal((await db.get<{ status: string }>("SELECT status FROM team_role_revocations WHERE guild_id=? AND event_id='block-event'", guild))?.status, 'superseded');

    for (let i = 0; i < 4; i++) await db.run("INSERT INTO team_role_revocations (guild_id,event_id,user_id,team_id,role_id,created_at,updated_at) VALUES (?,'block-event',?,?,?,1,1)", guild, `u${i}`, `t${i}`, `r${i}`);
    await db.run("INSERT INTO team_role_revocations (guild_id,event_id,user_id,team_id,role_id,created_at,updated_at) VALUES ('22222222222222222','other-event','u','t','r',1,1)");
    const bounded = await claimTeamRoleRevocations(db, guild, Date.now(), 2);
    assert.equal(bounded.length, 2);
    assert.ok(bounded.every((row) => row.guildId === guild));
    await db.run("UPDATE team_role_revocations SET status='pending',lease_until=0,next_attempt_at=0 WHERE guild_id=? AND event_id='block-event' AND status='processing'", guild);
    let successfulCalls = 0;
    const successfulRetry = await retryFailedParticipantRoleRevocations(db, guild, async (targetGuildId) => {
      assert.equal(targetGuildId, guild);
      successfulCalls++;
    });
    assert.deepEqual(successfulRetry, { attempted: 4, succeeded: 4 });
    assert.equal(successfulCalls, 4);
    for (let i = 0; i < 3; i++) await db.run("INSERT INTO team_role_revocations (guild_id,event_id,user_id,team_id,role_id,status,created_at,updated_at) VALUES (?,'old-event',?,?,?,'complete',1,1)", guild, `old-u${i}`, `old-t${i}`, `old-r${i}`);
    assert.equal(await pruneResolvedTeamRoleRevocations(db, guild, 31 * 24 * 60 * 60 * 1000), 3);
  } finally { await db.close(); }
});

test('participant transition and role-revocation intent roll back together', async () => {
  const db = await openTestDb();
  try {
    const guild = '11111111111111111';
    await db.run("INSERT INTO events (id,guild_id,name,status,created_at,updated_at) VALUES ('rollback-event',?,'Rollback','active',1,1)", guild);
    await db.run("INSERT INTO participants (event_id,user_id,guild_id,display_name,experience,role_track,skills,team_pref,teammates,status,created_at,updated_at) VALUES ('rollback-event','owner',?,'owner','','','[]','','[]','active',1,1)", guild);
    await db.run("INSERT INTO teams (id,event_id,guild_id,name,kind,owner_id,role_id,created_at) VALUES ('rollback-team','rollback-event',?,'Rollback Team','public','owner','role-id',1)", guild);
    await db.run("UPDATE participants SET team_id='rollback-team' WHERE event_id='rollback-event'");
    await assert.rejects(db.transaction(async () => {
      await blockParticipant(db, 'admin', 'rollback-event', 'owner', 'test');
      throw new Error('simulate caller rollback');
    }), /simulate caller rollback/);
    assert.equal((await db.get<{ status: string; team_id: string }>("SELECT status,team_id FROM participants WHERE event_id='rollback-event' AND user_id='owner'"))?.status, 'active');
    assert.equal((await db.get("SELECT 1 FROM team_role_revocations WHERE event_id='rollback-event'")), undefined);
  } finally { await db.close(); }
});

for (const operation of ['leaveTeam', 'removeFromTeam', 'removeMember', 'adminAssign-unassign', 'adminAssign-move'] as const) test(`${operation} transactionally queues a role retry that survives callback failure`, async () => {
  const db = await openTestDb();
  try {
    const guild = '11111111111111111';
    await db.run("INSERT INTO events (id,guild_id,name,status,created_at,updated_at) VALUES ('move-event',?,'Move','active',1,1)", guild);
    for (const user of ['owner-a', 'owner-b']) {
      await db.run("INSERT INTO participants (event_id,user_id,guild_id,display_name,experience,role_track,skills,team_pref,teammates,status,created_at,updated_at) VALUES ('move-event',?,?,?,'some_experience','backend','[]','random_team','[]','active',1,1)", user, guild, user);
    }
    const source = await createTeam(db, 'test', 'move-event', guild, 'Source', 'public', 'owner-a');
    const target = await createTeam(db, 'test', 'move-event', guild, 'Target', 'public', 'owner-b');
    assert.ok(source.ok && target.ok);
    await db.run("UPDATE teams SET role_id='source-role' WHERE id=?", source.value.id);

    if (operation === 'leaveTeam') assert.ok((await leaveTeam(db, 'discord:owner-a', 'move-event', 'owner-a')).ok);
    else if (operation === 'removeFromTeam') assert.ok((await removeFromTeam(db, 'web:admin', source.value.id, 'owner-a')).ok);
    else if (operation === 'removeMember') assert.ok((await removeMember(db, 'web:admin', source.value.id, 'owner-a')).ok);
    else if (operation === 'adminAssign-unassign') assert.ok((await adminAssign(db, 'web:admin', 'move-event', 'owner-a', null, 4)).ok);
    else assert.ok((await adminAssign(db, 'web:admin', 'move-event', 'owner-a', target.value.id, 4)).ok);

    assert.equal((await db.get<{ status: string; role_id: string }>("SELECT status,role_id FROM team_role_revocations WHERE guild_id=? AND event_id='move-event' AND user_id='owner-a'", guild))?.status, 'pending');
    let providerCalls = 0;
    const retry = await retryFailedParticipantRoleRevocations(db, guild, async (_guildId, _userId, roleId) => {
      assert.equal(roleId, 'source-role');
      providerCalls++;
      throw new Error('simulated Discord failure');
    });
    assert.deepEqual(retry, { attempted: 1, succeeded: 0 });
    assert.equal(providerCalls, 1);
    assert.equal((await db.get<{ status: string; attempt_count: number; last_error_code: string }>("SELECT status,attempt_count,last_error_code FROM team_role_revocations WHERE guild_id=? AND event_id='move-event' AND user_id='owner-a'", guild))?.status, 'pending');
  } finally { await db.close(); }
});
