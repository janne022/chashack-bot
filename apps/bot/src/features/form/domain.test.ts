import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_FORM, validateSignupInput, normalizeFormUpdate, validateCustomAnswers, validateCustomQuestions, validBannerUrl, normalizeAppearance } from './domain.js';

const CONFIG = DEFAULT_FORM;

const baseQuestion = { id: 'map-exp', kind: 'single_choice' as const, label: { en: 'Experience' }, help: { en: '' }, required: false, presentation: 'web' as const, visibility: 'self_and_organizer' as const, choices: [{ id: 'new', label: { en: 'New' } }, { id: 'old', label: { en: 'Old' } }] };

test('legacy whitespace labels remain answerable but are rejected for new publication', () => {
  const question = { ...baseQuestion, label: { en: ' ' }, choices: [{ id: 'new', label: { en: ' ' } }] };
  assert.ok(validateCustomAnswers({ customQuestions: [question] }, { 'map-exp': 'new' }).ok);
  assert.equal(validateCustomQuestions([question], CONFIG, false, true).ok, false);
});

test('mapped choices require exact own keys and valid target options', () => {
  const question = { ...baseQuestion, mapping: { field: 'experience' as const, importance: 'high' as const, choiceValues: { new: 'first_timer', old: 'veteran' } } };
  assert.equal(validateCustomQuestions([question], CONFIG).ok, true);
  assert.equal(validateCustomQuestions([{ ...question, mapping: { ...question.mapping, choiceValues: { new: 'first_timer' } } }], CONFIG).ok, false);
  assert.equal(validateCustomQuestions([{ ...question, kind: 'multi_choice' as const }], CONFIG).ok, false);
  assert.equal(validateCustomQuestions([{ ...question, mapping: { ...question.mapping, arbitrary: true } }], CONFIG).ok, false);
  assert.equal(validateCustomQuestions([{ ...question, mapping: { ...question.mapping, choiceValues: Object.assign(Object.create({ rogue: 'veteran' }), { new: 'first_timer', old: 'veteran' }) } }], CONFIG).ok, false);
});

test('accepts a valid signup payload', () => {
  const res = validateSignupInput(CONFIG, { displayName: 'Alice', experience: 'some_experience', roleTrack: 'frontend', skills: ['frontend_react', 'ui_design', 'backend_node'], teamPref: 'random_team' });
  assert.equal(res.ok, true);
  if (res.ok) { assert.equal(res.value.displayName, 'Alice'); assert.deepEqual(res.value.skills, ['frontend_react', 'ui_design', 'backend_node']); }
});

test('rejects empty/short names and unknown options', () => {
  const res = validateSignupInput(CONFIG, { displayName: '  ', experience: 'nonsense', roleTrack: 'nope', skills: ['frontend_react'], teamPref: 'x' });
  assert.equal(res.ok, false);
  if (!res.ok) assert.ok(res.errors.length >= 3);
});

test('enforces group exclusivity — only one backend language survives', () => {
  const res = validateSignupInput(CONFIG, { displayName: 'Bob', experience: 'veteran', roleTrack: 'backend', skills: ['backend_node', 'backend_python', 'backend_csharp', 'devops'], teamPref: 'create_team' });
  assert.equal(res.ok, true);
  if (res.ok) { assert.equal(res.value.skills.filter((s) => s.startsWith('backend_')).length, 1); assert.ok(res.value.skills.includes('devops')); }
});

test('drops unknown skills silently', () => {
  const res = validateSignupInput(CONFIG, { displayName: 'Cara', experience: 'first_timer', roleTrack: 'design', skills: ['ui_design', 'made_up_skill'], teamPref: 'join_team' });
  assert.equal(res.ok, true);
  if (res.ok) assert.deepEqual(res.value.skills, ['ui_design']);
});

test('normalizeFormUpdate clamps team size', () => {
  assert.equal(normalizeFormUpdate(DEFAULT_FORM, { teamSize: 99 }).teamSize, 25);
  assert.equal(normalizeFormUpdate(DEFAULT_FORM, { teamSize: 1 }).teamSize, 2);
});

test('explicit empty profile option lists preserve custom-only forms', () => {
  const form = normalizeFormUpdate(DEFAULT_FORM, { experiences: [], roleTracks: [], skills: [], teamPrefs: [], customQuestions: [{ id: 'project', kind: 'text', label: { en: 'Project idea' }, help: { en: '' }, required: true, presentation: 'web', visibility: 'self_and_organizer' }] });
  assert.deepEqual([form.experiences, form.roleTracks, form.skills, form.teamPrefs], [[], [], [], []]);
});

