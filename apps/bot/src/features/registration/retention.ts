import type { Db } from '../../shared/db.js';
import { withGuildContext } from '../../shared/postgres.js';
import type { FormConfig } from '../form/domain.js';
import { getFormVersion } from './history.js';

const RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
type Deletion = { guildId: string; eventId: string; userId: string; deletedAt: number };

const IMPORT_DELETION_PREFIX = 'import:';
const WITHDRAWAL_DELETION_PREFIX = 'withdraw:';

async function privateQuestionIds(db: Db, eventId: string, version: number): Promise<Set<string> | null> {
  let historical: FormConfig | null;
  try { historical = await getFormVersion(db, eventId, version); } catch { return null; }
  if (historical) return new Set((historical.customQuestions ?? []).filter((question) => question.visibility === 'organizer_only').map((question) => question.id));
  const row = await db.get<{ form_json: string }>('SELECT form_json FROM events WHERE id=?', eventId);
  if (!row?.form_json) return null;
  let current: FormConfig;
  try { current = JSON.parse(row.form_json) as FormConfig; } catch { return null; }
  // Legacy events have no snapshots; only the event's current version is safe to infer.
  return current.version === version
    ? new Set((current.customQuestions ?? []).filter((question) => question.visibility === 'organizer_only').map((question) => question.id))
    : null;
}

async function erasePayload(db: Db, eventId: string, version: number, answersJson: string, updatedAt: number, deletedAt: number, table: 'registration_answers' | 'registration_answer_history' | 'imported_signups' | 'imported_signup_answer_history', keys: { userId?: string; importId?: string }): Promise<boolean> {
  if (updatedAt > deletedAt) return false;
  const ids = await privateQuestionIds(db, eventId, version);
  let answers: Record<string, unknown>;
  let malformed = false;
  try { answers = JSON.parse(answersJson) as Record<string, unknown>; }
  catch { answers = {}; malformed = true; }
  if (answers === null || typeof answers !== 'object' || Array.isArray(answers)) { answers = {}; malformed = true; }
  if (ids === null) {
    // Retention has expired and the definition cannot classify this payload.
    // The approved policy is to erase the expired answer payload, not its row.
    answers = {};
  }
  if (ids !== null && ids.size === 0 && !malformed) return false;
  let changed = false;
  if (ids === null || malformed) changed = true;
  else for (const id of ids) if (Object.hasOwn(answers, id)) { delete answers[id]; changed = true; }
  if (!changed) return false;
  const keyColumn = table === 'registration_answers' || table === 'registration_answer_history' ? 'user_id' : table === 'imported_signups' ? 'id' : 'import_id';
  const identity = keyColumn === 'user_id' ? keys.userId : keys.importId;
  await db.run(`UPDATE ${table} SET answers_json=? WHERE event_id=? AND ${keyColumn}=? AND form_version=? AND updated_at<=?`, JSON.stringify(answers), eventId, identity, version, deletedAt);
  return true;
}

async function eraseImportedPrivateValues(db: Db, eventId: string, importId: string, version: number, valuesJson: string, updatedAt: number, deletedAt: number, history: boolean): Promise<boolean> {
  if (updatedAt > deletedAt) return false;
  const ids = await privateQuestionIds(db, eventId, version);
  let values: Record<string, unknown>;
  let malformed = false;
  try { values = JSON.parse(valuesJson) as Record<string, unknown>; }
  catch { values = {}; malformed = true; }
  if (values === null || typeof values !== 'object' || Array.isArray(values)) { values = {}; malformed = true; }
  if (ids === null) {
    // Archived values are answer payloads. The live imported row retains only
    // identifying fields; the import and participant rows themselves survive.
    values = history ? {} : Object.fromEntries(Object.entries(values).filter(([key]) => ['name', 'email', 'discordUsername'].includes(key)));
  }
  const privateValues = new Set([...(ids ?? []), 'allergies']);
  const ambiguousSource = Object.keys(values).some((key) => key.startsWith('source:'));
  let changed = ids === null || malformed || ambiguousSource;
  if (ambiguousSource) values = history ? {} : Object.fromEntries(Object.entries(values).filter(([key]) => ['name', 'email', 'discordUsername'].includes(key)));
  for (const id of privateValues) if (Object.hasOwn(values, id)) { delete values[id]; changed = true; }
  for (const key of Object.keys(values)) if (key.startsWith('source:')) { delete values[key]; changed = true; }
  if (changed) {
    const table = history ? 'imported_signup_answer_history' : 'imported_signups';
    const keyColumn = history ? 'import_id' : 'id';
    await db.run(`UPDATE ${table} SET values_json=? WHERE event_id=? AND ${keyColumn}=? AND form_version=? AND updated_at<=?`, JSON.stringify(values), eventId, importId, version, deletedAt);
    if (ambiguousSource || ids === null || malformed) {
      const answerTable = history ? 'imported_signup_answer_history' : 'imported_signups';
      await db.run(`UPDATE ${answerTable} SET answers_json='{}' WHERE event_id=? AND ${keyColumn}=? AND form_version=? AND updated_at<=?`, eventId, importId, version, deletedAt);
    }
  }
  return changed;
}

