import type { Db } from '../../shared/db.js';
import { withGuildContext } from '../../shared/postgres.js';
import type { CustomQuestion } from '../form/domain.js';

const RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
type Deletion = { guildId: string; eventId: string; userId: string; deletedAt: number };

async function erasePrivateAnswers(db: Db, record: Deletion): Promise<void> {
  const row = await db.get<{ form_json: string; answers_json: string; updated_at: number }>(
    `SELECT e.form_json, a.answers_json, a.updated_at FROM events e JOIN registration_answers a ON a.event_id=e.id
     WHERE e.id=? AND e.guild_id=? AND a.user_id=?`, record.eventId, record.guildId, record.userId,
  );
  if (!row || row.updated_at > record.deletedAt) return;
  const privateIds = new Set(((JSON.parse(row.form_json) as { customQuestions?: CustomQuestion[] }).customQuestions ?? [])
    .filter((question) => question.visibility === 'organizer_only').map((question) => question.id));
  const answers = JSON.parse(row.answers_json) as Record<string, unknown>;
  let changed = false;
  for (const id of privateIds) if (Object.hasOwn(answers, id)) { delete answers[id]; changed = true; }
  if (changed) await db.run('UPDATE registration_answers SET answers_json=? WHERE event_id=? AND user_id=?', JSON.stringify(answers), record.eventId, record.userId);
}

async function recordDeletion(db: Db, deletion: Deletion): Promise<void> {
  await db.run(`INSERT INTO private_answer_deletions (guild_id,event_id,user_id,deleted_at) VALUES (?,?,?,?)
    ON CONFLICT (guild_id,event_id,user_id) DO UPDATE SET deleted_at=GREATEST(private_answer_deletions.deleted_at,EXCLUDED.deleted_at)`,
  deletion.guildId, deletion.eventId, deletion.userId, deletion.deletedAt);
  await erasePrivateAnswers(db, deletion);
}

/** Purge organizer-only answers at end+7d; cleanup may invoke this sooner. */
export async function purgeExpiredPrivateAnswers(db: Db, now: number): Promise<string[]> {
  const events = await db.all<{ id: string; guild_id: string; ends_at: number; form_json: string }>(
    `SELECT id,guild_id,ends_at,form_json FROM events WHERE status='ended' AND ends_at IS NOT NULL AND ends_at <= ?`, now - RETENTION_MS,
  );
  const purged: string[] = [];
  for (const event of events) {
    const privateIds = new Set(((JSON.parse(event.form_json) as { customQuestions?: CustomQuestion[] }).customQuestions ?? [])
      .filter((question) => question.visibility === 'organizer_only').map((question) => question.id));
    if (privateIds.size === 0) continue;
    const rows = await db.all<{ user_id: string; updated_at: number; answers_json: string }>('SELECT user_id,updated_at,answers_json FROM registration_answers WHERE event_id=?', event.id);
    const deletedAt = event.ends_at + RETENTION_MS;
    let changed = false;
    for (const row of rows) {
      if (row.updated_at > deletedAt || ![...privateIds].some((id) => Object.hasOwn(JSON.parse(row.answers_json) as object, id))) continue;
      await db.transaction(() => recordDeletion(db, { guildId: event.guild_id, eventId: event.id, userId: row.user_id, deletedAt }));
      changed = true;
    }
    if (changed) purged.push(event.id);
  }
  return purged;
}

export async function purgeEventPrivateAnswers(db: Db, eventId: string, now: number): Promise<void> {
  const event = await db.get<{ guild_id: string; form_json: string }>('SELECT guild_id,form_json FROM events WHERE id=?', eventId);
  if (!event) return;
  const privateIds = ((JSON.parse(event.form_json) as { customQuestions?: CustomQuestion[] }).customQuestions ?? [])
    .filter((question) => question.visibility === 'organizer_only').map((question) => question.id);
  const rows = await db.all<{ user_id: string; answers_json: string }>('SELECT user_id,answers_json FROM registration_answers WHERE event_id=?', eventId);
  for (const row of rows) {
    if ([...privateIds].some((id) => Object.hasOwn(JSON.parse(row.answers_json) as object, id))) {
      await db.transaction(() => recordDeletion(db, { guildId: event.guild_id, eventId, userId: row.user_id, deletedAt: now }));
    }
  }
}

/** Replay durable identifiers against a restored snapshot before serving it. */
export async function replayPrivateAnswerDeletions(db: Db, records: Deletion[]): Promise<void> {
  for (const record of records) await withGuildContext(db, record.guildId, () => db.transaction(() => erasePrivateAnswers(db, record)));
}
