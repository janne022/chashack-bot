import test from 'node:test';
import assert from 'node:assert/strict';
import type { Client } from 'discord.js';
import { openTestDb } from '../shared/test-db.js';
import { openPostgres } from '../shared/postgres.js';
import { createEvent, getEvent, listTemplates, setMessageRef, templateToEventInput, updateEvent, type HackathonEvent } from '../features/events/data.js';
import type { Db } from '../shared/db.js';
import { getDelivery } from '../features/events/delivery-data.js';
import { reconcileEventDelivery } from './event-delivery.js';
import { buildScheduleItineraryEmbed } from './schedule-itinerary.js';


async function reconcileFixture(db: Db, client: Client, event: HackathonEvent, now: number): Promise<void> {
  await db.run('UPDATE events SET name=?, description=?, schedule_json=?, assignments_json=?, announced_schedule_ids=? WHERE id=?',
    event.name, event.description, JSON.stringify(event.schedule), JSON.stringify(event.assignments), JSON.stringify(event.announcedScheduleIds), event.id);
  await reconcileEventDelivery(db, client, event, now);
}

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
        if (id === 'signup') assert.equal((payload as { enforceNonce?: boolean }).enforceNonce, true, 'signup sends use Discord nonce deduplication');
        const message = { id: `message-${++sent}`, author: { id: 'bot' }, payload,
          edit: async (next: unknown) => { message.payload = next; edited++; } };
        messages.set(message.id, message); return message;
      },
    });
    const guild = { id: guildId, channels: { fetch: async (id: string) => channel(id) } };
    const client = { user: { id: 'bot' }, guilds: { fetch: async () => guild } } as unknown as Client;
    await reconcileFixture(db, client, event, now);
    assert.equal(sent, 2, 'signup and announcement catch up even two days late');
    await reconcileFixture(db, client, event, now);
    assert.equal(sent, 2, 'unchanged passes do not duplicate posts');
    await db.run("INSERT INTO teams(id,event_id,guild_id,name,kind,text_channel_id,created_at) VALUES ('late','delivery-event',?,'Late builders','public','late-room',1)", guildId);
    failures.add('late-room');
    await reconcileFixture(db, client, event, now);
    assert.equal(sent, 2);
    failures.clear();
    event.announcedScheduleIds = ['kickoff'];
    await reconcileFixture(db, client, event, now);
    assert.equal(sent, 3, 'a completed block still retries the late team');
    const key = `${guildId}:delivery-event:kickoff:handout:team:late`;
    const delivery = await getDelivery(db, key);
    assert.ok(delivery?.messageId);
    assert.equal(delivery.channelId, 'late-room');
    await reconcileFixture(db, client, event, now);
    assert.equal(sent, 3);
    const editsBeforeRevision = edited;
    event.assignments.find(a => a.id === delivery.assignmentId)!.instructions = 'Revised brief';
    event.schedule[0]!.actions![1]!.message = 'Updated welcome';
    await reconcileFixture(db, client, event, now);
    assert.equal(edited, editsBeforeRevision + 2, 'edits replace the handout and announcement in place');
    assert.equal(sent, 3);
    assert.equal((await getDelivery(db, key))!.assignmentId, delivery.assignmentId);
    failures.add('announcements');
    event.schedule[0]!.actions![1]!.message = 'One more edit';
    await reconcileFixture(db, client, event, now);
    assert.equal(sent, 3, 'missing access does not create a duplicate message');
    failures.clear();
    await reconcileFixture(db, client, event, now);
    assert.equal(edited, editsBeforeRevision + 3, 'failed edits retry successfully');
    event.schedule[0]!.actions!.push({ id: 'added-after-kickoff', type: 'announce', title: 'A new note', message: 'Added later' });
    await reconcileFixture(db, client, event, now);
    assert.equal(sent, 4, 'new actions on a completed block are delivered');
  } finally { await db.close(); }
});