async function erasePrivateAnswers(db: Db, record: Deletion): Promise<void> {
  const event = await db.get<{ guild_id: string }>('SELECT guild_id FROM events WHERE id=?', record.eventId);
  if (!event || event.guild_id !== record.guildId) return;
  if (record.userId.startsWith(WITHDRAWAL_DELETION_PREFIX)) {
    const userId = record.userId.slice(WITHDRAWAL_DELETION_PREFIX.length);
    await db.run('DELETE FROM registration_answers WHERE event_id=? AND user_id=? AND updated_at<=?', record.eventId, userId, record.deletedAt);
    await db.run('DELETE FROM registration_answer_history WHERE event_id=? AND user_id=? AND updated_at<=?', record.eventId, userId, record.deletedAt);
    await eraseLinkedImportedAnswerPayloads(db, record.eventId, record.guildId, userId, record.deletedAt);
    return;
  }
  if (record.userId.startsWith(IMPORT_DELETION_PREFIX)) {
    const importId = record.userId.slice(IMPORT_DELETION_PREFIX.length);
    const row = await db.get<{ form_version: number; answers_json: string; values_json: string; updated_at: number }>(
      'SELECT form_version,answers_json,values_json,updated_at FROM imported_signups WHERE id=? AND event_id=? AND guild_id=?', importId, record.eventId, record.guildId,
    );
    if (row) {
      await erasePayload(db, record.eventId, row.form_version, row.answers_json, row.updated_at, record.deletedAt, 'imported_signups', { importId });
      await eraseImportedPrivateValues(db, record.eventId, importId, row.form_version, row.values_json, row.updated_at, record.deletedAt, false);
    }
    const history = await db.all<{ form_version: number; answers_json: string; values_json: string; updated_at: number }>(
      'SELECT form_version,answers_json,values_json,updated_at FROM imported_signup_answer_history WHERE event_id=? AND import_id=?', record.eventId, importId,
    );
    for (const archived of history) {
      await erasePayload(db, record.eventId, archived.form_version, archived.answers_json, archived.updated_at, record.deletedAt, 'imported_signup_answer_history', { importId });
      await eraseImportedPrivateValues(db, record.eventId, importId, archived.form_version, archived.values_json, archived.updated_at, record.deletedAt, true);
    }
    return;
  }
  const current = await db.get<{ form_version: number; answers_json: string; updated_at: number }>(
    'SELECT form_version,answers_json,updated_at FROM registration_answers WHERE event_id=? AND user_id=?', record.eventId, record.userId,
  );
  if (current) await erasePayload(db, record.eventId, current.form_version, current.answers_json, current.updated_at, record.deletedAt, 'registration_answers', { userId: record.userId });
  const archived = await db.all<{ form_version: number; answers_json: string; updated_at: number }>(
    'SELECT form_version,answers_json,updated_at FROM registration_answer_history WHERE event_id=? AND user_id=?', record.eventId, record.userId,
  );
  for (const row of archived) await erasePayload(db, record.eventId, row.form_version, row.answers_json, row.updated_at, record.deletedAt, 'registration_answer_history', { userId: record.userId });
  const imports = await db.all<{ id: string; form_version: number; answers_json: string; values_json: string; updated_at: number }>(
    'SELECT id,form_version,answers_json,values_json,updated_at FROM imported_signups WHERE event_id=? AND guild_id=? AND discord_user_id=?', record.eventId, record.guildId, record.userId,
  );
  for (const row of imports) {
    await erasePayload(db, record.eventId, row.form_version, row.answers_json, row.updated_at, record.deletedAt, 'imported_signups', { importId: row.id });
    await eraseImportedPrivateValues(db, record.eventId, row.id, row.form_version, row.values_json, row.updated_at, record.deletedAt, false);
    const importedHistory = await db.all<{ form_version: number; answers_json: string; values_json: string; updated_at: number }>(
      'SELECT form_version,answers_json,values_json,updated_at FROM imported_signup_answer_history WHERE event_id=? AND import_id=?', record.eventId, row.id,
    );
    for (const archivedImport of importedHistory) {
      await erasePayload(db, record.eventId, archivedImport.form_version, archivedImport.answers_json, archivedImport.updated_at, record.deletedAt, 'imported_signup_answer_history', { importId: row.id });
      await eraseImportedPrivateValues(db, record.eventId, row.id, archivedImport.form_version, archivedImport.values_json, archivedImport.updated_at, record.deletedAt, true);
    }
  }
}

