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
}): Promise<AdminServerHandle> {
  const app = Fastify({ logger: false });

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
