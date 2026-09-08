import assert from 'node:assert/strict';
import { test } from 'node:test';
import { openDb } from '../../shared/db.js';
import type { Db } from '../../shared/db.js';
import { upsertParticipant } from './data.js';
import type { ValidatedSignup } from '../form/domain.js';

const signup: ValidatedSignup = {
  displayName: 'Gate Tester',
  experience: 'veteran',
  roleTrack: 'backend',
  skills: ['backend_node'],
  teamPref: 'random_team',
};

function seed(): Db {
  const db = openDb(':memory:');
  db.prepare(
    "INSERT INTO events (id, guild_id, name, status, created_at, updated_at) VALUES ('ev1', 'g1', 'Active One', 'active', 1, 1)",
  ).run();
  db.prepare(
    "INSERT INTO events (id, guild_id, name, status, created_at, updated_at) VALUES ('ev2', 'g1', 'Draft One', 'draft', 2, 2)",
  ).run();
  return db;
}

test('upsertParticipant rejects when no event exists for the id', () => {
  const db = seed();
  const res = upsertParticipant(db, 'discord:42', 'ghost-event', 'g1', '42', signup);
  assert.equal(res.ok, false);
  if (!res.ok) assert.equal(res.code, 'no_event');
});

test('upsertParticipant rejects draft events', () => {
  const db = seed();
  const res = upsertParticipant(db, 'discord:42', 'ev2', 'g1', '42', signup);
  assert.equal(res.ok, false);
  if (!res.ok) assert.equal(res.code, 'event_not_active');
});

test('upsertParticipant accepts active events', () => {
  const db = seed();
  const res = upsertParticipant(db, 'discord:42', 'ev1', 'g1', '42', signup);
  assert.equal(res.ok, true);
});
