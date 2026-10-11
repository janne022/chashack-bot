import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createEvent } from '../features/events/data.js';
import { audit, auditList } from './audit.js';
import { openDb } from './db.js';

test('audit records resolve event guild ownership and tenant lists exclude host rows', async () => {
  const db = openDb(':memory:');
  const guildA = '11111111111111111';
  const guildB = '22222222222222222';
  const eventA = await createEvent(db, 'test', guildA, { name: 'Guild A event' });
  const eventB = await createEvent(db, 'test', guildB, { name: 'Guild B event' });
  assert.ok(eventA.ok && eventB.ok);
  await audit(db, 'host', 'host.action', null, null, null);

  const logsA = await auditList(db, 100, guildA);
  const logsB = await auditList(db, 100, guildB);
  assert.ok(logsA.some((entry) => entry.action === 'event.create'));
  assert.ok(logsB.some((entry) => entry.action === 'event.create'));
  assert.ok(logsA.every((entry) => entry.target !== eventB.value.id));
  assert.ok(logsB.every((entry) => entry.target !== eventA.value.id));
  assert.ok(logsA.every((entry) => entry.action !== 'host.action'));
  assert.ok(logsB.every((entry) => entry.action !== 'host.action'));
  db.close();
});
