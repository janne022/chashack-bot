# Production deployment, backup, recovery and incident runbook

Status: operational template requiring owner values and a successful isolated drill before production use. It is not evidence that a deployment, off-host backup, alert, notification process or restore has been configured.

Requirement coverage: DEP-01, DEP-02, REC-01, GOV-01, IR-01. Compose deliberately requires immutable digest references and protected local secret files. The application and one-shot migration command are separate services; the DDL credential is mounted only into `migrate`.

## Ownership and operating targets

Fill these fields in the operator's private deployment record before launch. Do not put private contact details or secret values in Git.

| Field | Owner must supply |
| --- | --- |
| Service owner / incident commander | `UNASSIGNED` |
| On-call contact and backup contact | `UNASSIGNED` |
| Data controller contacts for each guild | `UNASSIGNED` |
| Security escalation / hosting provider contact | `UNASSIGNED` |
| Canonical domain and approved aliases | Canonical domain is configured; aliases redirect at DNS/edge and are not independent app origins |
| Recovery Point Objective (RPO) | `UNSET`; choose and verify backup frequency |
| Recovery Time Objective (RTO) | `UNSET`; measure in an isolated restore drill |
| Backup retention duration and deletion policy | `UNSET`; controller/owner decision required |
| Backup storage, region, encryption key custodian | `UNSET`; off-host encrypted storage required |
| Incident severity and notification decision-maker | `UNASSIGNED`; assess applicable obligations with the responsible controller and qualified counsel |

Do not represent unset fields as guarantees. A drill is accepted only when its measured backup age, restore duration, integrity checks, deletion replay, session invalidation and Discord reconciliation are recorded by the service owner.

## Data inventory and handling

This inventory is based on source behavior. It is not a complete legal basis, retention schedule, or privacy notice.

| Data | Purpose and access | Current known lifecycle | Operational decision still needed |
| --- | --- | --- | --- |
| Discord IDs, names, guild/event/team membership | Sign-in, authorization, signup, team operation; participants see permitted team data and authorized organizers manage their guild | Membership departure deletes identifying records and writes an identifier ledger; exact end-to-end deletion processing needs operational evidence | Controller-approved purpose, retention periods, and deletion service ownership |
| Registration answers and imported signups | Event participation and matching; the subject and authorized organizers have access according to route policy | Ordinary answer retention is not established by this deployment template. Private `organizer_only` answers have code that purges after event end plus seven days and retains an identifier ledger | Confirm policies for every question, import source, match use and event lifecycle; document/export process |
| Dietary/accessibility answers | Participant-provided sensitive information needed for event accommodation | Stored with registration answers; intended subject/authorized-organizer access is described by the remediation requirements | Minimize fields, restrict access, define deletion timing and controller review |
| Audit records | Operational accountability for organizer/bot actions | Source includes tenant-scoped audit data; retention and a protected external audit sink are not configured here | Set retention, access review and escalation for unusual reads |
| Web sessions | Keep Discord-authenticated organizer/participant sessions | Session rows expire; tokens are signed using `ADMIN_SESSION_SECRET`. Restored rows must be invalidated before traffic | Set session monitoring and incident revocation procedure |
| CSV imports and application logs | Import processing and diagnosis | This Compose template gives the app an ephemeral writable `/tmp`; it does not define CSV/log retention or prove that providers do not retain logs | Confirm source cleanup, log redaction, provider retention and access controls |
| Database backups and deletion ledgers | Recovery while honoring completed deletions | Scripts stream encrypted artifacts to a configured SSH destination using `age`; no destination, retention, key custody or schedule is configured here | Choose an off-host isolated destination, retention, encryption custody and recurring monitored job |

Data subjects can include minors depending on hackathon participation. The controller decides age-related notices and consent requirements. This runbook makes no legal compliance claim.

## Prepare the host and secrets

