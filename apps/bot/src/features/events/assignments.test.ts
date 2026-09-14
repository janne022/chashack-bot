import { test } from 'node:test';
import assert from 'node:assert/strict';
import { withAssignmentDistribution, DISTRIBUTE_ACTION_ID, templateToEventInput } from './data.js';
import type { ScheduleItem } from './data.js';

const H = 3600 * 1000;
const START = 1000 * H;

function modes(items: ScheduleItem[]): (string | undefined)[] {
  return items
    .flatMap((s) => s.actions ?? [])
    .filter((a) => a.type === 'distribute_assignments')
    .map((a) => a.mode);
}

test('assignments: distribute action is added to an existing Start block', () => {
  const schedule: ScheduleItem[] = [
    { id: '__start__', time: START, title: 'Event starts', kind: 'custom', actions: [] },
    { id: 'sch_dinner', time: START + H, title: 'Dinner', kind: 'food' },
  ];
  const out = withAssignmentDistribution(schedule, 'random', START);
  const start = out.find((s) => s.id === '__start__');
  assert.deepEqual(modes(out), ['random']);
  assert.equal(start?.actions?.length, 1);
  assert.equal(start?.actions?.[0]?.id, DISTRIBUTE_ACTION_ID);
  // The other block is untouched.
  assert.deepEqual(out.find((s) => s.id === 'sch_dinner'), schedule[1]);
});

test('assignments: existing non-distribute actions on Start are preserved', () => {
  const schedule: ScheduleItem[] = [
    {
      id: '__start__',
      time: START,
      title: 'Event starts',
      kind: 'custom',
      actions: [{ id: 'a1', type: 'post_signup', channelId: null }],
    },
  ];
  const out = withAssignmentDistribution(schedule, 'same', START);
  const acts = out[0]?.actions ?? [];
  assert.equal(acts.length, 2);
  assert.ok(acts.some((a) => a.type === 'post_signup'));
  assert.ok(acts.some((a) => a.type === 'distribute_assignments' && a.mode === 'same'));
});

test('assignments: applying twice does not duplicate the distribute action', () => {
  const schedule: ScheduleItem[] = [
    { id: '__start__', time: START, title: 'Event starts', kind: 'custom', actions: [] },
  ];
  const once = withAssignmentDistribution(schedule, 'random', START);
  const twice = withAssignmentDistribution(once, 'same', START);
  assert.equal(modes(twice).length, 1, 'exactly one distribute action');
  assert.deepEqual(modes(twice), ['same'], 'strategy is replaced, not appended');
});

test('assignments: synthesises a Start block when schedule has none but a start time exists', () => {
  const schedule: ScheduleItem[] = [
    { id: 'sch_dinner', time: START + H, title: 'Dinner', kind: 'food' },
  ];
  const out = withAssignmentDistribution(schedule, 'random', START);
  const start = out.find((s) => s.id === '__start__');
  assert.equal(start?.time, START);
  assert.deepEqual(modes(out), ['random']);
});

test('assignments: empty schedule gets a Start block only when a start time exists', () => {
  const schedule: ScheduleItem[] = [
    { id: 'sch_dinner', time: START + H, title: 'Dinner', kind: 'food' },
  ];
  // No start time → nothing to attach to, caller keeps the pool on the event.
  assert.deepEqual(withAssignmentDistribution(schedule, 'random', null), schedule);
  // Empty schedule + a start time → the Start block is synthesised so the
  // distribution still fires at event start.
  const out = withAssignmentDistribution([], 'random', START);
  assert.equal(out.length, 1);
  assert.equal(out[0]?.id, '__start__');
  assert.deepEqual(modes(out), ['random']);
});

test('template: assignments and strategy round-trip through templateToEventInput', () => {
  const json = JSON.stringify({
    name: 'ChasHack',
    description: '48h',
    cleanupDelayHours: 48,
    assignments: [{ id: 'asg1', title: 'Demo prep', instructions: 'Prep a demo' }],
    assignmentStrategy: 'same',
  });
  const out = templateToEventInput(json);
  assert.equal(out.assignmentStrategy, 'same');
  assert.equal(out.assignments?.length, 1);
  assert.equal(out.assignments?.[0]?.title, 'Demo prep');
});

test('template: an unknown strategy name falls back to random, never a bad value', () => {
  const out = templateToEventInput(JSON.stringify({ assignmentStrategy: 'chaotic' }));
  assert.equal(out.assignmentStrategy, 'random');
});

test('assignments: imageUrl is kept only when it looks like an http(s) URL', () => {
  const out = templateToEventInput(JSON.stringify({
    assignments: [
      { id: 'a', title: 'Good', instructions: 'Do it', imageUrl: 'https://example.com/x.png' },
      { id: 'b', title: 'Bad scheme', instructions: 'Do it', imageUrl: 'javascript:alert(1)' },
      { id: 'c', title: 'Not a URL', instructions: 'Do it', imageUrl: 'hello world' },
      { id: 'd', title: 'Empty', instructions: 'Do it', imageUrl: '   ' },
    ],
  }));
  assert.equal(out.assignments?.length, 4);
  assert.equal(out.assignments?.[0]?.imageUrl, 'https://example.com/x.png');
  assert.equal(out.assignments?.[1]?.imageUrl, undefined);
  assert.equal(out.assignments?.[2]?.imageUrl, undefined);
  assert.equal(out.assignments?.[3]?.imageUrl, undefined);
});
