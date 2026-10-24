# Security, reliability and frontend requirements

Source assessment: [23 October review](../security-frontend-review-2026-10-23.md). This is the durable implementation contract for the user's full-app request, including Luna deployment/supply-chain findings. Related unknowns belong in [investigation backlog](../security-frontend-investigation-backlog.md). Do not mark a requirement complete merely because code compiles or a document describes an intended control.

## Working agreement and status

Scope update, 24 October 2026: the user assigned frontend UX/UI to another session.
This branch implements security/backend/deployment work and preserves frontend
requirements as an explicit handoff; frontend acceptance remains unchecked.

Each requirement needs implementation evidence, relevant negative tests, and verification limits. Use identifiers below in commits, PRs and board comments. States: `[ ]` pending, `[x]` implemented and locally verified; deployment-dependent acceptance remains separately open. Preserve existing work and PostgreSQL data. No production Discord actions or live database verification. No automatic merges. Follow AGENTS.md board/worktree, 1800-second worker bound, one same-card independent review and one bounded repair. Any new dependency needs review; workflow merge approval remains required.

The initial review was source-based: it did not certify OWASP/ASVS/NIST compliance, visual accessibility, historical Git secrets, actual firewall exposure, or production restores. Backend compilation and frontend type checking passed; 20 auth/form tests passed and two DB fixture tests lacked DATABASE_URL. Those are baseline facts, not acceptance for new work.

Existing related work: board t_24129f79 / PR53 (invitations, signup posting, theme/import usability, seed behavior), and t_e045faf5 (calendar selection). Inspect exact branches before duplicating or integrating them. Existing user route-tree edits are not owned by this task.

## Policy decisions

- Participant identity is always the live session's Discord ID. Guild/event/team IDs select objects, never grant authority.
- Organizers may inspect individuals' form submissions within authorized guilds/events. Other participants must not receive confidential answers.
- Legacy `organizer_only` dietary/accessibility answers are participant-supplied confidential answers, readable/editable by their subject and authorized organizers, as existing backend tests require. Public metadata hides these questions; authenticated subject metadata must expose them. Rename misleading UI copy. True organizer-written internal notes require an explicit distinct permission/storage policy; never silently reinterpret existing personal answers.
- Signup opening/closing times govern new registrations/reactivation. Define existing-registration edit behavior explicitly and consistently across web and Discord; withdrawal remains available independently of signup admission.
- Production uses one canonical HTTPS origin by default; aliases redirect there. Independent origin support requires explicit allowlists, registered callbacks and same-origin cookie boundaries, never wildcard credentialed CORS.
- No report may claim production backup recovery, monitoring or privacy compliance based on fixture tests alone.

## Access control and lifecycle

- [ ] SEC-01 (F1): block/withdraw/remove revoke former Discord team access on all entry points. Capture old team before clearing membership; preserve correct owner transfer/empty-team cleanup; record side-effect failures and support retry/reconciliation. Acceptance: web block, organizer removal, self-withdraw, Discord block/remove; no cross-guild cleanup; failed Discord call cannot falsely report completed revocation.
- [ ] SEC-02 (F2): audit/announcement sinks enforce source-guild ownership. Global fallback cannot send guild A rosters into guild B. Acceptance: same-guild send succeeds, foreign/DM destination refuses, missing destination is explicit. If adding guild settings, update DDL/migration/type/readers/API/UI and en/sv.
- [ ] SEC-03 (F3): encode confidential-answer policy above. Authenticated form projection includes subject questions; public projection excludes confidential definitions/answers; write validation rejects unknown/protected fields. Add tests for omission, injected IDs, another user, another guild, stale version and confidential matching exclusion. Internal notes remain separate.
- [ ] SEC-04: maintain full endpoint inventory and negative authorization matrix for anonymous, participant, delegated organizer, owner/admin, demoted user, removed member, revoked session and foreign guild/event/team/request IDs. Include bulk reads/imports/export-like endpoints and SSE. Existing RLS tests are a starting point, not exhaustive coverage.
- [ ] SEC-05: enforce DB invariants for statuses/kinds/ranges, tenant relationships and JSON validity with safe migrations. Inspect existing rows without printing personal data; do not repair/delete inconsistent real data automatically. Restricted application role must remain non-owner/NOBYPASSRLS and fail startup when unsafe.
- [ ] SEC-06: keep SQL in feature data modules; use parameters for every payload value. Audit any dynamic identifiers against fixed allowlists. Do not replace PostgreSQL fixtures with a mock/in-memory runtime.

## Authentication, sessions and browser boundary