1. Use a supported Linux Docker host. Configure host firewall/security groups to allow inbound TCP 80 and 443 plus UDP 443 (this Compose file enables Caddy HTTP/3; remove its UDP mapping if unused), and SSH only from operator networks. Do not expose Docker's API, PostgreSQL, application port 8420, or dashboards. Point the canonical DNS A/AAAA records to this host.
2. Create a deployment directory containing this reviewed release. Copy `deploy/production.env.example` to `deploy/production.env`. Replace every placeholder and set `APP_IMAGE`, `CADDY_IMAGE`, and `POSTGRES_IMAGE` to reviewed immutable digests. Choose one canonical HTTPS domain, then select an unused private `EDGE_SUBNET` and fixed `EDGE_PROXY_IP` / `EDGE_APP_IP` within it; only Caddy and the app join this edge network. Compose trusts exactly `EDGE_PROXY_IP/32` for forwarded protocol and client address handling. Register both `https://<canonical-domain>/auth/discord/callback` and `https://<canonical-domain>/auth/participant/callback` in Discord. Redirect aliases to the canonical host at the edge/provider; do not register other origins or share a cookie domain.
3. Create `deploy/secrets/` outside source control. Generate distinct high-entropy lower-case alphanumeric PostgreSQL passwords of at least 32 characters for app and migration roles; this narrow alphabet is required by first-initialization validation in `postgres-init/10-roles.sh`. Generate a separate PostgreSQL bootstrap password and a random 32+ character session secret. Store the Discord bot token and OAuth client secret there. Do not write any actual values in shell history or this document.
4. Create these files with exactly one value each: `postgres_bootstrap_password`, `chashack_app_password`, `chashack_migration_password`, `database_url`, `migration_database_url`, `admin_session_secret`, `discord_token`, and `discord_client_secret`. The two PostgreSQL URLs must point to `db:5432/chashack`, using respectively `chashack_app` and `chashack_migrate`, and their matching passwords. URL-encode credentials if required; the generated alphanumeric passwords need no encoding. Create `deletion_replay_database_url` only for an isolated recovery deployment; it connects as `chashack_bootstrap` to a database named `restore_<id>`.
5. Set host file permissions so the app's files (`database_url`, `admin_session_secret`, `discord_token`, `discord_client_secret`) are readable by GID 10001 and no other non-owner group; set PostgreSQL bootstrap and role password files readable by PostgreSQL GID 70. Root ownership with mode `0440` and the corresponding group is a suitable Linux setup. Keep parent directories restricted to operators. Local Compose file-backed secrets preserve source permissions on many engines; confirm actual container readability on the target engine before launch. Never make the files world-readable as a workaround.
6. Confirm `git check-ignore deploy/secrets/database_url deploy/production.env` reports ignored paths. Compose does not invent passwords, and the checked-in template contains placeholders only.

The image entrypoint explicitly reads the documented `*_FILE` mounts and exits if a configured secret file is unreadable or empty. It removes those file-path variables before starting Node. Other `_FILE` settings are not assumed to work.

## First deployment and upgrades

