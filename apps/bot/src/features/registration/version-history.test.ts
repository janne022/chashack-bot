import assert from 'node:assert/strict';
import test from 'node:test';
import { createEvent, getEvent, getEventForm, updateEventForm } from '../events/data.js';
import { DEFAULT_FORM } from '../form/domain.js';
import { saveParticipantAnswers } from './data.js';
import { getImportedAnswerHistory, getRegistrationAnswerHistory } from './history.js';
import { linkImportedSignup } from '../signup-import/link.js';
import { openTestDb } from '../../shared/test-db.js';

test('structural replacement keeps participant and imported answers bound to their original definition', async () => {
  const db = await openTestDb();
  try {
    const oldQuestion = { id: 'same-id', kind: 'text' as const, label: { en: 'Old private prompt', sv: 'Gammal privat fråga' }, help: { en: '' }, required: false, presentation: 'web' as const, visibility: 'organizer_only' as const };
    const created = await createEvent(db, 'test', 'guild-history', { name: 'History', form: { ...DEFAULT_FORM, customQuestions: [oldQuestion] } });
    assert.ok(created.ok);
    if (!created.ok) return;
    const eventId = created.value.id;
    const oldVersion = getEventForm(db, await getEvent(db, eventId), DEFAULT_FORM).version;
    const oldForm = getEventForm(db, await getEvent(db, eventId), DEFAULT_FORM);
    await db.run("UPDATE events SET status='active' WHERE id=?", eventId);
    await db.run("INSERT INTO registration_answers VALUES (?,?,?,?,?)", eventId, 'participant-a', oldVersion,
      JSON.stringify({ 'same-id': 'participant-private-sentinel' }), 111);
    await db.run(`INSERT INTO imported_signups
      (id,event_id,guild_id,source_row,form_version,values_json,answers_json,created_at,updated_at)
      VALUES ('import-a',?,?,2,?,?,?,100,222)`, eventId, 'guild-history', oldVersion,
      JSON.stringify({ allergies: 'imported-source-sentinel' }), JSON.stringify({ 'same-id': 'import-private-sentinel' }));

    const replacement = { ...oldQuestion, label: { en: 'New public prompt', sv: 'Ny publik fråga' }, visibility: 'self_and_organizer' as const };
    const changed = await updateEventForm(db, 'test', eventId, { customQuestions: [replacement] });
    assert.ok(changed.ok);
    if (!changed.ok) return;
    assert.equal(changed.value.version, oldVersion + 1);
    const newVersion = changed.value.version;
    const saved = await saveParticipantAnswers(db, eventId, 'participant-a', newVersion, { 'same-id': 'new-answer' }, ['same-id']);
    assert.ok(saved.ok);
    assert.deepEqual(saved.ok && saved.value.answers, { 'same-id': 'new-answer' });
    const storedParticipant = await db.get<{ answers_json: string }>('SELECT answers_json FROM registration_answers WHERE event_id=? AND user_id=?', eventId, 'participant-a');
    assert.deepEqual(JSON.parse(storedParticipant!.answers_json), { 'same-id': 'new-answer' });
    const participantHistory = await getRegistrationAnswerHistory(db, eventId, 'participant-a');
    assert.equal(participantHistory.length, 1);
    assert.equal(participantHistory[0]!.formVersion, oldVersion);
    assert.equal(participantHistory[0]!.answers['same-id'], 'participant-private-sentinel');
    assert.deepEqual(participantHistory[0]!.questions, oldForm.customQuestions);
    assert.equal(participantHistory[0]!.questions[0]!.visibility, 'organizer_only');

    const linked = await linkImportedSignup(db, eventId, 'guild-history', 'import-a', 'participant-b', changed.value, { organizer: true });
    assert.equal(linked.linked, true);
    const currentImport = await db.get<{ form_version: number; answers_json: string; values_json: string }>(
      'SELECT form_version,answers_json,values_json FROM imported_signups WHERE id=? AND event_id=?', 'import-a', eventId,
    );
    assert.equal(currentImport!.form_version, newVersion);
    assert.deepEqual(JSON.parse(currentImport!.answers_json), {});
    assert.equal(JSON.parse(currentImport!.values_json).allergies, 'imported-source-sentinel');
    const importedHistory = await getImportedAnswerHistory(db, eventId, 'import-a');
    assert.equal(importedHistory.length, 1);
    assert.equal(importedHistory[0]!.answers['same-id'], 'import-private-sentinel');
    assert.equal(importedHistory[0]!.values?.allergies, 'imported-source-sentinel');
    assert.deepEqual(importedHistory[0]!.questions, oldForm.customQuestions);
    assert.equal(importedHistory[0]!.questions[0]!.visibility, 'organizer_only');
  } finally { await db.close(); }
});
