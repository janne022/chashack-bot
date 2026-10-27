import { createHash } from 'node:crypto';
import { EmbedBuilder, type Client, type MessageCreateOptions, type TextChannel } from 'discord.js';
import type { Db } from '../shared/db.js';
import { getEvent, getEventForm, getMessageRef, renderAnnouncementTags, scheduleTimeResolved, type HackathonEvent } from '../features/events/data.js';
import { getDelivery, saveDelivery, type DeliveryRecord } from '../features/events/delivery-data.js';
import { getForm } from '../features/form/data.js';
import { listTeams } from '../features/teams/data.js';
import { postOrUpdatePanel } from './signup-panel.js';
import { postOrUpdateScheduleItinerary } from './schedule-itinerary.js';
import { botLocale } from './provision.js';

const fingerprint = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
type Reconciliation = { pending?: { event: HackathonEvent; now: number }; task: Promise<void> };
const active = new Map<string, Reconciliation>();

async function managedMessage(db: Db, client: Client, event: HackathonEvent, key: string, channelId: string,
  payload: MessageCreateOptions, previous: DeliveryRecord | null, assignmentId?: string): Promise<void> {
  const hash = fingerprint([channelId, payload]);
  if (previous?.fingerprint === hash) return;
  const guild = await client.guilds.fetch(event.guildId);
  const channel = await guild.channels.fetch(channelId);
  if (!channel?.isTextBased() || !('send' in channel)) throw new Error('Delivery channel unavailable');
  const text = channel as TextChannel;
  let message = previous?.messageId && previous.channelId === channelId
    ? await text.messages.fetch(previous.messageId).catch(error => {
      if (error?.code === 10008) return null; // Deleted message: replace it. Access/network errors must retry, not duplicate.
      throw error;
    }) : null;
  if (message && message.author.id !== client.user?.id) throw new Error('Refusing to edit another author’s message');
  if (message) await message.edit({ content: payload.content ?? '', embeds: payload.embeds ?? [], allowedMentions: { parse: [] } });
  else message = await text.send({ ...payload, nonce: fingerprint(key + hash).slice(0, 24), enforceNonce: true });
  await saveDelivery(db, key, { fingerprint: hash, channelId, messageId: message.id, ...(assignmentId ? { assignmentId } : {}) });
}

/** Persistent, repeatable deliveries. No completed-block marker can suppress retries or late teams. */
export async function reconcileEventDelivery(db: Db, client: Client, event: HackathonEvent, now = Date.now()): Promise<void> {
  const eventKey = `${event.guildId}:${event.id}`;
  const running = active.get(eventKey);
  if (running) {
    running.pending = { event, now };
    return running.task;
  }
  if (event.status !== 'active' || event.cleanupDone) return;
  const state: Reconciliation = { task: Promise.resolve() };
  active.set(eventKey, state);
  state.task = (async () => {
    try {
      await db.tryAdvisoryLock(`event-delivery:${eventKey}`, async () => {
        let next: { event: HackathonEvent; now: number } | undefined = { event, now };
        let failure: unknown;
        while (next) {
          delete state.pending;
          const current = await getEvent(db, event.id);
          if (current && current.guildId === event.guildId && current.status === 'active' && !current.cleanupDone) {
            try { await reconcileEventDeliveryPass(db, client, current, next.now); }
            catch (error) { failure ??= error; }
          }
          next = state.pending;
        }
        if (failure !== undefined) throw failure;
      });
    } finally { active.delete(eventKey); }
  })();
  return state.task;
}

