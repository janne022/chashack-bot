import { PermissionFlagsBits, type Client, type PermissionOverwrites } from 'discord.js';
import type { Db } from '../shared/db.js';
import { getMessageRef, type HackathonEvent } from '../features/events/data.js';
import type { FormConfig } from '../features/form/domain.js';
import { clearEventAccessState, getEventAccessState, saveEventAccessState } from '../features/events/access-data.js';
import { listParticipants } from '../features/signup/data.js';
import { eligibleParticipant } from '../features/signup/eligibility.js';
import { t } from '../shared/i18n.js';
import { botLocale } from './provision.js';

const view = (overwrite?: PermissionOverwrites): boolean | null => overwrite?.allow.has(PermissionFlagsBits.ViewChannel) ? true : overwrite?.deny.has(PermissionFlagsBits.ViewChannel) ? false : null;
const running = new Set<string>();

/** Reconciled every maintenance tick, including late signups and withdrawals. */
export async function syncEventAccess(db: Db, client: Client, event: HackathonEvent, form: FormConfig, events: HackathonEvent[], now: number): Promise<void> {
  if (running.has(event.id)) return;
  running.add(event.id);
  try {
    let state = await getEventAccessState(db, event.guildId, event.id);
    const enabled = form.participantChannels === true && !event.cleanupDone;
    if (!enabled && !state) return;
    const guild = await client.guilds.fetch(event.guildId);
    const bot = guild.members.me ?? await guild.members.fetchMe();
    // Never restrict a signup channel, including one used by a different event.
    const publicChannels = new Set(events.filter(e => e.guildId === event.guildId).map(e => e.panelChannelId));
    publicChannels.add((await getMessageRef(db, `signup_panel:${event.guildId}`))?.channelId ?? null);
    const wanted = enabled ? [...new Set([event.announcementChannelId, event.scheduleChannelId].filter((id): id is string => !!id && !publicChannels.has(id)))] : [];
    // Dedicated event channels only: sharing a restricted channel would mix audiences.
    if (wanted.some(id => events.some(other => other.id !== event.id && other.guildId === event.guildId && !other.cleanupDone && [other.announcementChannelId, other.scheduleChannelId].includes(id)))) {
      console.warn(`Event ${event.id}: member channels must not be shared with another event.`);
      return;
    }
    let role = state ? await guild.roles.fetch(state.roleId) : null;
    if (enabled && !role) {
      role = await guild.roles.create({ name: t(botLocale(), 'discord.event_role', { name: event.name }).slice(0, 100), hoist: true, mentionable: false, permissions: [] });
      state = { roleId: role.id, channels: state?.channels ?? {} };
      await saveEventAccessState(db, event.guildId, event.id, state);
    }
    if (!state) return;
    // Restore only the ViewChannel bits we still own. Preserve intervening admin edits.
    for (const [channelId, originals] of Object.entries(state.channels)) {
      if (wanted.includes(channelId)) continue;
      const channel = await guild.channels.fetch(channelId);
      if (channel && 'permissionOverwrites' in channel) {
        for (const [id, original] of Object.entries(originals).sort(([a], [b]) => a === bot.id ? 1 : b === bot.id ? -1 : a === guild.id ? -1 : b === guild.id ? 1 : 0)) {
          if (view(channel.permissionOverwrites.cache.get(id)) === original.managed) {
            await channel.permissionOverwrites.edit(id, { ViewChannel: original.before }, { type: original.type });
          }
        }
      }
      delete state.channels[channelId];
      await saveEventAccessState(db, event.guildId, event.id, state);
    }
    if (!enabled) {
      if (role) await role.delete();
      await clearEventAccessState(db, event.guildId, event.id);
      return;
    }
    for (const channelId of wanted) {
      const channel = await guild.channels.fetch(channelId);
      if (!channel || !('permissionOverwrites' in channel)) continue;
      // Give the bot explicit access before denying everyone, and restore it last.
      const targets = new Map<string, { type: 0 | 1; value: boolean | null }>();
      targets.set(bot.id, { type: 1, value: true });
      targets.set(state.roleId, { type: 0, value: true });
      for (const overwrite of channel.permissionOverwrites.cache.values()) {
        if (![bot.id, state.roleId, guild.id].includes(overwrite.id)) targets.set(overwrite.id, { type: overwrite.type, value: null });
      }
      targets.set(guild.id, { type: 0, value: false });
      const originals = state.channels[channelId] ??= {};
      for (const [id, target] of targets) {
        const before = view(channel.permissionOverwrites.cache.get(id));
        if (!originals[id]) originals[id] = { type: target.type, before, managed: target.value };
        else originals[id]!.managed = target.value;
      }
      // Persist the restoration record before touching Discord.
      await saveEventAccessState(db, event.guildId, event.id, state);
      for (const [id, target] of targets) if (view(channel.permissionOverwrites.cache.get(id)) !== target.value) {
        await channel.permissionOverwrites.edit(id, { ViewChannel: target.value }, { type: target.type });
      }
    }
    const eligible = new Set<string>();
    if (event.startsAt !== null && event.startsAt <= now) {
      for (const person of await listParticipants(db, event.id, 'active')) {
        if (await eligibleParticipant(db, event.id, person.userId, true)) eligible.add(person.userId);
      }
    }
    const members = await guild.members.fetch();
    for (const member of members.values()) {
      if (eligible.has(member.id) && !member.roles.cache.has(state.roleId)) await member.roles.add(state.roleId);
      else if (!eligible.has(member.id) && member.roles.cache.has(state.roleId)) await member.roles.remove(state.roleId);
    }
  } finally { running.delete(event.id); }
}
