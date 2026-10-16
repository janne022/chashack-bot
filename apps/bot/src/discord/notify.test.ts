import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setImmediate as nextTurn } from 'node:timers/promises';
import type { Client } from 'discord.js';
import { openTestDb } from '../shared/test-db.js';
import { getEvent } from '../features/events/data.js';
import { runMaintenance } from './notify.js';

test('maintenance waits for the schedule marker read before returning', async () => {
  const db = await openTestDb();
  const now = Date.now();
  const schedule = [{ id: 'due', time: now - 1, title: 'Due', actions: [{ id: 'announce', type: 'announce', title: 'Update', message: 'Starting' }] }];
  await db.run(`INSERT INTO events (id, guild_id, name, status, schedule_json, created_at, updated_at)
    VALUES (?, ?, ?, 'active', ?, ?, ?)`, 'event-1', 'guild-1', 'Event', JSON.stringify(schedule), now, now);

  const originalGet = db.get.bind(db);
  let getCount = 0;
  let entered!: () => void;
  let markerFinished!: () => void;
  let release!: () => void;
  const markerEntered = new Promise<void>((resolve) => { entered = resolve; });
  const markerComplete = new Promise<void>((resolve) => { markerFinished = resolve; });
  const markerGate = new Promise<void>((resolve) => { release = resolve; });
  db.get = (async (...args: [string, ...unknown[]]) => {
    if (String(args[0]).includes('FROM events WHERE id') && ++getCount === 1) {
      entered();
      await markerGate;
    }
    const result = await originalGet(...args);
    if (getCount === 1 && String(args[0]).includes('FROM events WHERE id')) markerFinished();
    return result;
  }) as typeof db.get;

  let settled = false;
  const maintenance = runMaintenance({ db, client: { guilds: { cache: new Map([['guild-1', { id: 'guild-1' }]]) } } as unknown as Client }).finally(() => { settled = true; });
  try {
    await markerEntered;
    await nextTurn();
    assert.equal(settled, false, 'maintenance returned before its schedule marker lookup resolved');
    release();
    await maintenance;
    assert.deepEqual((await getEvent(db, 'event-1'))?.announcedScheduleIds, ['due']);
  } finally {
    release();
    await maintenance;
    await markerComplete;
    await nextTurn();
    await db.close();
  }
});
