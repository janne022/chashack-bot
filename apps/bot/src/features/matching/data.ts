/**
 * Matching service: preview (no writes) and commit (write matched teams).
 * Re-running the match clears previous matched teams first.
 */
import type { Db } from '../../shared/db.js';
import { newId } from '../../shared/db.js';
import { audit } from '../../shared/audit.js';
import { err, ok, type Result } from '../../shared/result.js';
import type { FormConfig } from '../form/domain.js';
import { listMatchable } from '../signup/data.js';
import { listTeams, type TeamWithMembers } from '../teams/data.js';
import { buildTeams, type MatchResult } from './domain.js';

/** Teams for an event with their active members — input for placement suggestions. */
export async function listTeamsWithMembers(db: Db, eventId: string): Promise<TeamWithMembers[]> {
  return await listTeams(db, eventId);
}

export async function previewMatch(db: Db, eventId: string, config: FormConfig): Promise<Result<MatchResult>> {
  const participants = await listMatchable(db, eventId);
  if (participants.length < 2) return err('not_enough', 'Need at least 2 unteamed participants opted into matching.');
  return ok(buildTeams(participants, config));
}

export async function commitMatch(db: Db, actor: string, eventId: string, guildId: string, config: FormConfig): Promise<Result<MatchResult>> {
  // The whole clear → insert → assign sequence was implicitly atomic when this
  // module was synchronous: an interleaved join/leave could desync the member
  // updates (participant assigned to a matched team id that the next
  // statement deletes). The transaction + the handle's single-writer queue
  // restore that guarantee across await points.
  return db.transaction(async () => {
    const preview = await previewMatch(db, eventId, config);
    if (!preview.ok) return preview;

    // Clear previous matched teams.
    const previous = await db.all<{ id: string }>("SELECT id FROM teams WHERE event_id = ? AND kind = 'matched'", eventId);
    for (const t of previous) {
      await db.run('UPDATE participants SET team_id = NULL WHERE team_id = ?', t.id);
      await db.run('DELETE FROM teams WHERE id = ?', t.id);
    }

    // Create the new matched teams and assign members. Event-scoped on purpose:
    // the row carries event_id and the member update is filtered by it, so a match
    // in one event can never hijack that user's team in another.
    for (const team of preview.value.teams) {
      const id = newId('team');
      await db.run(
        "INSERT INTO teams (id, event_id, guild_id, name, kind, owner_id, join_code, created_at) VALUES (?, ?, ?, ?, 'matched', NULL, NULL, ?)",
        id,
        eventId,
        guildId,
        team.name,
        Date.now(),
      );
      for (const userId of team.memberIds) {
        await db.run('UPDATE participants SET team_id = ?, updated_at = ? WHERE event_id = ? AND user_id = ?', id, Date.now(), eventId, userId);
      }
    }

    await db.run(
      'INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
      `last_match:${eventId}`,
      JSON.stringify({ at: Date.now(), teams: preview.value.teams.length }),
    );
    await audit(db, actor, 'match.commit', eventId, { teams: preview.value.teams.length });

    return ok(preview.value);
  });
}

export async function lastMatchInfo(db: Db, eventId: string): Promise<{ at: number; teams: number } | null> {
  const row = await db.get<{ value: string }>('SELECT value FROM meta WHERE key = ?', `last_match:${eventId}`);
  if (row === undefined) return null;
  try {
    return JSON.parse(row.value) as { at: number; teams: number };
  } catch {
    return null;
  }
}
