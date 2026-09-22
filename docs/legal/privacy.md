STATUS: DRAFT — requires review by a qualified person before publication

# Privacy policy

HackBuddy is a Discord bot and a small organizer web console. Schools and other
organizations invite it to their Discord server to run a hackathon. This page explains
what we store, why, and how to get rid of it.

Short version: we store what a hackathon needs, nothing more. No ads. No profiling.
No selling or sharing your data. No tracking scripts on our web pages.

## Who is responsible

Two parties, clear roles:

- **The organization running the event** (usually a school) decides what the bot
  collects, who can see it, and when it should be deleted. They are the *data
  controller*.
- **We (the service operator)** run the server the bot lives on. We process the data
  on the organization's behalf and do not use it for anything else. We are the *data
  processor*.

If you are a participant and you want something changed or deleted, ask your
organizers first — they control the data. You can also contact us directly; see
*Contact* below.

## Where the data lives

The service is hosted **inside the European Union**, and the data stays there.

Data is stored in the service's own database (SQLite today, PostgreSQL for the hosted
deployment). Only the software itself reads it — there is no third-party database, no
cloud analytics product, no ad network anywhere in the stack.

## What is collected, and why

Only what is needed to run a hackathon. The full list, taken from the actual
database schema (`apps/bot/src/shared/db.ts`):

**Your Discord identity.** When you sign up for an event we store your Discord user
id, the display name you used, and (for organizers signing in to the web console) your
username and avatar. We need the id to know who is on which team, and to create and
clean up team channels and roles on the Discord server.

- `participants.user_id`, `participants.display_name` — every participant.
- `participants.guild_id`, `participants.created_at`, `participants.updated_at` —
  which server the entry belongs to, and when it was created or last changed.
- `web_sessions.user_id`, `web_sessions.username`, `web_sessions.avatar` —
  organizers using the web console.
- `web_sessions.guild_ids`, `web_sessions.selected_guild_id` — which servers a console
  session may manage, and which one it is currently showing.

**Your signup answers.** Whatever the event's signup form asks: your experience
level, role track, skills, whether you want a team, and who you would like to team up
with. Your organizers choose these questions — we do not add any of our own.

- `participants.experience`, `participants.role_track`, `participants.skills`,
  `participants.team_pref`, `participants.teammates`.

**Team stuff.** Which team you are on, who asked to join which team, and the team's
name, join code, and Discord channel/role ids. This is how team matching and team
channels work.

- `participants.team_id`, `participants.status`, `participants.block_reason`
  (used if an organizer blocks a signup),
  `teams.*` (name, kind, `owner_id`, `join_code`, `role_id`, channel ids),
  `team_requests.*` (who requested, who was the target, kind, status, timestamps).

**Event and schedule data.** The event's name, description, times, signup windows,
signup form, schedule, and announcements. This belongs to the event, not to you
personally — but parts of it (like your match assignment) are about you.

- `events.*` (including `form_json`, `schedule_json`, `announcements_json`,
  `assignments_json`), `event_templates.*`, `guild_settings.*` (per-server settings).

**Log-in sessions.** When an organizer uses the web console, a session row is kept
for 7 days (`SESSION_TTL_MS` in `apps/bot/src/features/auth/domain.ts`), so they do not
have to log in on every click. Expired sessions are deleted (`apps/bot/src/features/auth/data.ts`).

**An action log.** The bot keeps an audit log of actions taken through the bot and
console: who did what, when, and to what (`audit_log`: `ts`, `actor`, `action`,
`target`, `details` columns in `apps/bot/src/shared/db.ts`). Its purpose is accountability — being able to answer
"who changed this?" after the fact.

What we do **not** collect: message contents, DMs, browsing behaviour, location,
contact details like email or phone, or anything about you from other servers.

## How we use it

- To run the event you signed up for: signups, teams, matching, channels, schedules,
  announcements.
- To let organizers see and manage their own event.
- To keep the audit trail of who did what.

That is all. We do not:

- show ads, or use your data for advertising;
- build profiles of you, or analyse you beyond your event signup;
- sell personal data;
- share personal data with third parties;
- put analytics or tracking scripts on the organizer web console or any other page
  we serve.

## How long data is kept

Two clocks, and they are the same clocks the bot already runs on:

**Event data: torn down on the event's cleanup delay.**
Every event has a `cleanup_delay_hours` setting — the number of hours after the event
ends before the bot tears down the Discord side of that event (its team channels and
the team role). The default is **48 hours** (`events.cleanup_delay_hours`,
default 48, in `apps/bot/src/shared/db.ts`). An organizer can change it per event, or
set a server-wide default (`guild_settings.default_cleanup_delay_hours`).
The bot warns in the event channel **72 hours** and again **24 hours** before the
teardown runs (`events.cleanup_warned_72h` / `events.cleanup_warned_24h`), so nobody is
surprised.