test('legacy signup actions in different channels retain their own panels on refresh', async () => {
  const db = await openTestDb();
  try {
    const now = Date.now(), guildId = '11111111111111111';
    await db.run("INSERT INTO events(id,guild_id,name,status,created_at,updated_at) VALUES ('panel-event',?,'Hackathon','active',1,1)", guildId);
    const event = (await getEvent(db, 'panel-event'))!;
    event.schedule = [{ id: 'signup', title: 'Signup', time: now - 1000, actions: [
      { id: 'first', type: 'post_signup', channelId: 'first-channel' },
      { id: 'second', type: 'post_signup', channelId: 'second-channel' },
    ] }];
    let sends = 0;
    const edits: string[] = [];
    let inaccessibleChannel: string | undefined;
    const messages = new Map<string, { id: string; author: { id: string }; edit: () => Promise<void> }>();
    const old = { id: 'legacy-panel', author: { id: 'bot' }, edit: async () => { edits.push('legacy-panel'); } };
    messages.set(old.id, old);
    await setMessageRef(db, `signup_panel_event:${guildId}:${event.id}`, { channelId: 'first-channel', messageId: old.id });
    const client = { user: { id: 'bot' }, guilds: { fetch: async () => ({ channels: { fetch: async (channelId: string) => ({
      isTextBased: () => true,
      messages: { fetch: async (id: string) => {
        if (channelId === inaccessibleChannel) throw Object.assign(new Error('Missing access'), { code: 50013 });
        return messages.get(id) ?? null;
      } },
      send: async () => {
        const id = `new-${++sends}`;
        const message = { id, author: { id: 'bot' }, edit: async () => { edits.push(id); } };
        messages.set(id, message);
        assert.equal(channelId, 'second-channel');
        return message;
      },
    }) } }) } } as unknown as Client;
    await reconcileFixture(db, client, event, now);
    assert.equal(sends, 1, 'an existing legacy panel is adopted, not reposted');
    assert.deepEqual(edits, ['legacy-panel']);
    event.name = 'Updated name';
    await reconcileFixture(db, client, event, now);
    assert.equal(sends, 1, 'refresh does not alternate new messages between channels');
    assert.deepEqual(edits, ['legacy-panel', 'legacy-panel', 'new-1']);
    assert.equal((await getDelivery(db, `${guildId}:${event.id}:signup:first`))?.messageId, 'legacy-panel');
    assert.equal((await getDelivery(db, `${guildId}:${event.id}:signup:second`))?.messageId, 'new-1');
    inaccessibleChannel = 'first-channel';
    event.name = 'Another update';
    await reconcileFixture(db, client, event, now);
    assert.equal(sends, 1, 'a failed fetch never creates a replacement panel');
    inaccessibleChannel = undefined;
    await reconcileFixture(db, client, event, now);
    assert.deepEqual(edits.slice(-2), ['new-1', 'legacy-panel'], 'only the failed panel retries');
    assert.equal(sends, 1);
  } finally { await db.close(); }
});

test('an update arriving during Discord delivery gets a follow-up pass', async () => {
  const db = await openTestDb();
  try {
    const now = Date.now(), guildId = '11111111111111111';
    await db.run("INSERT INTO events(id,guild_id,name,status,created_at,updated_at) VALUES ('queued-event',?,'Hackathon','active',1,1)", guildId);
    const event = (await getEvent(db, 'queued-event'))!;
    event.schedule = [{ id: 'kickoff', title: 'Kickoff', time: now - 1000, actions: [
      { id: 'note', type: 'announce', channelId: 'announcements', message: 'Before' },
    ] }];
    let release!: () => void, started!: () => void;
    const blocked = new Promise<void>(resolve => { release = resolve; });
    const sendStarted = new Promise<void>(resolve => { started = resolve; });
    let sends = 0, edits = 0;
    const message = { id: 'message', author: { id: 'bot' }, edit: async () => { edits++; } };
    const client = { user: { id: 'bot' }, guilds: { fetch: async () => ({ channels: { fetch: async () => ({
      isTextBased: () => true,
      messages: { fetch: async () => message },
      send: async () => { sends++; started(); await blocked; return message; },
    }) } }) } } as unknown as Client;
    const first = reconcileFixture(db, client, event, now);
    await sendStarted;
    const updated = structuredClone(event);
    updated.schedule[0]!.actions![0]!.message = 'After';
    const second = reconcileFixture(db, client, updated, now + 1);
    release();
    await Promise.all([first, second]);
    assert.equal(sends, 1);
    assert.equal(edits, 1, 'the queued update edits the just-posted message');
  } finally { await db.close(); }
});

test('independent workers do not concurrently post the same event delivery', async () => {
  const db = await openTestDb(1);
  const schema = (await db.get<{ name: string }>('SELECT current_schema() AS name'))!.name;
  const peer = await openPostgres(process.env.DATABASE_URL!, schema, 1);
  try {
    const now = Date.now(), guildId = '11111111111111111';
    await db.run("INSERT INTO events(id,guild_id,name,status,created_at,updated_at) VALUES ('workers-event',?,'Hackathon','active',1,1)", guildId);
    const event = (await getEvent(db, 'workers-event'))!;
    event.schedule = [{ id: 'kickoff', title: 'Kickoff', time: now - 1000, actions: [
      { id: 'note', type: 'announce', channelId: 'announcements', message: 'Welcome' },
    ] }];
    let release!: () => void, started!: () => void;
    const blocked = new Promise<void>(resolve => { release = resolve; });
    const sendStarted = new Promise<void>(resolve => { started = resolve; });
    let sends = 0;
    const message = { id: 'message', author: { id: 'bot' }, edit: async () => undefined };
    const client = { user: { id: 'bot' }, guilds: { fetch: async () => ({ channels: { fetch: async () => ({
      isTextBased: () => true,
      messages: { fetch: async () => message },
      send: async () => { sends++; started(); await blocked; return message; },
    }) } }) } } as unknown as Client;
    // Distinct module instance represents a separate worker's in-memory guard.
    const peerModulePath = './event-delivery.js?independent-worker';
    const peerWorker = await import(peerModulePath) as typeof import('./event-delivery.js');
    const first = reconcileFixture(db, client, event, now);
    await sendStarted;
    await peerWorker.reconcileEventDelivery(peer, client, event, now);
    assert.equal(sends, 1, 'a second worker skips while the first holds the lock');
    release();
    await first;
    await peerWorker.reconcileEventDelivery(peer, client, event, now);
    assert.equal(sends, 1, 'a later pass sees the persisted delivery receipt');
  } finally { await peer.close(); await db.close(); }
});

