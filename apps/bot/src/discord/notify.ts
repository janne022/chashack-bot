/**
 * Notifications: post announcements to the event panel channel and optionally
 * DM all active participants. Also manages Discord scheduled events for the
 * hackathon event and runs the maintenance planner (reminders, auto-end,
 * cleanup).
 */
import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, type Client } from 'discord.js';
import type { Db } from '../shared/db.js';
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
  type HackathonEvent,
  type ScheduleItem,
} from '../features/events/data.js';
import type { KyselyDb } from '../shared/kysely.js';
import { listParticipants } from '../features/signup/data.js';
import { listTeams, deleteEventTeams } from '../features/teams/data.js';
import { previewMatch, commitMatch } from '../features/matching/data.js';
import { DEFAULT_FORM } from '../features/form/domain.js';
import { destroyTeamSpace, botLocale } from './provision.js';
import { postOrUpdatePanel } from './signup-panel.js';
import { t } from '../shared/i18n.js';

export interface NotifyDeps {
  db: Db;
  client: Client;
  kysely?: KyselyDb;
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
    const next = [...event.schedule].sort((a,b)=>a.time-b.time).slice(0,3).map(s=> `• <t:${Math.floor(s.time/1000)}:t> ${s.title}`).join('\n')
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
  const channelId = overrideChannelId ?? event.announcementChannelId ?? event.panelChannelId ?? readGuildPanel(db, event.guildId)
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
    const participants = listParticipants(db, event.id, 'active');
    const renderedDM = renderTags(event, title, message)
    const embed = buildAnnouncementEmbed(event, renderedDM.title, renderedDM.message);
    for (const p of participants) {
      try {
        const user = await client.users.fetch(p.userId);
        await user.send({ embeds: [embed] });
        dmSent++;
      } catch {
        dmFailed++;
      }
    }
  }

  audit(db, actor, 'announce.send', event.id, { title, posted, dmSent, dmFailed });
  return { posted, reason, channelId, dmSent, dmFailed };
}

function readGuildPanel(db: Db, guildId: string): string | null {
  const row = db.prepare("SELECT value FROM meta WHERE key = ?").get(`signup_panel:${guildId}`) as
    | { value: string }
    | undefined;
  if (row === undefined) return null;
  try {
    return (JSON.parse(row.value) as { channelId: string }).channelId;
  } catch {
    return null;
  }
}

// ─── Discord scheduled events ────────────────────────────────────────────────

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
    updateEvent(db, actor, event.id, {
      discordEventIds: [...event.discordEventIds, ...created.map((c) => c.id)],
    });
    audit(db, actor, 'discord_events.create', event.id, { count: created.length });
  }
  return { created, errors };
}

// ─── maintenance executor ────────────────────────────────────────────────────

/**
 * Run one maintenance pass over all guilds: 24h reminders, auto-end,
 * post-event cleanup. Returns a human summary (also logged). Called on an
 * interval from index.ts.
 */
