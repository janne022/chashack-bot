# PostgreSQL guild isolation (#19, #14)

PostgreSQL is the sole database. There is no SQLite runtime/parity branch.
This change is not a production migration or deployment receipt.

## Guarantee and limits

Tenant tables use ENABLE + FORCE ROW LEVEL SECURITY. Missing/empty
`app.guild_id` yields zero tenant rows and refuses tenant inserts. Unfiltered
SELECT/UPDATE/DELETE cannot reach another guild. WITH CHECK rejects a forged or
omitted guild and inconsistent event/team parents. NULL audit guilds are host
rows: invisible and immutable from every tenant, not a wildcard.

RLS protects against missing tenant predicates, not arbitrary SQL execution by
an attacker controlling the application role: a trusted application sets the
GUC. It does not replace live sessions, subject checks, Discord membership or
organizer authority. Never accept a guild/user context from a request payload.

The pg pool uses ordinary session connections, leased for each explicit facade
transaction. `set_config('app.guild_id', $1, true)` is parameterized and local to
that transaction. Every new facade transaction sets a guild or explicitly clears
it; COMMIT/ROLLBACK clears the local setting before connection reuse. Automatic
single-query transactions cover callers outside an explicit transaction. Nested
savepoints retain the original guild; switching contexts inside an existing
transaction is refused. Kysely leases use the same facade/client/context. There
is no external connection pooler. Per-handle queueing remains serial by design;
independent handles have independent leased clients.

## Trusted entry points and enumerated exceptions

- Organizer API: live signed session, selected guild (or switch target for the
  switch endpoint), existing fresh owner/admin/delegation check, then existing
  event/team locator checks. A callback-style Fastify hook binds subsequent
  lifecycle work to ALS; it does not return an event from an expired context.
- Participant event and team routes: live signed participant session; enumerate
  available installed guilds from the server-owned Discord cache, force a fresh
  membership lookup, discover the active event inside each permitted guild.
  Continue the actual request lifecycle in that guild. Missing inventory,
  revoked/foreign membership, unavailable Discord or draft event returns 404;
  missing/revoked session returns 401. User/guild IDs from payload/query never
  authorize anything. My hackathons runs subject queries separately inside
  every freshly authorized installed guild; it has no host bypass.
- Public JSON/initial HTML: enumerate the same trusted installed inventory,
  explicitly scope published-event/form projections. Draft/missing/uninstalled
  events return 404. Neither path queries registrations/private answers.
- Discord interactions: only the interaction's server-owned guild ID enters ALS;
  DMs retain no tenant context and cannot see tenant rows.
- Scheduler: iterate available installed guilds for event planning, end/remind,
  scheduled actions, cleanup and private-answer retention; execute each action
  in its event's guild. No all-tenant role or system-mode GUC is used.
- Gateway departure and resume reconciliation: scope the gateway guild or each
  installed available guild individually. Unknown/unavailable membership is
  never proof of departure.
- Restore replay: operator-supplied durable deletion identifiers (not an HTTP
  endpoint) are applied one guild at a time with ordinary RLS. Tombstones contain
  identifiers/timestamps only, never removed values. Cross-guild invocation from
  an already-active tenant context is refused.
- Host authentication audit: the only no-context write exception is append-only
  NULL-guild audit for actor `web` / action `web.oauth_start`, or actor `discord`
  / actions `web.login`, `web.logout`. The INSERT-only policy does not allow host
  SELECT/UPDATE/DELETE, arbitrary action labels, or access to private answers.
- `web_sessions` is intentionally identity-global (live session row, typed
  audience, subject and multi-guild list), never single-guild RLS. Expiry/revocation
  and subject authorization are enforced by the existing auth slice.
- `meta` is migration/fixture metadata, global by design, not participant data.
- NULL-guild templates are global read-only catalog entries; tenant contexts
  cannot create/update/delete them. Tenant templates remain guild-scoped.
- DDL migrations and operator restore/backup administration use separate
  privileged connections, never a request-mode flag. No runtime generic
  maintenance bypass exists. A raw unscoped tenant query remains empty.

Discovery costs O(number of installed guilds), with at most one membership lookup
and one event query per candidate on bootstrap (existing handler eligibility
checks may recheck membership). My hackathons adds one subject query per allowed
guild. Empty/unready inventory fails closed. This is bounded by the bot's installed
guild count, not all database tenants; a trusted indexed inventory is a future
optimization only when this ceiling becomes material. A disconnected bot cannot
bootstrap public or participant tenant discovery.

Fastify lifecycle reference used for callback continuation:
https://fastify.dev/docs/latest/Reference/Hooks/

## Roles, grants and deployment setup

Runtime requires DATABASE_URL and distinct MIGRATION_DATABASE_URL on the same
host/port/database and configured application schema/search_path. The migration
connection is closed after transactional bootstrap, before opening the runtime
pool. Startup refuses an app role that is superuser, BYPASSRLS, owns application
tables, or has CREATE on the application schema. Runtime must not be a member of
the migration/owner role; never grant it that role or persistent schema/database
CREATE. Existing single-credential superuser deployments intentionally fail until
operators provision separate roles. AppHost/production configuration must supply
these two identities; merely injecting the old superuser connection is not safe.

