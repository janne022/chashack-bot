# Frontend and event-delivery refresh

Implemented locally on 2026-10-26. No deployment or live Discord mutation was performed.
The supplied frontend-quality-diagnosis.md was reviewed as evidence: compilation alone
is not treated as visual verification.

## Delivered

- Participant workspace: Overview / Your signup / Your team; saved-answer edit mode,
  completion state, grouped choices, persistent light/dark preference, and skeleton loading.
- Organizer navigation and shared controls: clearer hierarchy, larger targets, compact
  mobile navigation, remembered account-specific server choice and an All servers page.
  Server access discovery uses current Discord authority rather than the login snapshot.
- Silent live-update reconnects; a retry icon appears for a persistent outage.
- CSV extension/empty/size checks, actionable access/session/network errors, and retry
  after reauthentication while preserving the open import.
- Tag suggestions stay within their scroll boundary, support wheel scrolling and keyboard
  insertion, and close with Escape before the surrounding dialog. Schedule descriptions
  explicitly explain the schedule_desc variable.
- Updated English/Swedish starters with relative schedules and signup actions in the
  signup window. Existing templates are preserved. Existing events can load assignment
  collections; assignment handout is an explicit action, defaulting to kickoff.
- Exact kickoff timing for pinned actions; moving event dates moves related dates and
  activities while retaining activity clock times.
- Discord signup mode options, persistent team controls, departure notices, separately
  displayed team roles, and opt-in member-only event channels with kickoff membership.
- Durable catch-up delivery for signup panels, scheduled announcements and assignments.
  Message references and fingerprints persist in PostgreSQL; late teams get handouts,
  failed delivery retries, and edits update tracked messages without repeated posts.
  Published itineraries follow event edits. Startup runs a catch-up pass.

## Verification

- Bot TypeScript build and UI TypeScript check: passed.
- Vite production build: passed (existing large-chunk advisory remains).
- Full PostgreSQL backend suite: **260 passed** using disposable chashack_ui_test.
- Frontend unit suite: **7 passed**.
- Organizer browser journey: **147 assertions passed**, no uncaught console exceptions.
  Includes form/theme authoring, CSV import, editing a published event, switching its
  assignment collection, stale saves, keyboard focus, and mobile dialogs.
- Participant browser journey: **74 assertions passed**, no uncaught exceptions.
- Full frontend matrix: Events, event workspace, Participants, Teams, Matching, Templates,
  Settings and Audit at 1440px and 390px in dark/light, plus server picker, login, message
  editor, tag suggestions and CSV session recovery. **Zero serious/critical axe findings**
  and no document-level horizontal overflow in the final captured states.
- API/static-shell smoke: passed.

Screenshots and axe results are retained locally in data/frontend-review and
 data/participant-appearance-evidence. They contain synthetic fixture content.

## Practical limits

Browser sessions and guild membership are synthetic. PostgreSQL persistence and browser
interaction are real; live Discord transport and permissions still need deployment-side
verification. No claim of a complete manual accessibility audit is made.

Old announcements that never stored their message IDs cannot be safely located for
in-place editing. They are not replayed on migration; subsequent changes can create a
tracked replacement. Manual one-off announcements remain one-off. New tracked scheduled
messages, signup panels, itineraries and handouts retain their references.

Reconciliation runs on organizer edits and team provisioning, at startup, and on the
existing five-minute maintenance interval. A transport failure can therefore take until
the next successful maintenance pass to recover. Changing a saved collection does not
silently overwrite events that previously copied it; pick it again in the event editor.