export async function runMaintenance(deps: NotifyDeps): Promise<string[]> {
  const { db, client, kysely } = deps;
  const locale = botLocale();
  const now = Date.now();
  const summary: string[] = [];

  // Collect all events (typed Kysely read when the instance is wired).
  let allEvents: HackathonEvent[];
  if (kysely !== undefined) {
    const { listEventsForMaintenance } = await import('../features/events/data.js');
    allEvents = await listEventsForMaintenance(kysely);
  } else {
    allEvents = [];
    const guildRows = db.prepare('SELECT DISTINCT guild_id FROM events').all() as unknown as { guild_id: string }[];
    for (const { guild_id } of guildRows) {
      allEvents.push(...listEvents(db, guild_id));
    }
  }
  const actions = planMaintenance(allEvents, now);
  if (actions.length === 0) return summary;

  for (const action of actions) {
    const event = getEventRef(db, action.eventId);
    if (event === null) continue;
    try {
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
          const channelId = event.panelChannelId ?? readGuildPanel(db, event.guildId);
          if (channelId !== null && isSnowflake(event.guildId)) {
            const guild = await client.guilds.fetch(event.guildId);
            const channel = await guild.channels.fetch(channelId).catch(() => null);
            if (channel !== null && channel.isTextBased()) await channel.send({ embeds: [embed] });
          } else if (channelId !== null) {
            warnInvalidGuild(event.guildId, 'remind_24h');
          }
          // DM participants
          for (const p of listParticipants(db, event.id, 'active')) {
            await client.users.fetch(p.userId).then((u) => u.send({ embeds: [embed] })).catch(() => undefined);
          }
          if (kysely !== undefined) {
            const { markReminded24h } = await import('../features/events/data.js');
            await markReminded24h(kysely, event.id);
          } else {
            db.prepare('UPDATE events SET reminded_24h = 1, updated_at = ? WHERE id = ?').run(Date.now(), event.id);
          }
          audit(db, 'system', 'event.remind_24h', event.id, null);
          summary.push(`reminded: ${event.name}`);
          break;
        }
        case 'end_event': {
          await endEvent(db, 'system', event.id);
          const channelId = event.panelChannelId ?? readGuildPanel(db, event.guildId);
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
          const teams2 = listTeams(db, event.id);
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
          markCleanupWarned(db, event.id, hoursLeft > 24 ? '72h' : '24h');
          audit(db, 'system', 'event.cleanup_warn', event.id, { hoursLeft, teams: teams2.length });
          summary.push(`cleanup warning (${hoursLeft}h): ${event.name}`);
          break;
        }
        case 'cleanup': {
          const teams = listTeams(db, event.id);
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
          deleteEventTeams(db, 'system', event.id);
          if (kysely !== undefined) {
            const { markCleanupDone } = await import('../features/events/data.js');
            await markCleanupDone(kysely, event.id);
          } else {
            db.prepare('UPDATE events SET cleanup_done = 1, updated_at = ? WHERE id = ?').run(Date.now(), event.id);
          }
          audit(db, 'system', 'event.cleanup', event.id, { teams: teams.length });
          summary.push(`cleaned up: ${event.name} (${teams.length} team spaces)`);
          break;
        }
        case 'auto_match': {
          // Scheduled auto-match: run matching, lock teams, announce. If the
          // match itself fails (e.g. not enough opt-ins) we still lock so a
          // broken schedule can't re-fire every tick — check the logs.
          const config = getEventFormLocal(db, event);
          const preview = previewMatch(db, event.id, config);
          if (!preview.ok) {
            console.warn(`auto_match for ${event.name} failed: ${preview.code} — ${preview.message} (marking locked anyway)`);
            summary.push(`auto-match failed (${preview.code}), locked anyway: ${event.name}`);
          } else {
            commitMatch(db, 'system', event.id, event.guildId, config);
            summary.push(`auto-matched: ${event.name} (${preview.value.teams.length} teams)`);
          }
          markMatchLocked(db, event.id);
          audit(db, 'system', 'event.auto_match', event.id, { ok: preview.ok, code: preview.ok ? undefined : preview.code });
          const autoChannelId = event.panelChannelId ?? readGuildPanel(db, event.guildId);
          if (autoChannelId !== null && isSnowflake(event.guildId)) {
            const guild = await client.guilds.fetch(event.guildId).catch(() => null);
            const channel = guild !== null ? await guild.channels.fetch(autoChannelId).catch(() => null) : null;
            if (channel !== null && channel.isTextBased()) {
              const locale = botLocale();
              const lines =
                preview.ok
                  ? preview.value.teams
                      .map((t) => `**${t.name}** — ${t.memberIds.map((id) => `<@${id}>`).join(', ')}`)
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
          const scheduleId = (action as { type: 'schedule'; eventId: string; scheduleId: string }).scheduleId
          const item = event.schedule.find(s => s.id === scheduleId)
          if (!item) { markScheduleAnnounced(db, event.id, scheduleId); break }
          const channelId = event.announcementChannelId ?? event.panelChannelId ?? readGuildPanel(db, event.guildId)
          if (channelId === null || !isSnowflake(event.guildId) || !isSnowflake(channelId)) {
            if (channelId !== null) warnInvalidGuild(event.guildId, 'schedule')
            markScheduleAnnounced(db, event.id, scheduleId)
            audit(db, 'system', 'schedule.skipped', event.id, { scheduleId, reason: 'no_channel' })
            break
          }
          // Prefer per-block Zapier actions if present, else global schedule announcement templates
          const perBlockActions = (item.actions ?? []).filter(a=>a.type==='announce')
          const globalAnns = (event.announcements ?? []).filter(a => a.trigger === 'schedule')
          const toSend: { title: string; message: string; channelId?: string | null }[] =
            perBlockActions.length > 0 ? perBlockActions.map(a=>({ title: a.title, message: a.message, channelId: a.channelId ?? null }))
            : globalAnns.length > 0 ? globalAnns.map(a=>({ title: a.title, message: a.message, channelId: a.channelId ?? null }))
            : [{ title: item.title, message: '⏰ **{schedule_title}** — {schedule_desc} {everyone}', channelId: null }]
          try {
            const guild = await client.guilds.fetch(event.guildId)
            const baseChannel = await guild.channels.fetch(channelId).catch(()=>null)
            if (baseChannel === null || !baseChannel.isTextBased()) { markScheduleAnnounced(db, event.id, scheduleId); break }
            for (const tpl of toSend.slice(0,5)) {
              const targetId = tpl.channelId && isSnowflake(tpl.channelId) ? tpl.channelId : channelId
              const target = targetId === channelId ? baseChannel : await guild.channels.fetch(targetId).catch(()=>null)
              if (target === null || !target.isTextBased()) continue
              const rendered = renderTags(event, tpl.title, tpl.message, item)
              const embed = new EmbedBuilder().setTitle(rendered.title).setDescription(rendered.message).setColor(item.kind==='food' ? 0x57f287 : item.kind==='break' ? 0xfaa61a : item.kind==='voting' ? 0x5865f2 : item.kind==='prize' ? 0xf0b429 : 0x5865f2)
                .setFooter({ text: `${event.name} · <t:${Math.floor(item.time/1000)}:F>` })
              const payload: { embeds: EmbedBuilder[]; content?: string; allowedMentions?: { parse: ("everyone" | "users" | "roles")[] } } = { embeds: [embed] }
              if (rendered.hasEveryone || rendered.hasHere) { payload.content = rendered.message; payload.allowedMentions = { parse: ["everyone"] } }
              await target.send(payload as never)
            }
            audit(db, 'system', 'schedule.announce', event.id, { scheduleId, title: item.title, count: toSend.length })
            summary.push(`schedule: ${event.name} — ${item.title}`)
          } catch (e) { console.warn('schedule announce failed', e) }
          markScheduleAnnounced(db, event.id, scheduleId)
          break;
        }
      }
    } catch (error) {
      console.error(`maintenance ${action.type} failed for ${action.eventId}:`, error);
    }
  }
  return summary;
}

function getEventRef(db: Db, eventId: string): HackathonEvent | null {
  return getEvent(db, eventId);
}

/** The event's form config (falls back to the guild default). */
function getEventFormLocal(db: Db, event: { id: string; formJson: string | null }): import('../features/form/domain.js').FormConfig {
  return getEventForm(db, { id: event.id, formJson: event.formJson } as never, DEFAULT_FORM);
}

/** Panel helper re-export for index.ts wiring. */
export { postOrUpdatePanel, getActiveEvent };
