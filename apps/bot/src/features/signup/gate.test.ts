import assert from 'node:assert/strict';
import { test } from 'node:test';
import { openTestDb } from '../../shared/test-db.js';
import type { Db } from '../../shared/db.js';
import { blockParticipant, checkSignupWrite, purgeEventParticipants, upsertParticipant } from './data.js';
import { signupWindowReason } from './domain.js';
import type { ValidatedSignup } from '../form/domain.js';

const signup: ValidatedSignup = {
  displayName: 'Gate Tester',
  experience: 'veteran',
  roleTrack: 'backend',
  skills: ['backend_node'],
  teamPref: 'random_team',
};

async function seed(): Promise<Db> {
  const db = await openTestDb();
  await db.run(
    "INSERT INTO events (id, guild_id, name, status, created_at, updated_at) VALUES ('ev1', 'g1', 'Active One', 'active', 1, 1)",
  );
  await db.run(
    "INSERT INTO events (id, guild_id, name, status, created_at, updated_at) VALUES ('ev2', 'g1', 'Draft One', 'draft', 2, 2)",
  );
  return db;
}

test('upsertParticipant rejects when no event exists for the id', async () => {
  const db = await seed();
  const res = await upsertParticipant(db, 'discord:42', 'ghost-event', 'g1', '42', signup);
  assert.equal(res.ok, false);
  if (!res.ok) assert.equal(res.code, 'no_event');
});

test('upsertParticipant rejects draft events', async () => {
  const db = await seed();
  const res = await upsertParticipant(db, 'discord:42', 'ev2', 'g1', '42', signup);
  assert.equal(res.ok, false);
  if (!res.ok) assert.equal(res.code, 'event_not_active');
});

test('upsertParticipant accepts active events', async () => {
  const db = await seed();
  const res = await upsertParticipant(db, 'discord:42', 'ev1', 'g1', '42', signup);
  assert.equal(res.ok, true);
});

test('signup window uses inclusive opening and exclusive closing while active members can edit', () => {
  assert.equal(signupWindowReason(true, 100, 200, null, 99), 'signup_not_open');
  assert.equal(signupWindowReason(true, 100, 200, null, 100), null);
  assert.equal(signupWindowReason(true, 100, 200, null, 199), null);
  assert.equal(signupWindowReason(true, 100, 200, null, 200), 'signup_closed');
  assert.equal(signupWindowReason(true, 100, 200, 'active', 201), null);
  assert.equal(signupWindowReason(true, 100, 200, 'withdrawn', 201), 'signup_closed');
  assert.equal(signupWindowReason(false, 100, 200, null, 201), null);
});

test('locked signup policy keeps legacy events open and gates new and withdrawn participants', async () => {
  const db = await seed();
  try {
    await db.run('UPDATE events SET signup_starts_at=100,signup_ends_at=200 WHERE id=?', 'ev1');
    assert.equal((await db.transaction(() => checkSignupWrite(db, 'ev1', '42', 'g1', 99))).ok, true, 'legacy event stays unrestricted');
    await db.run('UPDATE events SET form_json=? WHERE id=?', JSON.stringify({ enforceSignupWindow: true }), 'ev1');
    const before = await db.transaction(() => checkSignupWrite(db, 'ev1', '42', 'g1', 99));
    assert.ok(!before.ok && before.code === 'signup_not_open');
    assert.equal((await db.transaction(() => checkSignupWrite(db, 'ev1', '42', 'g1', 100))).ok, true);
    const after = await db.transaction(() => checkSignupWrite(db, 'ev1', '42', 'g1', 200));
    assert.ok(!after.ok && after.code === 'signup_closed');
    await db.run("INSERT INTO participants(event_id,user_id,guild_id,display_name,experience,role_track,skills,team_pref,teammates,status,created_at,updated_at) VALUES ('ev1','42','g1','User','','','[]','','[]','active',1,1)");
    assert.equal((await db.transaction(() => checkSignupWrite(db, 'ev1', '42', 'g1', 200))).ok, true);
    await db.run("UPDATE participants SET status='withdrawn' WHERE event_id='ev1' AND user_id='42'");
    const rejoin = await db.transaction(() => checkSignupWrite(db, 'ev1', '42', 'g1', 200));
    assert.ok(!rejoin.ok && rejoin.code === 'signup_closed');
    await db.run("UPDATE participants SET status='blocked' WHERE event_id='ev1' AND user_id='42'");
    const blocked = await db.transaction(() => checkSignupWrite(db, 'ev1', '42', 'g1', 150));
    assert.ok(!blocked.ok && blocked.code === 'blocked');
  } finally { await db.close(); }
});

test('participant audit mutations refuse missing events without host audit or data mutation', async () => {
  const db = await seed();
  const blocked = await blockParticipant(db, 'admin', 'ghost-event', '42', 'reason');
  assert.equal(blocked.ok, false);
  assert.equal(await purgeEventParticipants(db, 'admin', 'ghost-event'), 0);
  assert.equal((await db.get("SELECT COUNT(*) AS n FROM participants WHERE event_id = 'ghost-event'"))?.n, 0);
  assert.equal((await db.get("SELECT COUNT(*) AS n FROM audit_log WHERE guild_id IS NULL"))?.n, 0);
});
