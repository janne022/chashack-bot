import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planMaintenance, type HackathonEvent } from './data.js';

function ev(overrides: Partial<HackathonEvent>): HackathonEvent {
  return {
    id: 'ev1',
    guildId: 'g1',
    name: 'Test Event',
    description: '',
    startsAt: null,
    endsAt: null,
    status: 'ended',
    formJson: null,
    panelChannelId: null,
    categoryId: null,
    cleanupDelayHours: 48,
    cleanupDone: false,
    cleanupWarned72h: false,
    cleanupWarned24h: false,
    reminded24h: false,
    discordEventIds: [],
    createdAt: 0,
    updatedAt: 0,
    ...overrides,
  };
}

const H = 3600 * 1000;

test('planner: cleanup fires after ends_at + delay', () => {
  const ends = 1000 * H;
  const event = ev({ endsAt: ends, cleanupDelayHours: 48 });
  // within the last 72h window of a 48h delay: warning, not cleanup yet
  const at47 = planMaintenance([event], ends + 47 * H);
  assert.ok(at47.some((a) => a.type === 'cleanup_warn' && a.hoursLeft === 1));
  // after delay: cleanup
  assert.deepEqual(planMaintenance([event], ends + 49 * H), [{ type: 'cleanup', eventId: 'ev1' }]);
});

test('planner: warns at 72h then 24h before cleanup', () => {
  const ends = 1000 * H;
  // 48h delay -> 72h before cleanup is before end; use 96h delay for a real 72h warn
  const e96 = ev({ endsAt: ends, cleanupDelayHours: 96, id: 'ev96' });
  const at70 = planMaintenance([e96], ends + 24 * H); // cleanup in 72h
  assert.ok(at70.some((a) => a.type === 'cleanup_warn' && a.hoursLeft === 72));

  // after 72h warn, no repeat
  const e96b = ev({ endsAt: ends, cleanupDelayHours: 96, id: 'ev96', cleanupWarned72h: true });
  const at20 = planMaintenance([e96b], ends + 80 * H); // cleanup in 16h -> 24h tier window
  assert.ok(at20.some((a) => a.type === 'cleanup_warn' && a.hoursLeft === 16));

  // with both warned: only cleanup remains
  const e96c = ev({ endsAt: ends, cleanupDelayHours: 96, id: 'ev96', cleanupWarned72h: true, cleanupWarned24h: true });
  assert.deepEqual(planMaintenance([e96c], ends + 80 * H), []);
});

test('planner: 24h reminder before start', () => {
  const starts = 1000 * H;
  const e = ev({ status: 'active', startsAt: starts, endsAt: null, id: 'evA' });
  const actions = planMaintenance([e], starts - 10 * H);
  assert.deepEqual(actions, [{ type: 'remind_24h', eventId: 'evA' }]);
  // after reminder sent: nothing
  const e2 = ev({ status: 'active', startsAt: starts, endsAt: null, id: 'evA', reminded24h: true });
  assert.deepEqual(planMaintenance([e2], starts - 10 * H), []);
});

test('planner: auto-end after end time', () => {
  const starts = 1000 * H;
  const e = ev({ status: 'active', startsAt: starts, endsAt: starts + 48 * H, id: 'evB' });
  const actions = planMaintenance([e], starts + 49 * H);
  assert.deepEqual(actions, [{ type: 'end_event', eventId: 'evB' }]);
});
