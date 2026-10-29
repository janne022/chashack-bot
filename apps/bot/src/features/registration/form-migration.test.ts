import assert from 'node:assert/strict';
import { test } from 'node:test';
import { openTestDb } from '../../shared/test-db.js';
import { migratePostgres } from '../../shared/postgres.js';
import { DEFAULT_FORM } from '../form/domain.js';
import { activateEvent, createEvent, updateEventForm } from '../events/data.js';
import { saveParticipantAnswers, getRegistrationAnswers } from './data.js';
import { getImportedAnswerHistory, getRegistrationAnswerHistory } from './history.js';
import { createImportedSignups, listImportedSignups } from '../signup-import/data.js';
import { syncImportedRow } from '../signup-import/sync.js';
import { linkImportedSignup } from '../signup-import/link.js';

test('changing a populated event form preserves old answers and imported fields across new answers and claim', async () => {
  const db = await openTestDb();
  try {
    const guildId = 'guild-migration';
    const oldQuestion = { id: 'details', kind: 'text' as const, label: { en: 'Allergies' }, help: { en: '' }, required: false, presentation: 'web' as const, visibility: 'organizer_only' as const };
    const oldForm = { ...DEFAULT_FORM, customQuestions: [oldQuestion] };
    const created = await createEvent(db, 'test', guildId, { name: 'Same event', form: oldForm });
    assert.ok(created.ok);
    const eventId = created.value.id;
    assert.ok((await activateEvent(db, 'test', eventId)).ok);
    const originalVersion = oldForm.version;
    assert.ok((await saveParticipantAnswers(db, eventId, 'subject', originalVersion, { details: 'old allergy' }, ['details'])).ok);
    const imported = await createImportedSignups(db, eventId, guildId, originalVersion, [{ sourceRow: 2, values: { name: 'Imported', email: 'fixture@example.test', allergies: 'old imported allergy', 'source:Original question': 'original source answer' }, answers: { details: 'old imported answer' } }]);
    assert.equal(imported.saved, 1);
    const importId = imported.rows[0]!.id!;
    const importedRow = (await listImportedSignups(db, eventId))[0]!;
    await syncImportedRow(db, eventId, guildId, importedRow, oldForm);

    const replacement = await updateEventForm(db, 'test', eventId, { customQuestions: [{ ...oldQuestion, label: { en: 'Project idea' }, visibility: 'self_and_organizer' }] });
    assert.ok(replacement.ok);
    assert.equal(replacement.value.version, originalVersion + 1);
    assert.ok((await saveParticipantAnswers(db, eventId, 'subject', replacement.value.version, { details: 'new idea' }, ['details'])).ok);
    const claimed = await linkImportedSignup(db, eventId, guildId, importId, 'discord-subject', replacement.value);
    assert.equal(claimed.linked, true, JSON.stringify(claimed));
    assert.deepEqual((await getRegistrationAnswers(db, eventId, 'subject'))?.answers, { details: 'new idea' });
    assert.deepEqual((await getRegistrationAnswerHistory(db, eventId, 'subject')).map(v => [v.formVersion, v.questions[0]?.label.en, v.answers.details]), [[originalVersion, 'Allergies', 'old allergy']]);
    const archived = await getImportedAnswerHistory(db, eventId, importId);
    assert.deepEqual(archived.map(v => [v.formVersion, v.questions[0]?.label.en, v.answers.details, v.values?.allergies, v.values?.['source:Original question']]), [[originalVersion, 'Allergies', 'old imported answer', 'old imported allergy', 'original source answer']]);
    assert.deepEqual((await getRegistrationAnswers(db, eventId, 'discord-subject'))?.answers, {});
    await migratePostgres(db);
    await migratePostgres(db);
    assert.equal((await getRegistrationAnswerHistory(db, eventId, 'subject'))[0]?.answers.details, 'old allergy');
    assert.equal((await getImportedAnswerHistory(db, eventId, importId))[0]?.values?.allergies, 'old imported allergy');
  } finally { await db.close(); }
});
