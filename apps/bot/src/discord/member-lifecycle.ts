import { Events, type Client } from 'discord.js';
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
