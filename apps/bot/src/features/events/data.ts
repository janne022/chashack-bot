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
  signupStartsAt: number | null;
  signupEndsAt: number | null;
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
  assignments: Assignment[];
  announcedScheduleIds: string[];
  createdAt: number;
  updatedAt: number;
}

export interface Assignment {
  id: string;
  title: string;
  instructions: string;
  description?: string;
  /** Optional image (URL) attached when the assignment is dealt to a team channel. */
  imageUrl?: string;
}

/** Anchors a template-authored schedule item can hang off; resolved per event. */
export type ScheduleAnchor = 'hackathon_start' | 'signup_start' | 'signup_end' | 'hackathon_end';

export const SCHEDULE_ANCHORS: readonly ScheduleAnchor[] = ['hackathon_start', 'signup_start', 'signup_end', 'hackathon_end'];

export interface ScheduleItem {
  id: string;
  time: number;
  title: string;
  description?: string;
  kind?: 'food' | 'break' | 'voting' | 'prize' | 'talk' | 'custom';
  actions?: ScheduleAction[];
  /**
   * Template-style placement (event templates only): when set together with
   * `offsetMinutes`, `time` is recomputed from the anchor's date whenever the
   * event's dates change, so a template itinerary adapts to whatever dates the
   * event gets. Hand-editing a time clears both fields (becomes absolute).
   */
  anchor?: ScheduleAnchor;
  /** Minutes from the anchor date's 00:00 (negative = earlier than that day). */
  offsetMinutes?: number;
}

export interface ScheduleAction {
  id: string;
  type: 'announce' | 'lock_teams' | 'assign_random' | 'auto_match' | 'post_signup' | 'distribute_assignments';
  title?: string;
  message?: string;
  channelId?: string | null;
  mode?: 'random' | 'same';
  assignmentId?: string;
}

/** How an event's assignment pool is dealt out to teams. */
export type AssignmentStrategy = 'random' | 'same';

export interface ScheduleDates {
  startsAt?: number | null;
  endsAt?: number | null;
  signupStartsAt?: number | null;
  signupEndsAt?: number | null;
}