test('normalizeFormUpdate keeps ids slug-safe and dedupes', () => {
  const next = normalizeFormUpdate(DEFAULT_FORM, { roleTracks: [{ id: 'Frontend!!', label: 'Frontend' }, { id: 'frontend', label: 'Dup' }, { id: '', label: 'No id' }] });
  const ids = next.roleTracks.map((r) => r.id);
  assert.ok(!ids.includes('')); assert.equal(new Set(ids).size, ids.length); assert.equal(next.roleTracks[0]!.label, 'Frontend');
});

test('custom answers reject unknown questions, invalid choices, and oversized text', () => {
  const form = { ...DEFAULT_FORM, customQuestions: [{ id: 'q-goal', kind: 'text' as const, label: { en: 'Goal', sv: 'Mål' }, help: { en: '' }, required: true, presentation: 'web' as const, visibility: 'self_and_organizer' as const }, { id: 'q-choice', kind: 'single_choice' as const, label: { en: 'Track' }, help: { en: '' }, required: false, presentation: 'both' as const, visibility: 'organizer_only' as const, choices: [{ id: 'build', label: { en: 'Build' } }] }] };
  assert.deepEqual(validateCustomAnswers(form, { 'q-goal': 'Build a game' }), { ok: true, answers: { 'q-goal': 'Build a game' }, missingRequiredQuestionIds: [] });
  assert.equal(validateCustomAnswers(form, { rogue: 'x' }).ok, false); assert.equal(validateCustomAnswers(form, { 'q-goal': 'valid', 'q-choice': 'unknown' }).ok, false); assert.equal(validateCustomAnswers(form, { 'q-goal': 'x'.repeat(2001) }).ok, false);
});

test('custom question definitions reject private matching inputs and malformed choice sets', () => {
  assert.equal(validateCustomQuestions([{ id: 'diet', kind: 'text', label: { en: 'Diet' }, help: { en: '' }, required: false, presentation: 'web', visibility: 'organizer_only', mapping: { field: 'skills', importance: 'low', choiceValues: {} } }], CONFIG).ok, false);
  assert.equal(validateCustomQuestions([{ id: 'pick', kind: 'single_choice', label: { en: 'Pick' }, help: { en: '' }, required: true, presentation: 'both', visibility: 'self_and_organizer', choices: [{ id: 'x', label: { en: 'X' } }, { id: 'x', label: { en: 'Dup' } }] }], CONFIG).ok, false);
});

test('required private fields block participant completion', () => {
  const form = { ...DEFAULT_FORM, customQuestions: [{ id: 'private', kind: 'text' as const, label: { en: 'Organizer note' }, help: { en: '' }, required: true, presentation: 'web' as const, visibility: 'organizer_only' as const }] };
  assert.deepEqual(validateCustomAnswers(form, {}), { ok: true, answers: {}, missingRequiredQuestionIds: ['private'] });
});

test('banner URLs allow only bounded HTTPS URLs without embedded credentials', () => {
  assert.equal(validBannerUrl('https://cdn.example.test/banner.webp'), true); assert.equal(validBannerUrl('javascript:1'), false); assert.equal(validBannerUrl('http://example.test/banner.webp'), false); assert.equal(validBannerUrl('https://user:pass@example.test/a'), false);
});

test('appearance normalization accepts only supported preset, colors, and HTTPS image URLs', () => {
  assert.deepEqual(normalizeAppearance({ themePreset: 'halloween', accentColor: '#123456', bannerUrl: 'https://cdn.example.test/banner.webp' }), {
    themePreset: 'halloween', accentColor: '#123456', bannerUrl: 'https://cdn.example.test/banner.webp',
  });
  assert.equal(normalizeAppearance({ themePreset: 'halloween', css: 'body{}' }), null);
  assert.equal(normalizeAppearance({ backgroundUrl: 'http://example.test/bg' }), null);
  assert.deepEqual(normalizeAppearance({ themePreset: 'christmas', mode: 'dark', backgroundColor: '#121a20', surfaceColor: '#242b30', textColor: '#ffffff', backgroundUrl: 'https://cdn.example.test/bg.webp' }), {
    themePreset: 'christmas', accentColor: '#347b57', bannerUrl: null, mode: 'dark', backgroundColor: '#121a20', surfaceColor: '#242b30', textColor: '#ffffff', backgroundUrl: 'https://cdn.example.test/bg.webp',
  });
  assert.equal(normalizeAppearance({ mode: 'light', backgroundColor: '#ffffff', surfaceColor: '#ffffff', textColor: '#ffffff' }), null);
  assert.equal(normalizeAppearance({ backgroundUrl: 'https://user:pass@example.test/bg' }), null);
});
