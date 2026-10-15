import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openTestDb } from '../../shared/test-db.js';
import { createTeam, joinTeam, getTeam } from '../teams/data.js';
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
      for (const user of ['same', 'successor', 'blocked']) {
        await db.run("INSERT INTO participants (event_id,user_id,guild_id,display_name,experience,role_track,skills,team_pref,teammates,status,created_at,updated_at) VALUES (?,?,?,?,'some_experience','backend','[]','random_team',?,'active',1,1)", guild, user, guild, user, JSON.stringify(['same']));
        await db.run('INSERT INTO registration_answers VALUES (?,?,1,?,1)', guild, user, JSON.stringify({ private: 'SECRET_ANSWER' }));
      }
      const team = await createTeam(db, 'test', guild, guild, 'Alpha', 'public', 'same');
      assert.ok(team.ok);
      if (!team.ok) return;
      assert.ok((await joinTeam(db, 'test', guild, 'successor', team.value.id, 4)).ok);
      await db.run("UPDATE participants SET team_id=?,status='blocked' WHERE event_id=? AND user_id='blocked'", team.value.id, guild);
      await db.run("INSERT INTO team_requests (event_id,guild_id,team_id,requester_id,target_id,kind,status,created_at) VALUES (?,?,?,'discord:same','blocked','invite','pending',1)", guild, guild, team.value.id);
      await db.run("INSERT INTO audit_log (ts,actor,action,details,guild_id) VALUES (1,'discord:same','test',?,?)", JSON.stringify({ displayName: 'same', secret: 'SECRET_ANSWER' }), guild);
    }
    const restored = await openTestDb();
    try {
      await db.run("INSERT INTO meta VALUES ('fake_fixture','true')");
      await recoverFakeFixture(db, restored);
      await replayMemberDeletions(restored, [{ guildId: 'a', userId: 'same', deletedAt: 100 }]);
      assert.equal((await restored.all("SELECT * FROM registration_answers WHERE event_id='a' AND user_id='same'")).length, 0);
      assert.equal((await restored.all("SELECT * FROM registration_answers WHERE event_id='b' AND user_id='same'")).length, 1);
    } finally { await restored.close(); }
    await deleteGuildMemberData(db, 'a', 'same', 100);
    await deleteGuildMemberData(db, 'a', 'same', 100);
    assert.equal((await db.all("SELECT * FROM participants WHERE guild_id='a' AND user_id='same'")).length, 0);
    assert.equal((await db.all("SELECT * FROM registration_answers WHERE event_id='a' AND user_id='same'")).length, 0);
    assert.equal((await db.all("SELECT * FROM team_requests WHERE guild_id='a'")).length, 0);
    assert.equal((await db.all("SELECT * FROM audit_log WHERE guild_id='a' AND actor='discord:same'")).length, 0);
    assert.equal((await db.all("SELECT * FROM participants WHERE guild_id='b' AND user_id='same'")).length, 1);
    assert.equal((await db.all("SELECT * FROM registration_answers WHERE event_id='b' AND user_id='same'")).length, 1);
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
    assert.equal((await db.all("SELECT * FROM registration_answers WHERE event_id='a' AND user_id='same'")).length, 0);
    const team = (await db.get<{ id: string }>("SELECT id FROM teams WHERE event_id='a'"))!;
    await deleteGuildMemberData(db, 'a', 'successor', 300);
    assert.equal(await getTeam(db, team.id), null, 'no eligible remaining member uses team deletion');
  } finally { await db.close(); }
});
