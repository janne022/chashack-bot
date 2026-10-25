# Future investigation and verification backlog

This document preserves work not established by the source review. Pair it with [requirements](plans/security-remediation-requirements.md) and [findings](security-frontend-review-2026-10-23.md). Each investigation should produce a reproducible finding or explicit passing evidence, scope/version/date, screenshots where relevant, and a linked requirement/card. Avoid speculative redesign without evidence.

## Frontend audit matrix — not yet completed

User scope update, 24 October 2026: frontend UX/UI belongs to a separate session.
This security implementation does not claim browser or accessibility acceptance.
That session should consume these backend contracts:

- `POST /api/participant/logout` revokes the participant cookie/session; `POST /api/participant/logout-all` and `POST /api/auth/logout-all` revoke both audiences for the authenticated Discord user. Treat failure as failure and clear private client caches only with accurate feedback.
- Participant OAuth accepts `returnTo=/events/<id>/signup`; the signed state preserves this allowlisted destination. Failure redirects to `/my-hackathons?participant_auth=...`; implement localized recovery there.
- Authenticated registration responses include subject question definitions, including legacy confidential `organizer_only` questions. Public event responses still omit these. Preserve the confidential-answer policy in the requirements; do not turn these into organizer-written internal notes.
- `GET /api/events/:eventId/registrations/:userId` permits current authorized organizers to inspect individual answers. It returns `questions`, `formVersion`, `answers` and `historicalDefinitionUnavailable`; when historical definitions are unavailable, do not label values using current unrelated choices. Read access is audited without answer values.
- Mutations can return `invalid_input` with `field`, `rate_limited` with `retryAfterSeconds`, and a committed departure with `role_revocation_pending`. Handle the committed partial result without falsely restoring the participant or claiming Discord access was removed.
- API/auth responses are `no-store`; UI storage, cross-tab cleanup and stale request cancellation still require frontend work.

Run with synthetic two-guild fixtures, participant + delegated organizer + owner identities, English/Swedish, light/dark and default/Halloween/Christmas themes. Test 320/390/768/1440px, 200%/400% zoom, keyboard-only, reduced motion, slow/offline network and expired permissions. No real personal data in screenshots.

- [ ] Public event: first viewport hierarchy, title/banner/date/timezone, signup open/closed state, missing assets, long localized text, social metadata, invalid/draft/ended events and useful recovery.
- [ ] OAuth: event link -> login -> exact event; cancellation/denial/timeout; multiple tabs; stale state; participant vs organizer identity; account switching; successful logout and failed revocation feedback.
- [ ] Signup: all core/custom question types, confidential fields, required/optional behavior, 2,000-character limit, long options, grouped skills, incomplete drafts, form-version changes, preserved input, double submits, blocked/withdrawn states, first-invalid focus and screen-reader error summary.
- [ ] My hackathons: empty/loading/error, active/ended/withdrawn/blocked events, incomplete vs historical status, sorting, timezone and navigation back to Discord/event/team.
- [ ] Teams: create/join/invite/accept/decline/leave/private team behavior, ownership transfer, full-team races, stale invitations, deleted teams, provision failures, correct next steps and keyboard operation.
- [ ] Organizer shell: navigation consistency, active route, server/event switching, stale selections, mobile sidebar, focus restoration, logout and permission-loss recovery. Check concurrent tabs after guild switch.
- [ ] Events: create/edit/activate/end/reset, dates/ranges/timezones, scheduling, confirmation wording, explicit post-now vs scheduled posting, partial provider failures, save feedback and unsaved-change loss.
- [ ] Form/template editors: question/choice ordering, stable IDs, mappings, private policy language, historical version constraints, portal theme inheritance, apply/save/reset/delete, template reseeding and starter-data clarity.
- [ ] Participants: search/sort/filter/virtualized table keyboard access, long names, individual answer details, imported vs registered identity, assignment and destructive actions, empty/filter-no-match distinction, large datasets.
- [ ] CSV import: encoding/BOM/newlines/quoted commas, oversized/malformed input, mapping ambiguity, source columns/PII, duplicate/conflict handling, review/edit/link identity, cancellation/retry and responsive dialogs. Inspect existing PR53 before duplicating fixes.
- [ ] Matching: preview vs commit revision, explainability without private answer leakage, stale results, concurrent edits, partial Discord provisioning, undo/recovery policy and late participants.
- [ ] Configuration/audit: delegated-role access, safe channel selectors, current actor identity, long audit details, readable timestamps, pagination/filter scope, mobile detail access and no misleading successful status.
- [ ] Accessibility: semantic headings/landmarks, skip link, visible focus/contrast, dialog focus trap/return, no keyboard traps, labels/help/errors, live announcements, table virtualization semantics, touch targets and reduced animation. Automated checks supplement manual assistive-technology testing.
- [ ] Performance: initial/route bundle sizes, Three.js login cost on low-end hardware, layout shift/font/image loading, input lag with large forms/tables, repeated state fetches and SSE reconnect storms. Set budgets based on measured baseline.
- [ ] Browser storage/cache: refresh/back/forward, offline cache, shared-device logout, private responses at CDN/proxy, no stale cross-user/guild renders, multiple-tab selection behavior and service-worker inventory.

