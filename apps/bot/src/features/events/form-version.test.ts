import assert from 'node:assert/strict';
import { test } from 'node:test';
import { activateEvent, createEvent, getEvent, getEventForm, updateEventForm } from './data.js';
import { DEFAULT_FORM } from '../form/domain.js';
import { openTestDb } from '../../shared/test-db.js';

test('an incomplete draft form survives editing and cannot be activated until complete', async () => {
  const db = await openTestDb();
  try {
    const question = { id: 'draft', kind: 'text' as const, label: { en: '' }, help: { en: '' }, required: true, presentation: 'web' as const, visibility: 'self_and_organizer' as const };
    const created = await createEvent(db, 'test', 'guild-draft', { name: 'Draft event', form: { ...DEFAULT_FORM, customQuestions: [question] }, allowIncompleteForm: true });
    assert.ok(created.ok);
    if (!created.ok) return;
    const id = created.value.id;
    assert.equal(getEventForm(db, await getEvent(db, id), DEFAULT_FORM).customQuestions?.[0]?.label.en, '');
    const denied = await activateEvent(db, 'test', id);
    assert.equal(denied.ok, false);
    assert.equal((await getEvent(db, id))?.status, 'draft');
    const fixed = await updateEventForm(db, 'test', id, { customQuestions: [{ ...question, label: { en: 'Your idea' } }] });
    assert.ok(fixed.ok);
    assert.ok((await activateEvent(db, 'test', id)).ok);
  } finally { await db.close(); }
});

test('legacy published whitespace labels remain usable without permitting new blank labels', async () => {
  const db = await openTestDb();
  try {
    const question = { id: 'legacy', kind: 'text' as const, label: { en: ' ' }, help: { en: '' }, required: false, presentation: 'web' as const, visibility: 'self_and_organizer' as const };
    const legacy = { ...DEFAULT_FORM, customQuestions: [question] };
    await db.run("INSERT INTO events (id,guild_id,name,status,form_json,created_at,updated_at) VALUES ('legacy','guild-a','Legacy','active',?,1,1)", JSON.stringify(legacy));
    const saved = await updateEventForm(db, 'test', 'legacy', { description: 'Updated description' });
    assert.ok(saved.ok);
    const rejected = await updateEventForm(db, 'test', 'legacy', { customQuestions: [{ ...question, label: { en: '  ' } }] });
    assert.equal(rejected.ok, false);
    const draft = await createEvent(db, 'test', 'guild-a', { name: 'Draft', form: legacy, allowIncompleteForm: true });
    assert.ok(draft.ok);
    if (draft.ok) assert.equal((await activateEvent(db, 'test', draft.value.id)).ok, false);
  } finally { await db.close(); }
});

test('structural form changes advance version on populated published events', async () => {
  const db = await openTestDb();
  try {
    const created = await createEvent(db, 'test', 'guild-a', { name: 'Versioned' });
    assert.equal(created.ok, true);
    if (!created.ok) return;
    const initialVersion = getEventForm(db, await getEvent(db, created.value.id), DEFAULT_FORM).version;
    await activateEvent(db, 'test', created.value.id);
    await db.run("INSERT INTO participants (event_id,user_id,guild_id,display_name,experience,role_track,skills,team_pref,teammates,status,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,'active',1,1)",
      created.value.id, 'participant-a', 'guild-a', 'A', '', '', '[]', '', '[]');
    const result = await updateEventForm(db, 'test', created.value.id, {
      customQuestions: [{ id: 'new-required', kind: 'text', label: { en: 'New' }, help: { en: '' }, required: true, presentation: 'web', visibility: 'self_and_organizer' }],
    });
    assert.equal(result.ok, true);
    if (result.ok) assert.equal(result.value.version, initialVersion + 1);
    assert.ok(await db.get('SELECT form_version FROM registration_form_versions WHERE event_id=? AND form_version=?', created.value.id, initialVersion));
  } finally { await db.close(); }
});