- [ ] AUTH-01 (F5): participant logout deletes the participant session and clears its cookie; organizer logout reports failure honestly. A session row deletion invalidates reads, writes and open streams. Provide both audiences a visible logout control with en/sv feedback.
- [ ] AUTH-02: implement safe logout-all/user containment with authorization and auditable actor identity. A revoked local session alone does not stop compromised Discord OAuth from issuing new sessions. Document upstream account/token containment and signing-key rotation; never expose session tokens in a listing.
- [ ] AUTH-03 (F6): preserve allowlisted relative event return paths through OAuth state; successful participant login returns to signup, fallback to My hackathons. Reject absolute/protocol-relative destinations, malformed encodings and cross-audience state. Participant cancellation/failure has its own localized retry screen, not organizer login.
- [ ] AUTH-04 (F12): validate canonical/public and callback URLs, compare complete origins, enforce production HTTPS and secure host-only cookies; implement explicit missing-Origin policy and Fetch Metadata/CSRF defenses without breaking documented clients. Tests include sibling origins, schemes, null/missing Origin, spoofed Host and invalid configuration.
- [ ] AUTH-05: proxy trust is explicit and limited to trusted hops. Source quotas must not collapse all reverse-proxy visitors nor trust arbitrary X-Forwarded-For. SSE uses the same canonical origin policy and works behind TLS offload. OAuth requests have bounded timeouts and sanitized errors.
- [ ] AUTH-06: security headers include tested CSP/frame-ancestors, nosniff and referrer policy; HSTS belongs on verified HTTPS ingress. Account for theme initialization and images/portals rather than adding unsafe wildcard policies. Verify actual served headers.

## Capacity, caching, input and errors

- [ ] CAP-01 (F4): early source/session quotas precede expensive Discord/DB authority work. Include authenticated reads and explicit cost classes for searches, matching, imports, invitations, channel provisioning, announcements/DM fan-out and scheduled Discord events. Return Retry-After, fail closed on limiter failure, bound concurrency and retries. Keep revocation semantics when optimizing membership checks.
- [ ] CAP-02: paginate participants, answer listings, audit and imports; limit request bytes, import rows/cell lengths, array sizes, search lengths, outbound requests and SSE connections. Avoid O(all guilds) lookup work where a trusted indexed inventory can safely resolve the event. Load testing must not contact production Discord.
- [ ] CACHE-01 (F11): private/authenticated API responses and relevant errors use no-store; hashed static assets can be immutable and HTML must revalidate. Verify proxy/CDN policy and back-button/logout behavior. No sensitive service-worker/offline persistence. Redis is optional until an actual bounded cache consumer exists.
- [ ] CACHE-02: scope stored UI selection by guild/user or clear it on switch/logout. Reject unavailable stored event selections and recover to a valid event. Abort/sequence old requests to prevent stale renders across event/tenant changes.
- [ ] VAL-01 (F9): consistent runtime validation for params/query/body on every endpoint. TypeScript assertions do not validate JSON. Bound strings, numbers/dates, enums and arrays; allowlist mutable fields and guild-owned Discord destinations. Domain invariants must apply to bot and web. Malformed payloads return controlled 400s, not 500s or partial writes.
- [ ] VAL-02: common safe error envelope with stable code, localized client mapping, field errors and retry metadata. Never return raw provider/DB exceptions or log tokens, cookies, private answer bodies or entire requests. Preserve request correlation for diagnosis.
- [ ] VAL-03 (F7): enforce signup windows centrally. Boundary tests cover before opening, exact opening, exact closing, after closing, existing edits/reactivation, withdrawal, event inactive, blocked user and Discord/web parity.

## Audit and organizer form inspection

- [ ] AUD-01 (F10): web mutations record authenticated Discord actor ID and source; names are display snapshots, never authority. User cannot supply actor through payload. Preserve old unknown actors honestly. Update host-auth RLS policy safely if actor representation changes.
- [ ] AUD-02: audit UI shows readable identity plus stable ID, expandable details and paging/filtering. Sensitive read/export audit is explicit. Events include mutation outcome/correlation; logs omit private answers. Restrict app UPDATE/DELETE of audit rows and design a separately protected monitoring sink.
- [ ] FORMS-01 (F8): admin participant details shows individual answers, localized question/choice labels, form version, completion and privacy labels. Load only authorized selected event/person. Support ordinary and imported signups without conflating records. Empty/missing/historical/deleted answers are explicit. Keyboard focus and mobile layout verified.
- [ ] FORMS-02: historical answers require historical definitions or truthful unknown-ID rendering. Do not label old answers using unrelated current options. Export, if added, must enforce authorization/no-store, audit access and protect against spreadsheet formula injection.

## Functional/frontend requirements

