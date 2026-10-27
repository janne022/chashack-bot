import type { Db } from '../../shared/db.js';
import type { FormConfig } from '../form/domain.js';
import { validateCustomAnswers } from '../form/domain.js';
import { getParticipant } from '../signup/data.js';
import { saveRegistrationAnswers } from '../registration/data.js';
import { importedRowProfile } from './normalize.js';

export async function linkImportedSignup(db: Db, eventId: string, guildId: string, importId: string, userId: string, form: FormConfig): Promise<{ linked: boolean; activated: boolean; missingFields: string[]; error?: string }> {
  return db.transaction(async () => {
    const event = await db.get<{ guild_id: string; status: string }>('SELECT guild_id,status FROM events WHERE id=? FOR UPDATE', eventId);
    if (!event || event.guild_id !== guildId) return { linked: false, activated: false, missingFields: [], error: 'event_not_found' };
    if (event.status !== 'active') return { linked: false, activated: false, missingFields: [], error: 'event_not_active' };
    const row = await db.get<{ values_json: string; answers_json: string; discord_user_id: string | null; form_version: number }>('SELECT values_json,answers_json,discord_user_id,form_version FROM imported_signups WHERE id=? AND event_id=? FOR UPDATE', importId, eventId);
    if (!row) return { linked: false, activated: false, missingFields: [], error: 'import_not_found' };
    if (row.form_version !== form.version) return { linked: false, activated: false, missingFields: [], error: 'stale_form_version' };
    if (row.discord_user_id !== null && row.discord_user_id !== userId) return { linked: false, activated: false, missingFields: [], error: 'identity_conflict' };
    if (await db.get('SELECT id FROM imported_signups WHERE event_id=? AND discord_user_id=? AND id<>?', eventId, userId, importId)) return { linked: false, activated: false, missingFields: [], error: 'identity_conflict' };
    const existing = await getParticipant(db, eventId, userId);
    if (existing) return { linked: false, activated: false, missingFields: [], error: existing.status === 'blocked' ? 'registration_blocked' : 'participant_conflict' };
    const answers = JSON.parse(row.answers_json) as Record<string, string | string[]>;
    const checked = validateCustomAnswers(form, answers);
    if (!checked.ok) return { linked: false, activated: false, missingFields: [], error: 'invalid_answers' };
    const missingFields = checked.missingRequiredQuestionIds;
    const values = JSON.parse(row.values_json) as Record<string, string>;
    const experience = values.experience ?? '';
    const role = values.role ?? '';
    const teamPref = values.teamPref ?? '';
    const skills = values.skills ? values.skills.split(',').map((value) => value.trim()).filter(Boolean) : [];
    if (experience && !form.experiences.some((option) => option.id === experience)) return { linked: false, activated: false, missingFields: ['experience'], error: 'invalid_core_answer' };
    if (role && !form.roleTracks.some((option) => option.id === role)) return { linked: false, activated: false, missingFields: ['role'], error: 'invalid_core_answer' };
    if (teamPref && !form.teamPrefs.some((option) => option.id === teamPref)) return { linked: false, activated: false, missingFields: ['teamPref'], error: 'invalid_core_answer' };
    if (skills.some((skill) => !form.skills.some((option) => option.id === skill))) return { linked: false, activated: false, missingFields: ['skills'], error: 'invalid_core_answer' };
    if (missingFields.length) {
      await db.run('UPDATE imported_signups SET discord_user_id=?,updated_at=? WHERE id=? AND event_id=?', userId, Date.now(), importId, eventId);
      return { linked: true, activated: false, missingFields };
    }
    const result = await saveRegistrationAnswers(db, eventId, userId, form.version, checked.answers);
    if (!result.ok) return { linked: false, activated: false, missingFields: [], error: result.code };
    await db.run('UPDATE imported_signups SET discord_user_id=?,updated_at=? WHERE id=? AND event_id=?', userId, Date.now(), importId, eventId);
    await db.run(`INSERT INTO participants (event_id,user_id,guild_id,display_name,experience,role_track,skills,team_pref,teammates,status,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,'[]','active',?,?)`, eventId, userId, guildId, values.name ?? 'Imported participant', experience, role, JSON.stringify(skills), teamPref, Date.now(), Date.now());
    return { linked: true, activated: true, missingFields: [] };
  });
}

