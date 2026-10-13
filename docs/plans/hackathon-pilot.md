# Hackathon pilot isolation contract

This slice implements the settled isolation contract from `/home/hermes/chashack-work/pilot-routing-decisions.md` and issues #20/#14. Guild is the tenant key. Per-event form snapshots and template forms remain; only the global fallback form becomes guild-keyed. `web_sessions` remains cross-guild by design. Audit rows attributed from event/team parents carry that parent guild; unattributable host/auth rows use `guild_id = NULL` and are never returned by tenant audit reads. Existing ambiguous data must remain host-only rather than being guessed into a tenant. No live production migration, RLS, or new dependency is part of this task.

Recovery rule: a legacy global default form may be assigned only if exactly one existing guild is provable from stored guild-owned data. If zero or multiple guilds are provable, migration refuses with an explicit recovery instruction and must preserve the original bytes. Historical audit rows are attributed only through a provable event/team parent; ambiguously owned rows stay NULL/host-only. Legacy form bytes are retained in `form_config_legacy` for recovery after a successful backfill and are never read by tenant code. Schema changes must be idempotent.

## PostgreSQL-only contract (#11, t_25580df8)

The user's PostgreSQL-only decision supersedes the earlier dual-engine plan and
its historical review. Preserve checkpoints and use the same PR32 and owner.

- [x] Remove SQLite runtime, DB_PATH fallback and dialect-switch adapters.
- [x] Require DATABASE_URL; preserve URL/ADO parsing and safe errors.
- [x] Direct authoritative PostgreSQL DDL; bootstrap twice and additive repair.
- [x] Retain binding, queue, leased transactions, nested/expired contexts and Kysely.
- [x] Feature/isolation/audit/session/API fixtures use guarded real PostgreSQL only.
- [x] Remove obsolete file-driver upgrades; retain fake PostgreSQL recovery controls.
- [x] PostgreSQL-only CI verification under the card's scoped workflow authorization.
- [ ] Fresh exact-head CI and original qa-judge independent changed-flow verification.
- [ ] Operator SHA-bound workflow consent and guarded merge/readback before release.

No live database migration/import, legacy-file access/deletion, auth redesign,
RLS claim, frontend, profile or protected instruction edits are authorized.