> **Planned, not built yet.** Deleting the event's database rows on this same 48-hour
> clock is the documented goal (issue #23), but the purge job does not exist yet.
> Today the clock removes the Discord artefacts only, and the rows stay until an
> erasure request or a tenant purge (see below).

**Console sessions: 7 days.** A web-console session row lives 7 days and is deleted
when it expires (`SESSION_TTL_MS = 7 days`; expired rows are deleted when the bot starts up and when someone signs in).

**After the bot is removed from a server.**
Removing the bot does not immediately delete the server's data. The grace period
exists so that accidentally kicking the bot, or moving to a new server, does not lose
the event. If the bot is re-invited inside the grace window,
everything is still there.

> **Planned, not built yet.** The grace period and the bulk sweep that follows it do
> **not** exist today: removing the bot leaves that server's data in place, and
> nothing purges it automatically. We intend the window to be **30 days**, but that
> number is not final and nothing enforces it yet. This page will state the real
> number, and name the setting behind it, in the same change that adds it to the code
> (issue #23 R1).

**Audit log rows** are kept as accountability records; erasure requests remove rows
identifying you. **No retention period is set yet** — nothing currently deletes old
audit rows automatically, so any number printed here would be invented. The operator
will set one, and this policy will state it in the same change.

## Getting your data, or getting it deleted

One step. Ask — your organizer, or us (see *Contact*) — and say "export" or "delete"
and which event. That is the whole procedure; no forms, no verification maze.

- **Export**: we (or your organizer, via the operator) produce an archive of
  everything stored under your name for that event — signup answers, team membership,
  requests.
- **Deletion**: we (or your organizer) delete those rows. If the event is still
  running, the practical effect (team, channels) is explained to you before we do it.

> **How it works today.** Both are done by hand, by the operator, against the database
> — and an erasure is always written to the audit log, so a deletion is itself
> accountable. Self-serve export and a one-step erasure operation are specified in
> issue #23 (R2) with a dry-run and a confirmation step, and are **not built yet**.

Every erasure leaves a trace in the audit log — who deleted what, and when — so a
deletion is itself accountable.

## If the bot is removed from your server

The bot's own content stays out of your Discord server (channels it created are not
deleted on removal — that would delete other people's screenshots and work; the
event's normal cleanup clock handles them). The data we hold for that server is covered by
the rule above — which is planned rather than built, so today nothing is purged
automatically after removal.

## Suspension

We can pause a server's bot activity if it is abused, broken, or putting other
servers at risk. Suspension **does not delete data** and **does not give us access to
it** — it stops the bot acting for that server. We tell the organizers why (and how to
reach us), except where telling them would prolong active abuse. They can ask us to
reverse it, and we will answer. Their own organizers keep their accounts and access
throughout. The host operator has no backdoor: there is deliberately **no way** for us
to log in as an organizer or act as a tenant.

## Participants under 13 (and minors generally)

Most hackathon participants are students, and some are under the age of consent for
information-society services (13 in Sweden). The organization running the event — the
school — is responsible for ensuring the legal basis for processing the participants'
data, including parental consent where required. We (the operator) do not sign
participants up and do not contact them; we process only what the event's organizers
collect through the signup form. Organizers should tell participants and parents what
is collected and how to get it deleted — this page exists so they can link to it.

## Changes

If a retention number or a collected field changes, this page changes with it, in the
same change that ships the code. The version at any URL is the one in force.

## Contact

Your event's organizers first (they control the data). The operator can be reached
through the service's contact address — *(maintainer: insert the real contact address
here before publishing)*.

---

## For the maintainer

Keep this section out of any published copy. It lists what this draft assumes and
what the reader-facing text promises but the code does not do yet.

### (a) Claims not verified against the code

- **EU hosting** is the owner's stated intent (issues #23/#24), not something the
  code or infra can prove; the deployment topology must match before this claim is
  published.
- **No third-party analytics/trackers on the web surface** — verified only by the
  absence of any analytics import in the console code as of writing; a fresh grep
  should be re-run at launch.
- **"No backdoor / host cannot act as a tenant"** is the design decision in issues
  #22/#23 (host-operator allowlist, no impersonation); the host-operator surface is
  not built yet, so this is a design promise, not a code fact.
- **Audit log visibility** — the schema has no `guild_id` on `audit_log` yet (WS7 #19
  pending), so organizer-facing audit views cannot exist yet; the policy deliberately
  does not claim organizers can see the audit trail.
- **PostgreSQL for the hosted deployment** — the code today only speaks SQLite
  (`DB_PATH` in `apps/bot/src/shared/env.ts`); no `DATABASE_URL` exists anywhere yet.
- The exact **contact address** is a placeholder.

### (b) Promises not yet implemented

- Event-scoped row purge on the 48-hour clock (today the clock tears down Discord
  artefacts only) — issue #23 R1.
- Post-bot-removal bulk sweep after a grace period, and the 30-day number itself
  (proposed, owner to confirm) — issue #23 R1.
- Per-guild export and erasure operations with dry-run + confirmation — issue #23 R2.
- Audit-log retention period — none set.
- Suspension (freeze) flag with notify/silent modes — issue #23 FR1–FR8.
- Host-operator allowlist (no impersonation) — issue #22 consequence section.
- The organizer console is mid-migration from a shared `ADMIN_PASSWORD` to
  Discord-OAuth-only sign-in (issue #22); the policy describes the target state.

### (c) Numbers and names that must be updated if configuration changes

- **48 hours** — default event cleanup delay. Source: `events.cleanup_delay_hours
  INTEGER NOT NULL DEFAULT 48`, `apps/bot/src/shared/db.ts:60`. Override:
  `guild_settings.default_cleanup_delay_hours` (db.ts:148, added db.ts:181); per-event
  value takes precedence over the server default (`apps/bot/src/adminweb/routes.ts:670`).
- **72 h and 24 h warnings** — `events.cleanup_warned_72h` / `cleanup_warned_24h`
  (db.ts:62–63).
- **7 days** — console session TTL. Source: `SESSION_TTL_MS = 7 * 24 * 3600 * 1000`,
  `apps/bot/src/features/auth/domain.ts:74`; expired sessions deleted in
  `apps/bot/src/features/auth/data.ts`.
- **30 days** — post-removal grace period. *Not in code yet*; must be updated to the
  real variable name when issue #23 R1 lands, in the same change.
- If any of these become configurable, name the variable in the policy text, not just
  the number.
