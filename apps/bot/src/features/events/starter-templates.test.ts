import test from 'node:test';
import assert from 'node:assert/strict';
import { openTestDb } from '../../shared/test-db.js';
import { listTemplates, saveTemplate, updateEvent } from './data.js';

test('refreshed starter templates include both languages, use relative dates and preserve custom templates', async () => {
  const db = await openTestDb();
  try {
    const guildId = '11111111111111111';
    const custom = await saveTemplate(db, 'test', guildId, 'Our own event', 'event', JSON.stringify({ name: 'Keep this', schedule: [] }));
    assert.equal(custom.ok, true);
    const first = await listTemplates(db, guildId);
    assert.ok(first.some(t => t.name === 'Our own event'));
    for (const language of ['EN', 'SV']) {
      const starter = first.find(t => t.kind === 'event' && t.name.startsWith(language + ' ·'));
      assert.ok(starter);
      const draft = JSON.parse(starter.json);
      assert.equal(draft.startsAt, undefined, 'no stale calendar dates');
      assert.equal(draft.schedule.filter((s: { id: string }) => s.id === '__signup__').length, 1);
      assert.equal(draft.schedule.find((s: { id: string }) => s.id === '__signup__').actions[0].type, 'post_signup');
      assert.ok(draft.schedule.every((s: { anchor?: string }) => s.anchor));
      assert.ok(first.some(t => t.kind === 'announcement' && t.name.startsWith(language + ' ·')));
    }
    assert.equal((await listTemplates(db, guildId)).length, first.length, 'refresh does not duplicate templates');
  } finally { await db.close(); }
});


test('editing only the start date moves saved dates and both kinds of activity', async () => {
  const db = await openTestDb();
  try {
    const before = new Date(); before.setDate(before.getDate() + 5); before.setHours(10, 0, 0, 0);
    const after = new Date(before); after.setDate(after.getDate() + 4); after.setHours(11);
    const dinner = new Date(before); dinner.setHours(18);
    const schedule = [{id:'__start__',title:'Start',time:before.getTime(),anchor:'hackathon_start',offsetMinutes:0},{id:'dinner',title:'Dinner',time:dinner.getTime()}];
    await db.run("INSERT INTO events(id,guild_id,name,status,starts_at,ends_at,signup_starts_at,signup_ends_at,schedule_json,created_at,updated_at) VALUES ('move','guild','Move test','active',?,?,?,?,?,1,1)", before.getTime(),before.getTime()+86400000,before.getTime()-86400000,before.getTime(),JSON.stringify(schedule));
    const changed = await updateEvent(db,'test','move',{startsAt:after.getTime()});
    assert.equal(changed.ok,true);
    if (!changed.ok) return;
    assert.equal(changed.value.endsAt,after.getTime()+86400000);
    assert.equal(changed.value.signupEndsAt,after.getTime());
    assert.equal(changed.value.schedule.find(item=>item.id==='__start__')!.time,after.getTime());
    const expectedDinner = new Date(after); expectedDinner.setHours(18);
    assert.equal(changed.value.schedule.find(item=>item.id==='dinner')!.time,expectedDinner.getTime());
  } finally { await db.close(); }
});
