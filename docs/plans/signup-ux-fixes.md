# Signup UX fixes plan

## Scope

Resolve the six reported participant and organizer issues while preserving guild/event scoping, the schedule as the source of truth, existing custom themes, and English/Swedish parity.

## Work items

- [x] Replace numeric-ID team invitations with Discord's native user picker and preserve the existing authorization and eligibility checks; add interaction regression coverage.
- [x] Trace scheduled signup posting end to end, report delivery failures truthfully, and verify the existing `/hackathon-admin panel` post-now action; test with a fake Discord client.
- [x] Trace event form appearance from editor through persistence and participant rendering; preserve an explicit light-mode choice and add regression coverage.
- [x] Fix selected and hovered tag autocomplete contrast in both themes.
- [x] Seed Default, Halloween, and Christmas as guild-scoped theme templates idempotently without restoring intentionally deleted entries on reads; expose them in the existing theme/apply flows.
- [x] Make imported signup mapping and review dialogs responsive at 390px and desktop, including long Swedish labels.

## Verification

- [x] Add targeted regression tests for backend/domain behavior and UI behavior where the repository's test setup supports them.
- [x] Run available targeted tests and type checks. Record database, browser, or CI verification that cannot run in this environment.
- [x] Review the diff for localization parity, guild scoping, and accidental lifecycle changes.

Local verification on Windows used PostgreSQL 16 in an isolated `chashack_ux_test`
database and synthetic Discord transport/session fixtures. The bot suite passed
253 tests; after extending manual/HTTP panel binding, 30 affected posting,
interaction and RLS checks passed. The UI color suite passed all four tests.
Bot TypeScript compilation, UI TypeScript checking and Vite production build
passed. The served organizer journey passed 114 assertions and the participant
journey passed 61, with no uncaught browser exceptions. API smoke passed.
Import geometry was checked at 390, 768 and 1440 pixels; selected tag contrast
was measured in both themes and participant dropdown palettes in both modes.

Frozen installation succeeded with the exact pinned pnpm via
`npm exec --package pnpm@12.3.4 -- pnpm install --frozen-lockfile`. The older local
pnpm launcher could not resolve the correct Windows binary. The existing root
build/typecheck wrappers also fail at their unpinned `router-cli` fallback on
Windows, so the checks above invoke installed TypeScript/Vite directly; Vite's
existing router plugin generates routes. No pins, dependencies, cooldown,
instruction files or CI workflows were changed. `impeccable detect` could not run
because that executable is not installed. Browser cleanup required closing only
the Chrome processes owned by these checks because the existing harness uses
Unix process-group signals. Live Discord delivery/OAuth was not exercised.

The single same-card qa-judge review found that a guild-wide panel reference could
replace another active event's message. The bounded repair keys references by
guild and event, uses legacy references only as channel fallbacks, and makes
notification fallback readers prefer the event's panel. Targeted verification
passed 31 posting, interaction and RLS checks, including two active events sharing
a channel, independent refresh/movement and preservation of a legacy message.
Targeted verification also exposed the Discord activation caller omitting the
selected event ID. Both its explicit-channel and refresh branches now pass the
activated event's form and ID. The same two-event regression invokes the real
activation handler for an older event and verifies both branches preserve the
newer event's reference; all three notification tests pass after this completion.