async function recordDeletion(db: Db, deletion: Deletion): Promise<void> {
  await db.run(`INSERT INTO private_answer_deletions (guild_id,event_id,user_id,deleted_at) VALUES (?,?,?,?)
    ON CONFLICT (guild_id,event_id,user_id) DO UPDATE SET deleted_at=GREATEST(private_answer_deletions.deleted_at,EXCLUDED.deleted_at)`,
  deletion.guildId, deletion.eventId, deletion.userId, deletion.deletedAt);
  await erasePrivateAnswers(db, deletion);
}

async function shouldRecordDeletion(db: Db, eventId: string, version: number, answersJson: string, updatedAt: number, cutoff: number): Promise<boolean> {
  if (updatedAt > cutoff) return false;
  const ids = await privateQuestionIds(db, eventId, version);
  if (ids === null) return true;
  let answers: Record<string, unknown>;
  try { answers = JSON.parse(answersJson) as Record<string, unknown>; } catch { return true; }
  if (answers === null || typeof answers !== 'object' || Array.isArray(answers)) return true;
  return [...ids].some((id) => Object.hasOwn(answers, id));
}

async function shouldRecordImportedDeletion(db: Db, eventId: string, version: number, answersJson: string, valuesJson: string, updatedAt: number, cutoff: number): Promise<boolean> {
  if (updatedAt > cutoff) return false;
  if (await shouldRecordDeletion(db, eventId, version, answersJson, updatedAt, cutoff)) return true;
  const ids = await privateQuestionIds(db, eventId, version);
  if (ids === null) return true;
  let values: Record<string, unknown>;
  try { values = JSON.parse(valuesJson) as Record<string, unknown>; } catch { return true; }
  if (values === null || typeof values !== 'object' || Array.isArray(values)) return true;
  return [...ids].some((id) => Object.hasOwn(values, id)) || Object.hasOwn(values, 'allergies') || Object.keys(values).some((key) => key.startsWith('source:'));
}

async function deletionIdentities(db: Db, eventId: string, guildId: string, cutoff: number): Promise<string[]> {
  const identities = new Set<string>();
  for (const row of await db.all<{ user_id: string; form_version: number; answers_json: string; updated_at: number }>(
    'SELECT user_id,form_version,answers_json,updated_at FROM registration_answers WHERE event_id=?', eventId,
  )) if (await shouldRecordDeletion(db, eventId, row.form_version, row.answers_json, row.updated_at, cutoff)) identities.add(row.user_id);
  for (const row of await db.all<{ user_id: string; form_version: number; answers_json: string; updated_at: number }>(
    'SELECT user_id,form_version,answers_json,updated_at FROM registration_answer_history WHERE event_id=?', eventId,
  )) if (await shouldRecordDeletion(db, eventId, row.form_version, row.answers_json, row.updated_at, cutoff)) identities.add(row.user_id);
  for (const row of await db.all<{ id: string; form_version: number; answers_json: string; values_json: string; updated_at: number }>(
    'SELECT id,form_version,answers_json,values_json,updated_at FROM imported_signups WHERE event_id=? AND guild_id=?', eventId, guildId,
  )) if (await shouldRecordImportedDeletion(db, eventId, row.form_version, row.answers_json, row.values_json, row.updated_at, cutoff)) identities.add(`${IMPORT_DELETION_PREFIX}${row.id}`);
  for (const row of await db.all<{ import_id: string; form_version: number; answers_json: string; values_json: string; updated_at: number }>(
    'SELECT import_id,form_version,answers_json,values_json,updated_at FROM imported_signup_answer_history WHERE event_id=?', eventId,
  )) if (await shouldRecordImportedDeletion(db, eventId, row.form_version, row.answers_json, row.values_json, row.updated_at, cutoff)) identities.add(`${IMPORT_DELETION_PREFIX}${row.import_id}`);
  return [...identities];
}

