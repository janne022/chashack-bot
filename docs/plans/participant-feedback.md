# Participant feedback follow-up

## Button-first team journeys (t_4da6d35d)
- [x] Offer current eligible signup actions without slash commands; link incomplete registrations to web completion.
- [x] Add one bot-owned pinned team-channel control panel with current roster/status and owner-authorized invite/settings/requests plus confirmed leave.
- [x] Bind interactions to originating event/team and re-check current membership, owner, eligibility, capacity, matching and request state server-side.
- [x] Refresh stored panel after successful Discord and participant-web invite/join mutations; existing creation, matching, assignment and leave paths also refresh. Remaining mutations and recovery claims require final QA acceptance.
- [x] Preserve command fallbacks and public/private request semantics; localize new text en/sv. End-to-end dispatch regression breadth remains under QA verification.
- [ ] Run frozen install, typecheck, build/test, smoke, hpipe and exact-head CI; independent same-card QA then planner delivery.

## Rate limiting (t_b138ccef)
- [x] PostgreSQL fixed-window quotas shared by organizer HTTP and Discord actors; injectable clock, atomic concurrent consumption, bounded expired-row cleanup.
- [x] Limit authenticated ordinary mutations (30/minute actor+guild), expensive invite/provision/match operations (5/minute actor+guild), and public/OAuth/API requests (60/minute trusted source address); never trust forwarded IP by default.
- [x] Denials occur before domain/outbound effects; authorization failures do not consume another actor's quota; HTTP returns structured 429 + Retry-After and Discord returns localized retry feedback.
- [x] Cover HTTP and Discord mutation paths, including safe DM context; keep health/static traffic separate.
- [x] Add deterministic unit and disposable PostgreSQL tests for window boundaries, retry, concurrency and independent identities; run frozen install, typecheck, build, test, smoke and hpipe checks.
