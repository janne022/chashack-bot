#!/usr/bin/env node
/** @journey:participant — served participant signup, empty state and team lifecycle. Synthetic sessions/membership only; no live Discord OAuth claim. */
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';

const port = 8493, base = `http://127.0.0.1:${port}`;
const chromePath = '/home/hermes/.cache/ms-playwright/chromium-1208/chrome-linux64/chrome';
const profile = await mkdtemp(join(tmpdir(), 'chashack-participant-'));
const chrome = spawn(chromePath, ['--headless=new','--no-sandbox','--disable-dev-shm-usage','--remote-debugging-port=0',`--user-data-dir=${profile}`,'about:blank'], {detached:true,stdio:'ignore'}); // g0:allow:secrets t_583f310e — synthetic local browser flags only.
let server, db, browser;
const checks=[];
const check=(name,ok)=>{assert.ok(ok,name);checks.push(name);console.log(`PASS ${name}`)};
try {
  const [{startAdminServer},{openTestDb},{createSession},{makeDiscordToken},{DEFAULT_FORM}]=await Promise.all([
    import('../dist/adminweb/server.js'),import('../dist/shared/test-db.js'),import('../dist/features/auth/data.js'),import('../dist/features/auth/domain.js'),import('../dist/features/form/domain.js')
  ]);
  db=await openTestDb();
  const guildId='11111111111111111', members=new Set(['participant-a','participant-b','participant-c','organizer']);
  const guild={id:guildId,ownerId:'organizer',members:{fetch:async input=>{const id=typeof input==='string'?input:input.user;if(!members.has(id))throw Object.assign(Error('not a member'),{code:10007});return {id,permissions:{has:()=>id==='organizer',bitfield:id==='organizer'?32n:0n},roles:{cache:new Map()}}}}};
  const client={guilds:{cache:new Map([[guildId,guild]]),fetch:async id=>id===guildId?guild:undefined}};
  const config={adminSessionSecret:'x'.repeat(32),adminPort:port,clientId:'synthetic-client',discordClientSecret:'synthetic-client-secret', // g0:allow:secrets t_583f310e — synthetic fixture only.
    oauthRedirectUri:`${base}/auth/discord/callback`,publicUrl:base,skipDiscord:true,adminIds:[],guildId:undefined,discordToken:'',announceChannelId:undefined,auditChannelId:undefined,teamCategoryId:undefined,botLanguage:'en',databaseUrl:process.env.DATABASE_URL};
  server=await startAdminServer({db,config,announce:async()=>undefined,client});
  const form={...DEFAULT_FORM,title:'Svensk anmälan',description:'Välkommen',teamSize:2,customQuestions:[{id:'idea',kind:'text',label:{en:'Your idea',sv:'Din idé'},help:{en:'',sv:''},required:true,presentation:'web',visibility:'self_and_organizer'},{id:'private',kind:'text',label:{en:'Private answer',sv:'Privat svar'},help:{en:'',sv:''},required:false,presentation:'web',visibility:'organizer_only'}]};
  const eventId='participant-browser-event';
  await db.run('INSERT INTO events (id,guild_id,name,description,status,form_json,created_at,updated_at) VALUES (?,?,?,?,?,?,1,1)',eventId,guildId,'Svensk hackathon','Bygg tillsammans','active',JSON.stringify(form));
  const cookies={};
  for(const userId of members){
    const session=await createSession(db,{userId,username:userId,avatar:null,guilds:[],audience:'participant'});
    cookies[userId]=`hackpartsess=${encodeURIComponent(makeDiscordToken(config.adminSessionSecret,session.id,Date.now(),'participant'))}`;
  }
  const organizerSession=await createSession(db,{userId:'organizer',username:'Synthetic organizer',avatar:null,guilds:[{id:guildId,name:'Synthetic guild',icon:null}]});
  cookies.organizer=`hacksess=${encodeURIComponent(makeDiscordToken(config.adminSessionSecret,organizerSession.id))}`;
  const endpoint=join(profile,'DevToolsActivePort'); let ws;
  for(let i=0;i<100;i++){try{const [p]= (await readFile(endpoint,'utf8')).split('\n');ws=(await (await fetch(`http://127.0.0.1:${p}/json/version`)).json()).webSocketDebuggerUrl;break}catch{} await delay(100)}
  assert.ok(ws,'Chromium DevTools starts'); browser=new WebSocket(ws); await new Promise((r,j)=>{browser.addEventListener('open',r,{once:true});browser.addEventListener('error',j,{once:true})});
  let seq=0;const pending=new Map(),exceptions=[];browser.addEventListener('message',e=>{const m=JSON.parse(e.data);if(m.id&&pending.has(m.id)){pending.get(m.id)(m);pending.delete(m.id)}if(m.method==='Runtime.exceptionThrown')exceptions.push(m.params.exceptionDetails.text)});
  const send=(method,params={},sessionId)=>new Promise((resolve,reject)=>{const id=++seq;pending.set(id,m=>m.error?reject(Error(`${method}: ${JSON.stringify(m.error)}`)):resolve(m.result));browser.send(JSON.stringify({id,method,params,...sessionId?{sessionId}:{}}))});
  const target=await send('Target.createTarget',{url:'about:blank'}), sid=(await send('Target.attachToTarget',{targetId:target.targetId,flatten:true})).sessionId;
  const evaluate=async expression=>{const r=await send('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true},sid);if(r.exceptionDetails)throw Error(r.exceptionDetails.text);return r.result.value};
  const nav=async path=>{await send('Page.navigate',{url:base+path},sid);for(let i=0;i<100;i++){if(await evaluate(`document.readyState==='complete'&&document.querySelector('#root')?.innerText.trim().length>0`))return;await delay(100)}throw Error(`navigation timeout ${path}: ${await evaluate('document.body.innerText')}`)};
  const wait=async expr=>{for(let i=0;i<100;i++){if(await evaluate(expr))return;await delay(100)}throw Error(`wait timeout ${expr}; URL=${await evaluate('location.href')}; DOM=${await evaluate('document.body.innerText')}`)};
  const click=async expr=>{const r=await evaluate(`(()=>{const e=${expr};if(!e)throw Error('missing click target');e.scrollIntoView({block:'center'});return e.getBoundingClientRect().toJSON()})()`);await send('Input.dispatchMouseEvent',{type:'mousePressed',x:r.x+r.width/2,y:r.y+r.height/2,button:'left',clickCount:1},sid);await send('Input.dispatchMouseEvent',{type:'mouseReleased',x:r.x+r.width/2,y:r.y+r.height/2,button:'left',clickCount:1},sid);await delay(150)};
  const ax=async(selector='textarea#idea')=>{const doc=await send('DOM.getDocument',{depth:0,pierce:true},sid);const node=await send('DOM.querySelector',{nodeId:doc.root.nodeId,selector},sid);return send('Accessibility.getPartialAXTree',{nodeId:node.nodeId,fetchRelatives:true},sid)};
  await send('Page.enable',{},sid);await send('Runtime.enable',{},sid);await send('Network.enable',{},sid);await send('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:false},sid);
  await send('Network.setCookie',{name:'hackpartsess',value:decodeURIComponent(cookies['participant-a'].split('=')[1]),url:base,httpOnly:true},sid);
  await nav('/'); await evaluate(`localStorage.setItem('chas-locale','sv')`);
  await nav(`/events/${eventId}/signup`);
  await wait(`!!document.querySelector('textarea#idea')`);
  check('served Swedish signup uses event locale label',await evaluate(`document.documentElement.lang==='sv'&&document.querySelector('label[for=idea]')?.innerText.includes('Din idé')`));
  await click(`document.querySelector('form button[type=submit]')`);
  check('required answer validation names field, associates error and focuses it',await evaluate(`(()=>{const e=document.querySelector('#idea');return e.getAttribute('aria-invalid')==='true'&&!!document.getElementById(e.getAttribute('aria-describedby'))&&document.activeElement===e})()`));
  await evaluate(`(()=>{const e=document.querySelector('#idea');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(e,'Jag bygger en robot');e.dispatchEvent(new Event('input',{bubbles:true}))})()`);
  const before=await ax();check('signup field is exposed by the browser accessibility tree with its localized name',before.nodes.some(n=>n.role?.value==='textbox'&&n.name?.value.startsWith('Din idé')));
  await evaluate(`window.realFetch=window.fetch;window.fetch=async(...args)=>{if(String(args[0]).includes('/registration')&&args[1]?.method==='PUT'){await new Promise(r=>setTimeout(r,400));throw Error('controlled save failure')}return window.realFetch(...args)}`);
  await click(`document.querySelector('form button[type=submit]')`);
  check('signup enters waiting state with disabled submit',await evaluate(`!!document.querySelector('button[aria-busy=true]:disabled')`));
  await wait(`!!document.querySelector('[role=alert]')`);
  check('failed signup preserves typed answer and exposes recovery',await evaluate(`document.querySelector('#idea').value==='Jag bygger en robot'&&!![...document.querySelectorAll('button')].find(b=>/Försök igen|Ladda om/.test(b.innerText))`));
  await evaluate('window.fetch=window.realFetch');
  await click(`document.querySelector('form button[type=submit]')`);
  await wait(`document.body.innerText.includes('team')||document.body.innerText.includes('lag')`);
  check('successful registration persists answers to the same session',JSON.parse((await db.get('SELECT answers_json FROM registration_answers WHERE event_id=? AND user_id=?',eventId,'participant-a')).answers_json).idea==='Jag bygger en robot');
  const reg=await fetch(`${base}/api/participant/events/${eventId}/registration`,{headers:{cookie:cookies['participant-a']}});check('registration completion response is true',reg.ok&&(await reg.json()).complete===true);
  await nav('/my-hackathons');await wait(`document.body.innerText.includes('Svensk hackathon')`);
  check('My hackathons shows only the signed-in participant registration',await evaluate(`document.body.innerText.includes('Svensk hackathon')&&!document.body.innerText.includes('participant-b')`));
  await send('Network.setCookie',{name:'hackpartsess',value:decodeURIComponent(cookies['participant-b'].split('=')[1]),url:base,httpOnly:true},sid);
  await nav('/my-hackathons');await wait(`document.body.innerText.includes('Inga hackathon ännu')`);
  check('empty My hackathons has Swedish discovery guidance and an actionable Discord link',await evaluate(`document.body.innerText.includes('Inga hackathon ännu')&&document.querySelector('a[href="https://discord.com/channels/@me"]')?.innerText==='Öppna Discord'&&!document.body.innerText.includes('Svensk hackathon')`));
  await send('Network.setCookie',{name:'hackpartsess',value:decodeURIComponent(cookies['participant-a'].split('=')[1]),url:base,httpOnly:true},sid);
  await send('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:false},sid);
  await send('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]},sid);
  const view=await evaluate(`({width:innerWidth,scroll:document.documentElement.scrollWidth,reduced:matchMedia('(prefers-reduced-motion:reduce)').matches})`);
  check('real mobile viewport and reduced-motion state are active without horizontal overflow',view.width===390&&view.scroll<=390&&view.reduced);
  for(const userId of ['participant-b','participant-c']) await db.run("INSERT INTO participants (event_id,user_id,guild_id,display_name,experience,role_track,skills,team_pref,teammates,status,created_at,updated_at) VALUES (?,?,?,'Synthetic teammate','','','[]','','[]','active',1,1)",eventId,userId,guildId);
  await db.run('INSERT INTO registration_answers (event_id,user_id,form_version,answers_json,updated_at) VALUES (?,?,?,?,1)',eventId,'participant-b',1,JSON.stringify({idea:'Public answer',private:'CLASSIFIED ANSWER'}));
  await db.run('INSERT INTO registration_answers (event_id,user_id,form_version,answers_json,updated_at) VALUES (?,?,?,?,1)',eventId,'participant-c',1,JSON.stringify({idea:'Another idea'}));
  await nav(`/team?eventId=${eventId}`);await wait(`!!document.querySelector('input')`);
  await evaluate(`(()=>{const e=document.querySelector('input');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,'Workshop crew');e.dispatchEvent(new Event('input',{bubbles:true}))})()`);
  await click(`[...document.querySelectorAll('button')].find(b=>/Create team|Skapa lag/.test(b.innerText))`);
  await wait(`document.body.innerText.includes('Workshop crew')`);
  check('eligible participant can create own team through served UI',await evaluate(`document.body.innerText.includes('Workshop crew')`));
  await send('Network.setCookie',{name:'hackpartsess',value:decodeURIComponent(cookies['participant-b'].split('=')[1]),url:base,httpOnly:true},sid);
  await nav(`/team?eventId=${eventId}`);await wait(`document.body.innerText.includes('Workshop crew')`);
  await click(`[...document.querySelectorAll('button')].find(b=>b.innerText.includes('Gå med i laget'))`);
  await wait(`document.body.innerText.includes('2 medlemmar')`);
  check('participant can join a public team and teammate view excludes private answers',await evaluate(`document.body.innerText.includes('Workshop crew')&&!document.body.innerText.includes('CLASSIFIED ANSWER')`));
  await click(`[...document.querySelectorAll('button')].find(b=>b.innerText.includes('Lämna laget'))`);
  await wait(`!![...document.querySelectorAll('button')].find(b=>b.innerText.includes('Gå med i laget'))`);
  check('participant can leave a team and return to open team choices',await evaluate(`!document.body.innerText.includes('2 medlemmar')`));
  await send('Network.setCookie',{name:'hackpartsess',value:decodeURIComponent(cookies['participant-a'].split('=')[1]),url:base,httpOnly:true},sid);
  await nav(`/team?eventId=${eventId}`);await wait(`document.body.innerText.includes('Workshop crew')`);
  check('owner receives invite controls regardless of join-code metadata',await evaluate(`!!document.querySelector('#invite-id')&&!![...document.querySelectorAll('button')].find(b=>b.innerText.includes('Skicka inbjudan'))`));
  await evaluate(`(()=>{const e=document.querySelector('#invite-id');if(!e)throw Error('invite input absent');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,'participant-b');e.dispatchEvent(new Event('input',{bubbles:true}))})()`);
  await click(`[...document.querySelectorAll('button')].find(b=>b.innerText.includes('Skicka inbjudan'))`);
  await wait(`document.body.innerText.includes('Workshop crew')`);
  await send('Network.setCookie',{name:'hackpartsess',value:decodeURIComponent(cookies['participant-b'].split('=')[1]),url:base,httpOnly:true},sid);
  await nav(`/team?eventId=${eventId}`);await wait(`!![...document.querySelectorAll('button')].find(b=>b.innerText.includes('Acceptera'))`);
  await click(`[...document.querySelectorAll('button')].find(b=>b.innerText.includes('Acceptera'))`);
  await wait(`document.body.innerText.includes('Workshop crew')&&document.body.innerText.includes('2 medlemmar')`);
  check('invited participant can accept from the served invitation controls',await evaluate(`document.body.innerText.includes('Lämna laget')`));
  await send('Network.setCookie',{name:'hackpartsess',value:decodeURIComponent(cookies['participant-c'].split('=')[1]),url:base,httpOnly:true},sid);
  await nav(`/team?eventId=${eventId}`);await wait(`document.body.innerText.includes('Inga öppna lag')`);
  check('full teams are excluded with a useful empty-state explanation and create action',await evaluate(`document.body.innerText.includes('Inga öppna lag')&&document.body.innerText.includes('Skapa ett lag eller kom tillbaka senare.')&&!![...document.querySelectorAll('button')].find(b=>b.innerText.includes('Skapa lag'))`));
  members.delete('participant-c');
  await nav(`/events/${eventId}/signup`);await wait(`document.body.innerText.includes('aktuell medlem')`);
  check('nonmember sees the membership explanation and no team allocation action',await evaluate(`document.body.innerText.includes('aktuell medlem')&&!document.querySelector('form')&&!document.body.innerText.includes('Visa lag')`));
  await nav('/team?eventId=missing-event');await wait(`!!document.querySelector('[role=alert]')`);
  check('team view provides a recovery action on unavailable event',await evaluate(`!!document.querySelector('[role=alert]')&&[...document.querySelectorAll('button')].some(b=>b.innerText.trim())`));
  await send('Emulation.setDeviceMetricsOverride',{width:1440,height:1000,deviceScaleFactor:1,mobile:false},sid);
  const desktop=await evaluate(`({width:innerWidth,scroll:document.documentElement.scrollWidth})`);
  check('desktop viewport is confirmed before layout assertions',desktop.width===1440&&desktop.scroll<=1440);
  await send('Network.setCookie',{name:'hackpartsess',value:decodeURIComponent(cookies['participant-a'].split('=')[1]),url:base,httpOnly:true},sid);
  await nav('/');await evaluate(`localStorage.setItem('chas-locale','en')`);await nav(`/events/${eventId}/signup`);await wait(`!!document.querySelector('textarea#idea')`);
  check('English locale also renders the participant signup labels',await evaluate(`document.documentElement.lang==='en'&&document.querySelector('label[for=idea]')?.innerText.includes('Your idea')`));
  await send('Network.setCookie',{name:'hacksess',value:decodeURIComponent(cookies.organizer.split('=')[1]),url:base,httpOnly:true},sid);
  await nav('/operations?tab=participants');await wait(`document.body.innerText.includes('Participants')`);
  const reassignment=await evaluate(`document.querySelector('[role=combobox][aria-label*="participant-a"]')?.getAttribute('aria-label')`);
  check('organizer sees the named keyboard-accessible team reassignment control',typeof reassignment==='string'&&reassignment.length>0);
  await evaluate(`document.querySelector('[role=combobox][aria-label*="participant-a"]').focus()`);
  const key=async(name,code)=>{await send('Input.dispatchKeyEvent',{type:'keyDown',key:name,code:name,windowsVirtualKeyCode:code},sid);await send('Input.dispatchKeyEvent',{type:'keyUp',key:name,code:name,windowsVirtualKeyCode:code},sid);await delay(100)};
  await key('Enter',13);await wait(`!!document.querySelector('[role=option]')`);await key('Home',36);await key('Enter',13);
  for(let i=0;i<40;i++){const row=await db.get('SELECT team_id FROM participants WHERE event_id=? AND user_id=?',eventId,'participant-a');if(row?.team_id===null)break;await delay(100)}
  check('keyboard can reassign a participant to no team', (await db.get('SELECT team_id FROM participants WHERE event_id=? AND user_id=?',eventId,'participant-a')).team_id===null);
  assert.deepEqual(exceptions,[]);
  console.log(`RESULT ${checks.length} participant browser assertions passed; uncaught exceptions: 0`);
} finally {
  browser?.close();if(server)await server.stop();if(db)await db.close();if(chrome.exitCode===null){try{process.kill(-chrome.pid,'SIGTERM')}catch{}await Promise.race([new Promise(r=>chrome.once('exit',r)),delay(3000)])}await rm(profile,{recursive:true,force:true,maxRetries:10,retryDelay:200});
}