## Security investigation

- [ ] Exhaustive route/handler inventory with caller roles, scopes, DTOs, validation and cost class; test ID substitutions across users/guilds/events/teams/requests/templates/imports.
- [ ] Actual Discord permissions after block/leave/withdraw, role hierarchy failures, deleted channels, permission revocation, orphan roles and provider outages. Use an explicitly authorized disposable guild for any live exercise.
- [ ] Race/concurrency: registration close vs submit, form edits vs saved answers, simultaneous invites/joins, team capacity, ownership transfer, match commit replay, scheduled job duplication and multi-instance behavior.
- [ ] Session lifecycle: cookie flags/prefix/path/domain, fixation, expiry, logout-all, account containment, restored sessions, stale OAuth permissions, malformed cookies, callback timeout/replay and multi-tab state.
- [ ] XSS/injection: every HTML/URL/CSS/render/download sink, stored payloads in titles/answers/imports/audit, parameterized SQL and dynamic identifiers, JSON prototype keys, outbound URL/redirect/DNS behavior, CSV formula injection if exports appear.
- [ ] Authorization cache design: revocation latency contract; no stale privileged cache; tenant/user keys; TTL/invalidation/cardinality; whether Redis is needed at all.
- [ ] Load: authenticated GET/member-search/SSE/public-event discovery, early rejection cost, proxies, multiple users/instances, bounded imports/DM fan-out and unavailable limiter/provider/DB behavior.
- [ ] ASVS 5.0 requirement-level applicability/evidence register, with owners and explicit non-applicable reasons. OWASP lists and SSDF mappings alone are not certification.

## Deployment and governance investigation

- [ ] Verify actual ingress DNS/TLS/HSTS/Host routing, allowed domains/callback registration, proxy trust, SSE buffering/timeouts, origin handling and public port inventory.
- [ ] Verify DB role grants/RLS/TLS, no public access, migration-secret separation, network egress, container capabilities/FS/resources and patch policy.
- [ ] Full dependency/transitive advisory audit, historical Git secret baseline, GitHub push protection/branch rules/check requirements, action SHA/provenance/SBOM and registry retention/access. Never print discovered secrets; record location and rotation status only.
- [ ] Backup encryption/access/retention/off-host independence, deletion-ledger durability, measured restore RPO/RTO, session invalidation, Discord reconciliation, rollback and disaster exercise.
- [ ] Privacy data inventory and deletion behavior for ordinary/private answers, imports, member departure, bot uninstall, sessions/audit and backups. Review dietary/accessibility collection minimization and retention language with responsible owner.
- [ ] Incident ownership/contact details, monitoring destination/thresholds, evidence retention and notification assessment; tabletop exercise and alert delivery test. Legal review must be real, not inferred from generated policy text.

## Evidence format

Record: date; exact commit/PR; requirement/card; environment and synthetic fixture; steps; expected/actual; screenshot or safe test output; severity/reachability; fix or non-applicability rationale; reviewer; unresolved operational dependencies. No personal data, tokens, passwords or live connection strings in evidence.
