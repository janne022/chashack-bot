/**
 * Form service: read/update the single form_config row.
 */
import type { Db } from '../../shared/db.js';
import { audit } from '../../shared/audit.js';
import { err, ok, type Result } from '../../shared/result.js';
import { DEFAULT_FORM, normalizeFormUpdate, type FormConfig } from './domain.js';

export async function getForm(db: Db): Promise<FormConfig> {
  const row = await db.get<{ json: string }>('SELECT json FROM form_config WHERE id = 1');
  if (row === undefined) {
    await db.run('INSERT INTO form_config (id, json, updated_at) VALUES (1, ?, ?)', JSON.stringify(DEFAULT_FORM), Date.now());
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

export async function updateForm(db: Db, actor: string, update: Partial<FormConfig>): Promise<Result<FormConfig>> {
  // Read-modify-write: the no-change comparison must see the same row it writes,
  // so the whole sequence runs atomically (implicitly serial in the sync code).
  return db.transaction(async () => {
    const current = await getForm(db);
    const next = normalizeFormUpdate(current, update);
    if (next.title === current.title && JSON.stringify(next) === JSON.stringify(current)) {
      return err('no_change', 'Nothing changed.');
    }
    await db.run('UPDATE form_config SET json = ?, updated_at = ? WHERE id = 1', JSON.stringify(next), Date.now());
    await audit(db, actor, 'form.update', 'form', { before: current.version, after: next.version });
    return ok(next);
  });
}

export async function resetForm(db: Db, actor: string): Promise<Result<FormConfig>> {
  await db.run('UPDATE form_config SET json = ?, updated_at = ? WHERE id = 1', JSON.stringify(DEFAULT_FORM), Date.now());
  await audit(db, actor, 'form.reset', 'form', null);
  return ok(DEFAULT_FORM);
}
