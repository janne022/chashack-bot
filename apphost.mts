// chashack-bot AppHost — local development stack (Aspire 13.5.4, TypeScript).
//
// One command from a fresh clone: `pnpm dev` (root). It runs
// `aspire restore` FIRST — `.aspire/` is gitignored and holds the typed
// bindings this file imports; `tsc` and `aspire start` both fail on a fresh
// clone until restore has run.
//
// INVARIANT: every `aspire` invocation here goes through the root `aspire`
// pnpm script, which sets DOTNET_SYSTEM_GLOBALIZATION_INVARIANT=0. This VM
// exports =1 globally and the dashboard crashes under it
// (TypeInitializationException, OTLP DEADLINE_EXCEEDED). Do not call `aspire`
// directly in shell sessions without the override.
import { createBuilder } from './.aspire/modules/aspire.mjs';

const builder = await createBuilder();

// ── Secrets ──────────────────────────────────────────────────────────────────
// The bot fails fast when ADMIN_PASSWORD is unset (even with SKIP_DISCORD=1),
// so the AppHost always injects it. Local dev default: "admin". Export
// ADMIN_PASSWORD in the environment to override; never put a real value here —
// Aspire only runs the local stack (docker-compose stays the deploy path).
const adminPassword = builder.addParameter('admin-password', {
    value: process.env.ADMIN_PASSWORD ?? 'admin',
    secret: true,
});

// ── Data ─────────────────────────────────────────────────────────────────────
const postgres = await builder
    .addPostgres('postgres')
    .withDataVolume({ name: 'chashack-pgdata' })
    // Web DB UI (pgWeb) — shows up in the dashboard for ad-hoc queries.
    .withPgWeb()
    // Declare the database on the CONTAINER, not only via addDatabase below:
    // in run mode Aspire creates `chashack` itself, but a published compose
    // only carries the server environment, and without POSTGRES_DB the
    // container initialises a database named after the user instead.
    .withEnvironment('POSTGRES_DB', 'chashack');

// Reference the DATABASE (not the server) so dependents get a connection
// string scoped to `chashack`. NOTE the form: Aspire injects an ADO.NET-style
// connection string (Host=...;Port=...;Username=...;Password=...;Database=...),
// NOT a postgresql:// URL — anything consuming it must not assume a URL.
const db = await postgres.addDatabase('chashack', {
    databaseName: 'chashack',
});

const cache = await builder
    .addRedis('cache')
    .withDataVolume({ name: 'chashack-redisdata' })
    // Redis Insight web UI in the dashboard. Wiring only — no service reads
    // Redis yet (caching is a later workstream); this just injects REDIS_URL.
    .withRedisInsight();

// ── Bot API (apps/bot) ───────────────────────────────────────────────────────
// Node app compiled by tsc to dist/ — run the workspace `pnpm build` before
// `pnpm dev` on a fresh clone (docs/DEV.md documents the exact order).
// .withPnpm() is explicit: package-manager detection looks for a lockfile in
// the app directory, but this workspace keeps ONE lockfile at the root —
// without this Aspire falls back to npm and fails. The same applies to the
// Vite app below.
const botApi = await builder
    .addNodeApp('bot-api', './apps/bot', 'dist/index.js')
    .withPnpm()
    .withReference(db)
    // The bot's data layer is SQLite today; a later workstream moves it to
    // Postgres. DATABASE_URL is injected here so that workstream only has to
    // start reading it. Remember: ADO.NET-style string, not a URL (see above).
    .withEnvironment('DATABASE_URL', db)
    .withReference(cache)
    .withEnvironment('REDIS_URL', cache)
    // Local runs start the admin web server without the Discord gateway;
    // export DISCORD_TOKEN/DISCORD_CLIENT_ID and remove this line to point
    // the stack at real Discord (see docs/DEV.md).
    .withEnvironment('SKIP_DISCORD', '1')
    .withEnvironment('ADMIN_PASSWORD', adminPassword)
    // The process listens on ADMIN_PORT (injected as the endpoint's
    // targetPort) on 0.0.0.0; the host port is pinned to 8420 to match the
    // admin-ui dev proxy (`/api` → http://localhost:8420 in vite.config.ts).
    .withEndpoint({ name: 'http', scheme: 'http', port: 8420, targetPort: 8420, env: 'ADMIN_PORT' })
    .withHttpHealthCheck({ path: '/healthz' })
    .waitFor(db);

// ── Admin console (apps/admin-ui) ────────────────────────────────────────────
const adminUi = await builder
    .addViteApp('admin-ui', './apps/admin-ui')
    .withPnpm()
    .withReference(botApi)
    .withEnvironment('API_URL', botApi.getEndpoint('http'));

// TODO(ws4): participant app. When apps/web exists, declare it here, mirroring
// the admin-ui block (addViteApp + .withPnpm(), reference the bot API):
//   const web = await builder.addViteApp('web', './apps/web').withPnpm()
//       .withReference(botApi).withEnvironment('API_URL', botApi.getEndpoint('http'));
// apps/web does not exist yet, so nothing is declared — the workspace glob
// apps/* would pick the directory up automatically, but Aspire needs the
// explicit resource.

await builder.build().run();
