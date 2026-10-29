import test from 'node:test';
import assert from 'node:assert/strict';
import { openTestDb } from './test-db.js';
import { recoverFakeFixture } from './fixture-recovery.js';

test('fake recovery preserves two guilds, foreign keys and generated IDs and refuses nonempty targets', async () => {
  const source = await openTestDb();
  const target = await openTestDb();
  try {
    await assert.rejects(recoverFakeFixture(source, target), /fake fixture/);
    await source.run("INSERT INTO meta VALUES ('fake_fixture', 'true')");
    for (const guild of ['11111111111111111', '22222222222222222']) {
      await source.run('INSERT INTO events (id,guild_id,name,created_at,updated_at) VALUES (?,?,?,?,?)', `event-${guild}`, guild, 'Fake event', 1700000000000, 1700000000000);
      await source.run('INSERT INTO form_config (guild_id,json,updated_at) VALUES (?,?,?)', guild, JSON.stringify({ title: `Fake form ${guild}` }), 1700000000000);
      await source.run('INSERT INTO audit_log (id,ts,actor,action,target,guild_id) VALUES (?,?,?,?,?,?)', guild.startsWith('1') ? 40 : 41, 1700000000000, 'fake-user', 'fixture', `event-${guild}`, guild);
    }
    await source.run("INSERT INTO guild_settings (guild_id,updated_at) VALUES ('11111111111111111',1)");
    await source.run("INSERT INTO event_templates (id,guild_id,name,kind,json,created_at) VALUES ('template','11111111111111111','fake','event','{}',1)");
    await source.run("INSERT INTO teams (id,event_id,guild_id,name,kind,created_at) VALUES ('team','event-11111111111111111','11111111111111111','fake','open',1)");
    await source.run("INSERT INTO participants (event_id,user_id,guild_id,display_name,experience,role_track,skills,team_pref,teammates,team_id,created_at,updated_at) VALUES ('event-11111111111111111','user','11111111111111111','fake','x','x','[]','random_team','[]','team',1,1)");
    await source.run("INSERT INTO registration_answers VALUES ('event-11111111111111111','user',1,'{\"signup\":\"kept\"}',1)");
    await source.run("INSERT INTO registration_form_versions VALUES ('event-11111111111111111',1,'{}',1)");
    await source.run("INSERT INTO registration_answer_history VALUES ('event-11111111111111111','user',0,'{\"old\":\"kept\"}',1)");
    await source.run("INSERT INTO submission_forms VALUES ('event-11111111111111111',2,1,1,'[]',1)");
    await source.run("INSERT INTO submission_answers VALUES ('event-11111111111111111','user',2,'{\"project\":\"kept\"}',1,1)");
    await source.run("INSERT INTO imported_signups(id,event_id,guild_id,source_row,values_json,created_at,updated_at) VALUES ('import','event-11111111111111111','11111111111111111',2,'{\"name\":\"Imported\"}',1,1)");
    await source.run("INSERT INTO imported_signup_answer_history VALUES ('event-11111111111111111','import',0,'{\"old\":\"kept\"}','{\"allergies\":\"retained\"}',1)");
    await source.run("INSERT INTO meta VALUES ('schedule_itinerary:event-11111111111111111','{\"channelId\":\"channel\",\"messageId\":\"message\"}')");
    await source.run("INSERT INTO team_requests (id,event_id,guild_id,team_id,requester_id,target_id,kind,created_at) VALUES (50,'event-11111111111111111','11111111111111111','team','user','other','join',1)");
    await source.run("INSERT INTO web_sessions (id,user_id,username,created_at,expires_at) VALUES ('session','user','fake',1,2)");
    // Failure late in the copy must roll back all preceding tables.
    await target.run("ALTER TABLE web_sessions ADD CONSTRAINT fixture_refusal CHECK (id <> 'session')");
    await assert.rejects(recoverFakeFixture(source, target), /fixture_refusal/);
    for (const table of ['meta','events','guild_settings','event_templates','form_config','teams','participants','registration_form_versions','registration_answers','registration_answer_history','submission_forms','submission_answers','imported_signups','imported_signup_answer_history','team_requests','audit_log','web_sessions']) {
      assert.equal((await target.get(`SELECT count(*) AS count FROM ${table}`))?.count, 0);
    }
    await target.run('ALTER TABLE web_sessions DROP CONSTRAINT fixture_refusal');
    await recoverFakeFixture(source, target);
    assert.equal((await target.get("SELECT team_id FROM participants WHERE user_id = 'user'"))?.team_id, 'team');
    for (const table of ['registration_answers', 'registration_form_versions', 'registration_answer_history', 'submission_forms', 'submission_answers', 'imported_signups', 'imported_signup_answer_history']) {
      assert.deepEqual(await target.all(`SELECT * FROM ${table}`), await source.all(`SELECT * FROM ${table}`), `${table} survives recovery`);
    }
    assert.equal((await target.get<{ value: string }>("SELECT value FROM meta WHERE key='schedule_itinerary:event-11111111111111111'"))?.value, '{"channelId":"channel","messageId":"message"}');
    assert.equal((await target.get("INSERT INTO team_requests (guild_id,team_id,requester_id,target_id,kind,created_at) VALUES ('11111111111111111','team','user','other','join',1) RETURNING id"))?.id, 51);
    assert.equal((await target.get('SELECT count(*) AS count FROM events'))?.count, 2);
    assert.deepEqual((await target.all('SELECT guild_id,json,updated_at FROM form_config ORDER BY guild_id')).map(row => ({ ...row })), (await source.all('SELECT guild_id,json,updated_at FROM form_config ORDER BY guild_id')).map(row => ({ ...row })));
    assert.deepEqual((await target.all('SELECT guild_id FROM audit_log ORDER BY id')).map(r => r.guild_id), ['11111111111111111', '22222222222222222']);
    const row = await target.get('INSERT INTO audit_log (ts,actor,action) VALUES (?,?,?) RETURNING id', 1, 'fake', 'test');
    assert.equal(row?.id, 42);
    await assert.rejects(recoverFakeFixture(source, target), /empty destination/);
  } finally { await source.close(); await target.close(); }
});
