/**
 * Auto-link imported signups to members who are already in the server.
 *
 * The sheet names the person's Discord username. When exactly one member matches
 * it, the row is linked through the ordinary organizer link path, so an existing
 * registration is adopted and the profile/answers are normalised the same way a
 * manual link would be. Two members with the same name are reported, never
 * guessed — a wrong link is worse than no link.
 */
import type { Db } from '../../shared/db.js';
import type { FormConfig } from '../form/domain.js';
import { listImportedSignups } from './data.js';
import { linkImportedSignup } from './link.js';

/** Resolve one username: a member id, `null` when nobody matches, `'ambiguous'` for a tie. */
export type UsernameLookup = (username: string) => Promise<string | null | 'ambiguous'>;

export interface AutoLinkResult {
  linked: { importId: string; userId: string; username: string; alreadyRegistered: boolean }[];
  ambiguous: { importId: string; username: string }[];
  missing: number;
  conflicts: { importId: string; username: string; error: string }[];
}

export async function autoLinkImportedSignups(
  db: Db,
  eventId: string,
  guildId: string,
  form: FormConfig,
  lookup: UsernameLookup,
  actor = 'organizer',
): Promise<AutoLinkResult> {
  const result: AutoLinkResult = { linked: [], ambiguous: [], missing: 0, conflicts: [] };
  const rows = await listImportedSignups(db, eventId);
  const answers = new Map<string, string | null | 'ambiguous'>();
  for (const row of rows) {
    if (row.discordUserId !== null) continue;
    const username = row.discordUsername?.trim();
    if (!username) continue;
    const key = username.toLocaleLowerCase('en-US').replace(/^@/, '');
    let match = answers.get(key);
    if (match === undefined) {
      match = await lookup(username);
      answers.set(key, match);
    }
    if (match === 'ambiguous') { result.ambiguous.push({ importId: row.id, username }); continue; }
    if (match === null) { result.missing++; continue; }
    const linked = await linkImportedSignup(db, eventId, guildId, row.id, match, form, { organizer: true, actor });
    if (linked.error) { result.conflicts.push({ importId: row.id, username, error: linked.error }); continue; }
    result.linked.push({ importId: row.id, userId: match, username, alreadyRegistered: linked.alreadyRegistered === true });
  }
  return result;
}

/** Link only identities with one matching unlinked row in this event. */
export async function autoLinkPresentMembers(
  db: Db,
  eventId: string,
  guildId: string,
  form: FormConfig,
  lookup: UsernameLookup,
  onlyUserId?: string,
  onlyImportId?: string,
  actor = 'system:member-join',
): Promise<string[]> {
  const candidates = new Map<string, { id: string; username: string }[]>();
  for (const row of await listImportedSignups(db, eventId)) {
    if (row.discordUserId !== null || !row.discordUsername?.trim()) continue;
    const member = await lookup(row.discordUsername);
    if (!member || member === 'ambiguous' || (onlyUserId && member !== onlyUserId)) continue;
    const rows = candidates.get(member) ?? [];
    rows.push({ id: row.id, username: row.discordUsername });
    candidates.set(member, rows);
  }
  const linked: string[] = [];
  for (const [member, rows] of candidates) {
    if (rows.length !== 1 || (onlyImportId && rows[0]!.id !== onlyImportId)) continue;
    const result = await linkImportedSignup(db, eventId, guildId, rows[0]!.id, member, form, { organizer: true, actor, onlyIfUnlinked: true, expectedDiscordUsername: rows[0]!.username });
    if (result.linked) linked.push(member);
  }
  return linked;
}
