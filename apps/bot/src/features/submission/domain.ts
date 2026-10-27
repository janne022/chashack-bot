import { validateCustomAnswers, validateCustomQuestions, type CustomQuestion } from '../form/domain.js';

export interface SubmissionForm {
  version: number;
  enabled: boolean;
  allowEdits: boolean;
  questions: CustomQuestion[];
}

export const emptySubmissionForm = (): SubmissionForm => ({ version: 0, enabled: false, allowEdits: true, questions: [] });

/** Submission questions are participant-facing and do not affect team matching. */
export function validateSubmissionForm(value: unknown): value is Omit<SubmissionForm, 'version'> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const form = value as Record<string, unknown>;
  if (typeof form.enabled !== 'boolean' || typeof form.allowEdits !== 'boolean') return false;
  const checked = validateCustomQuestions(form.questions);
  return checked.ok && (!form.enabled || checked.questions.length > 0) && checked.questions.every(q =>
    q.visibility === 'self_and_organizer' && q.presentation === 'web' && q.mapping === undefined);
}

export function validateSubmissionAnswers(form: SubmissionForm, raw: unknown) {
  return validateCustomAnswers({ customQuestions: form.questions }, raw);
}

/** Removed questions remain stored but never appear in the current form. */
export function currentSubmissionAnswers(form: SubmissionForm, answers: Record<string, string | string[]>) {
  const ids = new Set(form.questions.map(q => q.id));
  return Object.fromEntries(Object.entries(answers).filter(([id]) => ids.has(id)));
}
