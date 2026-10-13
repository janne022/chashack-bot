# PostgreSQL development and fake recovery

PostgreSQL is the only application database. DATABASE_URL is required; missing,
empty or malformed values refuse startup without exposing credentials. Supply a
postgresql:// URL or the unquoted Aspire shape
`Host=localhost;Port=5432;Database=chashack_test;Username=postgres;Password=...`.
Unknown/duplicate ADO fields refuse. Supported URL options: sslmode (disable,
require, verify-ca, verify-full), application_name, options, connect_timeout
(1–600 seconds). Enabled TLS modes verify certificates. Percent-encode passwords
where necessary; never print a live URL.

## Repeatable local checks

Use a disposable PostgreSQL 16 instance bound to localhost, with a database name
ending exactly in _test or _ci. Export its DATABASE_URL before running checks.
Fixtures validate both the configured and connected database name before creating
isolated UUID schemas. Closing a handle removes its schema, including error cleanup.
Normal runtime databases need not have a test suffix; fixture destinations must.

```sh
pnpm install --frozen-lockfile
pnpm typecheck
pnpm build
pnpm test
node apps/bot/scripts/smoke-admin.mjs
node apps/bot/scripts/dev-admin.mjs # empty disposable console on :8491
```

Tests execute compiled dist files: after deleting source files, clear generated
apps/bot/dist before building so stale emitted tests cannot run. The feature suite
covers forms, registration, events, teams, matching, sessions, audit and guild
isolation on real PostgreSQL. Direct authoritative DDL lives in
`shared/postgres-schema.ts`; bootstrap is transactional, additive and idempotent.
Tests compare schema/constraints/data across repeated migrations and indexed-column
repair. BIGINT timestamps are safe JS numbers; unsafe integers refuse. Transactions
and Kysely leases share a per-handle queue, connection and nested savepoints;
expired contexts refuse operations.

## Fake PostgreSQL recovery rehearsal

`node --test apps/bot/dist/shared/fixture-recovery.test.js` copies only explicitly
marked fake fixture rows between isolated PostgreSQL schemas. The destination must
be empty. All ten tables copy in dependency order within one transaction; IDs,
relationships and generated sequences survive. This is a test helper, not a
production import tool. Do not mark a real database fake or use production URLs.

No automatic import, conversion or deletion of legacy user files is performed.
Historical file-based migration tests are obsolete, not a supported second engine.
RLS, deployment migration and backup retention guarantees are separate work.

## CI coverage

The existing verify job runs frozen install, typecheck, build, the PostgreSQL-only
suite and API smoke against its disposable PostgreSQL 16 service (chashack_ci),
then existing adoption/generic gates. No production secrets or persistent volume.
Local results are advisory; exact-head CI and the original independent reviewer
must approve the changed flow. Final workflow merge consent remains operator-owned.
