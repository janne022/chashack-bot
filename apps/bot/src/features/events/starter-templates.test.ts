import test from 'node:test';
import assert from 'node:assert/strict';
import { openTestDb } from '../../shared/test-db.js';
import { openPostgres } from '../../shared/postgres.js';
import { createEvent, deleteTemplate, listTemplates, planMaintenance, saveTemplate, templateToEventInput, updateEvent } from './data.js';

test('concurrent workers seed one starter set without replacing user templates', async () => {
  const db = await openTestDb(1);
  const schema = (await db.get<{ name: string }>('SELECT current_schema() AS name'))!.name;
  const peer = await openPostgres(process.env.DATABASE_URL!, schema, 1);
  try {
    const guildId = '11111111111111111';
    assert.equal((await saveTemplate(db, 'test', guildId, 'Our event', 'event', JSON.stringify({ name: 'Original' }))).ok, true);
    await Promise.all([listTemplates(db, guildId), listTemplates(peer, guildId)]);
    const all = await listTemplates(db, guildId);
    for (const [kind, count] of [['event', 3], ['announcement', 4], ['form', 1], ['assignments', 1]] as const) {
      assert.equal(all.filter(template => template.kind === kind).length, count, `one ${kind} seed set`);
    }
    assert.equal(all.find(template => template.name === 'Our event')?.json, JSON.stringify({ name: 'Original' }));
    const starter = all.find(template => template.name === 'EN · Community build weekend')!;
    assert.equal((await deleteTemplate(db, 'test', starter.id)).ok, true);
    const again = await listTemplates(peer, guildId);
    assert.ok(!again.some(template => template.id === starter.id || template.name === starter.name), 'a deleted starter is not restored');
    assert.equal(again.filter(template => template.kind === 'event').length, 2);
  } finally { await peer.close(); await db.close(); }
});

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
      assert.ok(draft.schedule.find((s: { id: string }) => s.id === '__signup__').actions.some((a: { type: string }) => a.type === 'publish_schedule'));
      assert.ok(draft.schedule.every((s: { anchor?: string }) => s.anchor));
      assert.ok(first.some(t => t.kind === 'announcement' && t.name.startsWith(language + ' ·')));
    }
    assert.equal((await listTemplates(db, guildId)).length, first.length, 'refresh does not duplicate templates');
  } finally { await db.close(); }
});

test('starter event activities stay within long, short and moved events in both languages', async () => {
  const db = await openTestDb();
  try {
    const guildId = '11111111111111111', templates = await listTemplates(db, guildId, 'event');
    for (const language of ['EN', 'SV']) for (const duration of [30 * 60_000, 48 * 3600_000]) {
      const template = templates.find(t => t.name.startsWith(language + ' ·'))!;
      const startsAt = new Date(2030, 2, 1, 17, 30).getTime();
      const result = await createEvent(db, 'test', guildId, { ...templateToEventInput(template.json), name: 'Test event', startsAt, endsAt: startsAt + duration, signupStartsAt: startsAt - 86400_000, signupEndsAt: startsAt });
      assert.ok(result.ok);
      if (!result.ok) continue;
      for (const item of result.value.schedule.filter(s => !s.id.startsWith('__'))) assert.ok(item.time >= startsAt && item.time <= startsAt + duration, `${language} ${item.id} stays in event`);
      const moved = await updateEvent(db, 'test', result.value.id, { startsAt: startsAt + 2 * 86400_000 });
      assert.ok(moved.ok);
      if (moved.ok) for (const item of moved.value.schedule.filter(s => !s.id.startsWith('__'))) assert.ok(item.time >= moved.value.startsAt! && item.time <= moved.value.endsAt!);
    }
  } finally { await db.close(); }
});

