import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildTeams, scorePair, suggestTeamsForParticipant } from './domain.js';
import { DEFAULT_FORM, type FormConfig } from '../form/domain.js';
import type { Participant } from '../signup/data.js';
import type { TeamWithMembers } from '../teams/data.js';

function makeParticipant(overrides: Partial<Participant> & { userId: string }): Participant {
  return {
    eventId: 'ev1',
    guildId: 'g1',
    displayName: overrides.userId,
    experience: 'some_experience',
    roleTrack: 'fullstack',
    skills: [],
    teamPref: 'random_team',
    teammates: [],
    teamId: null,
    status: 'active',
    blockReason: null,
    createdAt: 0,
    updatedAt: 0,
    ...overrides,
  };
}

const CONFIG: FormConfig = { ...DEFAULT_FORM, teamSize: 3 };

test('scorePair: complementary roles + shared skill outscore identical strangers', () => {
  const a = makeParticipant({
    userId: 'a',
    roleTrack: 'frontend',
    skills: ['frontend_react'],
    experience: 'veteran',
  });
  const b = makeParticipant({
    userId: 'b',
    roleTrack: 'backend',
    skills: ['frontend_react'],
    experience: 'first_timer',
  });
  const c = makeParticipant({ userId: 'c', roleTrack: 'frontend', skills: [], experience: 'veteran' });
  const d = makeParticipant({ userId: 'd', roleTrack: 'frontend', skills: [], experience: 'veteran' });
  assert.ok(scorePair(a, b) > scorePair(c, d));
});

test('mutual friends always land on the same team', () => {
  const a = makeParticipant({ userId: 'a', teammates: ['b'] });
  const b = makeParticipant({ userId: 'b', teammates: ['a'] });
  const c = makeParticipant({ userId: 'c' });
  const d = makeParticipant({ userId: 'd' });
  const e = makeParticipant({ userId: 'e' });
  const result = buildTeams([a, b, c, d, e], CONFIG);
  const teamOfA = result.teams.find((t) => t.memberIds.includes('a'));
  assert.ok(teamOfA !== undefined);
  assert.ok(teamOfA.memberIds.includes('b'), `a's team: ${teamOfA.memberIds.join(',')}`);
});

test('complementary roles get pulled together over duplicates', () => {
  const fe = makeParticipant({ userId: 'fe', roleTrack: 'frontend', skills: ['frontend_react'] });
  const be = makeParticipant({ userId: 'be', roleTrack: 'backend', skills: ['backend_node'] });
  const de = makeParticipant({ userId: 'de', roleTrack: 'design', skills: ['ui_design'] });
  const do1 = makeParticipant({ userId: 'ops', roleTrack: 'devops', skills: ['devops'] });
  const fe2 = makeParticipant({ userId: 'fe2', roleTrack: 'frontend', skills: ['frontend_vue'] });
  const fe3 = makeParticipant({ userId: 'fe3', roleTrack: 'frontend', skills: ['frontend_react'] });
  const fe4 = makeParticipant({ userId: 'fe4', roleTrack: 'frontend', skills: [] });
  const result = buildTeams([fe, be, de, do1, fe2, fe3, fe4], CONFIG);
  const feTeam = result.teams.find((t) => t.memberIds.includes('fe'))!;
  // With diverse candidates available, fe's team should contain a non-frontend member.
  const roles = feTeam.memberIds.map((id) => [fe, fe2, fe3, fe4, be, de, do1].find((p) => p.userId === id)!.roleTrack);
  assert.ok(roles.some((r) => r !== 'frontend'), `fe team roles: ${roles.join(',')} — all teams: ${JSON.stringify(result.teams.map((t) => t.memberIds))}`);
});

test('oversized friend group degrades to preference and reports a conflict', () => {
  const ids = ['p1', 'p2', 'p3', 'p4', 'p5'];
  const group = ids.map((id) =>
    makeParticipant({ userId: id, teammates: ids.filter((o) => o !== id) }),
  );
  const result = buildTeams(group, CONFIG); // teamSize 3 < group of 5
  assert.ok(result.conflicts.some((c) => c.includes('larger than team size')));
});

