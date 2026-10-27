# Security and frontend review — 23 October 2026

## Scope and confidence

Review of the current working checkout: web routes, Discord dispatch and provisioning, authentication, registration, tenant isolation, database schema, frontend state and participant flows, rate limiting, scheduled operations, dependency manifests, CI, container setup, and privacy/recovery documentation. Luna agents reviewed supply chain and deployment; the primary reviewer inspected security architecture and frontend source.

This is a source-based assessment, not an exhaustive penetration test, a live visual/accessibility audit, or a standards certification. Production infrastructure, Discord permissions, backup storage, repository protection settings, and actual OAuth round trips were not accessed. Existing uncommitted route-tree changes and `.worktrees/` were left alone. No production data or credentials were inspected. Application code and deployment configuration were not changed.

Verification:

- Backend TypeScript build completed successfully.
- Frontend TypeScript check completed successfully.
- Auth/form test invocation: 20 tests passed; two session tests could not initialize because `DATABASE_URL` is not configured. Those are missing-fixture results, not demonstrated product failures. No replacement database or in-memory fallback was used. Full API/RLS/browser suites remain unverified in this review.
- A pure-function reproduction returned `ok: true` when a participant supplied an `organizer_only` answer. The existing RLS handler test also explicitly expects this behavior; see F3 before interpreting it as a vulnerability.
- `pnpm audit` could not initialize its tool cache (EPERM). Direct Fastify advisories were checked; this does not cover the full transitive dependency tree.

## Answers to the security questions

| Question | Assessment |
| --- | --- |
| Can user A read user B's records by changing an API ID? | No direct self-registration IDOR found. Participant identity comes from the signed, live session, and registration queries use that identity. Invitation acceptance checks the caller's pending incoming requests. Organizers intentionally read participants in their authorized guild. This is source evidence, not a completed exhaustive endpoint attack matrix. Discord role revocation is a separate access gap (F1). |
| Can tenant A access tenant B's data? | API/database isolation has substantial defenses: request guild context, fresh Discord authority, forced RLS, and restricted-role startup checks. No direct cross-tenant row read was found. However, the global Discord audit sink can send guild-specific match results to another guild (F2). |
| Can payloads change role, balance, price, or owner? | No balance/payment model. Participant team creation derives the owner from the session. Delegation changes require current owner/Administrator authority. Organizer owner assignment is an intentional privileged capability. Private question permissions are inconsistent (F3), and runtime validation is uneven (F9). |
| Are sensitive endpoints protected, including exports/admin? | Organizer routes, registrations, and imported records pass the API auth hook; participant routes require their separate audience. Public event projections and OAuth are intentional exceptions. `/api/state` and registrations are effectively bulk-data reads even without a download button. Add route inventory/negative tests so future routes cannot accidentally become public. |
| Can secrets escape bundles, source, logs, or errors? | No frontend secret embedding was identified in inspected source. OAuth credentials remain server-side and access tokens are not retained as application sessions. This does not prove historical Git content or deployed bundles are clean. Raw exception logging/responses and incomplete historical secret scanning remain gaps (F9/F15). |
| Can compromised sessions/accounts/credentials be stopped? | Deleting a session row invalidates that cookie; rotating the signing secret invalidates signed cookies. Current Discord membership/organizer authority checks help revoke access. There is no participant logout or user-wide revoke/deny control in the reviewed routes; Discord account compromise can mint new sessions until upstream access is contained (F5). Bot/OAuth credential rotation is an operator action. |
| Can automated requests overwhelm login/search/uploads/integrations? | Controls exist but are incomplete. PostgreSQL quotas are shared across processes, but authenticated GETs bypass limits and expensive authority checks precede write quotas. Reverse-proxy clients collapse into one source bucket. Announcements/imports are not adequately cost-classified (F4). |
| Are DB/backups/infrastructure inaccessible to unauthorized internet clients? | Cannot establish from source. Runtime rejects an elevated app DB role, but network ACLs, TLS termination, storage permissions, and actual exposed ports need deployment evidence. The documented Docker port mapping exposes the application on all host interfaces by default (F16). |
| Can the app/data be restored after serious failure? | Not demonstrated. The repository itself says rolling backups and pre-serve deletion replay are operational launch blockers. Fixture recovery tests are not production restore evidence (F17). |

