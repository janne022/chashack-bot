import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { Db } from '../shared/db.js';
import { subscribeChanges, type ChangeHint } from '../shared/live-changes.js';

export type LiveAccess = { sessionId: string; scope: string; accepts: (hint: ChangeHint) => Promise<boolean> };
const streams = new Map<string, number>();
let total = 0;

/** Same-origin cookie streams carry no identifiers or snapshots to the browser. */
export function registerLiveRoute(app: FastifyInstance, db: Db, path: string,
  authorize: (req: FastifyRequest) => Promise<LiveAccess | null>, heartbeatMs = 10_000): void {
  const closing = new Set<() => void>();
  app.addHook('preClose', async () => { for (const close of closing) close(); });
  app.get(path, async (req: FastifyRequest, reply: FastifyReply) => {
    const origin = req.headers.origin;
    const expected = `${req.protocol}://${req.headers.host}`;
    if ((origin !== undefined && origin !== expected) || (req.headers['sec-fetch-site'] !== undefined && req.headers['sec-fetch-site'] !== 'same-origin')) {
      return reply.code(403).send({ error: 'origin_refused' });
    }
    const boundedAccess = async () => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        return await Promise.race([authorize(req), new Promise<null>(resolve => { timer = setTimeout(() => resolve(null), 8000); })]);
      } finally { clearTimeout(timer); }
    };
    const initial = await boundedAccess();
    if (!initial) return reply.code(403).send({ error: 'access_refused' });
    if ((req.query as { probe?: string }).probe === '1') return reply.code(204).send();
    const key = initial.sessionId;
    if ((streams.get(key) ?? 0) >= 2 || total >= 1000) return reply.header('Retry-After', '30').code(429).send({ error: 'stream_limit' });
    streams.set(key, (streams.get(key) ?? 0) + 1); total++;
    let stopped = false;
    let unsubscribe: (() => void) | undefined;
    let heartbeat: ReturnType<typeof setInterval> | undefined;
    let busy = false;
    let ready = false;
    const pending: ChangeHint[] = [];
    const close = (terminal = false) => {
      if (stopped) return;
      stopped = true;
      clearInterval(heartbeat);
      unsubscribe?.();
      req.raw.socket.removeListener('close', close);
      closing.delete(close);
      streams.set(key, (streams.get(key) ?? 1) - 1);
      if (streams.get(key) === 0) streams.delete(key);
      total--;
      if (terminal && !reply.raw.destroyed) reply.raw.write('event: denied\ndata: {}\n\n');
      reply.raw.end();
    };
    const write = (event: string) => {
      if (!stopped && !reply.raw.write(`event: ${event}\ndata: {}\n\n`)) close();
    };
    // Bounded memory: collapse bursts while a fresh authority check is in flight.
    const check = async (hint?: ChangeHint) => {
      if (stopped) return;
      if (hint) {
        if (pending.length >= 64) { close(); return; }
        pending.push(hint);
      }
      if (busy || !ready) return;
      busy = true;
      try {
        do {
          const batch = pending.splice(0);
          const access = await boundedAccess();
          if (stopped) return;
          if (!access || access.sessionId !== key || access.scope !== initial.scope) { close(true); return; }
          let relevant = false;
          for (const value of batch) if (await access.accepts(value)) { relevant = true; break; }
          if (stopped) return;
          if (relevant) write('dirty');
          else if (batch.length === 0) write('heartbeat');
        } while (pending.length && !stopped);
      } catch { close(); }
      finally { busy = false; }
    };
    req.raw.socket.once('close', close);
    reply.raw.once('close', close);
    closing.add(close);
    try {
      unsubscribe = await subscribeChanges(db, hint => { void check(hint); }, () => close());
      if (stopped) { unsubscribe(); return; }
      reply.hijack();
      reply.raw.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
      ready = true;
      write('ready');
      if (pending.length) void check();
      heartbeat = setInterval(() => { void check(); }, heartbeatMs);
      heartbeat.unref();
    } catch {
      close();
    }
  });
}
