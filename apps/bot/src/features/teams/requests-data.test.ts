import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDb, type Db } from '../../shared/db.js';
import { upsertParticipant } from '../signup/data.js';
import { validateSignupInput, DEFAULT_FORM } from '../form/domain.js';
import { createTeam, listTeams } from './data.js';
import {
  createInvite,
  createJoinRequest,
  decideRequest,
  cancelRequest,
} from './requests-data.js';

const G = 'guild1';
const EV = 'ev_test1';
let db: Db;

/** Simple actor ids — requests.ts accepts "discord:<id>" or "web:<id>". */
const actorOf = (userId: string) => `discord:${userId}`;

function signup(userId: string) {
  const validated = validateSignupInput(DEFAULT_FORM, {
    displayName: `User ${userId}`,
    experience: 'some_experience',
    roleTrack: 'fullstack',
    skills: ['devops'],
    teamPref: 'random_team',
  });
  if (!validated.ok) throw new Error(validated.errors.join('; '));
  const res = upsertParticipant(db, 'test', EV, G, userId, validated.value);
  if (!res.ok) throw new Error(res.message);
}

function freshDb(): void {
  db = openDb(':memory:');
  // The signup data layer gates on an ACTIVE event row — seed the fixture event.
  db.prepare(
    "INSERT INTO events (id, guild_id, name, status, created_at, updated_at) VALUES (?, ?, 'Requests Fixture', 'active', 1, 1)",
  ).run(EV, G);
}

test('invite flow: wrong decider rejected, invitee accept joins, members updated', () => {
  freshDb();
  signup('owner');
  signup('alice');
  const team = createTeam(db, actorOf('owner'), EV, G, 'Alpha', 'public', 'owner');
  assert.ok(team.ok);
  if (!team.ok) return;

  const invite = createInvite(db, actorOf('owner'), EV, G, team.value.id, 'alice', DEFAULT_FORM.teamSize);
  assert.ok(invite.ok);
  if (!invite.ok) return;

  // The owner cannot accept their own invite — only the invitee decides.
  const wrong = decideRequest(db, actorOf('owner'), invite.value.id, 'accept', DEFAULT_FORM.teamSize);
  assert.equal(wrong.ok, false);

  const accept = decideRequest(db, actorOf('alice'), invite.value.id, 'accept', DEFAULT_FORM.teamSize);
  assert.ok(accept.ok);

  const members = listTeams(db, EV).find((t) => t.id === team.value.id)!.members;
  assert.ok(members.some((m) => m.userId === 'alice'));

  // Double-accept is rejected.
  const again = decideRequest(db, actorOf('alice'), invite.value.id, 'accept', DEFAULT_FORM.teamSize);
  assert.equal(again.ok, false);
});

test('join request flow: owner decides, duplicates blocked while pending', () => {
  freshDb();
  signup('owner');
  signup('bob');
  signup('carol');
  const team = createTeam(db, actorOf('owner'), EV, G, 'Bravo', 'public', 'owner');
  assert.ok(team.ok);
  if (!team.ok) return;

  const req1 = createJoinRequest(db, actorOf('bob'), EV, G, 'bob', team.value.id, DEFAULT_FORM.teamSize);
  const req2 = createJoinRequest(db, actorOf('carol'), EV, G, 'carol', team.value.id, DEFAULT_FORM.teamSize);
  assert.ok(req1.ok && req2.ok);
  if (!req1.ok) return;

  const bobAgain = createJoinRequest(db, actorOf('bob'), EV, G, 'bob', team.value.id, DEFAULT_FORM.teamSize);
  assert.equal(bobAgain.ok, false);

  // The requester cannot decide their own request — only the owner (target).
  const wrongDecider = decideRequest(db, actorOf('bob'), req1.value.id, 'accept', DEFAULT_FORM.teamSize);
  assert.equal(wrongDecider.ok, false);

  const ownerAccepts = decideRequest(db, actorOf('owner'), req1.value.id, 'accept', DEFAULT_FORM.teamSize);
  assert.ok(ownerAccepts.ok);
  const members = listTeams(db, EV).find((t) => t.id === team.value.id)!.members;
  assert.ok(members.some((m) => m.userId === 'bob'));
});

