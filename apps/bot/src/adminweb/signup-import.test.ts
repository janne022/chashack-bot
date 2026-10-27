import assert from 'node:assert/strict';
import test from 'node:test';
import Fastify from 'fastify';
import { makeDiscordToken } from '../features/auth/domain.js';
import { createSession } from '../features/auth/data.js';
import { createEvent } from '../features/events/data.js';
import { DEFAULT_FORM } from '../features/form/domain.js';
import { openTestDb } from '../shared/test-db.js';
import { withGuildContext } from '../shared/postgres.js';
import type { Env } from '../shared/env.js';
import { registerRoutes } from './routes.js';

const secret = 'x'.repeat(48);
const guildId = '11111111111111111';
const ADA = '12345678901234567';
const BOB = '22345678901234567';
const CAROL = '32345678901234567';

test('organizer preview is read-only; confirmed rows persist and only a verified member can activate them', async () => {
  const db = await openTestDb();
  const session = await createSession(db, { userId: '99999999999999999', username: 'Organizer', avatar: null, guilds: [{ id: guildId, name: 'Guild', icon: null }] });
  const guild = {
    id: guildId, name: 'Guild', ownerId: session.userId,
    members: { fetch: async (id: string | { user: string }) => {
      if (typeof id === 'string' && id === '22345678901234567') throw new Error('Unknown Member');
      return { id: typeof id === 'string' ? id : id.user, permissions: { has: () => false, bitfield: 0n }, roles: { cache: new Map() } };
    } },
  };
  const client = { guilds: { cache: new Map([[guildId, guild]]), fetch: async () => guild } } as never;
  const app = Fastify({ logger: false });
  registerRoutes(app, { db, config: { adminSessionSecret: secret, adminIds: [], botLanguage: 'en' } as unknown as Env, client, announce: async () => undefined });
  const headers = { cookie: `hacksess=${encodeURIComponent(makeDiscordToken(secret, session.id))}` };
  try {
    const created = await withGuildContext(db, guildId, () => createEvent(db, 'test', guildId, { name: 'Import API test', form: { version: 1, title: 'T', description: '', teamSize: 4, experiences: [], roleTracks: [], skills: [], teamPrefs: [], customQuestions: [{ id: 'diet', kind: 'text', label: { en: 'Diet' }, help: { en: '' }, required: true, presentation: 'web', visibility: 'self_and_organizer' }] } }));
    assert.equal(created.ok, true);
    if (!created.ok) return;
    const eventId = created.value.id;
    const preview = await app.inject({ method: 'POST', url: `/api/events/${eventId}/signup-import/preview`, headers, payload: { csv: 'Timestamp,Name,Chas email,Dietary\r\n"31 Oct",Synthetic,Ada@example.test,""', mapping: { Dietary: 'diet' } } });
    assert.equal(preview.statusCode, 200, preview.body);
    assert.equal((await withGuildContext(db, guildId, () => db.get('SELECT id FROM imported_signups WHERE event_id=?', eventId))), undefined);
    assert.equal(preview.json().rows[0].values.name, 'Synthetic');
    const swedishPreview = await app.inject({ method: 'POST', url: `/api/events/${eventId}/signup-import/preview`, headers, payload: { csv: 'Tidstämpel,Ditt namn och klass,Din Chas-mail,Har du några allergier vi ska ta hänsyn till när vi köper fika?,Hur vill du delta i Hackoween?,Vilket område vill du helst jobba med under Hackatonet?\n2026-10-16,Ada,ada@example.test,Nej,Jag vill bli tilldelad en grupp,Backend' } });
    assert.equal(swedishPreview.statusCode, 200, swedishPreview.body);
    assert.deepEqual(swedishPreview.json().suggestedMapping, { Tidstämpel: 'sourceTimestamp', 'Ditt namn och klass': 'name', 'Din Chas-mail': 'email', 'Har du några allergier vi ska ta hänsyn till när vi köper fika?': 'allergies', 'Hur vill du delta i Hackoween?': 'teamPref', 'Vilket område vill du helst jobba med under Hackatonet?': 'skills' });
    assert.equal(swedishPreview.json().presetId, 'hackoween-google-form');
    const fullSwedishHeader = 'Tidstämpel,Ditt namn och klass,Din Chas-mail,Har du några allergier vi ska ta hänsyn till när vi köper fika?,Hur vill du delta i Hackoween?,Hur många är ni i er grupp?,Gruppnamn för dig som anmäler en färdig grupp,Namn på medlemmarna i gruppen,Vilket område vill du helst jobba med under Hackatonet?';
    const fullSwedish = await app.inject({ method: 'POST', url: `/api/events/${eventId}/signup-import/preview`, headers, payload: { csv: `${fullSwedishHeader}${String.fromCharCode(10)}2026-10-16,Ada,ada@example.test,Nej,random_team,2,Group A,Member A; Member B,frontend_react` } });
    assert.deepEqual(fullSwedish.json().suggestedMapping, { Tidstämpel: 'sourceTimestamp', 'Ditt namn och klass': 'name', 'Din Chas-mail': 'email', 'Har du några allergier vi ska ta hänsyn till när vi köper fika?': 'allergies', 'Hur vill du delta i Hackoween?': 'teamPref', 'Hur många är ni i er grupp?': 'groupSize', 'Gruppnamn för dig som anmäler en färdig grupp': 'groupName', 'Namn på medlemmarna i gruppen': 'members', 'Vilket område vill du helst jobba med under Hackatonet?': 'skills' });
    assert.equal(fullSwedish.json().rows[0].values['source:Vilket område vill du helst jobba med under Hackatonet?'], 'frontend_react');
    const row = preview.json().rows[0];
    const saved = await app.inject({ method: 'POST', url: `/api/events/${eventId}/signup-import`, headers, payload: { rows: [{ sourceRow: row.rowNumber, values: row.values, answers: row.answers }] } });
    assert.equal(saved.statusCode, 200, saved.body);
    const id = saved.json().rows[0].id;
    await withGuildContext(db, guildId, () => db.run("UPDATE events SET status='active' WHERE id=?", eventId));
    const incomplete = await app.inject({ method: 'PATCH', url: `/api/events/${eventId}/imported-signups/${id}`, headers, payload: { linkDiscordUserId: '12345678901234567' } });
    assert.equal(incomplete.statusCode, 200, incomplete.body);
    assert.deepEqual(incomplete.json().missingFields, ['diet']);
    assert.equal((await withGuildContext(db, guildId, () => db.get<{ user_id: string }>('SELECT user_id FROM participants WHERE event_id=?', eventId)))?.user_id, '12345678901234567');
    const linked = await app.inject({ method: 'PATCH', url: `/api/events/${eventId}/imported-signups/${id}`, headers, payload: { answers: { diet: 'vegetarian' }, linkDiscordUserId: '12345678901234567' } });
    assert.equal(linked.statusCode, 200, linked.body);
    assert.equal(linked.json().activated, true);
    assert.equal((await withGuildContext(db, guildId, () => db.get<{ user_id: string }>('SELECT user_id FROM participants WHERE event_id=?', eventId)))?.user_id, '12345678901234567');
    const beforeFailedLink = await withGuildContext(db, guildId, () => db.get<{ values_json: string; answers_json: string; discord_username: string | null }>('SELECT values_json,answers_json,discord_username FROM imported_signups WHERE id=?', id));
    // An organizer may re-bind a row (that path has its own test), so this link
    // fails for a reason that must still stop it: the target is blocked.
    await withGuildContext(db, guildId, () => db.run(`INSERT INTO participants (event_id,user_id,guild_id,display_name,experience,role_track,skills,team_pref,teammates,status,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,'[]','blocked',?,?)`, eventId, '22345678901234567', guildId, 'Blocked', '', '', '[]', '', Date.now(), Date.now()));
    const failedLink = await app.inject({ method: 'PATCH', url: `/api/events/${eventId}/imported-signups/${id}`, headers, payload: { values: { name: 'Must roll back' }, answers: { diet: 'changed' }, linkDiscordUserId: '22345678901234567' } });
    assert.equal(failedLink.statusCode, 400, failedLink.body);
    assert.equal(failedLink.json().error, 'registration_blocked');
    assert.equal(typeof failedLink.json().message, 'string');
    assert.deepEqual(await withGuildContext(db, guildId, () => db.get('SELECT values_json,answers_json,discord_username FROM imported_signups WHERE id=?', id)), beforeFailedLink);
    const foreignUrl = ['/api/events/', 'missing', '/imported-signups'].join('');
    const foreign = await app.inject({ method: 'GET', url: foreignUrl, headers });
    assert.equal(foreign.statusCode, 200);
    assert.deepEqual(foreign.json().records, []);
    const secondEvent = await withGuildContext(db, '22222222222222222', () => createEvent(db, 'test', '22222222222222222', { name: 'Other tenant' }));
    assert.equal(secondEvent.ok, true);
    if (secondEvent.ok) {
      const secondRow = await withGuildContext(db, '22222222222222222', () => db.run(`INSERT INTO imported_signups (id,event_id,guild_id,source_row,source_timestamp,form_version,values_json,answers_json,created_at,updated_at)
        VALUES (?,?,?,?,?,?,?,?,?,?)`, 'foreign-import', secondEvent.value.id, '22222222222222222', 2, '', 1, JSON.stringify({ name: 'Private foreign row' }), '{}', Date.now(), Date.now()));
      assert.equal(secondRow.changes, 1);
      const foreignPreview = await app.inject({ method: 'POST', url: `/api/events/${secondEvent.value.id}/signup-import/preview`, headers, payload: { csv: 'Name\nNope' } });
      assert.equal(foreignPreview.statusCode, 404);
      const foreignPatch = await app.inject({ method: 'PATCH', url: `/api/events/${secondEvent.value.id}/imported-signups/foreign-import`, headers, payload: { values: { name: 'Tampered' } } });
      assert.equal(foreignPatch.statusCode, 404);
      assert.equal((await withGuildContext(db, '22222222222222222', () => db.get<{ values_json: string }>('SELECT values_json FROM imported_signups WHERE id=?', 'foreign-import')))?.values_json, JSON.stringify({ name: 'Private foreign row' }));
    }
  } finally { await app.close(); await db.close(); }
});

