# Hackathon pilot isolation contract

This slice implements the settled isolation contract from `/home/hermes/chashack-work/pilot-routing-decisions.md` and issues #20/#14. Guild is the tenant key. Per-event form snapshots and template forms remain; only the global fallback form becomes guild-keyed. `web_sessions` remains cross-guild by design. Audit rows attributed from event/team parents carry that parent guild; unattributable host/auth rows use `guild_id = NULL` and are never returned by tenant audit reads. Existing ambiguous data must remain host-only rather than being guessed into a tenant. No live production migration, RLS, or new dependency is part of this task.

Recovery rule: a legacy global default form may be assigned only if exactly one existing guild is provable from stored guild-owned data. If zero or multiple guilds are provable, migration refuses with an explicit recovery instruction and must preserve the original bytes. Historical audit rows are attributed only through a provable event/team parent; ambiguously owned rows stay NULL/host-only. Legacy form bytes are retained in `form_config_legacy` for recovery after a successful backfill and are never read by tenant code. Schema changes must be idempotent.

## PostgreSQL / SQLite contract (#11, t_25580df8)

- [x] Keep shared async facade and Kysely; instance-local dialect and leased transactions.
- [x] DATABASE_URL overrides DB_PATH; absent URL keeps SQLite, malformed values fail closed.
- [x] PostgreSQL bootstrap twice, mutation RETURNING once, nested rollback and safe BIGINT timestamps.
- [x] Shared feature, guild isolation, audit, session and API-smoke fixtures on both engines.
- [x] Disposable-name guard before PostgreSQL fixture connection and unique schema per handle.
- [x] Fake-only recovery rehearsal preserves IDs, guilds and generated ID sequences.
- [ ] Exact-head PostgreSQL CI job: requires attended workflow approval; do not bypass.
- [ ] Comprehensive same-card qa-judge review and one bounded repair.

No live SQLite import, production credentials/migration, auth redesign, RLS, frontend,
profile, workflow or instruction-file changes are authorized in this slice.
