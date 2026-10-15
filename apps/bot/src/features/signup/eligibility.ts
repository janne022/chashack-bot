import type { Db } from '../../shared/db.js';
import { getEvent, getEventForm } from '../events/data.js';
import { getForm } from '../form/data.js';
import { getParticipant, projectParticipantForMatching, type Participant } from './data.js';

export type MembershipLookup = (guildId: string, userId: string) => Promise<boolean>;
const lookups = new WeakMap<Db, MembershipLookup>();
/** Runtime callers install a fresh, fail-closed Discord membership lookup. */
export function setMembershipLookup(db: Db, lookup: MembershipLookup): void { lookups.set(db, lookup); }
export async function isCurrentMember(db: Db, guildId: string, userId: string): Promise<boolean> {
  const lookup = lookups.get(db);
  // Isolated data tests have no gateway; runtime always installs the lookup.
  if (lookup === undefined) return true;
  try { return await lookup(guildId, userId); } catch { return false; }
}

export async function eligibleParticipant(db: Db, eventId: string, userId: string): Promise<Participant | null> {
  const event = await getEvent(db, eventId);
  if (event === null || event.status !== 'active') return null;
  const participant = await getParticipant(db, eventId, userId);
  if (participant === null || participant.status !== 'active' || participant.guildId !== event.guildId) return null;
  if (!(await isCurrentMember(db, event.guildId, userId))) return null;
  return projectParticipantForMatching(db, participant, getEventForm(db, event, await getForm(db, event.guildId)));
}
