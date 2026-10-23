# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

The participant surface is Discord (slash commands, modals, DMs, team channels);
participant-facing OAuth identity and self-scoped API work is planned, not a signup
form or team-management web UI. The organizer console is served by the bot on `ADMIN_PORT`.

## Users

- **Primary: the event organizers at ChaS** — the developer-owner plus a handful
  of helpers running one hackathon weekend live. They work from the admin console
  (and the `/hackathon admin …` commands) while the event is in progress.
- **Participants: students**, using Discord for signup, team creation/joins,
  invitations and team spaces. Participant OAuth identity and self-scoped API are
  planned; forms and team management remain in Discord.

Organizers sign in with Discord OAuth. Current guild owner/Administrator or
configured delegated roles can manage a guild where the bot is installed; the
shared-password and env-guild authorization paths are removed. The session signing
secret is required explicitly; rotating it revokes every session.

## Product Purpose

Run a ChaS hackathon end to end: signup window → team formation → team spaces →
the weekend itself (schedule posts, assignments, matching) → teardown, with the
organizer console as mission control. Success is an event that runs itself on
timers, where organizers intervene only when they choose to.

## Positioning

The whole weekend is one scheduled, reversible flow inside Discord. Competing
tools either automate team formation alone or require running a separate event
platform; here the bot owns the timeline (signup window, hackathon start/end,
per-block actions), provisions real Discord roles and private channels per team,
and tears every one of them down on cleanup. Any community could copy the
matching algorithm; the mechanism worth preserving is the schedule-driven,
self-cleaning weekend.

## Operating Context

- Multiple Discord guilds share one bot and PostgreSQL database; every organizer
  request is scoped to a freshly checked guild membership and role authority.
- The **schedule is the source of truth**: pinned Hackathon Starts / Signup window
  / Hackathon Ends blocks plus middle blocks carry the actions (announcements,
  post signup, lock teams, auto-match, distribute assignments) that fire at their
  time. Activating an event only flips its status; nothing is posted on Activate.
- Events are set up from **templates** (event / form / announcement / assignment
  collection), whose schedules are anchor-relative so the same template works for
  any dates. Each guild's Themes library starts with persisted Default, Halloween
  and Christmas appearances; organizers can apply, customize or delete them.
  Event appearance remains a snapshot when a saved theme changes.
  Signup panel messages are tracked per event, including when two active events
  share a Discord channel; refreshing one never replaces the other's controls.
- Organizers also work through Discord itself: `/hackathon admin` for
  block/unblock/remove, moving participants, category, match preview/commit,
  reset; `/hackathon auto-match at:` for a scheduled match.
- Runtime: one Node process (bot + API + static console), backed by PostgreSQL
  only (restricted `DATABASE_URL` and separate `MIGRATION_DATABASE_URL` are required);
  `SKIP_DISCORD=1` is for tests/smoke only and cannot authorize organizer requests.
  PostgreSQL enforces fail-closed guild RLS with transaction-local context.
- Both languages are shipped: `en` + `sv` for the console, and bot copy is
  localized too.

## Capabilities and Constraints

Confirmed functionality (the README is the detailed inventory; this is the shape):

- Signup form is **admin-configurable** and the Discord modal rebuilds from it on
  every open; skills are grouped so mutually exclusive picks are distinguishable.
- Team formation is a deterministic, pure scoring engine (0–100 pairwise: skills,
  complementary role tracks, experience mix, friend pulls) with mutual friend
  mentions as a hard constraint and one-way mentions as soft preference; preview →
  conflict report → commit, never written until committed, and re-runnable.
- Team spaces: every team (created or matched) gets a colored role + private text
  and voice channels under an organizer-chosen category, with welcome messages and
  full teardown on delete/reset/cleanup.
- Participants can create, invite, request to join, rename, flip public/private,
  change color, share a join code, and leave; owners get DM accept/decline flows
  with in-bot inbox fallbacks.
- Assignments: a pool authored in a collection is dealt to team channels at
  hackathon start (`random` per team or `same` for all).
- Audit log of every mutation; event reset clears participants and teams but keeps
  the form config.

Constraints and deliberate limits:

- **Guild-scoped organizer authority.** Fresh bot membership and owner/admin or
  delegated-role checks are required on each API request. PostgreSQL RLS separately
  excludes foreign tenant rows even when a SQL query omits its guild filter;
  session identity/subject authorization remains the application's responsibility.
- **Swedish is a first-class language** for both participants and organizers —
  new user-facing copy ships in `en` + `sv` together.
- **Participant web flows** provide published-event signup completion, a
  self-scoped My hackathons view, and eligible team create/join/invite/respond/leave
  actions. Discord remains the identity and community boundary; the same
  participant actions remain available there, including DM-closed fallbacks.
- **Everything provisioned is torn down** — team roles, channels and matched
  teams are removed by cleanup on the configured delay, so an event leaves no
  residue.
- Supply-chain policy is part of the product contract: every dependency exact-
  pinned with a 3-day minimum release age, install scripts refused.
- No participant analytics, rankings, social features, or cross-event identity:
  participants are per-event rows, not a user database.

## Brand Commitments

- Name: **ChasHack** (ChaS = the school; the hackathon is the product's reason to
  exist). Repo/app names stay `chashack-bot`.
- Existing identity asset in use: `apps/admin-ui/src/assets/brand/1.png` used as
  the console's brand mark.
- Voice: plain, operational, second person, no hype — the console talks to an
  organizer mid-event, under time pressure.
- The console's established in-repo world ("Honeycomb playtech": dark-first,
  `--accent/-soft`, display font, hex/hero motifs) is incumbent identity, not a
  brief; future visual work preserves or deliberately replaces it as a whole.

## Evidence on Hand

- Real, runnable code: bot (`apps/bot`, TypeScript, vertical slices), console
  (`apps/admin-ui`, React 19 + Tailwind 4 + Radix), `node:test` suite, API smoke
  script (`apps/bot/scripts/smoke-admin.mjs`), seeded demo (`scripts/dev-admin.mjs`).
- Real product copy in both languages (`apps/admin-ui/src/lib/i18n/{en,sv}.json`)
  and the bot's own i18n; default signup form and seeded templates as shipped.
- Architecture notes: `docs/ARCHITECTURE.md`; feature inventory: `README.md`.
- Absent, and not to be invented: participant counts, testimonials, case studies,
  press, customer logos, benchmarks against other tools, pricing or licensing
  claims.

## Product Principles

1. **The weekend is the unit of design.** Every capability must state where it sits
   on the event timeline (before signup, at signup open, at start, during, at end,
   after cleanup) and who acts there.
2. **The schedule is the source of truth.** Timed, idempotent actions fire the
   posts; manual buttons are conveniences, never the mechanism.
3. **Discord is the participant boundary.** Participant web identity uses
   identify-only OAuth and fresh guild membership checks; Discord signup and team
   flows remain available, including DM-closed fallbacks.
4. **Provisioning is reversible.** Anything the bot creates for an event can be
   torn down by the bot, and cleanup is the default end state.
5. **Swedish parity is a release gate**, not a translation backlog: a feature that
   ships in English only is not shipped.
