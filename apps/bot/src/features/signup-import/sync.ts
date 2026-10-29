/**
 * Imported signups are participants, not paperwork.
 *
 * Every imported row owns a participant row: a real one once the row is linked
 * to a Discord member, otherwise a placeholder keyed `imp:<importId>` so the
 * person is visible in Participants, matching and team assignment before they
 * ever join the server. This module is the single writer for that projection —
 * create, edit, link, claim and delete all call it so the two can never drift.
 */
import type { Db } from '../../shared/db.js';
import type { FormConfig } from '../form/domain.js';
import { importedRowProfile, normalizeImportedRow } from './normalize.js';
import { listImportedSignups, type ImportedSignup } from './data.js';
import { joinGroupTeam } from '../teams/group-teams.js';

/** Placeholder identities never collide with a snowflake and name their row. */
export function importedParticipantId(importId: string): string {
  return `imp:${importId}`;
}

export function isImportedPlaceholderId(userId: string): boolean {
  return userId.startsWith('imp:');
}

const DEFAULT_NAME = 'Imported participant';

async function upsertParticipantFromRow(
  db: Db,
  eventId: string,
  guildId: string,
  userId: string,
  importId: string,
  name: string,
  profile: { experience: string; roleTrack: string; skills: string[]; teamPref: string },
): Promise<void> {
  // Never touch status, team membership or teammates: those are decisions made in
  // the console (block, match, assign) and a CSV re-import must not undo them.
  await db.run(
    `INSERT INTO participants
       (event_id, user_id, guild_id, display_name, experience, role_track, skills, team_pref, teammates, status, imported_signup_id, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, '[]', 'active', ?, ?, ?)
     ON CONFLICT(event_id, user_id) DO UPDATE SET
       display_name = excluded.display_name,
       experience = excluded.experience,
       role_track = excluded.role_track,
       skills = excluded.skills,
       team_pref = excluded.team_pref,
       imported_signup_id = excluded.imported_signup_id,
       updated_at = excluded.updated_at`,
    eventId, userId, guildId, name, profile.experience, profile.roleTrack,
    JSON.stringify(profile.skills), profile.teamPref, importId, Date.now(), Date.now(),
  );
}

/**
 * Move a placeholder onto the member it was linked to. Team membership and
 * answers follow the person: a matched imported participant keeps their team when
 * they finally join Discord and are linked.
 */
export async function mergeImportedPlaceholder(
  db: Db,
  eventId: string,
  importId: string,
  userId: string,
  now = Date.now(),
): Promise<void> {
  const placeholderId = importedParticipantId(importId);
  if (placeholderId === userId) return;
  const placeholder = await db.get<{ team_id: string | null }>(
    'SELECT team_id FROM participants WHERE event_id=? AND user_id=?', eventId, placeholderId);
  if (placeholder === undefined) return;
  const target = await db.get<{ team_id: string | null }>(
    'SELECT team_id FROM participants WHERE event_id=? AND user_id=?', eventId, userId);
  await db.run('UPDATE teams SET owner_id=? WHERE event_id=? AND owner_id=?',
    target?.team_id && target.team_id !== placeholder.team_id ? null : userId, eventId, placeholderId);
  if (target === undefined) {
    await db.run('UPDATE participants SET user_id=?, imported_signup_id=?, updated_at=? WHERE event_id=? AND user_id=?',
      userId, importId, now, eventId, placeholderId);
    await db.run('DELETE FROM registration_answers WHERE event_id=? AND user_id=?', eventId, userId);
    await db.run('UPDATE registration_answers SET user_id=? WHERE event_id=? AND user_id=?', userId, eventId, placeholderId);
    return;
  }
  if (target.team_id === null && placeholder.team_id !== null) {
    await db.run('UPDATE participants SET team_id=?, updated_at=? WHERE event_id=? AND user_id=?', placeholder.team_id, now, eventId, userId);
  }
  await db.run('DELETE FROM participants WHERE event_id=? AND user_id=?', eventId, placeholderId);
  await db.run('DELETE FROM registration_answers WHERE event_id=? AND user_id=?', eventId, placeholderId);
}

/**
 * Remove the placeholder a deleted imported row owned. A linked participant is a
 * real registration: it survives, and loses only the provenance marker.
 */
export async function dropImportedPlaceholder(db: Db, eventId: string, importId: string): Promise<void> {
  const placeholderId = importedParticipantId(importId);
  await db.run('DELETE FROM participants WHERE event_id=? AND user_id=?', eventId, placeholderId);
  await db.run('DELETE FROM registration_answers WHERE event_id=? AND user_id=?', eventId, placeholderId);
  await db.run('UPDATE participants SET imported_signup_id=NULL WHERE event_id=? AND imported_signup_id=? AND user_id<>?',
    eventId, importId, placeholderId);
}