function startOfDay(ms: number): number {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/**
 * Resolve template-authored anchored items onto an event's real dates.
 * Anchor fallbacks: signup_start → startsAt, signup_end → startsAt,
 * hackathon_end → startsAt. An item whose anchor has no date anywhere keeps its
 * literal `time` (there is nothing to compute it from), and `anchor`/
 * `offsetMinutes` are preserved so a later date change re-resolves the item.
 */
export function resolveScheduleAnchors(items: ScheduleItem[], dates: ScheduleDates): ScheduleItem[] {
  return items.map((item) => {
    if (item.anchor === undefined || item.offsetMinutes === undefined) return item;
    const anchorTime =
      item.anchor === 'hackathon_start'
        ? dates.startsAt ?? null
        : item.anchor === 'hackathon_end'
          ? dates.endsAt ?? dates.startsAt ?? null
          : item.anchor === 'signup_start'
            ? dates.signupStartsAt ?? dates.startsAt ?? null
            : dates.signupEndsAt ?? dates.startsAt ?? null;
    if (anchorTime === null || !Number.isFinite(anchorTime)) return item;
    return { ...item, time: startOfDay(anchorTime) + item.offsetMinutes * 60_000 };
  });
}

export const DISTRIBUTE_ACTION_ID = '__distribute_assignments__';

/** Synthetic block ids and the anchor they stand for. */
export const SYNTHETIC_ANCHORS: Readonly<Record<string, ScheduleAnchor>> = {
  __start__: 'hackathon_start',
  __signup__: 'signup_start',
  __end__: 'hackathon_end',
};

/** Synthetic blocks carry block actions and are never shown in itineraries. */
export const SYNTHETIC_BLOCK_IDS: readonly string[] = Object.keys(SYNTHETIC_ANCHORS);

/**
 * Convert an event's absolute itinerary into template form: real blocks are
 * anchored to the hackathon start with the offset they had, so applying the
 * template onto other dates keeps the relative spacing. Synthetic blocks keep
 * their symbolic anchor (`__start__` → hackathon start, `__signup__` → signup
 * open, `__end__` → hackathon end) — they are the carriers of block actions.
 *
 * Without a start date there is no reference, so the literal times are kept
 * (legacy behaviour) rather than inventing offsets.
 */
export function toRelativeSchedule(items: ScheduleItem[], startsAt: number | null | undefined): ScheduleItem[] {
  return items.map((item) => {
    const synthetic = SYNTHETIC_ANCHORS[item.id];
    if (synthetic !== undefined) return { ...item, anchor: synthetic, offsetMinutes: 0 };
    if (startsAt == null || !Number.isFinite(startsAt)) return item;
    const offsetMinutes = Math.round((item.time - startOfDay(startsAt)) / 60_000);
    return { ...item, anchor: 'hackathon_start' as ScheduleAnchor, offsetMinutes };
  });
}

/**
 * Inject a `distribute_assignments` action into the pinned Start block so the
 * pool goes out when the hackathon starts.
 *
 * The Start block is normally synthesised by the UI as schedule id `__start__`
 * (carrying only ops). If the caller passed a real schedule with no `__start__`
 * block but a `startsAt`, we add that block. If there's no start time at all we
 * leave the schedule alone — the assignments stay on the event and can be
 * distributed from a block later.
 */
export function withAssignmentDistribution(
  schedule: ScheduleItem[],
  strategy: AssignmentStrategy,
  startsAt: number | null | undefined,
): ScheduleItem[] {
  const startIdx = schedule.findIndex((s) => s.id === '__start__');
  const action: ScheduleAction = { id: DISTRIBUTE_ACTION_ID, type: 'distribute_assignments', mode: strategy };
  if (startIdx !== -1) {
    const block = schedule[startIdx]!;
    const existing = block.actions ?? [];
    // Idempotent: replace any prior distribute action, keep everything else.
    const without = existing.filter((a) => a.type !== 'distribute_assignments');
    const next = [...without, action];
    const out = [...schedule];
    out[startIdx] = { ...block, actions: next };
    return out;
  }
  // No Start block yet. Without a start time there's nothing to hang the action
  // on, so leave the schedule alone — the pool stays on the event.
  if (startsAt == null) return schedule;
  return [
    ...schedule,
    { id: '__start__', time: startsAt, title: 'Event starts', kind: 'custom', actions: [action] },
  ];
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
  signup_starts_at: number | null;
  signup_ends_at: number | null;
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
  assignments_json: string | null;
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
  let assignments: Assignment[] = [];
  try {
    assignments = row.assignments_json ? (JSON.parse(row.assignments_json) as Assignment[]) : [];
    if (!Array.isArray(assignments)) assignments = [];
  } catch {
    assignments = [];
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
    signupStartsAt: row.signup_starts_at,
    signupEndsAt: row.signup_ends_at,
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
    assignments,
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
  signupStartsAt?: number | null;
  signupEndsAt?: number | null;
  /** Optional form config to seed the event with (defaults to DEFAULT_FORM). */
  form?: Partial<FormConfig>;
  panelChannelId?: string | null;
  announcementChannelId?: string | null;
  scheduleChannelId?: string | null;
  categoryId?: string | null;
  cleanupDelayHours?: number;
  schedule?: ScheduleItem[];
  announcements?: AnnouncementTemplate[];
  assignments?: Assignment[];
  /** How the assignment pool is dealt out at event start. Defaults to 'random'. */
  assignmentStrategy?: AssignmentStrategy;
}

export async function createEvent(db: Db, actor: string, guildId: string, input: CreateEventInput): Promise<Result<HackathonEvent>> {
  const name = input.name.trim().slice(0, 100);
  if (name.length < 3) return err('bad_name', 'Event name must be at least 3 characters.');
  if (input.startsAt !== null && input.startsAt !== undefined && input.endsAt !== null && input.endsAt !== undefined) {
    if (input.endsAt <= input.startsAt) return err('bad_dates', 'The event must end after it starts.');
  }
  if (input.startsAt !== null && input.startsAt !== undefined) {
    const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);
    if (input.startsAt < todayStart.getTime()) return err('bad_dates', 'Event cannot start in the past.');
  }
  if (input.signupStartsAt !== null && input.signupStartsAt !== undefined && input.signupEndsAt !== null && input.signupEndsAt !== undefined) {
    if (input.signupEndsAt <= input.signupStartsAt) return err('bad_dates', 'Signup must end after it starts.');
  }
  if (input.signupEndsAt !== null && input.signupEndsAt !== undefined && input.startsAt !== null && input.startsAt !== undefined) {
    if (input.signupEndsAt > input.startsAt) return err('bad_dates', 'Signup must end before the hackathon starts.');
  }

  const id = newId('ev');
  const form: FormConfig = normalizeFormUpdate({ ...DEFAULT_FORM, ...(input.form ?? {}) }, {});
  // The pool is a snapshot of the assignment collection picked at creation.
  // No pool chosen → nothing is distributed (no silent defaults).
  const assignments = normalizeAssignments(input.assignments ?? []);
  const strategy: AssignmentStrategy = input.assignmentStrategy === 'same' ? 'same' : 'random';
  // Template-authored items carry an anchor instead of a date — resolve them
  // onto this event's dates before anything else looks at `time`.
  const anchored = resolveScheduleAnchors(normalizeSchedule(input.schedule ?? []), {
    startsAt: input.startsAt ?? null,
    endsAt: input.endsAt ?? null,
    signupStartsAt: input.signupStartsAt ?? null,
    signupEndsAt: input.signupEndsAt ?? null,
  });
  // Assignments go out when the hackathon starts: inject a distribute action into
  // the pinned Start block — but only when there is actually a pool to deal.
  const schedule = assignments.length > 0
    ? withAssignmentDistribution(anchored, strategy, input.startsAt ?? null)
    : anchored;
  // Single INSERT is atomic on its own; the transaction keeps the audit row and
  // the read-back (which must observe this insert) in the same unit.
  return db.transaction(async () => {
    await db.run(
      `INSERT INTO events (id, guild_id, name, description, starts_at, ends_at, signup_starts_at, signup_ends_at, status, form_json, panel_channel_id, category_id, cleanup_delay_hours, match_at, match_locked, discord_event_ids, announcement_channel_id, schedule_channel_id, schedule_json, announcements_json, assignments_json, announced_schedule_ids, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'draft', ?, ?, ?, ?, ?, 0, '[]', ?, ?, ?, ?, ?, '[]', ?, ?)`,
      id,
      guildId,
      name,
      input.description?.trim() ?? '',
      input.startsAt ?? null,
      input.endsAt ?? null,
      input.signupStartsAt ?? null,
      input.signupEndsAt ?? null,
      JSON.stringify(form),
      input.panelChannelId ?? null,
      input.categoryId ?? null,
      Number.isFinite(Number(input.cleanupDelayHours)) ? Math.max(0, Math.min(720, Number(input.cleanupDelayHours))) : 24,
      null,
      input.announcementChannelId ?? null,
      input.scheduleChannelId ?? null,
      JSON.stringify(schedule),
      JSON.stringify(input.announcements ?? []),
      JSON.stringify(assignments),
      Date.now(),
      Date.now(),
    );
    await audit(db, actor, 'event.create', id, { name });
    const created = await getEvent(db, id);
    return ok(created!);
  });
}

export async function getEvent(db: Db, eventId: string): Promise<HackathonEvent | null> {
  const row = await db.get<EventRow>('SELECT * FROM events WHERE id = ?', eventId);
  return row === undefined ? null : toEvent(row);
}

export async function listEvents(db: Db, guildId: string): Promise<HackathonEvent[]> {
  const rows = await db.all<EventRow>('SELECT * FROM events WHERE guild_id = ? ORDER BY created_at DESC', guildId);
  return rows.map(toEvent);
}

export async function getActiveEvent(db: Db, guildId: string): Promise<HackathonEvent | null> {
  const row = await db.get<EventRow>(
    "SELECT * FROM events WHERE guild_id = ? AND status = 'active' ORDER BY created_at DESC LIMIT 1",
    guildId,
  );
  return row === undefined ? null : toEvent(row);
}

export async function updateEvent(
  db: Db,
  actor: string,
  eventId: string,
  update: Partial<Pick<HackathonEvent, 'name' | 'description' | 'startsAt' | 'endsAt' | 'signupStartsAt' | 'signupEndsAt' | 'panelChannelId' | 'announcementChannelId' | 'scheduleChannelId' | 'categoryId' | 'cleanupDelayHours' | 'matchAt' | 'discordEventIds' | 'schedule' | 'announcements' | 'assignments'>>,
): Promise<Result<HackathonEvent>> {
  // Read current → validate → write → read back: a read-modify-write that must
  // not interleave with a concurrent update (last-writer-wins per field would
  // otherwise mix two editors' changes).
  return db.transaction(async () => {
    const event = await getEvent(db, eventId);
    if (event === null) return err('not_found', 'Event not found.');

    const name = update.name !== undefined ? update.name.trim().slice(0, 100) || event.name : event.name;
    const description = update.description !== undefined ? update.description.slice(0, 1000) : event.description;
    const startsAt = update.startsAt !== undefined ? update.startsAt : event.startsAt;
    const endsAt = update.endsAt !== undefined ? update.endsAt : event.endsAt;
    const signupStartsAt = update.signupStartsAt !== undefined ? update.signupStartsAt : event.signupStartsAt;
    const signupEndsAt = update.signupEndsAt !== undefined ? update.signupEndsAt : event.signupEndsAt;
    if (startsAt !== null && endsAt !== null && endsAt <= startsAt) {
      return err('bad_dates', 'The event must end after it starts.');
    }
    if (signupStartsAt !== null && signupEndsAt !== null && signupEndsAt <= signupStartsAt) {
      return err('bad_dates', 'Signup must end after it starts.');
    }
    if (signupEndsAt !== null && startsAt !== null && signupEndsAt > startsAt) {
      return err('bad_dates', 'Signup must end before the hackathon starts.');
    }
    if (update.startsAt !== undefined && startsAt !== null) {
      const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);
      if (startsAt < todayStart.getTime()) return err('bad_dates', 'Event cannot start in the past.');
    }
    const cleanupDelayHours =
      update.cleanupDelayHours !== undefined
        ? Math.min(Math.max(Math.round(update.cleanupDelayHours), 0), 24 * 30)
        : event.cleanupDelayHours;

    await db.run(
      `UPDATE events SET name = ?, description = ?, starts_at = ?, ends_at = ?, signup_starts_at = ?, signup_ends_at = ?, panel_channel_id = ?, announcement_channel_id = ?, schedule_channel_id = ?, category_id = ?, cleanup_delay_hours = ?, match_at = ?, discord_event_ids = ?, schedule_json = ?, announcements_json = ?, assignments_json = ?, updated_at = ?
       WHERE id = ?`,
      name,
      description,
      startsAt,
      endsAt,
      signupStartsAt,
      signupEndsAt,
      update.panelChannelId !== undefined ? update.panelChannelId : event.panelChannelId,
      update.announcementChannelId !== undefined ? update.announcementChannelId : event.announcementChannelId,
      update.scheduleChannelId !== undefined ? update.scheduleChannelId : event.scheduleChannelId,
      update.categoryId !== undefined ? update.categoryId : event.categoryId,
      cleanupDelayHours,
      update.matchAt !== undefined ? update.matchAt : event.matchAt,
      update.discordEventIds !== undefined ? JSON.stringify(update.discordEventIds) : JSON.stringify(event.discordEventIds),
      update.schedule !== undefined
        ? JSON.stringify(
            resolveScheduleAnchors(normalizeSchedule(update.schedule), { startsAt, endsAt, signupStartsAt, signupEndsAt }),
          )
        : JSON.stringify(event.schedule),
      update.announcements !== undefined ? JSON.stringify(normalizeAnnouncements(update.announcements)) : JSON.stringify(event.announcements),
      update.assignments !== undefined ? JSON.stringify(normalizeAssignments(update.assignments)) : JSON.stringify(event.assignments),
      Date.now(),
      eventId,
    );
    await audit(db, actor, 'event.update', eventId, { name, startsAt, endsAt, matchAt: update.matchAt !== undefined ? update.matchAt : undefined, schedule: update.schedule !== undefined ? update.schedule.length : undefined });
    const updated = await getEvent(db, eventId);
    return ok(updated!);
  });
}

