import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDb, type Db } from '../shared/db.js';
import {
  upsertParticipant,
  listMatchable,
  getParticipant,
  setTeammates,
  blockParticipant,
} from './signup/store.js';
import { validateSignupInput, DEFAULT_FORM } from './form/domain.js';
import {
  createTeam,
  joinTeam,
  joinPrivateTeam,
  leaveTeam,
  listOpenPublicTeams,
} from './teams/service.js';
import { previewMatch, commitMatch } from './matching/service.js';
const G = 'guild1';
let db: Db;

function signup(
  userId: string,
  opts: Partial<{ displayName: string; experience: string; roleTrack: string; skills: string[]; teamPref: string }> = {},
) {
  const validated = validateSignupInput(DEFAULT_FORM, {
    displayName: `User ${userId}`,
    experience: 'some_experience',
    roleTrack: 'fullstack',
    skills: ['devops'],
    teamPref: 'random_team',
    ...opts,
  });
  if (!validated.ok) throw new Error(`bad fixture: ${validated.errors.join('; ')}`);
  const res = upsertParticipant(db, 'test', G, userId, validated.value);
  if (!res.ok) throw new Error(res.message);
}

/** Fresh in-memory DB per test (node:test runs this file in one process). */
function freshDb(): void {
  db = openDb(':memory:');
}

test('signup → unteamed list → matching → committed teams', () => {
  freshDb();
  signup('1', { roleTrack: 'frontend', skills: ['frontend_react'] });
  signup('2', { roleTrack: 'backend', skills: ['backend_node'] });
  signup('3', { roleTrack: 'design', skills: ['ui_design'] });
  signup('4', { roleTrack: 'devops', skills: ['devops'] });

  assert.equal(listMatchable(db, G).length, 4);

  const preview = previewMatch(db, G, DEFAULT_FORM);
  assert.ok(preview.ok);
  if (!preview.ok) return;
  assert.ok(preview.value.teams.length >= 1);

  const commit = commitMatch(db, 'test', G, DEFAULT_FORM);
  assert.ok(commit.ok);
  if (commit.ok) {
    const placed = commit.value.teams.flatMap((t) => t.memberIds);
    assert.equal(new Set(placed).size, 4);
    // participants now have team_id set
    for (const id of ['1', '2', '3', '4']) {
      const p = getParticipant(db, G, id);
      assert.ok(p !== null && p.teamId !== null, `participant ${id} should be teamed`);
    }
  }
});

test('blocked users cannot re-signup and are excluded from matching', () => {
  freshDb();
  signup('1');
  const blocked = blockParticipant(db, 'admin', G, '1', 'test reason');
  assert.ok(blocked.ok);

  const validated = validateSignupInput(DEFAULT_FORM, {
    displayName: 'User 1',
    experience: 'some_experience',
    roleTrack: 'fullstack',
    skills: ['devops'],
    teamPref: 'random_team',
  });
  if (!validated.ok) throw new Error('fixture broken');
  const res = upsertParticipant(db, 'test', G, '1', validated.value);
  assert.equal(res.ok, false);
  if (!res.ok) assert.equal(res.code, 'blocked');

  assert.equal(listMatchable(db, G).length, 0);
});

test('public team create → join → capacity enforced', () => {
  freshDb();
  signup('1');
  signup('2');
  signup('3');

  const created = createTeam(db, 'test', G, 'Alpha Team', 'public', '1');
  assert.ok(created.ok);
  if (!created.ok) return;

  assert.ok(joinTeam(db, 'test', G, '2', created.value.id, DEFAULT_FORM.teamSize).ok);

  // capacity: default team size is 4 → 1 slot left
  assert.ok(joinTeam(db, 'test', G, '3', created.value.id, DEFAULT_FORM.teamSize).ok);

  // unsigned-up user cannot join
  const noSignup = joinTeam(db, 'test', G, '99', created.value.id, DEFAULT_FORM.teamSize);
  assert.equal(noSignup.ok, false);
  if (!noSignup.ok) assert.equal(noSignup.code, 'not_found');

  // fill the last slot with a signed-up user, then it is full
  signup('5');
  assert.ok(joinTeam(db, 'test', G, '5', created.value.id, DEFAULT_FORM.teamSize).ok);
  assert.equal(listOpenPublicTeams(db, G, DEFAULT_FORM.teamSize).length, 0);

  const over = joinTeam(db, 'test', G, '6', created.value.id, DEFAULT_FORM.teamSize);
  signup('6');
  const over2 = joinTeam(db, 'test', G, '6', created.value.id, DEFAULT_FORM.teamSize);
  assert.equal(over.ok, false); // 6 had no signup on first attempt
  if (!over2.ok) assert.equal(over2.code, 'team_full');
});

test('private team join code round-trip', () => {
  freshDb();
  signup('1');
  signup('2');
  const created = createTeam(db, 'test', G, 'Secret Squad', 'private', '1');
  assert.ok(created.ok);
  if (!created.ok) return;
  assert.ok(created.value.joinCode !== null);

  const wrong = joinPrivateTeam(db, 'test', G, '2', 'XXXXXX', DEFAULT_FORM.teamSize);
  assert.equal(wrong.ok, false);

  const right = joinPrivateTeam(db, 'test', G, '2', created.value.joinCode!, DEFAULT_FORM.teamSize);
  assert.ok(right.ok);

  const leave = leaveTeam(db, 'test', G, '2');
  assert.ok(leave.ok);
});

test('setTeammates validates ids, dedupes and persists', () => {
  freshDb();
  signup('1');
  const res = setTeammates(db, 'test', G, '1', ['123456789012345678', 'bad-id!', '123456789012345678']);
  assert.ok(res.ok);
  if (res.ok) assert.deepEqual(res.value.teammates, ['123456789012345678']);
  const p = getParticipant(db, G, '1');
  assert.ok(p !== null);
});
