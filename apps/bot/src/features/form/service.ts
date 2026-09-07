/**
 * Form service: read/update the single form_config row.
 */
import type { Db } from '../../shared/db.js';
import { audit } from '../../shared/audit.js';
import { err, ok, type Result } from '../../shared/result.js';
import { DEFAULT_FORM, normalizeFormUpdate, type FormConfig } from './domain.js';

export function getForm(db: Db): FormConfig {
  const row = db.prepare('SELECT json FROM form_config WHERE id = 1').get() as { json: string } | undefined;
  if (row === undefined) {
    db.prepare('INSERT INTO form_config (id, json, updated_at) VALUES (1, ?, ?)').run(
      JSON.stringify(DEFAULT_FORM),
      Date.now(),
    );
    return DEFAULT_FORM;
  }
  try {
    const parsed = JSON.parse(row.json) as Partial<FormConfig>;
    // Merge over defaults so older configs survive new fields.
    return normalizeFormUpdate({ ...DEFAULT_FORM, ...parsed }, {});
  } catch {
    return DEFAULT_FORM;
  }
}

export function updateForm(db: Db, actor: string, update: Partial<FormConfig>): Result<FormConfig> {
  const current = getForm(db);
  const next = normalizeFormUpdate(current, update);
  if (next.title === current.title && JSON.stringify(next) === JSON.stringify(current)) {
    return err('no_change', 'Nothing changed.');
  }
  db.prepare('UPDATE form_config SET json = ?, updated_at = ? WHERE id = 1').run(JSON.stringify(next), Date.now());
  audit(db, actor, 'form.update', 'form', { before: current.version, after: next.version });
  return ok(next);
}

export function resetForm(db: Db, actor: string): Result<FormConfig> {
  db.prepare('UPDATE form_config SET json = ?, updated_at = ? WHERE id = 1').run(JSON.stringify(DEFAULT_FORM), Date.now());
  audit(db, actor, 'form.reset', 'form', null);
  return ok(DEFAULT_FORM);
}
