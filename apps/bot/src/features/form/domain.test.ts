import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_FORM, validateSignupInput, normalizeFormUpdate } from './domain.js';

const CONFIG = DEFAULT_FORM;

test('accepts a valid signup payload', () => {
  const res = validateSignupInput(CONFIG, {
    displayName: 'Alice',
    experience: 'some_experience',
    roleTrack: 'frontend',
    skills: ['frontend_react', 'ui_design', 'backend_node'],
    teamPref: 'private_team',
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
    teamPref: 'with_friends',
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
    teamPref: 'public_team',
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
