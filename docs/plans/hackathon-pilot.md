# Hackathon pilot isolation contract

This slice implements the settled isolation contract from `/home/hermes/chashack-work/pilot-routing-decisions.md` and issues #20/#14, plus the OAuth/current-guild authority decisions for #22/#13 below. Guild is the tenant key. Per-event form snapshots and template forms remain; only the global fallback form becomes guild-keyed. `web_sessions` remains cross-guild by design. Audit rows attributed from event/team parents carry that parent guild; unattributable host/auth rows use `guild_id = NULL` and are never returned by tenant audit reads. Existing ambiguous data must remain host-only rather than being guessed into a tenant. No live production migration, RLS, or new dependency is part of this task.

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

No live database migration/import, legacy-file access/deletion, RLS claim, profile
or protected instruction edits are authorized.

## OAuth-only identity and current guild authority (#22/#13)

- Discord OAuth is the only sign-in path; remove operator/password sessions and
  `DISCORD_GUILD_ID` authorization fallback. Require an explicit strong
  `ADMIN_SESSION_SECRET`; rotating it logs out all sessions.
- Keep Fastify, auth domain/data and revocable PostgreSQL session rows. Organizer
  OAuth and participant OAuth (`identify` only) use distinct callbacks, typed
  audiences, and separate cookies. Participant state/PKCE are one-shot; Discord
  access/refresh tokens are never persisted or logged.
- Only guild Owner/Administrator or configured immutable delegated role IDs may
  manage events. Only Owner/Administrator changes delegated roles; Manage Server
  alone is insufficient. Recheck guild membership and roles through the bot for
  each request; absence, demotion, removal, and lookup errors fail closed. OAuth's
  login-time guild list is display-only, not authorization.
- Host allowlisting remains separate, minimal, and cannot read tenant content or
  impersonate tenants. Participant APIs derive user identity solely from their
  participant session; event/user/guild IDs are locators, never authority.
- Keep public host allowlisting distinct; participant `/api/participant/me` is
  identity only and registrations return only self-owned allowed event summaries.
  Explicitly allowlist all API DTO fields.
- Minimal login UI uses OAuth and retains accessible failure and empty states;
  localized strings stay in English and Swedish. No participant forms, teams,
  public-page UI, Redis, production credentials/migrations, proxy/domain, MCP,
  profile/workflow, or instruction-file changes.

### Runnable browser verification

- [x] Keep OAuth-only login and current guild authority checks; Manage Server
  alone is insufficient, and only Owner/Administrator change delegation.
- [x] Add installed-Chromium DOM/AX checks for successful guild picker, stale
  authority recovery, no-manageable-guild guidance, and en/sv login parity.
  Run with `DATABASE_URL=postgresql://postgres@127.0.0.1:55432/chashack_test node apps/bot/scripts/oauth-browser.mjs` after `pnpm build`; this uses guarded per-test schemas and installed Chromium.
- [x] Run browser check and frozen typecheck/build/test/API smoke on the local
  candidate; exact-head CI is tracked in the PR body.
- [x] Read back PR33 body/head and verify exact-head CI after publication.

Browser session fixtures are synthetic and exercise the application UI/API only;
they do not perform or claim a live Discord OAuth login.
