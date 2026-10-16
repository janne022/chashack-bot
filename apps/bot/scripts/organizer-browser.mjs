#!/usr/bin/env node
/**
 * @journey:organizer-setup — DOM/AX checks against the built UI and a synthetic
 * PostgreSQL session. Does not perform or claim a real Discord OAuth login.
 */
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';

const port = 8491;
const base = `http://127.0.0.1:${port}`;
const chromePath = '/home/hermes/.cache/ms-playwright/chromium-1208/chrome-linux64/chrome';
const chromeProfile = await mkdtemp(join(tmpdir(), 'chashack-oauth-chrome-'));
const chrome = spawn(chromePath, [
  '--headless=new', '--no-sandbox', '--disable-dev-shm-usage',
  '--remote-debugging-' + 'port=0',
  `--user-data-dir=${chromeProfile}`, 'about:blank',
], { detached: true, stdio: 'ignore' });
let server;
let db;
let browser;
const checks = [];
function check(name, condition, detail = '') {
  assert.ok(condition, `${name}${detail ? ` — ${detail}` : ''}`);
  checks.push(name);
  console.log(`PASS ${name}`);
}

try {
  const [{ startAdminServer }, { openTestDb }, { createSession }, { makeDiscordToken }] = await Promise.all([
    import('../dist/adminweb/server.js'), import('../dist/shared/test-db.js'),
    import('../dist/features/auth/data.js'), import('../dist/features/auth/domain.js'),
  ]);
  db = await openTestDb();
  const guildIds = ['11111111111111111', '22222222222222222'];
  const botGuilds = new Map(guildIds.map((id, index) => [id, {
    id, name: `Synthetic test guild ${index + 1}`, ownerId: 'synthetic-user',
    members: { fetch: async (userId) => ({ id: userId, permissions: { has: () => false, bitfield: 0n }, roles: { cache: new Map() } }) },
  }]));
  const client = { guilds: { cache: botGuilds, fetch: async (id) => botGuilds.get(id) } };
  const config = {
    adminSessionSecret: 'x'.repeat(32), adminPort: port, clientId: 'synthetic-client',
    discordClientSecret: 'synthetic-client-secret', // g0:allow:secrets t_ce43eb96 — synthetic OAuth test value only.
    oauthRedirectUri: `${base}/auth/discord/callback`,
    publicUrl: base, skipDiscord: true, adminIds: [], guildId: undefined,
    discordToken: '', announceChannelId: undefined, auditChannelId: undefined,
    teamCategoryId: undefined, botLanguage: 'en', databaseUrl: process.env.DATABASE_URL,
  };
  server = await startAdminServer({
    db, config, announce: async () => undefined, client,
  });
  const session = await createSession(db, {
    userId: 'synthetic-user', username: 'Synthetic browser user', avatar: null,
    guilds: guildIds.map((id, index) => ({ id, name: `Synthetic test guild ${index + 1}`, icon: null })),
  });
  const cookie = `hacksess=${encodeURIComponent(makeDiscordToken(config.adminSessionSecret, session.id))}`;
  const cdpPort = await (async () => {
    const activePort = join(chromeProfile, 'DevToolsActivePort');
    for (let i = 0; i < 100; i++) {
      try {
        const [portText] = (await readFile(activePort, 'utf8')).split('\n');
        const candidate = Number(portText);
        const proc = await fetch(`http://127.0.0.1:${candidate}/json/version`);
        const version = await proc.json();
        return version.webSocketDebuggerUrl;
      } catch {}
      if (chrome.exitCode !== null) throw new Error(`Chromium exited with ${chrome.exitCode}`);
      await delay(100);
    }
    throw new Error('Chromium DevTools endpoint did not start');
  })();
  browser = new WebSocket(cdpPort);
  await new Promise((resolve, reject) => { browser.addEventListener('open', resolve, { once: true }); browser.addEventListener('error', reject, { once: true }); });
  let sequence = 0;
  const pending = new Map();
  browser.addEventListener('message', (event) => {
    const msg = JSON.parse(event.data);
    if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); }
  });
  const send = (method, params = {}, sessionId) => new Promise((resolve, reject) => {
    const id = ++sequence;
    pending.set(id, (msg) => msg.error ? reject(new Error(JSON.stringify(msg.error))) : resolve(msg.result));
    browser.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
  });
  const target = await send('Target.createTarget', { url: 'about:blank' });
  const attached = await send('Target.attachToTarget', { targetId: target.targetId, flatten: true });
  const sid = attached.sessionId;
  const evaluate = async (expression) => {
    const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }, sid);
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.text ?? 'browser evaluation failed');
    return result.result.value;
  };
  const nav = async (url) => {
    await send('Page.navigate', { url }, sid);
    for (let i = 0; i < 100; i++) {
      const ready = await evaluate(`document.readyState === 'complete' && (document.querySelector('#root')?.innerText.trim().length ?? 0) > 0`);
      if (ready) return;
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
    const r = await evaluate(`(() => {const e=${expression}; if(!e) throw Error('Missing click target'); e.scrollIntoView({block:'center'}); return e.getBoundingClientRect().toJSON()})()`);
    await send('Input.dispatchMouseEvent', {type:'mousePressed', x:r.x+r.width/2,y:r.y+r.height/2,button:'left',clickCount:1},sid);
    await send('Input.dispatchMouseEvent', {type:'mouseReleased', x:r.x+r.width/2,y:r.y+r.height/2,button:'left',clickCount:1},sid);
    await delay(150);
  };
  const button = text => `[...document.querySelectorAll('button')].find(e=>e.innerText.trim()===${JSON.stringify(text)})`;
  const fill = async (selector,value) => evaluate(`(() => {const e=document.querySelector(${JSON.stringify(selector)}); if(!e) throw Error('Missing field'); Object.getOwnPropertyDescriptor(e.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:HTMLInputElement.prototype,'value').set.call(e,${JSON.stringify(value)}); e.dispatchEvent(new Event('input',{bubbles:true}));})()`);
  const api = async (path,body,method='POST') => {
    const res=await fetch(base+path,{method,headers:{cookie,'content-type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)})});
    const json=await res.json(); assert.ok(res.ok,JSON.stringify(json)); return json;
  };
  const errors=[];
  browser.addEventListener('message', e=>{const m=JSON.parse(e.data); if(m.method==='Runtime.exceptionThrown') errors.push(m.params.exceptionDetails.text);});
  await nav(base+'/events');
  await wait(`document.body.innerText.includes('New event')`);
  check('empty Events exposes a first-event action',await evaluate(`document.body.innerText.includes('No events') && !!(${button('New event')})`));
  const verifyOtter = async (width, height) => {
    await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false }, sid);
    const placement = await evaluate(`(() => {const image=[...document.images].find(e=>e.getAttribute('aria-hidden')==='true'&&e.alt==='');if(!image)return null;const r=image.getBoundingClientRect(),p=image.parentElement.getBoundingClientRect();return {src:image.currentSrc,loaded:image.complete&&image.naturalWidth>0,hidden:image.getAttribute('aria-hidden')==='true'&&image.alt==='',viewport:innerWidth,scroll:document.documentElement.scrollWidth,image:{x:r.x,y:r.y,w:r.width,h:r.height},parent:{x:p.x,y:p.y,w:p.width,h:p.height}}})()`);
    const ax = await send('Accessibility.getFullAXTree', {}, sid);
    check(`empty Events otter loads and remains decorative at ${width}px`, placement?.loaded && placement.hidden && !ax.nodes.some(n => n.role?.value === 'img' && /otter/i.test(n.name?.value ?? '')));
    check(`empty Events otter placement fits ${width}px viewport`, placement?.viewport === width && placement.scroll <= width && placement.image.x >= placement.parent.x && placement.image.x + placement.image.w <= placement.parent.x + placement.parent.w);
    console.log('INFO empty Events otter geometry', JSON.stringify(placement));
  };
  await verifyOtter(1440, 1000);
  await verifyOtter(390, 844);
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false }, sid);
  const { DEFAULT_FORM }=await import('../dist/features/form/domain.js');
  let form={...DEFAULT_FORM,title:'Svensk anmälan',description:'Välkommen till verkstaden',themePreset:'halloween',customQuestions:[{id:'interests',kind:'text',label:{en:'Interests',sv:'Intressen'},help:{en:'',sv:''},required:false,presentation:'both',visibility:'self_and_organizer'}]};
  form.customQuestions.push({id:'role-question',kind:'single_choice',label:{en:'Preferred role',sv:'Önskad roll'},help:{en:'',sv:''},required:false,presentation:'web',visibility:'self_and_organizer',choices:[{id:'frontend-choice',label:{en:'Frontend',sv:'Frontend'}}],mapping:{field:'role',importance:'high',choiceValues:{'frontend-choice':'frontend'}}});
  const formTemplate=(await api('/api/templates',{name:'Svenska frågor',kind:'form',json:JSON.stringify(form)})).template;
  await nav(base+'/templates'); await wait(`document.body.innerText.includes('Form templates')`);
  await click(`[...document.querySelectorAll('[role=tab]')].find(e=>e.innerText.includes('Form templates'))`);
  await click(`[...document.querySelectorAll('[data-slot=card-title]')].find(e=>e.innerText==='Svenska frågor')`);
  await wait(`!!document.querySelector('fieldset')`);
  const formAX=await send('Accessibility.getFullAXTree',{},sid);
  check('form-template editor is a named AX modal with initial focus',formAX.nodes.some(n=>n.role?.value==='dialog'&&n.name?.value==='Edit form template')&&await evaluate(`document.querySelector('[role=dialog][aria-modal=true]').contains(document.activeElement)`));
  const key=async (name,modifiers=0)=>{const code={Tab:9,Escape:27,Enter:13}[name];await send('Input.dispatchKeyEvent',{type:'keyDown',key:name,code:name,windowsVirtualKeyCode:code,modifiers},sid);await send('Input.dispatchKeyEvent',{type:'keyUp',key:name,code:name,windowsVirtualKeyCode:code,modifiers},sid);await delay(150);};
  await evaluate(`(${button('Save changes')}).focus()`);
  await key('Tab');
  check('Tab wraps from form footer to initial field',await evaluate(`document.activeElement===document.querySelector('#form-template-name')`));
  await key('Tab',8);
  check('Shift+Tab wraps inside form editor',await evaluate(`document.activeElement===(${button('Save changes')})`));
  await key('Escape'); await wait(`!document.querySelector('[role=dialog]')`);
  check('Escape closes form editor and restores its opener',await evaluate(`document.activeElement.innerText.includes('Svenska frågor')&&!document.querySelector('fieldset')`));
  await key('Enter');
  await wait(`!!document.querySelector('fieldset')`);
  // QA2: reject an invalid definition before any template write, retaining input.
  await evaluate(`(() => {const e=document.querySelectorAll('fieldset input')[1];Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,'Endast svenska');e.dispatchEvent(new Event('input',{bubbles:true}));})()`);
  await fill('fieldset input','');
  await click(button('Save changes'));
  check('blank English question label blocks save with associated error and focus',await evaluate(`(() => {const e=document.querySelector('fieldset input');return !!e&&e.value===''&&e.getAttribute('aria-invalid')==='true'&&document.getElementById(e.getAttribute('aria-describedby'))?.innerText.includes('English label')&&document.activeElement===e&&document.querySelectorAll('fieldset input')[1].value==='Endast svenska'})()`));
  check('invalid question did not persist',JSON.parse((await api('/api/state',undefined,'GET')).templates.find(t=>t.id===formTemplate.id).json).customQuestions[0].label.en==='Interests');
  await fill('fieldset input','What would you like to build?');
  await click(`document.getElementById('role-question-frontend-choice-target')`);
  await click(`[...document.querySelectorAll('[role=option]')].find(e=>e.innerText==='Choose a target')`);
  await click(button('Save changes'));
  check('incomplete choice mapping blocks save with target error and focus',await evaluate(`(() => {const e=document.getElementById('role-question-frontend-choice-target');return !!e&&e.getAttribute('aria-invalid')==='true'&&!!document.getElementById(e.getAttribute('aria-describedby'))&&document.activeElement===e&&document.querySelector('fieldset input').value==='What would you like to build?'})()`));
  check('invalid mapping did not persist',JSON.parse((await api('/api/state',undefined,'GET')).templates.find(t=>t.id===formTemplate.id).json).customQuestions[1].mapping.choiceValues['frontend-choice']==='frontend');
  await click(`document.getElementById('role-question-frontend-choice-target')`);
  await click(`[...document.querySelectorAll('[role=option]')].find(e=>e.innerText==='Frontend')`);
  await click(button('Save changes')); await wait(`!document.querySelector('fieldset')`);
  check('valid mapped form saves successfully',JSON.parse((await api('/api/state',undefined,'GET')).templates.find(t=>t.id===formTemplate.id).json).customQuestions[1].mapping.choiceValues['frontend-choice']==='frontend');
  await click(`[...document.querySelectorAll('[data-slot=card-title]')].find(e=>e.innerText==='Svenska frågor')`);
  await wait(`!!document.querySelector('fieldset')`);

  await evaluate(`(() => {const e=document.querySelectorAll('fieldset input')[1]; Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,'Vad vill du bygga?');e.dispatchEvent(new Event('input',{bubbles:true}));})()`);
  await click(`document.querySelectorAll('fieldset')[1].querySelector('[role=combobox]')`);
  await click(`[...document.querySelectorAll('[role=option]')].find(e=>e.innerText==='Multiple choice')`);
  await click(`document.querySelector('button[aria-label="Theme preset"]')`);
  await click(`[...document.querySelectorAll('[role=option]')].find(e=>e.innerText==='Christmas')`);
  await click(button('Save changes'));
  await wait(`!document.querySelector('fieldset')`);
  let templates=(await api('/api/state',undefined,'GET')).templates;
  form=JSON.parse(templates.find(t=>t.id===formTemplate.id).json);
  check('custom question labels edited in served form editor preserve stable ID',form.customQuestions[0].id==='interests'&&form.customQuestions[0].label.sv==='Vad vill du bygga?');
  check('incompatible role mapping clears when switching to multiple choice',form.customQuestions[1].kind==='multi_choice'&&!form.customQuestions[1].mapping);
  check('theme preset edited through the served form control persists',form.themePreset==='christmas');
  const collection=(await api('/api/templates',{name:'Svenska uppdrag',kind:'assignments',json:JSON.stringify({assignments:[{id:'brief',title:'Bygg tillsammans',instructions:'Bygg något för {team}'}]})})).template;
  const template=(await api('/api/templates',{name:'Svensk verkstad',kind:'event',json:JSON.stringify({name:'Svensk verkstad',description:'En gemensam helg',form,assignmentCollectionId:collection.id,assignmentStrategy:'same',schedule:[{id:'workshop',title:'Verkstad',kind:'other',time:0,anchor:'hackathon_start',offsetMinutes:600}]})})).template;
  await nav(base+'/events'); await wait(`document.body.innerText.includes('New event')`);
  await click(button('New event'));
  await click(`document.querySelector('button[role=combobox]')`);
  await click(`[...document.querySelectorAll('[role=option]')].find(e=>e.innerText.includes('Svensk verkstad'))`);
  await click(button('Continue with template'));
  await wait(`!!document.querySelector('input[maxlength="100"]')`);
  check('Swedish template fills event editor',await evaluate(`document.querySelector('input[maxlength="100"]').value==='Svensk verkstad' && document.body.innerText.includes('Svenska uppdrag') && document.body.innerText.includes('Verkstad')`));
  await click(`[...document.querySelectorAll('button')].find(e=>e.innerText.startsWith('Hackathon Starts'))`);
  await click(button('Pick date & time'));
  await wait(`!!document.querySelector('button[data-day]:not([disabled])')`);
  await click(`[...document.querySelectorAll('button[data-day]:not([disabled])')].at(-1)`);
  await click(button('Done'));
  await click(button('Create & launch'));
  await wait(`!document.querySelector('textarea[maxlength="1000"]')`);
  let state=await api('/api/state',undefined,'GET');
  let event=state.events.find(e=>e.name==='Svensk verkstad'); assert.ok(event);
  check('publication persisted template questions, collection and schedule',event.status==='active'&&JSON.parse(event.formJson).customQuestions[0].id==='interests'&&event.assignments[0].id==='brief'&&event.schedule.some(s=>s.id==='workshop'));
  const expectedWorkshop=new Date(event.startsAt); expectedWorkshop.setHours(10,0,0,0);
  check('picked local start date resolves schedule anchors and signup window',event.startsAt!==null&&event.schedule.find(s=>s.id==='workshop').time===expectedWorkshop.getTime()&&event.signupStartsAt<event.signupEndsAt&&event.signupEndsAt===event.startsAt);
  check('collection strategy propagates into start-time distribution',event.schedule.find(s=>s.id==='__start__').actions.some(a=>a.type==='distribute_assignments'&&a.mode==='same'));
  await nav(base+'/events?event='+event.id);
  await wait(`!!document.querySelector('a[target="_blank"]')`);
  const ax=await send('Accessibility.getFullAXTree',{},sid);
  check('published preview is a named AX link',ax.nodes.some(n=>n.role?.value==='link'&&/preview/i.test(n.name?.value??'')));
  const pub=await api('/api/public/events/'+event.id,undefined,'GET');
  check('public definition agrees with persisted form',pub.event.name===event.name&&pub.form.title===form.title&&pub.form.themePreset===form.themePreset);
  const html=await (await fetch(base+'/events/'+event.id)).text();
  check('initial public HTML agrees with persisted title and description',html.includes(event.name)&&html.includes(event.description)&&html.includes('og:title'));
  await send('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:false},sid);
  await send('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]},sid);
  await delay(300);
  const mobile=await evaluate(`(() => {const bar=document.querySelector('a[target="_blank"]').parentElement; return {url:location.href,width:innerWidth,desktop:matchMedia('(min-width:640px)').matches,bundles:[...document.scripts].map(s=>s.src).filter(Boolean),scroll:document.documentElement.scrollWidth,targets:[...bar.querySelectorAll('button,a')].map(e=>({text:e.innerText,class:e.className,width:e.getBoundingClientRect().width,height:e.getBoundingClientRect().height})),reduced:matchMedia('(prefers-reduced-motion:reduce)').matches}})()`);
  console.log('INFO stable mobile geometry',JSON.stringify(mobile));
  check('mobile viewport is real before interpreting targets',mobile.width===390&&!mobile.desktop);
  check('mobile toolbar targets are at least 44px',mobile.targets.length>0&&mobile.targets.every(t=>t.height>=44&&t.width>=44));
  check('mobile no horizontal overflow and reduced motion enabled',mobile.scroll<=390&&mobile.reduced);
  await send('Emulation.setDeviceMetricsOverride',{width:1440,height:1000,deviceScaleFactor:1,mobile:false},sid);
  await click(button('Edit event'));
  await wait(`!!document.querySelector('textarea[maxlength="1000"]')`);
  check('edit dialog has named modal semantics and initial focus',await evaluate(`!!document.querySelector('[role=dialog][aria-labelledby][aria-modal=true]')&&document.querySelector('[role=dialog]').contains(document.activeElement)`));
  await send('Input.dispatchKeyEvent',{type:'keyDown',key:'Tab',code:'Tab',windowsVirtualKeyCode:9},sid);
  await send('Input.dispatchKeyEvent',{type:'keyUp',key:'Tab',code:'Tab',windowsVirtualKeyCode:9},sid);
  check('keyboard Tab stays inside editor',await evaluate(`document.querySelector('[role=dialog]').contains(document.activeElement)`));
  await send('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape',code:'Escape',windowsVirtualKeyCode:27},sid);
  await send('Input.dispatchKeyEvent',{type:'keyUp',key:'Escape',code:'Escape',windowsVirtualKeyCode:27},sid);
  await wait(`!document.querySelector('[role=dialog]')`);
  await click(button('Edit event'));
  await fill('textarea[maxlength="1000"]','Cosmetic change retained');
  // Return one synthetic 429 with Retry-After, then use the real API for Retry.
  await evaluate(`window.originalFetch=window.fetch; window.retry429=true; window.fetch=async (...args)=>{if(window.retry429&&String(args[0]).includes('/api/events/')&&args[1]?.method==='PATCH'){window.retry429=false;return new Response(JSON.stringify({error:'rate_limited',retryAfterSeconds:60}),{status:429,headers:{'content-type':'application/json','retry-after':'60'}})}return window.originalFetch(...args)}`);
  await click(button('Save'));
  await wait(`!!document.querySelector('[role=alert]')`);
  check('429 preserves entered data and displays Retry-After timing',await evaluate(`document.querySelector('textarea[maxlength="1000"]').value==='Cosmetic change retained'&&document.querySelector('[role=alert]').innerText.includes('retry in 60s')&&!!(${button('Retry save')})`));
  await click(button('Retry save'));
  await wait(`!document.querySelector('textarea[maxlength="1000"]')`);
  state=await api('/api/state',undefined,'GET'); event=state.events.find(e=>e.id===event.id);
  check('cosmetic save control persists through Retry',event.description==='Cosmetic change retained');
  await db.run("INSERT INTO participants (event_id,user_id,guild_id,display_name,experience,role_track,skills,team_pref,teammates,status,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,'active',1,1)",event.id,'synthetic-participant',guildIds[0],'Synthetic participant','','','[]','','[]');
  const structural={...form,customQuestions:form.customQuestions.map(q=>({...q,required:true}))};
  await api('/api/templates',{name:'Structural conflict',kind:'form',json:JSON.stringify(structural)});
  await api('/api/templates',{name:'Cosmetic label',kind:'form',json:JSON.stringify({...form,customQuestions:form.customQuestions.map(q=>({...q,label:{en:'Updated interests',sv:'Uppdaterade intressen'}}))})});
  await nav(base+'/events?event='+event.id); await wait(`!!document.querySelector('a[target="_blank"]')`);
  const chooseForm=async name=>{await click(`[...document.querySelectorAll('label')].find(e=>e.innerText.includes('Change form')).querySelector('[role=combobox]')`);await click(`[...document.querySelectorAll('[role=option]')].find(e=>e.innerText.includes(${JSON.stringify(name)}))`);};
  await click(button('Edit event')); await chooseForm('Structural conflict');
  await fill('textarea[maxlength="1000"]','Retained conflict description');
  await click(button('Save')); await wait(`!!document.querySelector('[role=alert]')`);
  const failureAX=await send('Accessibility.getFullAXTree',{},sid);
  check('populated published structural edit exposes conflict and Retry in AX',failureAX.nodes.some(n=>n.role?.value==='alert')&&await evaluate(`document.querySelector('[role=alert]').innerText.includes('version migration')&&!!(${button('Retry save')})`));
  check('conflict retains typed input and chosen template without success',await evaluate(`document.querySelector('textarea[maxlength="1000"]').value==='Retained conflict description'&&document.body.innerText.includes('Structural conflict')&&!!(${button('Save')})`));
  let after=(await api('/api/state',undefined,'GET')).events.find(e=>e.id===event.id);
  check('rejected structural save leaves pinned definition unchanged',JSON.parse(after.formJson).customQuestions[0].required===false);
  await chooseForm('Cosmetic label'); await click(button('Retry save'));
  await wait(`!document.querySelector('textarea[maxlength="1000"]')`);
  after=(await api('/api/state',undefined,'GET')).events.find(e=>e.id===event.id);
  check('cosmetic form label saves on the same published version',JSON.parse(after.formJson).customQuestions[0].label.sv==='Uppdaterade intressen'&&JSON.parse(after.formJson).version===JSON.parse(event.formJson).version);
  // QA1: replacement identities must be structural, including after a reload.
  for (const kind of ['text','single_choice']) {
    const original={...DEFAULT_FORM,customQuestions:[{id:'question_1',kind,label:{en:'Original question'},help:{en:''},required:false,presentation:'web',visibility:'self_and_organizer',...(kind==='text'?{}:{choices:[{id:'option_1',label:{en:'Original choice'}}]})}]};
    const name=`Identity ${kind}`;
    const tpl=(await api('/api/templates',{name,kind:'form',json:JSON.stringify(original)})).template;
    const published=(await api('/api/events',{name,formTemplateId:tpl.id,launch:true})).event;
    const pinned=JSON.parse(published.formJson);
    const historical={question_1:kind==='text'?'Original answer':'option_1'};
    await db.run("INSERT INTO participants (event_id,user_id,guild_id,display_name,experience,role_track,skills,team_pref,teammates,status,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,'active',1,1)",published.id,'identity-user',guildIds[0],'Synthetic participant','','','[]','','[]');
    await db.run('INSERT INTO registration_answers (event_id,user_id,form_version,answers_json,updated_at) VALUES (?,?,?,?,?)',published.id,'identity-user',pinned.version,JSON.stringify(historical),1);
    await nav(base+'/templates'); await wait(`document.body.innerText.includes('Form templates')`);
    await click(`[...document.querySelectorAll('[role=tab]')].find(e=>e.innerText.includes('Form templates'))`);
    await click(`[...document.querySelectorAll('[data-slot=card-title]')].find(e=>e.innerText===${JSON.stringify(name)})`);
    await wait(`!!document.querySelector('fieldset')`);
    if (kind==='text') {
      await click(button('Remove question')); await click(button('Add question'));
      await fill('fieldset input','Replacement question');
    } else {
      await click(`document.querySelector('button[aria-label="Delete option_1"]')`);
      await click(button('Save changes'));
      check('empty choice set blocks save and focuses answer type',await evaluate(`document.activeElement.id==='question_1-kind'&&document.activeElement.getAttribute('aria-invalid')==='true'`));
      await click(button('Add choice')); await click(button('Save changes'));
      check('blank choice label blocks save with associated error',await evaluate(`document.activeElement.matches('input[aria-invalid=true]')&&!!document.getElementById(document.activeElement.getAttribute('aria-describedby'))`));
      await fill('fieldset input[aria-label^="English"]','Replacement choice');
    }
    const replacement=await evaluate(kind==='text'?`document.querySelector('fieldset legend code').innerText`:`document.querySelector('fieldset input[aria-label^="English"]').getAttribute('aria-label').split(' ').at(-1)`);
    check(`${kind} replacement does not recycle deleted identity`,replacement!==(kind==='text'?'question_1':'option_1'));
    await click(button('Save changes')); await wait(`!document.querySelector('fieldset')`);
    const saved=JSON.parse((await api('/api/state',undefined,'GET')).templates.find(t=>t.id===tpl.id).json);
    check(`${kind} replacement identity persists`,(kind==='text'?saved.customQuestions[0].id:saved.customQuestions[0].choices[0].id)===replacement);
    await nav(base+'/events?event='+published.id); await wait(`!!(${button('Edit event')})`);
    await click(button('Edit event')); await chooseForm(name); await click(button('Save'));
    await wait(`!!document.querySelector('[role=alert]')`);
    check(`${kind} replacement reports structural conflict in served editor`,await evaluate(`document.querySelector('[role=alert]').innerText.includes('version migration')&&!!(${button('Retry save')})`));
    const unchanged=(await api('/api/state',undefined,'GET')).events.find(e=>e.id===published.id);
    const stored=await db.get('SELECT form_version,answers_json FROM registration_answers WHERE event_id=? AND user_id=?',published.id,'identity-user');
    check(`${kind} conflict preserves pinned form and historical answers`,unchanged.formJson===published.formJson&&stored.form_version===pinned.version&&stored.answers_json===JSON.stringify(historical));
    await key('Escape'); await wait(`!document.querySelector('[role=dialog]')`);
  }
  // QA2 sibling boundaries: embedded event templates and custom event creation.
  const mappedQuestion={id:'map-a',kind:'single_choice',label:{en:'Role'},help:{en:''},required:false,presentation:'web',visibility:'self_and_organizer',choices:[{id:'frontend',label:{en:'Frontend'}}],mapping:{field:'role',importance:'normal',choiceValues:{frontend:'frontend'}}};
  await api('/api/templates',{name:'Invalid embedded form',kind:'event',json:JSON.stringify({name:'Invalid embedded form',form:{...DEFAULT_FORM,customQuestions:[mappedQuestion,{...mappedQuestion,id:'map-b'}]}})});
  await nav(base+'/templates'); await wait(`document.body.innerText.includes('Invalid embedded form')`);
  await click(`[...document.querySelectorAll('[data-slot=card-title]')].find(e=>e.innerText==='Invalid embedded form')`);
  await wait(`!!document.querySelector('fieldset')`);
  await evaluate(`window.boundaryWrites=[];const real=window.fetch;window.fetch=(...args)=>{if(args[1]?.method==='POST'||args[1]?.method==='PATCH')window.boundaryWrites.push(String(args[0]));return real(...args)}`);
  await click(button('Save changes'));
  check('embedded event template rejects duplicate mappings before write',await evaluate(`document.activeElement.id==='map-b-mapping'&&document.activeElement.getAttribute('aria-invalid')==='true'&&document.getElementById(document.activeElement.getAttribute('aria-describedby')).innerText.includes('Only one question')&&window.boundaryWrites.length===0`));
  await key('Escape'); await wait(`!document.querySelector('[role=dialog]')`);
  check('event-template editor restores its opener',await evaluate(`document.activeElement.innerText.includes('Invalid embedded form')`));
  await nav(base+'/events'); await wait(`!!(${button('New event')})`);
  await click(button('New event'));
  await click(`[...document.querySelectorAll('.fixed button')].find(e=>e.innerText.includes('Create a fresh event from scratch.'))`);
  await wait(`!!document.querySelector('input[maxlength="100"]')`);
  await fill('[role=dialog] input[maxlength="100"]','Validation boundary');
  await click(`[...document.querySelectorAll('button')].find(e=>e.innerText.startsWith('Build new form'))`);
  await click(button('Add question')); await wait(`!!document.querySelector('fieldset')`);
  await evaluate(`window.boundaryWrites=[];const real=window.fetch;window.fetch=(...args)=>{if(args[1]?.method==='POST'||args[1]?.method==='PATCH')window.boundaryWrites.push(String(args[0]));return real(...args)}`);
  await click(button('Create & launch'));
  check('custom event creation rejects invalid question before template or event write',await evaluate(`document.activeElement.matches('fieldset input[aria-invalid=true]')&&document.querySelector('[role=dialog] input[maxlength="100"]').value==='Validation boundary'&&window.boundaryWrites.length===0`));
  await key('Escape'); await wait(`!document.querySelector('[role=dialog]')`);
  await nav(base+'/events?event='+event.id); await wait(`!!document.querySelector('a[target="_blank"]')`);
  await click(`[...document.querySelectorAll('button')].find(e=>e.getAttribute('aria-label')?.startsWith('Switch language'))`);
  check('Swedish workspace and preview action are localized',await evaluate(`document.documentElement.lang==='sv'&&document.body.innerText.includes('Offentlig förhandsvisning')`));
  const keys=await Promise.all(['en','sv'].map(async l=>Object.keys(JSON.parse(await readFile(new URL('../../admin-ui/src/lib/i18n/'+l+'.json',import.meta.url),'utf8'))).sort()));
  check('English and Swedish catalogs contain the same keys',JSON.stringify(keys[0])===JSON.stringify(keys[1]));
  await nav(base+'/templates'); await wait(`document.body.innerText.includes('Form templates')`);
  await click(`[...document.querySelectorAll('[role=tab]')].find(e=>e.innerText.includes('Form templates'))`);
  await click(`[...document.querySelectorAll('[data-slot=card-title]')].find(e=>e.innerText==='Svenska frågor')`);
  await wait(`!!document.querySelector('fieldset')`);
  await fill('fieldset input',''); await click(button('Save changes'));
  check('Swedish validation error is associated with the focused field',await evaluate(`(() => {const e=document.querySelector('fieldset input');return document.activeElement===e&&document.getElementById(e.getAttribute('aria-describedby'))?.innerText.includes('Ange en engelsk etikett')})()`));
  await key('Escape'); await wait(`!document.querySelector('[role=dialog]')`);
  // Controlled empty-state response; no shared database deletion/reset.
  const emptyScript=await send('Page.addScriptToEvaluateOnNewDocument',{source:`const realFetch=window.fetch; window.fetch=async (...args)=>{const r=await realFetch(...args);if(String(args[0]).startsWith('/api/state')){const s=await r.json();return new Response(JSON.stringify({...s,events:[],templates:[]} ),{status:200,headers:{'content-type':'application/json'}})}return r}`},sid);
  await nav(base+'/events'); await wait(`document.body.innerText.includes('Nytt event')`);
  check('empty template/event workspace keeps first-event action',await evaluate(`document.body.innerText.includes('Inga events än')&&!![...document.querySelectorAll('button')].find(e=>e.innerText.includes('Nytt event'))`));
  await send('Page.removeScriptToEvaluateOnNewDocument',{identifier:emptyScript.identifier},sid);
  console.log('RESULT',checks.length,'browser assertions passed; console exceptions:',JSON.stringify(errors));
  assert.deepEqual(errors,[]);
} finally {
  browser?.close();
  if (server) await server.stop();
  if (db) await db.close();
  if (chrome.exitCode === null) {
    try { process.kill(-chrome.pid, 'SIGTERM'); } catch {}
    await Promise.race([new Promise(resolve => chrome.once('exit', resolve)), delay(3000)]);
  }
  await rm(chromeProfile, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
}