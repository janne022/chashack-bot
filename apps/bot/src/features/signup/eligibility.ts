import type { Db } from '../../shared/db.js';
import { getEvent, getEventForm } from '../events/data.js';
import { getForm } from '../form/data.js';
import { getParticipant, projectParticipantForMatching, type Participant } from './data.js';

export type MembershipLookup = (guildId: string, userId: string) => Promise<boolean>;
const lookups = new WeakMap<Db, MembershipLookup>();
/** Runtime callers install a fresh, fail-closed Discord membership lookup. */
export function setMembershipLookup(db: Db, lookup: MembershipLookup): void { lookups.set(db, lookup); }
export async function isCurrentMember(db: Db, guildId: string, userId: string, strict = false): Promise<boolean> {
  const lookup = lookups.get(db);
  if (lookup === undefined) return false;
  try { return await lookup(guildId, userId); } catch (error) { if (strict) throw error; return false; }
}

export async function eligibleParticipant(db: Db, eventId: string, userId: string, strictMembership = false): Promise<Participant | null> {
  const event = await getEvent(db, eventId);
  if (event === null || event.status !== 'active') return null;
  const participant = await getParticipant(db, eventId, userId);
  if (participant === null || participant.status !== 'active' || participant.guildId !== event.guildId) return null;
  // Imported participants have no Discord member to resolve until an organizer
  // links them; their row is the registration.
  if (participant.importedSignupId === null && !(await isCurrentMember(db, event.guildId, userId, strictMembership))) return null;
  return projectParticipantForMatching(db, participant, getEventForm(db, event, await getForm(db, event.guildId)));
}
