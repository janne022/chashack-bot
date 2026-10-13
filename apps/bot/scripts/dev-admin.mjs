#!/usr/bin/env node
/** Empty disposable PostgreSQL console for manual development after build. */
process.env.RUN_DRY = '1';
process.env.ADMIN_PORT = '8491';
process.env.ADMIN_SESSION_SECRET = 'synthetic-dev-session-secret-at-least-32';
const { startAdminServer } = await import('../dist/adminweb/server.js');
const { openTestDb } = await import('../dist/shared/test-db.js');
const { env } = await import('../dist/shared/env.js');
const db = await openTestDb();
try {
  const server = await startAdminServer({ db, config: env(), announce: async () => {}, client: null });
  const stop = async () => { await server.stop(); await db.close(); };
  process.once('SIGINT', () => void stop());
  process.once('SIGTERM', () => void stop());
} catch (error) { await db.close(); throw error; }
