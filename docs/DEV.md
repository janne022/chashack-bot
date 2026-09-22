# Local development with Aspire

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

- `postgres` — PostgreSQL with database `chashack` and pgWeb.
- `cache` — Redis and Redis Insight; wiring only, no production cache consumer.
- `bot-api` — `node dist/index.js`, with `DATABASE_URL`, `SKIP_DISCORD=1`, and
  `ADMIN_PORT=8420`; `/healthz` is the health check.
- `admin-ui` — Vite console, connected to the bot API.

Aspire injects the PostgreSQL reference as an ADO.NET-style connection string,
not a `postgresql://` URL. PostgreSQL is the sole application database; a
missing/invalid `DATABASE_URL` fails startup without exposing credentials.

The AppHost uses named data volumes. `pnpm dev:stop` stops resources but preserves
data. Never remove volumes unless you have positively identified them as your
own disposable test resources. For isolated tests, set
`APPHOST_VOLUME_PREFIX=<unique-name-containing-test-or-ci>` before starting.
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

- `Cannot find module './.aspire/modules/aspire.mjs'`: run `pnpm dev` or
  `pnpm aspire:restore` first.
- Dashboard crashes / OTLP `DEADLINE_EXCEEDED`: use `pnpm aspire …` so invariant
  globalization is disabled for Aspire.
- `Could not invoke 'addX': Method not found`: align Aspire CLI and
  `Aspire.Hosting.*` versions (currently 13.5.4).
- Bot API port 8420 must be available; do not kill another listener to free it.
- `pnpm typecheck && pnpm build && pnpm test` are the root regression checks;
  `pnpm smoke:apphost` exercises the real AppHost startup and health endpoint.
