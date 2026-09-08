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
  type HackathonEvent,
} from '../features/events/data.js';
import type { KyselyDb } from '../shared/kysely.js';
import { listParticipants } from '../features/signup/data.js';
import { listTeams, deleteEventTeams } from '../features/teams/data.js';
import { previewMatch, commitMatch } from '../features/matching/data.js';
import { DEFAULT_FORM } from '../features/form/domain.js';
import { destroyTeamSpace } from './provision.js';
import { postOrUpdatePanel } from './signup-panel.js';

export interface NotifyDeps {
  db: Db;
  client: Client;
  kysely?: KyselyDb;
}

function buildAnnouncementEmbed(event: HackathonEvent, title: string, message: string): EmbedBuilder {
  const lines: string[] = [message, ''];
  if (event.startsAt !== null) lines.push(`🗓️ **Starts:** <t:${Math.floor(event.startsAt / 1000)}:F> (<t:${Math.floor(event.startsAt / 1000)}:R>)`);
  if (event.endsAt !== null) lines.push(`🏁 **Ends:** <t:${Math.floor(event.endsAt / 1000)}:F>`);
  lines.push('', `Sign up in <#${event.panelChannelId ?? ''}> when it is live — or with \`/hackathon join\`.`);
  return new EmbedBuilder().setTitle(`📣 ${title}`).setDescription(lines.join('\n')).setColor(0x5865f2);
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
): Promise<{ posted: boolean; dmSent: number; dmFailed: number }> {
  const { client, db } = deps;
  let posted = false;

  // 1) Panel channel post (event panel channel, falling back to the guild panel).
  const channelId = event.panelChannelId ?? readGuildPanel(db, event.guildId);
  if (channelId !== null) {
    try {
      const guild = await client.guilds.fetch(event.guildId);
      const channel = await guild.channels.fetch(channelId);
      if (channel !== null && channel.isTextBased()) {
        await channel.send({ embeds: [buildAnnouncementEmbed(event, title, message)] });
        posted = true;
      }
    } catch (error) {
      console.warn('announcement post failed:', error);
    }
  }

  // 2) DM blast.
  let dmSent = 0;
  let dmFailed = 0;
  if (dmParticipants) {
    const participants = listParticipants(db, event.id, 'active');
    const embed = buildAnnouncementEmbed(event, title, message);
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
  return { posted, dmSent, dmFailed };
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
  const guild = await client.guilds.fetch(event.guildId).catch(() => null);
  if (guild === null) return { created: [], errors: ['Guild not found.'] };

  const created: { id: string; name: string }[] = [];
  const errors: string[] = [];
  const baseStart = event.startsAt ?? Date.now() + 24 * 3600 * 1000;
  const day = 24 * 3600 * 1000;

  for (let i = 0; i < Math.min(Math.max(count, 1), 10); i++) {
    const start = baseStart + i * day;
    const name = count > 1 ? `${event.name} — Day ${i + 1}` : event.name;
    try {
      const scheduled = await guild.scheduledEvents.create({
        name: name.slice(0, 100),
        description: event.description.slice(0, 1000) || 'Hackathon event',
        scheduledStartTime: start,
        scheduledEndTime: start + durationHours * 3600 * 1000,
        entityType: 3, // External
        privacyLevel: 2, // Guild only
        entityMetadata: { location: 'Discord — see the event channels' },
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
            .setTitle('⏰ Starts in less than 24 hours!')
            .setDescription(
              [
                `**${event.name}** kicks off <t:${event.startsAt !== null ? Math.floor(event.startsAt / 1000) : 0}:R>.`,
                event.panelChannelId !== null ? `Sign up in <#${event.panelChannelId}> if you have not yet.` : '',
                'Teams get their private channels as soon as they are created or matched.',
              ]
                .filter((l) => l !== '')
                .join('\n'),
            )
            .setColor(0xfaa61a);
          const channelId = event.panelChannelId ?? readGuildPanel(db, event.guildId);
          if (channelId !== null) {
            const guild = await client.guilds.fetch(event.guildId);
            const channel = await guild.channels.fetch(channelId).catch(() => null);
            if (channel !== null && channel.isTextBased()) await channel.send({ embeds: [embed] });
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
          if (channelId !== null) {
            const guild = await client.guilds.fetch(event.guildId);
            const channel = await guild.channels.fetch(channelId).catch(() => null);
            if (channel !== null && channel.isTextBased()) {
              await channel.send({
                embeds: [
                  new EmbedBuilder()
                    .setTitle(`🏁 **${event.name}** has ended!`)
                    .setDescription(
                      `Thanks for hacking with us. Team channels and roles will be cleaned up ${event.cleanupDelayHours}h after the end — export anything you want to keep.`,
                    )
                    .setColor(0xed4245),
                ],
              });
            }
          }
          summary.push(`ended: ${event.name}`);
          break;
        }
        case 'cleanup_warn': {
          // Grace-window notice: channels stay up so people can grab photos.
          const hoursLeft = action.hoursLeft;
          const teams2 = listTeams(db, event.id);
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
                      .setTitle(`🧹 This channel will be deleted in ~${hoursLeft}h`)
                      .setDescription(
                        [
                          `**${event.name}** is over — team spaces (this channel, the voice channel and the team role) are scheduled for removal.`,
                          '',
                          'Grab your screenshots, photos and anything else you want to keep.',
                          `Need more time? Ask an organizer to extend the cleanup delay (currently ${event.cleanupDelayHours}h after the event end).`,
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
          const guild = await client.guilds.fetch(event.guildId).catch(() => null);
          if (guild !== null) {
            for (const seId of event.discordEventIds) {
              await guild.scheduledEvents.delete(seId).catch(() => undefined);
            }
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
          if (autoChannelId !== null) {
            const guild = await client.guilds.fetch(event.guildId).catch(() => null);
            const channel = guild !== null ? await guild.channels.fetch(autoChannelId).catch(() => null) : null;
            if (channel !== null && channel.isTextBased()) {
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
                      .setTitle(`🔒 Teams are locked in for **${event.name}**`)
                      .setDescription(
                        [
                          lines !== '' ? lines : 'Automatic matching could not build teams (not enough eligible participants) — organizers will place people manually.',
                          '',
                          'Late signups now need manual placement by an organizer.',
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
