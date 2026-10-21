import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Client } from 'pg';
import { openTestDb } from './test-db.js';

const pause = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
test('live hints are scope-only, committed, rollback-safe and schema-isolated', async () => {
  const db = await openTestDb();
  const schema = (await db.get<{ name: string }>('SELECT current_schema() AS name'))!.name;
  const listener = new Client({ connectionString: process.env.DATABASE_URL });
  await listener.connect();
  const hints: unknown[] = [];
  listener.on('notification', message => { const hint = JSON.parse(message.payload!); if (hint.schema === schema) hints.push(hint); });
  try {
    await listener.query('LISTEN chashack_changes');
    await db.transaction(async () => {
      await db.run("INSERT INTO events(id,guild_id,name,status,created_at,updated_at) VALUES ('live','guild','PRIVATE NAME','active',1,1)");
      await pause(40);
      assert.deepEqual(hints, [], 'nothing before commit');
    });
    await pause(100);
    assert.deepEqual(hints, [{ schema, table: 'events', guildId: 'guild', eventId: 'live', userId: null, teamId: null, targetId: null, requesterId: null }]);
    hints.length = 0;
    await assert.rejects(db.transaction(async () => {
      await db.run("UPDATE events SET name='PRIVATE ROLLBACK' WHERE id='live'");
      throw new Error('rollback');
    }), /rollback/);
    await pause(100);
    assert.deepEqual(hints, []);
  } finally { await listener.end(); await db.close(); }
});
