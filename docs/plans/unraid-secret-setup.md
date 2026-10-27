# Automatic production provisioning for Unraid

## Goal

Clicking Compose Up must provision the bundled database without a separate shell
command. A setup service generates and persists PostgreSQL passwords and the
admin session secret, derives the database URLs, and completes before PostgreSQL
starts. Operators supply Discord credentials in the stack environment; Compose
mounts those inputs as secrets rather than passing them in service environments.
Generated values must survive updates and must never be silently replaced.

## Scope

- Add a Node setup command in the app image, using built-in cryptographic APIs.
- Give the app, migration job and database separate persistent secret volumes,
  mounted read-only into their consumers. Setup has no network access.
- Preserve and validate existing values; reject partial sets and refuse to
  generate credentials when the PostgreSQL data volume already contains data.
- Import the previous file-based generated credentials when present, so existing
  deployments preserve their role passwords and session signing key.
- Package the canonical Caddyfile and PostgreSQL role script in the app image;
  provisioning copies them into read-only configuration mounts for their services.
- Mount Discord inputs only into offline provisioning, then copy them with
  restrictive ownership and permissions into the app's scoped volume. Compose
  ignores secret uid/gid/mode outside Swarm and requires a writable recipient for
  environment-sourced secret injection; keep this exception in provisioning.
- Document invocation, prerequisites, persistence, backups, and the fact that
  file-backed Compose secrets are not encrypted at rest by Docker.
- Do not change the database schema or use administrator credentials at runtime.

## Checklist

- [x] Implement automatic setup and scope its mounts and permissions.
- [x] Update Compose inputs, the runbook and deployment examples.
- [x] Verify first start, unchanged reruns, partial sets, existing data and legacy
  import with disposable filesystem fixtures and synthetic credentials.
- [x] Validate the Compose model and complete the independent review.

## Verification

- 13 targeted filesystem regression tests passed under Linux as root with only
  `CHOWN` and `DAC_READ_SEARCH` capabilities and networking disabled. They exercise
  actual owner/group permissions, atomic credential persistence, partial recovery,
  conflicting values, legacy import, concurrent setup, redacted errors, symlink
  rejection, Discord input rotation and the existing-database guard. The suite is
  `node --test apps/bot/scripts/setup-production-secrets.test.mjs`; it explicitly
  skips on non-root/non-Linux hosts rather than pretending to check Unix access.
- Docker Compose 5.6 validated the model and started a disposable project with
  PostgreSQL 17.6 Alpine. The verification image used the existing cached app
  runtime plus this provisioning command and canonical config files.
- Both generated role credentials authenticated to a real disposable `_test`
  database. App UID/GID 10001 read its protected files, had no migration/bootstrap
  mounts, could not write its secret volume, and was denied DDL. Migration used
  its own non-superuser, non-bypass-RLS role.
- Changing the synthetic Discord token in `.env` and repeating Compose Up updated
  the protected copy while database authentication continued to work. The running
  app must be restarted to consume rotated inputs, as documented.
- The Caddy image accepted the packaged Caddyfile. Configuration copying
  normalizes Windows CRLF to LF; database health also requires the initialized
  non-superuser application roles, preventing a failed init from looking ready.
- Independent review's permissions finding was resolved with protected copies;
  actual Compose execution confirmed its uid/gid/mode limitation.
- No real Discord login or Cloudflare Tunnel deployment was exercised. A new
  published app image containing these files is required before operator use.