export interface ImportedProjectionInput {
  eventId: string;
  guildId: string;
  importId: string;
  /** Real member id, or the `imp:` placeholder while the row is unlinked. */
  userId: string;
  form: FormConfig;
  values: Record<string, string>;
  answers: Record<string, string | string[]>;
}

/**
 * Write one imported row's profile and answers onto its participant, moving a
 * placeholder forward when the row is now linked. Re-normalised against the
 * current form, so a form change cannot leave unreadable answers behind.
 */
export async function projectImportedParticipant(db: Db, input: ImportedProjectionInput): Promise<string> {
  const { eventId, guildId, importId, userId, form } = input;
  const normalized = normalizeImportedRow(form, input.values, input.answers);
  const profile = importedRowProfile(form, normalized.values);
  const name = (normalized.values.name ?? '').trim().slice(0, 80) || DEFAULT_NAME;
  await mergeImportedPlaceholder(db, eventId, importId, userId);
  await upsertParticipantFromRow(db, eventId, guildId, userId, importId, name, profile);
  await db.run(
    `INSERT INTO registration_answers (event_id, user_id, form_version, answers_json, updated_at)
     VALUES (?, ?, ?, ?, ?) ON CONFLICT (event_id, user_id) DO UPDATE
     SET form_version = EXCLUDED.form_version, answers_json = EXCLUDED.answers_json, updated_at = EXCLUDED.updated_at`,
    eventId, userId, form.version, JSON.stringify(normalized.answers), Date.now(),
  );
  return userId;
}

/** Bring one imported row's participant in line with the row. */
export async function syncImportedRow(
  db: Db,
  eventId: string,
  guildId: string,
  row: ImportedSignup,
  form: FormConfig,
): Promise<string> {
  return projectImportedParticipant(db, {
    eventId,
    guildId,
    importId: row.id,
    userId: row.discordUserId ?? importedParticipantId(row.id),
    form,
    values: row.values,
    answers: row.answers,
  });
}

export interface ImportedReconcileResult {
  participants: number;
  removedPlaceholders: number;
  groupedTeams: number;
}

/**
 * Re-derive every participant this event's imported rows own. Called after any
 * import change; also clears placeholders whose row is gone or now linked, and
 * forms the group teams the sheet asked for (a group of unlinked people is still
 * a team).
 */
export async function reconcileImportedParticipants(
  db: Db,
  eventId: string,
  guildId: string,
  form: FormConfig,
): Promise<ImportedReconcileResult> {
  return db.transaction(async () => {
    const rows = await listImportedSignups(db, eventId);
    const byImportId = new Map(rows.map((row) => [row.id, row] as const));
    let groupedTeams = 0;
    for (const row of rows) {
      const userId = await syncImportedRow(db, eventId, guildId, row, form);
      if (row.values.groupName && row.values.groupName.trim().length >= 2) {
        const grouped = await joinGroupTeam(db, 'import', eventId, guildId, userId, row.values.groupName);
        if (grouped?.created === true) groupedTeams++;
      }
    }

    // Repair owners left behind by older placeholder links, within this guild.
    await db.run(`UPDATE teams AS t SET owner_id = CASE WHEN p.team_id = t.id THEN p.user_id ELSE NULL END
      FROM imported_signups AS i JOIN participants AS p ON p.event_id = i.event_id AND p.user_id = i.discord_user_id
      WHERE t.event_id = ? AND i.event_id = t.event_id AND t.owner_id = 'imp:' || i.id AND i.discord_user_id IS NOT NULL
        AND NOT EXISTS (SELECT 1 FROM participants AS placeholder WHERE placeholder.event_id = t.event_id AND placeholder.user_id = t.owner_id)`, eventId);

    const placeholders = await db.all<{ user_id: string }>(
      "SELECT user_id FROM participants WHERE event_id=? AND user_id LIKE 'imp:%'", eventId);
    let removedPlaceholders = 0;
    for (const { user_id: userId } of placeholders) {
      const row = byImportId.get(userId.slice(4));
      if (row !== undefined && row.discordUserId === null) continue;
      await db.run('DELETE FROM participants WHERE event_id=? AND user_id=?', eventId, userId);
      await db.run('DELETE FROM registration_answers WHERE event_id=? AND user_id=?', eventId, userId);
      removedPlaceholders++;
    }
    return { participants: rows.length, removedPlaceholders, groupedTeams };
  });
}
