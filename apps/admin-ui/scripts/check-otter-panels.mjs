// Synthetic API data, real production-built application. No OAuth or database claim.
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createServer } from 'node:http'
import { existsSync, readFileSync, readdirSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { resolve, join, extname, sep } from 'node:path'
import { DEFAULT_FORM } from '../src/lib/default-form.ts'

const dist = resolve(import.meta.dirname, '../dist')
const en = JSON.parse(readFileSync(resolve(import.meta.dirname, '../src/lib/i18n/en.json')))
const text = key => {
  assert.equal(typeof en[key], 'string', `catalog key ${key}`)
  return en[key]
}
const ids = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2']
const names = readdirSync(join(dist, 'assets'))
const images = Object.fromEntries(ids.map(id => [id, names.find(n => n.startsWith(`${id}-`) && n.endsWith('.webp'))]))
for (const id of ids) assert.ok(images[id], `missing built asset ${id}`)
const state = {
  participants: [], teams: [], config: DEFAULT_FORM, audit: [], lastMatch: null,
  guildSettings: { modRoleIds: [] }, guildConfigured: true, guildId: 'fixture',
  events: [], templates: [], activeEventId: null, selectedEventId: null, activeEventIds: [],
  stats: { active: 0, total: 0, teams: 0, matchingOptIn: 0 },
}
const broken = new Set(), delivered = new Set(), runtimeErrors = []
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.webp': 'image/webp', '.png': 'image/png', '.woff2': 'font/woff2' }
const server = createServer((req, res) => {
  try {
    const path = decodeURIComponent(new URL(req.url, 'http://localhost').pathname)
    res.setHeader('cache-control', 'no-store')
    if (path.startsWith('/api/')) {
      let data
      if (path === '/api/state') data = state
      else if (path === '/api/auth/me') data = {
        kind: 'discord', audience: 'organizer', user: { id: 'fixture', username: 'Synthetic organizer', avatar: null },
        guild: { id: 'fixture', name: 'Synthetic guild' }, guilds: [{ id: 'fixture', name: 'Synthetic guild', icon: null }],
      }
      else if (path === '/api/guild/channels') data = { channels: [], categories: [], roles: [] }
      else { res.writeHead(404).end(); return }
      res.setHeader('content-type', 'application/json')
      res.end(JSON.stringify(data)); return
    }
    if (broken.has(path)) { res.writeHead(404).end(); return }
    const file = extname(path) ? resolve(dist, `.${path}`) : join(dist, 'index.html')
    if (!file.startsWith(dist + sep) || !existsSync(file)) { res.writeHead(404).end(); return }
    if (extname(file) === '.webp') delivered.add(path)
    res.setHeader('content-type', mime[extname(file)] ?? 'application/octet-stream') // g0:allow:secrets t_98a0312d public MIME type
    res.end(readFileSync(file))
  } catch { res.writeHead(400).end() }
})
await new Promise(r => server.listen(0, '127.0.0.1', r))
const base = `http://127.0.0.1:${server.address().port}`
const profile = mkdtempSync(join(tmpdir(), 'otter-browser-'))
const chrome = process.env.CHROME_BIN ?? join(homedir(), '.cache', 'ms-playwright', 'chromium-1208', 'chrome-linux64', 'chrome')
const browser = spawn(chrome, ['--headless=new', '--no-sandbox', '--disable-gpu', '--remote-debugging-port=0', `--user-data-dir=${profile}`, 'about:blank'], { stdio: 'ignore' }) // g0:allow:secrets t_98a0312d public Chromium options
let ws
async function waitFor(fn, label) {
  const end = Date.now() + 15000
  while (Date.now() < end) {
    const value = await fn()
    if (value) return value
    await new Promise(r => setTimeout(r, 50))
  }
  throw new Error(`Timed out: ${label}; runtime errors: ${JSON.stringify(runtimeErrors)}`)
}
try {
  browser.on('error', e => runtimeErrors.push(e.message))
  const portFile = join(profile, 'DevToolsActivePort')
  await waitFor(() => existsSync(portFile), 'owned Chromium startup')
  const debugPort = readFileSync(portFile, 'utf8').split('\n')[0]
  const targets = await (await fetch(`http://127.0.0.1:${debugPort}/json/list`)).json()
  ws = new WebSocket(targets.find(t => t.type === 'page').webSocketDebuggerUrl)
  await new Promise((r, j) => { ws.onopen = r; ws.onerror = j })
  let next = 0
  const pending = new Map()
  ws.onmessage = e => {
    const message = JSON.parse(e.data)
    if (message.method === 'Runtime.exceptionThrown') runtimeErrors.push(message.params.exceptionDetails.text)
    const entry = pending.get(message.id)
    if (entry) {
      pending.delete(message.id); clearTimeout(entry.timer)
      if (message.error) entry.reject(new Error(JSON.stringify(message.error)))
      else entry.resolve(message.result)
    }
  }
  const call = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++next
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`CDP timeout: ${method}`)) }, 15000)
    pending.set(id, { resolve, reject, timer }); ws.send(JSON.stringify({ id, method, params }))
  })
  const evaluate = async expression => {
    const result = await call('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
    assert.equal(result.exceptionDetails, undefined, JSON.stringify(result.exceptionDetails))
    return result.result.value
  }
  await call('Runtime.enable')
  await call('Page.enable')
  await call('Accessibility.enable')
  await call('Page.addScriptToEvaluateOnNewDocument', { source: "localStorage.setItem('chas-locale','en'); localStorage.setItem('chas-theme','light')" })
  await call('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] })
  const load = async route => {
    await call('Page.navigate', { url: base + route })
    await waitFor(() => evaluate('!!document.querySelector("main h1")'), `real app ${route}`)
    await waitFor(() => evaluate('Number(getComputedStyle(document.querySelector("main > div")).opacity) > 0.99'), 'page entrance complete')
  }
  const panel = async id => {
    const selector = `main img[src$="${images[id]}"]`
    await waitFor(() => evaluate(`(() => { const i=document.querySelector(${JSON.stringify(selector)}); return i?.complete && i.naturalWidth>0 })()`), `real panel ${id}`)
    const geometry = await evaluate(`(() => { const i=document.querySelector(${JSON.stringify(selector)}), r=i.getBoundingClientRect(); return {alt:i.alt,hidden:i.getAttribute('aria-hidden'),x:r.x,right:r.right,width:r.width,height:r.height,viewport:innerWidth} })()`)
    assert.equal(geometry.alt, ''); assert.equal(geometry.hidden, 'true')
    assert.ok(geometry.width > 0 && geometry.width <= 160 && geometry.height > 0)
    assert.ok(geometry.x >= 0 && geometry.right <= geometry.viewport + 1, `${id}: ${JSON.stringify(geometry)}`)
    const tree = await call('Accessibility.getFullAXTree')
    const action = { A1: text('events.new'), B1: text('common.clear'), A2: 'New event template', B2: 'New form template', C1: 'New announcement', C2: 'New collection' }[id]
    assert.ok(tree.nodes.some(n => !n.ignored && n.role?.value === 'button' && n.name?.value === action), `actual ${id} action in AX tree`)
    assert.ok(!tree.nodes.some(n => !n.ignored && n.role?.value === 'image' && n.name?.value?.includes(id)), 'otter is decorative in AX tree')
  }
  const clickText = async label => {
    const point = await evaluate(`(() => { const b=[...document.querySelectorAll('button')].find(b=>b.textContent.trim()===${JSON.stringify(label)}); if(!b)return null; b.scrollIntoView({block:'center',inline:'center'}); const r=b.getBoundingClientRect(); return {x:r.x+r.width/2,y:r.y+r.height/2} })()`)
    assert.ok(point, `actual button: ${label}`)
    await call('Input.dispatchMouseEvent', { type: 'mousePressed', button: 'left', clickCount: 1, ...point })
    await call('Input.dispatchMouseEvent', { type: 'mouseReleased', button: 'left', clickCount: 1, ...point })
  }
  const create = async () => {
    // Click the action adjacent to the real empty-state heading, not a fixture button.
    await evaluate(`document.querySelector('main h3').parentElement.querySelector('button').click()`)
    await waitFor(() => evaluate(`document.body.textContent.includes(${JSON.stringify(text('events.chooser_title'))})`), 'real create chooser')
    await clickText(text('events.new_event') + text('events.new_event_hint'))
    await waitFor(() => evaluate('!!document.querySelector("textarea")'), 'real event creation form')
  }
  for (const [width, height] of [[1440, 1000], [390, 844]]) {
    await call('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: width < 500 })
    state.events = []; broken.clear()
    await load('/events'); await panel('A1')
    if (process.env.OTTER_PROOF_DIR) {
      mkdirSync(process.env.OTTER_PROOF_DIR, { recursive: true })
      const shot = await call('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false })
      writeFileSync(join(process.env.OTTER_PROOF_DIR, `events-${width}.png`), Buffer.from(shot.data, 'base64'))
    }
    await create()
    state.events = [{ id: 'fixture', name: 'Synthetic existing event', description: '', status: 'draft', createdAt: 1, startsAt: null, endsAt: null, schedule: [], announcements: [], assignments: [] }]
    await load('/events')
    await evaluate(`(() => { const i=document.querySelector('main input'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(i,'no match'); i.dispatchEvent(new Event('input',{bubbles:true})) })()`)
    await panel('B1')
    await clickText(text('common.clear'))
    await waitFor(() => evaluate(`!document.querySelector('main img[src$="${images.B1}"]') && document.querySelector('main input').value===''`), 'real clear-search action')
    await load('/templates'); await panel('A2')
    for (const [id, label] of [['B2', 'Form templates (0)'], ['C1', 'Announcements (0)'], ['C2', 'Assignment collections (0)']]) {
      await clickText(label); await panel(id)
    }
    state.events = []; broken.add(`/assets/${images.A1}`)
    await load('/events')
    await waitFor(() => evaluate(`!document.querySelector('main img[src$="${images.A1}"]')`), 'actual image error handler')
    assert.equal(await evaluate(`document.querySelector('main h3').textContent`), text('events.none_title'))
    await create()
    assert.equal(runtimeErrors.length, 0, JSON.stringify(runtimeErrors))
    console.log(`PASS ${width}px: real six contexts, decorative DOM/AX, image geometry, create/clear, actual 404 fallback`)
  }
  for (const id of ids) assert.ok(delivered.has(`/assets/${images[id]}`), `real browser HTTP200: ${id}`)
  console.log('PASS: six built assets served HTTP200; synthetic API only, real compiled app; no database or OAuth login')
} finally {
  ws?.close()
  if (browser.exitCode === null) {
    const exited = new Promise(r => browser.once('exit', r))
    browser.kill(); await exited
  }
  await new Promise(r => server.close(r))
  rmSync(profile, { recursive: true, force: true })
}
