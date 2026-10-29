import type { Db } from '../../shared/db.js';
import { err, ok, type Result } from '../../shared/result.js';
import { archiveRegistrationAnswerVersion } from './history.js';
import { recordRegistrationWithdrawalDeletion } from './retention.js';

export interface RegistrationAnswers {
  formVersion: number;
  answers: Record<string, string | string[]>;
}

export async function getRegistrationAnswers(db: Db, eventId: string, userId: string): Promise<RegistrationAnswers | null> {
  const row = await db.get<{ form_version: number; answers_json: string }>(
    'SELECT form_version, answers_json FROM registration_answers WHERE event_id = ? AND user_id = ?', eventId, userId,
  );
  if (row === undefined) return null;
  return { formVersion: row.form_version, answers: JSON.parse(row.answers_json) as RegistrationAnswers['answers'] };
}

export async function listRegistrationAnswers(db: Db, eventId: string): Promise<(RegistrationAnswers & { userId: string })[]> {
  const rows = await db.all<{ user_id: string; form_version: number; answers_json: string }>(
    'SELECT user_id, form_version, answers_json FROM registration_answers WHERE event_id = ? ORDER BY user_id', eventId,
  );
  return rows.map((row) => ({ userId: row.user_id, formVersion: row.form_version, answers: JSON.parse(row.answers_json) as RegistrationAnswers['answers'] }));
}

export async function saveRegistrationAnswers(
  db: Db, eventId: string, userId: string, formVersion: number, answers: Record<string, string | string[]>,
): Promise<Result<RegistrationAnswers>> {
  return db.transaction(async () => {
    await db.get('SELECT id FROM events WHERE id = ? FOR UPDATE', eventId);
    const existing = await db.get<{ form_version: number; answers_json: string; updated_at: number }>(
      'SELECT form_version, answers_json, updated_at FROM registration_answers WHERE event_id = ? AND user_id = ?', eventId, userId,
    );
    if (existing !== undefined && existing.form_version > formVersion) return err('stale_form_version', 'The signup form changed. Reload it before saving.');
    if (existing !== undefined && existing.form_version < formVersion) {
      await archiveRegistrationAnswerVersion(db, eventId, userId, existing.form_version,
        JSON.parse(existing.answers_json) as RegistrationAnswers['answers'], existing.updated_at);
    }
    await db.run(
      `INSERT INTO registration_answers (event_id, user_id, form_version, answers_json, updated_at)
       VALUES (?, ?, ?, ?, ?) ON CONFLICT (event_id, user_id) DO UPDATE
       SET form_version = EXCLUDED.form_version, answers_json = EXCLUDED.answers_json, updated_at = EXCLUDED.updated_at`,
      eventId, userId, formVersion, JSON.stringify(answers), Date.now(),
    );
    return ok({ formVersion, answers });
  });
}

/** Participant saves preserve hidden and retired answers under the same event lock. */
export async function saveParticipantAnswers(
  db: Db, eventId: string, userId: string, formVersion: number,
  answers: RegistrationAnswers['answers'], visibleQuestionIds: readonly string[],
): Promise<Result<RegistrationAnswers>> {
  return db.transaction(async () => {
    await db.get('SELECT id FROM events WHERE id = ? FOR UPDATE', eventId);
    const existing = await getRegistrationAnswers(db, eventId, userId);
    const visibleIds = new Set(visibleQuestionIds);
    const retained = existing?.formVersion === formVersion
      ? Object.fromEntries(Object.entries(existing.answers).filter(([id]) => !visibleIds.has(id)))
      : {};
    return saveRegistrationAnswers(db, eventId, userId, formVersion, { ...retained, ...answers });
  });
}

export async function deleteRegistrationAnswers(db: Db, eventId: string, userId: string): Promise<void> {
  await recordRegistrationWithdrawalDeletion(db, eventId, userId, Date.now());
  await db.run('DELETE FROM registration_answers WHERE event_id = ? AND user_id = ?', eventId, userId);
  await db.run('DELETE FROM registration_answer_history WHERE event_id = ? AND user_id = ?', eventId, userId);
}
