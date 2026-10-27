import { reconcileEventDelivery } from './event-delivery.js';
import { syncEventAccess } from './event-access.js';
/**
 * Notifications: post announcements to the event panel channel and optionally
 * DM all active participants. Also manages Discord scheduled events for the
 * hackathon event and runs the maintenance planner (reminders, auto-end,
 * cleanup).
 */
import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, type Client, type GuildScheduledEvent } from 'discord.js';
import type { Db } from '../shared/db.js';
import { withGuildContext } from '../shared/postgres.js';
import { audit } from '../shared/audit.js';
import {
  getActiveEvent,
  getEvent,
  getEventForm,
  listEvents,
  planMaintenance,
  updateEvent,
  endEvent,
  markCleanupWarned,
  markMatchLocked,
  markScheduleAnnounced,
  renderAnnouncementTags,
  scheduleTimeResolved,
  type HackathonEvent,
  type ScheduleItem,
} from '../features/events/data.js';
import type { KyselyDb } from '../shared/kysely.js';
import { listParticipants } from '../features/signup/data.js';
import { listTeams, getTeam, getGuildSettings, deleteEventTeams } from '../features/teams/data.js';
import { listPendingTeamProvisionIds } from '../features/teams/provision-data.js';
import { previewMatch, commitMatch } from '../features/matching/data.js';
import { DEFAULT_FORM } from '../features/form/domain.js';
import { getForm } from '../features/form/data.js';
import { destroyTeamSpace, botLocale, provisionTeamSpace, grantTeamRole } from './provision.js';
import { getSignupPanelRef, postOrUpdatePanel } from './signup-panel.js';
import { t, t as tl, type BotLocale } from '../shared/i18n.js';
import { isDiscordId } from '../shared/discord-id.js';
import { purgeEventPrivateAnswers, purgeExpiredPrivateAnswers } from '../features/registration/retention.js';
import { purgeImportedSignups } from '../features/signup-import/data.js';
import { reconcileImportedParticipants } from '../features/signup-import/sync.js';
import { retryFailedParticipantRoleRevocations } from '../features/signup/lifecycle.js';
import { pruneResolvedTeamRoleRevocations } from '../features/signup/data.js';

export interface NotifyDeps {
  db: Db;
  client: Client;
  kysely?: KyselyDb;
  now?: number;
}

const SNOWFLAKE_RE = /^[0-9]{17,20}$/;
function isSnowflake(id: string): boolean {
  return SNOWFLAKE_RE.test(id);
}
function warnInvalidGuild(guildId: string, scope: string): boolean {
  if (!isSnowflake(guildId)) {
    console.warn(`${scope}: skipped — DISCORD_GUILD_ID is not set or not a snowflake (got "${guildId}"). Set it in .env.`);
    return true;
  }
  return false;
}

function buildAnnouncementEmbed(event: HackathonEvent, title: string, message: string): EmbedBuilder {
  const locale = botLocale();
  const lines: string[] = [message, ''];
  if (event.startsAt !== null) lines.push(`🗓️ **${t(locale, 'discord.events.starts')}:** <t:${Math.floor(event.startsAt / 1000)}:F> (<t:${Math.floor(event.startsAt / 1000)}:R>)`);
  if (event.endsAt !== null) lines.push(`🏁 **${t(locale, 'discord.events.ends')}:** <t:${Math.floor(event.endsAt / 1000)}:F>`);
  // If schedule exists, include next 3 items in embed footer for context
  if (event.schedule && event.schedule.length > 0) {
    const next = event.schedule.filter(item => scheduleTimeResolved(event, item)).sort((a,b)=>a.time-b.time).slice(0,3).map(s=> `• <t:${Math.floor(s.time/1000)}:t> ${s.title}`).join('\n')
    if (next) lines.push('', '**Schedule:**', next)
  }
  lines.push('', t(locale, 'discord.notify.sign_up_in', { channel: event.panelChannelId ?? '' }));
  return new EmbedBuilder().setTitle(t(locale, 'discord.notify.announce_title_prefix', { title })).setDescription(lines.join('\n')).setColor(0x5865f2);
}

