# Participant feedback follow-up

## Button-first team journeys (t_4da6d35d)
- [x] Offer current eligible signup actions without slash commands; link incomplete registrations to web completion.
- [x] Add one bot-owned pinned team-channel control panel with current roster/status and owner-authorized invite/settings/requests plus confirmed leave.
- [ ] Bind every interaction to originating event/team and validate current membership, owner, eligibility, capacity, matching and request state server-side (partial implementation; broad negative dispatch coverage outstanding).
- [ ] Refresh stored panel after all successful Discord, participant-web, organizer and matching mutations; deletion/pin/DM failure recovery remains to verify.
- [ ] Preserve command fallbacks and public/private request semantics; localize new text en/sv. Full create/browse/join/invite/respond/leave dispatch regression remains outstanding.
- [ ] Run frozen install, typecheck, build/test, smoke, hpipe and exact-head CI; independent same-card QA then planner delivery.

## Rate limiting (t_b138ccef)
- [x] PostgreSQL fixed-window quotas shared by organizer HTTP and Discord actors; injectable clock, atomic concurrent consumption, bounded expired-row cleanup.
- [x] Limit authenticated ordinary mutations (30/minute actor+guild), expensive invite/provision/match operations (5/minute actor+guild), and public/OAuth/API requests (60/minute trusted source address); never trust forwarded IP by default.
- [x] Denials occur before domain/outbound effects; authorization failures do not consume another actor's quota; HTTP returns structured 429 + Retry-After and Discord returns localized retry feedback.
- [x] Cover HTTP and Discord mutation paths, including safe DM context; keep health/static traffic separate.
- [x] Add deterministic unit and disposable PostgreSQL tests for window boundaries, retry, concurrency and independent identities; run frozen install, typecheck, build, test, smoke and hpipe checks.
