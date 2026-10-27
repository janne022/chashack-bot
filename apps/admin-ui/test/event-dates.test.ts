import assert from 'node:assert/strict'
import test from 'node:test'
import { createEventSchema } from '../src/lib/schemas.ts'
import { resolveScheduleAnchors, toRelativeSchedule } from '../src/lib/schedule-anchor.ts'

test('signup can close after the hackathon starts while an inverted window is rejected', () => {
  const event = { name: 'Late signup', startsAt: 1000, endsAt: 4000, signupStartsAt: 500, signupEndsAt: 2000 }
  assert.equal(createEventSchema.safeParse(event).success, true)
  assert.equal(createEventSchema.safeParse({ ...event, signupEndsAt: 400 }).success, false)
})

test('elapsed template offsets use exact times, clamp short events and preserve legacy clock anchors', () => {
  const start = new Date(2026, 2, 14, 15).getTime(), end = start + 30 * 60_000
  const blocks = [{ id: 'welcome', title: 'Welcome', time: 0, anchor: 'hackathon_start' as const, offsetMode: 'elapsed' as const, offsetMinutes: 60, withinEvent: true }, { id: 'demo', title: 'Demo', time: 0, anchor: 'hackathon_end' as const, offsetMode: 'elapsed' as const, offsetMinutes: -60, withinEvent: true }, { id: 'legacy', title: 'Legacy', time: 0, anchor: 'hackathon_start' as const, offsetMinutes: 600 }]
  const result = resolveScheduleAnchors(blocks, { startsAt: start, endsAt: end })
  assert.equal(result[0]!.time, end)
  assert.equal(result[1]!.time, start)
  assert.equal(new Date(result[2]!.time).getHours(), 10)
  assert.equal(toRelativeSchedule(result, start)[1]!.offsetMinutes, -60)
})