function renderTags(event: HackathonEvent, title: string, message: string, scheduleItem?: ScheduleItem) {
  const rTitle = renderAnnouncementTags(title, event, scheduleItem ? { scheduleItem } : {})
  const rMsg = renderAnnouncementTags(message, event, scheduleItem ? { scheduleItem } : {})
  return { title: rTitle.content, message: rMsg.content, hasEveryone: rTitle.hasEveryone || rMsg.hasEveryone, hasHere: rTitle.hasHere || rMsg.hasHere }
}

/**
 * Send an announcement: posts to the event panel channel and, when enabled,
 * DMs every active participant. Returns delivered stats.
 */
export async function sendAnnouncement(
  deps: NotifyDeps,
  actor: string,
  event: HackathonEvent,
  title: string,
  message: string,
  dmParticipants: boolean,
  overrideChannelId?: string,
): Promise<{ posted: boolean; reason: string; channelId: string | null; dmSent: number; dmFailed: number }> {
  const { client, db } = deps
  let posted = false
  let reason = 'no_channel_configured'

  // 1) Announcement channel (override → event ann channel → panel → guild panel).
  const channelId = overrideChannelId ?? event.announcementChannelId ?? event.panelChannelId ?? await readGuildPanel(db, event.guildId, event.id)
  if (channelId === null) {
    reason = 'no_channel_configured'
  } else if (warnInvalidGuild(event.guildId, 'announcement post')) {
    reason = `guild_invalid: DISCORD_GUILD_ID="${event.guildId}" is not a snowflake — set it in .env and restart`
  } else if (!isSnowflake(channelId)) {
    reason = `channel_invalid: channelId "${channelId}" is not a snowflake — copy #channel ID, not the name`
  } else {
    try {
      const guild = await client.guilds.fetch(event.guildId);
      const channel = await guild.channels.fetch(channelId);
      if (channel === null) {
        reason = `channel_not_found: ${channelId} not found in guild ${event.guildId} — is the ID correct and does the bot have access?`
      } else if (!channel.isTextBased()) {
        reason = `not_text_based: #${channel.name} (${channelId}) is not a text channel`
      } else {
        // Check bot can send there before trying
        const me = guild.members.me
        if (me !== null) {
          const perms = channel.permissionsFor(me)
          if (perms !== null && !perms.has('SendMessages')) {
            reason = `missing_access: bot lacks SendMessages in #${channel.name} (${channelId})`
            console.warn(`announcement: missing SendMessages in #${channel.name} (${channelId})`)
          } else if (perms !== null && !perms.has('ViewChannel')) {
            reason = `missing_access: bot cannot ViewChannel #${channel.name} (${channelId})`
            console.warn(`announcement: missing ViewChannel in #${channel.name} (${channelId})`)
          }
        }
        if (reason === 'guild_invalid' || reason.startsWith('channel_invalid') || reason.startsWith('channel_not_found') || reason.startsWith('not_text_based')) {
          // already set
        } else if (reason.startsWith('missing_access')) {
          // don't try to send
        } else {
          const rendered = renderTags(event, title, message)
          const embed = buildAnnouncementEmbed(event, rendered.title, rendered.message)
          const shouldPing = rendered.hasEveryone || rendered.hasHere
          // Send as content + embed so @everyone/@here actually pings; Discord only pings from content, not embed
          const payload: { embeds: ReturnType<typeof buildAnnouncementEmbed>[]; content?: string; allowedMentions?: { parse: ("everyone" | "users" | "roles")[] } } = { embeds: [embed] }
          if (shouldPing) {
            payload.content = rendered.message
            payload.allowedMentions = { parse: ["everyone"] }
          }
          await channel.send(payload as never);
          posted = true;
          reason = 'ok'
        }
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error)
      // DiscordAPIError usually has code: 50035, 10003, 50013, 50001 etc.
      const raw = (error as Record<string, unknown>)?.code !== undefined ? ` code=${(error as Record<string, unknown>).code}` : ''
      reason = `discord_error${raw}: ${msg}`
      console.warn(`announcement post failed [${channelId}]:`, error);
    }
  }

  // 2) DM blast.
  let dmSent = 0;
  let dmFailed = 0;
  if (dmParticipants) {
    const participants = await listParticipants(db, event.id, 'active');
    const renderedDM = renderTags(event, title, message)
    const embed = buildAnnouncementEmbed(event, renderedDM.title, renderedDM.message);
    for (const p of participants) {
      // An imported signup has no Discord user to DM; it is not a failure.
      if (!isDiscordId(p.userId)) continue;
      try {
        const user = await client.users.fetch(p.userId);
        await user.send({ embeds: [embed] });
        dmSent++;
      } catch {
        dmFailed++;
      }
    }
  }

  await audit(db, actor, 'announce.send', event.id, { title, posted, dmSent, dmFailed }, event.guildId);
  return { posted, reason, channelId, dmSent, dmFailed };
}

