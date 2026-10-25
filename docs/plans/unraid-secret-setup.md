# Unraid production secret setup helper

## Goal

Add a one-time helper that prepares the production Compose secret files for an
Unraid operator. It generates strong PostgreSQL passwords and an admin session
secret, derives the two database URLs from the generated passwords, and
interactively collects Discord credentials without echoing them. It must not
overwrite existing secrets or print secret values.

## Scope

- Add a Bash script usable from a Linux Docker host such as Unraid.
- Create `deploy/secrets/` with restrictive permissions and the Compose-required
  secret files.
- Keep the generator safe to rerun: preserve existing files, complete missing
  Discord files, and reject a partially present generated-password group rather
  than silently producing mismatched database credentials.
- Document invocation, prerequisites, persistence, backups, and the fact that
  file-backed Compose secrets are not encrypted at rest by Docker.
- Do not change the database schema, Compose topology, or application runtime.

## Checklist

- [x] Implement the setup helper with no secret output and no clobbering.
- [x] Document the helper in the production runbook and point it at Unraid use.
- [ ] Verify shell syntax and inspect its dry behavior without creating real
  credentials.
- [ ] Run the relevant repository deployment checks where available.