## Findings, ordered by remediation priority

### F1 — High: blocking/withdrawing a participant does not revoke Discord channel access

`features/signup/data.ts:186` and `:234` clear `team_id` and update status. The web status handler (`adminweb/routes.ts:1510`), participant withdrawal handler (`:779`), and Discord block/remove handlers (`discord/admin-commands.ts:60`) do not call role revocation or team-space cleanup. Team channel access is granted using the team role (`discord/provision.ts:68` onward).

A blocked or withdrawn member can therefore retain the role that grants access to the former team's private channels. The database no longer retains their former team association, making later repair harder. This is a code-path finding; no real Discord role was changed during review.

Remedy: a shared removal service captures the old team before the transaction, handles owner transfer/empty teams, commits status changes, and reconciles Discord roles with retries. Verify block, self-withdrawal, organizer removal, and role-removal failure on both surfaces. Event blocking must not be confused with user-wide incident containment.

### F2 — High when configured across guilds: global audit channel bypasses tenant routing

`index.ts:52` accepts `guildId` but resolves `config.auditChannelId` through `client.channels.fetch`, without checking the channel's guild. `/api/match/commit` (`adminweb/routes.ts:1666` onward) supplies team names and Discord member IDs to this sink.

In a multi-guild installation, guild A's match results can go to the single configured channel in guild B. RLS does not prevent leaks after data leaves SQL.

Remedy: guild-scoped destinations, fetch through the source guild, verify ownership, and fail closed. If a host-wide monitoring channel is intentional, send only explicitly approved operational metadata, not tenant rosters. Test two guilds with distinct channels.

### F3 — High-priority privacy contract ambiguity: “organizers only” has two incompatible meanings

The UI label is “Private — organizers only” (`admin-ui/src/lib/i18n/en.json:555`). Public form projection removes these questions (`routes.ts:631`), so the participant page cannot display or collect them. But `validateCustomAnswers` (`features/form/domain.ts:160`) accepts their values, and participant GET returns all stored answers (`routes.ts:720`). PUT replaces the whole answer object, so a normal submission omitting hidden questions can also remove their stored values.

The reproduction accepted `{"internal-note":"participant controlled"}` for an organizer-only text field. Crucially, `adminweb/routes-rls.test.ts:71` explicitly expects the subject to read and write their own private answer. Privacy documentation describes dietary/accessibility answers, which normally originate with the participant. Thus this is not evidence that the original intended policy was admin-write-only.

Choose and encode distinct policies:

- Participant-supplied confidential answers: subject and organizers may read/write as defined; authenticated form metadata includes those questions; other participants never receive values.
- Internal organizer notes: participant reads/writes must exclude them; separate storage or a merge that preserves protected keys.

Separate collection visibility, read access, write access, matching use, and retention. Do not rely on a UI filter as authorization. Add tests for protected-key injection, omission/deletion, and all DTO projections after deciding the contract.

### F4 — High availability gap: quotas do not bound the work that costs most

`routes.ts:144` skips source quotas for valid sessions. `:379` skips all GET/HEAD/OPTIONS. Every organizer request already performs `freshGuildAccess` (`:238`, invoked at `:297`) before the write quota. Participant preValidation can scan every installed guild and force member lookups before authorization/quota rejection. `/api/guild/members` (`:870`) triggers Discord searches without an authenticated read quota. `/api/state` returns unpaginated participants/teams/events/templates and reads repeatedly.

The “expensive” regex covers teams/invites/match but misses bulk announcements, Discord event creation, and CSV imports. An authenticated flood can exhaust DB/Discord capacity even when mutations eventually get 429. Anonymous source identity uses the socket address, so a reverse proxy gives all visitors the same 60/minute bucket.

