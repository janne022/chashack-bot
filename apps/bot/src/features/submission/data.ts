import type { Db } from '../../shared/db.js';
import { err, ok, type Result } from '../../shared/result.js';
import { currentSubmissionAnswers, emptySubmissionForm, validateSubmissionAnswers, validateSubmissionForm, type SubmissionForm } from './domain.js';

export interface SubmissionRecord {
  formVersion: number;
  answers: Record<string, string | string[]>;
  createdAt: number;
  updatedAt: number;
}

export async function getSubmissionForm(db: Db, eventId: string): Promise<SubmissionForm> {
  const row = await db.get<{ version: number; enabled: number; allow_edits: number; questions_json: string }>('SELECT version, enabled, allow_edits, questions_json FROM submission_forms WHERE event_id = ?', eventId);
  if (!row) return emptySubmissionForm();
  return { version: row.version, enabled: !!row.enabled, allowEdits: !!row.allow_edits, questions: JSON.parse(row.questions_json) };
}

export async function saveSubmissionForm(db: Db, eventId: string, expectedVersion: number, input: unknown): Promise<Result<SubmissionForm>> {
  if (!Number.isSafeInteger(expectedVersion) || !validateSubmissionForm(input)) return err('invalid_form', 'Invalid submission form.');
  return db.transaction(async () => {
    if (!await db.get('SELECT id FROM events WHERE id = ? FOR UPDATE', eventId)) return err('event_unavailable', 'Event unavailable.');
    const previous = await getSubmissionForm(db, eventId);
    if (previous.version !== expectedVersion) return err('stale_form_version', 'The submission form changed. Reload it before saving.');
    const next = { ...input, version: previous.version + 1 };
    await db.run(`INSERT INTO submission_forms (event_id, version, enabled, allow_edits, questions_json, updated_at)
      VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT (event_id) DO UPDATE SET version = EXCLUDED.version, enabled = EXCLUDED.enabled,
      allow_edits = EXCLUDED.allow_edits, questions_json = EXCLUDED.questions_json, updated_at = EXCLUDED.updated_at`,
      eventId, next.version, Number(next.enabled), Number(next.allowEdits), JSON.stringify(next.questions), Date.now());
    return ok(next);
  });
}

export async function getSubmission(db: Db, eventId: string, userId: string): Promise<SubmissionRecord | null> {
  const row = await db.get<{ form_version: number; answers_json: string; created_at: number; updated_at: number }>('SELECT form_version, answers_json, created_at, updated_at FROM submission_answers WHERE event_id = ? AND user_id = ?', eventId, userId);
  return row ? { formVersion: row.form_version, answers: JSON.parse(row.answers_json), createdAt: row.created_at, updatedAt: row.updated_at } : null;
}

export async function listSubmissions(db: Db, eventId: string): Promise<(SubmissionRecord & { userId: string })[]> {
  const rows = await db.all<{ user_id: string; form_version: number; answers_json: string; created_at: number; updated_at: number }>('SELECT user_id, form_version, answers_json, created_at, updated_at FROM submission_answers WHERE event_id = ? ORDER BY updated_at DESC, user_id', eventId);
  return rows.map(row => ({ userId: row.user_id, formVersion: row.form_version, answers: JSON.parse(row.answers_json), createdAt: row.created_at, updatedAt: row.updated_at }));
}

export async function saveSubmission(db: Db, eventId: string, userId: string, version: number, answers: unknown): Promise<Result<SubmissionRecord & { complete: boolean; missingRequiredQuestionIds: string[] }>> {
  return db.transaction(async () => {
    const event = await db.get<{ status: string }>('SELECT status FROM events WHERE id = ? FOR UPDATE', eventId);
    const participant = await db.get<{ status: string }>('SELECT status FROM participants WHERE event_id = ? AND user_id = ?', eventId, userId);
    if (event?.status !== 'active' || participant?.status !== 'active') return err('event_unavailable', 'Event unavailable.');
    const form = await getSubmissionForm(db, eventId);
    if (!form.enabled) return err('submission_disabled', 'Submission is not enabled.');
    if (version !== form.version) return err('stale_form_version', 'The submission form changed. Reload it before saving.');
    const checked = validateSubmissionAnswers(form, answers);
    if (!checked.ok) return err('invalid_answers', 'Check the submission answers.');
    const previous = await getSubmission(db, eventId, userId);
    if (previous && !form.allowEdits) {
      const prior = validateSubmissionAnswers(form, currentSubmissionAnswers(form, previous.answers));
      if (prior.ok && prior.missingRequiredQuestionIds.length === 0) return err('submission_locked', 'This submission cannot be edited.');
    }
    const now = Date.now();
    const currentIds = new Set(form.questions.map(q => q.id));
    const retained = Object.fromEntries(Object.entries(previous?.answers ?? {}).filter(([id]) => !currentIds.has(id)));
    await db.run(`INSERT INTO submission_answers (event_id, user_id, form_version, answers_json, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT (event_id, user_id) DO UPDATE SET form_version = EXCLUDED.form_version,
      answers_json = EXCLUDED.answers_json, updated_at = EXCLUDED.updated_at`, eventId, userId, version, JSON.stringify({ ...retained, ...checked.answers }), previous?.createdAt ?? now, now);
    return ok({ formVersion: version, answers: checked.answers, createdAt: previous?.createdAt ?? now, updatedAt: now, complete: checked.missingRequiredQuestionIds.length === 0, missingRequiredQuestionIds: checked.missingRequiredQuestionIds });
  });
}