test('everyone gets placed exactly once', () => {
  const people = 'abcdefghij'.split('').map((id, i) =>
    makeParticipant({
      userId: id,
      roleTrack: ['frontend', 'backend', 'design', 'devops', 'fullstack'][i % 5]!,
    }),
  );
  const result = buildTeams(people, CONFIG);
  const placed = result.teams.flatMap((t) => t.memberIds);
  assert.equal(placed.length, people.length);
  assert.equal(new Set(placed).size, people.length);
});

// ─── suggestTeamsForParticipant ──────────────────────────────────────────────

function makeTeam(id: string, name: string, members: Participant[]): TeamWithMembers {
  return {
    id,
    eventId: 'ev1',
    guildId: 'g1',
    name,
    kind: 'public',
    ownerId: null,
    joinCode: null,
    roleId: null,
    textChannelId: null,
    voiceChannelId: null,
    colorId: null,
    createdAt: 0,
    members: members.map((m) => ({
      userId: m.userId,
      displayName: m.displayName,
      roleTrack: m.roleTrack,
      experience: m.experience,
      skills: m.skills,
    })),
  };
}

test('suggest: orders teams by best average fit and caps at 3', () => {
  // Two shared skills + same role track (74) must beat a complementary stranger (63).
  const late = makeParticipant({ userId: 'late', roleTrack: 'frontend', skills: ['frontend_react', 'frontend_typescript'], experience: 'veteran' });
  const be = makeParticipant({ userId: 'be', roleTrack: 'backend', skills: [], experience: 'first_timer' });
  const feLike = makeParticipant({ userId: 'felike', roleTrack: 'frontend', skills: ['frontend_react', 'frontend_typescript'], experience: 'veteran' });
  const teams = [makeTeam('t1', 'Zeta', [be]), makeTeam('t2', 'Alpha', [feLike])];
  const suggestions = suggestTeamsForParticipant(late, teams, CONFIG);
  assert.equal(suggestions.length, 2);
  assert.equal(suggestions[0]!.teamId, 't2');
  assert.ok(suggestions[0]!.score >= suggestions[1]!.score);
});

test('suggest: respects team capacity (full teams are excluded)', () => {
  const late = makeParticipant({ userId: 'late' });
  const full = makeTeam('tfull', 'Full', [makeParticipant({ userId: 'm1' }), makeParticipant({ userId: 'm2' }), makeParticipant({ userId: 'm3' })]);
  const open = makeTeam('topen', 'Open', [makeParticipant({ userId: 'm4' })]);
  const suggestions = suggestTeamsForParticipant(late, [full, open], CONFIG); // teamSize 3
  assert.equal(suggestions.length, 1);
  assert.equal(suggestions[0]!.teamId, 'topen');
});

test('suggest: returns at most 3 even with many open teams', () => {
  const late = makeParticipant({ userId: 'late' });
  const many = ['a', 'b', 'c', 'd', 'e'].map((id) => makeTeam(`t${id}`, `Team ${id.toUpperCase()}`, []));
  const suggestions = suggestTeamsForParticipant(late, many, CONFIG);
  assert.equal(suggestions.length, 3);
});

test('suggest: empty teams list yields no suggestions', () => {
  const late = makeParticipant({ userId: 'late' });
  assert.deepEqual(suggestTeamsForParticipant(late, [], CONFIG), []);
});

test('suggest: never auto-assigns (pure, no mutation of input teams)', () => {
  const late = makeParticipant({ userId: 'late' });
  const teams = [makeTeam('t1', 'Alpha', [])];
  const before = JSON.stringify(teams);
  suggestTeamsForParticipant(late, teams, CONFIG);
  assert.equal(JSON.stringify(teams), before);
});
