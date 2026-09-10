/**
 * Events: first-class hackathon events. Participants, teams and requests are
 * scoped to an event; the form config lives on the event (falling back to the
 * guild default form for events created before per-event forms).
 *
 * Lifecycle: draft → active → ended → (cleanup done).
 * Templates (kind: 'form' | 'event') allow reuse across events.
 */
import type { Db } from '../../shared/db.js';
import { newId } from '../../shared/db.js';
import { audit } from '../../shared/audit.js';
import { err, ok, type Result } from '../../shared/result.js';
import { DEFAULT_FORM, type FormConfig } from '../form/domain.js';
import { normalizeFormUpdate } from '../form/domain.js';

export type EventStatus = 'draft' | 'active' | 'ended';

export interface HackathonEvent {
  id: string;
  guildId: string;
  name: string;
  description: string;
  startsAt: number | null;
  endsAt: number | null;
  status: EventStatus;
  formJson: string | null;
  panelChannelId: string | null;
  categoryId: string | null;
  /** Hours after ends_at when roles/channels are torn down. */
  cleanupDelayHours: number;
  cleanupDone: boolean;
  cleanupWarned72h: boolean;
  cleanupWarned24h: boolean;
  reminded24h: boolean;
  /** When set (status=active), maintenance auto-runs matching at this time. */
  matchAt: number | null;
  /** Set once auto-match ran (or manually locked) — skips future auto-match. */
  matchLocked: boolean;
  /** Discord scheduled-event ids created for this hackathon event. */
  discordEventIds: string[];
  announcementChannelId: string | null;
  scheduleChannelId: string | null;
  schedule: ScheduleItem[];
  announcements: AnnouncementTemplate[];
  announcedScheduleIds: string[];
  createdAt: number;
  updatedAt: number;
}

export interface ScheduleItem {
  id: string;
  time: number;
  title: string;
  description?: string;
  kind?: 'food' | 'break' | 'voting' | 'prize' | 'talk' | 'custom';
  actions?: ScheduleAction[];
}

export interface ScheduleAction {
  id: string;
  type: 'announce';
  title: string;
  message: string;
  channelId?: string | null;
}

export interface AnnouncementTemplate {
  id: string;
  title: string;
  message: string;
  trigger: 'manual' | 'on_activate' | 'on_start' | 'schedule' | 'teams_locked' | 'teams_assigned';
  channelId?: string | null;
}

interface EventRow {
  id: string;
  guild_id: string;
  name: string;
  description: string;
  starts_at: number | null;
  ends_at: number | null;
  status: string;
  form_json: string | null;
  panel_channel_id: string | null;
  category_id: string | null;
  cleanup_delay_hours: number;
  cleanup_done: number;
  cleanup_warned_72h: number;
  cleanup_warned_24h: number;
  reminded_24h: number;
  match_at: number | null;
  match_locked: number;
  discord_event_ids: string;
  announcement_channel_id: string | null;
  schedule_channel_id: string | null;
  schedule_json: string | null;
  announcements_json: string | null;
  announced_schedule_ids: string | null;
  created_at: number;
  updated_at: number;
}

