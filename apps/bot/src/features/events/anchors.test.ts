import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveScheduleAnchors, toRelativeSchedule, templateToEventInput, type ScheduleItem } from './data.js';

const H = 3600 * 1000;
// Local-time fixtures: built with the Date constructor so assertions hold in any TZ.
const start = new Date(2026, 2, 14, 10, 0).getTime(); // Sat 14 Mar 2026, 10:00
const startDay = new Date(2026, 2, 14, 0, 0).getTime();
const end = new Date(2026, 2, 16, 17, 0).getTime(); // Mon 16 Mar, 17:00
const endDay = new Date(2026, 2, 16, 0, 0).getTime();
const signupOpen = new Date(2026, 2, 7, 9, 0).getTime(); // Sat 7 Mar, 09:00
const signupOpenDay = new Date(2026, 2, 7, 0, 0).getTime();
const signupClose = new Date(2026, 2, 14, 8, 0).getTime(); // Sat 14 Mar, 08:00
const signupCloseDay = startDay;

function item(overrides: Partial<ScheduleItem>): ScheduleItem {
  return { id: 'i1', time: 0, title: 'Block', kind: 'custom', ...overrides };
}

test('anchors: items resolve onto their anchor day + offset', () => {
  const out = resolveScheduleAnchors(
    [
      item({ id: 'dinner', anchor: 'hackathon_start', offsetMinutes: 12 * 60 }), // day 1, 12:00
      item({ id: 'prize', anchor: 'hackathon_end', offsetMinutes: 2 * 60 }), // day 3, 02:00
      item({ id: 'remind', anchor: 'signup_end', offsetMinutes: 20 * 60 }), // signup day, 20:00
    ],
    { startsAt: start, endsAt: end, signupStartsAt: signupOpen, signupEndsAt: signupClose },
  );
  assert.equal(out[0]!.time, startDay + 12 * H);
  assert.equal(out[1]!.time, endDay + 2 * H);
  assert.equal(out[2]!.time, signupCloseDay + 20 * H);
  // anchor info survives so a later date change re-resolves the item
  assert.equal(out[0]!.anchor, 'hackathon_start');
  assert.equal(out[0]!.offsetMinutes, 12 * 60);
});

test('anchors: negative offsets land before the anchor day', () => {
  const out = resolveScheduleAnchors(
    [item({ anchor: 'signup_end', offsetMinutes: -60 })],
    { startsAt: start, signupEndsAt: signupClose },
  );
  assert.equal(out[0]!.time, signupCloseDay - 1 * H);
});

test('anchors: signup anchors fall back to the hackathon start', () => {
  const out = resolveScheduleAnchors(
    [
      item({ id: 'a', anchor: 'signup_start', offsetMinutes: 60 }),
      item({ id: 'b', anchor: 'signup_end', offsetMinutes: 60 }),
      item({ id: 'c', anchor: 'hackathon_end', offsetMinutes: 60 }),
    ],
    { startsAt: start, endsAt: null, signupStartsAt: null, signupEndsAt: null },
  );
  assert.equal(out[0]!.time, startDay + 1 * H);
  assert.equal(out[1]!.time, startDay + 1 * H);
  assert.equal(out[2]!.time, startDay + 1 * H);
});

test('anchors: no date anywhere keeps the literal time, unanchored items are untouched', () => {
  const out = resolveScheduleAnchors(
    [
      item({ id: 'a', anchor: 'hackathon_start', offsetMinutes: 720, time: 1234 }),
      item({ id: 'b', time: 5678 }),
    ],
    { startsAt: null, endsAt: null, signupStartsAt: null, signupEndsAt: null },
  );
  assert.equal(out[0]!.time, 1234);
  assert.equal(out[1]!.time, 5678);
});

test('toRelativeSchedule: real blocks become offsets from the hackathon start', () => {
  const out = toRelativeSchedule(
    [
      item({ id: 'fika', time: startDay + 2 * H, title: 'Fika' }),
      item({ id: '__start__', time: start, title: 'Event starts' }),
      item({ id: '__signup__', time: signupOpen, title: 'Signups open' }),
      item({ id: '__end__', time: end, title: 'Event ends' }),
    ],
    start,
  );
  assert.equal(out[0]!.anchor, 'hackathon_start');
  assert.equal(out[0]!.offsetMinutes, 120);
  assert.equal(out[1]!.anchor, 'hackathon_start');
  assert.equal(out[1]!.offsetMinutes, 0);
  assert.equal(out[2]!.anchor, 'signup_start');
  assert.equal(out[3]!.anchor, 'hackathon_end');
});

test('toRelativeSchedule: without a start date the literal times stand', () => {
  const out = toRelativeSchedule([item({ id: 'fika', time: 42, title: 'Fika' })], null);
  assert.equal(out[0]!.time, 42);
  assert.equal(out[0]!.anchor, undefined);
});

test('templateToEventInput: keeps anchors through normalization (time optional)', () => {
  const json = JSON.stringify({
    name: 'Tpl',
    schedule: [
      { id: 'dinner', title: 'Dinner', kind: 'food', anchor: 'hackathon_start', offsetMinutes: 1080 },
      { id: 'bad', title: 'Junk anchor', anchor: 'whenever', offsetMinutes: 60 },
      { id: 'noTime', title: 'No time, anchored', anchor: 'signup_end', offsetMinutes: 30 },
    ],
  });
  const out = templateToEventInput(json);
  const schedule = out.schedule ?? [];
  assert.equal(schedule.length, 2, 'junk anchor without a time is dropped');
  assert.deepEqual(
    { anchor: schedule[0]!.anchor, offsetMinutes: schedule[0]!.offsetMinutes },
    { anchor: 'hackathon_start', offsetMinutes: 1080 },
  );
  assert.equal(schedule[1]!.time, 0, 'anchor-only item keeps the placeholder time until resolution');
  assert.equal(schedule[1]!.anchor, 'signup_end');
});
