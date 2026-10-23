import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setImmediate as nextTurn } from 'node:timers/promises';
import type { Client } from 'discord.js';
import { openTestDb } from '../shared/test-db.js';
import { getEvent, setMessageRef } from '../features/events/data.js';
import { DEFAULT_FORM } from '../features/form/domain.js';
import { runMaintenance } from './notify.js';
import { getSignupPanelRef, postOrUpdatePanel, refreshSignupPanel } from './signup-panel.js';
import { withGuildContext } from '../shared/postgres.js';

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

test('scheduled signup posting uses event form and reports Discord delivery failures', async () => {
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
  const makeGuild = (guildId: string, shouldFail: boolean) => ({
    id: guildId,
    channels: { fetch: async () => ({ isTextBased: () => true, messages: { fetch: async () => null }, send: async (payload: unknown) => {
      posted.push(payload);
      if (shouldFail) throw new Error('missing send permission');
      return { id: 'panel-message-1' };
    } }) },
  });
  const guilds = new Map([
    [guildOk, makeGuild(guildOk, false)], [guildFail, makeGuild(guildFail, true)],
  ]);
  const client = { user: { id: 'bot-user' }, guilds: { cache: guilds, fetch: async (id: string) => guilds.get(id) ?? null } } as unknown as Client;
  try {
    const summary = await runMaintenance({ db, client });
    assert.ok(summary.some(line => line.includes('schedule signup: event-ok')));
    assert.ok(summary.some(line => line.includes('schedule signup failed: event-fail') && line.includes('Could not post the panel')));
    assert.match((posted[0] as { embeds: { data: { description: string } }[] }).embeds[0]!.data.description, /Event-local form description/);
    assert.equal((posted[0] as { components: { components: { data: { custom_id: string } }[] }[] }).components[0]!.components[0]!.data.custom_id, 'hack:panel:event-ok:signup');
    const failureAudit = await withGuildContext(db, guildFail, () => db.get("SELECT 1 FROM audit_log WHERE actor = 'system' AND action = 'schedule.post_signup_failed' AND target = ?", 'event-fail'));
    assert.equal(failureAudit !== undefined, true);
    const manual = await withGuildContext(db, guildOk, () => postOrUpdatePanel(db, client, guildOk, '11111111111111111'));
    assert.ok(!('error' in manual));
    const manualPayload = posted.at(-1) as { embeds: { data: { description: string } }[]; components: { components: { data: { custom_id: string } }[] }[] };
    assert.match(manualPayload.embeds[0]!.data.description, /Event-local form description/);
    assert.equal(manualPayload.components[0]!.components[0]!.data.custom_id, 'hack:panel:event-ok:signup');
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
  const makeMessage = (id: string, payload: unknown) => {
    const message = { id, author: { id: 'bot' }, payload, edit: async (next: unknown) => { message.payload = next; } };
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
    await postOrUpdatePanel(db, client, guildId, '', 'en', forms[0], 'panel-event-0');
    await postOrUpdatePanel(db, client, guildId, channelId, 'en', forms[1], 'panel-event-1');
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
    await postOrUpdatePanel(db, client, guildId, secondChannelId, 'en', forms[0], 'panel-event-0');
    assert.equal((await getSignupPanelRef(db, guildId, 'panel-event-0'))?.channelId, secondChannelId);
    assert.deepEqual(await getSignupPanelRef(db, guildId, 'panel-event-1'), b);
    assert.deepEqual(messages.get('legacy-message')!.payload, { content: 'Preserve the legacy panel' });
  } finally { await db.close(); }
});