test('capacity is enforced at accept time, not just request time', () => {
  freshDb();
  signup('owner');
  for (const u of ['m1', 'm2', 'm3', 'late']) signup(u);
  const team = createTeam(db, actorOf('owner'), EV, G, 'Charlie', 'public', 'owner');
  assert.ok(team.ok);
  if (!team.ok) return;

  const ids: number[] = [];
  for (const u of ['m1', 'm2', 'm3']) {
    const inv = createInvite(db, actorOf('owner'), EV, G, team.value.id, u, DEFAULT_FORM.teamSize);
    if (inv.ok) ids.push(inv.value.id);
  }
  const targets = ['m1', 'm2', 'm3'];
  for (let i = 0; i < ids.length; i++) {
    const acc = decideRequest(db, actorOf(targets[i]!), ids[i]!, 'accept', DEFAULT_FORM.teamSize);
    assert.ok(acc.ok);
  }

  // Team is full (owner + 3, size 4) → join request rejected at creation.
  const req = createJoinRequest(db, actorOf('late'), EV, G, 'late', team.value.id, DEFAULT_FORM.teamSize);
  assert.equal(req.ok, false);
  if (!req.ok) assert.equal(req.code, 'team_full');

  // And an invite to a fourth person cannot be created either.
  const invLate = createInvite(db, actorOf('owner'), EV, G, team.value.id, 'late', DEFAULT_FORM.teamSize);
  assert.equal(invLate.ok, false);
  if (!invLate.ok) assert.equal(invLate.code, 'team_full');
});

test('cancel flow: sender can cancel their own pending request, then re-request', () => {
  freshDb();
  signup('owner');
  signup('dave');
  const team = createTeam(db, actorOf('owner'), EV, G, 'Delta', 'public', 'owner');
  assert.ok(team.ok);
  if (!team.ok) return;

  const req = createJoinRequest(db, actorOf('dave'), EV, G, 'dave', team.value.id, DEFAULT_FORM.teamSize);
  assert.ok(req.ok);
  if (!req.ok) return;

  const wrongCancel = cancelRequest(db, actorOf('owner'), req.value.id);
  assert.equal(wrongCancel.ok, false);

  const cancel = cancelRequest(db, actorOf('dave'), req.value.id);
  assert.ok(cancel.ok);

  const reRequest = createJoinRequest(db, actorOf('dave'), EV, G, 'dave', team.value.id, DEFAULT_FORM.teamSize);
  assert.ok(reRequest.ok);
});

test('users already in a team cannot be invited elsewhere', () => {
  freshDb();
  signup('owner1');
  signup('owner2');
  signup('member');
  const t1 = createTeam(db, actorOf('owner1'), EV, G, 'Echo-1', 'public', 'owner1');
  const t2 = createTeam(db, actorOf('owner2'), EV, G, 'Echo-2', 'public', 'owner2');
  assert.ok(t1.ok && t2.ok);
  if (!t1.ok || !t2.ok) return;

  const inv = createInvite(db, actorOf('owner1'), EV, G, t1.value.id, 'member', DEFAULT_FORM.teamSize);
  assert.ok(inv.ok);
  if (!inv.ok) return;
  assert.ok(decideRequest(db, actorOf('member'), inv.value.id, 'accept', DEFAULT_FORM.teamSize).ok);

  const poach = createInvite(db, actorOf('owner2'), EV, G, t2.value.id, 'member', DEFAULT_FORM.teamSize);
  assert.equal(poach.ok, false);
  if (!poach.ok) assert.equal(poach.code, 'already_in_team');
});
