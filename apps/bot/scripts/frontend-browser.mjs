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
      search: async ({ query }) => query.toLowerCase().includes('synthetic') ? new Map([['33333333333333333', { id: '33333333333333333', displayName: 'Synthetic Member', user: { username: 'synthetic.member' } }]]) : new Map(),
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
  for(const [id,name,role] of [['quality-one','Alex Lind','frontend'],['quality-two','Sam Berg','backend'],['quality-three','Robin Ek','design']]) {
    await db.run("INSERT INTO participants (event_id,user_id,guild_id,display_name,experience,role_track,skills,team_pref,teammates,status,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",'quality-event',id,guildIds[0],name,'some_experience',role,'["frontend_react"]','random_team','[]','active',now,now);
  }
  const { createTeam } = await import('../dist/features/teams/data.js');
  await createTeam(db,'fixture','quality-event',guildIds[0],'Good Company','public','quality-one');
  await api('/api/templates',{name:'Weekend signup',kind:'form',json:JSON.stringify(DEFAULT_FORM)});
  await nav(base+'/events'); await wait("document.body.innerText.includes('Your communities')");
  await screenshot('server-picker');
  check('picker discovers both authorized servers',await evaluate("document.body.innerText.includes('Synthetic test guild 2')"));
  check('first visit offers server selection',await evaluate("!document.querySelector('.organizer-workspace')"));
  await click("[...document.querySelectorAll('button')].find(b=>b.innerText.includes('Synthetic test guild 1'))");
  await wait("!!document.querySelector('.organizer-workspace')");
  check('chosen server is remembered',await evaluate("localStorage.getItem('chas-server:" + syntheticUserId + "') === '" + guildIds[0] + "'"));
  await nav(base+'/events');await wait("!!document.querySelector('.organizer-workspace')");
  check('return visit opens the remembered workspace',true);
  await evaluate(`localStorage.setItem('chas-event','quality-event');localStorage.setItem('chas-locale','en')`);
  await nav(base+'/templates');await wait("!!document.querySelector('.organizer-workspace')");
  await click("[...document.querySelectorAll('[role=tab]')].find(e=>e.innerText.includes('Messages'))");
  await click(button('New announcement'));
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
  for(const mode of ['dark','light']) {
    await evaluate(`localStorage.setItem('chas-theme',${JSON.stringify(mode)})`);
    for(const width of [1440,390]) {
      await send('Emulation.setDeviceMetricsOverride',{width,height:width===390?844:1000,deviceScaleFactor:1,mobile:false},sid);
      for(const [name,path] of [['events','/events'],['event-workspace','/events?event=quality-event'],['participants','/operations?tab=participants'],['teams','/operations?tab=teams'],['matching','/operations?tab=matching'],['templates','/templates'],['config','/config'],['audit','/audit']]) {
        await nav(base+path);await wait(`!!document.querySelector('.organizer-workspace')`);await delay(200);
        await screenshot(name+'-'+mode+'-'+width);
      }
    }
  }
  await send('Emulation.setDeviceMetricsOverride',{width:1440,height:1000,deviceScaleFactor:1,mobile:false},sid);
  await nav(base+'/events?event=quality-event');await wait(`!!(${button('Import signups')})`);
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
