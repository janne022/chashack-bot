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
  createdAt: number;
  updatedAt: number;
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
  categoryId?: string | null;
  cleanupDelayHours?: number;
}

export function createEvent(db: Db, actor: string, guildId: string, input: CreateEventInput): Result<HackathonEvent> {
  const name = input.name.trim().slice(0, 100);
  if (name.length < 3) return err('bad_name', 'Event name must be at least 3 characters.');
  if (input.startsAt !== null && input.startsAt !== undefined && input.endsAt !== null && input.endsAt !== undefined) {
    if (input.endsAt <= input.startsAt) return err('bad_dates', 'The event must end after it starts.');
  }

  const id = newId('ev');
  const form: FormConfig = normalizeFormUpdate({ ...DEFAULT_FORM, ...(input.form ?? {}) }, {});
  db.prepare(
    `INSERT INTO events (id, guild_id, name, description, starts_at, ends_at, status, form_json, panel_channel_id, category_id, cleanup_delay_hours, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, 'draft', ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    guildId,
    name,
    (input.description ?? '').slice(0, 1000),
    input.startsAt ?? null,
    input.endsAt ?? null,
    JSON.stringify(form),
    input.panelChannelId ?? null,
    input.categoryId ?? null,
    input.cleanupDelayHours ?? 48,
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
  update: Partial<Pick<HackathonEvent, 'name' | 'description' | 'startsAt' | 'endsAt' | 'panelChannelId' | 'categoryId' | 'cleanupDelayHours' | 'matchAt' | 'discordEventIds'>>,
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
  const cleanupDelayHours =
    update.cleanupDelayHours !== undefined
      ? Math.min(Math.max(Math.round(update.cleanupDelayHours), 0), 24 * 30)
      : event.cleanupDelayHours;

  db.prepare(
    `UPDATE events SET name = ?, description = ?, starts_at = ?, ends_at = ?, panel_channel_id = ?, category_id = ?, cleanup_delay_hours = ?, match_at = ?, discord_event_ids = ?, updated_at = ?
     WHERE id = ?`,
  ).run(
    name,
    description,
    startsAt,
    endsAt,
    update.panelChannelId !== undefined ? update.panelChannelId : event.panelChannelId,
    update.categoryId !== undefined ? update.categoryId : event.categoryId,
    cleanupDelayHours,
    update.matchAt !== undefined ? update.matchAt : event.matchAt,
    update.discordEventIds !== undefined ? JSON.stringify(update.discordEventIds) : JSON.stringify(event.discordEventIds),
    Date.now(),
    eventId,
  );
  audit(db, actor, 'event.update', eventId, { name, startsAt, endsAt, matchAt: update.matchAt !== undefined ? update.matchAt : undefined });
  return ok(getEvent(db, eventId)!);
}

// ─── lifecycle ───────────────────────────────────────────────────────────────

export function activateEvent(db: Db, actor: string, eventId: string): Result<HackathonEvent> {
  const event = getEvent(db, eventId);
  if (event === null) return err('not_found', 'Event not found.');
  if (event.status === 'active') return ok(event);
  if (event.status === 'ended') return err('already_ended', 'Ended events cannot be reactivated — clone it instead.');

  // One active event per guild: end the previous one.
  const current = getActiveEvent(db, event.guildId);
  if (current !== null && current.id !== eventId) {
    db.prepare("UPDATE events SET status = 'ended', updated_at = ? WHERE id = ?").run(Date.now(), current.id);
    audit(db, actor, 'event.auto_end', current.id, { replacedBy: eventId });
  }
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
  kind: 'event' | 'form';
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
  };
}

// ─── maintenance planner (pure, fully unit-testable) ────────────────────────

export type MaintenanceAction =
  | { type: 'remind_24h'; eventId: string }
  | { type: 'end_event'; eventId: string }
  | { type: 'cleanup_warn'; eventId: string; hoursLeft: number }
  | { type: 'cleanup'; eventId: string }
  | { type: 'auto_match'; eventId: string };

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
