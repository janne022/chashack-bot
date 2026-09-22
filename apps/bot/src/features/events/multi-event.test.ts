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
test('multi-event: events are independent and all are listed', async () => {
  const db = openDb(':memory:');
  const a = await createEvent(db, 'test', G, { name: 'Event A' });
  const b = await createEvent(db, 'test', G, { name: 'Event B' });
  assert.ok(a.ok && b.ok);

  // Both start as drafts, both listed.
  let all = await listEvents(db, G);
  assert.equal(all.length, 2);
  assert.deepEqual(all.map((e) => e.status), ['draft', 'draft']);

  // Activating one does not touch the other.
  assert.ok(await activateEvent(db, 'test', a.value.id).ok);
  all = await listEvents(db, G);
  const byId = new Map(all.map((e) => [e.id, e]));
  assert.equal(byId.get(a.value.id)?.status, 'active');
  assert.equal(byId.get(b.value.id)?.status, 'draft');

  // Both active simultaneously — the case the switcher exists for.
  assert.ok(await activateEvent(db, 'test', b.value.id).ok);
  all = await listEvents(db, G);
  assert.equal(all.filter((e) => e.status === 'active').length, 2);

  db.close();
});

test('multi-event: assignment distribution lands on the event it was created for', async () => {
  const db = openDb(':memory:');
  const starts = Date.now() + 7 * 24 * 3600 * 1000;
  const a = await createEvent(db, 'test', G, {
    name: 'With Assignments',
    startsAt: starts,
    assignments: [{ id: 'asg1', title: 'Demo prep', instructions: 'Prep a demo' }],
    assignmentStrategy: 'same',
  });
  const b = await createEvent(db, 'test', G, { name: 'Plain' });
  assert.ok(a.ok && b.ok);

  const startA = a.value.schedule.find(async (s) => s.id === '__start__');
  assert.equal(
    startA?.actions?.find((x) => x.type === 'distribute_assignments')?.mode,
    'same',
    'strategy from creation is applied to the Start block',
  );
  // The other event has no synthetic Start block and no cross-contamination.
  assert.equal(b.value.schedule.find((s) => s.id === '__start__'), undefined);
  assert.equal(a.value.assignments.length, 1);
  assert.equal(a.value.assignments[0]?.title, 'Demo prep');
  // No collection chosen → no pool, no silent defaults, no distribute action.
  assert.equal(b.value.assignments.length, 0);

  db.close();
});

test('multi-event: no pool means no distribute action is wired', async () => {
  const db = openDb(':memory:');
  const starts = Date.now() + 7 * 24 * 3600 * 1000;
  const bare = await createEvent(db, 'test', G, { name: 'No pool', startsAt: starts });
  assert.ok(bare.ok);
  assert.equal(bare.value.assignments.length, 0);
  assert.equal(bare.value.schedule.find((s) => s.id === '__start__'), undefined);
  db.close();
});

test('multi-event: events in another guild are never returned', async () => {
  const db = openDb(':memory:');
  assert.ok(await createEvent(db, 'test', 'g1', { name: 'Guild One Event' }).ok);
  assert.ok(await createEvent(db, 'test', 'g2', { name: 'Guild Two Event' }).ok);

  const g1 = await listEvents(db, 'g1');
  assert.equal(g1.length, 1);
  assert.equal(g1[0]?.name, 'Guild One Event');

  db.close();
});
