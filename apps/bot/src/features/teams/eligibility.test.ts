import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openTestDb } from '../../shared/test-db.js';
import { DEFAULT_FORM } from '../form/domain.js';
import { createTeam, joinPrivateTeam, joinTeam, adminAssign } from './data.js';
import { createInvite, createJoinRequest } from './requests-data.js';

test('all team entry points refuse incomplete, blocked and foreign-guild registrations without writes', async () => {
  const db = await openTestDb();
  try {
    const form = { ...DEFAULT_FORM, customQuestions: [{ id: 'required', kind: 'text', label: { en: 'Required' }, help: { en: '' }, required: true, presentation: 'web', visibility: 'self_and_organizer' }] };
    await db.run("INSERT INTO events (id,guild_id,name,status,form_json,created_at,updated_at) VALUES ('ev','g','test','active',?,1,1)", JSON.stringify(form));
    for (const user of ['owner', 'incomplete', 'blocked', 'foreign']) {
      await db.run("INSERT INTO participants (event_id,user_id,guild_id,display_name,experience,role_track,skills,team_pref,teammates,status,created_at,updated_at) VALUES ('ev',?,?,?,'some_experience','backend','[]','random_team','[]',?,1,1)", user, user === 'foreign' ? 'other' : 'g', user, user === 'blocked' ? 'blocked' : 'active');
      if (user !== 'incomplete') await db.run("INSERT INTO registration_answers VALUES ('ev',?,1,?,1)", user, JSON.stringify({ required: 'done' }));
    }
    const team = await createTeam(db, 'discord:owner', 'ev', 'g', 'Alpha', 'private', 'owner');
    assert.ok(team.ok);
    if (!team.ok) return;
    for (const user of ['incomplete', 'blocked', 'foreign']) {
      const results = [
        await createTeam(db, `discord:${user}`, 'ev', 'g', 'Invalid', 'public', user),
        await joinPrivateTeam(db, `discord:${user}`, 'ev', user, team.value.joinCode!, 4),
        await createJoinRequest(db, `discord:${user}`, 'ev', 'g', user, team.value.id, 4),
        await createInvite(db, 'discord:owner', 'ev', 'g', team.value.id, user, 4),
        await adminAssign(db, 'test', 'ev', user, team.value.id, 4),
      ];
      assert.ok(results.every((r) => !r.ok), user);
      assert.equal((await db.get<{ team_id: string | null }>("SELECT team_id FROM participants WHERE event_id='ev' AND user_id=?", user))!.team_id, null);
    }
    assert.equal((await db.all('SELECT * FROM team_requests')).length, 0);
    assert.equal((await db.all('SELECT * FROM teams')).length, 1);
    await db.run("UPDATE teams SET kind='public' WHERE id=?", team.value.id);
    assert.equal((await joinTeam(db, 'discord:incomplete', 'ev', 'incomplete', team.value.id, 4)).ok, false);
  } finally { await db.close(); }
});
