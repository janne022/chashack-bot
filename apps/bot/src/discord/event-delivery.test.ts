import test from 'node:test';
import assert from 'node:assert/strict';
import type { Client } from 'discord.js';
import { openTestDb } from '../shared/test-db.js';
import { getEvent } from '../features/events/data.js';
import { getDelivery } from '../features/events/delivery-data.js';
import { reconcileEventDelivery } from './event-delivery.js';

test('durable deliveries catch up, retry failures, reach late teams and edit existing Discord messages', async () => {
  const db = await openTestDb();
  try {
    const now = Date.now(), guildId = '11111111111111111';
    await db.run("INSERT INTO events(id,guild_id,name,status,starts_at,ends_at,panel_channel_id,announcement_channel_id,created_at,updated_at) VALUES ('delivery-event',?,'Build weekend','active',?,?, 'signup','announcements',1,1)", guildId, now - 3600000, now + 86400000);
    const event = (await getEvent(db, 'delivery-event'))!;
    event.assignments = [{ id: 'one', title: 'First brief', instructions: 'Build with {team}' }, { id: 'two', title: 'Second brief', instructions: 'Make something for {event}' }];
    event.schedule = [{ id: 'kickoff', time: now - 2 * 86400000, title: 'Kickoff', actions: [
      { id: 'panel', type: 'post_signup' },
      { id: 'note', type: 'announce', title: '{event}', message: 'Welcome to {schedule_title}' },
      { id: 'handout', type: 'distribute_assignments', mode: 'random' },
    ] }];
    let sent = 0, edited = 0;
    const failures = new Set<string>();
    const messages = new Map<string, { id: string; author: { id: string }; payload: unknown; edit: (payload: unknown) => Promise<void> }>();
    const channel = (id: string) => ({ id, isTextBased: () => true,
      messages: { fetch: async (messageId: string) => {
        if (failures.has(id)) throw Object.assign(new Error('Missing access'), { code: 50013 });
        const message = messages.get(messageId); if (!message) throw Object.assign(new Error('Unknown message'), { code: 10008 }); return message;
      } },
      send: async (payload: unknown) => {
        if (failures.has(id)) throw new Error('Temporary transport failure');
        const message = { id: `message-${++sent}`, author: { id: 'bot' }, payload,
          edit: async (next: unknown) => { message.payload = next; edited++; } };
        messages.set(message.id, message); return message;
      },
    });
    const guild = { id: guildId, channels: { fetch: async (id: string) => channel(id) } };
    const client = { user: { id: 'bot' }, guilds: { fetch: async () => guild } } as unknown as Client;
    await reconcileEventDelivery(db, client, event, now);
    assert.equal(sent, 2, 'signup and announcement catch up even two days late');
    await reconcileEventDelivery(db, client, event, now);
    assert.equal(sent, 2, 'unchanged passes do not duplicate posts');
    await db.run("INSERT INTO teams(id,event_id,guild_id,name,kind,text_channel_id,created_at) VALUES ('late','delivery-event',?,'Late builders','public','late-room',1)", guildId);
    failures.add('late-room');
    await reconcileEventDelivery(db, client, event, now);
    assert.equal(sent, 2);
    failures.clear();
    event.announcedScheduleIds = ['kickoff'];
    await reconcileEventDelivery(db, client, event, now);
    assert.equal(sent, 3, 'a completed block still retries the late team');
    const key = `${guildId}:delivery-event:kickoff:handout:team:late`;
    const delivery = await getDelivery(db, key);
    assert.ok(delivery?.messageId);
    assert.equal(delivery.channelId, 'late-room');
    await reconcileEventDelivery(db, client, event, now);
    assert.equal(sent, 3);
    const editsBeforeRevision = edited;
    event.assignments.find(a => a.id === delivery.assignmentId)!.instructions = 'Revised brief';
    event.schedule[0]!.actions![1]!.message = 'Updated welcome';
    await reconcileEventDelivery(db, client, event, now);
    assert.equal(edited, editsBeforeRevision + 2, 'edits replace the handout and announcement in place');
    assert.equal(sent, 3);
    assert.equal((await getDelivery(db, key))!.assignmentId, delivery.assignmentId);
    failures.add('announcements');
    event.schedule[0]!.actions![1]!.message = 'One more edit';
    await reconcileEventDelivery(db, client, event, now);
    assert.equal(sent, 3, 'missing access does not create a duplicate message');
    failures.clear();
    await reconcileEventDelivery(db, client, event, now);
    assert.equal(edited, editsBeforeRevision + 3, 'failed edits retry successfully');
    event.schedule[0]!.actions!.push({ id: 'added-after-kickoff', type: 'announce', title: 'A new note', message: 'Added later' });
    await reconcileEventDelivery(db, client, event, now);
    assert.equal(sent, 4, 'new actions on a completed block are delivered');
  } finally { await db.close(); }
});
