import type { Client } from 'discord.js';
import type { Db } from '../shared/db.js';
import { withGuildContext } from '../shared/postgres.js';
import { subscribeChanges } from '../shared/live-changes.js';
import { listEvents, scheduleTimeResolved, type HackathonEvent } from '../features/events/data.js';
import { runMaintenance, type NotifyDeps } from './notify.js';

/** The fallback also retries failures and recovers if the notification connection drops. */
const RETRY_MS = 60_000;
const MIN_DELAY_MS = 1_000;

export function nextScheduleDelay(events: HackathonEvent[], now: number): number {
  let next = now + RETRY_MS;
  for (const event of events) {
    if (event.status !== 'active') continue;
    const announced = new Set(event.announcedScheduleIds);
    for (const item of event.schedule) {
      if (!announced.has(item.id) && scheduleTimeResolved(event, item)) next = Math.min(next, item.time <= now ? now + RETRY_MS : item.time);
    }
    if (!event.matchLocked) {
      if (event.matchAt !== null) next = Math.min(next, event.matchAt <= now ? now + RETRY_MS : event.matchAt);
      else if (event.startsAt !== null && !event.schedule.some(item => item.actions?.some(action => action.type === 'auto_match' || action.type === 'assign_random'))) {
        next = Math.min(next, event.startsAt <= now ? now + RETRY_MS : event.startsAt);
      }
    }
  }
  return Math.max(MIN_DELAY_MS, next - now);
}

export function startScheduleRunner(deps: NotifyDeps & { client: Client }): () => void {
  let stopped = false;
  let running = false;
  let pending = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let unsubscribe: (() => void) | undefined;

  const wake = () => {
    if (stopped) return;
    if (running) { pending = true; return; }
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => { void pass(); }, 0);
    timer.unref();
  };
  const pass = async () => {
    if (stopped || running) return;
    running = true;
    let delay = RETRY_MS;
    try {
      if (!unsubscribe) {
        try {
          unsubscribe = await subscribeChanges(deps.db, hint => { if (hint.table === 'events') wake(); }, () => { unsubscribe?.(); unsubscribe = undefined; });
        } catch (error) { console.error('Schedule change subscription failed:', error); }
      }
      const summary = await runMaintenance({ ...deps, scheduledOnly: true });
      for (const line of summary) console.log(`[schedule] ${line}`);
      const events: HackathonEvent[] = [];
      for (const guild of deps.client.guilds.cache.values()) {
        if (guild.available !== false) events.push(...await withGuildContext(deps.db, guild.id, () => listEvents(deps.db, guild.id)));
      }
      delay = nextScheduleDelay(events, Date.now());
    } catch (error) { console.error('Schedule pass failed:', error); }
    finally {
      running = false;
      if (!stopped) {
        if (pending) { pending = false; wake(); }
        else { timer = setTimeout(() => { void pass(); }, delay); timer.unref(); }
      }
    }
  };
  wake();
  return () => { stopped = true; if (timer) clearTimeout(timer); unsubscribe?.(); };
}
