/**
 * Admin web server: Fastify + cookie-auth API routes + static React admin UI.
 * The UI is the production build of apps/admin-ui (Vite dist).
 */
import Fastify from 'fastify'
import fastifyStatic from '@fastify/static'
import { existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Db } from '../shared/db.js'
import type { Env } from '../shared/env.js'
import { registerRoutes, type WebDeps } from './routes.js'

export interface AdminServerHandle {
  stop: () => Promise<void>;
}

export async function startAdminServer(deps: {
  db: Db;
  config: Env;
  announce: (guildId: string, content: string) => Promise<void>;
  client: import('discord.js').Client | null;
}): Promise<AdminServerHandle> {
  const app = Fastify({ logger: false, bodyLimit: 1024 * 1024, requestTimeout: 30_000,
    trustProxy: deps.config.trustedProxies?.length ? deps.config.trustedProxies : false });
  app.addHook('onRequest', async (_req, reply) => {
    reply.header('X-Content-Type-Options', 'nosniff');
    reply.header('Referrer-Policy', 'no-referrer');
    reply.header('X-Frame-Options', 'DENY');
    reply.header('Content-Security-Policy', "frame-ancestors 'none'; object-src 'none'; base-uri 'self'; form-action 'self'");
  });
  app.setErrorHandler((error, req, reply) => {
    const failure = error as { statusCode?: number };
    const status = typeof failure.statusCode === 'number' && failure.statusCode >= 400 && failure.statusCode < 500 ? failure.statusCode : 500;
    // Do not log cookies, payloads, provider errors or database values.
    console.warn(JSON.stringify({ event: 'http.failure', requestId: req.id, status }));
    void reply.code(status).send({ error: status === 500 ? 'internal_error' : 'invalid_request', code: status === 500 ? 'internal_error' : 'invalid_request', requestId: req.id });
  });

  registerRoutes(app, deps as WebDeps);

  // Liveness endpoint for container orchestrators / uptime checks.
  app.get('/healthz', async () => ({ ok: true, ts: Date.now() }));

  // Built admin UI: apps/admin-ui/dist (three levels up from dist/adminweb).
  const here = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    process.env.ADMIN_UI_DIST ?? '',
    join(here, '..', '..', '..', 'admin-ui', 'dist'),
    join(here, '..', '..', 'admin-ui', 'dist'),
  ].filter((p) => p !== '');

  const uiDist = candidates.find((p) => existsSync(join(p, 'index.html')));

  if (uiDist === undefined) {
    console.warn('Admin UI build not found — API-only mode. Run: pnpm build:admin');
  } else {
    await app.register(fastifyStatic, { root: uiDist, wildcard: false });
    // SPA fallback: everything not under /api serves the app shell.
    app.setNotFoundHandler(async (req, reply) => {
      if (req.url.startsWith('/api/')) {
        await reply.code(404).send({ error: 'not_found' });
        return;
      }
      await reply.type('text/html; charset=utf-8').sendFile('index.html');
    });
  }

  await app.listen({ port: deps.config.adminPort, host: '0.0.0.0' });
  console.log(`Admin UI: http://localhost:${deps.config.adminPort}`);

  return {
    stop: async () => {
      await app.close();
    },
  };
}
