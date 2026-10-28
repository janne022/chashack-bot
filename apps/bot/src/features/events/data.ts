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
import { getForm } from '../form/data.js';
import { normalizeFormUpdate, validateCustomQuestions, validBannerUrl, normalizeAppearance } from '../form/domain.js';

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
  /** Absent means legacy clock time; elapsed uses minutes from the exact anchor. */
  offsetMode?: 'elapsed';
  /** Optionally constrain elapsed activities to the event's start/end window. */
  withinEvent?: boolean;
}

export interface ScheduleAction {
  id: string;
  type: 'announce' | 'lock_teams' | 'assign_random' | 'auto_match' | 'post_signup' | 'publish_schedule' | 'distribute_assignments';
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
    let time = SYNTHETIC_ANCHORS[item.id] ? anchorTime : (item.offsetMode === 'elapsed' ? anchorTime : startOfDay(anchorTime)) + item.offsetMinutes * 60_000;
    if (!SYNTHETIC_ANCHORS[item.id] && item.offsetMode === 'elapsed' && item.withinEvent) {
      if (dates.startsAt != null) time = Math.max(time, dates.startsAt);
      if (dates.endsAt != null) time = Math.min(time, dates.endsAt);
    }
    return { ...item, time };
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
    if (item.offsetMode === 'elapsed' && item.anchor !== undefined && item.offsetMinutes !== undefined) return item;
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
 * block we add one. Without a start time the block remains pending at time 0;
 * the scheduler skips it until the start anchor can be resolved.
 */
export function withAssignmentDistribution(
  schedule: ScheduleItem[],
  strategy: AssignmentStrategy,
  startsAt: number | null | undefined,
): ScheduleItem[] {
  if (schedule.some(block => block.id !== '__start__' && block.actions?.some(action => action.type === 'distribute_assignments'))) return schedule;
  const startIdx = schedule.findIndex((s) => s.id === '__start__');
  const action: ScheduleAction = { id: DISTRIBUTE_ACTION_ID, type: 'distribute_assignments', mode: strategy };
  if (startIdx !== -1) {
    const block = schedule[startIdx]!;
    const existing = block.actions ?? [];
    // Idempotent: replace any prior distribute action, keep everything else.
    const without = existing.filter((a) => a.type !== 'distribute_assignments');
    const next = [...without, action];
    const out = [...schedule];
    out[startIdx] = { ...block, actions: next, ...(startsAt == null && block.time === 0 ? { anchor: 'hackathon_start' as const, offsetMinutes: 0 } : {}) };
    return out;
  }
  return [
    ...schedule,
    { id: '__start__', time: startsAt ?? 0, title: 'Event starts', kind: 'custom', actions: [action], anchor: 'hackathon_start', offsetMinutes: 0 },
  ];
}

/** An anchored placeholder must not be treated as an overdue Unix-epoch action. */
export function scheduleTimeResolved(event: Pick<HackathonEvent, 'startsAt' | 'endsAt' | 'signupStartsAt' | 'signupEndsAt'>, item: ScheduleItem): boolean {
  if (item.time !== 0 || item.anchor === undefined || item.offsetMinutes === undefined) return true;
  const anchorTime = item.anchor === 'hackathon_start' ? event.startsAt
    : item.anchor === 'hackathon_end' ? event.endsAt ?? event.startsAt
    : item.anchor === 'signup_start' ? event.signupStartsAt ?? event.startsAt
    : event.signupEndsAt ?? event.startsAt;
  return anchorTime != null;
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
  allowIncompleteForm?: boolean;
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

  if (input.form?.customQuestions !== undefined) {
    const questions = validateCustomQuestions(input.form.customQuestions, { ...await getForm(db, guildId), ...input.form }, input.allowIncompleteForm === true, true);
    if (!questions.ok) return err('invalid_questions', questions.errors.join('; '));
  }
  if ((input.form?.appearance !== undefined && !normalizeAppearance(input.form.appearance)) || !validBannerUrl(input.form?.bannerUrl) || (input.form?.themePreset !== undefined && !['default', 'halloween', 'christmas'].includes(input.form.themePreset)) ||
      (input.form?.accentColor !== undefined && !/^#[0-9a-fA-F]{6}$/.test(input.form.accentColor))) return err('invalid_theme', 'Theme preset, banner URL, or accent color is invalid.');

  const id = newId('ev');
  const form: FormConfig = normalizeFormUpdate({ ...await getForm(db, guildId), ...(input.form ?? {}), enforceSignupWindow: input.form?.enforceSignupWindow ?? true }, {});
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
    await audit(db, actor, 'event.create', id, { name }, guildId);
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
    await db.get('SELECT id FROM events WHERE id = ? FOR UPDATE', eventId);
    const event = await getEvent(db, eventId);
    if (event === null) return err('not_found', 'Event not found.');

    const name = update.name !== undefined ? update.name.trim().slice(0, 100) || event.name : event.name;
    const description = update.description !== undefined ? update.description.slice(0, 1000) : event.description;
    const startsAt = update.startsAt !== undefined ? update.startsAt : event.startsAt;
    const delta = startsAt !== null && event.startsAt !== null ? startsAt - event.startsAt : 0;
    const shift = (value: number | null) => value === null ? null : value + delta;
    const endsAt = update.endsAt !== undefined ? update.endsAt : shift(event.endsAt);
    const signupStartsAt = update.signupStartsAt !== undefined ? update.signupStartsAt : shift(event.signupStartsAt);
    const signupEndsAt = update.signupEndsAt !== undefined ? update.signupEndsAt : shift(event.signupEndsAt);
    if (startsAt !== null && endsAt !== null && endsAt <= startsAt) {
      return err('bad_dates', 'The event must end after it starts.');
    }
    if (signupStartsAt !== null && signupEndsAt !== null && signupEndsAt <= signupStartsAt) {
      return err('bad_dates', 'Signup must end after it starts.');
    }
    if (update.startsAt !== undefined && startsAt !== null && startsAt !== event.startsAt) {
      const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);
      if (startsAt < todayStart.getTime()) return err('bad_dates', 'Event cannot start in the past.');
    }
    const cleanupDelayHours =
      update.cleanupDelayHours !== undefined
        ? Math.min(Math.max(Math.round(update.cleanupDelayHours), 0), 24 * 30)
        : event.cleanupDelayHours;

    let nextSchedule = update.schedule !== undefined
      ? resolveScheduleAnchors(normalizeSchedule(update.schedule), { startsAt, endsAt, signupStartsAt, signupEndsAt })
      : resolveScheduleAnchors(event.schedule.map(item => {
        if (item.anchor || !delta || startsAt === null || event.startsAt === null) return item;
        const oldDate = new Date(event.startsAt), newDate = new Date(startsAt), date = new Date(item.time);
        const days = Math.round((Date.UTC(newDate.getFullYear(), newDate.getMonth(), newDate.getDate()) - Date.UTC(oldDate.getFullYear(), oldDate.getMonth(), oldDate.getDate())) / 86400000);
        date.setDate(date.getDate() + days);
        return { ...item, time: date.getTime() };
      }), { startsAt, endsAt, signupStartsAt, signupEndsAt });
    const nextAssignments = update.assignments !== undefined ? normalizeAssignments(update.assignments) : event.assignments;
    // Older undated events had no place to retain a handout. Only add a default
    // on their first start-date assignment, and never override explicit actions.
    if (event.startsAt === null && startsAt !== null && update.schedule === undefined && nextAssignments.length > 0 && !nextSchedule.some(item => item.actions?.some(action => action.type === 'distribute_assignments'))) {
      nextSchedule = withAssignmentDistribution(nextSchedule, 'random', startsAt);
    }

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
      JSON.stringify(nextSchedule),
      update.announcements !== undefined ? JSON.stringify(normalizeAnnouncements(update.announcements)) : JSON.stringify(event.announcements),
      JSON.stringify(nextAssignments),
      Date.now(),
      eventId,
    );
    await audit(db, actor, 'event.update', eventId, { name, startsAt, endsAt, matchAt: update.matchAt !== undefined ? update.matchAt : undefined, schedule: update.schedule !== undefined ? update.schedule.length : undefined }, event.guildId);
    const updated = await getEvent(db, eventId);
    return ok(updated!);
  });
}