test('delivery rereads the current event after locking instead of using an old snapshot', async () => {
  const db = await openTestDb();
  try {
    const now = Date.now(), guildId = '11111111111111111';
    const schedule = [{ id: 'kickoff', title: 'Kickoff', time: now - 1000, actions: [{ id: 'note', type: 'announce', channelId: 'announcements', message: 'Old message' }] }];
    await db.run("INSERT INTO events(id,guild_id,name,status,schedule_json,created_at,updated_at) VALUES ('stale-event',?,'Hackathon','active',?,1,1)", guildId, JSON.stringify(schedule));
    const stale = (await getEvent(db, 'stale-event'))!;
    schedule[0]!.actions[0]!.message = 'New message';
    await db.run('UPDATE events SET schedule_json=?, updated_at=2 WHERE id=?', JSON.stringify(schedule), stale.id);
    const descriptions: string[] = [];
    const client = { user: { id: 'bot' }, guilds: { fetch: async () => ({ channels: { fetch: async () => ({
      isTextBased: () => true,
      messages: { fetch: async () => null },
      send: async (payload: { embeds: { data: { description: string } }[] }) => {
        descriptions.push(payload.embeds[0]!.data.description);
        return { id: 'message', author: { id: 'bot' } };
      },
    }) } }) } } as unknown as Client;
    await reconcileEventDelivery(db, client, stale, now);
    assert.deepEqual(descriptions, ['New message']);
    await db.run("UPDATE events SET status='ended', updated_at=3 WHERE id=?", stale.id);
    schedule[0]!.actions[0]!.message = 'Must not send';
    await db.run('UPDATE events SET schedule_json=? WHERE id=?', JSON.stringify(schedule), stale.id);
    await reconcileEventDelivery(db, client, stale, now);
    assert.deepEqual(descriptions, ['New message'], 'an old active snapshot cannot publish after the event ends');
  } finally { await db.close(); }
});

test('an undated handout does not send until its start anchor resolves', async () => {
  const db = await openTestDb();
  try {
    const guildId = '11111111111111111', start = Date.now() + 86400000;
    const result = await createEvent(db, 'test', guildId, { name: 'Undated', assignments: [{ id: 'brief', title: 'Brief', instructions: 'Build together' }], assignmentStrategy: 'same' });
    assert.ok(result.ok);
    if (!result.ok) return;
    await db.run("UPDATE events SET status='active' WHERE id=?", result.value.id);
    await db.run("INSERT INTO teams(id,event_id,guild_id,name,kind,text_channel_id,created_at) VALUES ('pending-team',?,?,'Team','public','team-room',1)", result.value.id, guildId);
    let sends = 0;
    const client = { user: { id: 'bot' }, guilds: { fetch: async () => ({ channels: { fetch: async () => ({
      isTextBased: () => true,
      messages: { fetch: async () => null },
      send: async () => ({ id: `message-${++sends}`, author: { id: 'bot' } }),
    }) } }) } } as unknown as Client;
    await reconcileEventDelivery(db, client, (await getEvent(db, result.value.id))!, Date.now());
    assert.equal(sends, 0);
    const updated = await updateEvent(db, 'test', result.value.id, { startsAt: start });
    assert.ok(updated.ok);
    if (!updated.ok) return;
    await reconcileEventDelivery(db, client, updated.value, start - 1);
    assert.equal(sends, 0);
    await reconcileEventDelivery(db, client, updated.value, start + 1);
    assert.equal(sends, 1);
    await reconcileEventDelivery(db, client, updated.value, start + 2);
    assert.equal(sends, 1, 'a later pass does not repeat the handout');
  } finally { await db.close(); }
});

