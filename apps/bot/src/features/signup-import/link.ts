import type { Db } from '../../shared/db.js';
import { audit } from '../../shared/audit.js';
import type { FormConfig } from '../form/domain.js';
import { validateCustomAnswers } from '../form/domain.js';
import { getParticipant } from '../signup/data.js';
import { joinGroupTeam, type GroupTeamMembership } from '../teams/group-teams.js';
import { getTeamForUser } from '../teams/data.js';
import { markTeamProvisionPending } from '../teams/provision-data.js';
import { archiveImportedAnswerVersion } from '../registration/history.js';
import { importedRowProfile, normalizeImportedRow } from './normalize.js';
import { mergeImportedPlaceholder, projectImportedParticipant } from './sync.js';

export interface LinkResult {
  linked: boolean;
  activated: boolean;
  missingFields: string[];
  error?: string;
  /** The member already had a participant row; it was adopted instead of duplicated. */
  alreadyRegistered?: boolean;
  /** The pre-formed group team the member landed on, when their form named one. */
  groupTeam?: GroupTeamMembership;
  /** Values dropped while re-reading the row against the current form. */
  warnings?: string[];
}

export interface LinkOptions {
  /**
   * Organizer link. The event may still be a draft (organizers pre-register
   * people before launch), an existing participant is adopted, a row bound to a
   * different member may be re-bound, and stored answers are normalized against
   * the current form instead of failing on a stale version.
   */
  organizer?: boolean;
  /** Who did it, for the audit trail. Defaults to the audience name. */
  actor?: string;
  /** Automatic matching must never overwrite a link made concurrently. */
  onlyIfUnlinked?: boolean;
  /** Refuse a stale automatic match if the organizer edited the username. */
  expectedDiscordUsername?: string;
}