test('organizer member search is bounded, guild-scoped and returns only identity fields', async () => {
  const db = await openTestDb();
  const session = await createSession(db, { userId: '99999999999999999', username: 'Organizer', avatar: null, guilds: [{ id: guildId, name: 'Guild', icon: null }] });
  let searchArgs: unknown;
  const guild = {
    id: guildId, name: 'Guild', ownerId: session.userId,
    members: {
      search: async (options: unknown) => { searchArgs = options; return new Map([['12345678901234567', { id: '12345678901234567', displayName: 'Ada Example', user: { username: 'ada', globalName: 'Ada Example', email: 'private@example.test' }, roles: { cache: new Map([['role', {}]]) } }]]); },
      fetch: async () => ({ id: session.userId, permissions: { has: () => false, bitfield: 0n }, roles: { cache: new Map() } }),
    },
  };
  const client = { guilds: { cache: new Map([[guildId, guild]]), fetch: async () => guild } } as never;
  const app = Fastify({ logger: false });
  registerRoutes(app, { db, config: { adminSessionSecret: secret, adminIds: [], botLanguage: 'en' } as unknown as Env, client, announce: async () => undefined });
  const headers = { cookie: `hacksess=${encodeURIComponent(makeDiscordToken(secret, session.id))}` };
  try {
    const anonymous = await app.inject({ method: 'GET', url: '/api/guild/members?query=ada' });
    assert.equal(anonymous.statusCode, 401);
    const result = await app.inject({ method: 'GET', url: '/api/guild/members?query=ada', headers });
    assert.equal(result.statusCode, 200, result.body);
    assert.deepEqual(searchArgs, { query: 'ada', limit: 10 });
    assert.deepEqual(result.json(), { members: [{ id: '12345678901234567', username: 'ada', displayName: 'Ada Example' }] });
    const short = await app.inject({ method: 'GET', url: '/api/guild/members?query=a', headers });
    assert.equal(short.statusCode, 400);
  } finally { await app.close(); await db.close(); }
});

