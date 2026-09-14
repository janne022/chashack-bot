import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../../shared/db.js';
import { createEvent, listEvents, activateEvent } from '../events/data.js';

const G = 'g1';

/**
 * Multiple events can be live at once. These cover the invariants the admin UI
 * relies on: events are per-guild, activation is independent per event, and
 * listing returns every event so the UI can offer a switcher.
 */
test('multi-event: events are independent and all are listed', () => {
  const db = openDb(':memory:');
  const a = createEvent(db, 'test', G, { name: 'Event A' });
  const b = createEvent(db, 'test', G, { name: 'Event B' });
  assert.ok(a.ok && b.ok);

  // Both start as drafts, both listed.
  let all = listEvents(db, G);
  assert.equal(all.length, 2);
  assert.deepEqual(all.map((e) => e.status), ['draft', 'draft']);

  // Activating one does not touch the other.
  assert.ok(activateEvent(db, 'test', a.value.id).ok);
  all = listEvents(db, G);
  const byId = new Map(all.map((e) => [e.id, e]));
  assert.equal(byId.get(a.value.id)?.status, 'active');
  assert.equal(byId.get(b.value.id)?.status, 'draft');

  // Both active simultaneously — the case the switcher exists for.
  assert.ok(activateEvent(db, 'test', b.value.id).ok);
  all = listEvents(db, G);
  assert.equal(all.filter((e) => e.status === 'active').length, 2);

  db.close();
});

test('multi-event: assignment distribution lands on the event it was created for', () => {
  const db = openDb(':memory:');
  const starts = Date.now() + 7 * 24 * 3600 * 1000;
  const a = createEvent(db, 'test', G, {
    name: 'With Assignments',
    startsAt: starts,
    assignments: [{ id: 'asg1', title: 'Demo prep', instructions: 'Prep a demo' }],
    assignmentStrategy: 'same',
  });
  const b = createEvent(db, 'test', G, { name: 'Plain' });
  assert.ok(a.ok && b.ok);

  const startA = a.value.schedule.find((s) => s.id === '__start__');
  assert.equal(
    startA?.actions?.find((x) => x.type === 'distribute_assignments')?.mode,
    'same',
    'strategy from creation is applied to the Start block',
  );
  // The other event has no synthetic Start block and no cross-contamination.
  assert.equal(b.value.schedule.find((s) => s.id === '__start__'), undefined);
  assert.equal(a.value.assignments.length, 1);
  assert.equal(a.value.assignments[0]?.title, 'Demo prep');
  // Event B supplied no pool, so it keeps the seeded defaults rather than
  // inheriting event A's.
  assert.ok(b.value.assignments.length > 0);
  assert.ok(!b.value.assignments.some((x) => x.title === 'Demo prep'));

  db.close();
});

test('multi-event: events in another guild are never returned', () => {
  const db = openDb(':memory:');
  assert.ok(createEvent(db, 'test', 'g1', { name: 'Guild One Event' }).ok);
  assert.ok(createEvent(db, 'test', 'g2', { name: 'Guild Two Event' }).ok);

  const g1 = listEvents(db, 'g1');
  assert.equal(g1.length, 1);
  assert.equal(g1[0]?.name, 'Guild One Event');

  db.close();
});
