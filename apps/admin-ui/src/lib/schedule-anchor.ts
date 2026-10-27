import type { ScheduleAnchor, ScheduleItem } from '@/types'

/**
 * Template schedules store an anchor + offset instead of a date, so the same
 * itinerary works for any event. Mirrors the bot's `resolveScheduleAnchors` /
 * `toRelativeSchedule` in `apps/bot/src/features/events/data.ts` — keep both in
 * sync (the server is authoritative: it re-resolves on every create/update).
 */
export const ANCHOR_OPTIONS: { id: ScheduleAnchor; labelKey: string }[] = [
  { id: 'hackathon_start', labelKey: 'anchor.hackathon_start' },
  { id: 'signup_start', labelKey: 'anchor.signup_start' },
  { id: 'signup_end', labelKey: 'anchor.signup_end' },
  { id: 'hackathon_end', labelKey: 'anchor.hackathon_end' },
]

export interface ScheduleDates {
  startsAt?: number | null
  endsAt?: number | null
  signupStartsAt?: number | null
  signupEndsAt?: number | null
}

/** Synthetic block id → the anchor it stands for (block-action carriers). */
export const SYNTHETIC_ANCHORS: Record<string, ScheduleAnchor> = {
  __start__: 'hackathon_start',
  __signup__: 'signup_start',
  __end__: 'hackathon_end',
}

export const SYNTHETIC_BLOCK_IDS = ['__start__', '__signup__', '__end__']

function startOfDay(ms: number): number {
  const d = new Date(ms)
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

/** Anchor date, falling back the same way the bot does. */
export function anchorDate(anchor: ScheduleAnchor, dates: ScheduleDates): number | null {
  switch (anchor) {
    case 'hackathon_start': return dates.startsAt ?? null
    case 'hackathon_end': return dates.endsAt ?? dates.startsAt ?? null
    case 'signup_start': return dates.signupStartsAt ?? dates.startsAt ?? null
    case 'signup_end': return dates.signupEndsAt ?? dates.startsAt ?? null
  }
}

/** Recompute `time` for anchored items; items without an anchor are untouched. */
export function resolveScheduleAnchors(items: ScheduleItem[], dates: ScheduleDates): ScheduleItem[] {
  return items.map((item) => {
    if (item.anchor === undefined || item.offsetMinutes === undefined) return item
    const from = anchorDate(item.anchor, dates)
    if (from === null || !Number.isFinite(from)) return item
    let time = SYNTHETIC_ANCHORS[item.id] ? from : (item.offsetMode === 'elapsed' ? from : startOfDay(from)) + item.offsetMinutes * 60_000
    if (!SYNTHETIC_ANCHORS[item.id] && item.offsetMode === 'elapsed' && item.withinEvent) {
      if (dates.startsAt != null) time = Math.max(time, dates.startsAt)
      if (dates.endsAt != null) time = Math.min(time, dates.endsAt)
    }
    return { ...item, time }
  })
}

/** Absolute itinerary → template form (offsets from the hackathon start). */
export function toRelativeSchedule(items: ScheduleItem[], startsAt: number | null | undefined): ScheduleItem[] {
  return items.map((item) => {
    const synthetic = SYNTHETIC_ANCHORS[item.id]
    if (synthetic !== undefined) return { ...item, anchor: synthetic, offsetMinutes: 0 }
    if (item.offsetMode === 'elapsed' && item.anchor !== undefined && item.offsetMinutes !== undefined) return item
    if (startsAt == null || !Number.isFinite(startsAt)) return item
    return { ...item, anchor: 'hackathon_start', offsetMinutes: Math.round((item.time - startOfDay(startsAt)) / 60_000) }
  })
}

/** Day number as shown to the user: day 1 is the anchor's own day. */
export function offsetDay(offsetMinutes: number): number {
  return Math.floor(offsetMinutes / 1440) + 1
}

export function offsetHourMinute(offsetMinutes: number): { hour: string; minute: string } {
  const rem = ((offsetMinutes % 1440) + 1440) % 1440
  const h = Math.floor(rem / 60)
  const m = rem % 60
  return { hour: String(h).padStart(2, '0'), minute: String(m).padStart(2, '0') }
}

/** Inverse of offsetDay/offsetHourMinute — day 1 is the anchor's own day. */
export function offsetFromDayTime(day: number, hour: number, minute: number): number {
  return (day - 1) * 1440 + hour * 60 + minute
}

/** Minutes-of-day granularity offered in the relative editor (matches DateRangePicker). */
export const TIME_MINUTES = ['00', '05', '10', '15', '20', '25', '30', '35', '40', '45', '50', '55']

export function consolidateSignupBlock(items: ScheduleItem[]): ScheduleItem[] {
  const legacy = items.filter(item => item.id === 'sch_signup' && item.actions?.every(action => action.type === 'post_signup'))
  if (!legacy.length) return items
  const existing = items.find(item => item.id === '__signup__')
  const actions = [...(existing?.actions ?? []), ...legacy.flatMap(item => item.actions ?? [])]
  const first = existing ?? legacy[0]!
  return [...items.filter(item => item.id !== '__signup__' && !legacy.includes(item)), { ...first, id: '__signup__', anchor: 'signup_start', offsetMinutes: 0, actions }]
}

/** Move unanchored activities by calendar days, retaining their local clock time. */
export function moveScheduleDates(items: ScheduleItem[], before: number | null, after: number): ScheduleItem[] {
  const source = before ?? (items.length ? Math.min(...items.map(item => item.time)) : after)
  const a = new Date(source), b = new Date(after)
  const days = Math.round((Date.UTC(b.getFullYear(), b.getMonth(), b.getDate()) - Date.UTC(a.getFullYear(), a.getMonth(), a.getDate())) / 86400000)
  return items.map(item => {
    if (item.anchor) return item
    const date = new Date(item.time); date.setDate(date.getDate() + days)
    return { ...item, time: date.getTime() }
  })
}
