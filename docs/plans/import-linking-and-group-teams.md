# Import linking, group teams and imported-row cleanup

Status: implemented. Additive: no schema change, no rewrite of existing
`imported_signups`, `participants` or `teams` rows.

## Why

Organizers importing the Hackoween Google Form hit four walls:

1. **"Save & link" answers 400.** The row links fine in tests, so the failures
   that reach an organizer are the guarded ones — the member already has a
   participant row (`participant_conflict`), the event is still a draft
   (`event_not_active`), the row is bound to someone else, or a value saved under
   an older form version no longer resolves (`invalid_core_answer`,
   `stale_form_version`). The route answers `{ error: code }` with no message, so
   the console can only show "Request failed".
2. **Linking is type → click → hope.** A guild member search that only runs on
   demand cannot show the person the organizer is looking at while they type.
3. **The Discord username on the form is invisible.** The preset maps
   `Din discord username`, the value is stored, and then the console calls the row
   "unlinked" as if the organizer had nothing to go on.
4. **A wrong row is permanent.** There is no way to delete an imported signup, so
   a duplicate or a junk submission stays in the list and in the matching pool.

Plus two rough edges: group names in the CSV never become teams, and the skills
checkboxes are packed edge to edge.

## 1. Save & link actually saves and links

- [x] `linkImportedSignup` takes an `organizer` option.
  - The event may be a draft (an organizer may pre-register people before launch,
    exactly as the participant registration route already allows).
  - An existing participant is **adopted**, not rejected: the row is bound to
    them, no second participant row is created, and the result says
    `alreadyRegistered: true`.
  - The organizer may re-bind a row that currently points at a different Discord
    user. A user already claimed by *another* imported row still fails
    (`identity_conflict`) because that is a real duplicate to resolve.
  - Stored values/answers are re-normalized against the current form before
    linking, so an obsolete option id or an older `form_version` cannot fail the
    link; whatever does not resolve is returned as `warnings`.
  - The participant claim path keeps its strict behaviour (active event, matching
    form version, never re-bind someone else's row).
- [x] Every failure returns a `message` next to the machine `error` code, and the
  console maps unknown codes to localized text instead of "Request failed".
- [x] Audit `imported_signup.link` with what was adopted/re-bound.
- [x] The console keeps the member picker on an already-linked row, so
  "Save and link" is also the correction path.

## 2. Live member picker

- [x] `components/member-combobox.tsx`: a Popover + Input listbox that searches
  the guild as the organizer types (300 ms debounce, TanStack Query, 2-character
  minimum), arrow keys + Enter to pick, `aria-*` listbox semantics.
- [x] Replaces the type-then-click `Imports › Review & edit` member search.
- [x] The picker opens pre-filled with the form's Discord username, so the
  organizer usually only has to confirm the first result.

## 3. "Linked via form"

- [x] A row with no `discord_user_id` but a `discord_username` reads
  **Linked via form (@name)**, not "Not linked".
- [x] The card and the editor show the form username, and the editor hands it to
  the picker as the starting query.
- [x] An exact username match is offered as the first result, marked as the form
  match.

## 4. Delete imported signups

- [x] `DELETE /api/events/:eventId/imported-signups/:id` and
  `POST /api/events/:eventId/imported-signups/delete` (`ids`, max 200), both
  guild-scoped through `getEvent` + `guildOf`.
- [x] Deleting an imported row never deletes the participant it was linked to —
  the participant is the registration, the import row is the paperwork.
- [x] The console gets a per-row delete and a multi-select delete, both behind a
  confirm dialog; audit `imported_signup.delete`.

## 5. Group name becomes a team

- [x] `features/teams/group-teams.ts`: `joinGroupTeam` runs when an imported row
  is linked (organizer link and participant claim alike).
  - Team name = the CSV group name, matched case-insensitively inside the event.
  - First joiner creates the team as a private team and owns it; later members of
    the same group name join it.
  - A participant who already has a team is left alone.
  - The team is marked for provisioning and audited
    (`team.create_group` / `team.join_group`).
- [x] Capacity is not enforced for a pre-formed group: the group said who is in it.

## 6. Skills checkbox spacing

- [x] Each skill option is its own padded row with breathing room instead of
  `space-y-1` + packed 36 px boxes; the fieldset keeps its legend and wraps
  cleanly on narrow dialogs.

## 7. Localization and verification

- [x] Every new string in `en.json` **and** `sv.json`. No new Discord surface.
- [x] Tests: draft-event link, already-registered adoption, re-bind, stale form
  normalization, delete (single + bulk, guild isolation), group team create/join.
- [x] Bot build + full PostgreSQL suite, admin-ui typecheck + Vite build.

## 8. Participant pages load once

- [x] `lib/public-event.ts`: one `['public-event', eventId]` query shared by the
  participant overview, signup and team pages (5 min stale, 30 min gc).
- [x] The signup page also caches `['participant-registration', eventId]`, so a
  live push or a revisit renders from cache and refetches in the background;
  a request sequence guard replaces the aborted fetch pair.
- [x] A 401/404 on the registration read stays an answer (login / non-member),
  not a load failure.

## 9. "Back to all servers" actually leaves the server

- [x] `/` only redirects to `/events` when the `servers` flag is absent;
  `/?servers=1` (the `ServerSwitcher` link) now renders the picker instead of
  bouncing the organizer into their remembered guild.

## Out of scope

- No schema change: group teams are matched by name, which is the only signal the
  CSV carries.
- Merging two imported rows for the same person; delete one and link the keeper.
