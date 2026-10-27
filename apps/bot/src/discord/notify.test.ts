import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setImmediate as nextTurn } from 'node:timers/promises';
import type { Client } from 'discord.js';
import { openTestDb } from '../shared/test-db.js';
import { getEvent, setMessageRef } from '../features/events/data.js';
import { DEFAULT_FORM } from '../features/form/domain.js';
import { runMaintenance, syncDiscordEvent } from './notify.js';
import { getSignupPanelRef, postOrUpdatePanel, refreshSignupPanel } from './signup-panel.js';
import { withGuildContext } from '../shared/postgres.js';
import { handleEventAdminCommand } from './event-commands.js';

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

test('concurrent maintenance passes send a reminder only once', async () => {
  const db = await openTestDb();
  const now = Date.now();
  const guildId = '123456789012345678';
  await db.run(`INSERT INTO events (id, guild_id, name, status, starts_at, panel_channel_id, created_at, updated_at)
    VALUES (?, ?, ?, 'active', ?, ?, ?, ?)`, 'reminder-event', guildId, 'Event', now + 3600000, '223456789012345678', now, now);
  let entered!: () => void;
  let release!: () => void;
  const sending = new Promise<void>(resolve => { entered = resolve; });
  const gate = new Promise<void>(resolve => { release = resolve; });
  let sends = 0;
  const channel = { isTextBased: () => true, send: async () => { sends++; entered(); await gate; } };
  const guild = { id: guildId, channels: { fetch: async () => channel } };
  const client = { guilds: { cache: new Map([[guildId, guild]]), fetch: async () => guild } } as unknown as Client;
  const first = runMaintenance({ db, client, now });
  try {
    await sending;
    await runMaintenance({ db, client, now });
    assert.equal(sends, 1);
    release();
    await first;
    await runMaintenance({ db, client, now });
    assert.equal(sends, 1, 'a later pass must observe the completed reminder');
  } finally {
    release();
    await first;
    await db.close();
  }
});

test('scheduled signup posting uses the event form and records delivery', async () => {
  const db = await openTestDb();
  const now = Date.now();
  const schedule = [{ id: 'signup', time: now - 1, title: 'Signup opens', actions: [{ id: 'post', type: 'post_signup', channelId: '11111111111111111' }] }];
  const failedSchedule = [{ ...schedule[0]!, id: 'signup-failed', actions: [{ id: 'post-failed', type: 'post_signup', channelId: '22222222222222222' }] }];
  const localForm = { ...DEFAULT_FORM, title: 'Event-local signup', description: 'Event-local form description' };
  const guildOk = '11111111111111111';
  const guildFail = '22222222222222222';
  for (const [id, guild, form, blocks] of [['event-ok', guildOk, JSON.stringify(localForm), schedule], ['event-fail', guildFail, null, failedSchedule]] as const) {
    await db.run(`INSERT INTO events (id, guild_id, name, status, form_json, schedule_json, created_at, updated_at)
      VALUES (?, ?, ?, 'active', ?, ?, ?, ?)`, id, guild, id, form, JSON.stringify(blocks), now, now);
  }
  const posted: unknown[] = [];
  let sends = 0;
  const makeGuild = (guildId: string, shouldFail: boolean) => {
    const messages = new Map<string, { id: string; author: { id: string }; payload: unknown; edit: (next: unknown) => Promise<void> }>();
    return {
      id: guildId,
      channels: {
        fetch: async () => ({
          isTextBased: () => true,
          messages: { fetch: async (id: string) => messages.get(id) ?? null },
          send: async (payload: unknown) => {
            if (shouldFail) throw new Error('missing send permission');
            const message = { id: `panel-message-${++sends}`, author: { id: 'bot-user' }, payload, edit: async (next: unknown) => { message.payload = next; } };
            messages.set(message.id, message);
            posted.push(payload);
            return message;
          },
        }),
      },
    };
  };
  const guilds = new Map([
    [guildOk, makeGuild(guildOk, false)], [guildFail, makeGuild(guildFail, true)],
  ]);
  const client = { user: { id: 'bot-user' }, guilds: { cache: guilds, fetch: async (id: string) => guilds.get(id) ?? null } } as unknown as Client;
  try {
    await runMaintenance({ db, client });
    const okPayload = posted[0] as { embeds: { data: { description: string } }[]; components: { components: { data: { custom_id: string } }[] }[] };
    assert.ok(okPayload, 'the event-scoped signup panel is posted');
    assert.match(okPayload.embeds[0]!.data.description, /Event-local form description/);
    assert.equal(okPayload.components[0]!.components[0]!.data.custom_id, 'hack:panel:event-ok:signup');
    const okRef = await withGuildContext(db, guildOk, () => getSignupPanelRef(db, guildOk, 'event-ok'));
    assert.ok(okRef, 'a successful post is recorded for later edits');
    assert.equal(await withGuildContext(db, guildFail, () => getSignupPanelRef(db, guildFail, 'event-fail')), null, 'a failed post records nothing');
    await runMaintenance({ db, client });
    assert.equal(sends, 1, 'the recorded delivery is not re-posted');
    // A later manual refresh edits the recorded message rather than creating a second panel.
    const manual = await withGuildContext(db, guildOk, () => postOrUpdatePanel(db, client, guildOk, '11111111111111111'));
    assert.ok(!('error' in manual) && manual.edited);
    assert.equal(manual.messageId, okRef!.messageId);
  } finally { await db.close(); }
});

