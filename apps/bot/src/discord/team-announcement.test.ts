import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Client } from 'discord.js';
import type { Db } from '../shared/db.js';
import type { HackathonEvent } from '../features/events/data.js';
import { sendAnnouncement } from './notify.js';

test('manual announcement reports team chat deliveries and failures', async () => {
  const delivered: string[] = [];
  const rows = ['team-ok', 'team-fail', null].map((channel, index) => ({
    id: String(index), event_id: 'event', guild_id: '123456789012345678', name: 'Team',
    kind: 'public', text_channel_id: channel, created_at: 0,
  }));
  const db = {
    all: async (sql: string) => sql.includes('FROM teams') ? rows : [],
    run: async () => ({ changes: 1, lastInsertRowid: 1 }),
  } as unknown as Db;
  const guild = { members: { me: null }, channels: { fetch: async (id: string) => ({
    isTextBased: () => true,
    send: async () => { if (id === 'team-fail') throw new Error('unavailable'); delivered.push(id); },
  }) } };
  const client = { guilds: { fetch: async () => guild } } as unknown as Client;
  const event = { id: 'event', guildId: '123456789012345678', startsAt: null, endsAt: null, schedule: [], panelChannelId: null } as unknown as HackathonEvent;
  const result = await sendAnnouncement({ db, client }, 'organizer', event, 'Title', 'Message', false, '223456789012345678', true);
  assert.deepEqual(delivered, ['223456789012345678', 'team-ok']);
  assert.equal(result.posted, true);
  assert.equal(result.teamSent, 1);
  assert.equal(result.teamFailed, 2);
});
