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
import { createBuilder, EndpointProperty, refExpr } from './.aspire/modules/aspire.mjs';

const builder = await createBuilder();

// Persist generated secrets alongside Aspire's PostgreSQL administrator secret:
// a named data volume survives restarts, so its role passwords must survive too.
const passwordShape = { minLength: 48, lower: true, numeric: true, upper: false, special: false };
const appPassword = await builder.addParameterWithGeneratedValue('app-role-password', passwordShape, { secret: true, persist: true });
const migrationPassword = await builder.addParameterWithGeneratedValue('migration-role-password', passwordShape, { secret: true, persist: true });
const sessionSecret = await builder.addParameterWithGeneratedValue('admin-session-secret', passwordShape, { secret: true, persist: true });

// ── Data ─────────────────────────────────────────────────────────────────────
const volumePrefix = process.env.APPHOST_VOLUME_PREFIX ?? 'chashack';
const apiPort = Number(process.env.APPHOST_API_PORT ?? '8420');
const databaseName = process.env.APPHOST_DATABASE_NAME ?? 'chashack';
const databaseResourceName = databaseName.replaceAll('_', '-');

const postgres = await builder
    .addPostgres('postgres')
    .withDataVolume({ name: `${volumePrefix}-pgdata` })
    .withInitFiles('./postgres-init')
    .withEnvironment('CHASHACK_APP_PASSWORD', appPassword)
    .withEnvironment('CHASHACK_MIGRATION_PASSWORD', migrationPassword)
    // Web DB UI (pgWeb) — shows up in the dashboard for ad-hoc queries.
    .withPgWeb()
    // Declare the database on the CONTAINER, not only via addDatabase below:
    // in run mode Aspire creates the requested database itself, but a published compose
    // only carries the server environment, and without POSTGRES_DB the
    // container initialises a database named after the user instead.
    .withEnvironment('POSTGRES_DB', databaseName);

// The bot needs two separate PostgreSQL roles on the same database. Aspire's
// default database reference uses the administrator and must never be the app URL.
const db = await postgres.addDatabase(databaseResourceName, { databaseName });
const postgresEndpoint = await postgres.getEndpoint('tcp');
const postgresHost = await postgresEndpoint.property(EndpointProperty.Host);
const postgresPort = await postgresEndpoint.property(EndpointProperty.Port);
const appUrl = refExpr`postgresql://chashack_app:${appPassword}@${postgresHost}:${postgresPort}/${databaseName}`;
const migrationUrl = refExpr`postgresql://chashack_migrate:${migrationPassword}@${postgresHost}:${postgresPort}/${databaseName}`;

const cache = await builder
    .addRedis('cache')
    .withDataVolume({ name: `${volumePrefix}-redisdata` })
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
    .withEnvironment('DATABASE_URL', appUrl)
    .withEnvironment('MIGRATION_DATABASE_URL', migrationUrl)
    .withReference(cache)
    .withEnvironment('REDIS_URL', cache)
    // Local runs start the admin web server without the Discord gateway;
    // export DISCORD_TOKEN/DISCORD_CLIENT_ID and remove this line to point
    // the stack at real Discord (see docs/DEV.md).
    .withEnvironment('SKIP_DISCORD', '1')
    .withEnvironment('DISCORD_GUILD_ID', process.env.DISCORD_GUILD_ID ?? '')
    .withEnvironment('ADMIN_SESSION_SECRET', sessionSecret)
    // This process binds its local endpoint directly; Aspire requires the
    // host and target ports to match when proxying is disabled.
    .withEndpoint({ name: 'http', scheme: 'http', port: apiPort, targetPort: apiPort, env: 'ADMIN_PORT', isProxied: false })
    .withHttpHealthCheck({ path: '/healthz' })
    .waitFor(db);

// ── Admin console (apps/admin-ui) ────────────────────────────────────────────
const adminUi = await builder
    .addViteApp('admin-ui', './apps/admin-ui')
    .withPnpm()
    .withReference(botApi)
    .withEnvironment('API_URL', botApi.getEndpoint('http'));

await builder.build().run();