test('two active event panels remain independent in shared and different channels', async () => {
  const db = await openTestDb();
  const guildId = '11111111111111111';
  const channelId = '22222222222222222';
  const secondChannelId = '33333333333333333';
  const forms = [ { ...DEFAULT_FORM, title: 'Event A form' }, { ...DEFAULT_FORM, title: 'Event B form' } ];
  const messages = new Map<string, { id: string; author: { id: string }; payload: unknown; edit: (payload: unknown) => Promise<void> }>();
  let sends = 0;
  const edits: string[] = [];
  const makeMessage = (id: string, payload: unknown) => {
    const message = { id, author: { id: 'bot' }, payload, edit: async (next: unknown) => { edits.push(id); message.payload = next; } };
    messages.set(id, message);
    return message;
  };
  makeMessage('legacy-message', { content: 'Preserve the legacy panel' });
  const channel = { isTextBased: () => true, messages: { fetch: async (id: string) => messages.get(id) ?? null },
    send: async (payload: unknown) => makeMessage(`message-${++sends}`, payload) };
  const client = { user: { id: 'bot' }, guilds: { fetch: async () => ({ channels: { fetch: async () => channel } }) } } as unknown as Client;
  try {
    for (const [index, form] of forms.entries()) await db.run(
      "INSERT INTO events (id,guild_id,name,status,form_json,created_at,updated_at) VALUES (?,?,?,'active',?,?,?)",
      `panel-event-${index}`, guildId, form.title, JSON.stringify(form), index + 1, index + 1);
    await setMessageRef(db, `signup_panel:${guildId}`, { channelId, messageId: 'legacy-message' });
    await postOrUpdatePanel(db, client, guildId, '', 'en', 'panel-event-0');
    await postOrUpdatePanel(db, client, guildId, channelId, 'en', 'panel-event-1');
    const a = await getSignupPanelRef(db, guildId, 'panel-event-0');
    const b = await getSignupPanelRef(db, guildId, 'panel-event-1');
    assert.ok(a && b);
    assert.notEqual(a.messageId, b.messageId);
    assert.equal(sends, 2);
    const originalA = JSON.stringify(messages.get(a.messageId)!.payload);
    assert.match(originalA, /Event A form/);
    assert.match(JSON.stringify(messages.get(b.messageId)!.payload), /hack:panel:panel-event-1:signup/);
    await refreshSignupPanel(db, client, guildId);
    assert.equal(sends, 2, 'refresh edits only the selected active event panel');
    assert.equal(JSON.stringify(messages.get(a.messageId)!.payload), originalA);
    await postOrUpdatePanel(db, client, guildId, secondChannelId, 'en', 'panel-event-0');
    assert.equal((await getSignupPanelRef(db, guildId, 'panel-event-0'))?.channelId, secondChannelId);
    assert.deepEqual(await getSignupPanelRef(db, guildId, 'panel-event-1'), b);
    const context = { db, config: forms[1]!, botLocale: 'en' as const, guildId, actor: 'test', eventId: 'panel-event-1', eventName: 'Event B', hasActiveEvent: true, isAdmin: true, client, categoryIdFor: () => undefined, dm: async () => false };
    const command = { options: { getString: () => 'panel-event-0' }, reply: async () => undefined };
    await handleEventAdminCommand(command as never, context, 'event-activate');
    assert.equal(edits.at(-1), (await getSignupPanelRef(db, guildId, 'panel-event-0'))?.messageId, 'activating older event refreshes its own message');
    await db.run('UPDATE events SET panel_channel_id = ? WHERE id = ?', channelId, 'panel-event-0');
    await handleEventAdminCommand(command as never, context, 'event-activate');
    assert.equal((await getSignupPanelRef(db, guildId, 'panel-event-0'))?.channelId, channelId);
    assert.deepEqual(await getSignupPanelRef(db, guildId, 'panel-event-1'), b, 'explicit activation channel never takes over the newer event ref');
    assert.deepEqual(messages.get('legacy-message')!.payload, { content: 'Preserve the legacy panel' });
  } finally { await db.close(); }
});

