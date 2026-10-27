import { Events, type Client, type GuildMember } from 'discord.js';
import type { Db } from '../shared/db.js';
import { withGuildContext } from '../shared/postgres.js';
import { deleteGuildMemberData, reconcileGuildMembers } from '../features/signup/departures.js';
import { setMembershipLookup } from '../features/signup/eligibility.js';
import { destroyTeamSpace, type ProvisionDeps } from './provision.js';

/** Only Discord Unknown Member (10007) proves absence, not 403/404 guild/errors. */
export async function lookupGuildMember(client: Client, guildId: string, userId: string): Promise<boolean> {
  const guild = await client.guilds.fetch(guildId);
  try {
    await guild.members.fetch({ user: userId, force: true });
    return true;
  } catch (error) {
    if (typeof error === 'object' && error !== null && 'code' in error && error.code === 10007) return false;
    throw error;
  }
}

function indexMember(map: Map<string, string[]>, member: GuildMember): void {
  if (member.user.bot) return;
  for (const name of [member.user.username, member.user.globalName, member.user.tag]) {
    if (!name) continue;
    const key = name.trim().toLocaleLowerCase('en-US').replace(/^@/, '');
    if (key === '') continue;
    const ids = map.get(key) ?? [];
    if (!ids.includes(member.id)) ids.push(member.id);
    map.set(key, ids);
  }
}

/**
 * Resolve a sheet's "Discord username" column against the members already in the
 * server. One member index is built per import (not one REST call per row);
 * a tie is reported as ambiguous so a wrong link is never guessed.
 */
export function createMemberUsernameLookup(client: Client, guildId: string): (username: string) => Promise<string | null | 'ambiguous'> {
  let index: Promise<Map<string, string[]>> | null = null;
  const build = async (): Promise<Map<string, string[]>> => {
    const map = new Map<string, string[]>();
    // A guild or member list we cannot read means no auto-link, never a guessed
    // one: the organizer can still link by hand.
    try {
      const guild = await client.guilds.fetch(guildId);
      let members = guild.members.cache;
      if (members.size === 0) members = await guild.members.fetch();
      for (const member of members.values()) indexMember(map, member);
    } catch (error) {
      console.warn('Discord member index unavailable; imported rows stay unlinked:', error);
    }
    return map;
  };
  return async (username: string) => {
    index ??= build();
    const key = username.trim().toLocaleLowerCase('en-US').replace(/^@/, '');
    if (key === '') return null;
    const ids = (await index).get(key) ?? [];
    return ids.length === 0 ? null : ids.length === 1 ? ids[0]! : 'ambiguous';
  };
}

export function registerMemberLifecycle(db: Db, client: Client): () => Promise<void> {
  const pd: ProvisionDeps = { db, client, categoryIdFor: () => undefined };
  setMembershipLookup(db, (guildId, userId) => lookupGuildMember(client, guildId, userId));
  const reconcile = async () => {
    // Cache enumerates connected guilds only: missing guild/bot removal never
    // becomes evidence that every person departed.
    for (const guild of client.guilds.cache.values()) {
      if (guild.available === false) continue;
      await withGuildContext(db, guild.id, () => reconcileGuildMembers(db, guild.id, (userId) => lookupGuildMember(client, guild.id, userId), (team) => destroyTeamSpace(pd, team)));
    }
  };
  client.on(Events.GuildMemberRemove, async (member) => {
    try {
      await withGuildContext(db, member.guild.id, async () => {
        for (const team of await deleteGuildMemberData(db, member.guild.id, member.id)) await destroyTeamSpace(pd, team);
      });
    } catch (error) { console.error('Member departure deletion failed:', error); }
  });
  const catchUp = () => { void reconcile().catch((error) => console.error('Member reconciliation failed:', error)); };
  client.on(Events.ClientReady, catchUp);
  client.on(Events.ShardResume, catchUp);
  return reconcile;
}
