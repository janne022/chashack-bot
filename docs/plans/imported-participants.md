# Imported signups are real participants

Status: in progress · Owner: janne · Updated: 2026-10-27

## Problem

Imported CSV signups are paperwork until an organizer links each row by hand.
Until then the person is missing from Participants, from matching, from team
assignment and from every count the console shows, and an organizer looking at
Participants cannot tell that a submission exists at all. Linking is also
one-by-one: a CSV naming people who are already in the Discord server still
leaves every row unlinked.

## What changes

1. **Every imported row materialises a participant.**
   - Unlinked row → a placeholder participant with
     `user_id = 'imp:<importId>'` and `participants.imported_signup_id = <importId>`.
     It carries the row's name, profile and answers, so it counts in stats, can be
     matched, assigned to a team and seen by every organizer of that server.
   - Linked row → the real participant row (Discord id) is kept in step with the
     row and marked with the same provenance.
   - Placeholders never touch Discord: no role grant, no channel overwrite, no
     mention and no DM. A small `isDiscordId()` guard sits on those paths.
2. **The sync runs on every import change.** `reconcileImportedParticipants()`
   re-derives participants after create, edit, link, claim and delete, and drops
   placeholders whose row is gone or now linked. Editing a row is an update, not a
   second participant.
3. **Auto-link on import.** Rows naming a Discord username are matched against
   guild members by exact username/global name. A unique match is linked
   immediately through the organizer link path (existing participant adopted,
   profile and answers normalised). Ambiguous matches stay unlinked and are
   reported, never guessed. `POST /api/events/:eventId/imported-signups/auto-link`
   re-runs it on demand ("Link members" in the Imports panel).
4. **Linking merges the placeholder.** Team membership, answers and blocked state
   move to the real participant instead of being dropped, so a matched imported
   person keeps their team when they join Discord and are linked.
5. **The console shows the difference.** Participants get an `Imported` badge plus
   a "not in the Discord server" tag, and a filter for imported rows. Teams and
   matching show the same names.

## Data model

`participants.imported_signup_id TEXT NULL` (additive migration in
`shared/postgres-schema.ts`, picked up by the repair pass), plus
`idx_participants_import`. `NULL` means a normal Discord signup.

Placeholder ids are prefixed `imp:` so they can never collide with a snowflake and
are trivially recognisable in code and in the UI. `isDiscordId()` is the single
gate for anything that talks to Discord about a participant.

## Flow

```
CSV upload ─► createImportedSignups ─► auto-link (unique username → link)
                                   └─► reconcileImportedParticipants
row linked  ─► linkImportedSignup ─► adopt placeholder (team/answers/status) ─► reconcile
row edited  ─► editImportedSignup ─► reconcile
row deleted ─► deleteImportedSignup(s) ─► drop placeholder (linked rows keep their participant)
```

## Consequences to keep

- Imported people are participants for matching, teams and counts, but they have
  no Discord identity: team provisioning creates the space and grants roles only
  to real members.
- Deleting a row deletes only its placeholder; a linked participant survives.
- The organizer link path stays authoritative: a draft event can still be linked,
  an existing registration is adopted, a row bound to someone else can be re-bound.
- Participant self-claim (by e-mail) keeps its strict conflicts; when the claimer
  was already materialised as a placeholder, the claim merges into it.

## Verification

- Bot: `npm run build && node --test dist` against the disposable PostgreSQL.
- New coverage: placeholder creation/update/removal, link merge, delete, matching
  eligibility, auto-link (unique/ambiguous/absent), `/api/state` visibility.
- admin-ui: `npx tsc --noEmit && npm run build && npm test`.
- Every new string in `en.json` and `sv.json`.

## Checklist

- [ ] Schema column + index, `Participant` type and mapping
- [ ] `sync.ts` (placeholder upsert, merge, reconcile)
- [ ] Wire reconcile into import/edit/link/delete/claim
- [ ] Auto-link by username + route + panel button
- [ ] Matching and team eligibility for placeholders
- [ ] Discord guards (`isDiscordId`) for roles, mentions, rosters
- [ ] Console badges, filter, i18n (en + sv)
- [ ] Tests