Build and publish the app image with a reviewed digest-pinned Node base. The Dockerfile requires `NODE_BASE_IMAGE`; pass an immutable `node:24-alpine@sha256:<digest>` to `docker build --build-arg NODE_BASE_IMAGE=...`. Docker Hub reported multi-platform index digest `sha256:06d7adf3e0ef61a13f1d28682726366f97a15aa1888c934d3ecec86c33918b53` for Node 24 Alpine on 24 October 2026; verify its current advisories and contents before adoption or update ([official image details](https://hub.docker.com/layers/library/node/24-alpine/?tab=layers)). Scan and publish the resulting app image, then copy its immutable registry digest into `APP_IMAGE`.

Run from the release directory with `docker compose --env-file deploy/production.env -f compose.production.yaml ...`:

1. Review the resolved configuration locally with `docker compose ... config`; verify `edge` is the only service publishing host ports and that `db` has no published port. Check all image references are immutable digests and all secret values are absent from the resolved output.
2. Pull the reviewed image references, then start with `up -d`. On a new empty named volume, PostgreSQL initializes once and creates separate `chashack_migrate` and `chashack_app` roles. On an existing database the init script will not run; preserve its data and have the database owner plan the required role/grant migration before adopting this Compose file. The `migrate` service runs `migrate-cli` and exits; the app waits for its successful completion and connects only with the restricted app role. Do not remove the database volume to retry a failed migration.
3. Check `docker compose ... ps` and redacted service logs. Confirm the edge is healthy, `https://<canonical-domain>/healthz` responds, login redirects through the configured Discord callback, and authenticated console flows work. Test SSE/live updates through TLS and verify HTTP aliases redirect to the canonical HTTPS origin. Do not use health status alone as a functional or security acceptance.
4. Verify externally that 80/443 are the only reachable service ports, the certificate matches the canonical host, HSTS is served only over TLS, and PostgreSQL/8420 are not reachable from outside. The host owner must capture the actual firewall and TLS evidence.
5. For upgrades, stage and review the new digest, take a backup, run the one-shot migration, inspect health and application behavior, and keep the previous immutable image/digest available for rollback. Database migrations may not be backward-compatible; confirm schema compatibility before rolling back the app image. No automatic rollback is configured.

The app runtime supports `SKIP_DATABASE_MIGRATIONS=1` and still validates the restricted runtime database role. Compose gates app startup on successful completion of the one-shot migration service. If running the app outside this Compose file, run the migration command explicitly before opening traffic.

## Backups and retention

The scripts require `age` and SSH client on the operator host, plus a preconfigured SSH alias with a restricted destination account. The remote directory must be encrypted-storage backed or otherwise protected, accessible only to backup operators, and outside the database host's failure domain. `AGE_RECIPIENT` is a public key; keep its matching private identity offline or in a separate recovery vault. Verify encryption key recovery separately.

Configure `AGE_RECIPIENT`, `BACKUP_HOST`, and `BACKUP_REMOTE_DIR` in the scheduler's protected environment, then run:

```sh
bash scripts/backup-postgres.sh
bash scripts/backup-deletion-ledger.sh
```

The first produces a PostgreSQL custom-format backup. The second independently snapshots only the two identifier-based deletion tables, encrypted in transit and at rest as an `age` stream. Keep the ledger outside the full-backup retention window and replay it on restores. To bound the interval not represented in the off-host ledger, schedule the ledger snapshot after each full backup and at a frequency explicitly accepted by the controller. This does not eliminate the exposure window: deletions since the latest ledger snapshot are not covered. The application does not yet synchronously replicate deletions to the off-host ledger, so set a strict schedule and treat this gap as a launch risk. These scripts do not schedule themselves, define retention, monitor failures, rotate keys, or verify a backup. The owner must add a monitored schedule, an expiry policy approved by the controller, checksum/size inventory, access logging, and periodic restore drills. Set and measure the RPO/RTO before launch; none is asserted here.

Restore output must not include database contents. Use a private, isolated recovery host/project and a new empty database named `restore_<id>`. Never point restore commands at production's live database or volume. Configure a protected libpq service entry named `restore` for the isolated target and a `PGPASSFILE` readable only by the recovery operator; do not pass password-bearing URLs on command lines.

Create the empty database as the bootstrap operator with `createdb --maintenance-db=service=bootstrap --owner=chashack_migrate restore_<id>`, then connect to that database and set the default grants before loading data:

```sh
psql "service=restore" -v ON_ERROR_STOP=1 <<'SQL'
GRANT USAGE, CREATE ON SCHEMA public TO chashack_migrate;
GRANT USAGE ON SCHEMA public TO chashack_app;
ALTER DEFAULT PRIVILEGES FOR ROLE chashack_migrate IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO chashack_app;
ALTER DEFAULT PRIVILEGES FOR ROLE chashack_migrate IN SCHEMA public
  GRANT USAGE ON SEQUENCES TO chashack_app;
SQL
```

Restore the encrypted custom-format snapshot into that empty database:

```sh
ssh "$BACKUP_HOST" "cat '$BACKUP_REMOTE_DIR/<backup-file>.dump.age'" \
  | age -d -i "$AGE_IDENTITY_FILE" \
  | pg_restore --exit-on-error --no-owner --role=chashack_migrate --dbname="service=restore" -
```

The restored tables are owned by `chashack_migrate`, while their saved grants preserve the runtime app role. With the restricted recovery connection, check role flags, forced RLS state, unvalidated constraints, and privacy-safe row counts before any app starts:
```sql
SELECT current_database(), current_user;
SELECT rolname, rolsuper, rolbypassrls, rolcreatedb, rolcreaterole
FROM pg_roles WHERE rolname IN ('chashack_app','chashack_migrate','chashack_bootstrap');
SELECT relname, relrowsecurity, relforcerowsecurity
FROM pg_class WHERE relnamespace='public'::regnamespace AND relkind='r' ORDER BY relname;
SELECT conrelid::regclass AS table_name, conname
FROM pg_constraint WHERE connamespace='public'::regnamespace AND NOT convalidated;
SELECT 'events' AS table_name, count(*) FROM events
UNION ALL SELECT 'participants', count(*) FROM participants
UNION ALL SELECT 'registration_answers', count(*) FROM registration_answers;
```


## Restore and deletion-ledger replay

1. Declare a recovery event and keep the restored app stopped and inaccessible from ingress. Record the source backup timestamp, its age and the drill/incident identifier. Restore into a new isolated database/project using the steps above, never over the live volume.
2. Obtain an independent encrypted deletion-ledger snapshot captured after the full backup. If the snapshot predates these tables, run the one-shot migrator against the isolated database first. The one-shot service's `migration_database_url` must target `restore_<id>`; never start the app as part of this step. On the isolated target only, replace its ledger tables with the external snapshot and inspect only counts/timestamp coverage:

   ```sh
   psql "service=restore" -v ON_ERROR_STOP=1 -c 'TRUNCATE public.member_deletions, public.private_answer_deletions'
   ssh "$BACKUP_HOST" "cat '$BACKUP_REMOTE_DIR/<ledger-file>.sql.age'" \
     | age -d -i "$AGE_IDENTITY_FILE" \
     | psql "service=restore" -v ON_ERROR_STOP=1
   ```

   If no external ledger captured at or after the full backup is available, stop before traffic and escalate to the service owner/controller. A ledger stored only inside that same snapshot is insufficient. A snapshot export cannot cover deletions newer than the latest ledger export; the maximum gap must be explicit and accepted.
3. Configure `deletion_replay_database_url` in the isolated recovery project as a temporary bootstrap URL targeting `restore_<id>`. Run `docker compose --env-file deploy/production.env -f compose.production.yaml --profile recovery run --rm -e DELETION_REPLAY_CONFIRM=restore_<id> replay-deletions`. The CLI refuses any database not named `restore_<id>` or lacking a matching explicit confirmation. It calls the existing member and private-answer replay functions, which apply timestamp checks so later legitimate registrations are preserved. It reports record counts only.
4. Before attaching ingress, delete every restored session row (`DELETE FROM web_sessions` on the isolated DB), rotate `ADMIN_SESSION_SECRET` if signing-key exposure is suspected, verify role attributes/grants and forced RLS, check schema consistency/foreign-key relationships, and compare privacy-safe counts to the expected snapshot. Confirm the bot's Discord identity and permissions; reconcile team roles/channels and other Discord artifacts with the restored state using established operations. Database restore does not reconcile Discord.
5. The deletion-replay CLI has not been proven against a real backup. Exercise it with synthetic identifiers in isolated PostgreSQL and verify repeated replay is safe. The application does not automatically export ledgers off-host; the separate backup command and a monitored recurring job are required. Deletions newer than the latest ledger export remain outside replay coverage.
6. Record measured restore duration, recovered backup age, ledger timestamp/coverage, row/relationship checks, role/RLS findings, session invalidation, Discord reconciliation and unresolved errors. The service owner decides whether the documented RPO/RTO was met and when to reopen traffic.

The replay CLI requires `chashack_bootstrap` so it can enumerate forced-RLS ledger tables, but accepts only a database named `restore_<id>` plus matching operator confirmation. It is not part of normal startup and is never mounted into the app service. Keep its URL available only to the recovery operator and revoke/remove it after the isolated exercise.


## Incident response

Use this checklist with synthetic exercises before production. The named owner and decision-maker fields above must be completed by the organization; this template does not assign responsibility or make notification decisions.

1. **Triage and preserve.** The on-call responder records UTC discovery time, affected service/guilds, observed behavior, suspected data classes and containment actions. Preserve relevant redacted logs, deployment digests, access/firewall records and database audit evidence in restricted storage with access history. Do not copy answer bodies, cookies, OAuth codes, bot tokens or connection strings into tickets/chat. Keep an unmodified evidence copy and record who handled it.
2. **Contain access.** Incident commander decides urgency and scope. For suspected stolen sessions, stop ingress or restrict it, delete/revoke session rows, rotate `ADMIN_SESSION_SECRET`, and require reauthentication. For user compromise, contain the Discord account and review organizer access through the controlling Discord organization. For OAuth compromise, reset the Discord OAuth client secret and review callbacks. For bot compromise, reset the bot token, restrict bot permissions, and inspect affected guild actions. For DB credential compromise, rotate app/migration/bootstrap passwords separately, terminate old sessions, update protected files and restart in order. Avoid uncoordinated role/channel cleanup that can destroy evidence.
3. **Protect affected data and service.** Isolate the database host/network if data integrity is in doubt. Preserve encrypted backups and the independently stored deletion ledger. If recovery is needed, follow the isolated restore process above and do not reconnect ingress until replay, session invalidation and integrity checks complete.
4. **Assess impact and notification.** The responsible controller, with qualified counsel/privacy support where appropriate, decides whether personal data was accessed or exposed and what notices/timing apply. Record the facts, decision-maker, rationale and deadlines in restricted incident records. This runbook supplies no legal threshold, contact list or guarantee.
5. **Recover and learn.** Rotate affected secrets, deploy a reviewed immutable image, verify Discord and database state, test sign-in and live updates, and monitor errors/denials/backup jobs. After containment, document root cause, timeline, scope, user impact, missed controls, corrective owner and due date. Do not mark the incident closed until the service owner accepts remaining risk.

Monitor backup jobs, auth failures, quota/Discord failures, deletion maintenance and unusual bulk reads through a separately protected sink. This Compose package does not configure alert delivery or prove logs are privacy-safe; those remain explicit deployment acceptance items.


### Additional recovery command details

For each restore, use a distinct database name `restore_<id>` and a separate Compose project/secrets directory. Create the restore DB as the bootstrap role, then use the libpq service (and protected `PGPASSFILE`) for `pg_restore` with `--role=chashack_migrate`; the connection must not put its password in process arguments. Run the one-shot migration service after restore only if a schema version check shows that the dump predates the required ledger tables. Before importing the off-host ledger snapshot, run `TRUNCATE public.member_deletions, public.private_answer_deletions` against that isolated database only, then import the encrypted SQL stream. Never truncate these tables in a live database.

To build the release image, supply the reviewed immutable Node base image digest to `docker build --build-arg NODE_BASE_IMAGE=<node-image@sha256:digest> -t <local-tag> .`; scan and publish it, then use the registry's resulting immutable digest as `APP_IMAGE`. The Dockerfile has no mutable base-image default. Record the digest and scanner/SBOM evidence with the release.

The app and migration CLI sources compile into `apps/bot/dist/shared/`. The migration command is run by Compose as `node apps/bot/dist/shared/migrate-cli.js`; the recovery command is `node apps/bot/dist/shared/replay-deletions-cli.js`. These commands are not part of the normal Discord/web handler surface.