test('syncDiscordEvent creates one linked event and updates it instead of duplicating', async () => {
  const db = await openTestDb();
  const guildId = '123456789012345678';
  const now = Date.now();
  await db.run(`INSERT INTO events (id, guild_id, name, description, status, starts_at, ends_at, created_at, updated_at)
    VALUES (?, ?, ?, ?, 'active', ?, ?, ?, ?)`,
    'sync-event', guildId, 'Sync hackathon', 'Build things', now + 3_600_000, now + 7_200_000, now, now);

  const scheduled: { id: string; name: string; edit: (next: { name: string }) => Promise<void> }[] = [];
  const guild = {
    id: guildId,
    scheduledEvents: {
      fetch: async (id: string) => {
        const found = scheduled.find((item) => item.id === id);
        if (found === undefined) throw Object.assign(new Error('Unknown Guild Scheduled Event'), { code: 10070 });
        return found;
      },
      create: async (payload: { name: string }) => {
        const item = { id: `scheduled-${scheduled.length + 1}`, name: payload.name, edit: async (next: { name: string }) => { item.name = next.name; } };
        scheduled.push(item);
        return item;
      },
    },
  };
  const client = { guilds: { fetch: async () => guild } } as unknown as Client;
  try {
    const event = (await getEvent(db, 'sync-event'))!;
    const created = await syncDiscordEvent({ db, client }, 'test', event);
    assert.equal(created.created.length, 1);
    assert.equal(scheduled.length, 1);
    assert.deepEqual((await getEvent(db, 'sync-event'))?.discordEventIds, ['scheduled-1']);

    const linked = (await getEvent(db, 'sync-event'))!;
    await db.run('UPDATE events SET starts_at = ?, ends_at = ? WHERE id = ?', now + 5_000_000, now + 9_000_000, 'sync-event');
    const updated = await syncDiscordEvent({ db, client }, 'test', (await getEvent(db, 'sync-event'))!);
    assert.equal(updated.created.length, 0);
    assert.equal(updated.updated.length, 1);
    assert.equal(scheduled.length, 1, 'a linked Discord event is moved, not duplicated');
    assert.deepEqual((await getEvent(db, 'sync-event'))?.discordEventIds, linked.discordEventIds);
  } finally { await db.close(); }
});

test('maintenance links the missing Discord event for an active hackathon and leaves drafts alone', async () => {
  const db = await openTestDb();
  const guildId = '123456789012345678';
  const now = Date.now();
  await db.run(`INSERT INTO events (id, guild_id, name, description, status, starts_at, ends_at, created_at, updated_at)
    VALUES (?, ?, ?, ?, 'active', ?, ?, ?, ?)`,
    'unlinked-event', guildId, 'Running hackathon', 'Build things', now + 3_600_000, now + 7_200_000, now, now);
  await db.run(`INSERT INTO events (id, guild_id, name, status, starts_at, created_at, updated_at)
    VALUES (?, ?, ?, 'draft', ?, ?, ?)`,
    'draft-event', guildId, 'Draft hackathon', now + 86_400_000, now, now);

  const created: { name: string; scheduledStartTime: number; scheduledEndTime: number }[] = [];
  const guild = {
    id: guildId,
    scheduledEvents: {
      create: async (payload: { name: string; scheduledStartTime: number; scheduledEndTime: number }) => {
        created.push(payload);
        return { id: `scheduled-${created.length}` };
      },
      fetch: async () => { throw Object.assign(new Error('Unknown Guild Scheduled Event'), { code: 10070 }); },
    },
  };
  const client = { guilds: { cache: new Map([[guildId, guild]]), fetch: async () => guild } } as unknown as Client;
  try {
    await runMaintenance({ db, client, now });
    assert.equal(created.length, 1, 'the running hackathon gets its missing Discord event');
    assert.deepEqual((await getEvent(db, 'unlinked-event'))?.discordEventIds, ['scheduled-1']);
    assert.equal(created[0]!.scheduledStartTime, now + 3_600_000, 'the real start date is used');

    await runMaintenance({ db, client, now: now + 60_000 });
    assert.equal(created.length, 1, 'an already linked event is not created twice');
    assert.deepEqual((await getEvent(db, 'draft-event'))?.discordEventIds, [], 'drafts stay unlinked until they go live');
  } finally { await db.close(); }
});

test('a hackathon that already started is created as running now instead of skipped', async () => {
  const db = await openTestDb();
  const guildId = '123456789012345678';
  const now = Date.now();
  await db.run(`INSERT INTO events (id, guild_id, name, description, status, starts_at, ends_at, created_at, updated_at)
    VALUES (?, ?, ?, ?, 'active', ?, ?, ?, ?)`,
    'running-event', guildId, 'Already running', 'Build things', now - 3_600_000, now + 3_600_000, now, now);

  const created: { scheduledStartTime: number; scheduledEndTime: number }[] = [];
  const guild = {
    id: guildId,
    scheduledEvents: {
      create: async (payload: { scheduledStartTime: number; scheduledEndTime: number }) => {
        created.push(payload);
        return { id: 'scheduled-running' };
      },
      fetch: async () => { throw Object.assign(new Error('Unknown Guild Scheduled Event'), { code: 10070 }); },
    },
  };
  const client = { guilds: { fetch: async () => guild } } as unknown as Client;
  try {
    const result = await syncDiscordEvent({ db, client }, 'test', (await getEvent(db, 'running-event'))!);
    assert.equal(result.created.length, 1);
    assert.ok(created[0]!.scheduledStartTime > now, 'a start in the past is moved forward so Discord accepts it');
    assert.equal(created[0]!.scheduledEndTime, now + 3_600_000, 'the real end date is kept');
  } finally { await db.close(); }
});
