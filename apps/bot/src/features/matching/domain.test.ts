import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildTeams, projectMatchingParticipant, scorePair, suggestTeamsForParticipant } from './domain.js';
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
    importedSignupId: null,
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

test('mapped choices project matching fields and weight only their own contribution', () => {
  const form: FormConfig = { ...CONFIG, customQuestions: [{ id: 'exp', kind: 'single_choice', label: { en: 'Experience' }, help: { en: '' }, required: false, presentation: 'web', visibility: 'self_and_organizer', mapping: { field: 'experience', importance: 'high', choiceValues: { novice: 'first_timer', expert: 'veteran' } }, choices: [{ id: 'novice', label: { en: 'New' } }, { id: 'expert', label: { en: 'Experienced' } }] }] };
  const mapped = projectMatchingParticipant(makeParticipant({ userId: 'a', experience: 'veteran' }), form, { exp: 'novice' });
  assert.equal(mapped.experience, 'first_timer');
  assert.deepEqual(mapped.matchingImportance, { experience: 2 });
  const plain = makeParticipant({ userId: 'b', experience: 'first_timer' });
  assert.equal(scorePair(mapped, plain, form), scorePair(plain, plain, form) + 1.5);
  assert.equal(projectMatchingParticipant(plain, form, {}).experience, 'first_timer');
});

test('skill mappings replace legacy matching skills, deduplicate, and ignore private questions', () => {
  const form: FormConfig = { ...CONFIG, customQuestions: [
    { id: 'skills', kind: 'multi_choice', label: { en: 'Skills' }, help: { en: '' }, required: false, presentation: 'web', visibility: 'self_and_organizer', choices: [{ id: 'one', label: { en: 'One' } }, { id: 'two', label: { en: 'Two' } }], mapping: { field: 'skills', importance: 'low', choiceValues: { one: 'backend_node', two: 'backend_node' } } },
    { id: 'private', kind: 'single_choice', label: { en: 'Private' }, help: { en: '' }, required: false, presentation: 'web', visibility: 'organizer_only', choices: [{ id: 'secret', label: { en: 'Secret' } }] },
  ] };
  const result = projectMatchingParticipant(makeParticipant({ userId: 'mapped', skills: ['frontend_react'] }), form, { skills: ['one', 'two'], private: 'secret' });
  assert.deepEqual(result.skills, ['backend_node']);
  assert.deepEqual(result.matchingImportance, { skills: 0.5 });
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

test('matching spreads 17 participants across teams as evenly as possible', () => {
  const people = Array.from({ length: 17 }, (_, i) => makeParticipant({ userId: `p${i}` }));
  const result = buildTeams(people, { ...CONFIG, teamSize: 5 });
  assert.deepEqual(result.teams.map(team => team.memberIds.length).sort((a, b) => b - a), [5, 4, 4, 4]);
  assert.equal(new Set(result.teams.flatMap(team => team.memberIds)).size, 17);
});

test('matching balances around mutual friend groups without splitting them', () => {
  const friends = ['a', 'b', 'c'].map(id => makeParticipant({ userId: id, teammates: ['a', 'b', 'c'].filter(other => other !== id) }));
  const people = [...friends, ...['d', 'e', 'f', 'g', 'h', 'i'].map(userId => makeParticipant({ userId }))];
  const result = buildTeams(people, { ...CONFIG, teamSize: 5 });
  assert.deepEqual(result.teams.map(team => team.memberIds.length).sort((a, b) => b - a), [5, 4]);
  assert.ok(result.teams.some(team => friends.every(friend => team.memberIds.includes(friend.userId))));
});

test('unconstrained teams differ by at most one across participant counts', () => {
  for (let size = 2; size <= 8; size++) {
    for (let count = 1; count <= 40; count++) {
      const people = Array.from({ length: count }, (_, i) => makeParticipant({ userId: `p${i}` }));
      const teams = buildTeams(people, { ...CONFIG, teamSize: size }).teams;
      const lengths = teams.map(team => team.memberIds.length);
      assert.equal(teams.length, Math.ceil(count / size));
      assert.ok(Math.max(...lengths) - Math.min(...lengths) <= 1, `${count} people, max ${size}: ${lengths}`);
      assert.equal(new Set(teams.flatMap(team => team.memberIds)).size, count);
    }
  }
});

test('a full mutual friend group stays together when equal sizes are impossible', () => {
  const ids = ['a', 'b', 'c', 'd', 'e'];
  const friends = ids.map(userId => makeParticipant({ userId, teammates: ids.filter(id => id !== userId) }));
  const teams = buildTeams([...friends, makeParticipant({ userId: 'f' }), makeParticipant({ userId: 'g' })], { ...CONFIG, teamSize: 5 }).teams;
  assert.deepEqual(teams.map(team => team.memberIds.length).sort((a, b) => b - a), [5, 2]);
  assert.ok(teams.some(team => ids.every(id => team.memberIds.includes(id))));
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

test('suggestions use the mapped member importance when scoring the same projected fields', () => {
  const late = makeParticipant({ userId: 'late', experience: 'first_timer' });
  const member = makeParticipant({ userId: 'member', experience: 'first_timer' });
  const team = makeTeam('weighted', 'Weighted', [member]);
  team.members[0]!.matchingImportance = { experience: 2 };
  const result = suggestTeamsForParticipant(late, [team], CONFIG);
  assert.equal(result[0]!.score, 60);
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
