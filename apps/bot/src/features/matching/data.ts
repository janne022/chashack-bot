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
import { buildTeams, type MatchResult } from './domain.js';

export function previewMatch(db: Db, eventId: string, config: FormConfig): Result<MatchResult> {
  const participants = listMatchable(db, eventId);
  if (participants.length < 2) return err('not_enough', 'Need at least 2 unteamed participants opted into matching.');
  return ok(buildTeams(participants, config));
}

export function commitMatch(db: Db, actor: string, eventId: string, guildId: string, config: FormConfig): Result<MatchResult> {
  const preview = previewMatch(db, eventId, config);
  if (!preview.ok) return preview;

  // Clear previous matched teams.
  const previous = db.prepare("SELECT id FROM teams WHERE event_id = ? AND kind = 'matched'").all(eventId) as unknown as { id: string }[];
  for (const t of previous) {
    db.prepare('UPDATE participants SET team_id = NULL WHERE team_id = ?').run(t.id);
    db.prepare('DELETE FROM teams WHERE id = ?').run(t.id);
  }

  // Create the new matched teams and assign members.
  for (const team of preview.value.teams) {
    const id = newId('team');
    db.prepare(
      "INSERT INTO teams (id, guild_id, name, kind, owner_id, join_code, created_at) VALUES (?, ?, ?, 'matched', NULL, NULL, ?)",
    ).run(id, guildId, team.name, Date.now());
    for (const userId of team.memberIds) {
      db.prepare('UPDATE participants SET team_id = ?, updated_at = ? WHERE user_id = ? AND guild_id = ?').run(
        id,
        Date.now(),
        userId,
        guildId,
      );
    }
  }

  for (const team of preview.value.teams) {
    const id = newId('team');
    db.prepare(
      "INSERT INTO teams (id, event_id, guild_id, name, kind, owner_id, join_code, created_at) VALUES (?, ?, ?, ?, 'matched', NULL, NULL, ?)",
    ).run(id, eventId, guildId, team.name, Date.now());
    for (const userId of team.memberIds) {
      db.prepare('UPDATE participants SET team_id = ?, updated_at = ? WHERE event_id = ? AND user_id = ?').run(
        id,
        Date.now(),
        eventId,
        userId,
      );
    }
  }

  db.prepare('INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(
    `last_match:${eventId}`,
    JSON.stringify({ at: Date.now(), teams: preview.value.teams.length }),
  );
  audit(db, actor, 'match.commit', eventId, { teams: preview.value.teams.length });

  return ok(preview.value);
}

export function lastMatchInfo(db: Db, eventId: string): { at: number; teams: number } | null {
  const row = db.prepare('SELECT value FROM meta WHERE key = ?').get(`last_match:${eventId}`) as
    | { value: string }
    | undefined;
  if (row === undefined) return null;
  try {
    return JSON.parse(row.value) as { at: number; teams: number };
  } catch {
    return null;
  }
}


