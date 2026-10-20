# Local development with Aspire

PostgreSQL is the only application database. Runtime requires DATABASE_URL for a
restricted app role plus MIGRATION_DATABASE_URL for a separate DDL role on the same
database; see [RLS roles and grants](POSTGRES-RLS.md). Missing,
empty or malformed values refuse startup without exposing credentials. Supply a
postgresql:// URL or the unquoted Aspire shape
`Host=localhost;Port=5432;Database=chashack_test;Username=postgres;Password=...`.
Unknown/duplicate ADO fields refuse. Supported URL options: sslmode (disable,
require, verify-ca, verify-full), application_name, options, connect_timeout
(1–600 seconds). Enabled TLS modes verify certificates. Percent-encode passwords
where necessary; never print a live URL.

PostgreSQL is the only application database. One command brings up the stack:
PostgreSQL (+ pgWeb), Redis (+ Insight), the bot API and admin console.

## Fresh clone

```sh
pnpm install --frozen-lockfile
pnpm build
pnpm dev
pnpm aspire describe --format Json
pnpm dev:stop
```

`pnpm dev` restores the generated `.aspire/` bindings, starts Aspire, and lists
resources. `pnpm aspire <args>` sets `DOTNET_SYSTEM_GLOBALIZATION_INVARIANT=0`;
use it for all Aspire commands because the VM-wide value `1` crashes the
Dashboard. `pnpm smoke:apphost` also verifies `/healthz` responds successfully.

## Resources

- `postgres` — PostgreSQL with database `chashack` by default and pgWeb.
- `cache` — Redis and Redis Insight; wiring only, no production cache consumer.
- `bot-api` — `node dist/index.js`, with separate `DATABASE_URL` (restricted
  `chashack_app` role), `MIGRATION_DATABASE_URL` (DDL `chashack_migrate` role),
  an Aspire-persisted `ADMIN_SESSION_SECRET`, `SKIP_DISCORD=1`, and `ADMIN_PORT`
  set to the configured API port (8420 by default); `/healthz` is the health
  check. Set `DISCORD_GUILD_ID` for guild-scoped event creation; a fake snowflake
  is sufficient for isolated local checks without Discord.
- `admin-ui` — Vite console, connected to the bot API.

The bot does not consume Aspire's administrator database reference. AppHost
constructs role-specific `postgresql://` URLs for the same database and creates
both roles with `postgres-init/10-roles.sh` only when the PostgreSQL data volume
is empty. It persists three independent generated secrets (app role, migration
role, admin session) in Aspire's local secret store across restarts. The app role
has DML grants but no ownership, DDL, elevated membership, or BYPASSRLS.

Existing data volumes **do not rerun init scripts**. If a volume predates role
provisioning, stop the stack and arrange explicit, reviewed role/grant setup per
[POSTGRES-RLS.md](POSTGRES-RLS.md); do not delete or reset data to make startup
pass. Production role provisioning remains an operator responsibility.

The AppHost uses named data volumes. `pnpm dev:stop` stops resources but preserves
data. Never remove volumes unless you have positively identified them as your
own disposable test resources. For isolated tests, set
`APPHOST_VOLUME_PREFIX=<unique-name-containing-test-or-ci>` and
`APPHOST_DATABASE_NAME=<database_name_ending_in_test_or_ci>` before starting;
underscores in the database name map to hyphens in Aspire's resource name.
Do not use a real Discord account or production database for local checks.

## PostgreSQL checks

Use a disposable PostgreSQL 16 database whose name ends in `_test` or `_ci`.
Fixtures validate the configured and connected database names before creating
isolated schemas; cleanup removes only those fixture schemas.

```sh
pnpm install --frozen-lockfile
pnpm typecheck
pnpm build
pnpm test
node apps/bot/scripts/smoke-admin.mjs
```

Tests execute compiled `dist` files. Clear generated `apps/bot/dist` before
building if stale emitted tests may exist. The feature suite covers PostgreSQL
schema/bootstrap and application features. Do not use production URLs or real
personal data. No automatic import or deletion of legacy database files occurs.

## Troubleshooting

`node --test apps/bot/dist/shared/fixture-recovery.test.js` copies only explicitly
marked fake fixture rows between isolated PostgreSQL schemas. The destination must
be empty. All ten tables copy in dependency order within one transaction; IDs,
relationships and generated sequences survive. This is a test helper, not a
production import tool. Do not mark a real database fake or use production URLs.

No automatic import, conversion or deletion of legacy user files is performed.
Historical file-based migration tests are obsolete, not a supported second engine.
RLS is exercised separately with non-owner/non-superuser/NOBYPASSRLS fixture roles
in `shared/postgres-rls.test.ts` and real-handler `adminweb/routes-rls.test.ts`.
The fixture administrator URL is used only to create/drop isolated schemas and
ephemeral roles; superuser-only feature tests/smoke are not RLS evidence.
Production role provisioning/deployment and backup retention remain operational work.

## CI coverage

The existing verify job runs frozen install, typecheck, build, the PostgreSQL-only
suite and API smoke against its disposable PostgreSQL 16 service (chashack_ci),
then existing adoption/generic gates. No production secrets or persistent volume.
Local results are advisory; exact-head CI and the original independent reviewer
must approve the changed flow. Final workflow merge consent remains operator-owned.

- `Cannot find module './.aspire/modules/aspire.mjs'`: run `pnpm dev` or
  `pnpm aspire:restore` first.
- Dashboard crashes / OTLP `DEADLINE_EXCEEDED`: use `pnpm aspire …` so invariant
  globalization is disabled for Aspire.
- `Could not invoke 'addX': Method not found`: align Aspire CLI and
  `Aspire.Hosting.*` versions (currently 13.5.4).
- Bot API defaults to port 8420. If occupied, choose an available local port with
  `APPHOST_API_PORT=<port>`; do not kill another listener to free it.
- `pnpm typecheck && pnpm build && pnpm test` are the root regression checks;
  `pnpm smoke:apphost` exercises the real AppHost startup and health endpoint.
