/**
 * Imported signups are participants from the moment they are imported: they show
 * up in Participants, enter matching, can be put on a team, and follow every
 * change to the row. Linking merges the placeholder instead of duplicating it.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { openTestDb } from '../../shared/test-db.js';
import { activateEvent, createEvent, getEvent, getEventForm } from '../events/data.js';
import { getForm } from '../form/data.js';
import { getParticipant, listMatchable, listParticipants } from '../signup/data.js';
import { previewMatch } from '../matching/data.js';
import { createImportedSignups, deleteImportedSignup, listImportedSignups } from './data.js';
import { autoLinkImportedSignups } from './auto-link.js';
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

test('an edit updates the same participant and a re-import never duplicates it', async () => {
  const { db, eventId, form, close } = await setup('Import edit');
  try {
    const imported = await createImportedSignups(db, eventId, GUILD, form.version, [{ sourceRow: 2, values: ADA_ROW, answers: {} }]);
    const rowId = imported.rows[0]!.id!;
    await reconcileImportedParticipants(db, eventId, GUILD, form);

    const edited = await listImportedSignups(db, eventId);
    await syncImportedRow(db, eventId, GUILD, { ...edited[0]!, values: { ...edited[0]!.values, name: 'Ada Updated' } }, form);
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
    assert.equal(ada?.importedSignupId, adaRowId);
    assert.equal(await getParticipant(db, eventId, placeholder), null, 'the placeholder is gone, not duplicated');
  } finally { await close(); }
});

test('merging a placeholder onto an existing member keeps that member\'s team', async () => {
  const { db, eventId, form, close } = await setup('Import merge');
  try {
    const imported = await createImportedSignups(db, eventId, GUILD, form.version, [{ sourceRow: 2, values: ADA_ROW, answers: {} }]);
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