// ─── lifecycle ───────────────────────────────────────────────────────────────

export async function activateEvent(db: Db, actor: string, eventId: string): Promise<Result<HackathonEvent>> {
  // Status check → flip: atomic so two concurrent activates cannot disagree.
  return db.transaction(async () => {
    const event = await getEvent(db, eventId);
    if (event === null) return err('not_found', 'Event not found.');
    if (event.status === 'active') return ok(event);
    if (event.status === 'ended') return err('already_ended', 'Ended events cannot be reactivated — clone it instead.');

    // Multiple events can be active simultaneously.
    await db.run("UPDATE events SET status = 'active', updated_at = ? WHERE id = ?", Date.now(), eventId);
    await audit(db, actor, 'event.activate', eventId, null);
    const updated = await getEvent(db, eventId);
    return ok(updated!);
  });
}

export async function endEvent(db: Db, actor: string, eventId: string): Promise<Result<HackathonEvent>> {
  return db.transaction(async () => {
    const event = await getEvent(db, eventId);
    if (event === null) return err('not_found', 'Event not found.');
    await db.run("UPDATE events SET status = 'ended', updated_at = ? WHERE id = ?", Date.now(), eventId);
    await audit(db, actor, 'event.end', eventId, null);
    const updated = await getEvent(db, eventId);
    return ok(updated!);
  });
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

export async function updateEventForm(db: Db, actor: string, eventId: string, update: Partial<FormConfig>): Promise<Result<FormConfig>> {
  // Read current → merge → write: atomic so the stored form is the merge of one
  // editor's update, not an interleave of two.
  return db.transaction(async () => {
    const event = await getEvent(db, eventId);
    if (event === null) return err('not_found', 'Event not found.');
    const current = getEventForm(db, event, DEFAULT_FORM);
    const next = normalizeFormUpdate(current, update);
    await db.run('UPDATE events SET form_json = ?, updated_at = ? WHERE id = ?', JSON.stringify(next), Date.now(), eventId);
    await audit(db, actor, 'event.form_update', eventId, null);
    return ok(next);
  });
}

// ─── templates ───────────────────────────────────────────────────────────────

export interface Template {
  id: string;
  guildId: string | null;
  name: string;
  kind: 'event' | 'form' | 'announcement' | 'assignments';
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

export async function saveTemplate(
  db: Db,
  actor: string,
  guildId: string | null,
  name: string,
  kind: Template['kind'],
  json: string,
): Promise<Result<Template>> {
  const clean = name.trim().slice(0, 80);
  if (clean.length < 2) return err('bad_name', 'Template name must be at least 2 characters.');
  JSON.parse(json); // must be valid JSON
  const id = newId('tpl');
  await db.run(
    'INSERT INTO event_templates (id, guild_id, name, kind, json, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    id,
    guildId,
    clean,
    kind,
    json,
    Date.now(),
  );
  await audit(db, actor, 'template.save', id, { name: clean, kind });
  const row = await db.get<Parameters<typeof templateRow>[0]>('SELECT * FROM event_templates WHERE id = ?', id);
  return ok(templateRow(row!));
}

export async function listTemplates(db: Db, guildId: string, kind?: Template['kind']): Promise<Template[]> {
  // Seeding is count-then-insert per kind: wrap the whole thing so two callers
  // cannot both observe an empty kind and seed it twice.
  return db.transaction(async () => {
    // Seed basic templates on first use for each kind
    const seedIfEmpty = async (k: Template['kind'], seeds: { name: string; json: string }[]): Promise<void> => {
      const c = await db.get<{ c: number }>(
        'SELECT COUNT(*) as c FROM event_templates WHERE (guild_id = ? OR guild_id IS NULL) AND kind = ?',
        guildId,
        k,
      );
      if ((c?.c ?? 0) === 0) {
        for (const s of seeds) {
          const id = newId('tpl');
          await db.run('INSERT INTO event_templates (id, guild_id, name, kind, json, created_at) VALUES (?, ?, ?, ?, ?, ?)', id, guildId, s.name, k, s.json, Date.now());
        }
      }
    };
    if (kind === undefined || kind === 'announcement') {
      await seedIfEmpty('announcement', [
        { name: "Initial — signups open", json: JSON.stringify({ title: "{event} — signups open!", message: "Listen up {everyone} **{event}** is live! {event_description} Starts {start_date} {timer} — sign up in {panel}\n\nFull schedule:\n{schedule}", trigger: "manual", channelId: null }) },
        { name: "Signup panel", json: JSON.stringify({ title: "Join {event}", message: "Hey {everyone}, the signup panel is ready in {panel} — hit Join! Starts {start_date} {timer}", trigger: "manual", channelId: null }) },
        { name: "Schedule — next up", json: JSON.stringify({ title: "{schedule_title}", message: "⏰ **{schedule_title}** — {schedule_desc} at {schedule_time} {timer_schedule} {everyone}\n\n{schedule}", trigger: "schedule", channelId: null }) },
      ]);
    }
    if (kind === undefined || kind === 'form') {
      await seedIfEmpty('form', [
        { name: "Default signup form", json: JSON.stringify(DEFAULT_FORM) },
      ]);
      // If guild has no default form selected, point it at the seeded one
      const gsRow = await db.get<{ default_form_template_id: string | null }>('SELECT default_form_template_id FROM guild_settings WHERE guild_id = ?', guildId);
      if (gsRow && !gsRow.default_form_template_id) {
        const seeded = await db.get<{ id: string }>("SELECT id FROM event_templates WHERE guild_id = ? AND kind = 'form' ORDER BY created_at DESC LIMIT 1", guildId);
        if (seeded) await db.run('UPDATE guild_settings SET default_form_template_id = ?, updated_at = ? WHERE guild_id = ?', seeded.id, Date.now(), guildId);
      } else if (!gsRow) {
        // guild_settings row doesn't exist yet — it will be created on first Config save; seed will be picked up then via fallback in createEvent
      }
    }
    if (kind === undefined || kind === 'assignments') {
      await seedIfEmpty('assignments', [
        { name: "Default assignments", json: JSON.stringify({ assignments: defaultAssignments() }) },
      ]);
    }
    if (kind === undefined || kind === 'event') {
      // Default hackathon event: signup 7 days before, 48h hackathon, a few schedule blocks with signup + announcements via schedule
      const now = Date.now();
      const hackStarts = now + 14 * 24 * 3600 * 1000; // 2 weeks out so it passes past-date validation
      const hackEnds = hackStarts + 2 * 24 * 3600 * 1000;
      const signupStarts = hackStarts - 7 * 24 * 3600 * 1000;
      const signupEnds = hackStarts;
      const baseDay = new Date(hackStarts);
      baseDay.setHours(12, 0, 0, 0);
      const sched = [
        { id: 'sch_signup', time: signupStarts, title: 'Signups open', description: 'Signup window opens — post signup panel', kind: 'custom', actions: [{ id: 'a1', type: 'post_signup' }] },
        { id: 'sch_dinner', time: new Date(new Date(hackStarts).setHours(18, 0, 0, 0)).getTime(), title: 'Dinner', description: 'Pizza in the kitchen', kind: 'food', actions: [{ id: 'a2', type: 'announce', title: '{schedule_title}', message: '🍽️ {schedule_title} — {schedule_desc} at {schedule_time} {everyone}' }] },
        { id: 'sch_fika', time: new Date(new Date(hackStarts).setHours(15, 0, 0, 0)).getTime(), title: 'Fika', description: 'Coffee & buns', kind: 'break' },
        { id: 'sch_voting', time: new Date(new Date(hackEnds).setHours(14, 0, 0, 0)).getTime(), title: 'Voting', description: 'Vote for your favourite', kind: 'voting', actions: [{ id: 'a3', type: 'announce', title: 'Voting time!', message: '🗳️ {schedule_title} — {schedule_desc} {timer_schedule} {everyone}' }] },
      ];
      await seedIfEmpty('event', [
        { name: 'Default Hackathon', json: JSON.stringify({ name: 'ChasHack', description: '48-hour hackathon — build, ship, demo!', cleanupDelayHours: 48, signupStartsAt: signupStarts, signupEndsAt: signupEnds, startsAt: hackStarts, endsAt: hackEnds, form: DEFAULT_FORM, schedule: sched, assignmentStrategy: 'random' }) },
      ]);
    }
    const rows =
      kind === undefined
        ? await db.all<Parameters<typeof templateRow>[0]>(
            'SELECT * FROM event_templates WHERE guild_id = ? OR guild_id IS NULL ORDER BY created_at DESC',
            guildId,
          )
        : await db.all<Parameters<typeof templateRow>[0]>(
            'SELECT * FROM event_templates WHERE (guild_id = ? OR guild_id IS NULL) AND kind = ? ORDER BY created_at DESC',
            guildId,
            kind,
          );
    return rows.map(templateRow);
  });
}

export async function deleteTemplate(db: Db, actor: string, templateId: string): Promise<Result<void>> {
  const res = await db.run('DELETE FROM event_templates WHERE id = ?', templateId);
  if (res.changes === 0) return err('not_found', 'Template not found.');
  await audit(db, actor, 'template.delete', templateId, null);
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
    ...(parsed.assignments !== undefined ? { assignments: normalizeAssignments(parsed.assignments) } : {}),
    ...(parsed.assignmentStrategy !== undefined
      ? { assignmentStrategy: parsed.assignmentStrategy === 'same' ? 'same' : 'random' }
      : {}),
  };
}

function normalizeSchedule(items: ScheduleItem[]): ScheduleItem[] {
  if (!Array.isArray(items)) return [];
  const out: ScheduleItem[] = [];
  for (const raw of items) {
    const rec = raw as unknown as Record<string, unknown>;
    const anchorRaw = String(rec.anchor ?? '').trim();
    const offsetRaw = rec.offsetMinutes;
    const hasAnchor = (SCHEDULE_ANCHORS as readonly string[]).includes(anchorRaw)
      && typeof offsetRaw === 'number' && Number.isFinite(offsetRaw);
    // An anchored item may arrive without a usable `time` (templates carry the
    // relation, not a date) — 0 is only a placeholder, resolution replaces it.
    const rawTime = typeof rec.time === 'number' && Number.isFinite(rec.time) ? rec.time : hasAnchor ? 0 : null;
    if (rawTime === null) continue;
    const title = String((raw as unknown as Record<string, unknown>).title ?? '').trim().slice(0, 80);
    if (!title) continue;
    const id = String((raw as unknown as Record<string, unknown>).id ?? '').trim() || newId('sch');
    const description = String((raw as unknown as Record<string, unknown>).description ?? '').trim().slice(0, 200) || undefined;
    const kindRaw = String((raw as unknown as Record<string, unknown>).kind ?? 'custom').trim() as ScheduleItem['kind'];
    const kind: ScheduleItem['kind'] = ['food', 'break', 'voting', 'prize', 'talk', 'custom'].includes(kindRaw ?? '') ? kindRaw : 'custom';
    // actions: per-item ops (announce + lock/match + signup + assignments)
    let actions: ScheduleAction[] | undefined = undefined
    const rawActions = (raw as unknown as Record<string, unknown>).actions
    if (Array.isArray(rawActions)) {
      const norm: ScheduleAction[] = []
      for (const a of rawActions as unknown[]) {
        const ar = a as Record<string, unknown>
        if (!ar || typeof ar.type !== 'string') continue
        const atype = String(ar.type).trim() as ScheduleAction['type']
        if (!['announce','lock_teams','assign_random','auto_match','post_signup','distribute_assignments'].includes(atype)) continue
        const aid = String(ar.id ?? '').trim() || newId('sact')
        if (atype === 'announce') {
          if (typeof ar.title !== 'string' || typeof ar.message !== 'string') continue
          const atitle = String(ar.title).trim().slice(0, 100)
          const amsg = String(ar.message).trim().slice(0, 2000)
          if (!atitle || !amsg) continue
          const chan = ar.channelId !== undefined && ar.channelId !== null ? String(ar.channelId).trim() || null : null
          norm.push({ id: aid, type: 'announce', title: atitle, message: amsg, ...(chan ? { channelId: chan } : {}) })
        } else if (atype === 'post_signup') {
          const chan = ar.channelId !== undefined && ar.channelId !== null ? String(ar.channelId).trim() || null : null
          norm.push({ id: aid, type: 'post_signup', ...(chan ? { channelId: chan } : {}) })
        } else if (atype === 'distribute_assignments') {
          const mode = String(ar.mode ?? 'random').trim() as ScheduleAction['mode']
          const m = mode === 'same' ? 'same' : 'random'
          const assignmentId = ar.assignmentId !== undefined && ar.assignmentId !== null ? String(ar.assignmentId).trim() || undefined : undefined
          norm.push({ id: aid, type: 'distribute_assignments', mode: m, ...(assignmentId ? { assignmentId } : {}) })
        } else {
          norm.push({ id: aid, type: atype })
        }
      }
      if (norm.length > 0) actions = norm.slice(0, 10)
    }
    out.push({ id, time: rawTime, title, ...(description ? { description } : {}), ...(kind ? { kind } : {}), ...(actions ? { actions } : {}), ...(hasAnchor ? { anchor: anchorRaw as ScheduleAnchor, offsetMinutes: Math.round(offsetRaw as number) } : {}) });
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

export function normalizeAssignments(items: unknown): Assignment[] {
  if (!Array.isArray(items)) return [];
  const out: Assignment[] = [];
  for (const raw of items as unknown[]) {
    const r = raw as Record<string, unknown>;
    if (!r || typeof r.title !== 'string' || typeof r.instructions !== 'string') continue;
    const title = String(r.title).trim().slice(0, 100);
    const instructions = String(r.instructions).trim().slice(0, 2000);
    if (!title || !instructions) continue;
    const id = String(r.id ?? '').trim() || newId('assign');
    const description = typeof r.description === 'string' ? String(r.description).trim().slice(0, 300) || undefined : undefined;
    // Only accept http(s) URLs — anything else can't be attached by Discord anyway.
    const rawImage = typeof r.imageUrl === 'string' ? r.imageUrl.trim() : '';
    const imageUrl = /^https?:\/\/\S+$/.test(rawImage) ? rawImage.slice(0, 500) : undefined;
    out.push({ id, title, instructions, ...(description ? { description } : {}), ...(imageUrl ? { imageUrl } : {}) });
  }
  return out.slice(0, 50);
}

export function defaultAssignments(): Assignment[] {
  return [
    { id: newId('assign'), title: 'Mystery API', instructions: 'Here is your assignment {team}: build a bot that greets newcomers in a creative way. Bonus if it pings {everyone} when someone joins!', description: 'Creative greeting bot' },
    { id: newId('assign'), title: 'Data dash', instructions: 'Here is your assignment {team}: visualize the pantry stock for {event} — show what’s missing across stores.', description: 'Pantry viz' },
    { id: newId('assign'), title: 'Mini-game', instructions: 'Here is your assignment {team}: make a tiny Discord mini-game (quiz, poll, or meme generator) for {event}.', description: 'Fun intermission' },
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
      // Fallback: once the hackathon has started, run matching + lock even when
      // the organizer never wired it up — no auto_match/assign_random action on
      // any schedule block and no match_at from the slash command. Explicit
      // config always wins; the lock never blocks manual match runs.
      const hasMatchAction = (event.schedule ?? []).some((s) =>
        (s.actions ?? []).some((a) => a.type === 'auto_match' || a.type === 'assign_random'),
      );
      if (
        event.startsAt !== null &&
        event.startsAt <= now &&
        !event.matchLocked &&
        event.matchAt === null &&
        !hasMatchAction
      ) {
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
export async function setMatchAt(db: import('../../shared/db.js').Db, actor: string, eventId: string, matchAt: number | null): Result<HackathonEvent> {
  const res = await updateEvent(db, actor, eventId, { matchAt });
  if (res.ok) await audit(db, actor, 'event.match_schedule', eventId, { matchAt });
  return res;
}

/** Tag renderer for announcement templates. Tags: {event} {event_description} {panel} {everyone} {here} {timer} {startsAt} {start_date} {endsAt} {end_date} {schedule} {schedule_title} {schedule_desc} {schedule_time} {timer_schedule} */
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
    const f = `<t:${Math.floor(event.startsAt/1000)}:F>`
    const r = `<t:${Math.floor(event.startsAt/1000)}:R>`
    content = content.replaceAll('{timer}', r)
    content = content.replaceAll('{startsAt}', f)
    content = content.replaceAll('{start_date}', f)
  } else {
    content = content.replaceAll('{timer}', '')
    content = content.replaceAll('{startsAt}', 'TBA')
    content = content.replaceAll('{start_date}', 'TBA')
  }
  if (event.endsAt !== null) {
    const f2 = `<t:${Math.floor(event.endsAt/1000)}:F>`
    content = content.replaceAll('{endsAt}', f2)
    content = content.replaceAll('{end_date}', f2)
  } else { content = content.replaceAll('{endsAt}', 'TBA'); content = content.replaceAll('{end_date}', 'TBA') }

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
export async function markScheduleAnnounced(db: import('../../shared/db.js').Db, eventId: string, scheduleId: string): void {
  const event = await getEvent(db, eventId)
  if (!event) return
  const next = [...new Set([...(event.announcedScheduleIds ?? []), scheduleId])]
  db.prepare('UPDATE events SET announced_schedule_ids = ?, updated_at = ? WHERE id = ?').run(JSON.stringify(next), Date.now(), eventId)
}
