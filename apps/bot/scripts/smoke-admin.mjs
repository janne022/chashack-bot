#!/usr/bin/env node
/**
 * Boots the admin server against an in-memory DB and exercises the API +
 * static UI end-to-end. Run after build: node scripts/smoke-admin.mjs
 */
process.env.RUN_DRY = '1';
process.env.ADMIN_PASSWORD = 'smoke-test-pass';
process.env.ADMIN_PORT = '8491';
process.env.ADMIN_SESSION_SECRET = 'smoke-secret';

const { startAdminServer } = await import('../dist/adminweb/server.js');
const { openDb } = await import('../dist/shared/db.js');
const { env } = await import('../dist/shared/env.js');

const db = openDb(':memory:');
const server = await startAdminServer({ db, config: env(), announce: async () => {} });

const base = 'http://localhost:8491';
const results = [];
const check = (name, cond, extra = '') => {
  results.push(`${cond ? 'PASS' : 'FAIL'} ${name}${extra !== '' ? ` — ${extra}` : ''}`);
  if (!cond) process.exitCode = 1;
};

// 1. SPA shell served
const indexRes = await fetch(base);
const indexHtml = await indexRes.text();
check('GET / serves the React shell', indexRes.status === 200 && indexHtml.includes('<div id="root">'));

// 1b. Health endpoint (container HEALTHCHECK target)
const healthRes = await fetch(`${base}/healthz`);
check('/healthz returns ok', healthRes.status === 200 && (await healthRes.json()).ok === true);

// 2. SPA fallback for client routes
const spaRes = await fetch(`${base}/participants`);
const spaHtml = await spaRes.text();
check('SPA fallback works', spaRes.status === 200 && spaHtml.includes('<div id="root">'));

// 3. API requires auth
const unauth = await fetch(`${base}/api/state`);
check('unauthenticated /api/state is 401', unauth.status === 401);

// 4. Wrong password rejected
const badLogin = await fetch(`${base}/api/login`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ password: 'wrong' }),
});
check('wrong password is 401', badLogin.status === 401);

// 5. Correct password sets session
const login = await fetch(`${base}/api/login`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ password: 'smoke-test-pass' }),
});
const cookie = login.headers.get('set-cookie')?.split(';')[0] ?? '';
check('login sets session cookie', login.status === 200 && cookie.startsWith('hacksess='));

// 6. State endpoint with session
const state = await fetch(`${base}/api/state`, { headers: { cookie } });
const stateBody = await state.json();
check(
  '/api/state returns full shape',
  state.status === 200 &&
    stateBody.participants !== undefined &&
    stateBody.teams !== undefined &&
    stateBody.config !== undefined &&
    stateBody.stats !== undefined &&
    stateBody.audit !== undefined,
);

// 7. Form update works + is validated
const formRes = await fetch(`${base}/api/form`, {
  method: 'POST',
  headers: { 'content-type': 'application/json', cookie },
  body: JSON.stringify({ title: 'ChasHack Signup', teamSize: 5 }),
});
const formBody = await formRes.json();
check('form update persists', formRes.status === 200 && formBody.config.title === 'ChasHack Signup' && formBody.config.teamSize === 5);

// 8. Match preview with no participants → friendly 400
const matchRes = await fetch(`${base}/api/match/preview`, { method: 'POST', headers: { cookie } });
check('match preview without participants is a friendly 400', matchRes.status === 400);

// 9. Audit trail recorded the actions
const auditRes = await fetch(`${base}/api/state`, { headers: { cookie } });
const auditBody = await auditRes.json();
const actions = auditBody.audit.map((a) => a.action);
check('audit log captured form update + login', actions.includes('form.update') && actions.includes('web.login'), actions.join(', '));

// 10. Session cookie tamper → 401
const tampered = await fetch(`${base}/api/state`, { headers: { cookie: 'hacksess=9999999999999.deadbeef' } });
check('tampered session cookie is 401', tampered.status === 401);

await server.stop();
db.close();
console.log(results.join('\n'));
