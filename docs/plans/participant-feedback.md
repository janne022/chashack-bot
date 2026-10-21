# Participant feedback follow-up

## Button-first team journeys (t_4da6d35d)
- [x] Offer current eligible signup actions without slash commands; link incomplete registrations to web completion.
- [x] Add one bot-owned pinned team-channel control panel with current roster/status and owner-authorized invite/settings/requests plus confirmed leave.
- [x] Bind controls to originating event/team and validate current membership, owner, eligibility, capacity, matching and request state server-side. Actual dispatch covers demotion, departure, removed/blocked/incomplete registration, foreign/copied/ended controls and concurrent/replayed joins; leave confirmation binds actor, ephemeral response and current originating panel and is consumed on Leave/Cancel.
- [x] Refresh stored panel after Discord, participant-web, organizer reassignment/settings and manual matching mutations. Transport assertions cover committed source/destination rosters, repeated provision/update, deleted-message recovery, pin denial, closed DMs and domain success despite refresh failure.
- [x] Preserve command fallbacks and public/private request semantics; localize new text en/sv. `discord/button-journey.test.ts` runs signup → create → browse/join request → approval → invite/respond → confirmed leave through actual registered dispatch in both locales, with two guilds/old and new events under a non-owner app role. Discord transport and membership are mocked, not live permission/OAuth evidence.
- [x] Run frozen install, typecheck, build/test (235 PostgreSQL tests) and admin smoke; run the committed-diff hpipe advisory before publication.
- [ ] Exact-head CI, original reviewer's targeted QA266 repair verification, then planner acceptance/delivery (not implementer self-approval).

## Rate limiting (t_b138ccef)
- [x] PostgreSQL fixed-window quotas shared by organizer HTTP and Discord actors; injectable clock, atomic concurrent consumption, bounded expired-row cleanup.
- [x] Limit authenticated ordinary mutations (30/minute actor+guild), expensive invite/provision/match operations (5/minute actor+guild), and public/OAuth/API requests (60/minute trusted source address); never trust forwarded IP by default.
- [x] Denials occur before domain/outbound effects; authorization failures do not consume another actor's quota; HTTP returns structured 429 + Retry-After and Discord returns localized retry feedback.
- [x] Cover HTTP and Discord mutation paths, including safe DM context; keep health/static traffic separate.
- [x] Add deterministic unit and disposable PostgreSQL tests for window boundaries, retry, concurrency and independent identities; run frozen install, typecheck, build, test, smoke and hpipe checks.
