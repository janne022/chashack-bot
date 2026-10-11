import assert from 'node:assert/strict';
import { test } from 'node:test';
import { openTestDb } from '../../shared/test-db.js';
import type { Db } from '../../shared/db.js';
import { blockParticipant, purgeEventParticipants, upsertParticipant } from './data.js';
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

test('participant audit mutations refuse missing events without host audit or data mutation', async () => {
  const db = await seed();
  const blocked = await blockParticipant(db, 'admin', 'ghost-event', '42', 'reason');
  assert.equal(blocked.ok, false);
  assert.equal(await purgeEventParticipants(db, 'admin', 'ghost-event'), 0);
  assert.equal((await db.get("SELECT COUNT(*) AS n FROM participants WHERE event_id = 'ghost-event'"))?.n, 0);
  assert.equal((await db.get("SELECT COUNT(*) AS n FROM audit_log WHERE guild_id IS NULL"))?.n, 0);
});
