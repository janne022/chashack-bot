import assert from 'node:assert/strict';
import { test } from 'node:test';
import { openTestDb } from '../shared/test-db.js';
import { startScheduleRunner } from './schedule-runner.js';

const pause = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

test('schedule runner responds to event edits and delivers an announcement at its new time', { timeout: 15000 }, async () => {
  const db = await openTestDb();
  const guildId = '11111111111111111';
  const sent: number[] = [];
  const channel = { isTextBased: () => true, send: async () => { sent.push(Date.now()); return { id: 'message' }; } };
  const guild = { id: guildId, channels: { fetch: async () => channel } };
  const client = { user: { id: 'bot' }, guilds: { cache: new Map([[guildId, guild]]), fetch: async () => guild } };
  const block = (time: number) => JSON.stringify([{ id: 'notice', title: 'Notice', time, actions: [{ id: 'post', type: 'announce', title: 'Hello', message: 'World', channelId: 'channel' }] }]);
  const now = Date.now();
  await db.run("INSERT INTO events (id,guild_id,name,status,match_locked,schedule_json,created_at,updated_at) VALUES (?,?,?,'active',1,?,?,?)", 'event', guildId, 'Event', block(now + 30_000), now, now);
  const stop = startScheduleRunner({ db, client: client as never });
  try {
    await pause(500);
    const due = Date.now() + 1500;
    await db.run('UPDATE events SET schedule_json=? WHERE id=?', block(due), 'event');
    while (sent.length === 0 && Date.now() < due + 5000) await pause(50);
    assert.equal(sent.length, 1, 'announcement is sent without waiting for housekeeping');
    assert.ok(sent[0]! >= due, 'announcement is not sent early');
    assert.ok(sent[0]! < due + 5000, 'announcement follows the edited time');
  } finally { stop(); await pause(200); }
});