- [ ] UX-01 (F13): scheduled assignments query by event ID and use textChannelId. Assert actual adapter delivery, same/random mode, missing channels, errors, idempotent retry and truthful audit. Before enabling remote attachments, prevent SSRF/private/link-local targets, unsafe redirects and unbounded downloads; safe links/controlled assets are preferred.
- [ ] UX-02 (F14): frontend errors preserve input and expose field guidance, 429 countdown, stale/offline state and retry. Text questions enforce/display 2,000-character bounds. Focus the actual first invalid field; labels/help/errors are accessible. Preserve edits during background refresh and version migration.
- [ ] UX-03: ended events display closed/read-only history instead of spurious action-needed/ineligible guidance. My hackathons avoids N+1 unavailable detail requests and handles withdrawn/blocked states deliberately.
- [ ] UX-04: templates seed once explicitly; deleting last template must not resurrect it. Examples must look like starter content. Reuse existing PR53 work where applicable; default/Halloween/Christmas theme behavior and import layout are not lost.
- [ ] UX-05: en/sv parity for every new or changed user string, including server errors, loading, empty, permission-denied, retry, assignment editor and public fallback. Retain design-system tokens and document changed visual patterns.
- [ ] UX-06: perform the complete browser/frontend investigation backlog before declaring the whole frontend reviewed. Screenshots, keyboard/screen-reader checks and responsive checks are distinct from API smoke.

## Supply chain, CI and release

- [ ] SUP-01 (F15): update Fastify from 5.12.3 to a reviewed patched release covering GHSA-4mh8-r7rc-xpvc and GHSA-389g-gv7q-r4x8; preserve exact pins, frozen lock and release cooldown. Review transitive advisories and actual exposure, not just version age. No new dependency without review.
- [ ] SUP-02: continuous dependency vulnerability scanning with severity/exception/expiry policy; maintained secret scanning with full-history baseline plus PR protection; verify repository push protection separately. Pin Actions by SHA and preserve existing CI/release checks. Workflow edits require attended approval before merge.
- [ ] SUP-03: image scanning, SBOM/provenance and immutable deployment references; controlled updates and rollback. Do not equate scanners with runtime intrusion monitoring. All required checks and independent review must match exact final PR head.
- [ ] MON-01: structured privacy-safe runtime signals and actionable alerts for auth denials, quota saturation, provider failures, failed Discord revocation/deletion/maintenance, unusual bulk reads and backup failures. Define owner, threshold and test alert delivery; avoid alert storms and PII leaks.

## Deployment, privacy and recovery

- [ ] DEP-01 (F16): publish reviewable Compose/proxy configuration: only TLS edge publicly bound; private PostgreSQL and optional Redis; non-root app, dropped capabilities/no-new-privileges, tested read-only/tmpfs, resource/PID limits, health checks/restart/shutdown, persistent volumes. Separate runtime and one-shot migration credentials. Never commit real secrets or assume unsupported _FILE handling works.
- [ ] DEP-02: document canonical domain/aliases and independent-domain requirements; callback registration, host allowlist, origin handling, TLS proxy/SSE and rate-limit integration tested together. Bind host-side API to loopback where appropriate; no public DB/debug dashboards. Actual deployment firewall/TLS/storage evidence remains an operator acceptance gate.
- [ ] REC-01 (F17): backup/restore scripts/runbook with encrypted off-host storage, least-privilege credentials, retention, RPO/RTO and isolated restore verification. Replay deletion ledgers from outside the restored snapshot and invalidate restored sessions before traffic. Verify schema/roles/RLS/row relationships and Discord reconciliation; do not claim success from a fixture copy.
- [ ] GOV-01: data inventory, purpose/minimization, permissions, retention/deletion and export policies for registrations, sensitive dietary/accessibility data, CSV imports, logs/sessions/backups. Legal/contact placeholders must be resolved by the responsible owner. No invented legal approval.
- [ ] IR-01: incident runbook with named ownership/contact fields, triage/severity, safe evidence preservation, containment (sessions/user/Discord/OAuth/bot/DB credentials), recovery, notification assessment and post-incident fixes. Exercise it with synthetic data. Real owner/contact/notification decisions remain open until supplied.

## Definition of done

For each implementation slice: record requirement IDs, files, migration/compatibility effects, tests with results, remaining limits and board/PR identifiers. Build before dist tests; disposable connected PostgreSQL *_test/_ci only; run frontend typecheck/build and targeted real-browser journeys. Security changes need negative tests and two-user/two-tenant coverage. Preserve release cooldown and every existing CI check. One independent same-card qa-judge review, one bounded repair, targeted verification, exact-head published review and green CI. No merge without the repository's required operator approval.

## Implementation ledger

Branch `codex/security-remediation`, board card `t_33947af2`, isolated worktree
`.worktrees/t_33947af2`. No production database or Discord account is used for
verification. Append exact test outcomes below before release. Broad checkboxes
remain open where only part of their acceptance criteria is established.

### Implemented security changes awaiting final verification

