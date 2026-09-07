/**
 * Matching service: preview (no writes) and commit (write matched teams).
 * Re-running the match clears previous matched teams first.
 */
import type { Db } from '../../shared/db.js';
import { newId } from '../../shared/db.js';
import { audit } from '../../shared/audit.js';
import { err, ok, type Result } from '../../shared/result.js';
import type { FormConfig } from '../form/domain.js';
import { listMatchable, type Participant } from '../signup/store.js';
import { buildTeams, type MatchResult } from './engine.js';

export function previewMatch(db: Db, guildId: string, config: FormConfig): Result<MatchResult> {
  const participants = listMatchable(db, guildId);
  if (participants.length < 2) return err('not_enough', 'Need at least 2 unteamed participants opted into matching.');
  return ok(buildTeams(participants, config));
}

export function commitMatch(db: Db, actor: string, guildId: string, config: FormConfig): Result<MatchResult> {
  const preview = previewMatch(db, guildId, config);
  if (!preview.ok) return preview;

  // Clear previous matched teams.
  const previous = db.prepare("SELECT id FROM teams WHERE guild_id = ? AND kind = 'matched'").all(guildId) as unknown as { id: string }[];
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

  db.prepare('INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(
    `last_match:${guildId}`,
    JSON.stringify({ at: Date.now(), teams: preview.value.teams.length }),
  );
  audit(db, actor, 'match.commit', guildId, { teams: preview.value.teams.length });

  return ok(preview.value);
}

export function lastMatchInfo(db: Db, guildId: string): { at: number; teams: number } | null {
  const row = db.prepare('SELECT value FROM meta WHERE key = ?').get(`last_match:${guildId}`) as
    | { value: string }
    | undefined;
  if (row === undefined) return null;
  try {
    return JSON.parse(row.value) as { at: number; teams: number };
  } catch {
    return null;
  }
}

/** All participants eligible for admin assignment UI (active + signed up). */
export function assignableParticipants(db: Db, guildId: string): Participant[] {
  return listMatchable(db, guildId);
}