async function readGuildPanel(db: Db, guildId: string, eventId: string): Promise<string | null> {
  const { getMessageRef } = await import('../features/events/data.js');
  return (await getSignupPanelRef(db, guildId, eventId))?.channelId ?? (await getMessageRef(db, `signup_panel:${guildId}`))?.channelId ?? null;
}

// ─── Discord scheduled events ────────────────────────────────────────────────

export interface DiscordEventSyncResult {
  created: { id: string; name: string }[];
  updated: { id: string; name: string }[];
  errors: string[];
}

function scheduledEventPayload(event: HackathonEvent, locale: BotLocale) {
  const start = event.startsAt!;
  const fallbackEnd = start + 24 * 3600 * 1000;
  return {
    name: event.name.slice(0, 100),
    description: event.description.slice(0, 1000) || t(locale, 'discord.notify.scheduled_desc_fallback'),
    scheduledStartTime: start,
    scheduledEndTime: event.endsAt !== null && event.endsAt > start ? event.endsAt : fallbackEnd,
    entityMetadata: { location: t(locale, 'discord.notify.location_line') },
  };
}

/**
 * Discord will not create a scheduled event that already started, so a
 * hackathon that is running right now is created as "started a minute ago"
 * instead of not at all. Existing linked events are edited with their real
 * dates — only creation is clamped.
 */
function creatablePayload(payload: ReturnType<typeof scheduledEventPayload>, now: number) {
  const scheduledStartTime = payload.scheduledStartTime > now ? payload.scheduledStartTime : now + 60_000;
  const scheduledEndTime = payload.scheduledEndTime > scheduledStartTime
    ? payload.scheduledEndTime
    : scheduledStartTime + 3_600_000;
  return { ...payload, scheduledStartTime, scheduledEndTime };
}

function discordError(error: unknown): string {
  const code = (error as { code?: unknown })?.code;
  const message = error instanceof Error ? error.message : 'failed';
  return code === undefined ? message : `${message} (code ${String(code)})`;
}

/**
 * Create or update the one Discord scheduled event that represents this
 * hackathon. `discordEventIds[0]` is the canonical link; if Discord reports that
 * id as gone, it is dropped before a replacement is created. Dates come from the
 * hackathon event itself, so a date edit followed by a sync moves the Discord
 * event rather than stacking a second one.
 */
