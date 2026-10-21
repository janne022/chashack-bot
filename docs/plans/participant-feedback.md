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

## SSE invalidation (t_c2833b53)
- [x] PostgreSQL row triggers cover Discord/service, participant HTTP, organizer, matching and maintenance writers; NOTIFY is commit-only and carries scope identifiers, not values. One lazy shared LISTEN connection per app handle, released on final disconnect/shutdown; listener loss disconnects streams for authoritative reconnect.
- [x] Same-origin, separate cookie audiences, current membership/admin/session checks before hints and every 10 seconds (8-second deadline covers authorization and audience filtering; authority is rechecked after filtering). Initial limits: 2 streams/session, 1000/process. Browser events contain only `{}`; no replay history, snapshots, credentials or client polling.
- [x] Reuse existing audience loaders, coalesce refreshes, abort previous selection reads, refresh on reconnect/refocus, preserve dirty signup/config inputs and organizer dialog nodes. Localized en/sv reconnect/disconnected feedback and explicit retry after bounded denial/failure.
- [x] App-role/RLS fixtures cover two tenants and two active events, private/foreign/rollback hint exclusion, own public teams/invitations, role/member revocation, logout and expiry. Served Chromium journey checks two audience clients, committed service/HTTP changes within 5 seconds, listener-loss/refocus recovery, dirty input/focus, English desktop and Swedish mobile. OAuth sessions, membership and Discord service actor are synthetic, not live OAuth/Discord evidence.
- [x] Bounded QA repair: a held signup-save response cannot mark newer edits clean; served browser regression preserves their value/node/focus through refocus and saves the newer draft. Actual participant-route app-role/RLS regression stalls membership filtering, deletes the session, verifies bounded closure and rejects the late lookup result.
- [ ] Final committed-diff advisory gates and exact-head CI, genuine same-card QA, planner acceptance and native rebase delivery. No implementer merge or self-approval.