Remedy: early per-source and per-session budgets, explicit per-operation cost classes, bounded concurrency, import row/byte limits, pagination, timeouts and retry budgets. Configure only known trusted proxy hops; never blindly trust forwarded headers. Preserve immediate authorization revocation when optimizing membership lookups. SSE already has useful connection caps and reauthorization, but caps are process-local.

### F5 — Medium: participant logout and incident session management are missing

Only organizer logout exists (`routes.ts:859`), reading/deleting `hacksess`; there is no route to clear/revoke `hackpartsess`. Sessions last seven days (`features/auth/domain.ts:88`). No revoke-all-for-user, session list, incident deny state, or operator workflow appears in the reviewed API. Organizer logout UI suppresses failures (`ServerSwitcher.tsx:54`) and navigates away even if revocation failed.

Remedy: logout per audience, logout-all, an auditable operator containment path, and clear error feedback. A stolen live cookie is a credential; deleting local cookies alone is insufficient. Discord OAuth revocation does not automatically delete this app's independently stored sessions.

### F6 — High UX impact: participant OAuth lands in the organizer experience

Successful participant callback redirects to `/` (`routes.ts:614`); `App.tsx:15` treats `/` as organizer-only. An ordinary participant can see another login screen after a successful login. The event link is lost. Participant OAuth failures use `participant_auth`, but `LoginView.tsx:36` reads only `auth`, hiding the reason.

Remedy: store an allowlisted relative return destination bound to OAuth state, return to that event signup, and use a participant-specific error/retry screen. Reject external or protocol-relative return URLs. This needs a real participant browser journey test, beyond isolated authenticated page fixtures.

### F7 — Medium: signup timestamps are stored but not enforced by participant registration

`participantEvent` (`routes.ts:657`) checks active status and membership. Registration PUT checks form/profile and blocked status, but not `signupStartsAt`/`signupEndsAt`. Searches found those fields used for event persistence/scheduling, not participant signup admission.

An active event can accept new signups before opening or after the configured signup deadline. Define whether existing registrations can still be edited/withdrawn; enforce the policy in a shared domain/service on web and Discord, then show the same reason in the UI.

### F8 — Medium: organizer form answers exist in the API but not the regular participants UI

`GET /api/events/:eventId/registrations` (`routes.ts:788`) returns `{ userId, formVersion, answers }` behind organizer authentication/RLS. `ParticipantsPanel.tsx` and `api.ts` do not consume it. Imported-signup records have their own answer editor (`ImportedSignups.tsx:99`), which is not a general viewer for ordinary registrations.

Add an accessible participant details drawer: Discord name and stable ID, localized question labels, readable choice labels, missing-answer status, form version, and confidentiality indicators. Load per event/person on demand rather than adding all sensitive answers to every `/api/state` response. Historical labels require versioned definitions; do not mislabel old answer IDs with changed current questions. Paginate any bulk/export path and audit sensitive exports.

### F9 — Medium: TypeScript assertions substitute for runtime validation in several handlers

Examples: event PATCH (`routes.ts:1156`) forwards asserted strings to `updateEvent`, which calls `.trim()`/`.slice()` (`features/events/data.ts:439`); a JSON number/object can produce an exception rather than a field-specific 400. Guild channel settings copy values without consistent type/ownership checks (`routes.ts:1477`). Announcement title/message validation checks presence rather than bounded string types (`:1237`).

No central sanitized error handler is installed in `server.ts`. Channel diagnostic responses interpolate exception messages (`routes.ts:965`), and several Discord failures log whole errors. This is an information-exposure/logging concern, not a confirmed credential leak.

Use runtime schemas or small explicit validators at all boundaries; allowlist mutable fields, reject unexpected shapes, validate finite bounded dates and guild-owned Discord references, and return stable localized error codes plus field errors. Retain domain validation for business rules. Add database CHECK constraints for statuses/kinds/basic ranges and appropriate composite references; current schema has useful FKs/RLS but many unrestricted TEXT state columns and JSON stored as TEXT.

### F10 — Medium: audit records do not consistently identify the real actor