export async function syncDiscordEvent(
  deps: NotifyDeps,
  actor: string,
  event: HackathonEvent,
): Promise<DiscordEventSyncResult> {
  const { client, db } = deps;
  const empty: DiscordEventSyncResult = { created: [], updated: [], errors: [] };
  if (warnInvalidGuild(event.guildId, 'syncDiscordEvent')) {
    return { ...empty, errors: ['DISCORD_GUILD_ID not set — set it in .env'] };
  }
  if (event.startsAt === null) {
    return { ...empty, errors: [t(botLocale(), 'discord.events.needs_start_date')] };
  }
  const guild = await client.guilds.fetch(event.guildId).catch(() => null);
  if (guild === null) return { ...empty, errors: [t(botLocale(), 'discord.events.guild_not_found')] };

  const locale = botLocale();
  const payload = scheduledEventPayload(event, locale);
  const result: DiscordEventSyncResult = { created: [], updated: [], errors: [] };
  let ids = [...event.discordEventIds];

  const existingId = ids[0];
  if (existingId !== undefined) {
    let existing: GuildScheduledEvent | null = null;
    try {
      existing = await guild.scheduledEvents.fetch(existingId);
    } catch (error) {
      if ((error as { code?: unknown })?.code === 10070) {
        ids = ids.filter((id) => id !== existingId);
      } else {
        result.errors.push(discordError(error));
        return result;
      }
    }
    if (existing !== null) {
      try {
        await existing.edit(payload);
        result.updated.push({ id: existingId, name: payload.name });
      } catch (error) {
        // Editing failed; do not create a duplicate on top of the linked event.
        result.errors.push(discordError(error));
        return result;
      }
    }
  }

  if (result.updated.length === 0) {
    try {
      const scheduled = await guild.scheduledEvents.create({
        ...creatablePayload(payload, Date.now()),
        entityType: 3, // External
        privacyLevel: 2, // Guild only
      });
      result.created.push({ id: scheduled.id, name: payload.name });
      ids = [...ids, scheduled.id];
    } catch (error) {
      result.errors.push(discordError(error));
      return result;
    }
  }

  const idsChanged = ids.length !== event.discordEventIds.length || ids.some((id, index) => id !== event.discordEventIds[index]);
  if (idsChanged) await updateEvent(db, actor, event.id, { discordEventIds: ids });
  if (result.created.length > 0 || result.updated.length > 0) {
    await audit(db, actor, result.created.length > 0 ? 'discord_events.create' : 'discord_events.update', event.id, {
      created: result.created.length,
      updated: result.updated.length,
    }, event.guildId);
  }
  return result;
}

export async function createDiscordEvents(
  deps: NotifyDeps,
  actor: string,
  event: HackathonEvent,
  count: number,
  durationHours: number,
): Promise<{ created: { id: string; name: string }[]; errors: string[] }> {
  const { client, db } = deps;
  if (warnInvalidGuild(event.guildId, 'createDiscordEvents')) {
    return { created: [], errors: ['DISCORD_GUILD_ID not set — set it in .env'] };
  }
  const guild = await client.guilds.fetch(event.guildId).catch(() => null);
  if (guild === null) return { created: [], errors: [t(botLocale(), 'discord.events.guild_not_found')] };

  const created: { id: string; name: string }[] = [];
  const errors: string[] = [];
  const baseStart = event.startsAt ?? Date.now() + 24 * 3600 * 1000;
  const day = 24 * 3600 * 1000;
  const locale = botLocale();

  for (let i = 0; i < Math.min(Math.max(count, 1), 10); i++) {
    const start = baseStart + i * day;
    const name = count > 1 ? t(locale, 'discord.notify.day_n', { name: event.name, n: i + 1 }) : event.name;
    try {
      const scheduled = await guild.scheduledEvents.create({
        name: name.slice(0, 100),
        description: event.description.slice(0, 1000) || t(locale, 'discord.notify.scheduled_desc_fallback'),
        scheduledStartTime: start,
        scheduledEndTime: start + durationHours * 3600 * 1000,
        entityType: 3, // External
        privacyLevel: 2, // Guild only
        entityMetadata: { location: t(locale, 'discord.notify.location_line') },
      });
      created.push({ id: scheduled.id, name });
    } catch (error) {
      errors.push(`Day ${i + 1}: ${error instanceof Error ? error.message : 'failed'}`);
    }
  }

  if (created.length > 0) {
    await updateEvent(db, actor, event.id, {
      discordEventIds: [...event.discordEventIds, ...created.map((c) => c.id)],
    });
    await audit(db, actor, 'discord_events.create', event.id, { count: created.length }, event.guildId);
  }
  return { created, errors };
}

// ─── maintenance executor ────────────────────────────────────────────────────

/**
 * Active hackathons should always carry a Discord scheduled event. Creation
 * normally happens when the event is created, launched or edited, so this is
 * the catch-up path for events that went live while the bot was offline, were
 * created before the feature existed, or were created without the option.
 *
 * Failures (missing permission, guild gone) do not fix themselves in five
 * minutes, so a failed attempt is retried hourly instead of every pass.
 */
const DISCORD_EVENT_RETRY_MS = 60 * 60 * 1000;
const discordEventRetryAt = new Map<string, number>();

/**
 * Run one maintenance pass over all guilds: 24h reminders, auto-end,
 * post-event cleanup. Returns a human summary (also logged). Called on an
 * interval from index.ts.
 */