function toEvent(row: EventRow): HackathonEvent {
  let discordEventIds: string[] = [];
  try {
    discordEventIds = JSON.parse(row.discord_event_ids) as string[];
  } catch {
    discordEventIds = [];
  }
  let schedule: ScheduleItem[] = [];
  try {
    schedule = row.schedule_json ? (JSON.parse(row.schedule_json) as ScheduleItem[]) : [];
    if (!Array.isArray(schedule)) schedule = [];
  } catch {
    schedule = [];
  }
  let announcements: AnnouncementTemplate[] = [];
  try {
    announcements = row.announcements_json ? (JSON.parse(row.announcements_json) as AnnouncementTemplate[]) : [];
    if (!Array.isArray(announcements)) announcements = [];
  } catch {
    announcements = [];
  }
  let announcedScheduleIds: string[] = [];
  try {
    announcedScheduleIds = row.announced_schedule_ids ? (JSON.parse(row.announced_schedule_ids) as string[]) : [];
    if (!Array.isArray(announcedScheduleIds)) announcedScheduleIds = [];
  } catch {
    announcedScheduleIds = [];
  }
  return {
    id: row.id,
    guildId: row.guild_id,
    name: row.name,
    description: row.description,
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    status: row.status as EventStatus,
    formJson: row.form_json,
    panelChannelId: row.panel_channel_id,
    categoryId: row.category_id,
    cleanupDelayHours: row.cleanup_delay_hours,
    cleanupDone: row.cleanup_done === 1,
    cleanupWarned72h: row.cleanup_warned_72h === 1,
    cleanupWarned24h: row.cleanup_warned_24h === 1,
    reminded24h: row.reminded_24h === 1,
    matchAt: row.match_at,
    matchLocked: row.match_locked === 1,
    discordEventIds,
    announcementChannelId: row.announcement_channel_id ?? null,
    scheduleChannelId: row.schedule_channel_id ?? null,
    schedule,
    announcements,
    announcedScheduleIds,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// ─── CRUD ────────────────────────────────────────────────────────────────────

export interface CreateEventInput {
  name: string;
  description?: string;
  startsAt?: number | null;
  endsAt?: number | null;
  /** Optional form config to seed the event with (defaults to DEFAULT_FORM). */
  form?: Partial<FormConfig>;
  panelChannelId?: string | null;
  announcementChannelId?: string | null;
  scheduleChannelId?: string | null;
  categoryId?: string | null;
  cleanupDelayHours?: number;
  schedule?: ScheduleItem[];
  announcements?: AnnouncementTemplate[];
}

export function createEvent(db: Db, actor: string, guildId: string, input: CreateEventInput): Result<HackathonEvent> {
  const name = input.name.trim().slice(0, 100);
  if (name.length < 3) return err('bad_name', 'Event name must be at least 3 characters.');
  if (input.startsAt !== null && input.startsAt !== undefined && input.endsAt !== null && input.endsAt !== undefined) {
    if (input.endsAt <= input.startsAt) return err('bad_dates', 'The event must end after it starts.');
  }
  if (input.startsAt !== null && input.startsAt !== undefined) {
    const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);
    if (input.startsAt < todayStart.getTime()) return err('bad_dates', 'Event cannot start in the past.');
  }

  const id = newId('ev');
  const form: FormConfig = normalizeFormUpdate({ ...DEFAULT_FORM, ...(input.form ?? {}) }, {});
  const schedule = normalizeSchedule(input.schedule ?? []);
  const announcements = normalizeAnnouncements(input.announcements ?? []);
  // seed defaults if none provided — at least on_activate + schedule
  const seededAnnouncements = announcements.length > 0 ? announcements : defaultAnnouncements(name);
  db.prepare(
    `INSERT INTO events (id, guild_id, name, description, starts_at, ends_at, status, form_json, panel_channel_id, announcement_channel_id, schedule_channel_id, category_id, cleanup_delay_hours, schedule_json, announcements_json, announced_schedule_ids, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, 'draft', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    guildId,
    name,
    (input.description ?? '').slice(0, 1000),
    input.startsAt ?? null,
    input.endsAt ?? null,
    JSON.stringify(form),
    input.panelChannelId ?? null,
    input.announcementChannelId ?? null,
    input.scheduleChannelId ?? null,
    input.categoryId ?? null,
    input.cleanupDelayHours ?? 48,
    JSON.stringify(schedule),
    JSON.stringify(seededAnnouncements),
    JSON.stringify([]),
    Date.now(),
    Date.now(),
  );
  audit(db, actor, 'event.create', id, { name });
  return ok(getEvent(db, id)!);
}

export function getEvent(db: Db, eventId: string): HackathonEvent | null {
  const row = db.prepare('SELECT * FROM events WHERE id = ?').get(eventId) as unknown as EventRow | undefined;
  return row === undefined ? null : toEvent(row);
}

export function listEvents(db: Db, guildId: string): HackathonEvent[] {
  return (
    db.prepare('SELECT * FROM events WHERE guild_id = ? ORDER BY created_at DESC').all(guildId) as unknown as EventRow[]
  ).map(toEvent);
}

export function getActiveEvent(db: Db, guildId: string): HackathonEvent | null {
  const row = db
    .prepare("SELECT * FROM events WHERE guild_id = ? AND status = 'active' ORDER BY created_at DESC LIMIT 1")
    .get(guildId) as unknown as EventRow | undefined;
  return row === undefined ? null : toEvent(row);
}

export function updateEvent(
  db: Db,
  actor: string,
  eventId: string,
  update: Partial<Pick<HackathonEvent, 'name' | 'description' | 'startsAt' | 'endsAt' | 'panelChannelId' | 'announcementChannelId' | 'scheduleChannelId' | 'categoryId' | 'cleanupDelayHours' | 'matchAt' | 'discordEventIds' | 'schedule' | 'announcements'>>,
): Result<HackathonEvent> {
  const event = getEvent(db, eventId);
  if (event === null) return err('not_found', 'Event not found.');

  const name = update.name !== undefined ? update.name.trim().slice(0, 100) || event.name : event.name;
  const description = update.description !== undefined ? update.description.slice(0, 1000) : event.description;
  const startsAt = update.startsAt !== undefined ? update.startsAt : event.startsAt;
  const endsAt = update.endsAt !== undefined ? update.endsAt : event.endsAt;
  if (startsAt !== null && endsAt !== null && endsAt <= startsAt) {
    return err('bad_dates', 'The event must end after it starts.');
  }
  if (update.startsAt !== undefined && startsAt !== null) {
    const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);
    if (startsAt < todayStart.getTime()) return err('bad_dates', 'Event cannot start in the past.');
  }
  const cleanupDelayHours =
    update.cleanupDelayHours !== undefined
      ? Math.min(Math.max(Math.round(update.cleanupDelayHours), 0), 24 * 30)
      : event.cleanupDelayHours;

  db.prepare(
    `UPDATE events SET name = ?, description = ?, starts_at = ?, ends_at = ?, panel_channel_id = ?, announcement_channel_id = ?, schedule_channel_id = ?, category_id = ?, cleanup_delay_hours = ?, match_at = ?, discord_event_ids = ?, schedule_json = ?, announcements_json = ?, updated_at = ?
     WHERE id = ?`,
  ).run(
    name,
    description,
    startsAt,
    endsAt,
    update.panelChannelId !== undefined ? update.panelChannelId : event.panelChannelId,
    update.announcementChannelId !== undefined ? update.announcementChannelId : event.announcementChannelId,
    update.scheduleChannelId !== undefined ? update.scheduleChannelId : event.scheduleChannelId,
    update.categoryId !== undefined ? update.categoryId : event.categoryId,
    cleanupDelayHours,
    update.matchAt !== undefined ? update.matchAt : event.matchAt,
    update.discordEventIds !== undefined ? JSON.stringify(update.discordEventIds) : JSON.stringify(event.discordEventIds),
    update.schedule !== undefined ? JSON.stringify(normalizeSchedule(update.schedule)) : JSON.stringify(event.schedule),
    update.announcements !== undefined ? JSON.stringify(normalizeAnnouncements(update.announcements)) : JSON.stringify(event.announcements),
    Date.now(),
    eventId,
  );
  audit(db, actor, 'event.update', eventId, { name, startsAt, endsAt, matchAt: update.matchAt !== undefined ? update.matchAt : undefined, schedule: update.schedule !== undefined ? update.schedule.length : undefined });
  return ok(getEvent(db, eventId)!);
}

// ─── lifecycle ───────────────────────────────────────────────────────────────

export function activateEvent(db: Db, actor: string, eventId: string): Result<HackathonEvent> {
  const event = getEvent(db, eventId);
  if (event === null) return err('not_found', 'Event not found.');
  if (event.status === 'active') return ok(event);
  if (event.status === 'ended') return err('already_ended', 'Ended events cannot be reactivated — clone it instead.');

  // Multiple events can be active simultaneously.
  db.prepare("UPDATE events SET status = 'active', updated_at = ? WHERE id = ?").run(Date.now(), eventId);
  audit(db, actor, 'event.activate', eventId, null);
  return ok(getEvent(db, eventId)!);
}

export function endEvent(db: Db, actor: string, eventId: string): Result<HackathonEvent> {
  const event = getEvent(db, eventId);
  if (event === null) return err('not_found', 'Event not found.');
  db.prepare("UPDATE events SET status = 'ended', updated_at = ? WHERE id = ?").run(Date.now(), eventId);
  audit(db, actor, 'event.end', eventId, null);
  return ok(getEvent(db, eventId)!);
}

// ─── event form config ───────────────────────────────────────────────────────

/** Per-event form config, falling back to the guild default when unset. */
export function getEventForm(db: Db, event: HackathonEvent | null, guildDefault: FormConfig): FormConfig {
  if (event === null || event.formJson === null) return guildDefault;
  try {
    const parsed = JSON.parse(event.formJson) as Partial<FormConfig>;
    return normalizeFormUpdate({ ...guildDefault, ...parsed }, {});
  } catch {
    return guildDefault;
  }
}

export function updateEventForm(db: Db, actor: string, eventId: string, update: Partial<FormConfig>): Result<FormConfig> {
  const event = getEvent(db, eventId);
  if (event === null) return err('not_found', 'Event not found.');
  const current = getEventForm(db, event, DEFAULT_FORM);
  const next = normalizeFormUpdate(current, update);
  db.prepare('UPDATE events SET form_json = ?, updated_at = ? WHERE id = ?').run(JSON.stringify(next), Date.now(), eventId);
  audit(db, actor, 'event.form_update', eventId, null);
  return ok(next);
}

// ─── templates ───────────────────────────────────────────────────────────────

export interface Template {
  id: string;
  guildId: string | null;
  name: string;
  kind: 'event' | 'form' | 'announcement';
  json: string;
  createdAt: number;
}

function templateRow(row: { id: string; guild_id: string | null; name: string; kind: string; json: string; created_at: number }): Template {
  return {
    id: row.id,
    guildId: row.guild_id,
    name: row.name,
    kind: row.kind as Template['kind'],
    json: row.json,
    createdAt: row.created_at,
  };
}

export function saveTemplate(
  db: Db,
  actor: string,
  guildId: string | null,
  name: string,
  kind: Template['kind'],
  json: string,
): Result<Template> {
  const clean = name.trim().slice(0, 80);
  if (clean.length < 2) return err('bad_name', 'Template name must be at least 2 characters.');
  JSON.parse(json); // must be valid JSON
  const id = newId('tpl');
  db.prepare(
    'INSERT INTO event_templates (id, guild_id, name, kind, json, created_at) VALUES (?, ?, ?, ?, ?, ?)',
  ).run(id, guildId, clean, kind, json, Date.now());
  audit(db, actor, 'template.save', id, { name: clean, kind });
  const row = db.prepare('SELECT * FROM event_templates WHERE id = ?').get(id) as unknown as Parameters<typeof templateRow>[0];
  return ok(templateRow(row));
}

export function listTemplates(db: Db, guildId: string, kind?: Template['kind']): Template[] {
  const rows = (
    kind === undefined
      ? db
          .prepare('SELECT * FROM event_templates WHERE guild_id = ? OR guild_id IS NULL ORDER BY created_at DESC')
          .all(guildId)
      : db
          .prepare('SELECT * FROM event_templates WHERE (guild_id = ? OR guild_id IS NULL) AND kind = ? ORDER BY created_at DESC')
          .all(guildId, kind)
  ) as unknown as Parameters<typeof templateRow>[0][];
  return rows.map(templateRow);
}

export function deleteTemplate(db: Db, actor: string, templateId: string): Result<void> {
  const res = db.prepare('DELETE FROM event_templates WHERE id = ?').run(templateId);
  if (res.changes === 0) return err('not_found', 'Template not found.');
  audit(db, actor, 'template.delete', templateId, null);
  return ok(undefined);
}

/** Build CreateEventInput from an 'event' template. */
export function templateToEventInput(json: string): Partial<CreateEventInput> {
  const parsed = JSON.parse(json) as Partial<CreateEventInput & { form: Partial<FormConfig> }>;
  return {
    ...(parsed.name !== undefined ? { name: parsed.name } : {}),
    ...(parsed.description !== undefined ? { description: parsed.description } : {}),
    ...(parsed.cleanupDelayHours !== undefined ? { cleanupDelayHours: parsed.cleanupDelayHours } : {}),
    ...(parsed.form !== undefined ? { form: parsed.form } : {}),
    ...(parsed.schedule !== undefined ? { schedule: normalizeSchedule(parsed.schedule) } : {}),
    ...(parsed.announcements !== undefined ? { announcements: normalizeAnnouncements(parsed.announcements) } : {}),
  };
}

function normalizeSchedule(items: ScheduleItem[]): ScheduleItem[] {
  if (!Array.isArray(items)) return [];
  const out: ScheduleItem[] = [];
  for (const raw of items) {
    if (!raw || typeof raw.time !== 'number' || !Number.isFinite(raw.time)) continue;
    const title = String((raw as unknown as Record<string, unknown>).title ?? '').trim().slice(0, 80);
    if (!title) continue;
    const id = String((raw as unknown as Record<string, unknown>).id ?? '').trim() || newId('sch');
    const description = String((raw as unknown as Record<string, unknown>).description ?? '').trim().slice(0, 200) || undefined;
    const kindRaw = String((raw as unknown as Record<string, unknown>).kind ?? 'custom').trim() as ScheduleItem['kind'];
    const kind: ScheduleItem['kind'] = ['food', 'break', 'voting', 'prize', 'talk', 'custom'].includes(kindRaw ?? '') ? kindRaw : 'custom';
    // actions: zapier-like per-item announcements
    let actions: ScheduleAction[] | undefined = undefined
    const rawActions = (raw as unknown as Record<string, unknown>).actions
    if (Array.isArray(rawActions)) {
      const norm: ScheduleAction[] = []
      for (const a of rawActions as unknown[]) {
        const ar = a as Record<string, unknown>
        if (!ar || typeof ar.title !== 'string' || typeof ar.message !== 'string') continue
        const atitle = String(ar.title).trim().slice(0, 100)
        const amsg = String(ar.message).trim().slice(0, 2000)
        if (!atitle || !amsg) continue
        const aid = String(ar.id ?? '').trim() || newId('sact')
        const atype = String(ar.type ?? 'announce').trim() as ScheduleAction['type']
        const chan = ar.channelId !== undefined && ar.channelId !== null ? String(ar.channelId).trim() || null : null
        norm.push({ id: aid, type: 'announce', title: atitle, message: amsg, ...(chan ? { channelId: chan } : {}) })
      }
      if (norm.length > 0) actions = norm.slice(0, 10)
    }
    out.push({ id, time: raw.time, title, ...(description ? { description } : {}), ...(kind ? { kind } : {}), ...(actions ? { actions } : {}) });
  }
  out.sort((a, b) => a.time - b.time);
  return out.slice(0, 50);
}

export function normalizeAnnouncements(items: AnnouncementTemplate[]): AnnouncementTemplate[] {
  if (!Array.isArray(items)) return [];
  const out: AnnouncementTemplate[] = [];
  for (const raw of items) {
    if (!raw || typeof raw.title !== 'string' || typeof raw.message !== 'string') continue;
    const title = raw.title.trim().slice(0, 100);
    const message = raw.message.trim().slice(0, 2000);
    if (!title || !message) continue;
    const trigger = (['manual','on_activate','on_start','schedule','teams_locked','teams_assigned'] as const).includes(raw.trigger as never) ? raw.trigger : 'manual';
    const id = String((raw as unknown as Record<string, unknown>).id ?? '').trim() || newId('ann');
    const channelId = raw.channelId !== undefined && raw.channelId !== null ? String(raw.channelId).trim() || null : null;
    out.push({ id, title, message, trigger, ...(channelId ? { channelId } : {}) });
  }
  return out.slice(0, 20);
}

export function defaultAnnouncements(eventName: string): AnnouncementTemplate[] {
  return [
    { id: newId('ann'), title: `${eventName} — signups open!`, message: 'Listen up {everyone} **{event}** is live! Sign up in {panel} — starts {timer}', trigger: 'on_activate' },
    { id: newId('ann'), title: '{event} starting soon', message: '{everyone} **{event}** starts {timer} — get ready! {panel}', trigger: 'on_start' },
    { id: newId('ann'), title: '{schedule_title}', message: '⏰ **{schedule_title}** — {schedule_desc} {timer_schedule} {everyone}', trigger: 'schedule' },
    { id: newId('ann'), title: 'Teams locked!', message: '🔒 Teams for **{event}** are locked — {everyone} check your channels!', trigger: 'teams_locked' },
    { id: newId('ann'), title: 'Teams assigned', message: '✅ **{event}** teams have been assigned — good luck {everyone}!', trigger: 'teams_assigned' },
  ]
}

// ─── maintenance planner (pure, fully unit-testable) ────────────────────────

export type MaintenanceAction =
  | { type: 'remind_24h'; eventId: string }
  | { type: 'end_event'; eventId: string }
  | { type: 'cleanup_warn'; eventId: string; hoursLeft: number }
  | { type: 'cleanup'; eventId: string }
  | { type: 'auto_match'; eventId: string }
  | { type: 'schedule'; eventId: string; scheduleId: string };

/** Decide what should happen now, given the current time. Pure. */
export function planMaintenance(events: HackathonEvent[], now: number): MaintenanceAction[] {
  const actions: MaintenanceAction[] = [];
  for (const event of events) {
    if (event.status === 'active') {
      if (
        !event.reminded24h &&
        event.startsAt !== null &&
        event.startsAt - now <= 24 * 3600 * 1000 &&
        event.startsAt > now
      ) {
        actions.push({ type: 'remind_24h', eventId: event.id });
      }
      if (event.matchAt !== null && event.matchAt <= now && !event.matchLocked) {
        actions.push({ type: 'auto_match', eventId: event.id });
      }
      if (event.endsAt !== null && event.endsAt <= now) {
        actions.push({ type: 'end_event', eventId: event.id });
      }
      // Schedule items: fire once when time is reached (within 10 min window to avoid backlog spam)
      const announced = new Set(event.announcedScheduleIds ?? [])
      for (const item of event.schedule ?? []) {
        if (announced.has(item.id)) continue
        if (item.time <= now && now - item.time <= 60*60*1000 && item.time > now - 24*3600*1000) {
          actions.push({ type: 'schedule', eventId: event.id, scheduleId: item.id })
        }
      }
    }
    if (event.status === 'ended' && !event.cleanupDone && event.endsAt !== null) {
      const cleanupAt = event.endsAt + event.cleanupDelayHours * 3600 * 1000;
      // Grace window: people keep sharing screenshots until teardown. Warn in
      // team channels at 72h and 24h before deletion.
      if (cleanupAt <= now) {
        actions.push({ type: 'cleanup', eventId: event.id });
      } else if (!event.cleanupWarned72h && cleanupAt - now <= 72 * 3600 * 1000) {
        actions.push({ type: 'cleanup_warn', eventId: event.id, hoursLeft: Math.round((cleanupAt - now) / 3600 / 1000) });
      } else if (!event.cleanupWarned24h && cleanupAt - now <= 24 * 3600 * 1000) {
        actions.push({ type: 'cleanup_warn', eventId: event.id, hoursLeft: Math.round((cleanupAt - now) / 3600 / 1000) });
      }
    }
  }
  return actions;
}

// ─── Kysely-based queries (typed; the migration path for complex reads) ─────

import type { KyselyDb } from '../../shared/kysely.js';

/** All events for the maintenance planner, via typed Kysely query. */
export async function listEventsForMaintenance(kysely: KyselyDb): Promise<HackathonEvent[]> {
  const rows = await kysely
    .selectFrom('events')
    .selectAll()
    .orderBy('created_at', 'desc')
    .execute();
  return rows.map((row) =>
    toEvent({
      ...(row as unknown as EventRow),
      discord_event_ids: row.discord_event_ids ?? '[]',
      schedule_json: (row as unknown as { schedule_json?: string | null }).schedule_json ?? '[]',
      announcements_json: (row as unknown as { announcements_json?: string | null }).announcements_json ?? '[]',
      announced_schedule_ids: (row as unknown as { announced_schedule_ids?: string | null }).announced_schedule_ids ?? '[]',
    }),
  );
}

/** Mark the 24h reminder as sent. */
export async function markReminded24h(kysely: KyselyDb, eventId: string): Promise<void> {
  await kysely
    .updateTable('events')
    .set({ reminded_24h: 1, updated_at: Date.now() })
    .where('id', '=', eventId)
    .execute();
}

/** Mark cleanup done. */
export async function markCleanupDone(kysely: KyselyDb, eventId: string): Promise<void> {
  await kysely
    .updateTable('events')
    .set({ cleanup_done: 1, updated_at: Date.now() })
    .where('id', '=', eventId)
    .execute();
}

/** Mark the 72h/24h cleanup warning as posted. Tier selects the flag column. */
export function markCleanupWarned(db: import('../../shared/db.js').Db, eventId: string, tier: '72h' | '24h'): void {
  const column = tier === '72h' ? 'cleanup_warned_72h' : 'cleanup_warned_24h';
  db.prepare(`UPDATE events SET ${column} = 1, updated_at = ? WHERE id = ?`).run(Date.now(), eventId);
}

/**
 * Mark the event's teams as locked in (auto-match done, or manually locked).
 * Skips future auto-match; never blocks manual match runs.
 */
export function markMatchLocked(db: import('../../shared/db.js').Db, eventId: string): void {
  db.prepare('UPDATE events SET match_locked = 1, updated_at = ? WHERE id = ?').run(Date.now(), eventId);
}

/** Clear the lock so a future auto-match can fire again. */
export function markMatchUnlocked(db: import('../../shared/db.js').Db, eventId: string): void {
  db.prepare('UPDATE events SET match_locked = 0, updated_at = ? WHERE id = ?').run(Date.now(), eventId);
}

/** Set or clear the scheduled auto-match time (null clears it). */
export function setMatchAt(db: import('../../shared/db.js').Db, actor: string, eventId: string, matchAt: number | null): Result<HackathonEvent> {
  const res = updateEvent(db, actor, eventId, { matchAt });
  if (res.ok) audit(db, actor, 'event.match_schedule', eventId, { matchAt });
  return res;
}

/** Tag renderer for announcement templates. Tags: {event} {event_description} {panel} {everyone} {here} {timer} {startsAt} {endsAt} {schedule} {schedule_title} {schedule_desc} {schedule_time} {timer_schedule} */
export function renderAnnouncementTags(template: string, event: HackathonEvent, ctx: { scheduleItem?: ScheduleItem } = {}): { content: string; hasEveryone: boolean; hasHere: boolean } {
  let content = template
  const everyone = template.includes('{everyone}')
  const here = template.includes('{here}')
  content = content.replaceAll('{event}', event.name)
  content = content.replaceAll('{event_description}', event.description)
  content = content.replaceAll('{everyone}', '@everyone')
  content = content.replaceAll('{here}', '@here')
  const panel = event.panelChannelId ? `<#${event.panelChannelId}>` : 'panel not set'
  const announce = event.announcementChannelId ? `<#${event.announcementChannelId}>` : panel
  content = content.replaceAll('{panel}', panel)
  content = content.replaceAll('{announce}', announce)
  if (event.startsAt !== null) {
    content = content.replaceAll('{timer}', `<t:${Math.floor(event.startsAt/1000)}:R>`)
    content = content.replaceAll('{startsAt}', `<t:${Math.floor(event.startsAt/1000)}:F>`)
  } else {
    content = content.replaceAll('{timer}', '')
    content = content.replaceAll('{startsAt}', 'TBA')
  }
  if (event.endsAt !== null) content = content.replaceAll('{endsAt}', `<t:${Math.floor(event.endsAt/1000)}:F>`)
  else content = content.replaceAll('{endsAt}', 'TBA')

  // schedule
  if (ctx.scheduleItem) {
    content = content.replaceAll('{schedule_title}', ctx.scheduleItem.title)
    content = content.replaceAll('{schedule_desc}', ctx.scheduleItem.description ?? '')
    content = content.replaceAll('{schedule_time}', `<t:${Math.floor(ctx.scheduleItem.time/1000)}:t>`)
    content = content.replaceAll('{timer_schedule}', `<t:${Math.floor(ctx.scheduleItem.time/1000)}:R>`)
    content = content.replaceAll('{schedule_kind}', ctx.scheduleItem.kind ?? 'custom')
  } else {
    // if no specific item, {schedule} = list, others empty
    const schedList = (event.schedule ?? []).map(s=> `• <t:${Math.floor(s.time/1000)}:t> ${s.title}`).join('\n') || 'No schedule yet'
    content = content.replaceAll('{schedule}', schedList)
    content = content.replaceAll('{schedule_title}', '')
    content = content.replaceAll('{schedule_desc}', '')
    content = content.replaceAll('{schedule_time}', '')
    content = content.replaceAll('{timer_schedule}', '')
    content = content.replaceAll('{schedule_kind}', '')
  }
  // collapse double spaces from empty replacements
  content = content.replaceAll('  ', ' ').trim()
  return { content, hasEveryone: everyone, hasHere: here }
}

/** Mark a schedule item as announced so planMaintenance won't re-fire. */
export function markScheduleAnnounced(db: import('../../shared/db.js').Db, eventId: string, scheduleId: string): void {
  const event = getEvent(db, eventId)
  if (!event) return
  const next = [...new Set([...(event.announcedScheduleIds ?? []), scheduleId])]
  db.prepare('UPDATE events SET announced_schedule_ids = ?, updated_at = ? WHERE id = ?').run(JSON.stringify(next), Date.now(), eventId)
}