const HACKOWEEN_HEADER = 'Tidsstämpel,Ditt namn och klass,Din chas-mail,Din discord username,Har du några allergier vi ska ta hänsyn till när vi köper fika?,Hur vill du delta i Hackoween?,Hur många är ni i er grupp?,Gruppnamn (för dig som anmäler i en färdig grupp),Namn på medlemmarna i gruppen,Vilket område vill du helst jobba med under Hackatonet?';

const memberFake = (id: string) => ({ id, permissions: { has: () => false, bitfield: 0n }, roles: { cache: new Map() } });

test('a raw Google Form export saves with tolerant normalization instead of a 400', async () => {
  const db = await openTestDb();
  const session = await createSession(db, { userId: '99999999999999999', username: 'Organizer', avatar: null, guilds: [{ id: guildId, name: 'Guild', icon: null }] });
  const guild = {
    id: guildId, name: 'Guild', ownerId: session.userId,
    members: { fetch: async (id: string | { user: string }) => memberFake(typeof id === 'string' ? id : id.user) },
  };
  const client = { guilds: { cache: new Map([[guildId, guild]]), fetch: async () => guild } } as never;
  const app = Fastify({ logger: false });
  registerRoutes(app, { db, config: { adminSessionSecret: secret, adminIds: [], botLanguage: 'en' } as unknown as Env, client, announce: async () => undefined });
  const headers = { cookie: `hacksess=${encodeURIComponent(makeDiscordToken(secret, session.id))}` };
  try {
    const created = await withGuildContext(db, guildId, () => createEvent(db, 'test', guildId, { name: 'Tolerant import', form: DEFAULT_FORM }));
    assert.equal(created.ok, true);
    if (!created.ok) return;
    const eventId = created.value.id;
    const templates = await app.inject({ method: 'GET', url: `/api/events/${eventId}/signup-import/templates`, headers });
    assert.equal(templates.statusCode, 200, templates.body);
    assert.equal(templates.json().templates[0].id, 'hackoween-google-form');
    const unknownTemplate = await app.inject({ method: 'POST', url: `/api/events/${eventId}/signup-import/preview`, headers, payload: { csv: HACKOWEEN_HEADER, templateId: 'nope' } });
    assert.equal(unknownTemplate.statusCode, 400);
    assert.equal(unknownTemplate.json().error, 'invalid_template');
    // Exported labels, an unmappable area and a free-text "other" answer — the
    // row must still save, with the unreadable parts recorded as warnings.
    const csv = [
      HACKOWEEN_HEADER,
      '2026-10-16,Ada Andersson,ada@example.test,ada#1,Inga,Jag vill bli tilldelad en grupp,3,Group A,"Member A; Member B","Frontend, UX, DevOps, Övrigt: kaffebryggare"',
      '2026-10-16,Bob Bsson,bob@example.test,,Gluten,Jag anmäler en färdig grupp,2,Group B,Member C,Backend',
    ].join(String.fromCharCode(10));
    const preview = await app.inject({ method: 'POST', url: `/api/events/${eventId}/signup-import/preview`, headers, payload: { csv } });
    assert.equal(preview.statusCode, 200, preview.body);
    assert.equal(preview.json().presetId, 'hackoween-google-form');
    const [ada, bob] = preview.json().rows as { values: Record<string, string>; answers: Record<string, string | string[]> }[];
    assert.equal(ada!.values.teamPref, 'random_team');
    assert.equal(ada!.values.skills, 'frontend_react,ui_design,devops');
    assert.equal(ada!.values.groupName, 'Group A');
    assert.equal(bob!.values.teamPref, 'join_team');
    assert.equal(bob!.values.skills, 'backend_node');

    const rows = (preview.json().rows as { rowNumber: number; values: Record<string, string>; answers: Record<string, string | string[]> }[]);
    // The preview already reports the area it could not translate.
    assert.ok((preview.json().rows[0].issues as string[]).some(issue => issue.includes('kaffebryggare')), preview.body);
    // An unreadable choice must not fail the batch: it is dropped and reported.
    const saved = await app.inject({ method: 'POST', url: `/api/events/${eventId}/signup-import`, headers, payload: { rows: rows.map((row, index) => ({ sourceRow: row.rowNumber, values: index === 0 ? { ...row.values, teamPref: 'Jag vill dansa' } : row.values, answers: row.answers })) } });
    assert.equal(saved.statusCode, 200, saved.body);
    assert.equal(saved.json().saved, 2);
    assert.equal(saved.json().warnings.length, 1, saved.body);
    assert.ok(String(saved.json().warnings[0].issues[0]).includes('teamPref'), saved.body);

    // The organizer edit route is equally tolerant: a label is translated, not rejected.
    const records = await withGuildContext(db, guildId, () => db.all<{ id: string; values_json: string }>('SELECT id,values_json FROM imported_signups WHERE event_id=? ORDER BY source_row', eventId));
    const edited = await app.inject({ method: 'PATCH', url: `/api/events/${eventId}/imported-signups/${records[1]!.id}`, headers, payload: { values: { ...JSON.parse(records[1]!.values_json), teamPref: 'Jag vill ha en öppen grupp', skills: 'Frontend' } } });
    assert.equal(edited.statusCode, 200, edited.body);
    assert.equal(edited.json().record.values.teamPref, 'create_team');
    assert.equal(edited.json().record.values.skills, 'frontend_react');
  } finally { await app.close(); await db.close(); }
});