Organizer handlers commonly pass `'web'` (`routes.ts:1173`, `:1506`, `:1513`, `:1643`). The session already provides the Discord user ID and name. Discord handlers use `discord:<id>`; participant-team handlers use `web:<id>`. `AuditPanel.tsx:75` simply renders the raw actor. Login/logout rows use NULL guild and are not included by `auditList`, so the tenant audit UI is not a security event dashboard.

Use stable actor ID + source + display-name snapshot (names are mutable), with request/correlation IDs and target guild/event. Never accept actor identity from payloads. Preserve old rows honestly as unknown rather than guessing. Add safe detail expansion and paging; current UI searches only the latest 100 rows and truncates details.

The app role has broad DML grants and audit tenant policy allows modifications (`postgres-schema.ts:251`; `docs/POSTGRES-RLS.md:116`). Audit is not tamper-resistant against compromised application/database credentials. Restrict audit UPDATE/DELETE and forward security events to a separately protected sink with retention and alerts.

### F11 — Medium hardening: sensitive cache policy and browser security headers are incomplete

OAuth/SSE set `no-store`, but ordinary sensitive JSON responses do not. `api.ts` uses default fetch cache behavior. No global CSP, frame restrictions, nosniff, or referrer-policy was found in the application server. A reverse proxy may supply them; this was not verified. Absence of no-store is not proof of a working cross-user cache exploit.

Set `Cache-Control: no-store` for authenticated/private responses and relevant errors; avoid CDN caching there. Hashed static assets can use long immutable caching, while HTML needs revalidation. Add CSP (accounting for the inline theme bootstrap), frame-ancestors, nosniff, restrictive referrer policy, and HTTPS/HSTS at the verified edge. No service-worker data cache was found. Redis is wired in Aspire but is not a production cache consumer; adding it does not itself solve the current problems.

Frontend event selection uses one localStorage key `chas-event` across guilds/users (`App.tsx:29`); guild switch reloads without clearing it (`ServerSwitcher.tsx:45`). This can select an unavailable foreign event and produce confusing empty state. Scope selection by identity/guild or reset it on switching and validate it against returned events. RLS should continue to prevent foreign data disclosure.

### F12 — Medium hardening: CSRF and canonical-origin handling need a stricter contract

Cookies are HttpOnly and SameSite=Strict; OAuth uses separate Lax state/PKCE cookies and S256. These are good defenses. Mutation CSRF check (`routes.ts:359`) compares only URL `.host`, ignores scheme, and allows missing Origin; without PUBLIC_URL it trusts the request Host. This alone does not establish a cross-site exploit because SameSite/JSON restrictions still matter.

Require a validated canonical HTTPS origin in production, compare full origins, use Fetch Metadata and/or a CSRF token for the supported missing-Origin cases, and validate ingress Host. Secure cookies currently depend on configured URL strings rather than a production-mode invariant. There is no multi-origin environment allowlist; PUBLIC_URL and OAUTH_REDIRECT_URI describe a canonical deployment.

SSE compares Origin against `req.protocol://Host` (`live.ts:17`), while the server has no trusted-proxy configuration. HTTPS offload can break requests that carry Origin when the app sees HTTP. Test through the actual TLS proxy.

### F13 — Medium functional defect, latent SSRF concern: scheduled assignment delivery is broken

`discord/notify.ts:482` calls `listTeams(db, event.guildId)`, but the function requires an event ID (`features/teams/data.ts:143`). It then reads `channelId`/`channel_id` (`notify.ts:489`) although the mapped team property is `textChannelId`. Normal event IDs therefore yield no teams, and correcting only the first bug still skips delivery.

The same branch passes arbitrary HTTP(S) assignment URLs to Discord attachment handling (`notify.ts:494`; normalization at `features/events/data.ts:804`). Treat this as a latent server-fetch/SSRF risk when repairing the delivery path, not a proven currently reachable exploit. Do not permit private/link-local destinations, unsafe redirects, unbounded downloads, or arbitrary content types; prefer a controlled asset store/allowlist or safe link presentation.

