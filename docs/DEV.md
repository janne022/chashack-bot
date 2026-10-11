# Database development and fake recovery

SQLite remains the default when DATABASE_URL is absent. DATABASE_URL presence,
including an empty value, chooses PostgreSQL validation; errors never select
SQLite. Supply either a postgresql:// URL or the unquoted Aspire shape
`Host=localhost;Port=5432;Database=chashack_test;Username=postgres;Password=...`.
ADO fields are deliberately bounded; unknown/duplicate fields refuse rather
than silently disabling a security option. URL options supported: sslmode
(disable, require, verify-ca, verify-full), application_name, options, and
connect_timeout (1–600 seconds). All enabled TLS modes verify the certificate;
allow/prefer and arbitrary parameters refuse rather than downgrade security.
Passwords must be URL-percent-encoded where necessary. Never print a live URL.

## Repeatable local checks

Build before testing, because tests execute dist. Use a disposable PostgreSQL 16
instance bound to localhost and an explicitly fake database ending exactly in
_test or _ci. The fixture guard rejects other names before connecting; each handle
creates an isolated schema and drops it when closed. The bot itself can open
normal database names; the restriction applies to fixture/recovery destinations.

```sh
pnpm install --frozen-lockfile
pnpm typecheck
pnpm build
# DATABASE_URL must be absent for the SQLite run:
env -u DATABASE_URL pnpm test
env -u DATABASE_URL node apps/bot/scripts/smoke-admin.mjs
# Export a disposable DATABASE_URL in your shell, never commit it:
pnpm test
node apps/bot/scripts/smoke-admin.mjs
```

Shared feature, Fastify two-guild isolation, audit, session, transaction, Kysely,
and API-smoke tests exercise the selected engine. Legacy SQLite migration tests
stay SQLite-specific. PostgreSQL bootstrap compares column metadata across two
runs and checks foreign keys. Integer timestamps remain safe JS numbers; unsafe
BIGINT results fail explicitly. Nested facade transactions use savepoints on one
leased connection; independent operations queue outside the transaction.

## Fake SQLite → PostgreSQL rehearsal

Run `node --test apps/bot/dist/shared/fixture-recovery.test.js` first without
DATABASE_URL and then with the guarded disposable PostgreSQL destination. The
runnable fixture seeds invented guilds/events and audit IDs in an in-memory
SQLite source, explicitly marks it `meta.fake_fixture=true`, imports through
`recoverFakeFixture(source, await openTestDb())`, verifies both guilds and the
next generated ID, and refuses a nonempty target. All table copies are one
transaction in foreign-key dependency order; explicit IDs and sequences survive.
A failed import rolls back, and fixture teardown drops its isolated schema.

This is not a production migration command. Do not mark a real database fake,
point recovery at production, or claim this proves recovery of historical legacy
schemas. Snapshot an old SQLite file before any separately approved migration;
legacy ambiguous forms require the existing explicit tenant-recovery decision.
PostgreSQL startup performs additive bootstrap, not SQLite import or data reset.

## CI approval boundary

The existing workflow is untouched. Local PostgreSQL results are advisory only.
A PostgreSQL service/matrix job and exact-head evidence still require attended
workflow approval; this card must not finish until that requirement and its
same-card independent review are satisfied.
