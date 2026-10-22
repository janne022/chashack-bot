#!/usr/bin/env node
/**
 * Browser-level OAuth entry/recovery checks against the built UI and a synthetic
 * PostgreSQL session. Does not perform or claim a real Discord OAuth login.
 */
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';

const port = 8492;
const base = `http://127.0.0.1:${port}`;
const {chromePath} = await import('./chrome-path.mjs');
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
    discordClientSecret: 'synthetic-client-secret', // g0:allow:secrets t_026e28f9 — synthetic OAuth test value only.
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

  // No cookie first: actual browser renders the OAuth entry UI.
  await nav(`${base}/`);
  const login = await evaluate(`JSON.stringify({title:document.title, text:document.body.innerText, link:[...document.querySelectorAll('a')].map(a=>({name:a.innerText.trim(),href:a.getAttribute('href')})), alerts:[...document.querySelectorAll('[role=alert]')].map(a=>a.innerText.trim()), lang:document.querySelector('button[aria-label]')?.getAttribute('aria-label')})`);
  const unauth = JSON.parse(login);
  const catalogs = await Promise.all(['en', 'sv'].map(async locale => JSON.parse(await readFile(new URL(`../../admin-ui/src/lib/i18n/${locale}.json`, import.meta.url), 'utf8'))));
  check('unauthenticated browser renders localized Discord OAuth entry', unauth.text.includes(catalogs[0]['login.with_discord']) && unauth.link.some(a => a.href === '/auth/discord') && !unauth.link.some(a => /password/i.test(a.name)), JSON.stringify(unauth));
  check('login DOM exposes accessible language control and informative permission hint', Boolean(unauth.lang) && /own a server|administrator|organizer role/i.test(unauth.text));
  check('English and Swedish login catalogs have identical login keys', JSON.stringify(Object.keys(catalogs[0]).filter(k => k.startsWith('login.')).sort()) === JSON.stringify(Object.keys(catalogs[1]).filter(k => k.startsWith('login.')).sort()));

  // Failed real OAuth callback without state must recover into a localized DOM notice.
  await nav(`${base}/auth/discord/callback?code=synthetic&state=forged`);
  await nav(`${base}/events?auth=bad_state`);
  const recovery = JSON.parse(await evaluate(`JSON.stringify({text:document.body.innerText, alerts:[...document.querySelectorAll('[role=alert]')].map(a=>a.innerText.trim()), link:[...document.querySelectorAll('a')].map(a=>a.getAttribute('href'))})`));
  check('OAuth failure recovery is present as an accessible alert with retry', recovery.alerts.length === 1 && /failed|try again/i.test(recovery.alerts[0]) && recovery.link.includes('/auth/discord'));

  await nav(`${base}/events?auth=no_guild`);
  const noGuild = JSON.parse(await evaluate(`JSON.stringify({alerts:[...document.querySelectorAll('[role=alert]')].map(a=>a.innerText.trim()),text:document.body.innerText})`));
  check('no-manageable-guild guidance is rendered accessibly', noGuild.alerts.length === 1 && /do not manage any server/i.test(noGuild.alerts[0]) && /invite the bot/i.test(noGuild.alerts[0]));

  // Synthetic cookie/rows represent an authorized session; no OAuth callback exchange occurs.
  await send('Network.setCookie', { name: 'hacksess', value: decodeURIComponent(cookie.slice('hacksess='.length)), url: base, httpOnly: true, sameSite: 'Strict' }, sid);
  await nav(`${base}/`);
  const localeButton = await evaluate(`(() => [...document.querySelectorAll('button')].find(b=>b.getAttribute('aria-label')?.startsWith('Switch language'))?.getBoundingClientRect().toJSON())()`);
  if (localeButton) {
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: localeButton.x + localeButton.width / 2, y: localeButton.y + localeButton.height / 2, button: 'left', clickCount: 1 }, sid);
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: localeButton.x + localeButton.width / 2, y: localeButton.y + localeButton.height / 2, button: 'left', clickCount: 1 }, sid);
  }
  const localized = await evaluate('document.documentElement.lang');
  check('browser language control changes rendered document language', localized === 'sv');
  const trigger = await evaluate(`(() => [...document.querySelectorAll('button')].find(b=>b.innerText.includes('Synthetic test guild 1'))?.getBoundingClientRect().toJSON())()`);
  check('successful guild picker is visible for a multi-guild session', Boolean(trigger));
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: trigger.x + trigger.width / 2, y: trigger.y + trigger.height / 2, button: 'left', clickCount: 1 }, sid);
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: trigger.x + trigger.width / 2, y: trigger.y + trigger.height / 2, button: 'left', clickCount: 1 }, sid);
  const picker = await evaluate(`JSON.stringify({options:[...document.querySelectorAll('[role=menuitem]')].map(e=>e.innerText.trim()),text:document.body.innerText})`);
  const pickerDom = JSON.parse(picker);
  check('guild picker exposes both manageable guilds in rendered DOM', pickerDom.options.includes('Synthetic test guild 1') && pickerDom.options.includes('Synthetic test guild 2'));
  const ax = await send('Accessibility.getFullAXTree', {}, sid);
  const axNames = ax.nodes.map(n => n.name?.value).filter(Boolean);
  check('browser accessibility tree exposes named guild picker options', ax.nodes.some(n => n.role?.value === 'menuitem' && n.name?.value === 'Synthetic test guild 2'));

  // Remove fresh authority for the selected guild. The request should fail closed and UI return to login.
  botGuilds.delete(guildIds[0]);
  const denied = await fetch(`${base}/api/state`, { headers: { cookie } });
  check('stale guild authority is refused by the live API', denied.status === 403 && (await denied.json()).code === 'access_refused');
  await nav(`${base}/`);
  const stale = JSON.parse(await evaluate(`JSON.stringify({alerts:[...document.querySelectorAll('[role=alert]')].map(a=>a.innerText.trim()),links:[...document.querySelectorAll('a')].map(a=>a.getAttribute('href'))})`));
  check('stale authority recovery presents accessible retry guidance', stale.alerts.some(text => /server access changed|serverbehörighet har ändrats/i.test(text)) && stale.links.includes('/auth/discord'));
  console.log(`INFO AX named nodes: ${axNames.slice(0, 20).join(' | ')}`);
  console.log(`RESULT ${checks.length} browser assertions passed`);
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
