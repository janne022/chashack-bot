import test from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from './db.js';
import { openTestDb } from './test-db.js';
import { recoverFakeFixture } from './fixture-recovery.js';

test('fake recovery preserves two guilds, foreign keys and generated IDs and refuses nonempty targets', async () => {
  const source = openDb(':memory:');
  const target = await openTestDb();
  try {
    await assert.rejects(recoverFakeFixture(source, target), /fake fixture/);
    await source.run("INSERT INTO meta VALUES ('fake_fixture', 'true')");
    for (const guild of ['11111111111111111', '22222222222222222']) {
      await source.run('INSERT INTO events (id,guild_id,name,created_at,updated_at) VALUES (?,?,?,?,?)', `event-${guild}`, guild, 'Fake event', 1700000000000, 1700000000000);
      await source.run('INSERT INTO form_config (guild_id,json,updated_at) VALUES (?,?,?)', guild, JSON.stringify({ title: `Fake form ${guild}` }), 1700000000000);
      await source.run('INSERT INTO audit_log (id,ts,actor,action,target,guild_id) VALUES (?,?,?,?,?,?)', guild.startsWith('1') ? 40 : 41, 1700000000000, 'fake-user', 'fixture', `event-${guild}`, guild);
    }
    await recoverFakeFixture(source, target);
    assert.equal((await target.get('SELECT count(*) AS count FROM events'))?.count, 2);
    assert.deepEqual((await target.all('SELECT guild_id,json,updated_at FROM form_config ORDER BY guild_id')).map(row => ({ ...row })), (await source.all('SELECT guild_id,json,updated_at FROM form_config ORDER BY guild_id')).map(row => ({ ...row })));
    assert.deepEqual((await target.all('SELECT guild_id FROM audit_log ORDER BY id')).map(r => r.guild_id), ['11111111111111111', '22222222222222222']);
    const row = await target.get('INSERT INTO audit_log (ts,actor,action) VALUES (?,?,?) RETURNING id', 1, 'fake', 'test');
    assert.equal(row?.id, 42);
    await assert.rejects(recoverFakeFixture(source, target), /empty destination/);
  } finally { source.close(); await target.close(); }
});
