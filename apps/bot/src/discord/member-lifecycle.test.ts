import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Events, type Client } from 'discord.js';
import { openTestDb } from '../shared/test-db.js';
import { lookupGuildMember, registerMemberLifecycle } from './member-lifecycle.js';

 test('gateway departure deletes immediately; offline errors and bot absence are not member departure', async () => {
  const db = await openTestDb();
  const handlers = new Map<string, (...args: any[]) => unknown>();
  let failure: unknown = null;
  const guild = { id: 'g', available: true, members: { fetch: async () => { if (failure) throw failure; return { id: 'user' }; } } };
  const client = { on: (name: string, fn: (...args: any[]) => unknown) => handlers.set(name, fn), guilds: { cache: new Map([['g', guild]]), fetch: async () => guild } } as unknown as Client;
  try {
    await db.run("INSERT INTO events (id,guild_id,name,status,created_at,updated_at) VALUES ('ev','g','test','active',1,1)");
    const seed = () => db.run("INSERT INTO participants (event_id,user_id,guild_id,display_name,experience,role_track,skills,team_pref,teammates,status,created_at,updated_at) VALUES ('ev','user','g','Name','','','[]','','[]','active',1,1)");
    await seed();
    const reconcile = registerMemberLifecycle(db, client);
    failure = { code: 50013 };
    await assert.rejects(() => lookupGuildMember(client, 'g', 'user'));
    await reconcile();
    assert.equal((await db.all('SELECT * FROM participants')).length, 1);
    failure = { code: 10007 };
    assert.equal(await lookupGuildMember(client, 'g', 'user'), false);
    await reconcile();
    assert.equal((await db.all('SELECT * FROM participants')).length, 0);
    await seed();
    await handlers.get(Events.GuildMemberRemove)!({ guild: { id: 'g' }, id: 'user' });
    assert.equal((await db.all('SELECT * FROM participants')).length, 0);
    assert.ok(handlers.has(Events.ClientReady));
    assert.ok(handlers.has(Events.ShardResume));
    assert.equal(handlers.has(Events.GuildDelete), false);
  } finally { await db.close(); }
});