// ─── lifecycle ───────────────────────────────────────────────────────────────

export async function activateEvent(db: Db, actor: string, eventId: string): Promise<Result<HackathonEvent>> {
  // Status check → flip: atomic so two concurrent activates cannot disagree.
  return db.transaction(async () => {
    await db.get('SELECT id FROM events WHERE id = ? FOR UPDATE', eventId);
    const event = await getEvent(db, eventId);
    if (event === null) return err('not_found', 'Event not found.');
    if (event.status === 'active') return ok(event);
    if (event.status === 'ended') return err('already_ended', 'Ended events cannot be reactivated — clone it instead.');

    const form = getEventForm(db, event, await getForm(db, event.guildId));
    const questions = validateCustomQuestions(form.customQuestions ?? [], form, false, true);
    if (!questions.ok) return err('invalid_questions', questions.errors.join('; '));

    // Multiple events can be active simultaneously.
    await db.run("UPDATE events SET status = 'active', updated_at = ? WHERE id = ?", Date.now(), eventId);
    await audit(db, actor, 'event.activate', eventId, null, event.guildId);
    const updated = await getEvent(db, eventId);
    return ok(updated!);
  });
}

export async function endEvent(db: Db, actor: string, eventId: string): Promise<Result<HackathonEvent>> {
  return db.transaction(async () => {
    const event = await getEvent(db, eventId);
    if (event === null) return err('not_found', 'Event not found.');
    await db.run("UPDATE events SET status = 'ended', updated_at = ? WHERE id = ?", Date.now(), eventId);
    await audit(db, actor, 'event.end', eventId, null, event.guildId);
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
  if (update.appearance !== undefined && !normalizeAppearance(update.appearance)) return err('invalid_theme', 'Appearance is invalid.');
  // Read current → merge → write: atomic so the stored form is the merge of one
  // editor's update, not an interleave of two.
  return db.transaction(async () => {
    await db.get('SELECT id FROM events WHERE id = ? FOR UPDATE', eventId);
    const event = await getEvent(db, eventId);
    if (event === null) return err('not_found', 'Event not found.');
    const current = getEventForm(db, event, DEFAULT_FORM);
    let next = normalizeFormUpdate(current, update);
    const structure = (form: FormConfig) => JSON.stringify({
      questions: (form.customQuestions ?? []).map((q) => ({
        id: q.id, kind: q.kind, choices: q.choices?.map((c) => c.id).sort() ?? [], required: q.required,
        presentation: q.presentation, visibility: q.visibility, mapping: q.mapping ?? null,
      })).sort((a, b) => a.id.localeCompare(b.id)),
      mappingTargets: { experiences: form.experiences.map((item) => item.id), roleTracks: form.roleTracks.map((item) => item.id), skills: form.skills.map((item) => item.id) },
    });
    if (structure(current) !== structure(next)) {
      const populated = await db.get<{ count: number }>('SELECT COUNT(*) AS count FROM participants WHERE event_id = ?', eventId);
      if (event.status !== 'draft' && Number(populated?.count ?? 0) > 0) return err('form_version_conflict', 'This published event has registrations. Create an explicit version migration before changing question structure.');
      next = { ...next, version: current.version + 1 };
    } else {
      next = { ...next, version: current.version };
    }
    const questionsChanged = JSON.stringify(next.customQuestions ?? []) !== JSON.stringify(current.customQuestions ?? []);
    const questions = validateCustomQuestions(next.customQuestions ?? [], next, event.status === 'draft', event.status !== 'draft' && questionsChanged);
    if (!questions.ok) return err('invalid_questions', questions.errors.join('; '));
    await db.run('UPDATE events SET form_json = ?, updated_at = ? WHERE id = ?', JSON.stringify(next), Date.now(), eventId);
    await audit(db, actor, 'event.form_update', eventId, null, event.guildId);
    return ok(next);
  });
}

// ─── templates ───────────────────────────────────────────────────────────────

export interface Template {
  id: string;
  guildId: string | null;
  name: string;
  kind: 'event' | 'form' | 'announcement' | 'assignments' | 'theme';
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
  await audit(db, actor, 'template.save', id, { name: clean, kind }, guildId);
  const row = await db.get<Parameters<typeof templateRow>[0]>('SELECT * FROM event_templates WHERE id = ?', id);
  return ok(templateRow(row!));
}

export async function listTemplates(db: Db, guildId: string, kind?: Template['kind']): Promise<Template[]> {
  // The handle's transaction queue only serializes this process. Coordinate
  // separate workers as well before inspecting counts or starter markers.
  return db.transaction(async () => {
    await db.get('SELECT pg_advisory_xact_lock(hashtextextended(current_schema() || ? , 0))', ':starter-templates:' + guildId);
    // Seed basic templates on first use for each kind
    const seedIfEmpty = async (k: Template['kind'], seeds: { name: string; json: string }[]): Promise<void> => {
      const c = await db.get<{ c: number }>(
        'SELECT COUNT(*) as c FROM event_templates WHERE (guild_id = ? OR guild_id IS NULL) AND kind = ?',
        guildId,
        k,
      );
      const refreshable = k === 'event' || k === 'announcement';
      const seedKey = 'starter_templates_v2:' + guildId + ':' + k;
      const seeded = refreshable ? await db.get('SELECT value FROM meta WHERE key = ?', seedKey) : undefined;
      if (refreshable ? !seeded : (c?.c ?? 0) === 0) {
        if (refreshable) {
          const marker = await db.run('INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO NOTHING', seedKey, '1');
          if (marker.changes === 0) return;
        }
        for (const s of seeds) {
          const id = newId('tpl');
          await db.run('INSERT INTO event_templates (id, guild_id, name, kind, json, created_at) VALUES (?, ?, ?, ?, ?, ?)', id, guildId, s.name, k, s.json, Date.now());
        }
      }
    };
    if (kind === undefined || kind === 'theme') {
      // Theme defaults are seeded once per guild. An empty library after this
      // marker means the organizer intentionally removed the built-in themes.
      const marker = `template-seeds:theme:${guildId}`;
      await db.get('SELECT pg_advisory_xact_lock(hashtext(?)) AS locked', marker);
      const seeded = await db.get<{ value: string }>('SELECT value FROM meta WHERE key = ?', marker);
      if (!seeded) {
        const themes = [
          { name: 'Default', json: { themePreset: 'default', accentColor: '#55bbda', bannerUrl: null } },
          { name: 'Halloween', json: { themePreset: 'halloween', accentColor: '#ef793e', bannerUrl: null } },
          { name: 'Christmas', json: { themePreset: 'christmas', accentColor: '#347b57', bannerUrl: null } },
        ];
        for (const theme of themes) {
          const exists = await db.get<{ id: string }>("SELECT id FROM event_templates WHERE guild_id = ? AND kind = 'theme' AND name = ? LIMIT 1", guildId, theme.name);
          if (!exists) await db.run('INSERT INTO event_templates (id, guild_id, name, kind, json, created_at) VALUES (?, ?, ?, ?, ?, ?)', newId('tpl'), guildId, theme.name, 'theme', JSON.stringify(theme.json), Date.now());
        }
        await db.run('INSERT INTO meta (key, value) VALUES (?, ?)', marker, 'done');
      }
    }
    if (kind === undefined || kind === 'announcement') {
      await seedIfEmpty('announcement', [
        { name: 'EN · Registration opens', json: JSON.stringify({ title: '{event} · Join us', message: 'Registration is open for **{event}**.\n{event_description}\n\nWe start {startsAt}. Sign up in {panel}.', trigger: 'manual', channelId: null }) },
        { name: 'SV · Anmälan öppnar', json: JSON.stringify({ title: '{event} · Var med', message: 'Anmälan till **{event}** är öppen.\n{event_description}\n\nVi börjar {startsAt}. Anmäl dig i {panel}.', trigger: 'manual', channelId: null }) },
        { name: 'EN · Next activity', json: JSON.stringify({ title: '{schedule_title}', message: '**{schedule_title}** starts {schedule_time}.\n{schedule_desc}', trigger: 'schedule', channelId: null }) },
        { name: 'SV · Nästa programpunkt', json: JSON.stringify({ title: '{schedule_title}', message: '**{schedule_title}** börjar {schedule_time}.\n{schedule_desc}', trigger: 'schedule', channelId: null }) },
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
      const starter = (sv: boolean, modern = true) => ({
        name: 'ChasHack', description: sv ? 'En helg för att bygga tillsammans, lära av varandra och visa vad ni skapat.' : 'A weekend to build together, learn from each other, and show what you made.',
        cleanupDelayHours: 48, form: { ...DEFAULT_FORM, title: sv ? 'Anmäl dig till ChasHack' : 'Join ChasHack', description: sv ? 'Berätta lite om dig själv så hjälper vi dig att hitta ett lag.' : 'Tell us a little about yourself and we’ll help you find a team.', signupMode: 'both', participantChannels: false }, assignmentStrategy: 'random',
        schedule: [
          { id: '__signup__', time: 0, anchor: 'signup_start', offsetMinutes: 0, title: sv ? 'Anmälan öppnar' : 'Registration opens', kind: 'custom', actions: [{ id: 'signup-panel', type: 'post_signup' }, { id: 'publish-schedule', type: 'publish_schedule' }] },
          { id: 'welcome', time: 0, anchor: 'hackathon_start', offsetMinutes: modern ? 0 : 600, ...(modern ? { offsetMode: 'elapsed', withinEvent: true } : {}), title: sv ? 'Välkommen och introduktion' : 'Welcome and introductions', description: sv ? 'Träffa deltagarna och gå igenom helgens upplägg.' : 'Meet the community and get oriented for the weekend.', kind: 'talk' },
          { id: 'fika', time: 0, anchor: 'hackathon_start', offsetMinutes: modern ? 180 : 900, ...(modern ? { offsetMode: 'elapsed', withinEvent: true } : {}), title: 'Fika', description: sv ? 'Kaffe, något gott och en paus tillsammans.' : 'Coffee, something sweet, and a break together.', kind: 'break' },
          { id: 'dinner', time: 0, anchor: 'hackathon_start', offsetMinutes: modern ? 360 : 1080, ...(modern ? { offsetMode: 'elapsed', withinEvent: true } : {}), title: sv ? 'Middag' : 'Dinner', description: sv ? 'Ät tillsammans och byt idéer.' : 'Eat together and exchange ideas.', kind: 'food', actions: [{ id: 'dinner-note', type: 'announce', title: '{schedule_title}', message: '{schedule_desc} · {schedule_time}' }] },
          { id: 'demos', time: 0, anchor: 'hackathon_end', offsetMinutes: modern ? -60 : 840, ...(modern ? { offsetMode: 'elapsed', withinEvent: true } : {}), title: sv ? 'Demo och avslutning' : 'Demos and wrap-up', description: sv ? 'Visa vad ni byggt och vad ni lärt er.' : 'Show what you built and share what you learned.', kind: 'talk' },
        ],
      });
      await seedIfEmpty('event', [
        { name: 'EN · Community build weekend', json: JSON.stringify(starter(false)) },
        { name: 'SV · Bygghelg tillsammans', json: JSON.stringify(starter(true)) },
      ]);
      // Upgrade only byte-for-byte unedited v2 starters. Never recreate deleted
      // rows or rewrite custom templates or existing events.
      const upgradeKey = 'starter_templates_v3:' + guildId + ':event';
      const upgrade = await db.run('INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO NOTHING', upgradeKey, '1');
      if (upgrade.changes !== 0) for (const [name, sv] of [['EN · Community build weekend', false], ['SV · Bygghelg tillsammans', true]] as const) {
        await db.run("UPDATE event_templates SET json = ? WHERE guild_id = ? AND kind = 'event' AND name = ? AND json = ?", JSON.stringify(starter(sv)), guildId, name, JSON.stringify(starter(sv, false)));
      }
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
  const template = await db.get<{ guild_id: string | null }>('SELECT guild_id FROM event_templates WHERE id = ?', templateId);
  if (template === undefined) return err('not_found', 'Template not found.');
  const res = await db.run('DELETE FROM event_templates WHERE id = ?', templateId);
  if (res.changes === 0) return err('not_found', 'Template not found.');
  await audit(db, actor, 'template.delete', templateId, null, template.guild_id);
  return ok(undefined);
}

/** Build CreateEventInput from an 'event' template. */
export function templateToEventInput(json: string): Partial<CreateEventInput> & { assignmentCollectionId?: string } {
  const parsed = JSON.parse(json) as Partial<CreateEventInput & { form: Partial<FormConfig>; assignmentCollectionId: string }>;
  return {
    ...(parsed.name !== undefined ? { name: parsed.name } : {}),
    ...(parsed.description !== undefined ? { description: parsed.description } : {}),
    ...(parsed.cleanupDelayHours !== undefined ? { cleanupDelayHours: parsed.cleanupDelayHours } : {}),
    ...(parsed.form !== undefined ? { form: parsed.form } : {}),
    ...(parsed.schedule !== undefined ? { schedule: normalizeSchedule(parsed.schedule) } : {}),
    ...(parsed.assignments !== undefined ? { assignments: normalizeAssignments(parsed.assignments) } : {}),
    ...(typeof parsed.assignmentCollectionId === 'string' && parsed.assignmentCollectionId.trim() ? { assignmentCollectionId: parsed.assignmentCollectionId.trim() } : {}),
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
        if (!['announce','lock_teams','assign_random','auto_match','post_signup','publish_schedule','distribute_assignments'].includes(atype)) continue
        const aid = String(ar.id ?? '').trim() || newId('sact')
        if (atype === 'announce') {
          if (typeof ar.title !== 'string' || typeof ar.message !== 'string') continue
          const atitle = String(ar.title).trim().slice(0, 100)
          const amsg = String(ar.message).trim().slice(0, 2000)
          if (!atitle || !amsg) continue
          const chan = ar.channelId !== undefined && ar.channelId !== null ? String(ar.channelId).trim() || null : null
          norm.push({ id: aid, type: 'announce', title: atitle, message: amsg, ...(chan ? { channelId: chan } : {}) })
        } else if (atype === 'post_signup' || atype === 'publish_schedule') {
          const chan = ar.channelId !== undefined && ar.channelId !== null ? String(ar.channelId).trim() || null : null
          norm.push({ id: aid, type: atype, ...(chan ? { channelId: chan } : {}) })
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
    out.push({ id, time: rawTime, title, ...(description ? { description } : {}), ...(kind ? { kind } : {}), ...(actions ? { actions } : {}), ...(hasAnchor ? { anchor: anchorRaw as ScheduleAnchor, offsetMinutes: Math.round(offsetRaw as number), ...(rec.offsetMode === 'elapsed' ? { offsetMode: 'elapsed' as const, ...(rec.withinEvent === true ? { withinEvent: true } : {}) } : {}) } : {}) });
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
      // Durable operations catch up after downtime; message delivery has its own persisted receipts.
      const announced = new Set(event.announcedScheduleIds ?? [])
      for (const item of event.schedule ?? []) {
        if (!scheduleTimeResolved(event, item)) continue
        if (announced.has(item.id)) continue
        if (item.time <= now) {
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
export async function markCleanupWarned(db: import('../../shared/db.js').Db, eventId: string, tier: '72h' | '24h'): Promise<void> {
  const column = tier === '72h' ? 'cleanup_warned_72h' : 'cleanup_warned_24h';
  await db.run(`UPDATE events SET ${column} = 1, updated_at = ? WHERE id = ?`, Date.now(), eventId);
}

/**
 * Mark the event's teams as locked in (auto-match done, or manually locked).
 * Skips future auto-match; never blocks manual match runs.
 */
export async function markMatchLocked(db: import('../../shared/db.js').Db, eventId: string): Promise<void> {
  await db.run('UPDATE events SET match_locked = 1, updated_at = ? WHERE id = ?', Date.now(), eventId);
}

/** Clear the lock so a future auto-match can fire again. */
export async function markMatchUnlocked(db: import('../../shared/db.js').Db, eventId: string): Promise<void> {
  await db.run('UPDATE events SET match_locked = 0, updated_at = ? WHERE id = ?', Date.now(), eventId);
}

/** Set or clear the scheduled auto-match time (null clears it). */
export async function setMatchAt(db: import('../../shared/db.js').Db, actor: string, eventId: string, matchAt: number | null): Promise<Result<HackathonEvent>> {
  const res = await updateEvent(db, actor, eventId, { matchAt });
  if (res.ok) await audit(db, actor, 'event.match_schedule', eventId, { matchAt }, res.value.guildId);
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

  // The full schedule is available in both global and per-block messages.
  const schedList = (event.schedule ?? []).filter(s => scheduleTimeResolved(event, s)).map(s=> `• <t:${Math.floor(s.time/1000)}:t> ${s.title}`).join('\n') || 'No schedule yet'
  content = content.replaceAll('{schedule}', schedList)
  if (ctx.scheduleItem) {
    content = content.replaceAll('{schedule_title}', ctx.scheduleItem.title)
    content = content.replaceAll('{schedule_desc}', ctx.scheduleItem.description ?? '')
    content = content.replaceAll('{schedule_time}', `<t:${Math.floor(ctx.scheduleItem.time/1000)}:t>`)
    content = content.replaceAll('{timer_schedule}', `<t:${Math.floor(ctx.scheduleItem.time/1000)}:R>`)
    content = content.replaceAll('{schedule_kind}', ctx.scheduleItem.kind ?? 'custom')
  } else {
    // Without a specific item, block-specific values are empty.
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
export async function markScheduleAnnounced(db: import('../../shared/db.js').Db, eventId: string, scheduleId: string): Promise<void> {
  const event = await getEvent(db, eventId)
  if (!event) return
  const next = [...new Set([...(event.announcedScheduleIds ?? []), scheduleId])]
  await db.run('UPDATE events SET announced_schedule_ids = ?, updated_at = ? WHERE id = ?', JSON.stringify(next), Date.now(), eventId)
}

export async function getMessageRef(db: Db, key: string): Promise<{ channelId: string; messageId: string } | null> {
  const row = await db.get<{ value: string }>('SELECT value FROM meta WHERE key = ?', key);
  if (!row) return null;
  try {
    const ref = JSON.parse(row.value) as { channelId: string; messageId: string };
    return typeof ref.channelId === 'string' && ref.channelId !== '' && typeof ref.messageId === 'string' && ref.messageId !== '' ? ref : null;
  } catch { return null; }
}

export async function setMessageRef(db: Db, key: string, ref: { channelId: string; messageId: string }): Promise<void> {
  await db.run('INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', key, JSON.stringify(ref));
}

export async function listEventGuilds(db: Db): Promise<string[]> {
  return (await db.all<{ guild_id: string }>('SELECT DISTINCT guild_id FROM events')).map((r) => r.guild_id);
}

export async function markMaintenanceDone(db: Db, eventId: string, flag: 'reminded_24h' | 'cleanup_done'): Promise<void> {
  await db.run(`UPDATE events SET ${flag} = 1, updated_at = ? WHERE id = ?`, Date.now(), eventId);
}

export async function updateTemplateContent(db: Db, templateId: string, name: string, json: string): Promise<void> {
  await db.run('UPDATE event_templates SET name = ?, json = ? WHERE id = ?', name, json, templateId);
}
