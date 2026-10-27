# Signup import and self-service claim

Status: implemented. Additive only — no schema changes, no rewrites of existing
imported signups, registrations, teams or Discord references.

## Why

Three organizer/participant gaps in the current build:

1. **Saving a CSV import fails.** Google Forms exports labels, not option ids. A
   preview used to write `Hur vill du delta i Hackoween?` into `values.teamPref`
   verbatim, so the save route rejected the whole batch with `400 invalid_row`
   and every otherwise-good row was lost. One unmappable cell must not fail an
   import.
2. **No default template for the Hackoween form.** Organizers re-mapped nine
   columns by hand for a form whose questions we already know.
3. **A participant who filled the Google Form before joining Discord has no way
   to find and bind their own record.** Only an organizer could link them.

`TemplatesPage` also had a copy button that called `navigator.clipboard` without
a fallback, so on a plain-HTTP origin (the LAN/proxy setup) the click threw and
nothing happened — and there was no duplicate action to copy a template at all.

## 1. Tolerant import normalization

- [x] `features/signup-import/normalize.ts` (pure): key folding, option matching
      (id → label en/sv → containment → participation keywords), multi-value
      splitting on `,` `;` `|` and newlines, broad-area skill aliases.
- [x] `experience`, `role`, `teamPref`, `skills` and choice answers resolve to
      option ids in the preview; the original cell is kept in `source:<header>`.
- [x] The preview reports what it could not resolve in the row's `issues`.
- [x] The save route sanitizes instead of rejecting: unknown option values are
      dropped and returned in `warnings`, multi-choice answers are clamped,
      unknown question ids are dropped. Only structural problems still 400
      (row shape, oversized cells, ended event).
- [x] The organizer PATCH route sanitizes the same way and returns `warnings`.
- [x] `linkImportedSignup` accepts the normalized values; stored values are
      already ids, so a claimed row no longer trips `invalid_core_answer`.

## 2. Default import template

- [x] `features/signup-import/presets.ts` describes the Hackoween Google Form:
      the nine known questions, plus the optional Discord username.
- [x] Preview accepts `templateId`; auto-detection needs two recognised headers
      and returns `presetId` so the UI confirms what it applied.
- [x] `GET /api/events/:eventId/signup-import/templates` lists the presets.
- [x] The import dialog offers the template (auto-detect by default) and shows
      which one was applied; save warnings are listed per row.
- [x] Column mapping falls back to the preset table, then the generic keyword
      table; an explicit user override always wins.

## 3. Participant self-service claim

- [x] `POST /api/participant/events/:eventId/claim/lookup` — the signed-in
      current member submits the e-mail they used on the form. Returns only
      name, group name, the username typed on the form and whether the row is
      already linked. Never answers, allergies, group members or another
      person's Discord identity.
- [x] `POST /api/participant/events/:eventId/claim` — binds that row to the
      caller through `linkImportedSignup`. Refuses a row linked to another
      Discord user, an existing participant, a missing event or a blocked
      registration, and returns a `prefill` (answers + profile) for the owner.
      It re-uses `checkSignupWrite`, so the same write guard that protects the
      registration route (event state, blocked status, signup window) also
      applies here; an already-active participant bypasses the window exactly as
      they do on the registration route.
- [x] The participant signup page shows an "Already signed up on the form?"
      panel with lookup → confirm, localized help, and applies the prefill to
      the normal form so missing answers can be completed there.
- [x] `participant.claim_import` is audited (activated, missing-answer count).

**Known limitation, by design:** possession of the e-mail address is the proof.
There is no verification channel in the current product, so an organizer should
still check a claim they did not expect. A row already bound to another Discord
account can never be re-bound from the participant side.

## 4. Copy template

- [x] `lib/clipboard.ts`: async clipboard plus a `textarea`/`execCommand`
      fallback, returning a boolean.
- [x] Template reference and event id copy buttons use it, with a localized
      success and failure toast.
- [x] A real **Duplicate** action per template (new name, same JSON) so "copy"
      also means "copy the template".

## 5. Localization and verification

- [x] Every new string in `en.json` **and** `sv.json`; no new Discord surface, so
      `shared/i18n.ts` is untouched.
- [x] Unit tests for normalization, presets and area aliases
      (`features/signup-import/normalize.test.ts`).
- [x] API tests (`adminweb/signup-import.test.ts`): raw-label export previews and
      saves, preset auto-detection, organizer PATCH tolerance, and the claim flow
      (unauthenticated, non-member, invalid/unknown e-mail, own claim, re-claim,
      stolen row, existing participant, foreign event, audit).
- [x] Bot build + full PostgreSQL suite (327 passed), admin-ui typecheck, Vite
      build and 16 unit tests including catalog parity.
- [x] Both served browser journeys re-run after merging `origin/main`: organizer
      133 assertions, participant 90. The merge had dropped the light-form setup
      the participant journey's light-theme assertion depended on (restored), and
      the refreshed copy no longer contains the old "for tags" placeholder, so the
      announce-composer checks now target `data-tag-autocomplete` instead of copy.

## Out of scope, still open

- No schema change: `source:<header>` already rode along in `values_json`, and
  the claim reuses `imported_signups.discord_user_id`.
- The import dialog still maps columns by target key; a fully dynamic
  question-target picker was not added.
- The claim panel is web-only, as before for organizer linking.