| Requirements | Implementation | Remaining acceptance |
| --- | --- | --- |
| SEC-01 | Block/withdraw detach membership with owner transfer; Discord cleanup failures are explicit; transactional tenant-scoped revocation outbox provides bounded retries | Live disposable-guild permissions and multi-instance/rejoin races |
| SEC-02 | Global announcement sink refuses destinations outside the source guild | Live adapter/Discord delivery evidence |
| SEC-03, FORMS-01/02 | Authenticated subjects receive their confidential question definitions; current organizers can inspect individual answers with privacy-safe read audit and honest historical-definition gaps | Frontend individual-answer view, historical schema storage |
| AUTH-01/02/03 | Participant logout and self logout-all delete session rows; logout-all is audited; signed expiring allowlisted OAuth return path | Frontend controls/recovery; upstream Discord account containment remains operational |
| AUTH-04/05/06 | Canonical full-origin comparison, production HTTPS validation, exact callback path, explicit proxy trust, Fetch Metadata, bounded OAuth fetch, frame/object/base/form CSP, nosniff/referrer headers | Full script CSP and production TLS/proxy/browser evidence |
| CAP-01/02 | Early shared PostgreSQL source/read/write/expensive quotas, body and baseline array/string bounds, request timeout | Complete route cost inventory, pagination, global concurrency and load evidence |
| CACHE-01, VAL-01/02 | No-store API/auth errors and successes, malformed-cookie rejection, baseline runtime mutation shape checks, generic server error envelope | Endpoint-complete DTO validation, private frontend caches and tested full CSP |
| VAL-03 | Shared signup-window gate for new/reactivated registrations; existing active edits remain allowed | All cross-interface boundary evidence |
| AUD-01 | Organizer mutation actors use authenticated Discord IDs rather than generic web actor; host authentication audit retains its narrow RLS policy | Frontend name rendering; immutable external monitoring sink |
| UX-01 | Scheduled assignment event/channel selection corrected; remote image attachment fetch removed; delivery audit supports retries | Live delivery and multi-worker job concurrency |
| DEP-01/02, REC-01, GOV-01, IR-01 | Private DB Compose, separate migration/runtime credentials, secret-file entrypoint, hardened app, encrypted backup scripts, recovery/deletion replay and operational ownership/privacy/incident runbook | Real deployment, encryption-key recovery, restore drill, assigned contacts/RPO/RTO and alert delivery |

### Dependency and release evidence

Fastify is pinned to 5.12.7 with compatible transitive patches and the frozen
lockfile refreshed. The isolated frozen install retained the 4,320-minute
release cooldown and completed successfully. The dependency audit after these
updates reports **one high, zero critical** findings: `body-parser@2.3.0`,
GHSA-27r3-jxmh-p828, via the MCP SDK Express adapter. No safe compatible 2.x
release predates 2.4.0. The recorded registry publication time for 2.4.0 is
2026-10-22 11:39:38 UTC; cooldown expires **2026-10-25 11:39:38 UTC**.
Recheck the registry/advisory and update after that time, regenerate the lockfile,
then rerun audit/build/tests. The high-severity gate remains failing; no exception
or cooldown bypass is authorized by this document.

CI changes add dependency auditing, full-history secret-scanner checkout, SHA
pins and image SBOM generation. These are configuration changes, not proof of a
clean historical scan, image scan or branch protection. Workflow merge still
requires janne's attended approval; no merge or deployment is performed here.

### Local verification, 24 October 2026

- Backend build passed; complete PostgreSQL suite passed **261/261** before the
  independent review repair. API smoke passed all ten assertions.
- Same-card independent Luna qa-judge identified missing outbox coverage for
  leave/kick/move. The bounded repair moved enqueue into the common membership
  removal transaction. Backend rebuild and focused lifecycle/team suites passed
  **35/35**, including five new leave/kick/unassign/move retry tests.
- Admin UI TypeScript check, Vite production build and four existing UI unit
  tests passed. Route generation now uses the already-locked router generator;
  the previous unpinned `npx` download fallback is removed.
- Hardened Docker image built from the recorded Node digest. A container with
  read-only root filesystem, all capabilities dropped and no-new-privileges ran
  as UID 10001; deployment secret paths were absent. This is an image smoke
  check, not a production deployment or authenticated journey.
- Compose default and recovery-profile configuration validation passed. Caddy
  config validation passed in a network-isolated container after correcting
  `email` to the global options block. Docker context explicitly excludes
  deployment secrets and local production env files.
- Existing browser harness could not complete on Windows: after setting the
  installed Chrome path, its synthetic startup test stalled in Unix process-group
  cleanup. Owned test processes were stopped. Browser acceptance remains open;
  do not claim that API smoke proves frontend behavior or accessibility.
- Production restore, actual external port/TLS checks, alert delivery, legal
  policy sign-off, GitHub branch protection and full ASVS requirement-by-requirement
  acceptance remain open. The dependency high-severity gate remains blocked as above.