test('a participant can claim only their own imported row, and only once', async () => {
  const db = await openTestDb();
  const organizer = await createSession(db, { userId: '99999999999999999', username: 'Organizer', avatar: null, guilds: [{ id: guildId, name: 'Guild', icon: null }] });
  const ada = await createSession(db, { userId: ADA, username: 'ada', avatar: null, guilds: [{ id: guildId, name: 'Guild', icon: null }], audience: 'participant' });
  const bob = await createSession(db, { userId: BOB, username: 'bob', avatar: null, guilds: [{ id: guildId, name: 'Guild', icon: null }], audience: 'participant' });
  const carol = await createSession(db, { userId: CAROL, username: 'carol', avatar: null, guilds: [{ id: guildId, name: 'Guild', icon: null }], audience: 'participant' });
  const outsider = await createSession(db, { userId: '99999999999999998', username: 'outsider', avatar: null, guilds: [{ id: guildId, name: 'Guild', icon: null }], audience: 'participant' });
  const guild = {
    id: guildId, name: 'Guild', ownerId: organizer.userId,
    members: { fetch: async (id: string | { user: string }) => {
      const userId = typeof id === 'string' ? id : id.user;
      if (![organizer.userId, ADA, BOB, CAROL].includes(userId)) throw new Error('Unknown Member');
      return memberFake(userId);
    } },
  };
  const client = { guilds: { cache: new Map([[guildId, guild]]), fetch: async () => guild } } as never;
  const app = Fastify({ logger: false });
  registerRoutes(app, { db, config: { adminSessionSecret: secret, adminIds: [], botLanguage: 'en' } as unknown as Env, client, announce: async () => undefined });
  const organizerHeaders = { cookie: `hacksess=${encodeURIComponent(makeDiscordToken(secret, organizer.id))}` };
  const participant = (id: string) => ({ cookie: `hackpartsess=${encodeURIComponent(makeDiscordToken(secret, id, Date.now(), 'participant'))}` });
  try {
    const created = await withGuildContext(db, guildId, () => createEvent(db, 'test', guildId, { name: 'Claim event', form: DEFAULT_FORM }));
    assert.equal(created.ok, true);
    if (!created.ok) return;
    const eventId = created.value.id;
    const csv = [
      HACKOWEEN_HEADER,
      '2026-10-16,Ada Andersson,ada@example.test,,Inga,Jag vill bli tilldelad en grupp,3,Group A,Member A,"Frontend, UX"',
      '2026-10-16,Bob Bsson,bob@example.test,,Gluten,Jag anmäler en färdig grupp,2,Group B,Member C,Backend',
      '2026-10-16,Carol Csson,carol@example.test,,Inga,random_team,1,,,DevOps',
    ].join(String.fromCharCode(10));
    const preview = await app.inject({ method: 'POST', url: `/api/events/${eventId}/signup-import/preview`, headers: organizerHeaders, payload: { csv } });
    assert.equal(preview.statusCode, 200, preview.body);
    const saved = await app.inject({ method: 'POST', url: `/api/events/${eventId}/signup-import`, headers: organizerHeaders, payload: { rows: (preview.json().rows as { rowNumber: number; values: Record<string, string>; answers: Record<string, string | string[]> }[]).map(row => ({ sourceRow: row.rowNumber, values: row.values, answers: row.answers })) } });
    assert.equal(saved.statusCode, 200, saved.body);
    await withGuildContext(db, guildId, () => db.run("UPDATE events SET status='active' WHERE id=?", eventId));

    const lookupUrl = `/api/participant/events/${eventId}/claim/lookup`;
    const claimUrl = `/api/participant/events/${eventId}/claim`;

    const anon = await app.inject({ method: 'POST', url: lookupUrl, payload: { email: 'ada@example.test' } });
    assert.equal(anon.statusCode, 401);
    const noMember = await app.inject({ method: 'POST', url: lookupUrl, headers: participant(outsider.id), payload: { email: 'ada@example.test' } });
    assert.equal(noMember.statusCode, 404);

    const invalid = await app.inject({ method: 'POST', url: lookupUrl, headers: participant(ada.id), payload: { email: 'nope' } });
    assert.equal(invalid.statusCode, 400);
    assert.equal(invalid.json().error, 'invalid_email');

    const unknown = await app.inject({ method: 'POST', url: lookupUrl, headers: participant(ada.id), payload: { email: 'nobody@example.test' } });
    assert.equal(unknown.statusCode, 200);
    assert.deepEqual(unknown.json(), { found: false });

    const found = await app.inject({ method: 'POST', url: lookupUrl, headers: participant(ada.id), payload: { email: '  ADA@example.test ' } });
    assert.equal(found.statusCode, 200, found.body);
    assert.equal(found.json().found, true);
    assert.equal(found.json().linkedToOther, false);
    assert.deepEqual(found.json().record, { name: 'Ada Andersson', groupName: 'Group A', discordUsername: null });
    // The lookup is identity-only: no answers, allergies or group members leak.
    assert.deepEqual(Object.keys(found.json().record).sort(), ['discordUsername', 'groupName', 'name']);

    const claimed = await app.inject({ method: 'POST', url: claimUrl, headers: participant(ada.id), payload: { email: 'ada@example.test' } });
    assert.equal(claimed.statusCode, 200, claimed.body);
    assert.equal(claimed.json().activated, true);
    assert.deepEqual(claimed.json().prefill.profile, { experience: '', roleTrack: '', skills: ['frontend_react', 'ui_design'], teamPref: 'random_team' });
    const participantRow = await withGuildContext(db, guildId, () => db.get<{ user_id: string }>("SELECT user_id FROM participants WHERE event_id=? AND user_id=?", eventId, ADA));
    assert.equal(participantRow?.user_id, ADA);
    const registration = await withGuildContext(db, guildId, () => db.get('SELECT user_id FROM registration_answers WHERE event_id=? AND user_id=?', eventId, ADA));
    assert.equal(registration !== undefined, true);

    // Someone else's row: visible as taken, but not claimable.
    const bobSeesAda = await app.inject({ method: 'POST', url: lookupUrl, headers: participant(bob.id), payload: { email: 'ada@example.test' } });
    assert.equal(bobSeesAda.json().linkedToOther, true);
    const steal = await app.inject({ method: 'POST', url: claimUrl, headers: participant(bob.id), payload: { email: 'ada@example.test' } });
    assert.equal(steal.statusCode, 409, steal.body);
    assert.equal(steal.json().error, 'identity_conflict');

    // Repeating a claim is idempotent rather than an error.
    const again = await app.inject({ method: 'POST', url: claimUrl, headers: participant(ada.id), payload: { email: 'ada@example.test' } });
    assert.equal(again.statusCode, 200, again.body);
    assert.equal(again.json().activated, true);

    // Bob has no participant yet, so his own row activates normally.
    const bobOwn = await app.inject({ method: 'POST', url: claimUrl, headers: participant(bob.id), payload: { email: 'bob@example.test' } });
    assert.equal(bobOwn.statusCode, 200, bobOwn.body);
    assert.equal(bobOwn.json().activated, true);

    // Carol already has a participant row, so her import is a conflict, not a duplicate.
    await withGuildContext(db, guildId, () => db.run(`INSERT INTO participants (event_id,user_id,guild_id,display_name,experience,role_track,skills,team_pref,teammates,status,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,'[]','active',?,?)`, eventId, CAROL, guildId, 'Carol', '', '', '[]', '', Date.now(), Date.now()));
    const carolConflict = await app.inject({ method: 'POST', url: claimUrl, headers: participant(carol.id), payload: { email: 'carol@example.test' } });
    assert.equal(carolConflict.statusCode, 409, carolConflict.body);
    assert.equal(carolConflict.json().error, 'participant_conflict');

    // A blocked participant cannot claim, even with a matching row.
    await withGuildContext(db, guildId, () => db.run("UPDATE participants SET status='blocked' WHERE event_id=? AND user_id=?", eventId, CAROL));
    const blocked = await app.inject({ method: 'POST', url: claimUrl, headers: participant(carol.id), payload: { email: 'carol@example.test' } });
    assert.equal(blocked.statusCode, 403, blocked.body);
    assert.equal(blocked.json().error, 'blocked');

    // Another guild's event is invisible to this participant.
    const secondEvent = await withGuildContext(db, '22222222222222222', () => createEvent(db, 'test', '22222222222222222', { name: 'Other tenant' }));
    assert.equal(secondEvent.ok, true);
    if (secondEvent.ok) {
      const foreign = await app.inject({ method: 'POST', url: `/api/participant/events/${secondEvent.value.id}/claim`, headers: participant(ada.id), payload: { email: 'ada@example.test' } });
      assert.equal(foreign.statusCode, 404);
      assert.equal(foreign.json().error, 'event_unavailable');
    }

    const audited = await withGuildContext(db, guildId, () => db.get<{ count: string }>("SELECT COUNT(*) AS count FROM audit_log WHERE action='participant.claim_import'"));
    assert.ok(Number(audited?.count ?? 0) >= 2);
  } finally { await app.close(); await db.close(); }
});