Several scheduled audit calls are not awaited and send failures are swallowed. Use explicit per-action outcomes, durable retry/idempotency, and tests that assert the actual Discord adapter invocation rather than only planner output.

### F14 — Medium UX: validation feedback, historical state, and seed behavior need work

- `api.ts:25` reads `body.code`, while many endpoints return `body.error`, collapsing useful reasons to generic failures. Retry text is hard-coded English. Normalize the error envelope and map it to both locale catalogs; show field errors, preserved input, and retry countdowns.
- `signup-question.tsx:47` lacks a text maxlength/counter for the server's 2,000-character limit. Signup missing-profile handling always focuses the experience field even when another field is missing or experience is absent. Focus the actual first invalid field and associate help/error descriptions.
- `my-hackathons.tsx:24` asks for registration details even on ended events. Those detail routes reject inactive events; `complete` remains undefined and the UI displays “action needed” on historical events. Use a closed/read-only state and a dedicated historical self-view.
- Organizer refresh errors can remain invisible after initial load: `App.tsx` retains state but does not render the general error in its authenticated branch. Show stale/offline state and an actionable retry without destroying useful data.
- `listTemplates` (`features/events/data.ts:616`) seeds whenever a kind is empty. Deleting the last template makes defaults reappear on the next read. Seed once explicitly, mark examples, and offer an explicit restore-defaults action. Reads should not create surprise content.
- Source contains English-only assignment-editor help and public HTML fallback text. Complete en/sv coverage, including loading/error states.

Positive frontend patterns include accessible dialog primitives, many labels/live regions, large participant controls, draft preservation on form-version changes, and SSE invalidation rather than broadcasting private data. Actual contrast, mobile overflow, keyboard order, zoom, reduced motion, and screen-reader behavior still need browser evidence.

### F15 — Medium supply-chain gap: patch Fastify and improve continuous checks

