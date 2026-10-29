/**
 * Imported signups are participants from the moment they are imported: they show
 * up in Participants, enter matching, can be put on a team, and follow every
 * change to the row. Linking merges the placeholder instead of duplicating it.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { openTestDb } from '../../shared/test-db.js';
import { openPostgres } from '../../shared/postgres.js';
import { activateEvent, createEvent, getEvent, getEventForm } from '../events/data.js';
import { getForm } from '../form/data.js';
import { adminAddParticipant, getParticipant, listMatchable, listParticipants } from '../signup/data.js';
import { previewMatch } from '../matching/data.js';
import { createImportedSignups, deleteImportedSignup, editImportedSignup, listImportedSignups } from './data.js';
import { autoLinkImportedSignups, autoLinkPresentMembers } from './auto-link.js';
import { linkImportedSignup } from './link.js';
import {
  dropImportedPlaceholder,
  importedParticipantId,
  mergeImportedPlaceholder,
  reconcileImportedParticipants,
  syncImportedRow,
} from './sync.js';

const GUILD = '31313131313131313';
const ADA = '12345678901234567';
const BOB = '22345678901234567';

async function setup(name: string) {
  const db = await openTestDb();
  const created = await createEvent(db, 'test', GUILD, { name });
  assert.equal(created.ok, true);
  if (!created.ok) throw new Error('event not created');
  const eventId = created.value.id;
  const event = (await getEvent(db, eventId))!;
  const form = getEventForm(db, event, await getForm(db, GUILD));
  return { db, eventId, form, close: () => db.close() };
}

const ADA_ROW = { name: 'Ada Andersson', email: 'ada@example.test', experience: 'first_timer', skills: 'frontend_react', teamPref: 'random_team' };
const BOB_ROW = { name: 'Bob Bsson', email: 'bob@example.test', experience: 'veteran', skills: 'backend_node', teamPref: 'random_team' };

test('an import materialises one participant per row, tagged with its provenance', async () => {
  const { db, eventId, form, close } = await setup('Imported participants');
  try {
    const imported = await createImportedSignups(db, eventId, GUILD, form.version, [
      { sourceRow: 2, values: ADA_ROW, answers: {} },
      { sourceRow: 3, values: BOB_ROW, answers: {} },
    ]);
    assert.equal(imported.saved, 2);
    const reconciled = await reconcileImportedParticipants(db, eventId, GUILD, form);
    assert.equal(reconciled.participants, 2);

    const participants = await listParticipants(db, eventId);
    assert.deepEqual(participants.map((p) => p.userId).sort(), imported.rows.map((row) => importedParticipantId(row.id!)).sort());
    for (const participant of participants) {
      assert.ok(participant.importedSignupId !== null, 'an imported participant keeps its row id');
      assert.equal(participant.status, 'active');
      assert.equal(participant.teamPref, 'random_team');
    }
    assert.deepEqual(participants.map((p) => p.displayName).sort(), ['Ada Andersson', 'Bob Bsson']);
  } finally { await close(); }
});

test('a force-added member can claim an import only while their registration is empty', async () => {
  const { db, eventId, form, close } = await setup('Force add import');
  try {
    assert.ok((await activateEvent(db, 'test', eventId)).ok);
    const imported = await createImportedSignups(db, eventId, GUILD, form.version, [
      { sourceRow: 2, values: ADA_ROW, answers: {} },
      { sourceRow: 3, values: BOB_ROW, answers: {} },
    ]);
    await reconcileImportedParticipants(db, eventId, GUILD, form);
    assert.ok((await adminAddParticipant(db, 'admin', eventId, GUILD, ADA, 'Ada')).ok);
    const claimed = await linkImportedSignup(db, eventId, GUILD, imported.rows[0]!.id!, ADA, form);
    assert.equal(claimed.linked, true);
    assert.equal((await getParticipant(db, eventId, ADA))?.importedSignupId, imported.rows[0]!.id);
    assert.ok((await adminAddParticipant(db, 'admin', eventId, GUILD, BOB, 'Bob')).ok);
    await db.run('UPDATE participants SET experience=? WHERE event_id=? AND user_id=?', 'veteran', eventId, BOB);
    const conflict = await linkImportedSignup(db, eventId, GUILD, imported.rows[1]!.id!, BOB, form);
    assert.equal(conflict.error, 'participant_conflict');
    assert.equal((await getParticipant(db, eventId, BOB))?.experience, 'veteran');
  } finally { await close(); }
});

test('a delayed import projection cannot overwrite active-version answers after a concurrent form change', async () => {
  const { db, eventId, form, close } = await setup('Import projection race');
  const schema = (await db.get<{ schema: string }>('SELECT current_schema() AS schema'))!.schema;
  const workerDb = await openPostgres(process.env.DATABASE_URL!, schema);
  try {
    const oldForm = { ...form, customQuestions: [
      { id: 'reused', kind: 'text' as const, label: { en: 'Private' }, help: { en: '' }, required: false, presentation: 'web' as const, visibility: 'organizer_only' as const },
    ] };
    await db.run('UPDATE events SET form_json=? WHERE id=?', JSON.stringify(oldForm), eventId);
    const imported = await createImportedSignups(db, eventId, GUILD, oldForm.version, [
      { sourceRow: 2, values: { ...ADA_ROW }, answers: { reused: 'OLD_PRIVATE_IMPORT' } },
    ]);
    const importId = imported.rows[0]!.id!;
    await db.run('UPDATE imported_signups SET discord_user_id=? WHERE id=?', ADA, importId);
    const staleRow = (await listImportedSignups(db, eventId))[0]!;
    const nextForm = { ...oldForm, version: oldForm.version + 1, customQuestions: [
      { ...oldForm.customQuestions[0]!, label: { en: 'Public' }, visibility: 'self_and_organizer' as const },
    ] };

    let pendingProjection!: Promise<string>;
    const manualSavedAt = Date.now();
    await db.transaction(async () => {
      await db.get('SELECT id FROM events WHERE id=? FOR UPDATE', eventId);
      pendingProjection = syncImportedRow(workerDb, eventId, GUILD, staleRow, oldForm);
      await new Promise((resolve) => setTimeout(resolve, 80));
      await db.run('UPDATE events SET form_json=? WHERE id=?', JSON.stringify(nextForm), eventId);
      await db.run('INSERT INTO registration_answers VALUES (?,?,?,?,?)', eventId, ADA, nextForm.version, JSON.stringify({ reused: 'CURRENT_MANUAL_ANSWER' }), manualSavedAt);
    });
    await pendingProjection;
    assert.deepEqual(JSON.parse((await db.get<{ answers_json: string }>('SELECT answers_json FROM registration_answers WHERE event_id=? AND user_id=?', eventId, ADA))!.answers_json), { reused: 'CURRENT_MANUAL_ANSWER' });
    assert.equal((await db.get<{ form_version: number }>('SELECT form_version FROM registration_answers WHERE event_id=? AND user_id=?', eventId, ADA))!.form_version, nextForm.version);

    await db.run('UPDATE imported_signups SET form_version=?,values_json=?,answers_json=?,updated_at=? WHERE id=?', nextForm.version, JSON.stringify({ name: 'Stale imported name', email: 'ada@example.test', experience: 'veteran', skills: 'backend_node' }), JSON.stringify({ reused: 'STALE_IMPORT_ANSWER' }), manualSavedAt - 1, importId);
    const staleSameVersion = (await listImportedSignups(db, eventId))[0]!;
    await syncImportedRow(db, eventId, GUILD, staleSameVersion, nextForm);
    assert.deepEqual(JSON.parse((await db.get<{ answers_json: string }>('SELECT answers_json FROM registration_answers WHERE event_id=? AND user_id=?', eventId, ADA))!.answers_json), { reused: 'CURRENT_MANUAL_ANSWER' });
    assert.equal((await db.get<{ display_name: string; experience: string }>('SELECT display_name,experience FROM participants WHERE event_id=? AND user_id=?', eventId, ADA))?.display_name, 'Ada Andersson');

    await db.run('UPDATE participants SET updated_at=? WHERE event_id=? AND user_id=?', manualSavedAt, eventId, ADA);
    await db.run('UPDATE imported_signups SET values_json=?,answers_json=?,updated_at=? WHERE id=?', JSON.stringify({ name: 'Organizer Edited Name', email: 'ada@example.test', experience: 'veteran', skills: 'backend_node' }), JSON.stringify({ reused: 'ORGANIZER_EDITED_IMPORT' }), manualSavedAt + 10, importId); // g0:allow:secrets PR #73 - synthetic organizer edit fixture, not a credential.
    const editedSameVersion = (await listImportedSignups(db, eventId))[0]!;
    await syncImportedRow(db, eventId, GUILD, editedSameVersion, nextForm);
    assert.deepEqual(JSON.parse((await db.get<{ answers_json: string }>('SELECT answers_json FROM registration_answers WHERE event_id=? AND user_id=?', eventId, ADA))!.answers_json), { reused: 'ORGANIZER_EDITED_IMPORT' }); // g0:allow:secrets PR #73 - synthetic organizer edit assertion, not a credential.
    assert.equal((await db.get<{ display_name: string }>('SELECT display_name FROM participants WHERE event_id=? AND user_id=?', eventId, ADA))?.display_name, 'Organizer Edited Name');
  } finally { await workerDb.close(); await close(); }
});

test('an organizer edit takes the event lock before the import row, matching reconciliation', async () => {
  const { db, eventId, form, close } = await setup('Import edit lock order');
  const schema = (await db.get<{ schema: string }>('SELECT current_schema() AS schema'))!.schema;
  const editorDb = await openPostgres(process.env.DATABASE_URL!, schema);
  try {
    const imported = await createImportedSignups(db, eventId, GUILD, form.version, [{ sourceRow: 2, values: { ...ADA_ROW }, answers: {} }]);
    const rowId = imported.rows[0]!.id!;
    let edit!: Promise<unknown>;
    await db.transaction(async () => {
      // Background reconciliation holds the event lock before it reads rows.
      await db.get('SELECT id FROM events WHERE id=? FOR UPDATE', eventId);
      edit = editImportedSignup(editorDb, eventId, rowId, { values: { name: 'Waits for the event lock' } });
      const outcome = await Promise.race([
        edit.then(() => 'settled'),
        new Promise((resolve) => setTimeout(() => resolve('blocked'), 150)),
      ]);
      assert.equal(outcome, 'blocked', 'the edit must not take the row lock ahead of the event lock');
    });
    assert.notEqual(await edit, null);
    assert.match((await db.get<{ values_json: string }>('SELECT values_json FROM imported_signups WHERE id=?', rowId))!.values_json, /Waits for the event lock/);
  } finally { await editorDb.close(); await close(); }
});

test('an edit updates the same participant and a re-import never duplicates it', async () => {
  const { db, eventId, form, close } = await setup('Import edit');
  try {
    const imported = await createImportedSignups(db, eventId, GUILD, form.version, [{ sourceRow: 2, values: ADA_ROW, answers: {} }]);
    const rowId = imported.rows[0]!.id!;
    await reconcileImportedParticipants(db, eventId, GUILD, form);

    const edited = await listImportedSignups(db, eventId);
    await editImportedSignup(db, eventId, rowId, { values: { name: 'Ada Updated' } });
    await syncImportedRow(db, eventId, GUILD, edited[0]!, form);
    const participants = await listParticipants(db, eventId);
    assert.equal(participants.length, 1);
    assert.equal(participants[0]!.displayName, 'Ada Updated');
    assert.equal(participants[0]!.userId, importedParticipantId(rowId));

    // The same row id re-derived again is still one participant.
    await reconcileImportedParticipants(db, eventId, GUILD, form);
    assert.equal((await listParticipants(db, eventId)).length, 1);
  } finally { await close(); }
});

test('imported participants enter matching and keep their team when they are linked', async () => {
  const { db, eventId, form, close } = await setup('Imported matching');
  try {
    await activateEvent(db, 'test', eventId);
    const imported = await createImportedSignups(db, eventId, GUILD, form.version, [
      { sourceRow: 2, values: ADA_ROW, answers: {} },
      { sourceRow: 3, values: BOB_ROW, answers: {} },
    ]);
    await reconcileImportedParticipants(db, eventId, GUILD, form);

    // No Discord membership lookup is installed in tests: a normal signup would
    // be filtered out, an imported participant is matchable anyway.
    const matchable = await listMatchable(db, eventId);
    assert.deepEqual(matchable.map((p) => p.displayName).sort(), ['Ada Andersson', 'Bob Bsson']);
    const preview = await previewMatch(db, eventId, form);
    assert.equal(preview.ok, true);
    if (!preview.ok) return;
    assert.equal(preview.value.teams.reduce((sum, team) => sum + team.memberIds.length, 0), 2);

    // Put Ada's placeholder on a team the way an organizer would, then link her.
    const adaRowId = imported.rows[0]!.id!;
    const placeholder = importedParticipantId(adaRowId);
    const event = (await getEvent(db, eventId))!;
    const team = await db.get<{ id: string }>(
      `INSERT INTO teams (id,event_id,guild_id,name,kind,owner_id,join_code,color,created_at)
       VALUES ('team-imported', ?, ?, 'Matched', 'matched', ?, 'CODE-1', NULL, ?) RETURNING id`,
      eventId, event.guildId, placeholder, Date.now());
    await db.run('UPDATE participants SET team_id=? WHERE event_id=? AND user_id=?', team!.id, eventId, placeholder);

    const linked = await linkImportedSignup(db, eventId, GUILD, adaRowId, ADA, form, { organizer: true });
    assert.equal(linked.error, undefined);
    const ada = await getParticipant(db, eventId, ADA);
    assert.equal(ada?.teamId, team!.id, 'the matched team follows the person');
    assert.equal((await db.get<{ owner_id: string }>('SELECT owner_id FROM teams WHERE id=?', team!.id))?.owner_id, ADA);
    assert.equal(ada?.importedSignupId, adaRowId);
    assert.equal(await getParticipant(db, eventId, placeholder), null, 'the placeholder is gone, not duplicated');
  } finally { await close(); }
});

test('startup repairs stale imported owners only when the linked person is on that team', async () => {
  const { db, eventId, form, close } = await setup('Import owner repair');
  try {
    const imported = await createImportedSignups(db, eventId, GUILD, form.version, [
      { sourceRow: 2, values: { ...ADA_ROW, groupName: 'Alpha' }, answers: {} },
      { sourceRow: 3, values: { ...BOB_ROW, groupName: 'Beta' }, answers: {} },
    ]);
    await reconcileImportedParticipants(db, eventId, GUILD, form);
    for (const [row, userId] of [[imported.rows[0]!, ADA], [imported.rows[1]!, BOB]] as const) {
      await linkImportedSignup(db, eventId, GUILD, row.id!, userId, form, { organizer: true });
      await db.run('UPDATE teams SET owner_id=? WHERE event_id=? AND owner_id=?', importedParticipantId(row.id!), eventId, userId);
    }
    await db.run("UPDATE participants SET team_id=(SELECT id FROM teams WHERE event_id=? AND name='Alpha') WHERE event_id=? AND user_id=?", eventId, eventId, BOB);
    await reconcileImportedParticipants(db, eventId, GUILD, form);
    const teams = await db.all<{ name: string; owner_id: string | null }>('SELECT name,owner_id FROM teams WHERE event_id=? ORDER BY name', eventId);
    assert.deepEqual(teams, [{ name: 'Alpha', owner_id: ADA }, { name: 'Beta', owner_id: null }]);
    await reconcileImportedParticipants(db, eventId, GUILD, form);
    assert.deepEqual(await db.all('SELECT name,owner_id FROM teams WHERE event_id=? ORDER BY name', eventId), teams);
  } finally { await close(); }
});

test('merging a placeholder onto an existing member keeps that member\'s team', async () => {
  const { db, eventId, form, close } = await setup('Import merge');
  try {
    const imported = await createImportedSignups(db, eventId, GUILD, form.version, [{ sourceRow: 2, values: { ...ADA_ROW, groupName: 'Imported group' }, answers: {} }]);
    const rowId = imported.rows[0]!.id!;
    await reconcileImportedParticipants(db, eventId, GUILD, form);
    const event = (await getEvent(db, eventId))!;
    await db.run(`INSERT INTO teams (id,event_id,guild_id,name,kind,owner_id,join_code,color,created_at)
      VALUES ('team-own', ?, ?, 'Own team', 'private', ?, 'CODE-2', NULL, ?)`, eventId, event.guildId, ADA, Date.now());
    await db.run(`INSERT INTO participants (event_id,user_id,guild_id,display_name,experience,role_track,skills,team_pref,teammates,team_id,status,created_at,updated_at)
      VALUES (?,?,?,?,'','','[]','join_team','[]','team-own','active',?,?)`,
      eventId, ADA, event.guildId, 'Ada', Date.now(), Date.now());

    const linked = await linkImportedSignup(db, eventId, GUILD, rowId, ADA, form, { organizer: true });
    assert.equal(linked.error, undefined);
    const ada = await getParticipant(db, eventId, ADA);
    assert.equal(ada?.teamId, 'team-own');
    assert.equal(ada?.importedSignupId, rowId);
    assert.equal(ada?.displayName, 'Ada Andersson');
    assert.equal((await db.get<{ owner_id: string | null }>("SELECT owner_id FROM teams WHERE event_id=? AND name='Imported group'", eventId))?.owner_id, null);
    assert.equal((await listParticipants(db, eventId)).length, 1);
  } finally { await close(); }
});

test('deleting the row removes only the placeholder, never a linked participant', async () => {
  const { db, eventId, form, close } = await setup('Import delete');
  try {
    const imported = await createImportedSignups(db, eventId, GUILD, form.version, [
      { sourceRow: 2, values: ADA_ROW, answers: {} },
      { sourceRow: 3, values: BOB_ROW, answers: {} },
    ]);
    await reconcileImportedParticipants(db, eventId, GUILD, form);
    const [adaRow, bobRow] = imported.rows;
    await linkImportedSignup(db, eventId, GUILD, adaRow!.id!, ADA, form, { organizer: true });

    assert.equal(await deleteImportedSignup(db, eventId, adaRow!.id!, 'organizer'), true);
    assert.equal(await deleteImportedSignup(db, eventId, bobRow!.id!, 'organizer'), true);
    await dropImportedPlaceholder(db, eventId, adaRow!.id!);
    await dropImportedPlaceholder(db, eventId, bobRow!.id!);

    const participants = await listParticipants(db, eventId);
    assert.deepEqual(participants.map((p) => p.userId), [ADA]);
    assert.equal(participants[0]!.importedSignupId, null, 'a surviving participant is a normal registration again');
  } finally { await close(); }
});

test('auto-link links a unique username, reports a tie and leaves a stranger unlinked', async () => {
  const { db, eventId, form, close } = await setup('Auto link');
  try {
    await createImportedSignups(db, eventId, GUILD, form.version, [
      { sourceRow: 2, values: { ...ADA_ROW, discordUsername: 'ada' }, answers: {} },
      { sourceRow: 3, values: { ...BOB_ROW, discordUsername: 'twin' }, answers: {} },
      { sourceRow: 4, values: { name: 'Cleo Csson', email: 'cleo@example.test', discordUsername: 'not-here' }, answers: {} },
    ]);
    await reconcileImportedParticipants(db, eventId, GUILD, form);

    const directory: Record<string, string | 'ambiguous'> = { ada: ADA, twin: 'ambiguous' };
    const result = await autoLinkImportedSignups(db, eventId, GUILD, form, async (username) => directory[username] ?? null, 'organizer');
    assert.deepEqual(result.linked.map((row) => row.userId), [ADA]);
    assert.deepEqual(result.ambiguous.map((row) => row.username), ['twin']);
    assert.equal(result.missing, 1);
    assert.equal(result.conflicts.length, 0);

    const participants = await listParticipants(db, eventId);
    assert.ok(participants.some((p) => p.userId === ADA), 'the unique match is linked');
    assert.equal(participants.filter((p) => p.userId.startsWith('imp:')).length, 2, 'the tie and the stranger stay placeholders');

    // Re-running is idempotent: the linked row is skipped, not linked twice.
    const again = await autoLinkImportedSignups(db, eventId, GUILD, form, async (username) => directory[username] ?? null, 'organizer');
    assert.equal(again.linked.length, 0);
    assert.equal((await listParticipants(db, eventId)).length, 3);
  } finally { await close(); }
});

test('automatic linking does not use a username edited during lookup', async () => {
  const { db, eventId, form, close } = await setup('Changed username');
  try {
    const imported = await createImportedSignups(db, eventId, GUILD, form.version, [{ sourceRow: 2, values: { ...ADA_ROW, discordUsername: 'ada' }, answers: {} }]);
    const id = imported.rows[0]!.id!;
    const linked = await autoLinkPresentMembers(db, eventId, GUILD, form, async () => {
      await db.run("UPDATE imported_signups SET discord_username='other' WHERE id=?", id);
      return ADA;
    });
    assert.deepEqual(linked, []);
    assert.equal((await listImportedSignups(db, eventId))[0]?.discordUserId, null);
  } finally { await close(); }
});
