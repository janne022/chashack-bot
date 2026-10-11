import assert from 'node:assert/strict';
import { test } from 'node:test';
import { getForm, updateForm, resetForm } from './data.js';
import { createEvent, getEventForm } from '../events/data.js';
import { openTestDb } from '../../shared/test-db.js';

test('default forms are isolated by guild for reads, updates, and resets', async () => {
  const db = await openTestDb();
  const guildA = '11111111111111111';
  const guildB = '22222222222222222';

  const formA = await getForm(db, guildA);
  const formB = await getForm(db, guildB);
  await updateForm(db, guildA, 'test', { ...formA, title: 'Guild A sentinel' });
  await updateForm(db, guildB, 'test', { ...formB, title: 'Guild B form' });
  assert.equal((await getForm(db, guildA)).title, 'Guild A sentinel');
  assert.equal((await getForm(db, guildB)).title, 'Guild B form');
  const eventA = await createEvent(db, 'test', guildA, { name: 'A snapshot' });
  const eventB = await createEvent(db, 'test', guildB, { name: 'B snapshot' });
  assert.ok(eventA.ok && eventB.ok);
  assert.equal(getEventForm(db, eventA.value, formA).title, 'Guild A sentinel');
  assert.equal(getEventForm(db, eventB.value, formB).title, 'Guild B form');

  await resetForm(db, guildB, 'test');
  assert.equal((await getForm(db, guildB)).title, 'Hackathon Signup');
  assert.equal((await getForm(db, guildA)).title, 'Guild A sentinel');
  await db.close();
});
