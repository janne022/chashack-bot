import assert from 'node:assert/strict';
import { test } from 'node:test';
import Fastify from 'fastify';
import { openTestDb } from '../shared/test-db.js';
import { registerLiveRoute } from './live.js';

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
test('served SSE is capped, same-origin, committed, revocable and cleans subscriptions', async () => {
  const db = await openTestDb();
  const app = Fastify();
  let allowed = true;
  registerLiveRoute(app, db, '/live', async () => allowed ? { sessionId: 'session', scope: 'guild/event', accepts: async h => h.guildId === 'guild' && h.eventId === 'event' } : null, 50);
  const base = await app.listen({ host: '127.0.0.1', port: 0 });
  const abort = new AbortController();
  try {
    assert.equal((await fetch(`${base}/live`, { headers: { Origin: 'https://foreign.example' } })).status, 403);
    const first = await fetch(`${base}/live`, { signal: abort.signal });
    assert.equal(first.headers.get('content-type'), 'text/event-stream');
    const second = await fetch(`${base}/live`, { signal: abort.signal });
    assert.equal((await fetch(`${base}/live`)).status, 429);
    const reader = first.body!.getReader();
    let text = new TextDecoder().decode((await reader.read()).value);
    assert.match(text, /event: ready/);
    await db.run("INSERT INTO events(id,guild_id,name,status,created_at,updated_at) VALUES ('event','guild','SECRET','active',1,1)");
    const until = Date.now() + 2000;
    while (!text.includes('event: dirty') && Date.now() < until) text += new TextDecoder().decode((await reader.read()).value);
    assert.match(text, /event: dirty/);
    assert.ok(!text.includes('SECRET') && !text.includes('guild'));
    allowed = false;
    while (!(await reader.read()).done) { /* heartbeat denies and ends */ }
    assert.equal((await fetch(`${base}/live`)).status, 403);
    await second.body!.cancel();
    allowed = true;
    await sleep(100);
    const again = await fetch(`${base}/live`, { signal: abort.signal });
    assert.equal(again.status, 200, 'caps released after disconnect/revocation');
    await again.body!.cancel();
    await sleep(100);
    assert.deepEqual(await db.all("SELECT pid FROM pg_stat_activity WHERE application_name LIKE 'chashack-live:%' AND application_name = 'chashack-live:' || current_schema()"), [], 'last disconnect releases the shared listener');
  } finally { abort.abort(); await app.close(); await db.close(); }
});

test('process stream ceiling applies across distinct sessions and shutdown releases every listener', async () => {
  const db = await openTestDb();
  const app = Fastify();
  registerLiveRoute(app, db, '/live/:id', async req => ({ sessionId: (req.params as { id: string }).id, scope: 'scope', accepts: async () => true }));
  const base = await app.listen({ host: '127.0.0.1', port: 0 });
  const abort = new AbortController();
  const held: Response[] = [];
  try {
    for (let start = 0; start < 1000; start += 50) {
      const responses = await Promise.all(Array.from({ length: 50 }, (_, offset) => fetch(`${base}/live/${start + offset}`, { signal: abort.signal })));
      assert.ok(responses.every(response => response.status === 200));
      held.push(...responses);
    }
    assert.equal(held.length, 1000);
    assert.equal((await fetch(`${base}/live/overflow`)).status, 429);
    await app.close();
    await sleep(100);
    assert.deepEqual(await db.all("SELECT pid FROM pg_stat_activity WHERE application_name = 'chashack-live:' || current_schema()"), []);
  } finally { abort.abort(); await app.close(); await db.close(); }
});
