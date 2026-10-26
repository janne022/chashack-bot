import test from 'node:test'
import assert from 'node:assert/strict'
import { moveScheduleDates, resolveScheduleAnchors, consolidateSignupBlock } from '../src/lib/schedule-anchor.ts'

test('moving the event date preserves activity clock times and multi-day spacing', () => {
  const oldStart = new Date(2026, 9, 27, 10).getTime(), nextStart = new Date(2026, 10, 4, 11).getTime()
  const result = moveScheduleDates([{ id:'dinner', title:'Dinner', time:new Date(2026,9,27,18).getTime() },{ id:'demo', title:'Demo', time:new Date(2026,9,28,15).getTime() }], oldStart, nextStart)
  assert.equal(result[0].time, new Date(2026,10,4,18).getTime())
  assert.equal(result[1].time, new Date(2026,10,5,15).getTime())
})
test('pinned kickoff uses the selected time rather than midnight', () => {
  const start = new Date(2026,10,4,11).getTime()
  assert.equal(resolveScheduleAnchors([{id:'__start__',title:'Start',time:0,anchor:'hackathon_start',offsetMinutes:0}],{startsAt:start})[0].time,start)
})
test('legacy signup action is folded into the signup window', () => {
  const items = consolidateSignupBlock([{id:'sch_signup',title:'Signup',time:1,actions:[{id:'panel',type:'post_signup'}]}])
  assert.equal(items[0].id,'__signup__')
  assert.equal(items[0].actions?.[0].type,'post_signup')
})
