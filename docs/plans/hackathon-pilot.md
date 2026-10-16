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

## Shared versioned registration and public event contract (#13/#20)

Mapping contract: `{ field: experience|role|skills, importance: low|normal|high,
choiceValues: Record<choiceId, coreOptionId> }`. Choice keys exactly match the
question's stable choice IDs and values must exist in the pinned form's target
options. Experience/role require single choice; skills allow single or multi.
Only non-private professional choices may map, with at most one question per
target. Mappings are structural. Keep original core signup values and answers;
derive matching values server-side, replacing a core value only when its mapped
answer is present. Unanswered optional mappings retain core values. Multipliers
are 0.5/1/2; pair contribution uses the mean of both participants' multipliers,
applied independently to existing experience, role and capped skills components.
Do not weight base/friend contributions or alter allocation rules. No answered
mapping reproduces existing scores. Keep custom/private answers out of matching
diagnostics and all non-owner DTOs.

Backend owns mapping validation, projection/scoring, persistence, Discord link
and public HTML. The participant signup React route and organizer editing are
downstream cards; do not add placeholder UI here.

- [x] Add stable, localized custom questions to the event-pinned `FormConfig`;
      validate question limits, IDs, kinds, choices, and bounded mappings.
- [x] Persist one answer record per event/participant/form version; share the
      validated answer shape between Discord projection and participant API.
- [x] Implement participant self-scoped GET/PUT/DELETE registration, including
      current membership checks and required-answer completion status.
- [x] Reject structural edits to populated published forms without an explicit
      version migration; cosmetic changes preserve historical meaning.
- [x] Add public published-event DTO and escaped initial Open Graph HTML; never
      expose private registration, roster, invite, or audit data.
- [x] Add regression tests for two-guild isolation, stale versions, validation,
      completion, privacy, public metadata escaping, and idempotent PostgreSQL
      schema migration. Use disposable PostgreSQL only.
- [x] Add en/sv Discord web-completion link and error copy.
- [ ] Verify exact-head CI, request same-card qa-judge review, one repair, then
      targeted verification.

The signup React route `/events/$eventId/signup` is owned by downstream card
t_583f310e; this backend publishes its API and completion link but does not ship
or claim the page.

## Teams and member departure (#13/#23)

Bounded QA repair (QA1–QA8): pinned event capacity is re-read under the shared
event lock, including old-event request decisions; join-request approvers must
remain eligible members/owners. Organizer moves and member removals use the
same outgoing-owner succession, and departure also discovers detached ownership.
Discord leave/move callers revoke outgoing access and clean deleted resources.
Preview revisions include the matcher's creation-time ordering input. Departure
strips the departed guild from surviving other-guild sessions. Invitation failures
use localized error embeds; both confirmation catalogs disclose team preservation.

- [x] Serialize team creation, joins, invitation creation/acceptance, matching
  commits, and organizer assignment on the event row across independent pooled
  PostgreSQL connections; organizer assignment enforces active status/capacity.
- [x] Add real two-connection invite-accept capacity regression and organizer
  capacity/partial-write regression.
- [x] Add participant team/invite endpoints and parity/privacy coverage.
- [x] Revalidate matching previews at commit; preserve formed teams and exclude
  private answers from every output.
- [x] Delete only departed-guild registrations/answers/team links/requests;
  add gateway/offline reconciliation with fail-closed lookup behavior and
  identifier-only idempotence records.
- [x] Purge organizer-only signup answers at event end + 7 days (earlier cleanup
  or departure wins); preserve non-private answers and replay deletion identifiers
  against synthetic pre-deletion snapshots. `node --test dist/features/registration/retention.test.js`.
- [x] Transfer ownership to a random eligible remaining member; reuse existing
  empty-team cleanup, and test team leave/departure across two guilds.
- [ ] Run exact-head CI and same-card independent QA before planner delivery.

Shared contract: all membership writes reuse event-row transactions and the
parent's `projectParticipantForMatching` completion/projection, with fresh,
fail-closed Discord membership checks (fake lookup only in test fixtures).
Participant routes derive actor/user/guild from the session and resolved event;
open-team DTOs contain counts, not rosters; own-team DTOs contain names/IDs only.
Discord create/join-code/join-request/invite/accept and organizer assignment use
the same data checks as HTTP. Web and Discord confirmation carry the preview
revision; scheduled matching recomputes inside the transaction without a user
preview. Existing formed teams are never cleared. Guild removal/reconciliation
call the same deletion service, return empty-team resources to existing Discord
cleanup and retain only guild/user/time identifiers for restore replay. A fake
snapshot replay is tested; this does not claim a production backup retention SLA.
There is no rolling-backup or restore automation in this repository. An operator
must provide encrypted rolling backups, remove deleted values within 30 days, retain
the deletion ledger outside snapshots, and replay it before serving restored data;
this is an explicit production launch blocker. Legal review of controller/minor
participant posture is still required.
Participant signup/team pages remain the dependent participant card's surface;
these checks exercise real HTTP handlers, not an unimplemented page journey.

## Organizer workspace (t_ce43eb96)

- [x] Keep template → event → assignment → schedule → preview → publish on the
      existing console and reuse the pinned server-side form DTO unchanged.
- [x] Expose stable localized questions, private-field classification, mapped
      choice IDs and importance in form/template editing.
- [x] Preserve typed state and show inline save/version conflicts; cosmetic
      changes remain saveable when structural edits are rejected.
- [x] Verify success, error and empty journeys, en/sv, keyboard and mobile on
      the actual served console.

Run after building: `DATABASE_URL=postgresql://postgres@127.0.0.1:55432/chashack_test node apps/bot/scripts/organizer-browser.mjs`.
The runner reuses the existing OAuth browser fixture pattern, installed Chromium,
native WebSocket/CDP and an isolated schema. It tests synthetic organizer authority,
not Discord OAuth or real Discord delivery. Publication is the existing active-event
transition; the participant completion page remains owned by t_583f310e.
Mobile evidence is collected in one persistent CDP target: actual innerWidth=390,
desktop media query=false, asset URL and rendered classes recorded before all seven
toolbar targets measure 44px. The earlier 28px trace was not a mobile regression.
Axe is unavailable/unmeasured; no dependency was installed. Prior detector and
desktop/mobile capture evidence is retained; no new broad design/a11y audit.
- [ ] Exact-head CI and authentic same-card qa-judge review; planner owns merge.
