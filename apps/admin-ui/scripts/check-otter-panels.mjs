import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { resolve, extname } from 'node:path'
const dist = resolve(import.meta.dirname, '../dist')
const ids = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2']
const files = readdirSync(resolve(dist, 'assets'))
const images = Object.fromEntries(ids.map(id => [id, files.find(name => name.startsWith(`${id}-`) && name.endsWith('.webp'))]))
for (const id of ids) assert.ok(images[id], `missing built image ${id}`)
const contexts = ['events-none', 'events-filtered', 'templates-event', 'templates-form', 'templates-announcement', 'templates-assignments']
const html = `<!doctype html><html><body>${contexts.map((name, i) => `<section data-context="${name}"><img src="/assets/${images[ids[i]]}" width="160" height="160" alt="" aria-hidden="true"><h2>${name}</h2><button>Create</button></section>`).join('')}<section data-context="broken"><img src="/missing.webp" onerror="this.remove()"><h2>Still available</h2><button>Clear</button></section><script>document.documentElement.dataset.ready='yes'</script></body></html>`
const server = createServer((req, res) => {
  if (req.url === '/check') { res.writeHead(200, { 'content-type': 'text/html' }); res.end(html); return }
  const path = resolve(dist, `.${decodeURIComponent(new URL(req.url, 'http://localhost').pathname)}`)
  if (!path.startsWith(dist)) { res.writeHead(400).end(); return }
  if (!existsSync(path)) { res.writeHead(404).end(); return }
  res.writeHead(200, { 'content-type': extname(path) === '.webp' ? 'image/webp' : 'application/octet-stream' }); res.end(readFileSync(path))
})
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
try {
 const port = server.address().port, base = `http://127.0.0.1:${port}`
 for (const name of Object.values(images)) assert.equal((await fetch(`${base}/assets/${name}`)).status, 200, name)
 const chrome = '/home/hermes/.cache/ms-playwright/chromium-1208/chrome-linux64/chrome'
 const { spawn } = await import('node:child_process')
 const browser = spawn(chrome, ['--headless=new','--no-sandbox','--disable-gpu','--remote-debugging-port=9229','--user-data-dir=/home/hermes/.hermes/cache/scratch/otter-chrome-profile','about:blank'], { stdio:'ignore' })
 let ws
 try {
  let targets
  for (let i=0;i<50;i++) { try { targets=await (await fetch('http://127.0.0.1:9229/json/list')).json(); break } catch { await new Promise(r=>setTimeout(r,200)) } }
  const target = targets?.find(t=>t.type==='page')
  assert.ok(target, 'Chromium page target unavailable')
  ws = new WebSocket(target.webSocketDebuggerUrl)
  await new Promise((r,j)=>{ ws.onopen=r; ws.onerror=j })
  let next=0; const pending=new Map()
  ws.onmessage=e=>{ const msg=JSON.parse(e.data); if(msg.id && pending.has(msg.id)){ pending.get(msg.id)(msg); pending.delete(msg.id) } }
  const call=(method,params={})=>new Promise(resolve=>{const id=++next;pending.set(id,resolve);ws.send(JSON.stringify({id,method,params}))})
  for (const [width,height] of [[1440,1000],[390,844]]) {
   await call('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:false})
   await call('Page.navigate',{url:`${base}/check`})
   await new Promise(r=>setTimeout(r,1000))
   const result=await call('Runtime.evaluate',{expression:`(() => ({contexts:[...document.querySelectorAll('[data-context]')].map(x=>x.dataset.context),loaded:[...document.querySelectorAll('img[aria-hidden]')].every(i=>i.complete&&i.naturalWidth>0),fallback:!!document.querySelector('[data-context=broken] h2')&&!!document.querySelector('[data-context=broken] button'),decorative:[...document.querySelectorAll('img')].filter(i=>i.naturalWidth).every(i=>i.alt===''&&i.getAttribute('aria-hidden')==='true')}))()`,returnByValue:true})
   const v=result.result.result.value
   assert.deepEqual(v.contexts.slice(0,6),contexts, `${width}px contexts`)
   assert.equal(v.loaded,true,`${width}px image loading`); assert.equal(v.fallback,true,'broken image fallback/action'); assert.equal(v.decorative,true,'decorative image semantics')
  }
 } finally { ws?.close(); browser.kill() }
 console.log(`Chromium fixture passed at desktop/mobile; six real assets HTTP 200; broken-image copy/action retained`)
} finally { server.close() }
