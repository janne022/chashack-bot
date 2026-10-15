import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_FORM, validateSignupInput, normalizeFormUpdate, validateCustomAnswers, validateCustomQuestions, validBannerUrl } from './domain.js';

const CONFIG = DEFAULT_FORM;

test('accepts a valid signup payload', () => {
  const res = validateSignupInput(CONFIG, {
    displayName: 'Alice',
    experience: 'some_experience',
    roleTrack: 'frontend',
    skills: ['frontend_react', 'ui_design', 'backend_node'],
    teamPref: 'random_team',
  });
  assert.equal(res.ok, true);
  if (res.ok) {
    assert.equal(res.value.displayName, 'Alice');
    assert.deepEqual(res.value.skills, ['frontend_react', 'ui_design', 'backend_node']);
  }
});

test('rejects empty/short names and unknown options', () => {
  const res = validateSignupInput(CONFIG, {
    displayName: '  ',
    experience: 'nonsense',
    roleTrack: 'nope',
    skills: ['frontend_react'],
    teamPref: 'x',
  });
  assert.equal(res.ok, false);
  if (!res.ok) {
    assert.ok(res.errors.length >= 3);
  }
});

test('enforces group exclusivity — only one backend language survives', () => {
  const res = validateSignupInput(CONFIG, {
    displayName: 'Bob',
    experience: 'veteran',
    roleTrack: 'backend',
    skills: ['backend_node', 'backend_python', 'backend_csharp', 'devops'],
    teamPref: 'create_team',
  });
  assert.equal(res.ok, true);
  if (res.ok) {
    // First valid backend skill in config order wins; devops (group '') is kept.
    assert.equal(res.value.skills.filter((s) => s.startsWith('backend_')).length, 1);
    assert.ok(res.value.skills.includes('devops'));
  }
});

test('drops unknown skills silently', () => {
  const res = validateSignupInput(CONFIG, {
    displayName: 'Cara',
    experience: 'first_timer',
    roleTrack: 'design',
    skills: ['ui_design', 'made_up_skill'],
    teamPref: 'join_team',
  });
  assert.equal(res.ok, true);
  if (res.ok) assert.deepEqual(res.value.skills, ['ui_design']);
});

test('normalizeFormUpdate clamps team size', () => {
  const next = normalizeFormUpdate(DEFAULT_FORM, { teamSize: 99 });
  assert.equal(next.teamSize, 25);
  const next2 = normalizeFormUpdate(DEFAULT_FORM, { teamSize: 1 });
  assert.equal(next2.teamSize, 2);
});

test('normalizeFormUpdate keeps ids slug-safe and dedupes', () => {
  const next = normalizeFormUpdate(DEFAULT_FORM, {
    roleTracks: [
      { id: 'Frontend!!', label: 'Frontend' },
      { id: 'frontend', label: 'Dup' },
      { id: '', label: 'No id' },
    ],
  });
  const ids = next.roleTracks.map((r) => r.id);
  assert.ok(!ids.includes(''));
  assert.equal(new Set(ids).size, ids.length);
  assert.equal(next.roleTracks[0]!.label, 'Frontend');
});

test('custom answers reject unknown questions, invalid choices, and oversized text', () => {
  const form = {
    ...DEFAULT_FORM,
    customQuestions: [{
      id: 'q-goal', kind: 'text' as const, label: { en: 'Goal', sv: 'Mål' }, help: { en: '' },
      required: true, presentation: 'web' as const, visibility: 'self_and_organizer' as const,
    }, {
      id: 'q-choice', kind: 'single_choice' as const, label: { en: 'Track' }, help: { en: '' },
      required: false, presentation: 'both' as const, visibility: 'organizer_only' as const,
      choices: [{ id: 'build', label: { en: 'Build' } }],
    }],
  };
  assert.deepEqual(validateCustomAnswers(form, { 'q-goal': 'Build a game' }), {
    ok: true, answers: { 'q-goal': 'Build a game' }, missingRequiredQuestionIds: [],
  });
  assert.equal(validateCustomAnswers(form, { rogue: 'x' }).ok, false);
  assert.equal(validateCustomAnswers(form, { 'q-goal': 'valid', 'q-choice': 'unknown' }).ok, false);
  assert.equal(validateCustomAnswers(form, { 'q-goal': 'x'.repeat(2001) }).ok, false);
});

test('custom question definitions reject private matching inputs and malformed choice sets', () => {
  assert.equal(validateCustomQuestions([{ id: 'diet', kind: 'text', label: { en: 'Diet' }, help: { en: '' }, required: false,
    presentation: 'web', visibility: 'organizer_only', mapping: { field: 'skills', importance: 'low' } }]).ok, false);
  assert.equal(validateCustomQuestions([{ id: 'pick', kind: 'single_choice', label: { en: 'Pick' }, help: { en: '' }, required: true,
    presentation: 'both', visibility: 'self_and_organizer', choices: [{ id: 'x', label: { en: 'X' } }, { id: 'x', label: { en: 'Dup' } }] }]).ok, false);
});

test('banner URLs allow only bounded HTTPS URLs without embedded credentials', () => {
  assert.equal(validBannerUrl('https://cdn.example.test/banner.webp'), true);
  assert.equal(validBannerUrl('javascript:1'), false);
  assert.equal(validBannerUrl('http://example.test/banner.webp'), false);
  assert.equal(validBannerUrl('https://user:pass@example.test/a'), false);
});