export async function runMaintenance(deps: NotifyDeps): Promise<string[]> {
  const { db, client, kysely } = deps;
  const locale = botLocale();
  const now = deps.now ?? Date.now();
  const summary: string[] = [];

  // System maintenance enumerates installed guilds, then uses ordinary tenant-scoped reads.
  const guildIds = [...client.guilds.cache.values()].filter((guild) => guild.available !== false).map((guild) => guild.id);
  for (const guildId of guildIds) {
    const retry = await withGuildContext(db, guildId, () => retryFailedParticipantRoleRevocations(db, guildId, async (targetGuildId, userId, roleId) => {
      if (targetGuildId !== guildId) throw new Error('role retry guild mismatch');
      const guild = client.guilds.cache.get(guildId);
      if (!guild) throw new Error('guild unavailable');
      const role = await guild.roles.fetch(roleId).catch((error) => {
        if ((error as { code?: number }).code === 10011) return null;
        throw error;
      });
      if (role === null) return;
      const member = await guild.members.fetch(userId).catch((error) => {
        if ((error as { code?: number }).code === 10007) return null;
        throw error;
      });
      if (member !== null && member.roles.cache.has(roleId)) await member.roles.remove(roleId, 'Retry failed participant team role revocation');
    }));
    if (retry.succeeded > 0 || retry.attempted > retry.succeeded) summary.push(`team role revocations retried in ${guildId}: ${retry.succeeded}/${retry.attempted} succeeded`);
    const prunedRevocations = await withGuildContext(db, guildId, () => pruneResolvedTeamRoleRevocations(db, guildId));
    if (prunedRevocations > 0) summary.push(`pruned ${prunedRevocations} resolved team role revocation records in ${guildId}`);
  }
  const allEvents: HackathonEvent[] = [];
  for (const guildId of guildIds) allEvents.push(...await withGuildContext(db, guildId, () => listEvents(db, guildId)));
  // Backfill: imported signups are participants, even ones imported before this
  // feature shipped or whose reconcile step was missed. Idempotent.
  for (const event of allEvents) {
    try {
      await withGuildContext(db, event.guildId, async () => {
        const count = await db.get<{ n: number }>('SELECT COUNT(*) AS n FROM imported_signups WHERE event_id=?', event.id);
        if (!count || count.n === 0) return;
        const form = await getForm(db, event.guildId);
        const eventForm = getEventForm(db, event, form);
        await reconcileImportedParticipants(db, event.id, event.guildId, eventForm);
      });
    } catch (error) {
      console.warn(`Imported participant backfill failed for ${event.id}:`, error);
    }
  }
  for (const event of allEvents) {
    await withGuildContext(db, event.guildId, async () => {
      try { await reconcileEventDelivery(db, client, event, now); }
      catch (error) { console.warn(`Event delivery sync failed for ${event.id}:`, error); }
      try { await syncEventAccess(db, client, event.guildId, event.id, now); }
      catch (error) { console.warn(`Event access sync failed for ${event.id}:`, error); }
      if (event.status === 'active' && event.discordEventIds.length === 0 && event.startsAt !== null) {
        const alreadyOver = event.endsAt !== null && event.endsAt <= now;
        const retryAt = discordEventRetryAt.get(event.id) ?? 0;
        if (!alreadyOver && retryAt <= now) {
          // Concurrent passes must not each create one: re-read under the lock.
          await db.tryAdvisoryLock(`discord-event:${event.guildId}:${event.id}`, async () => {
            const current = await getEvent(db, event.id);
            if (current === null || current.status !== 'active' || current.discordEventIds.length > 0 || current.startsAt === null) return;
            try {
              const linked = await syncDiscordEvent(deps, 'system', current);
              if (linked.created.length > 0) {
                discordEventRetryAt.delete(event.id);
                summary.push(`created the Discord scheduled event for ${current.name}`);
              } else if (linked.errors.length > 0) {
                discordEventRetryAt.set(event.id, now + DISCORD_EVENT_RETRY_MS);
                console.warn(`Discord scheduled event for ${event.id} not created: ${linked.errors.join('; ')}`);
              }
            } catch (error) {
              discordEventRetryAt.set(event.id, now + DISCORD_EVENT_RETRY_MS);
              console.warn(`Discord scheduled event for ${event.id} not created:`, error);
            }
          });
        }
      }
      try {
        const current = await getEvent(db, event.id);
        if (current?.status === 'active' && (current.endsAt === null || current.endsAt > now)) {
          const pending = await listPendingTeamProvisionIds(db, current.id);
          if (pending.length > 0) {
            let fallback: string | undefined;
            try { fallback = (await import('../shared/env.js')).env().teamCategoryId; } catch { /* no runtime environment in fixtures */ }
            const category = current.categoryId ?? (await getGuildSettings(db, current.guildId)).teamCategoryId ?? fallback;
            const provisionDeps = { db, client, categoryIdFor: () => category ?? undefined };
            for (const id of pending) {
              try {
                const team = await getTeam(db, id);
                if (team && team.eventId === current.id && team.guildId === current.guildId) await provisionTeamSpace(provisionDeps, team);
              } catch (error) { console.warn(`Team provisioning recovery failed for ${id}:`, error); }
            }
          }
        }
      } catch (error) { console.warn(`Team provisioning recovery failed for ${event.id}:`, error); }
    });
  }
  const actions = planMaintenance(allEvents, now);
  for (const guildId of guildIds) {
    for (const eventId of await withGuildContext(db, guildId, () => purgeExpiredPrivateAnswers(db, now))) summary.push(`purged private answers: ${eventId}`);
  }
  if (actions.length === 0) return summary;

  for (const planned of actions) {
    const snapshot = allEvents.find((candidate) => candidate.id === planned.eventId) ?? null;
    if (snapshot === null) continue;
    await withGuildContext(db, snapshot.guildId, async () => {
    let needsProvisioning = false;
    await db.tryAdvisoryLock(`event-maintenance:${snapshot.guildId}:${snapshot.id}`, async () => {
    try {
      const event = await getEvent(db, snapshot.id);
      if (!event || event.guildId !== snapshot.guildId) return;
      const action = planMaintenance([event], now).find(candidate =>
        candidate.type === planned.type && (candidate.type !== 'schedule' ||
          (planned.type === 'schedule' && candidate.scheduleId === planned.scheduleId)));
      if (!action) return;
      switch (action.type) {
        case 'remind_24h': {
          const embed = new EmbedBuilder()
            .setTitle(t(locale, 'discord.notify.remind_title'))
            .setDescription(
              [
                t(locale, 'discord.notify.remind_kickoff', { name: event.name, ts: event.startsAt !== null ? Math.floor(event.startsAt / 1000) : 0 }),
                event.panelChannelId !== null ? t(locale, 'discord.notify.remind_signup', { channel: event.panelChannelId }) : '',
                t(locale, 'discord.notify.remind_teams_line'),
              ]
                .filter((l) => l !== '')
                .join('\n'),
            )
            .setColor(0xfaa61a);
          const channelId = event.panelChannelId ?? await readGuildPanel(db, event.guildId, event.id);
          if (channelId !== null && isSnowflake(event.guildId)) {
            const guild = await client.guilds.fetch(event.guildId);
            const channel = await guild.channels.fetch(channelId).catch(() => null);
            if (channel !== null && channel.isTextBased()) await channel.send({ embeds: [embed] });
          } else if (channelId !== null) {
            warnInvalidGuild(event.guildId, 'remind_24h');
          }
          // DM participants (an imported signup has no inbox to reach)
          for (const p of await listParticipants(db, event.id, 'active')) {
            if (!isDiscordId(p.userId)) continue;
            await client.users.fetch(p.userId).then((u) => u.send({ embeds: [embed] })).catch(() => undefined);
          }
          if (kysely !== undefined) {
            const { markReminded24h } = await import('../features/events/data.js');
            await markReminded24h(kysely, event.id);
          } else {
            const { markMaintenanceDone } = await import('../features/events/data.js');
            await markMaintenanceDone(db, event.id, 'reminded_24h');
          }
          await audit(db, 'system', 'event.remind_24h', event.id, null, event.guildId);
          summary.push(`reminded: ${event.name}`);
          break;
        }
        case 'end_event': {
          await endEvent(db, 'system', event.id);
          const channelId = event.panelChannelId ?? await readGuildPanel(db, event.guildId, event.id);
          if (channelId !== null && isSnowflake(event.guildId)) {
            const guild = await client.guilds.fetch(event.guildId);
            const channel = await guild.channels.fetch(channelId).catch(() => null);
            if (channel !== null && channel.isTextBased()) {
              await channel.send({
                embeds: [
                  new EmbedBuilder()
                    .setTitle(t(locale, 'discord.notify.ended_title', { name: event.name }))
                    .setDescription(
                      t(locale, 'discord.notify.ended_body', { hours: event.cleanupDelayHours }),
                    )
                    .setColor(0xed4245),
                ],
              });
            }
          } else if (channelId !== null) {
            warnInvalidGuild(event.guildId, 'end_event');
          }
          summary.push(`ended: ${event.name}`);
          break;
        }
        case 'cleanup_warn': {
          // Grace-window notice: channels stay up so people can grab photos.
          const hoursLeft = action.hoursLeft;
          const teams2 = await listTeams(db, event.id);
          if (!isSnowflake(event.guildId)) {
            warnInvalidGuild(event.guildId, 'cleanup_warn');
          } else {
            const provisionDepsW = { db, client, categoryIdFor: () => event.categoryId ?? undefined };
            for (const team of teams2) {
              if (team.textChannelId === null) continue;
              try {
                const g = await client.guilds.fetch(event.guildId);
                const ch = await g.channels.fetch(team.textChannelId).catch(() => null);
                if (ch !== null && ch.isTextBased()) {
                  await ch.send({
                    embeds: [
                      new EmbedBuilder()
                        .setTitle(t(locale, 'discord.notify.cleanup_title', { hours: hoursLeft }))
                        .setDescription(
                          [
                            t(locale, 'discord.notify.cleanup_body', { name: event.name }),
                            '',
                            t(locale, 'discord.notify.cleanup_grab'),
                            t(locale, 'discord.notify.cleanup_extend', { hours: event.cleanupDelayHours }),
                          ].join('\n'),
                        )
                        .setColor(0xf0b429),
                    ],
                  });
                }
              } catch (err2) {
                console.warn('cleanup warn post failed:', err2);
              }
            }
          }
          await markCleanupWarned(db, event.id, hoursLeft > 24 ? '72h' : '24h');
          await audit(db, 'system', 'event.cleanup_warn', event.id, { hoursLeft, teams: teams2.length }, event.guildId);
          summary.push(`cleanup warning (${hoursLeft}h): ${event.name}`);
          break;
        }
        case 'cleanup': {
          await purgeEventPrivateAnswers(db, event.id, now);
          await purgeImportedSignups(db, event.id);
          const teams = await listTeams(db, event.id);
          const provisionDeps = { db, client, categoryIdFor: () => event.categoryId ?? undefined };
          for (const team of teams) {
            await destroyTeamSpace(provisionDeps, team);
          }
          // Cancel linked Discord scheduled events.
          if (isSnowflake(event.guildId)) {
            const guild = await client.guilds.fetch(event.guildId).catch(() => null);
            if (guild !== null) {
              for (const seId of event.discordEventIds) {
                await guild.scheduledEvents.delete(seId).catch(() => undefined);
              }
            }
          } else {
            warnInvalidGuild(event.guildId, 'cleanup');
          }
          await deleteEventTeams(db, 'system', event.id);
          if (kysely !== undefined) {
            const { markCleanupDone } = await import('../features/events/data.js');
            await markCleanupDone(kysely, event.id);
          } else {
            const { markMaintenanceDone } = await import('../features/events/data.js');
            await markMaintenanceDone(db, event.id, 'cleanup_done');
          }
          await audit(db, 'system', 'event.cleanup', event.id, { teams: teams.length }, event.guildId);
          summary.push(`cleaned up: ${event.name} (${teams.length} team spaces)`);
          break;
        }
        case 'auto_match': {
          // Scheduled auto-match: run matching, lock teams, announce. If the
          // match itself fails (e.g. not enough opt-ins) we still lock so a
          // broken schedule can't re-fire every tick — check the logs.
          const config = getEventFormLocal(db, event);
          const preview = await previewMatch(db, event.id, config);
          if (!preview.ok) {
            console.warn(`auto_match for ${event.name} failed: ${preview.code} — ${preview.message} (marking locked anyway)`);
            summary.push(`auto-match failed (${preview.code}), locked anyway: ${event.name}`);
          } else {
            const committed = await commitMatch(db, 'system', event.id, event.guildId, config);
            if (committed.ok) needsProvisioning = true;
            summary.push(`auto-matched: ${event.name} (${preview.value.teams.length} teams)`);
          }
          await markMatchLocked(db, event.id);
          await audit(db, 'system', 'event.auto_match', event.id, { ok: preview.ok, code: preview.ok ? undefined : preview.code }, event.guildId);
          const autoChannelId = event.panelChannelId ?? await readGuildPanel(db, event.guildId, event.id);
          if (autoChannelId !== null && isSnowflake(event.guildId)) {
            const guild = await client.guilds.fetch(event.guildId).catch(() => null);
            const channel = guild !== null ? await guild.channels.fetch(autoChannelId).catch(() => null) : null;
            if (channel !== null && channel.isTextBased()) {
              const locale = botLocale();
              const lines =
                preview.ok
                  ? preview.value.teams
                      .map((t) => `**${t.name}** — ${t.memberIds.map((id) => isDiscordId(id) ? `<@${id}>` : tl(locale, 'discord.events.imported_member')).join(', ')}`)
                      .join('\n')
                  : '';
              await channel
                .send({
                  embeds: [
                    new EmbedBuilder()
                      .setTitle(t(locale, 'discord.notify.auto_match_locked_title', { name: event.name }))
                      .setDescription(
                        [
                          lines !== '' ? lines : t(locale, 'discord.notify.auto_match_failed_body'),
                          '',
                          t(locale, 'discord.notify.auto_match_late_body'),
                        ]
                          .filter((l) => l !== '')
                          .join('\n'),
                      )
                      .setColor(0x57f287),
                  ],
                })
                .catch((err2) => console.warn('auto_match announcement failed:', err2));
            }
          }
          break;
        }
        case 'schedule': {
          const item = event.schedule.find(item => item.id === action.scheduleId);
          if (!item) break;
          // Repeatable messages and handouts are reconciled separately, with persisted delivery IDs.
          for (const op of item.actions ?? []) {
            if (op.type === 'lock_teams') await markMatchLocked(db, event.id);
            else if (op.type === 'auto_match' || op.type === 'assign_random') {
              const config = getEventFormLocal(db, event);
              const preview = await previewMatch(db, event.id, config);
              if (!preview.ok) throw new Error(preview.message);
              const result = await commitMatch(db, 'system', event.id, event.guildId, config);
              if (!result.ok) throw new Error(result.message);
              needsProvisioning = true;
              await markMatchLocked(db, event.id);
            }
          }
          await markScheduleAnnounced(db, event.id, item.id);
          break;
        }
      }
    } catch (error) {
      console.error(`maintenance ${planned.type} failed for ${planned.eventId}:`, error);
    }
    });
    if (needsProvisioning) {
      const current = await getEvent(db, snapshot.id);
      if (current?.status === 'active' && (current.endsAt === null || current.endsAt > now)) {
        try { await provisionMatchedTeams(db, client, current); }
        catch (error) { console.warn(`Matched-team provisioning failed for ${current.id}; maintenance will retry:`, error); }
      }
    }
    });
  }
  return summary;
}


/** The event's form config (falls back to the guild default). */
function getEventFormLocal(db: Db, event: { id: string; formJson: string | null }): import('../features/form/domain.js').FormConfig {
  return getEventForm(db, { id: event.id, formJson: event.formJson } as never, DEFAULT_FORM);
}

/** Panel helper re-export for index.ts wiring. */
export { postOrUpdatePanel, getActiveEvent };

async function provisionMatchedTeams(db: Db, client: Client, event: HackathonEvent): Promise<void> {
  const deps = { db, client, categoryIdFor: () => event.categoryId ?? undefined };
  for (const team of (await listTeams(db, event.id)).filter(team => team.kind === 'matched')) {
    const provisioned = await provisionTeamSpace(deps, team);
    for (const member of team.members) await grantTeamRole(deps, provisioned, member.userId);
  }
}