/** Purge organizer-only answers at end+7d; cleanup may invoke this sooner. */
export async function purgeExpiredPrivateAnswers(db: Db, now: number): Promise<string[]> {
  const events = await db.all<{ id: string; guild_id: string; ends_at: number; form_json: string }>(
    `SELECT id,guild_id,ends_at,form_json FROM events WHERE status='ended' AND ends_at IS NOT NULL AND ends_at <= ?`, now - RETENTION_MS,
  );
  const purged: string[] = [];
  for (const event of events) {
    const deletedAt = event.ends_at + RETENTION_MS;
    const identities = await deletionIdentities(db, event.id, event.guild_id, deletedAt);
    for (const userId of identities) {
      await db.transaction(() => recordDeletion(db, { guildId: event.guild_id, eventId: event.id, userId, deletedAt }));
    }
    if (identities.length > 0) purged.push(event.id);
  }
  return purged;
}

export async function purgeEventPrivateAnswers(db: Db, eventId: string, now: number): Promise<void> {
  const event = await db.get<{ guild_id: string }>('SELECT guild_id FROM events WHERE id=?', eventId);
  if (!event) return;
  const identities = await deletionIdentities(db, eventId, event.guild_id, now);
  for (const userId of identities) {
    await db.transaction(() => recordDeletion(db, { guildId: event.guild_id, eventId, userId, deletedAt: now }));
  }
}

/** Replay durable identifiers against a restored snapshot before serving it. */
export async function replayPrivateAnswerDeletions(db: Db, records: Deletion[]): Promise<void> {
  for (const record of records) {
    await withGuildContext(db, record.guildId, () => db.transaction(() => erasePrivateAnswers(db, record)));
  }
}

/** Record a withdrawal so restore replay removes the same answer versions. */
export async function recordRegistrationWithdrawalDeletion(db: Db, eventId: string, userId: string, deletedAt: number): Promise<void> {
  const event = await db.get<{ guild_id: string }>('SELECT guild_id FROM events WHERE id=?', eventId);
  if (!event) return;
  await db.run(`INSERT INTO private_answer_deletions (guild_id,event_id,user_id,deleted_at) VALUES (?,?,?,?)
    ON CONFLICT (guild_id,event_id,user_id) DO UPDATE SET deleted_at=GREATEST(private_answer_deletions.deleted_at,EXCLUDED.deleted_at)`,
  event.guild_id, eventId, `${WITHDRAWAL_DELETION_PREFIX}${userId}`, deletedAt);
  await eraseLinkedImportedAnswerPayloads(db, eventId, event.guild_id, userId, deletedAt);
}

async function eraseLinkedImportedAnswerPayloads(db: Db, eventId: string, guildId: string, userId: string, deletedAt: number): Promise<void> {
  const imports = await db.all<{ id: string; form_version: number; values_json: string; updated_at: number }>(
    'SELECT id,form_version,values_json,updated_at FROM imported_signups WHERE event_id=? AND guild_id=? AND discord_user_id=?', eventId, guildId, userId,
  );
  for (const imported of imports) {
    if (imported.updated_at <= deletedAt) {
      let values: Record<string, unknown>;
      try { values = JSON.parse(imported.values_json) as Record<string, unknown>; } catch { values = {}; }
      const identity = Object.fromEntries(Object.entries(values).filter(([key]) => ['name', 'email', 'discordUsername'].includes(key)));
      await db.run("UPDATE imported_signups SET answers_json='{}',values_json=? WHERE id=? AND event_id=? AND guild_id=? AND form_version=? AND updated_at<=?",
        JSON.stringify(identity), imported.id, eventId, guildId, imported.form_version, deletedAt);
    }
    const histories = await db.all<{ form_version: number; updated_at: number }>(
      'SELECT form_version,updated_at FROM imported_signup_answer_history WHERE event_id=? AND import_id=?', eventId, imported.id,
    );
    for (const history of histories) if (history.updated_at <= deletedAt) {
      await db.run("UPDATE imported_signup_answer_history SET answers_json='{}',values_json='{}' WHERE event_id=? AND import_id=? AND form_version=? AND updated_at<=?",
        eventId, imported.id, history.form_version, deletedAt);
    }
  }
}