Example provisioning, to adapt and execute only by the operator in their own
application database (passwords are configured out of band):

```sql
CREATE ROLE chashack_migrate LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE;
CREATE ROLE chashack_app LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE;
-- chashack_migrate owns the application schema/tables; app is NOT a member.
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
GRANT USAGE, CREATE ON SCHEMA public TO chashack_migrate;
GRANT USAGE ON SCHEMA public TO chashack_app;
-- After bootstrap, as migration owner:
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO chashack_app;
GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO chashack_app;
ALTER DEFAULT PRIVILEGES FOR ROLE chashack_migrate IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO chashack_app;
ALTER DEFAULT PRIVILEGES FOR ROLE chashack_migrate IN SCHEMA public
  GRANT USAGE ON SEQUENCES TO chashack_app;
```

Only the four DML privileges and sequence USAGE shown above go to the app, never
table ownership, schema CREATE, superuser or BYPASSRLS. PostgreSQL's database-level TEMP privilege is not
an application-schema DDL grant; do not confuse temporary scratch objects with
ownership/access to application tables. Global catalog seeding/host maintenance
requiring row access must be performed by the operator's separate administrative
role, not by granting runtime BYPASSRLS. This PR does not create production roles,
change production grants, run production migrations or claim a deployed role.

## Complete policy inventory

Every row below is checked against actual information_schema columns and live
ENABLE/FORCE flags by `shared/postgres-rls-inventory.test.ts`. Its literal column
arrays enumerate every exact column, including form versions stored in
`events.form_json` and `registration_answers.form_version`; there is no separate
form-versions table. `selected_guild_id` is not a tenant-key column.

| Table | Classification / policy key or parent | App-role behavior test |
| --- | --- | --- |
| events | tenant, guild_id | postgres-rls: unfiltered R/W, missing/forged guild, pool |
| teams | tenant, guild_id; write checks event_id parent when non-NULL | postgres-rls: unfiltered CRUD + forged parent |
| participants | tenant, guild_id; write checks event_id and optional team_id parents | postgres-rls: unfiltered CRUD + forged parent |
| registration_answers | indirect: event_id → events.id, RLS-filtered parent | postgres-rls: unfiltered CRUD; routes-rls: subject answers |
| team_requests | tenant, guild_id; write checks team_id and event_id | postgres-rls: unfiltered CRUD + forged parent |
| event_templates | tenant guild_id; NULL is global read-only | postgres-rls: NULL/foreign read and protected global delete |
| form_config | tenant, guild_id | postgres-rls: unfiltered CRUD |
| guild_settings | tenant, guild_id | postgres-rls: unfiltered CRUD; routes-rls organizer |
| member_deletions | tenant, guild_id; identifiers/timestamp only | postgres-rls CRUD; routes-rls departure |
| private_answer_deletions | tenant, guild_id; event_id/user_id identifiers, deleted_at | postgres-rls CRUD; routes-rls retention |
| audit_log | tenant non-NULL guild_id; NULL host rows invisible; enumerated auth INSERT only | postgres-rls foreign/host read/update/delete/insert controls |
| web_sessions | global identity/session state; no guild RLS | routes-rls live/revoked session and cross-guild switch |
| meta | global migration/fixture metadata; no guild RLS | live inventory and existing recovery tests |

## Repeatability and rollback/recovery proof

Use only a configured disposable database ending in `_test`/`_ci`. Fixtures check
both configured and connected database names before isolated UUID schemas or
roles are created; cleanup drops only their own schemas/ephemeral roles.

`postgres-rls.test.ts` runs bootstrap repeatedly, compares pg_policies before and
after, runs migration inside a deliberately rolled-back outer transaction and
compares the surviving catalog, then migrates again and proves the app role still
has grants and RLS (the app cannot migrate). Existing postgres tests separately
cover additive missing-column/index repair, data/constraint preservation and
transaction rollback recovery. Do not recover by disabling RLS: rollback an
uncommitted failed migration, fix forward and rerun; for a committed deployment
incident, restore through the operator's established backup procedure and replay
durable deletion identifiers before serving. The tests are not production
backup-retention evidence.

```sh
pnpm install --frozen-lockfile
pnpm typecheck
pnpm build
DATABASE_URL=postgresql://postgres@127.0.0.1:55432/chashack_test pnpm test
DATABASE_URL=postgresql://postgres@127.0.0.1:55432/chashack_test node apps/bot/scripts/smoke-admin.mjs
```

RLS tests actually connect with generated `rls_<UUID>` roles using the same
`openDatabase`/`openPostgres` runtime adapter and DML-only grants above. They
inspect current_user, rolsuper, rolbypassrls, ownership and CREATE permission,
reject persistent schema DDL, and prove positive own-guild controls. They exercise
pool-size-one A→B→none, nested rollback, error rollback and separate concurrent
clients, plus Kysely and real HTTP/scheduler/member-reconciliation callers.
Synthetic membership fixtures test handler authorization, not real OAuth or
Discord availability. Ordinary superuser fixture tests/API smoke are regression
coverage only, never proof of RLS enforcement.