async function reconcileEventDeliveryPass(db: Db, client: Client, event: HackathonEvent, now: number): Promise<void> {
  const base = `${event.guildId}:${event.id}`;
  const baselineKey = base + ':legacy-actions';
  let baseline = await getDelivery(db, baselineKey);
  if (!baseline) {
    baseline = { fingerprint: '', legacyActionKeys: event.schedule.filter(item => event.announcedScheduleIds.includes(item.id)).flatMap(item => (item.actions ?? []).map(action => item.id + ':' + action.id)) };
    await saveDelivery(db, baselineKey, baseline);
  }
  const fallbackPanel = (await getMessageRef(db, `signup_panel:${event.guildId}`))?.channelId;
  const form = getEventForm(db, event, await getForm(db, event.guildId));
  for (const item of event.schedule) {
    if (!scheduleTimeResolved(event, item)) continue;
    for (const action of item.actions ?? []) {
      const key = `${base}:${item.id}:${action.id}`;
      try {
        const prior = await getDelivery(db, key);
        if (item.time > now && !prior) continue;
        if (action.type === 'post_signup') {
          const channelId = action.channelId ?? event.panelChannelId ?? fallbackPanel;
          if (!channelId) continue;
          const hash = fingerprint([channelId, form, event.name, event.signupStartsAt, event.signupEndsAt]);
          if (prior?.fingerprint === hash) continue;
          const actionRef = prior?.channelId && prior.messageId
            ? { channelId: prior.channelId, messageId: prior.messageId } : undefined;
          const result = await postOrUpdatePanel(db, client, event.guildId, channelId, botLocale(), event.id, actionRef);
          if ('error' in result) throw new Error(result.error);
          await saveDelivery(db, key, { fingerprint: hash, channelId: result.channelId, messageId: result.messageId });
        } else if (action.type === 'announce') {
          const channelId = action.channelId ?? event.announcementChannelId ?? event.panelChannelId ?? fallbackPanel;
          if (!channelId) continue;
          const title = renderAnnouncementTags(action.title ?? item.title, event, { scheduleItem: item });
          const body = renderAnnouncementTags(action.message ?? '', event, { scheduleItem: item });
          const payload: MessageCreateOptions = {
            content: body.hasEveryone || body.hasHere ? body.content : '',
            embeds: [new EmbedBuilder().setTitle(title.content.slice(0, 256)).setDescription(body.content.slice(0, 4096) || ' ').setColor(0x55bbda)
              .setFooter({ text: event.name }).setTimestamp(item.time)],
            allowedMentions: { parse: body.hasEveryone || body.hasHere ? ['everyone'] : [] },
          };
          // Old releases did not retain message IDs. Establish a baseline without replaying their announcements.
          if (!prior && baseline.legacyActionKeys?.includes(item.id + ':' + action.id)) {
            await saveDelivery(db, key, { fingerprint: fingerprint([channelId, payload]), legacy: true });
            continue;
          }
          await managedMessage(db, client, event, key, channelId, payload, prior);
        } else if (action.type === 'distribute_assignments' && item.time <= now && event.assignments.length) {
          const teams = await listTeams(db, event.id);
          for (const team of teams) {
            if (!team.textChannelId) continue;
            const teamKey = `${key}:team:${team.id}`;
            const delivered = await getDelivery(db, teamKey);
            const choice = event.assignments.find(a => a.id === delivered?.assignmentId)
              ?? (action.mode === 'same' ? event.assignments.find(a => a.id === action.assignmentId) ?? event.assignments[0]
                : event.assignments[parseInt(fingerprint(teamKey).slice(0, 8), 16) % event.assignments.length]);
            if (!choice) continue;
            // Retain the team's choice across failures, edits, restarts and newly created teams.
            if (!delivered) await saveDelivery(db, teamKey, { fingerprint: '', assignmentId: choice.id });
            const embed = new EmbedBuilder().setTitle(choice.title.slice(0, 256))
              .setDescription(choice.instructions.replaceAll('{team}', team.name).replaceAll('{event}', event.name).slice(0, 4096) || ' ')
              .setColor(0x55bbda);
            if (choice.imageUrl && /^https?:\/\//.test(choice.imageUrl)) embed.setImage(choice.imageUrl);
            try { await managedMessage(db, client, event, teamKey, team.textChannelId, { embeds: [embed], allowedMentions: { parse: [] } }, delivered, choice.id); }
            catch (error) { console.warn(`Assignment delivery to ${team.id} failed; will retry:`, error); }
          }
          await saveDelivery(db, key, { fingerprint: fingerprint(action) });
        }
      } catch (error) { console.warn(`Event delivery ${key} failed; retrying next pass:`, error); }
    }
  }
  // Preserve the old channel-driven behavior for events without explicit publish
  // actions. Once published, a tracked itinerary continues to follow edits.
  const itinerary = await getMessageRef(db, `schedule_itinerary:${event.id}`);
  const publishActions = event.schedule.flatMap(item => (item.actions ?? [])
    .filter(action => action.type === 'publish_schedule').map(action => ({ time: item.time, action, resolved: scheduleTimeResolved(event, item) })));
  const due = publishActions.filter(item => item.resolved && item.time <= now).sort((a, b) => b.time - a.time)[0];
  const shouldPublish = !!itinerary || (publishActions.length > 0 ? !!due : !!event.scheduleChannelId);
  const channelId = due ? (due.action.channelId ?? event.scheduleChannelId ?? itinerary?.channelId) : (itinerary?.channelId ?? event.scheduleChannelId);
  if (shouldPublish) {
    const key = `${base}:itinerary`, hash = fingerprint([event.name, event.description, event.startsAt, event.endsAt, event.schedule, channelId]);
    if ((await getDelivery(db, key))?.fingerprint !== hash) {
      const result = await postOrUpdateScheduleItinerary(db, client, event, channelId);
      if ('error' in result) throw new Error(result.error);
      await saveDelivery(db, key, { fingerprint: hash, channelId: result.channelId, messageId: result.messageId });
    }
  }
}

export async function reconcileTeamAssignments(db: Db, client: Client, eventId: string): Promise<void> {
  const event = await getEvent(db, eventId);
  if (event) await reconcileEventDelivery(db, client, event);
}