/** What a participant may see about the imported row they claim: identity only. */
export interface ImportedClaimMatch {
  id: string;
  name: string;
  groupName: string;
  discordUsername: string | null;
  linkedToSelf: boolean;
  linkedToOther: boolean;
}

const normalizeEmail = (email: string): string => email.trim().toLocaleLowerCase('en-US');

/**
 * Find the imported row for an e-mail address in one event. Only the fields a
 * participant needs to recognise their own row are returned — never answers,
 * allergies, group members or another person's Discord identity.
 */
export async function findImportedSignupByEmail(db: Db, eventId: string, email: string, userId: string): Promise<ImportedClaimMatch | null> {
  const normalized = normalizeEmail(email);
  if (!normalized) return null;
  const row = await db.get<{ id: string; values_json: string; discord_user_id: string | null }>(
    "SELECT id,values_json,discord_user_id FROM imported_signups WHERE event_id=? AND lower(values_json::jsonb->>'email')=? ORDER BY source_row,id LIMIT 1",
    eventId, normalized);
  if (!row) return null;
  const values = JSON.parse(row.values_json) as Record<string, string>;
  return {
    id: row.id,
    name: values.name ?? '',
    groupName: values.groupName ?? '',
    discordUsername: values.discordUsername ?? null,
    linkedToSelf: row.discord_user_id !== null && row.discord_user_id === userId,
    linkedToOther: row.discord_user_id !== null && row.discord_user_id !== userId,
  };
}

export interface ClaimResult {
  linked: boolean;
  activated: boolean;
  missingFields: string[];
  error?: string;
  /** Only returned to the participant who owns the row, to pre-fill the rest of the form. */
  prefill?: { answers: Record<string, string | string[]>; profile: { experience: string; roleTrack: string; skills: string[]; teamPref: string } };
}

/** The owner's own answers and profile, safe to pre-fill the normal web form. */
async function claimPrefill(db: Db, eventId: string, importId: string, form: FormConfig): Promise<{ answers: Record<string, string | string[]>; profile: { experience: string; roleTrack: string; skills: string[]; teamPref: string } }> {
  const row = await db.get<{ values_json: string; answers_json: string }>('SELECT values_json,answers_json FROM imported_signups WHERE id=? AND event_id=?', importId, eventId);
  const values = row ? JSON.parse(row.values_json) as Record<string, string> : {};
  const stored = row ? JSON.parse(row.answers_json) as Record<string, string | string[]> : {};
  const checked = validateCustomAnswers(form, stored);
  return { answers: checked.ok ? checked.answers : {}, profile: importedRowProfile(form, values) };
}

/**
 * Bind an imported row to the signed-in participant by the e-mail they used on
 * the external form. Refuses a row already owned by someone else.
 */
export async function claimImportedSignupByEmail(db: Db, eventId: string, guildId: string, email: string, userId: string, form: FormConfig): Promise<ClaimResult> {
  const match = await findImportedSignupByEmail(db, eventId, email, userId);
  if (match === null) return { linked: false, activated: false, missingFields: [], error: 'import_not_found' };
  if (match.linkedToOther) return { linked: false, activated: false, missingFields: [], error: 'identity_conflict' };
  if (match.linkedToSelf) {
    const participant = await getParticipant(db, eventId, userId);
    return {
      linked: true,
      activated: participant !== null,
      missingFields: [],
      prefill: await claimPrefill(db, eventId, match.id, form),
    };
  }
  const result = await linkImportedSignup(db, eventId, guildId, match.id, userId, form);
  if (result.error) return result;
  return { ...result, prefill: await claimPrefill(db, eventId, match.id, form) };
}
