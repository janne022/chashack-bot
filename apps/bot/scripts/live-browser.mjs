#!/usr/bin/env node
/** @journey:live-updates — two served browser audiences and a real app-role/RLS DB.
 * Discord membership and OAuth sessions are synthetic; SSE, HTTP, DB and DOM are real. */
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { openTestDb } from '../dist/shared/test-db.js';
import { openPostgres, withGuildContext } from '../dist/shared/postgres.js';
import { startAdminServer } from '../dist/adminweb/server.js';
import { createSession } from '../dist/features/auth/data.js';
import { makeDiscordToken } from '../dist/features/auth/domain.js';
import { DEFAULT_FORM } from '../dist/features/form/domain.js';
import { createTeam } from '../dist/features/teams/data.js';
import { createInvite } from '../dist/features/teams/requests-data.js';

const profile = await mkdtemp(join(tmpdir(), 'live-browser-'));
const evidence = join(tmpdir(), 'sse-evidence');
const {chromePath} = await import('./chrome-path.mjs');
const chrome = spawn(chromePath, ['--headless=new', '--no-sandbox', '--disable-dev-shm-usage', '--remote-debugging-port=0', `--user-data-dir=${profile}`, 'about:blank'], { stdio: 'ignore' }); // g0:allow:secrets t_c2833b53 — public Chromium executable path and launch flags, no credential.
let owner, db, server, browser, role;
const checks = [];
const check = (name, condition) => { assert.ok(condition, name); checks.push(name); console.log(`PASS ${name}`); };
try {
  owner = await openTestDb();
  const schema = (await owner.get('SELECT current_schema() AS name')).name;
  role = `rls_${randomUUID().replaceAll('-', '')}`;
  const password = randomUUID();
  await owner.run(`CREATE ROLE ${role} LOGIN PASSWORD '${password}' NOSUPERUSER NOBYPASSRLS`);
  await owner.run(`GRANT USAGE ON SCHEMA ${schema} TO ${role}`);
  await owner.run(`GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA ${schema} TO ${role}`);
  await owner.run(`GRANT USAGE ON ALL SEQUENCES IN SCHEMA ${schema} TO ${role}`);
  const url = new URL(process.env.DATABASE_URL); url.username = role; url.password = password;
  db = await openPostgres(url.toString(), schema, 1);
  const guildA = '11111111111111111', guildB = '22222222222222222';
  const members = new Set(['subject', 'other', 'admin']);
  let admin = true;
  const guilds = new Map([guildA, guildB].map(id => [id, { id, name: id, available: true, ownerId: 'owner',
    members: { fetch: async input => {
      const user = typeof input === 'string' ? input : input.user;
      if (!members.has(user) || id !== guildA) throw Object.assign(Error('Unknown Member'), { code: 10007 });
      return { id: user, permissions: { has: () => user === 'admin' && admin, bitfield: user === 'admin' && admin ? 8n : 0n }, roles: { cache: new Map() } };
    } }, channels: { fetch: async () => null, cache: new Map() }, roles: { cache: new Map() },
  }]));
  const client = { guilds: { cache: guilds, fetch: async id => guilds.get(id) } };
  const form = { ...DEFAULT_FORM, teamSize: 3, customQuestions: [{ id: 'idea', kind: 'text', label: { en: 'Your idea', sv: 'Din idé' }, help: { en: '' }, required: false, presentation: 'web', visibility: 'self_and_organizer' }] };
  for (const [id, guild] of [['a', guildA], ['a2', guildA], ['b', guildB]]) {
    await owner.run("INSERT INTO events(id,guild_id,name,description,status,form_json,created_at,updated_at) VALUES (?,?,?,'Description','active',?,1,1)", id, guild, `Event ${id}`, JSON.stringify(form));
    for (const user of ['subject', 'other']) await owner.run("INSERT INTO participants(event_id,user_id,guild_id,display_name,experience,role_track,skills,team_pref,teammates,created_at,updated_at) VALUES (?,?,?,?,'','','[]','','[]',1,1)", id, user, guild, user);
  }
  const base = 'http://127.0.0.1:8493';
  const config = { adminSessionSecret: 's'.repeat(48), adminPort: 8493, publicUrl: base, skipDiscord: true, botLanguage: 'en', adminIds: [] };
  server = await startAdminServer({ db, config, client, announce: async () => undefined });
  const org = await createSession(db, { userId: 'admin', username: 'Admin', avatar: null, guilds: [{ id: guildA, name: 'A', icon: null }] });
  const part = await createSession(db, { userId: 'subject', username: 'Subject', avatar: null, guilds: [], audience: 'participant' });
  let ws;
  for (let i = 0; i < 100; i++) { try { const [port] = (await readFile(join(profile, 'DevToolsActivePort'), 'utf8')).split('\n'); ws = (await (await fetch(`http://127.0.0.1:${port}/json/version`)).json()).webSocketDebuggerUrl; break; } catch {} await delay(50); }
  assert.ok(ws); browser = new WebSocket(ws);
  await new Promise((resolve, reject) => { browser.addEventListener('open', resolve, { once: true }); browser.addEventListener('error', reject, { once: true }); });
  let seq = 0; const pending = new Map(), exceptions = [];
  browser.addEventListener('message', event => { const message = JSON.parse(event.data); if (message.id) { pending.get(message.id)?.(message); pending.delete(message.id); } if (message.method === 'Runtime.exceptionThrown') exceptions.push(message.params.exceptionDetails.text); });
  const send = (method, params = {}, sessionId) => new Promise((resolve, reject) => { const id = ++seq; pending.set(id, m => m.error ? reject(Error(JSON.stringify(m.error))) : resolve(m.result)); browser.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) })); });
  const evaluate = async (sid, expression) => { const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }, sid); if (result.exceptionDetails) throw Error(JSON.stringify(result.exceptionDetails)); return result.result.value; };
  const wait = async (sid, expression, ms = 5000) => { const end = Date.now() + ms; while (Date.now() < end) { if (await evaluate(sid, expression)) return; await delay(50); } throw Error(`Timeout ${expression}: ${await evaluate(sid, 'document.body.innerText')}`); };
  const nav = async (sid, path) => { await send('Page.navigate', { url: base + path }, sid); await wait(sid, `document.readyState==='complete'&&document.querySelector('#root')?.innerText.trim().length>0`); };
  const page = async (cookie, token, width, locale) => {
    const context = await send('Target.createBrowserContext');
    const target = await send('Target.createTarget', { url: 'about:blank', browserContextId: context.browserContextId });
    const sid = (await send('Target.attachToTarget', { targetId: target.targetId, flatten: true })).sessionId;
    await send('Page.enable', {}, sid); await send('Runtime.enable', {}, sid); await send('Network.enable', {}, sid);
    await send('Emulation.setDeviceMetricsOverride', { width, height: 1000, deviceScaleFactor: 1, mobile: false }, sid);
    await send('Network.setCookie', { name: cookie, value: token, url: base, httpOnly: true }, sid);
    await send('Page.addScriptToEvaluateOnNewDocument', { source: `window.liveSources=[];window.NativeEventSource=window.EventSource;window.EventSource=class extends window.NativeEventSource{constructor(...args){super(...args);window.liveSources.push(this)}};localStorage.setItem('chas-event','a');localStorage.setItem('chas-locale','${locale}')` }, sid);
    return sid;
  };
  const orgPage = await page('hacksess', makeDiscordToken(config.adminSessionSecret, org.id), 1440, 'en');
  const partPage = await page('hackpartsess', makeDiscordToken(config.adminSessionSecret, part.id, Date.now(), 'participant'), 390, 'sv');
  await nav(orgPage, '/operations?tab=teams'); await nav(partPage, '/team?eventId=a');
  await wait(orgPage, 'window.liveSources.some(s=>s.readyState===1)'); await wait(partPage, 'window.liveSources.some(s=>s.readyState===1)');
  check('two served audience clients share exactly one PostgreSQL listener', (await owner.all('SELECT pid FROM pg_stat_activity WHERE application_name=?', `chashack-live:${schema}`)).length === 1);
  let team;
  await withGuildContext(db, guildA, async () => { const result = await createTeam(db, 'synthetic-discord-service', 'a', guildA, 'Live service team', 'public', 'other'); assert.ok(result.ok, JSON.stringify(result)); team = result.value; });
  await wait(partPage, `document.body.innerText.includes('Live service team')`); await wait(orgPage, `document.body.innerText.includes('Live service team')`);
  check('service mutation reaches organizer team panels and participant public team list within 5s', true);
  await withGuildContext(db, guildA, async () => { const invite = await createInvite(db, 'discord:other', 'a', guildA, team.id, 'subject', 3); assert.ok(invite.ok, JSON.stringify(invite)); });
  await wait(partPage, `[...document.querySelectorAll('button')].some(b=>b.innerText==='Acceptera')`);
  check('own incoming invitation arrives without reload', true);
  await evaluate(partPage, `[...document.querySelectorAll('button')].find(b=>b.innerText==='Acceptera').click()`);
  await wait(partPage, `document.body.innerText.includes('2 medlemmar')`);
  await wait(orgPage, `document.body.innerText.includes('subject')`);
  check('second browser participant acceptance updates both authoritative team panels', true);
  const renamed = await evaluate(orgPage, `fetch('/api/teams/${team.id}/settings',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({name:'Browser renamed'})}).then(async r=>({status:r.status,body:await r.json()}))`);
  assert.equal(renamed.status, 200, JSON.stringify(renamed));
  await wait(partPage, `document.body.innerText.includes('Browser renamed')`);
  check('organizer HTTP settings mutation reaches own participant view', true);
  await assert.rejects(withGuildContext(db, guildA, () => db.transaction(async () => { await db.run("UPDATE teams SET name='Rolled back' WHERE id=?", team.id); throw Error('rollback'); })), /rollback/);
  await delay(250); check('rolled-back service mutation never becomes visible', !(await evaluate(partPage, `document.body.innerText.includes('Rolled back')`)));
  await nav(partPage, '/events/a/signup'); await wait(partPage, `!!document.querySelector('#idea')`);
  await evaluate(partPage, `(()=>{const e=document.querySelector('#idea');e.focus();Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(e,'UNSAVED SV');e.dispatchEvent(new Event('input',{bubbles:true}));window.editedNode=e})()`);
  await withGuildContext(db, guildA, () => db.run("INSERT INTO registration_answers(event_id,user_id,form_version,answers_json,updated_at) VALUES ('a','subject',1,'{\"idea\":\"SERVER\"}',1) ON CONFLICT(event_id,user_id) DO UPDATE SET answers_json=EXCLUDED.answers_json"));
  await delay(350);
  check('live signup refresh preserves dirty answer, DOM node and focus', await evaluate(partPage, `document.querySelector('#idea').value==='UNSAVED SV'&&document.activeElement===window.editedNode&&document.querySelector('#idea')===window.editedNode`));
  await evaluate(partPage, `(()=>{const original=window.fetch;window.fetch=async(...args)=>{const response=await original(...args);if(args[1]?.method==='PUT'&&String(args[0]).includes('/registration')&&!window.saveHeld){window.saveHeld=true;await new Promise(resolve=>window.releaseSave=resolve)}return response};const e=document.querySelector('#idea');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(e,'SAVED V1');e.dispatchEvent(new Event('input',{bubbles:true}));})()`);
  await evaluate(partPage, `document.querySelector('form').requestSubmit()`);
  await wait(partPage, 'window.saveHeld===true');
  await evaluate(partPage, `(()=>{const e=document.querySelector('#idea');e.focus();Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(e,'UNSAVED V2');e.dispatchEvent(new Event('input',{bubbles:true}));})()`);
  await evaluate(partPage, 'window.releaseSave()');
  await wait(partPage, `!document.querySelector('button[type=submit]').disabled`);
  await evaluate(partPage, `window.dispatchEvent(new Event('focus'))`);
  await delay(500);
  check('edits made during an older save survive refocus with their DOM node and focus', await evaluate(partPage, `document.querySelector('#idea').value==='UNSAVED V2'&&document.activeElement===window.editedNode&&document.querySelector('#idea')===window.editedNode`));
  await evaluate(partPage, `document.querySelector('form').requestSubmit()`);
  await wait(partPage, `!document.querySelector('button[type=submit]').disabled`);
  const savedDraft = await evaluate(partPage, `fetch('/api/participant/events/a/registration').then(r=>r.json())`);
  check('newer draft remains savable after the older save completes', savedDraft.answers.idea === 'UNSAVED V2');
  await owner.run("UPDATE events SET description='FOREIGN PRIVATE' WHERE id='b'");
  check('foreign snapshot and private values never appear in either browser', !(await evaluate(partPage, `document.body.innerText.includes('FOREIGN PRIVATE')`)) && !(await evaluate(orgPage, `document.body.innerText.includes('FOREIGN PRIVATE')`)));
  await owner.run('SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE application_name=?', `chashack-live:${schema}`);
  await withGuildContext(db, guildA, () => db.run("UPDATE teams SET name='Recovered after listener loss' WHERE id=?", team.id));
  await wait(orgPage, `document.body.innerText.includes('Recovered after listener loss')`, 5000);
  check('listener failure reconnect performs authoritative recovery of missed mutation', true);
  await evaluate(orgPage, `window.liveSources.forEach(s=>s.close())`);
  await withGuildContext(db, guildA, () => db.run("UPDATE teams SET name='Focus recovered' WHERE id=?", team.id));
  await evaluate(orgPage, `window.dispatchEvent(new Event('focus'))`);
  await wait(orgPage, `document.body.innerText.includes('Focus recovered')`);
  check('browser refocus recovers missed mutations without polling', true);
  await nav(orgPage, '/events');
  await wait(orgPage, `!![...document.querySelectorAll('.card-interactive')].find(e=>e.innerText.includes('Event a2'))`);
  await evaluate(orgPage, `(()=>{const original=window.fetch;window.fetch=async(...args)=>{const response=await original(...args);if(String(args[0]).includes('/api/state?eventId=a')&&!String(args[0]).includes('eventId=a2')&&!window.heldState){window.heldState=true;await new Promise(resolve=>window.releaseState=resolve)}return response};window.dispatchEvent(new Event('focus'))})()`);
  await wait(orgPage, 'window.heldState===true');
  await evaluate(orgPage, `[...document.querySelectorAll('.card-interactive')].find(e=>e.innerText.includes('Event a2')).click()`);
  await wait(orgPage, `localStorage.getItem('chas-event')==='a2'&&window.liveSources.some(s=>s.url.endsWith('eventId=a2')&&s.readyState===1)`);
  await evaluate(orgPage, 'window.releaseState()'); await delay(250);
  check('late previous-event state cannot restore the old selection or stream after SPA navigation', await evaluate(orgPage, `localStorage.getItem('chas-event')==='a2'&&window.liveSources.filter(s=>s.readyState===1).every(s=>s.url.endsWith('eventId=a2'))`));
  await nav(orgPage, '/events?event=a'); await wait(orgPage, `[...document.querySelectorAll('button')].some(b=>b.innerText==='Edit event')`);
  await evaluate(orgPage, `[...document.querySelectorAll('button')].find(b=>b.innerText==='Edit event').click()`);
  await wait(orgPage, `!!document.querySelector('[role=dialog] input')`);
  await evaluate(orgPage, `(()=>{const e=document.querySelector('[role=dialog] input');e.focus();Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,'UNSAVED ORGANIZER');e.dispatchEvent(new Event('input',{bubbles:true}));window.editedNode=e})()`);
  await withGuildContext(db, guildA, () => db.run("UPDATE events SET description='Live description' WHERE id='a'"));
  await delay(350);
  check('organizer edit dialog retains dirty input and focused node', await evaluate(orgPage, `document.querySelector('[role=dialog] input').value==='UNSAVED ORGANIZER'&&document.activeElement===window.editedNode`));
  await mkdir(evidence, { recursive: true });
  for (const [sid, name] of [[orgPage, 'organizer-desktop-en.png'], [partPage, 'participant-mobile-sv.png']]) {
    check(`${name} fits actual viewport`, await evaluate(sid, 'document.documentElement.scrollWidth<=innerWidth'));
    const image = await send('Page.captureScreenshot', { format: 'png' }, sid); await writeFile(join(evidence, name), Buffer.from(image.data, 'base64'));
  }
  members.delete('subject');
  await wait(partPage, `!!document.querySelector('[data-live-status=disconnected]')`, 25000);
  check('Swedish participant revocation exposes localized disconnected state', await evaluate(partPage, `document.body.innerText.includes('Liveuppdateringar är frånkopplade')`));
  const count = await evaluate(partPage, 'window.liveSources.length'); await delay(1200);
  check('denied stream stops reconnect attempts', await evaluate(partPage, `window.liveSources.length===${count}`));
  check('no browser runtime exceptions', exceptions.length === 0);
  console.log(JSON.stringify({ checks: checks.length, evidence, synthetic: ['OAuth sessions', 'Discord membership and service actor'] }));
} finally {
  browser?.close(); chrome.kill('SIGTERM');
  await server?.stop(); await db?.close();
  if (role && owner) { await owner.run(`DROP OWNED BY ${role}`); await owner.run(`DROP ROLE ${role}`); }
  await owner?.close(); await rm(profile, { recursive: true, force: true });
}