test('upgrade updates only unchanged older starters and does not restore a deleted starter', async () => {
  const db = await openTestDb();
  try {
    const guildId = '11111111111111111', seeded = await listTemplates(db, guildId, 'event');
    const english = seeded.find(t => t.name.startsWith('EN ·'))!, swedish = seeded.find(t => t.name.startsWith('SV ·'))!;
    const old = (json: string) => {
      const draft = JSON.parse(json);
      const offsets: Record<string, number> = { welcome: 600, fika: 900, dinner: 1080, demos: 840 };
      for (const block of draft.schedule) if (block.id in offsets) { block.offsetMinutes = offsets[block.id]; delete block.offsetMode; delete block.withinEvent; }
      return draft;
    };
    const englishOld = old(english.json), swedishEdited = old(swedish.json);
    swedishEdited.description = 'Organizer custom description';
    await db.run('UPDATE event_templates SET json=? WHERE id=?', JSON.stringify(englishOld), english.id);
    await db.run('UPDATE event_templates SET json=? WHERE id=?', JSON.stringify(swedishEdited), swedish.id);
    await db.run('DELETE FROM meta WHERE key=?', `starter_templates_v3:${guildId}:event`);
    const upgraded = await listTemplates(db, guildId, 'event');
    assert.equal(JSON.parse(upgraded.find(t => t.id === english.id)!.json).schedule.find((s: { id: string }) => s.id === 'welcome').offsetMode, 'elapsed');
    assert.equal(upgraded.find(t => t.id === swedish.id)!.json, JSON.stringify(swedishEdited));
    await deleteTemplate(db, 'test', english.id);
    await db.run('DELETE FROM meta WHERE key=?', `starter_templates_v3:${guildId}:event`);
    assert.ok(!(await listTemplates(db, guildId, 'event')).some(t => t.name === english.name));
  } finally { await db.close(); }
});

test('signup dates may overlap the hackathon on create and edit', async () => {
  const db = await openTestDb();
  try {
    const start = Date.now() + 7 * 86400000;
    const created = await createEvent(db, 'test', 'guild', { name: 'Late signup', startsAt: start, endsAt: start + 86400000, signupStartsAt: start - 86400000, signupEndsAt: start + 3600000 });
    assert.ok(created.ok);
    if (!created.ok) return;
    assert.equal(JSON.parse(created.value.formJson!).enforceSignupWindow, true, 'new events enable signup window enforcement');
    assert.equal(created.value.signupEndsAt, start + 3600000);
    const updated = await updateEvent(db, 'test', created.value.id, { signupEndsAt: start + 7200000 });
    assert.ok(updated.ok);
    if (updated.ok) assert.equal(updated.value.signupEndsAt, start + 7200000);
    const invalid = await updateEvent(db, 'test', created.value.id, { signupEndsAt: start - 2 * 86400000 });
    assert.ok(!invalid.ok && invalid.code === 'bad_dates');
  } finally { await db.close(); }
});

test('undated assignment handout stays pending and resolves when a start is set', async () => {
  const db = await openTestDb();
  try {
    const pool = [{ id: 'brief', title: 'Brief', instructions: 'Build something' }];
    const result = await createEvent(db, 'test', 'guild', { name: 'Undated event', assignments: pool, assignmentStrategy: 'same' });
    assert.ok(result.ok);
    if (!result.ok) return;
    const pending = result.value.schedule.find(item => item.id === '__start__')!;
    assert.equal(pending.time, 0);
    assert.equal(pending.anchor, 'hackathon_start');
    assert.equal(pending.actions?.find(action => action.type === 'distribute_assignments')?.mode, 'same');
    assert.ok(!planMaintenance([{ ...result.value, status: 'active' }], Date.now()).some(action => action.type === 'schedule'));
    const start = Date.now() + 86400000;
    const updated = await updateEvent(db, 'test', result.value.id, { startsAt: start });
    assert.ok(updated.ok);
    if (!updated.ok) return;
    assert.equal(updated.value.schedule.find(item => item.id === '__start__')?.time, start);
    assert.equal(updated.value.schedule.find(item => item.id === '__start__')?.actions?.[0]?.mode, 'same');
    assert.ok(planMaintenance([{ ...updated.value, status: 'active' }], start + 1).some(action => action.type === 'schedule'));

    await db.run("INSERT INTO events(id,guild_id,name,status,assignments_json,created_at,updated_at) VALUES ('legacy-undated','guild','Legacy','draft',?,1,1)", JSON.stringify(pool));
    const legacy = await updateEvent(db, 'test', 'legacy-undated', { startsAt: start });
    assert.ok(legacy.ok && legacy.value.schedule.some(item => item.actions?.some(action => action.type === 'distribute_assignments')));
    await db.run("INSERT INTO events(id,guild_id,name,status,assignments_json,created_at,updated_at) VALUES ('explicit-undated','guild','Explicit','draft',?,1,1)", JSON.stringify(pool));
    const explicit = await updateEvent(db, 'test', 'explicit-undated', { startsAt: start, schedule: [] });
    assert.ok(explicit.ok && explicit.value.schedule.length === 0, 'explicit schedule is not overwritten');
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