test('undated starter activities and publication wait for their anchor dates', async () => {
  const db = await openTestDb();
  try {
    const guildId = '11111111111111111', start = Date.now() + 86400000;
    const template = (await listTemplates(db, guildId, 'event')).find(t => t.name.startsWith('EN ·'))!;
    const result = await createEvent(db, 'test', guildId, { ...templateToEventInput(template.json), name: 'Undated starter', panelChannelId: 'signup', scheduleChannelId: 'schedule', announcementChannelId: 'announcements' });
    assert.ok(result.ok);
    if (!result.ok) return;
    await db.run("UPDATE events SET status='active' WHERE id=?", result.value.id);
    const undated = (await getEvent(db, result.value.id))!;
    assert.doesNotMatch(buildScheduleItineraryEmbed(undated).data.description ?? '', /Welcome and introductions|Dinner|<t:0:/);
    let sends = 0;
    const messages = new Map<string, { id: string; author: { id: string }; edit: () => Promise<void> }>();
    const client = { user: { id: 'bot' }, guilds: { fetch: async () => ({ channels: { fetch: async () => ({
      isTextBased: () => true,
      messages: { fetch: async (id: string) => messages.get(id) ?? null },
      send: async () => { const message = { id: `message-${++sends}`, author: { id: 'bot' }, edit: async () => undefined }; messages.set(message.id, message); return message; },
    }) } }) } } as unknown as Client;
    await reconcileEventDelivery(db, client, undated, Date.now());
    assert.equal(sends, 0, 'no signup, announcement or itinerary before a date exists');
    const updated = await updateEvent(db, 'test', result.value.id, { startsAt: start, endsAt: start + 86400000 });
    assert.ok(updated.ok);
    if (!updated.ok) return;
    await reconcileEventDelivery(db, client, updated.value, start - 1);
    assert.equal(sends, 0);
    await reconcileEventDelivery(db, client, updated.value, start + 1);
    assert.equal(sends, 2, 'signup and schedule publish when the fallback anchor becomes due');
    await reconcileEventDelivery(db, client, updated.value, start + 6 * 3600000 + 1);
    assert.equal(sends, 3, 'later activity announcement is delivered at its resolved time');
  } finally { await db.close(); }
});

test('schedule publication waits until due, retries and edits one tracked message; legacy channels still publish', async () => {
  const db = await openTestDb();
  try {
    const now = Date.now(), guildId = '11111111111111111';
    for (const id of ['scheduled', 'legacy']) await db.run("INSERT INTO events(id,guild_id,name,status,schedule_channel_id,created_at,updated_at) VALUES (?,?,'Hackathon','active','default-channel',1,1)", id, guildId);
    const event = (await getEvent(db, 'scheduled'))!;
    event.schedule = [{ id: 'publication', title: 'Publication', time: now + 1000, actions: [{ id: 'publish', type: 'publish_schedule', channelId: 'selected-channel' }] }];
    const sent: { channel: string; nonce: unknown }[] = [];
    let edits = 0, fail = false;
    const messages = new Map<string, { id: string; author: { id: string }; edit: () => Promise<void> }>();
    const client = { user: { id: 'bot' }, guilds: { fetch: async () => ({ channels: { fetch: async (channel: string) => ({
      isTextBased: () => true,
      messages: { fetch: async (id: string) => messages.get(id) ?? null },
      send: async (payload: { nonce?: unknown; enforceNonce?: boolean }) => {
        if (fail) throw new Error('temporary failure');
        assert.equal(payload.enforceNonce, true);
        sent.push({ channel, nonce: payload.nonce });
        const message = { id: `message-${sent.length}`, author: { id: 'bot' }, edit: async () => { edits++; } };
        messages.set(message.id, message); return message;
      },
    }) } }) } } as unknown as Client;
    await reconcileFixture(db, client, event, now);
    assert.equal(sent.length, 0, 'explicit future action suppresses old automatic publication');
    fail = true;
    await assert.rejects(reconcileFixture(db, client, event, now + 1001), /temporary failure/);
    assert.equal(sent.length, 0);
    fail = false;
    await reconcileFixture(db, client, event, now + 2000);
    assert.equal(sent.length, 1);
    assert.equal(sent[0]?.channel, 'selected-channel');
    await reconcileFixture(db, client, event, now + 3000);
    assert.equal(sent.length, 1, 'unchanged reconciliation does not repost');
    event.description = 'Updated event details';
    await reconcileFixture(db, client, event, now + 4000);
    assert.equal(edits, 1);
    assert.equal(sent.length, 1, 'schedule edits update the same message');
    const legacy = (await getEvent(db, 'legacy'))!;
    await reconcileFixture(db, client, legacy, now);
    assert.equal(sent.length, 2);
    assert.equal(sent[1]?.channel, 'default-channel', 'events without new actions keep channel-driven publication');
  } finally { await db.close(); }
});
