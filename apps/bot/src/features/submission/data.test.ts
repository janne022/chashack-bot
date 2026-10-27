import test from 'node:test';
import assert from 'node:assert/strict';
import { openTestDb } from '../../shared/test-db.js';
import { migratePostgres } from '../../shared/postgres.js';
import { deleteGuildMemberData } from '../signup/departures.js';
import { getSubmission, getSubmissionForm, saveSubmission, saveSubmissionForm } from './data.js';

test('submission forms preserve legacy data, reject stale edits and honor completion and locking', async () => {
  const db = await openTestDb();
  try {
    await db.run("INSERT INTO events(id,guild_id,name,status,created_at,updated_at) VALUES ('event','guild','Hackathon','active',1,1)");
    await db.run("INSERT INTO participants(event_id,user_id,guild_id,display_name,experience,role_track,skills,team_pref,teammates,status,created_at,updated_at) VALUES ('event','user','guild','User','','','[]','','[]','active',1,1)");
    await db.run("INSERT INTO registration_answers(event_id,user_id,form_version,answers_json,updated_at) VALUES ('event','user',1,'{\"signup\":\"kept\"}',1)");
    assert.deepEqual(await getSubmissionForm(db, 'event'), { version: 0, enabled: false, allowEdits: true, questions: [] });
    const question = { id: 'project', kind: 'text', label: { en: 'Project', sv: 'Projekt' }, help: { en: '' }, required: true, presentation: 'web', visibility: 'self_and_organizer' };
    const form = { enabled: true, allowEdits: false, questions: [question] };
    assert.equal((await saveSubmissionForm(db, 'event', 0, { ...form, questions: [{ ...question, visibility: 'organizer_only' }] })).ok, false);
    const created = await saveSubmissionForm(db, 'event', 0, form);
    assert.equal(created.ok, true);
    assert.equal((await saveSubmissionForm(db, 'event', 0, form)).ok, false);
    assert.equal((await saveSubmission(db, 'event', 'user', 0, { project: 'old version' })).ok, false);
    assert.equal((await saveSubmission(db, 'event', 'user', 1, { unknown: 'unexpected' })).ok, false);
    const draft = await saveSubmission(db, 'event', 'user', 1, {});
    assert.ok(draft.ok && !draft.value.complete && draft.value.missingRequiredQuestionIds.includes('project'));
    const submitted = await saveSubmission(db, 'event', 'user', 1, { project: 'Build a game' });
    assert.ok(submitted.ok && submitted.value.complete);
    const locked = await saveSubmission(db, 'event', 'user', 1, { project: 'Changed' });
    assert.ok(!locked.ok && locked.code === 'submission_locked');
    assert.equal((await getSubmission(db, 'event', 'user'))?.answers.project, 'Build a game');
    await migratePostgres(db);
    await migratePostgres(db);
    assert.equal((await getSubmission(db, 'event', 'user'))?.answers.project, 'Build a game');
    assert.equal((await db.get<{answers_json: string}>("SELECT answers_json FROM registration_answers WHERE event_id='event' AND user_id='user'"))?.answers_json, '{"signup":"kept"}');
    await deleteGuildMemberData(db, 'guild', 'user');
    assert.equal(await getSubmission(db, 'event', 'user'), null, 'member departure removes personal submissions');
  } finally { await db.close(); }
});
