import type { Db } from '../../shared/db.js';
import type { FormConfig } from '../form/domain.js';

export interface AnswerHistoryEntry {
  formVersion: number;
  answers: Record<string, string | string[]>;
  questions: NonNullable<FormConfig['customQuestions']>;
  historicalDefinitionUnavailable: boolean;
  values?: Record<string, string>;
}

export async function saveFormVersion(db: Db, eventId: string, form: FormConfig): Promise<void> {
  await db.run(
    `INSERT INTO registration_form_versions (event_id,form_version,form_json,created_at)
     VALUES (?,?,?,?) ON CONFLICT (event_id,form_version) DO NOTHING`,
    eventId, form.version, JSON.stringify(form), Date.now(),
  );
}

/** Refresh the current definition only while no archived payload depends on it. */
export async function snapshotOutgoingFormVersion(db: Db, eventId: string, form: FormConfig): Promise<void> {
  const archived = await db.get(
    `SELECT 1 FROM registration_answer_history WHERE event_id=? AND form_version=?
     UNION ALL SELECT 1 FROM imported_signup_answer_history WHERE event_id=? AND form_version=? LIMIT 1`,
    eventId, form.version, eventId, form.version,
  );
  if (archived !== undefined) return;
  await db.run(
    `INSERT INTO registration_form_versions (event_id,form_version,form_json,created_at) VALUES (?,?,?,?)
     ON CONFLICT (event_id,form_version) DO UPDATE SET form_json=EXCLUDED.form_json`,
    eventId, form.version, JSON.stringify(form), Date.now(),
  );
}

export async function getFormVersion(db: Db, eventId: string, version: number): Promise<FormConfig | null> {
  const row = await db.get<{ form_json: string }>(
    'SELECT form_json FROM registration_form_versions WHERE event_id=? AND form_version=?', eventId, version,
  );
  return row === undefined ? null : JSON.parse(row.form_json) as FormConfig;
}

export async function archiveRegistrationAnswerVersion(
  db: Db, eventId: string, userId: string, version: number, answers: Record<string, string | string[]>, updatedAt: number,
): Promise<void> {
  await db.run(
    `INSERT INTO registration_answer_history (event_id,user_id,form_version,answers_json,updated_at)
     VALUES (?,?,?,?,?) ON CONFLICT (event_id,user_id,form_version) DO NOTHING`,
    eventId, userId, version, JSON.stringify(answers), updatedAt,
  );
}

export async function archiveImportedAnswerVersion(
  db: Db, eventId: string, importId: string, version: number, answers: Record<string, string | string[]>,
  values: Record<string, string>, updatedAt: number,
): Promise<void> {
  await db.run(
    `INSERT INTO imported_signup_answer_history (event_id,import_id,form_version,answers_json,values_json,updated_at)
     VALUES (?,?,?,?,?,?) ON CONFLICT (event_id,import_id,form_version) DO NOTHING`,
    eventId, importId, version, JSON.stringify(answers), JSON.stringify(values), updatedAt,
  );
}

async function decodeHistory(
  db: Db, eventId: string, rows: { form_version: number; answers_json: string; values_json?: string }[], current?: { formVersion: number; answers: Record<string, string | string[]>; values?: Record<string, string> },
): Promise<AnswerHistoryEntry[]> {
  const versions = [...rows];
  if (current && !versions.some((entry) => entry.form_version === current.formVersion)) {
    versions.push({ form_version: current.formVersion, answers_json: JSON.stringify(current.answers), ...(current.values === undefined ? {} : { values_json: JSON.stringify(current.values) }) });
  }
  const result: AnswerHistoryEntry[] = [];
  for (const entry of versions.sort((a, b) => a.form_version - b.form_version)) {
    const form = await getFormVersion(db, eventId, entry.form_version);
    result.push({
      formVersion: entry.form_version,
      answers: JSON.parse(entry.answers_json) as Record<string, string | string[]>,
      questions: form?.customQuestions ?? [],
      historicalDefinitionUnavailable: form === null,
      ...(entry.values_json === undefined ? {} : { values: JSON.parse(entry.values_json) as Record<string, string> }),
    });
  }
  return result;
}

export async function getRegistrationAnswerHistory(db: Db, eventId: string, userId: string): Promise<AnswerHistoryEntry[]> {
  const rows = await db.all<{ form_version: number; answers_json: string }>(
    'SELECT form_version,answers_json FROM registration_answer_history WHERE event_id=? AND user_id=? ORDER BY form_version', eventId, userId,
  );
  return decodeHistory(db, eventId, rows);
}

export async function getImportedAnswerHistory(
  db: Db, eventId: string, importId: string, current?: { formVersion: number; answers: Record<string, string | string[]>; values: Record<string, string> },
): Promise<AnswerHistoryEntry[]> {
  const rows = await db.all<{ form_version: number; answers_json: string; values_json: string }>(
    'SELECT form_version,answers_json,values_json FROM imported_signup_answer_history WHERE event_id=? AND import_id=? ORDER BY form_version', eventId, importId,
  );
  return decodeHistory(db, eventId, rows, current);
}