test('appearance edit on a populated published event preserves version and answers', async () => {
  const db = await openTestDb();
  try {
    const created = await createEvent(db, 'test', 'guild-appearance', { name: 'Appearance version' });
    assert.equal(created.ok, true);
    if (!created.ok) return;
    const id = created.value.id;
    await activateEvent(db, 'test', id);
    await db.run("INSERT INTO participants (event_id,user_id,guild_id,display_name,experience,role_track,skills,team_pref,teammates,status,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,'active',1,1)", id, 'member', 'guild-appearance', 'A', '', '', '[]', 'random_team', '[]');
    const version = getEventForm(db, await getEvent(db, id), DEFAULT_FORM).version;
    await db.run('INSERT INTO registration_answers (event_id,user_id,form_version,answers_json,updated_at) VALUES (?,?,?,?,1)', id, 'member', version, '{"goal":"build"}');
    const updated = await updateEventForm(db, 'test', id, { appearance: { themePreset: 'christmas', accentColor: '#347b57', bannerUrl: null, mode: 'dark', backgroundUrl: 'https://example.test/scene.webp' } });
    assert.equal(updated.ok, true);
    if (!updated.ok) return;
    assert.equal(updated.value.version, version);
    assert.equal(updated.value.appearance?.backgroundUrl, 'https://example.test/scene.webp');
    assert.deepEqual(await db.get('SELECT form_version,answers_json FROM registration_answers WHERE event_id = ? AND user_id = ?', id, 'member'), { form_version: version, answers_json: '{"goal":"build"}' });
    assert.equal((await db.get<{ team_pref: string }>('SELECT team_pref FROM participants WHERE event_id = ? AND user_id = ?', id, 'member'))?.team_pref, 'random_team');
  } finally { await db.close(); }
});

test('question copy edits keep the version and refresh its outgoing snapshot before structural replacement', async () => {
  const db = await openTestDb();
  try {
    const original = { id: 'prompt', kind: 'text' as const, label: { en: 'Original' }, help: { en: '' }, required: false, presentation: 'web' as const, visibility: 'self_and_organizer' as const };
    const created = await createEvent(db, 'test', 'guild-copy', { name: 'Cosmetic labels', form: { ...DEFAULT_FORM, customQuestions: [original] } });
    assert.ok(created.ok);
    if (!created.ok) return;
    const eventId = created.value.id;
    const version = getEventForm(db, await getEvent(db, eventId), DEFAULT_FORM).version;
    const cosmetic = await updateEventForm(db, 'test', eventId, { customQuestions: [{ ...original, label: { en: 'Latest wording' } }] });
    assert.ok(cosmetic.ok);
    if (!cosmetic.ok) return;
    assert.equal(cosmetic.value.version, version);
    const changed = await updateEventForm(db, 'test', eventId, { customQuestions: [{ ...original, label: { en: 'Latest wording' }, kind: 'toggle' }] });
    assert.ok(changed.ok);
    if (!changed.ok) return;
    assert.equal(changed.value.version, version + 1);
    const snapshot = await db.get<{ form_json: string }>('SELECT form_json FROM registration_form_versions WHERE event_id=? AND form_version=?', eventId, version);
    assert.equal(JSON.parse(snapshot!.form_json).customQuestions[0].label.en, 'Latest wording');
  } finally { await db.close(); }
});

test('explicit light mode on a Halloween appearance survives event form persistence', async () => {
  const db = await openTestDb();
  try {
    const created = await createEvent(db, 'test', 'guild-halloween-light', { name: 'Halloween light' });
    assert.equal(created.ok, true);
    if (!created.ok) return;
    const appearance = { themePreset: 'halloween' as const, accentColor: '#ef793e', bannerUrl: null, mode: 'light' as const };
    const saved = await updateEventForm(db, 'test', created.value.id, { appearance });
    assert.equal(saved.ok, true);
    if (!saved.ok) return;
    assert.equal(saved.value.appearance?.mode, 'light');
    const reloaded = getEventForm(db, await getEvent(db, created.value.id), DEFAULT_FORM);
    assert.equal(reloaded.appearance?.mode, 'light');
    assert.equal(reloaded.appearance?.themePreset, 'halloween');
  } finally { await db.close(); }
});

test('changing a mapped core target cannot invalidate a populated published form', async () => {
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
    if (!result.ok) assert.equal(result.code, 'invalid_questions');
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
