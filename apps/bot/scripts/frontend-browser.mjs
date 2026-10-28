#!/usr/bin/env node
/**
 * @journey:organizer-setup — DOM/AX checks against the built UI and a synthetic
 * PostgreSQL session. Does not perform or claim a real Discord OAuth login.
 */
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { startChrome } from './chrome-startup.mjs';
import { createHash } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';

const port = 8493;
const base = `http://127.0.0.1:${port}`;
const chromeProfile = await mkdtemp(join(tmpdir(), 'chashack-oauth-chrome-'));
let chrome;
let server;
let db;
let browser;
const axeSource = process.env.AXE_PATH ? await readFile(process.env.AXE_PATH, 'utf8') : null;
const checks = [];
function check(name, condition, detail = '') {
  assert.ok(condition, `${name}${detail ? ` — ${detail}` : ''}`);
  checks.push(name);
  console.log(`PASS ${name}`);
}

try {
  chrome = await startChrome(chromeProfile, { args: ['--host-resolver-rules=MAP chashack.test 127.0.0.1'] });
  const [{ startAdminServer }, { openTestDb }, { createSession }, { makeDiscordToken }, { withGuildContext }] = await Promise.all([
    import('../dist/adminweb/server.js'), import('../dist/shared/test-db.js'),
    import('../dist/features/auth/data.js'), import('../dist/features/auth/domain.js'), import('../dist/shared/postgres.js'),
  ]);
  db = await openTestDb();
  const syntheticUserId = `synthetic-${Date.now()}`;
  const guildIds = ['11111111111111111', '22222222222222222'];
  const botGuilds = new Map(guildIds.map((id, index) => [id, {
    id, name: `Synthetic test guild ${index + 1}`, ownerId: syntheticUserId,
    members: {
      fetch: async (userId) => ({ id: userId, permissions: { has: () => false, bitfield: 0n }, roles: { cache: new Map() } }),
      search: async ({ query }) => 'synthetic.member'.startsWith(query.toLowerCase()) ? new Map([['33333333333333333', { id: '33333333333333333', displayName: 'Synthetic Member', user: { username: 'synthetic.member', displayAvatarURL: () => '/favicon.svg' } }]]) : new Map(),
    },
  }]));
  const client = { guilds: { cache: botGuilds, fetch: async (id) => botGuilds.get(id) } };
  const config = {
    adminSessionSecret: 'x'.repeat(32), adminPort: port, clientId: 'synthetic-client',
    discordClientSecret: 'synthetic-client-secret', // g0:allow:secrets t_ce43eb96 — synthetic OAuth test value only.
    oauthRedirectUri: `${base}/auth/discord/callback`,
    skipDiscord: true, adminIds: [], guildId: undefined,
    discordToken: '', announceChannelId: undefined, auditChannelId: undefined,
    teamCategoryId: undefined, botLanguage: 'en', databaseUrl: process.env.DATABASE_URL,
  };
  server = await startAdminServer({
    db, config, announce: async () => undefined, client,
  });
  const session = await createSession(db, {
    userId: syntheticUserId, username: 'Synthetic browser user', avatar: null,
    guilds: guildIds.map((id, index) => ({ id, name: `Synthetic test guild ${index + 1}`, icon: null })),
  });
  const cookie = `hacksess=${encodeURIComponent(makeDiscordToken(config.adminSessionSecret, session.id))}`;
  browser = new WebSocket(chrome.wsUrl);
  await new Promise((resolve, reject) => { browser.addEventListener('open', resolve, { once: true }); browser.addEventListener('error', reject, { once: true }); });
  let sequence = 0;
  const pending = new Map();
  browser.addEventListener('close', () => { for (const settle of pending.values()) settle({ error: { message: 'CDP socket closed' } }); pending.clear(); });
  browser.addEventListener('message', (event) => {
    const msg = JSON.parse(event.data);
    if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); }
  });
  const send = (method, params = {}, sessionId) => new Promise((resolve, reject) => {
    const id = ++sequence;
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`CDP timeout: ${method} ${JSON.stringify(params).slice(0, 240)}`)); }, 15000);
    pending.set(id, (msg) => { clearTimeout(timer); msg.error ? reject(new Error(`${method}: ${JSON.stringify(msg.error)}`)) : resolve(msg.result); });

    browser.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
  });
  const target = await send('Target.createTarget', { url: 'about:blank' });
  const attached = await send('Target.attachToTarget', { targetId: target.targetId, flatten: true });
  const sid = attached.sessionId;
  const evaluate = async (expression) => {
    const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }, sid);
    if (result.exceptionDetails) { const d = result.exceptionDetails; throw new Error(d.exception?.description ?? d.exception?.value ?? d.text ?? 'browser evaluation failed'); }
    return result.result.value;
  };
  const nav = async (url) => {
    await send('Page.navigate', { url }, sid);
    for (let i = 0; i < 100; i++) {
      const ready = await evaluate(`document.readyState === 'complete' && (document.querySelector('#root')?.innerText.trim().length ?? 0) > 0`);
      if (ready) { await delay(600); return; }
      await delay(100);
    }
    throw new Error(`Navigation did not finish: ${url}; current=${await evaluate('location.href')}; state=${await evaluate('document.readyState')}; root=${await evaluate(`document.querySelector('#root')?.innerText ?? 'missing'`)}`);
  };
  await send('Page.enable', {}, sid);
  await send('Runtime.enable', {}, sid);
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false }, sid);
  await send('Network.enable', {}, sid);


  await send('Network.setCookie', { name: 'hacksess', value: decodeURIComponent(cookie.slice('hacksess='.length)), url: base, httpOnly: true }, sid);
  const wait = async (expression) => { for (let i=0;i<100;i++) { if(await evaluate(expression)) return; await delay(100); } throw new Error(`Timed out: ${expression}; DOM=${await evaluate('document.body.innerText')}`); };
  const click = async (expression) => {
    // DOM presence/two frames do not guarantee that a coordinate hits the target.
    const point = await evaluate(`(async () => {
      let previous, previousElement, detail;
      const deadline = performance.now() + 10000;
      while (performance.now() < deadline) {
        const element = ${expression};
        if (element) {
          element.scrollIntoView({block:'center',behavior:'instant'});
          await new Promise(requestAnimationFrame);
          const rect = element.getBoundingClientRect();
          const x = rect.x + rect.width / 2, y = rect.y + rect.height / 2;
          const hit = document.elementFromPoint(x,y);
          const box = JSON.stringify([rect.x,rect.y,rect.width,rect.height]);
          const actionable = element.isConnected && rect.width > 0 && rect.height > 0
            && !element.matches(':disabled') && !element.closest('[inert]')
            && (hit === element || element.contains(hit));
          detail = {url:location.href,target:element.outerHTML.slice(0,300),hit:hit?.outerHTML.slice(0,300),box,actionable};
          if (actionable && element === previousElement && box === previous) return {x,y};
          previous = actionable ? box : undefined;
          previousElement = element;
        } else {
          detail = {url:location.href,target:'missing'};
          previous = undefined;
        }
        await new Promise(resolve=>setTimeout(resolve,100));
      }
      throw Error('Click target not stable/actionable: ' + ${JSON.stringify(expression)} + '; ' + JSON.stringify(detail));
    })()`);
    await send('Input.dispatchMouseEvent',{type:'mousePressed',...point,button:'left',clickCount:1},sid);
    await send('Input.dispatchMouseEvent',{type:'mouseReleased',...point,button:'left',clickCount:1},sid);
    await delay(400);
  };
  const button = text => `[...document.querySelectorAll('button')].find(e=>e.innerText.trim()===${JSON.stringify(text)})`;
  const findings = [];
  const screenshot = async name => {
    const dir=join(process.cwd(),'data','frontend-review'); await mkdir(dir,{recursive:true});
    const bytes=Buffer.from((await send('Page.captureScreenshot',{format:'png',captureBeyondViewport:false},sid)).data,'base64');
    await writeFile(join(dir,name+'.png'),bytes);
    if(axeSource) {
      await evaluate(axeSource);
      const violations=await evaluate(`axe.run(document,{runOnly:{type:'tag',values:['wcag2a','wcag2aa','wcag21aa']}}).then(r=>r.violations)`);
      await writeFile(join(dir,name+'.axe.json'),JSON.stringify(violations,null,2));
      const blocking=violations.filter(v=>['serious','critical'].includes(v.impact));
      if(blocking.length) findings.push({screen:name,violations:blocking.map(v=>({id:v.id,nodes:v.nodes.map(n=>n.target)}))});
      console.log(name,blocking.length?'FAIL '+JSON.stringify(findings.at(-1)):'PASS axe');
    }
    const overflow=await evaluate('document.documentElement.scrollWidth>innerWidth');
    if(overflow)findings.push({screen:name,issue:'horizontal overflow'});
  };
  const fill = async (selector,value) => evaluate(`(() => {const e=document.querySelector(${JSON.stringify(selector)}); if(!e) throw Error('Missing field'); Object.getOwnPropertyDescriptor(e.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:HTMLInputElement.prototype,'value').set.call(e,${JSON.stringify(value)}); e.dispatchEvent(new Event('input',{bubbles:true}));})()`);
  const api = async (path,body,method='POST') => {
    const res=await fetch(base+path,{method,signal:AbortSignal.timeout(15000),headers:{cookie,'content-type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)})});
    const json=await res.json();
    if (res.status===429 && Number.isFinite(json.retryAfterSeconds)) { await delay(json.retryAfterSeconds*1000); return api(path,body,method); }
    assert.ok(res.ok,JSON.stringify(json)); return json;
  };
  const errors=[];
  browser.addEventListener('message', e=>{const m=JSON.parse(e.data); if(m.method==='Runtime.exceptionThrown') errors.push(m.params.exceptionDetails.text);});

  const { DEFAULT_FORM } = await import('../dist/features/form/domain.js');
  const now = Date.now();
  await db.run("INSERT INTO events (id,guild_id,name,description,status,form_json,starts_at,ends_at,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)",'quality-event',guildIds[0],'ChasHack · Build weekend','Two days, a few good people, and something new to show for it.','active',JSON.stringify(DEFAULT_FORM),now+86400000,now+259200000,now,now);
  await db.run('UPDATE events SET signup_starts_at=?, signup_ends_at=? WHERE id=?', now + 3600000, now + 172800000, 'quality-event');
  const legacyAnnouncements = [{ id:'legacy-activation', title:'Activation note', message:'Previously configured activation', trigger:'on_activate', channelId:'12345678901234567' }, { id:'legacy-start', title:'Start note', message:'Previously configured start', trigger:'on_start' }];
  await db.run('UPDATE events SET announcements_json=? WHERE id=?',JSON.stringify(legacyAnnouncements),'quality-event');
  await db.run('UPDATE events SET schedule_json=? WHERE id=?',JSON.stringify([{id:'__start__',time:now+86400000,title:'Event starts',actions:[{id:'fixture-action',type:'announce',title:'Original action',message:'Original message',channelId:'11111111111111111'}]}]),'quality-event');
  for(const [id,name,role] of [['quality-one','Alex Lind','frontend'],['quality-two','Sam Berg','backend'],['quality-three','Robin Ek','design']]) {
    await db.run("INSERT INTO participants (event_id,user_id,guild_id,display_name,experience,role_track,skills,team_pref,teammates,status,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",'quality-event',id,guildIds[0],name,'some_experience',role,'["frontend_react"]','random_team','[]','active',now,now);
  }
  const { createTeam } = await import('../dist/features/teams/data.js');
  await createTeam(db,'fixture','quality-event',guildIds[0],'Good Company','public','quality-one');
  await api('/api/templates',{name:'Weekend signup',kind:'form',json:JSON.stringify(DEFAULT_FORM)});
  await api('/api/templates',{name:'Targeted fixture',kind:'announcement',json:JSON.stringify({title:'Targeted message',message:'Targeted body',trigger:'manual',channelId:'22222222222222222'})});
  await api('/api/templates',{name:'Default fixture',kind:'announcement',json:JSON.stringify({title:'Default message',message:'Default body',trigger:'manual',channelId:null})});
  await api('/api/templates',{name:'Legacy event fixture',kind:'event',json:JSON.stringify({name:'Legacy event fixture',description:'Saved assignment pool',form:DEFAULT_FORM,schedule:[{id:'legacy-activity',time:0,title:'Legacy only activity',anchor:'hackathon_start',offsetMinutes:600}],assignments:[{id:'legacy-brief',title:'Legacy brief',instructions:'Build together'}],assignmentStrategy:'same'})});
  await api('/api/templates',{name:'Empty event fixture',kind:'event',json:JSON.stringify({name:'Empty event fixture'})});
  await api('/api/templates',{name:'Custom handout fixture',kind:'event',json:JSON.stringify({name:'Custom handout fixture',form:DEFAULT_FORM,schedule:[{id:'later-handout',time:0,title:'Handout later',anchor:'hackathon_start',offsetMinutes:60,offsetMode:'elapsed',actions:[{id:'chosen-handout',type:'distribute_assignments',mode:'same'}]}],assignments:[{id:'custom-brief',title:'Custom brief',instructions:'Build together'}]})});
  await nav(base+'/events'); await wait("document.body.innerText.includes('Your communities')");
  await screenshot('server-picker');
  check('picker discovers both authorized servers',await evaluate("document.body.innerText.includes('Synthetic test guild 2')"));
  check('first visit offers server selection',await evaluate("!document.querySelector('.organizer-workspace')"));
  await click("[...document.querySelectorAll('button')].find(b=>b.innerText.includes('Synthetic test guild 1'))");
  await wait("!!document.querySelector('.organizer-workspace')");
  check('chosen server is remembered',await evaluate("localStorage.getItem('chas-server:" + syntheticUserId + "') === '" + guildIds[0] + "'"));
  await nav(base+'/events');await wait("!!document.querySelector('.organizer-workspace')");
  check('return visit opens the remembered workspace',true);
  const storedGuilds = async () => JSON.parse((await db.get('SELECT guild_ids FROM web_sessions WHERE id=?',session.id)).guild_ids).map(g=>g.id);
  botGuilds.get(guildIds[1]).ownerId='different-owner';
  await evaluate('window.dispatchEvent(new Event("focus"))');
  for(let i=0;i<50&&(await storedGuilds()).includes(guildIds[1]);i++) await delay(100);
  check('open workspace refreshes revoked server access',!(await storedGuilds()).includes(guildIds[1])&&await evaluate("!!document.querySelector('.organizer-workspace')"));
  await delay(200);
  botGuilds.get(guildIds[1]).ownerId=syntheticUserId;
  await evaluate('window.dispatchEvent(new Event("focus"))');
  for(let i=0;i<50&&!(await storedGuilds()).includes(guildIds[1]);i++) await delay(100);
  check('open workspace discovers a newly granted server without signing in again',(await storedGuilds()).includes(guildIds[1]));
  await evaluate(`localStorage.setItem('chas-event','quality-event');localStorage.setItem('chas-locale','en')`);
  await nav(base+'/operations?tab=teams');
  await wait(`!!(${button('Create team')})`);
  await click(button('Create team'));
  await fill('#team-name','Browser Builders');
  check('organizer team creation requires an owner',await evaluate("[...document.querySelectorAll('[role=dialog] button')].find(b=>b.innerText.trim()==='Create').disabled"));
  await click("document.querySelector('[role=dialog] [aria-label=\"Team owner\"]')");
  await click("[...document.querySelectorAll('[role=option]')].find(e=>e.innerText.includes('Sam Berg'))");
  await click("[...document.querySelectorAll('[role=dialog] button')].find(b=>b.innerText.trim()==='Create')");
  await wait("!document.querySelector('[role=dialog]')");
  const browserTeam = await db.get('SELECT owner_id FROM teams WHERE event_id=? AND name=?','quality-event','Browser Builders');
  check('organizer creates a team for the selected participant',browserTeam?.owner_id==='quality-two');
  await wait("[...document.querySelectorAll('[data-slot=card]')].some(e=>e.innerText.includes('Browser Builders') && e.innerText.includes('Retry Discord setup'))");
  await click("[...[...document.querySelectorAll('[data-slot=card]')].find(e=>e.innerText.includes('Browser Builders')).querySelectorAll('button')].find(b=>b.innerText.includes('Retry Discord setup'))");
  await wait("document.body.innerText.includes('Discord is unavailable.')");
  check('Discord setup failure leaves the created team available',await evaluate("document.body.innerText.includes('Browser Builders')"));
  await nav(base+'/operations?tab=participants');
  await wait("!!document.querySelector('input[aria-label=\"Search participants\"]')");
  await fill('input[aria-label="Search participants"]','no-such-person');
  await wait("document.body.innerText.includes('No participants match these filters.')");
  await click(button('Clear'));
  check('participant search explains empty results and clears filters',await evaluate("document.body.innerText.includes('Alex Lind') && document.querySelector('input[aria-label=\"Search participants\"]').value === ''"));
  await click("[...document.querySelectorAll('th button')].find(b=>b.textContent.trim()==='Name')");
  check('participant sorting exposes its direction',await evaluate("[...document.querySelectorAll('th')].some(th=>th.textContent.trim()==='Name' && ['ascending','descending'].includes(th.getAttribute('aria-sort')))"));
  await nav(base+'/audit');
  await wait("!!document.querySelector('input[aria-label=\"Filter audit log\"]')");
  await fill('input[aria-label="Filter audit log"]','no-such-activity');
  await wait("document.body.innerText.includes('No activity matches your search.')");
  await click(button('Clear'));
  check('audit search distinguishes no matches from an empty history',await evaluate("document.querySelector('input[aria-label=\"Filter audit log\"]').value === '' && !document.body.innerText.includes('No activity matches your search.')"));
  await evaluate(`window.originalStateFetch=window.fetch;window.fetch=(...args)=>String(args[0]).startsWith('/api/state')?Promise.resolve(new Response('{}',{status:503,headers:{'Content-Type':'application/json'}})):window.originalStateFetch(...args);window.dispatchEvent(new Event('focus'))`);
  await wait("document.body.innerText.includes('Couldn’t refresh the workspace.')");
  check('failed refresh keeps the current workspace visible',await evaluate("!!document.querySelector('input[aria-label=\"Filter audit log\"]')"));
  await evaluate('window.fetch=window.originalStateFetch');
  await click(button('Retry'));
  await wait("!document.body.innerText.includes('Couldn’t refresh the workspace.')");
  check('workspace refresh retry recovers',true);
  await nav(base+'/templates');await wait("!!document.querySelector('.organizer-workspace')");
  await click("[...document.querySelectorAll('[data-slot=card]')].find(e=>e.innerText.includes('EN · Community build weekend'))");
  await wait("!!document.querySelector('[role=dialog]')");
  await click("[...document.querySelectorAll('[role=dialog] button')].find(e=>e.innerText.includes('Welcome and introductions'))");
  await wait("!!document.querySelector('[role=dialog] input[aria-label=\"Minutes from anchor\"]')");
  check('starter template shows bounded elapsed timing',await evaluate("document.querySelector('[role=dialog]').innerText.includes('Minutes from anchor')&&[...document.querySelectorAll('[role=dialog] label')].find(e=>e.innerText.includes('Keep this activity within the event'))?.querySelector('input')?.checked"));
  await fill('[role=dialog] input[aria-label="Minutes from anchor"]','15');
  await click("[...document.querySelectorAll('[role=dialog] button')].find(e=>e.innerText.includes('Demos and wrap-up'))");
  await evaluate("(()=>{const e=[...document.querySelectorAll('[role=dialog] input[aria-label=\"Minutes from anchor\"]')].at(-1);e.focus();e.select()})()");
  await send('Input.insertText',{text:'-'},sid);
  await send('Input.insertText',{text:'15'},sid);
  check('elapsed editor accepts a negative offset with the keyboard',await evaluate("[...document.querySelectorAll('[role=dialog] input[aria-label=\"Minutes from anchor\"]')].at(-1).value==='-15'"));
  await click(button('Save changes'));
  await wait("!document.querySelector('[role=dialog]')");
  const editedStarter=JSON.parse((await db.get('SELECT json FROM event_templates WHERE guild_id=? AND name=?',guildIds[0],'EN · Community build weekend')).json);
  check('elapsed timing survives template editing',editedStarter.schedule.find(item=>item.id==='welcome').offsetMinutes===15&&editedStarter.schedule.find(item=>item.id==='welcome').offsetMode==='elapsed'&&editedStarter.schedule.find(item=>item.id==='welcome').withinEvent===true&&editedStarter.schedule.find(item=>item.id==='demos').offsetMinutes===-15);
  await click("[...document.querySelectorAll('[data-slot=card]')].find(e=>e.innerText.includes('Legacy event fixture'))");
  await wait("!!document.querySelector('[role=dialog]')");
  check('event template editor displays its embedded assignment pool',await evaluate("document.querySelector('[role=dialog]').innerText.includes('Saved assignments (1)')"));
  await click(button('Save changes'));
  await wait("!document.querySelector('[role=dialog]')");
  check('editing an event template preserves its embedded assignments',JSON.parse((await db.get('SELECT json FROM event_templates WHERE guild_id=? AND name=?',guildIds[0],'Legacy event fixture')).json).assignments[0].id==='legacy-brief');
  await nav(base+'/events');await wait(`!!(${button('New event')})`);
  const openLegacy = async () => {
    await click(button('New event'));
    await click("[...document.querySelectorAll('[role=combobox]')].find(e=>e.innerText.includes('Pick an event template'))");
    await click("[...document.querySelectorAll('[role=option]')].find(e=>e.innerText.includes('Legacy event fixture'))");
    await click(button('Continue with template'));
    await wait("!!document.querySelector('[role=dialog]')");
  };
  await openLegacy();
  check('new event displays the legacy embedded assignment choice',await evaluate("document.querySelector('[role=dialog]').innerText.includes('Saved assignments (1)')"));
  check('undated anchored activity is not shown as a 1970 date',await evaluate("document.querySelector('[role=dialog]').innerText.includes('Waiting for a date')&&!document.querySelector('[role=dialog]').innerText.includes('Jan 1, 00:00')"));
  await click(button('Change template'));
  await click("[...document.querySelectorAll('[role=combobox]')].find(e=>e.innerText.includes('Legacy event fixture'))");
  await click("[...document.querySelectorAll('[role=option]')].find(e=>e.innerText.includes('Empty event fixture'))");
  await click(button('Continue with template'));
  await wait("!!document.querySelector('[role=dialog]')");
  check('switching templates clears prior assignment and schedule defaults',await evaluate("!document.querySelector('[role=dialog]').innerText.includes('Saved assignments (1)')&&!document.querySelector('[role=dialog]').innerText.includes('Legacy only activity')&&document.querySelector('[role=dialog] textarea').value===''"));
  await click(button('Change template'));
  await click("[...document.querySelectorAll('[role=combobox]')].find(e=>e.innerText.includes('Empty event fixture'))");
  await click("[...document.querySelectorAll('[role=option]')].find(e=>e.innerText.includes('Legacy event fixture'))");
  await click(button('Continue with template'));
  await wait("!!document.querySelector('[role=dialog]')");
  await click("[...document.querySelectorAll('[role=dialog] [role=combobox]')].find(e=>e.innerText.includes('Saved assignments'))");
  await click("[...document.querySelectorAll('[role=option]')].find(e=>e.innerText.trim()==='No assignments')");
  await fill('[role=dialog] input[placeholder="ChasHack 2026 Spring"]','No pool fixture');
  await click(button('Save as draft'));
  await wait("!document.querySelector('[role=dialog]')");
  check('explicit no-assignment choice does not restore the template pool',JSON.parse((await db.get('SELECT assignments_json FROM events WHERE guild_id=? AND name=?',guildIds[0],'No pool fixture')).assignments_json).length===0);
  await openLegacy();
  await fill('[role=dialog] input[placeholder="ChasHack 2026 Spring"]','Embedded pool fixture');
  await click(button('Save as draft'));
  await wait("!document.querySelector('[role=dialog]')");
  const undated = await db.get('SELECT id,assignments_json,schedule_json FROM events WHERE guild_id=? AND name=?',guildIds[0],'Embedded pool fixture');
  check('new event snapshots the legacy embedded assignment pool',JSON.parse(undated.assignments_json)[0]?.id==='legacy-brief');
  const pendingHandout = JSON.parse(undated.schedule_json).find(item=>item.id==='__start__');
  check('undated event retains its pending handout and selected strategy',pendingHandout?.time===0&&pendingHandout?.anchor==='hackathon_start'&&pendingHandout?.actions?.some(action=>action.type==='distribute_assignments'&&action.mode==='same'));
  await nav(base+'/events?event='+encodeURIComponent(undated.id));await wait(`!!(${button('Edit event')})`);
  await click(button('Edit event'));
  await click("[...document.querySelectorAll('[role=dialog] button')].find(b=>b.innerText.includes('Hackathon Starts'))");
  await click("[...document.querySelectorAll('[role=dialog] button')].find(b=>b.innerText.includes('Pick date & time'))");
  const today = await evaluate('new Date().toLocaleDateString()');
  await click(`document.querySelector('button[data-day=${JSON.stringify(today)}]:not(:disabled)')`);
  await click(button('Done'));
  await click("[...document.querySelectorAll('[role=dialog] button')].find(b=>b.innerText.trim()==='Save')");
  await wait("!document.querySelector('[role=dialog]')");
  const dated = await db.get('SELECT starts_at,schedule_json FROM events WHERE id=?',undated.id);
  check('setting the start date schedules the retained handout',JSON.parse(dated.schedule_json).some(item=>item.id==='__start__'&&item.time===dated.starts_at&&item.actions?.some(action=>action.type==='distribute_assignments'&&action.mode==='same')));
  await nav(base+'/events');await wait(`!!(${button('New event')})`);
  await click(button('New event'));
  await click("[...document.querySelectorAll('[role=combobox]')].find(e=>e.innerText.includes('Pick an event template'))");
  await click("[...document.querySelectorAll('[role=option]')].find(e=>e.innerText.includes('Custom handout fixture'))");
  await click(button('Continue with template'));
  await wait("!!document.querySelector('[role=dialog]')");
  await click("[...document.querySelectorAll('[role=dialog] button')].find(b=>b.innerText.includes('Handout later'))");
  check('undated action does not imply an epoch clock time',await evaluate("document.querySelector('[role=dialog]').innerText.includes('1 action') && !document.querySelector('[role=dialog]').innerText.includes('will run at')"));
  await fill('[role=dialog] input[placeholder="ChasHack 2026 Spring"]','Explicit handout fixture');
  await click(button('Save as draft'));
  await wait("!document.querySelector('[role=dialog]')");
  const customActions=JSON.parse((await db.get('SELECT schedule_json FROM events WHERE guild_id=? AND name=?',guildIds[0],'Explicit handout fixture')).schedule_json).flatMap(item=>item.actions??[]).filter(action=>action.type==='distribute_assignments');
  check('an explicit handout on another activity does not gain a duplicate default',customActions.length===1&&customActions[0].id==='chosen-handout');
  await nav(base+'/templates');await wait("!!document.querySelector('.organizer-workspace')");
  await click("[...document.querySelectorAll('[role=tab]')].find(e=>e.innerText.includes('Signup forms'))");
  await click(button('New form template'));
  await fill('#form-template-name','Bilingual help fixture');
  await click("[...document.querySelectorAll('[role=dialog] button')].find(e=>e.innerText.trim()==='Add question')");
  await evaluate(`(()=>{const dialog=document.querySelector('[role=dialog]');const values=[['input[id$="-label"]','Your idea'],['label:has(input)','']];const label=dialog.querySelector(values[0][0]);Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(label,values[0][1]);label.dispatchEvent(new Event('input',{bubbles:true}));for(const [text,value] of [['Help text (English, optional)','Describe the idea'],['Help text (Swedish, optional)','Beskriv idén']]){const e=[...dialog.querySelectorAll('label')].find(l=>l.innerText.includes(text)).querySelector('input');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,value);e.dispatchEvent(new Event('input',{bubbles:true}))}})()`);
  await click(button('Create template'));
  await wait("!document.querySelector('[role=dialog]')");
  const savedHelp=JSON.parse((await db.get('SELECT json FROM event_templates WHERE guild_id=? AND name=?',guildIds[0],'Bilingual help fixture')).json).customQuestions[0].help;
  check('registration template saves bilingual question help',savedHelp.en==='Describe the idea'&&savedHelp.sv==='Beskriv idén');
  await click("[...document.querySelectorAll('[data-slot=card]')].find(e=>e.innerText.includes('Bilingual help fixture'))");
  await wait("!!document.querySelector('[role=dialog] input[id$=\"-label\"]')");
  await fill('[role=dialog] input[id$="-label"]','Your updated idea');
  await click(button('Save changes'));
  await wait("!document.querySelector('[role=dialog]')");
  const editedHelp=JSON.parse((await db.get('SELECT json FROM event_templates WHERE guild_id=? AND name=?',guildIds[0],'Bilingual help fixture')).json).customQuestions[0];
  check('editing a registration question preserves its bilingual help',editedHelp.label.en==='Your updated idea'&&editedHelp.help.en==='Describe the idea'&&editedHelp.help.sv==='Beskriv idén');
  await click("[...document.querySelectorAll('[role=tab]')].find(e=>e.innerText.includes('Messages'))");
  await click(button('New message template'));
  await wait("!!document.querySelector('[role=dialog] textarea')");
  await fill('[role=dialog] textarea','{');
  await evaluate("document.querySelector('[role=dialog] textarea').focus();document.querySelector('[role=dialog] textarea').setSelectionRange(1,1)");
  await wait("!!document.querySelector('[role=listbox]')");
  check('tag suggestions stay inside the dialog scroll boundary',await evaluate("!!document.querySelector('[role=dialog] [role=listbox]')"));
  await screenshot('tag-menu-open');
  const menuPoint=await evaluate("(()=>{const r=document.querySelector('[role=listbox]').getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()");
  await send('Input.dispatchMouseEvent',{type:'mouseWheel',...menuPoint,deltaX:0,deltaY:180},sid);await delay(250);
  check('tag suggestions accept mouse-wheel scrolling',await evaluate("document.querySelector('[role=listbox]').scrollTop>0"));
  await send('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape',code:'Escape'},sid);
  await send('Input.dispatchKeyEvent',{type:'keyUp',key:'Escape',code:'Escape'},sid);
  await delay(200);
  check('Escape closes suggestions without closing the editor',await evaluate("!!document.querySelector('[role=dialog]')&&!document.querySelector('[role=listbox]')"));
  await fill('[role=dialog] textarea','{event');
  await evaluate("document.querySelector('[role=dialog] textarea').focus();document.querySelector('[role=dialog] textarea').setSelectionRange(6,6)");
  await wait("!!document.querySelector('[role=listbox]')");
  await send('Input.dispatchKeyEvent',{type:'keyDown',key:'Enter',code:'Enter'},sid);
  await send('Input.dispatchKeyEvent',{type:'keyUp',key:'Enter',code:'Enter'},sid);
  check('keyboard inserts a complete variable',await evaluate("document.querySelector('[role=dialog] textarea').value==='{event}'"));
  await screenshot('message-template-editor');
  await evaluate("localStorage.setItem('chas-locale','sv')");
  await send('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:false},sid);
  await nav(base+'/templates');await wait("!!document.querySelector('.organizer-workspace')");
  await click("[...document.querySelectorAll('[role=tab]')].find(e=>e.innerText.includes('Meddelanden'))");
  await click(button('Ny meddelandemall'));
  await wait("!!document.querySelector('[role=dialog] textarea')");
  check('Swedish template editor explains that scheduling requires an action',await evaluate("document.querySelector('[role=dialog]').innerText.includes('Lägg till mallen i en schemalagd meddelandeåtgärd')"));
  await fill('[role=dialog] textarea','{evenem');
  await evaluate("document.querySelector('[role=dialog] textarea').focus();document.querySelector('[role=dialog] textarea').setSelectionRange(7,7)");
  await wait("!!document.querySelector('[role=listbox] [role=option]')");
  check('Swedish suggestions display localized labels',await evaluate("document.querySelector('[role=listbox]').innerText.includes('Evenemangets namn')"));
  await send('Input.dispatchKeyEvent',{type:'keyDown',key:'ArrowDown',code:'ArrowDown'},sid);
  await send('Input.dispatchKeyEvent',{type:'keyUp',key:'ArrowDown',code:'ArrowDown'},sid);
  const selectedTag=await evaluate("document.querySelector('[role=listbox] [aria-selected=true] code').innerText");
  await send('Input.dispatchKeyEvent',{type:'keyDown',key:'Enter',code:'Enter'},sid);
  await send('Input.dispatchKeyEvent',{type:'keyUp',key:'Enter',code:'Enter'},sid);
  check('keyboard selects the displayed Swedish search result',await evaluate("document.querySelector('[role=dialog] textarea').value")===selectedTag);
  await click(button('Variabelguide'));
  await wait("document.body.innerText.includes('Schemavariabler är tomma')");
  check('Swedish variable guide fits the narrow viewport',await evaluate("(()=>{const p=[...document.querySelectorAll('[data-radix-popper-content-wrapper]')].find(e=>e.innerText.includes('Schemavariabler är tomma'));const r=p?.getBoundingClientRect();return !!r&&r.left>=0&&r.right<=innerWidth&&r.top>=0&&r.bottom<=innerHeight})()"));
  await screenshot('variable-guide-sv-mobile');
  await evaluate("localStorage.setItem('chas-locale','en')");
  for(const mode of ['dark','light']) {
    await evaluate(`localStorage.setItem('chas-theme',${JSON.stringify(mode)})`);
    for(const width of [1440,390]) {
      await send('Emulation.setDeviceMetricsOverride',{width,height:width===390?844:1000,deviceScaleFactor:1,mobile:false},sid);
      for(const [name,path] of [['events','/events'],['event-workspace','/events?event=quality-event'],['participants','/operations?tab=participants'],['teams','/operations?tab=teams'],['matching','/operations?tab=matching'],['templates','/templates'],['config','/config'],['audit','/audit']]) {
        await nav(base+path);await wait(`!!document.querySelector('.organizer-workspace')`);await delay(200);
        if(name==='event-workspace' && width===1440) {
          const result=await evaluate(`(()=>{const ticks=[...document.querySelectorAll('.recharts-cartesian-axis-tick-value')];const lum=s=>{const rgb=s.match(/\\d+/g)?.slice(0,3).map(Number);if(!rgb||rgb.length<3)return null;return rgb.map(v=>{v/=255;return v<=.04045?v/12.92:((v+.055)/1.055)**2.4}).reduce((sum,v,i)=>sum+v*[.2126,.7152,.0722][i],0)};return ticks.map(e=>{const a=lum(getComputedStyle(e).fill),b=lum(getComputedStyle(e.closest('[data-slot="card"]')).backgroundColor);return a===null||b===null?0:(Math.max(a,b)+.05)/(Math.min(a,b)+.05)})})()`);
          check('chart labels have readable contrast in '+mode,result.length>0&&result.every(r=>r>=4.5),JSON.stringify(result));
        }
        await screenshot(name+'-'+mode+'-'+width);
      }
    }
  }
  await send('Emulation.setDeviceMetricsOverride',{width:1440,height:1000,deviceScaleFactor:1,mobile:false},sid);
  await nav(base+'/events?event=quality-event');await wait(`!!(${button('Import signups')})`);
  await click(button('Announce'));
  check('announcement dialog is labelled and receives keyboard focus',await evaluate("(()=>{const d=document.querySelector('[role=dialog]');return !!d && !!d.getAttribute('aria-labelledby') && d.contains(document.activeElement)})()"));
  check('announcement channel label is translated',await evaluate("!![...document.querySelectorAll('[role=dialog] label span')].find(e=>e.textContent.trim()==='Channel')"));
  await click("[...document.querySelectorAll('[role=combobox]')].find(e=>e.innerText.includes('Pick a template'))");
  await click("[...document.querySelectorAll('[role=option]')].find(e=>e.innerText.includes('Targeted message'))");
  check('manual announcement applies template channel',await evaluate("document.querySelector('input[placeholder=\"Override channel ID (optional)\"]').value==='22222222222222222'"));
  await click("[...document.querySelectorAll('[role=combobox]')].find(e=>e.innerText.includes('Targeted message'))");
  await click("[...document.querySelectorAll('[role=option]')].find(e=>e.innerText.includes('Default message'))");
  check('manual template without a channel keeps the current choice',await evaluate("document.querySelector('input[placeholder=\"Override channel ID (optional)\"]').value==='22222222222222222'"));
  await click("[...document.querySelectorAll('label')].find(e=>e.innerText.includes('Also DM all participants'))");
  await evaluate(`window.originalAnnouncementFetch=window.fetch;window.fetch=(...args)=>String(args[0]).includes('/api/events/announce')?Promise.resolve(new Response(JSON.stringify({posted:false,reason:'no_channel_configured',channelId:null,dmSent:2,dmFailed:1}),{status:200,headers:{'Content-Type':'application/json'}})):window.originalAnnouncementFetch(...args)`);
  await click(button('Send'));
  await wait("!!document.querySelector('[role=alert]')");
  check('partial DM delivery is explained when channel posting fails',await evaluate("document.querySelector('[role=alert]').innerText.includes('2 direct messages were sent')&&document.querySelector('[role=alert]').innerText.includes('Choose a channel')"));
  check('channel retry does not repeat successful DMs by default',await evaluate("![...document.querySelectorAll('label')].find(e=>e.innerText.includes('Also DM all participants')).querySelector('input').checked"));
  await evaluate('window.fetch=window.originalAnnouncementFetch');
  await click(button('Cancel'));
  await click(button('Edit event'));
  await wait("!!document.querySelector('[role=dialog] details')");
  check('legacy announcements are explained in the event editor',await evaluate("document.querySelector('[role=dialog] details').innerText.includes('Legacy announcement presets')"));
  await click("[...document.querySelectorAll('[role=dialog] button')].find(b=>b.innerText.includes('Signup window'))");
  await click("[...[...document.querySelectorAll('[role=dialog] button')].find(b=>b.innerText.includes('Signup window')).parentElement.querySelectorAll('button')].find(b=>b.innerText.trim()==='Announcement')");
  check('signup announcement defaults to the signup opening time',await evaluate(`(()=>{const section=[...document.querySelectorAll('[role=dialog] button')].find(b=>b.innerText.includes('Signup window')).parentElement;const expected=new Date(${now + 3600000}).toTimeString().slice(0,5);return section.querySelector('input[placeholder="Headline"]')?.value.endsWith(expected)})()`));
  await click("[...document.querySelectorAll('[role=dialog] button')].find(b=>b.getAttribute('aria-label')==='Remove Announcement')");
  await click("[...document.querySelectorAll('[role=dialog] button')].find(b=>b.innerText.includes('Hackathon Starts'))");
  await wait("[...document.querySelectorAll('[role=dialog] [role=combobox]')].some(e=>e.innerText.includes('Pick a saved announcement'))");
  await click("[...document.querySelectorAll('[role=dialog] [role=combobox]')].find(e=>e.innerText.includes('Pick a saved announcement'))");
  await click("[...document.querySelectorAll('[role=option]')].find(e=>e.innerText.includes('Targeted fixture'))");
  check('scheduled action applies template channel',await evaluate("[...document.querySelectorAll('[role=dialog] input')].some(e=>e.value==='22222222222222222')"));
  await click("[...document.querySelectorAll('[role=dialog] [role=combobox]')].find(e=>e.innerText.includes('Targeted fixture'))");
  await click("[...document.querySelectorAll('[role=option]')].find(e=>e.innerText.includes('Default fixture'))");
  check('scheduled template without a channel keeps the current choice',await evaluate("[...document.querySelectorAll('[role=dialog] input')].some(e=>e.value==='22222222222222222')"));
  await click("[...document.querySelectorAll('[role=dialog] button')].find(b=>b.innerText.trim()==='Save')");
  await wait("!document.querySelector('[role=dialog]')");
  const legacyAfter = await db.get('SELECT announcements_json, schedule_json FROM events WHERE id=?','quality-event');
  check('saving event preserves legacy announcements without scheduling duplicates',JSON.stringify(JSON.parse(legacyAfter.announcements_json))===JSON.stringify(legacyAnnouncements)&&!JSON.parse(legacyAfter.schedule_json).some(item=>(item.actions??[]).some(action=>legacyAnnouncements.some(legacy=>legacy.id===action.id))));
  check('scheduled template channel persists after saving',JSON.parse(legacyAfter.schedule_json).some(item=>(item.actions??[]).some(action=>action.id==='fixture-action'&&action.channelId==='22222222222222222')));
  await click(button('Import signups'));await wait("document.body.innerText.includes('No imported signups')");
  await click(button('Import signups'));await wait("!!document.querySelector('[role=dialog] input[type=file]')");
  await evaluate(`(()=>{const e=document.querySelector('[role=dialog] input[type=file]'),dt=new DataTransfer();dt.items.add(new File(['Name,Email\\nAda,ada@example.test'],'recovery.csv',{type:'text/csv'}));e.files=dt.files;e.dispatchEvent(new Event('change',{bubbles:true}))})()`);
  await delay(200);
  await send('Network.deleteCookies',{name:'hacksess',url:base},sid);
  await click(button('Preview CSV'));
  await wait("document.body.innerText.includes('Your session has expired')");
  check('expired CSV session explains recovery and preserves the selected file',await evaluate("document.querySelector('[role=dialog]').innerText.includes('recovery.csv')"));
  await screenshot('csv-session-expired');
  await send('Network.setCookie',{name:'hacksess',value:decodeURIComponent(cookie.slice('hacksess='.length)),url:base,httpOnly:true},sid);
  await click(button('Preview CSV'));
  await wait("!!document.querySelector('[role=dialog] [role=list]')");
  check('CSV preview retries successfully after signing back in',true);
  await evaluate("localStorage.setItem('chas-locale','sv')");
  await nav(base+'/templates');
  await wait("!!document.querySelector('.organizer-workspace')");
  await click("[...document.querySelectorAll('[data-slot=card]')].find(e=>e.innerText.includes('SV ·'))");
  await wait("!!document.querySelector('[role=dialog]')");
  check('Swedish event template localizes assignment strategies',await evaluate("document.querySelector('[role=dialog]').innerText.includes('Slumpa per lag') && document.querySelector('[role=dialog]').innerText.includes('Samma till alla')"));
  check('Swedish event template explains scheduled handouts',await evaluate("document.querySelector('[role=dialog]').innerText.includes('Eventinformation') && document.querySelector('[role=dialog]').innerText.includes('Lägg till en utdelningsåtgärd')"));
  await click("[...document.querySelectorAll('[role=dialog] button')].find(b=>b.innerText.includes('Middag'))");
  check('Swedish schedule uses localized kinds and actions',await evaluate("document.querySelector('[role=dialog]').innerText.includes('1 åtgärd') && document.querySelector('[role=dialog]').innerText.includes('Mat') && document.querySelector('[role=dialog]').innerText.includes('Ta bort block')"));
  await nav(base+'/events?event=quality-event');
  await wait(`!!(${button('Meddela')})`);
  await click(button('Meddela'));
  check('Swedish announcement controls are localized',await evaluate("document.querySelector('[role=dialog]').innerText.includes('Fyll i från en meddelandemall') && !!document.querySelector('[role=dialog] input[placeholder=\"Ange kanal-ID (valfritt)\"]')"));
  await send('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape',code:'Escape'},sid);
  await send('Input.dispatchKeyEvent',{type:'keyUp',key:'Escape',code:'Escape'},sid);
  await wait("!document.querySelector('[role=dialog]')");
  check('Escape closes the announcement dialog and restores focus',await evaluate("document.activeElement?.textContent.trim()==='Meddela'"));
  await send('Network.deleteCookies',{name:'hacksess',url:base},sid);
  for(const width of [1440,390]) {
    await send('Emulation.setDeviceMetricsOverride',{width,height:width===390?844:1000,deviceScaleFactor:1,mobile:false},sid);
    await nav(base+'/events');await wait(`!!document.querySelector('.login-workspace')`);await screenshot('login-'+width);
  }
  await writeFile(join(process.cwd(),'data','frontend-review','findings.json'),JSON.stringify(findings,null,2));
  console.log('RESULT',findings.length,'blocking screen findings');
  assert.deepEqual(findings,[]);
} finally {
  browser?.close();await chrome?.stop();if(server)await server.stop();if(db)await db.close();
  await rm(chromeProfile,{recursive:true,force:true,maxRetries:10,retryDelay:200});
}
