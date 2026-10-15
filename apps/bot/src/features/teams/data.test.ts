import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openTestDb } from '../../shared/test-db.js';
import { openPostgres } from '../../shared/postgres.js';
import { DEFAULT_FORM, validateSignupInput } from '../form/domain.js';
import { upsertParticipant } from '../signup/data.js';
import { adminAssign, createTeam, listTeams } from './data.js';
import { createInvite, decideRequest } from './requests-data.js';

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