export async function linkImportedSignup(
  db: Db,
  eventId: string,
  guildId: string,
  importId: string,
  userId: string,
  form: FormConfig,
  options: LinkOptions = {},
): Promise<LinkResult> {
  return db.transaction(async () => {
    const event = await db.get<{ guild_id: string; status: string }>('SELECT guild_id,status FROM events WHERE id=? FOR UPDATE', eventId);
    if (!event || event.guild_id !== guildId) return { linked: false, activated: false, missingFields: [], error: 'event_not_found' };
    if (event.status === 'ended') return { linked: false, activated: false, missingFields: [], error: 'event_ended' };
    if (!options.organizer && event.status !== 'active') return { linked: false, activated: false, missingFields: [], error: 'event_not_active' };
    const row = await db.get<{ values_json: string; answers_json: string; discord_user_id: string | null; discord_username: string | null; form_version: number; updated_at: number }>('SELECT values_json,answers_json,discord_user_id,discord_username,form_version,updated_at FROM imported_signups WHERE id=? AND event_id=? FOR UPDATE', importId, eventId);
    if (!row) return { linked: false, activated: false, missingFields: [], error: 'import_not_found' };
    if (options.onlyIfUnlinked && row.discord_user_id !== null) return { linked: false, activated: false, missingFields: [], error: 'already_linked' };
    if (options.expectedDiscordUsername !== undefined && row.discord_username !== options.expectedDiscordUsername) return { linked: false, activated: false, missingFields: [], error: 'username_changed' };
    // A member claimed by a *different* row is a duplicate the organizer must
    // resolve; re-binding this row to someone else is a correction, not a clash.
    if (await db.get('SELECT id FROM imported_signups WHERE event_id=? AND discord_user_id=? AND id<>?', eventId, userId, importId)) return { linked: false, activated: false, missingFields: [], error: 'identity_conflict' };
    if (row.discord_user_id !== null && row.discord_user_id !== userId && !options.organizer) return { linked: false, activated: false, missingFields: [], error: 'identity_conflict' };

    const warnings: string[] = [];
    let values = JSON.parse(row.values_json) as Record<string, string>;
    let answers = JSON.parse(row.answers_json) as Record<string, string | string[]>;
    let formVersion = row.form_version;
    if (row.form_version !== form.version) {
      await archiveImportedAnswerVersion(db, eventId, importId, row.form_version, answers, values, row.updated_at);
    }
    if (options.organizer) {
      // The organizer is authoritative: an option id from an older form, or a
      // stale version stamp, must not block the correction they came here to make.
      const normalized = normalizeImportedRow(form, values, row.form_version === form.version ? answers : {});
      values = normalized.values;
      answers = normalized.answers;
      warnings.push(...normalized.issues);
      formVersion = form.version;
    } else if (row.form_version !== form.version) {
      // The historical answers stay attached to their old version. Start this
      // version empty so a reused question id cannot silently carry old data.
      const normalized = normalizeImportedRow(form, values, {});
      values = normalized.values;
      answers = {};
      warnings.push(...normalized.issues);
      formVersion = form.version;
    }

    const target = await getParticipant(db, eventId, userId);
    if (target !== null && target.status === 'blocked') return { linked: false, activated: false, missingFields: [], error: 'registration_blocked' };
    const hadParticipant = target !== null;
    // A placeholder the import created becomes this member's participant, keeping
    // the team they were matched into and the answers they already gave.
    const checked = validateCustomAnswers(form, answers);
    if (!checked.ok) return { linked: false, activated: false, missingFields: [], error: 'invalid_answers' };
    const missingFields = checked.missingRequiredQuestionIds;
    const experience = values.experience ?? '';
    const role = values.role ?? '';
    const teamPref = values.teamPref ?? '';
    const skills = values.skills ? values.skills.split(',').map((value) => value.trim()).filter(Boolean) : [];
    if (experience && !form.experiences.some((option) => option.id === experience)) return { linked: false, activated: false, missingFields: ['experience'], error: 'invalid_core_answer' };
    if (role && !form.roleTracks.some((option) => option.id === role)) return { linked: false, activated: false, missingFields: ['role'], error: 'invalid_core_answer' };
    if (teamPref && !form.teamPrefs.some((option) => option.id === teamPref)) return { linked: false, activated: false, missingFields: ['teamPref'], error: 'invalid_core_answer' };
    if (skills.some((skill) => !form.skills.some((option) => option.id === skill))) return { linked: false, activated: false, missingFields: ['skills'], error: 'invalid_core_answer' };
    if (hadParticipant && !options.organizer && missingFields.length === 0) return { linked: false, activated: false, missingFields: [], error: 'participant_conflict' };
    const placeholder = await getParticipant(db, eventId, `imp:${importId}`);
    if (placeholder?.status === 'blocked') return { linked: false, activated: false, missingFields: [], error: 'registration_blocked' };
    await mergeImportedPlaceholder(db, eventId, importId, userId);

    const persist = async (): Promise<void> => {
      await db.run(
        'UPDATE imported_signups SET discord_user_id=?,values_json=?,answers_json=?,form_version=?,updated_at=? WHERE id=? AND event_id=?',
        userId, JSON.stringify(values), JSON.stringify(answers), formVersion, Date.now(), importId, eventId,
      );
    };
    const actor = options.actor ?? (options.organizer ? 'organizer' : 'participant');
    // Profile and answers of the row become the participant's, re-normalised
    // against the current form. Safe to call again: it merges, never duplicates.
    const project = async (): Promise<void> => {
      await projectImportedParticipant(db, { eventId, guildId, importId, userId, form, values, answers });
    };
    if ((await getParticipant(db, eventId, userId))?.status === 'blocked') return { linked: false, activated: false, missingFields: [], error: 'registration_blocked' };

    const queueTeam = async (): Promise<void> => {
      const team = await getTeamForUser(db, eventId, userId);
      if (team) await markTeamProvisionPending(db, guildId, eventId, team.id);
    };

    if (missingFields.length) {
      await persist();
      await project();
      const groupTeam = await joinGroupTeam(db, actor, eventId, guildId, userId, values.groupName);
      await queueTeam();
      await audit(db, actor, 'imported_signup.link', eventId, { importId, userId, activated: false, missing: missingFields.length, organizer: options.organizer === true }, guildId);
      return { linked: true, activated: false, missingFields, ...(groupTeam ? { groupTeam } : {}), ...(warnings.length ? { warnings } : {}) };
    }

    if (hadParticipant) {
      // A participant claim stays strict: an existing registration is not silently
      // merged with an imported row. An organizer may adopt it on purpose.
      if (!options.organizer) return { linked: false, activated: false, missingFields: [], error: 'participant_conflict' };
      await persist();
      await project();
      const groupTeam = await joinGroupTeam(db, actor, eventId, guildId, userId, values.groupName);
      await queueTeam();
      await audit(db, actor, 'imported_signup.link', eventId, { importId, userId, activated: true, adopted: true, organizer: options.organizer === true }, guildId);
      return { linked: true, activated: true, missingFields: [], alreadyRegistered: true, ...(groupTeam ? { groupTeam } : {}), ...(warnings.length ? { warnings } : {}) };
    }

    await persist();
    await project();
    const groupTeam = await joinGroupTeam(db, actor, eventId, guildId, userId, values.groupName);
    await queueTeam();
    await audit(db, actor, 'imported_signup.link', eventId, { importId, userId, activated: true, organizer: options.organizer === true }, guildId);
    return { linked: true, activated: true, missingFields: [], ...(groupTeam ? { groupTeam } : {}), ...(warnings.length ? { warnings } : {}) };
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