Fastify is pinned to 5.12.3 (`apps/bot/package.json:21`). Upstream advisories list patches in [5.12.5 for HTTP/2 trailer DoS](https://github.com/fastify/fastify/security/advisories/GHSA-4mh8-r7rc-xpvc) and [5.12.6 for header propertyNames validation](https://github.com/fastify/fastify/security/advisories/GHSA-389g-gv7q-r4x8). No use of those specific vulnerable features was found, so this is not a demonstrated exploitable critical vulnerability in this app. Upgrade to a reviewed patched version and regenerate/test the lockfile while preserving release cooldown.

CI has frozen installs, narrow permissions, lock integrity, a three-day release-age policy, and install-script restrictions. Gaps: no automated dependency-advisory check found; mutable action tags; the custom secrets gate scans added diff lines rather than full history; no verified production image/SBOM/provenance scanning or security alert pipeline. Repository settings may provide additional controls but were not inspected.

Add advisory scanning with a documented exception policy, maintained secret scanning/full-history baseline, SHA-pinned actions, container scanning/SBOM/provenance, and meaningful negative authorization tests. CI checks are not runtime security monitoring. Alert on repeated authorization failures, quota saturation, Discord/API errors, failed deletion jobs, backup failures and unusual bulk reads without logging answer bodies or credentials. Workflow changes require the repository's attended approval before merge.

### F16 — Deployment: a hardened Compose package is feasible, but current docs are insufficient

README's `-p 8420:8420` publishes on all host interfaces (`README.md:178`). Whether that is exploitable depends on actual firewall and TLS ingress. There is no reviewed production Compose/proxy recipe in this checkout. Do not infer that PostgreSQL or backup storage is exposed solely from that API mapping.

A release-ready Compose package should include:

- TLS reverse proxy as the only public ingress, strict canonical host routing, and no published PostgreSQL/Redis/admin-console ports. If the proxy runs on the host, bind API to loopback.
- Separate database app and migration roles; run migrations as a one-shot deployment step so the long-running app does not retain the DDL secret. Current startup receives both credentials.
- Non-root containers, dropped capabilities, no-new-privileges, tested read-only filesystem/tmpfs, resource/PID limits, health checks, graceful shutdown and restart policy.
- Reviewed immutable image references, protected secrets, no live credentials committed to Git. Docker secrets require explicit file-reading support; do not assume arbitrary `_FILE` variables work today.
- Persistent storage, encrypted off-host backups with separate credentials, retention/deletion-ledger handling, and a restore drill with documented RPO/RTO.
- Proxy-aware rate limiting/SSE and an upgrade/rollback runbook. Redis can be omitted until an actual consumer needs it.

Multiple independent domains are not supported by an environment allowlist today. Prefer redirecting aliases to one canonical HTTPS origin. If independent origins are required, design exact allowed origins/hosts, callback registration per origin, host-only cookies, CSRF and live-update behavior together; do not solve this with wildcard CORS or a broad cookie Domain.

No Compose file was published as part of this assessment. Production domain, ingress, backup target and secret provisioning require concrete deployment choices and verification before calling it hardened.

### F17 — Launch blocker: recovery/privacy operations are not proven

`docs/legal/privacy.md:126` explicitly says rolling-backup automation and pre-serve deletion replay are unverified. Legal documents still include draft/contact readiness issues. Member-departure and private-answer retention code exists; that is valuable but does not establish end-to-end compliance or recovery.

Restore into an isolated environment, verify row counts/relationships and role/RLS settings, replay deletion ledgers sourced outside the restored snapshot, invalidate restored sessions, reconcile Discord artifacts, then reopen traffic. Record measured recovery point/time and repeat drills. Backup access, encryption, deletion bounds, and restoration must include the same personal-data policy as the live database.

Create a practical incident runbook with named owners, contact/escalation path, containment actions, evidence preservation/redaction, token/session rotation, recovery criteria, and notification assessment. Establish data inventory, access review, purpose/minimization, retention for ordinary answers/imported CSVs/audit logs, and reviewed privacy contacts. Diet/accessibility fields deserve explicit minimization and access policy. Legal obligations need qualified review; this report is not a legal compliance determination.

## Standards mapping and suggested acceptance gates

Use [OWASP ASVS 5.0](https://asvs.owasp.org/) as a requirement-by-requirement verification backlog, aiming at an appropriate Level 2 baseline; do not claim conformance from a general audit. [OWASP Top 10:2025](https://top10.owasp.org/2025/0x00_2025-Introduction/) and [API Top 10:2023](https://api-security.owasp.org/editions/2023/en/0x04-release-notes/) are risk taxonomies, not certifications. [NIST SSDF SP 800-218 v1.1](https://csrc.nist.gov/pubs/sp/800/218/final) supplies secure development practices, including preparation, software protection, secure production and vulnerability response.

| Theme | Relevant findings | Required evidence |
| --- | --- | --- |
| Access control / API object and property authorization | F1–F3, F5, F8 | Two-user/two-guild negative tests, private-field policy tests, actual Discord role revocation |
| Authentication/session/browser controls | F5–F6, F11–F12 | Participant + organizer OAuth/logout journeys through TLS proxy; session revocation checks |
| Resource consumption / sensitive business flows | F4, F7 | Concurrent load tests with separate identities, rate-limit order, Discord fan-out budgets |
| Injection/input/error handling | F9, F13 | Malformed payload matrix, sanitized errors, SQL parameter review, safe outbound-URL tests |
| Supply chain / integrity | F15–F16 | Advisory and image scans, lock integrity, pinned actions, provenance, controlled releases |
| Logging/alerting and exceptional conditions | F9–F10, F13, F17 | Attributed audit, alert delivery test, failed-job recovery, dependency-outage exercises |
| SSDF preparation/protection/production/response | F15–F17 | Owners and threat model, protected source/artifacts, security gates, vulnerability/incident runbooks and restore drill |

Recommended sequence: first fix Discord access revocation and cross-guild sink routing; resolve private-field semantics; close participant session/login gaps; move quotas before costly work; add answer inspection and runtime validation; then verify browser UX, security headers/proxy behavior, supply-chain gates, and production recovery. Track implementation as small board cards under the repository's isolated-worktree/reviewer process. Preserve exact-head CI and required approval for workflow changes.
