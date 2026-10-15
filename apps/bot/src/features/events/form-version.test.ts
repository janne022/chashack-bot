import assert from 'node:assert/strict';
import { test } from 'node:test';
import { activateEvent, createEvent, updateEventForm } from './data.js';
import { DEFAULT_FORM } from '../form/domain.js';
import { openTestDb } from '../../shared/test-db.js';

test('structural form changes conflict on populated published events', async () => {
  const db = await openTestDb();
  try {
    const created = await createEvent(db, 'test', 'guild-a', { name: 'Versioned' });
    assert.equal(created.ok, true);
    if (!created.ok) return;
    await activateEvent(db, 'test', created.value.id);
    await db.run("INSERT INTO participants (event_id,user_id,guild_id,display_name,experience,role_track,skills,team_pref,teammates,status,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,'active',1,1)",
      created.value.id, 'participant-a', 'guild-a', 'A', '', '', '[]', '', '[]');
    const result = await updateEventForm(db, 'test', created.value.id, {
      customQuestions: [{ id: 'new-required', kind: 'text', label: { en: 'New' }, help: { en: '' }, required: true, presentation: 'web', visibility: 'self_and_organizer' }],
    });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, 'form_version_conflict');
  } finally { await db.close(); }
});

test('changing a mapped core target is structural on populated published events', async () => {
  const db = await openTestDb();
  try {
    const form = { ...DEFAULT_FORM, customQuestions: [{ id: 'role-map', kind: 'single_choice' as const, label: { en: 'Role' }, help: { en: '' }, required: false, presentation: 'web' as const, visibility: 'self_and_organizer' as const, choices: [{ id: 'x', label: { en: 'X' } }], mapping: { field: 'role' as const, importance: 'normal' as const, choiceValues: { x: 'frontend' } } }] };
    const created = await createEvent(db, 'test', 'guild-map', { name: 'Mapped version', form });
    assert.equal(created.ok, true);
    if (!created.ok) return;
    await activateEvent(db, 'test', created.value.id);
    await db.run("INSERT INTO participants (event_id,user_id,guild_id,display_name,experience,role_track,skills,team_pref,teammates,status,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,'active',1,1)",
      created.value.id, 'participant-map', 'guild-map', 'A', '', '', '[]', '', '[]');
    const result = await updateEventForm(db, 'test', created.value.id, { roleTracks: [{ id: 'backend', label: 'Backend' }] });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, 'form_version_conflict');
  } finally { await db.close(); }
});

test('partial question updates reject invalid role and skill mapping targets without changing the form', async () => {
  const db = await openTestDb();
  try {
    const created = await createEvent(db, 'test', 'guild-partial', { name: 'Partial mapping' });
    assert.equal(created.ok, true);
    if (!created.ok) return;
    const before = await updateEventForm(db, 'test', created.value.id, {});
    assert.equal(before.ok, true);
    const questions = (['role', 'skills'] as const).map((field) => ({
      id: `${field}-map`, kind: 'single_choice' as const, label: { en: field }, help: { en: '' },
      required: false, presentation: 'web' as const, visibility: 'self_and_organizer' as const,
      choices: [{ id: 'x', label: { en: 'X' } }],
      mapping: { field, importance: 'normal' as const, choiceValues: { x: 'not-a-real-option' } },
    }));
    for (const question of questions) {
      const result = await updateEventForm(db, 'test', created.value.id, { customQuestions: [question] });
      assert.equal(result.ok, false);
      if (!result.ok) assert.equal(result.code, 'invalid_questions');
      const stored: { form_json: string } | undefined = await db.get('SELECT form_json FROM events WHERE id = ?', created.value.id);
      assert.equal(JSON.parse(stored!.form_json).version, before.ok ? before.value.version : -1);
      assert.deepEqual(JSON.parse(stored!.form_json).customQuestions ?? [], []);
    }
    const validRoleQuestion = { ...questions[0]!, mapping: { ...questions[0]!.mapping, choiceValues: { x: 'frontend' } } };
    const valid = await updateEventForm(db, 'test', created.value.id, { customQuestions: [validRoleQuestion] });
    assert.equal(valid.ok, true);
  } finally { await db.close(); }
});

test('target-list updates cannot invalidate inherited mappings', async () => {
  const db = await openTestDb();
  try {
    const form = { ...DEFAULT_FORM, customQuestions: [{ id: 'role-map', kind: 'single_choice' as const, label: { en: 'Role' }, help: { en: '' }, required: false, presentation: 'web' as const, visibility: 'self_and_organizer' as const, choices: [{ id: 'x', label: { en: 'X' } }], mapping: { field: 'role' as const, importance: 'normal' as const, choiceValues: { x: 'frontend' } } }] };
    const created = await createEvent(db, 'test', 'guild-targets', { name: 'Target update', form });
    assert.equal(created.ok, true);
    if (!created.ok) return;
    const result = await updateEventForm(db, 'test', created.value.id, { roleTracks: [{ id: 'backend', label: 'Backend' }] });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, 'invalid_questions');
  } finally { await db.close(); }
});
