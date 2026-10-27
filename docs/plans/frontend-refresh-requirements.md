# Hackathon platform requirements review

Status: in progress. Preserve existing events and Discord delivery records; do not
introduce schema changes without a compatibility and backfill plan.

## Schedule publishing action design

- [x] Add a `publish_schedule` action to schedule JSON, normalization, both action
  editors and both language catalogs; select an optional Discord channel.
- [x] Reconcile the event's single tracked itinerary when an action is due and on
  later edits. For events without the new action, retain the existing channel-based
  behavior. Existing message references continue to be edited in place; no schema
  change or destructive backfill is needed. A configured future action suppresses
  a new automatic post until due, while an already-published itinerary stays synced.
- [x] Cover future and overdue actions, retries, message edits, no duplicates,
  legacy events, and normalization with a disposable PostgreSQL fixture.
- [x] Verify both builds and the updated template defaults. Fourteen focused
  PostgreSQL-backed and pure tests passed with mocked Discord; real Discord and
  browser authoring verification remain outstanding.

## Starter-template concurrency

- [x] Serialize per-server starter seeding across database connections, including
  legacy empty form and assignment catalogs. Preserve user templates, respect the
  existing event/announcement seed markers, and avoid recreating deleted event or
  announcement starters. Verify simultaneous first access with separate PostgreSQL
  handles and repeated access after a user deletes a seeded entry. Fourteen
  targeted PostgreSQL tests passed, including restricted-role tenant isolation.
- [x] Review seeded activity times against arbitrary event start/end times: current
  relative schedule offsets are clock times on the anchor day, so a starter activity
  can fall before kickoff or after the end. Add an explicit elapsed-offset mode and
  optional event-window constraint to schedule JSON, backend normalization and
  resolver, and both organizer editors; absent fields keep the old clock semantics.
  Seed elapsed, bounded starter activities and update only exact unedited previous
  starter records once, without restoring deleted starters or changing custom data.
  Verify both language variants through event creation, short and shifted events,
  normalization, template editing and legacy behavior. No database column is needed.
  Twenty-five targeted bot tests and 15 admin tests passed; the synthetic organizer
  journey verified the timing control, keyboard entry of a negative offset and save.

## Assignment-template compatibility

## Membership synchronization repair

- [ ] Make registration withdrawal and blocking remove a participant from their
  team through the existing owner-transfer/delete transaction, then reconcile the
  old Discord role and team panel for web, participant and organizer actions.
- [ ] Grant the destination role for web and Discord selector moves; correct the
  Discord direct-name lookup. Preserve event/guild scoping and verify real handler
  paths, owner departure, missing users and role failures with mocked Discord.
- [ ] Review recovery of failed role removals and resource teardown separately;
  avoid claiming reliable revocation solely from a best-effort Discord request.

- [x] Persist pending team provisioning atomically with new team creation and
  matching, using a scoped marker in the existing metadata store. Retry only marked
  teams belonging to active, unexpired events; preserve legacy unmarked teams and
  stored Discord IDs. Clear markers on successful role/channel setup and member
  grants or team deletion. Verify retry after restart/failure, late handout,
  tenant isolation, deletion, and independent-worker coordination. Membership
  additions also update a revisioned marker, so a concurrent join cannot be lost
  when a pass completes. Scheduled matching and team delivery avoid nested session
  locks; one failed team does not block other retries. PostgreSQL tests exercised
  these cases with mocked Discord. The full PostgreSQL bot suite passed 294 tests
  after the final lock-order adjustment. Discord resource
  creation and database writes cannot be atomic; uncertain creates can still leave
  orphaned resources and require operator review.

- [x] Repair organizer team creation: require a selected active, unteamed owner;
  enforce eligibility server-side, provision the team space and role, and trigger
  existing late-handout reconciliation. Distinguish committed teams with incomplete
  Discord setup from failures so retrying cannot accidentally create another team.
  Offer an explicit retry for incomplete Discord setup. PostgreSQL-backed HTTP
  tests cover a late handout, failed channel creation and role grants, retry,
  deduplication, concurrent workers and cross-server refusal; synthetic Chrome
  covers owner selection and unavailable-Discord recovery UI.
  Discord was mocked. Crashes between Discord creation and persisted IDs remain a
  separate follow-up requiring operator inspection.

- [x] Preserve legacy embedded assignment pools when editing an event template;
  offer an explicit choice to keep, replace or remove that pool. Synthetic browser
  coverage verifies preservation; replacing/removing is explicit in the editor.
- [x] Resolve a template's assignment collection on event creation, scoped to the
  selected guild; reject missing or malformed collections with an actionable error.
  Explicit assignment overrides, including an empty pool, must win over defaults.
  PostgreSQL API tests cover collections, malformed and foreign references, legacy
  pools and explicit overrides. Cloning an event retains its assignments and timing.
- [x] Show embedded pools in the new-event flow and keep its selection consistent
  when switching templates; snapshot the selected pool and retain a separate
  handout action. Verify legacy pools, collections, no-assignment overrides and
  cross-guild access through API and synthetic browser fixtures. Browser coverage
  verifies keeping and explicitly removing an embedded pool, switching templates
  without retaining the prior schedule, and a handout on another block without an
  extra default. Template switching retains chosen event dates.
- [x] An event created with an assignment pool but no start date cannot yet carry
  a timed handout. Preserve a start-anchored pending action and its selected
  strategy in schedule JSON, but suppress it in both delivery and maintenance
  until a start exists. Older no-date events get a default only when they first
  acquire a start and have no handout; preserve explicitly supplied actions and
  test creation, later dates, retries and a synthetic browser edit. Forty-four
  targeted tests passed, including no early delivery, late start resolution and
  participant schedule projection; the browser saved an undated draft and later
  scheduled its original `same` strategy. Discord delivery was mocked.
- [x] Extend unresolved-time protection to all anchored template activities,
  including signup and schedule publication. Verify no action executes or shows
  an epoch date until its anchor exists; retain legacy nonzero literal times and
  the existing anchor fallback rules. Thirty-nine targeted tests passed, including
  a full undated starter with signup, itinerary and announcement actions that fire
  only after dates are set. Discord was mocked.

## Signup scheduling and late participants

- [x] Localize schedule-editor kinds, quick adds, action controls and assignment
  strategies in both languages. Correct the strategy explanation to match the
  independent per-team selection, and avoid showing a fabricated clock time for
  unresolved or relative actions. Verify signup-block action timing, undated
  schedules and Swedish authoring in the browser without changing saved actions.
  The event-template editor also explains that a handout action controls delivery.
  Typecheck, build, 16 frontend tests and the synthetic Chrome journey passed;
  Chrome covered pending action text, signup opening time, Swedish strategy and
  schedule controls. Discord was not contacted and no axe audit was configured.

- [x] Allow a signup period to overlap the hackathon and keep event activities
  selectable before signup closes. Preserve existing saved dates and action IDs.
- [x] Verify create/edit validation and both language labels for overlapping dates.
- [x] Put signup-panel posting in the signup block's configuration; keep legacy
  actions on other blocks readable without silently moving or replaying them.
  The served browser journey saved an overlapping window and a signup-block panel
  action; 81 assertions passed overall. Legacy actions remain editable where stored.
- [x] Implement signup-window enforcement consistently across web and Discord
  without unexpectedly closing legacy events. Existing participants retain access
  to edit or withdraw, and late signup must work when the configured period allows it.
  Store an explicit event-form flag: legacy events without the flag stay unrestricted,
  newly created events default to enforcement, and organizers can disable it.
  Opening is inclusive, closing exclusive; active registrations may edit outside
  the window, but withdrawn registrations must meet the window to rejoin. Enforce
  under an event-row lock; organizer-driven CSV imports remain explicit overrides.
  Forty-five focused tests passed, including boundary checks and web/Discord
  dispatch; the participant browser journey passed 84 assertions including opening,
  closing and error states. Discord was tested with synthetic interactions.

## Server access refresh

- [x] Refresh the discoverable server list while a workspace is open, with bounded
  polling and focus refresh. Keep the current editor mounted on transient failures
  and let existing request-level authorization handle revoked access.
- [x] Verify grants and revocations against a synthetic Discord membership fixture
  without a new login, including refresh while the organizer workspace is open.

## Frontend review findings

- [x] Distinguish empty audit history from a search with no matches, and provide
  a clear-filter action for audit and participant results. Expose table sort state
  to assistive technology and keep virtualized row keys aligned with sorted rows.
  Surface a failed workspace data refresh with a localized retry while retaining
  the current editor. Synthetic Chrome checks covered filters, sort direction,
  failed refresh and retry; sorted virtual row keys were corrected by inspection.
- [x] Make the manual announcement dialog keyboard accessible and translate its
  preset, channel and variable hints into English and Swedish. Exercise the dialog
  and existing preset/retry workflows in the organizer browser fixture. Chrome
  verified dialog labelling, focus, Escape restoration and Swedish controls; no
  full accessibility audit was run. A catalog test checks literal keys and parity.

- [x] Use the existing light/dark foreground tokens for chart labels and grid
  lines; verify rendered axis-label contrast in both themes.
- [x] Exercise the organizer's CSV expired-session recovery in the served browser:
  the selected file is retained and preview succeeds after reauthentication.
  The organizer journey also checked horizontal overflow at desktop and mobile
  widths in both themes. No axe source was configured, so this is not a complete
  accessibility audit.
- [x] Translate announcement-variable help, autocomplete descriptions and
  search labels into both organizer languages; verify the same localized list
  drives keyboard selection and the displayed suggestions. Both catalogs now cover
  all 17 existing variables; tests cover catalog completeness and Swedish search.
  A synthetic Chrome journey verified localized suggestions, keyboard selection,
  and the guide's bounds at 390px; its screenshot was visually inspected. This
  is not a complete accessibility or all-locale browser audit.
- [x] Localize message-template creation, editing, validation and channel feedback.
  Explain that a template's suggested use does not itself schedule a message;
  preserve legacy metadata. When applying a template, carry its configured
  channel into the action or manual message, while retaining the current channel
  when the template has no override. A synthetic browser journey verified the
  Swedish scheduling explanation, both channel selection paths, retention of an
  existing choice and persistence of the scheduled action. No Discord send was made.
- [x] Replace manual-announcement failure codes with actionable English/Swedish
  messages. Show partial DM delivery even when the channel post fails and avoid
  accidentally re-sending successful DMs on a channel retry. Verify with a
  synthetic browser response; never send messages to a live Discord server.
  The browser verified the partial-DM warning and unchecked retry, and unit
  tests cover diagnostic mapping and catalog coverage. Swedish rendering of
  these errors has not yet been separately exercised in a browser.
- [x] Make existing per-question help text editable in English and Swedish for
  registration and submission forms, and associate it with the answer control
  for assistive technology. Preserve existing help on edits and verify both form
  surfaces with synthetic browser data. A synthetic participant journey verified
  help associations and Chromium accessibility descriptions on signup and
  submission, bilingual submission authoring, and registration-template creation
  and editing without losing either language.

## Work queue

- [ ] Audit each requirement against implementation and tests; distinguish
  existing behavior, gaps, and behavior needing live verification.
- [ ] Define compatible data and migration changes for registration, submissions,
  schedule actions, Discord references, and legacy templates before implementing.
- [ ] Complete form authoring and participant answer flows, Discord capability
  warnings, completion state, editing permissions, CSV authorization and errors.
- [ ] Repair form editor scrolling, focus tracking, and variable insertion; verify
  every offered variable against its renderer.
- [ ] Build an event-scoped participant workspace for signup, submission, team,
  and schedule; verify team creation and departure across web and Discord.
- [ ] Review server picker, remembered selection, permission refresh, navigation,
  role presentation, and theme controls.
- [ ] Complete signup, schedule publishing and assignment action configuration;
  preserve relative timings and allow existing events to use assignment templates.
- [ ] Verify and repair Discord reconciliation, late teams, missed actions,
  message edits, membership roles, channel access and idempotency.
- [ ] Update English and Swedish templates and all user-facing translations;
  preserve legacy event and template behavior.
- [ ] Review all frontend routes for visual consistency, responsiveness,
  accessibility, skeletons, empty states and actionable errors.
- [ ] Run targeted tests and full available checks, then exercise existing and new
  events with disposable PostgreSQL and browser/Discord fixtures; record limits.
- [ ] Produce a requirement-by-requirement completion report with evidence.

## Requirement audit (working; not a final completion claim)

1. **Signup and submissions — partial.** Registration modes, themed controls,
   saved answers, submission forms, CSV validation/recovery, and variable insertion
   are implemented. Discord custom questions remain web-only and are identified in
   the editor. Full control-by-control Discord equivalence and form editor scrolling
   still need review.
2. **Participant and teams — partial.** Event navigation covers signup, submission,
   teams and schedule; saved status, browser-based team creation and departure
   notification exist. Community design and role presentation need a broader audit.
3. **Navigation and servers — partial.** The picker remembers the last server and
   refreshes authority; organizer browser tests cover grants/revocations. Remaining
   navigation and visual consistency need review.
4. **Actions and scheduling — partial.** Signup panel configuration, schedule
   publishing, assignment handouts, anchor dates and existing-event assignment
   collections exist. Required/default action behavior and all template paths need
   additional verification.
5. **Discord synchronization — partial.** Persistent delivery records, retries,
   late-team handouts, edits, and channel/role reconciliation have mocked tests.
   Live Discord read-back, cross-process duplication behavior and real permission
   transitions are not verified.
6. **Templates and localization — partial.** English and Swedish seeded templates
   and new UI messages exist; full catalog parity and existing template migration
   have not been audited end to end.
7. **Loading and feedback — partial.** Shared skeletons and quiet live retries exist;
   CSV reauthentication was tested. The entire frontend still needs an empty/error
   and accessibility sweep.
8. **Visual direction — partial.** Theme-aware chart contrast and desktop/mobile
   overflow were checked on organizer screens. A complete visual and interaction
   review across all screens remains.
9. **Migration — partial.** Submission tables are additive and tenant-isolated;
   a populated synthetic legacy event survived repeated migration, and guarded
   fixture recovery and deletion replay were tested. Old events retain their
   signup-window behavior. Production backup and restore remain operator-managed.
10. **Verification — partial.** Focused PostgreSQL, mock Discord, browser and API
    tests have run. Full checks and requirement-by-requirement evidence must still
    be recorded; synthetic Discord fixtures are not live Discord proof.

## Repository verification in this worktree

- Bot TypeScript build and full PostgreSQL suite: 294 tests passed on the current
  worktree, including access and delivery coordination and a restricted application role.
- Admin UI TypeScript check, Vite build and 16 unit tests passed. The ordinary
  build's route-generator fallback was unavailable earlier; the Vite check used
  the existing generated route tree.
- API smoke passed against a disposable database and synthetic organizer after the
  current builds. This is not evidence of a live Discord connection.
- Participant Chrome journey: 85 assertions passed, including live organizer
  submission updates without overwriting an unsaved form. Discord was synthetic.
- Organizer browser journey covered both themes, desktop/mobile overflow,
  server permission changes, tag input and CSV reauthentication; no axe audit
  was run. Full accessibility and real Discord read-back remain outstanding.

## Recovery and upgrade verification

- [x] Include submission forms, submission answers and imported signups in the
  guarded fake-fixture recovery copy; preserve existing event and Discord meta rows.
- [x] Rehearse a populated legacy upgrade twice in an isolated test schema and
  verify registrations, teams, assignments and Discord references remain intact.
- [x] Verify deletion replay removes the departed member's restored submissions
  only in the affected guild, without touching another guild's records; newer
  registration and submission answers survive when the member rejoins.

  These are synthetic fixtures, not certification of a production backup.

## Discord delivery follow-up

- [x] Review events with more than one legacy signup action: action delivery
  records are separate but the signup panel reference is shared per event, so
  actions targeting different channels may compete when a panel is refreshed.
  Use each action's existing delivery reference when updating its panel, falling
  back to the event reference for legacy records; retain the event reference for
  manual refresh and preserve existing messages and action configuration. Verify
  two channels, subsequent edits, retries and legacy reference adoption. The
  PostgreSQL-backed Discord mock regression passed; live Discord remains unverified.
- [ ] Verify concurrent reconciliation across processes and recovery after a
  send succeeds but persistence fails. In-process guards and Discord nonce
  deduplication alone do not prove an indefinite exactly-once guarantee.
- [x] Serialize simultaneous delivery reconciliation for the same event across
  bot processes with a PostgreSQL session advisory lock on a separate connection;
  do not hold the normal application transaction during Discord calls. Release
  the lock on errors and process exit, skip contending passes for the next retry,
  and test independent connections and overlapping reconcilers. This cannot make
  an external Discord send atomic with recording its receipt; retain that recovery
  limitation explicitly rather than claiming indefinite exactly-once delivery.
  Thirteen focused tests passed, including independent worker module instances,
  separate database sessions, a restricted application role, and lock release
  after failure. A real process crash and live Discord delivery were not tested.
- [x] Reload the authoritative event after obtaining the delivery lock and before
  each queued pass, so a stale snapshot cannot overwrite a newer announcement or
  publish after the event has ended. Verify changed and ended events as well as
  existing late-team and retry behavior. Thirteen focused PostgreSQL/Discord-mock
  tests passed, including an updated announcement and an event ended after the
  caller captured its snapshot. Maintenance retries contended work every five minutes.
- [x] Audit legacy `on_activate` and `on_start` event announcements when editing
  a schedule: the editor currently maps them to synthetic start and end blocks,
  respectively. The current runner does not process these legacy records and
  their prior delivery state is unknown, so do not silently convert or replay
  them. Preserve the records on save, explain that organizers can add copies as
  scheduled actions. A synthetic Chrome/PostgreSQL journey verified a populated
  legacy event keeps both records and creates no new scheduled actions on save.
- [x] Coalesce overlapping reconciliation requests within one process into a
  follow-up pass so changes and newly provisioned teams are not silently skipped.
  Preserve the latest requested event snapshot, keep failures visible to callers,
  and exercise an edit arriving during a blocked Discord send. The PostgreSQL
  fixture confirms the subsequent pass edits the original message; Discord is mocked.

## Form answer isolation

- [x] Restrict participant registration reads and writes to participant-visible
  questions, preserving existing organizer-only and retired values when a
  participant saves.
- [x] Verify private answers cannot be read, injected or erased through the
  participant API, while ordinary signup completion still works. Nineteen
  registration and API-isolation tests passed with disposable PostgreSQL.

## Submission form implementation plan

The current repository has no separate submission form or project-submission
records. Registration answers must remain independent. Implement an event-scoped,
participant-owned submission form using the established localized question types;
organizers configure whether it is enabled and whether saved answers may be edited.
Keep the signup form and its version independent of submission edits. Provide an
organizer view of submitted answers, plus participant status and edit controls.

- [x] Add additive storage for event submission configuration and participant
  answers, including tenant RLS, runtime grants and migration inventory. Existing
  events default to disabled with no invented submissions; never rewrite existing
  registrations, teams, assignments or Discord references.
- [x] Validate questions and answers server-side, with version conflict recovery,
  completion based on required fields, and explicit edit permissions. Scope all
  participant operations to the authenticated current member and active event.
  Recovery keeps compatible unsaved answers after a form update.
- [x] Add organizer configuration and a guild-scoped submission review endpoint
  and UI. Use both language catalogs and the existing form controls.
- [x] Add a submission tab to the participant workspace with empty, incomplete,
  completed, locked and editable states; surface status in My hackathons.
- [ ] Test migration of populated legacy data, RLS and cross-user isolation,
  form changes, locked edits, late participation and browser journeys.
  Focused PostgreSQL tests cover idempotent migration, tenant RLS, locked saves,
  current-member API access and subject isolation. The participant Chrome journey
  passed 80 assertions, including submission persistence, draft recovery after a
  form change, dashboard status, organizer question authoring and locked edits.
  Late-participation browser coverage remains.

## Initial code review

- [ ] Forms: web/both registration modes, slider/toggle controls, CSV file
  restrictions, and schedule description interpolation exist. Verify full editor,
  Discord compatibility, completion, editing, and import journeys.
- [ ] Participants: registration completion and team links exist; team creation
  and departure notification exist. A unified event workspace with submission and
  schedule tabs still needs investigation and implementation.
- [ ] Navigation: server picker, remembered selection and fresh server discovery
  exist. Verify permission changes throughout an active session.
- [ ] Actions: relative anchors, assignment actions and assignment templates exist.
  Schedule publishing has an explicit action with legacy compatibility; review
  defaults and signup action configuration.
- [ ] Discord: persisted delivery references, retries, edited announcements and
  late team handouts exist. Verify lifecycle roles, access controls and recovery
  against existing events without duplicate delivery.
- [ ] Templates: English and Swedish seeded variants exist. Review their defaults
  and legacy upgrades against the final action model.
- [ ] UI: skeleton components and a shared visual system exist. Review all routes
  for responsive, accessible and consistent states and interactions.
- [ ] Migration: document and verify all schema or stored configuration changes,
  including legacy events and Discord references, before introducing them.
- [ ] Verification: exercise browser, API and Discord paths, including late teams,
  missed actions, changed schedules, permissions and CSV imports. Record results
  and remaining gaps instead of inferring functionality from code alone.

## Focused repair

- [x] Serialize event access reconciliation across workers for each guild, and
  reload events and form settings after acquiring the lock. PostgreSQL fixtures
  verify simultaneous workers, role removal after settings change, protection of
  a newly shared signup channel, and no provisioning for drafts. Discord is mocked;
  a crash between role creation and recording its ID can still leave an orphan.

- [x] Serialize scheduled maintenance per event across workers and recheck the
  current plan after acquiring the lock. A PostgreSQL test blocks a synthetic
  reminder while a second pass runs and verifies a later pass does not resend it.
  Discord sends and database writes are still not atomic across a process crash.

- [x] Avoid asking Discord participants to complete an already-complete signup
  when stored answers contain retired or organizer-only values; cover the real
  interaction dispatch and retain the incomplete-signup link test.
- [x] Resolve `{schedule}` as well as `{schedule_desc}` in per-block messages;
  cover both global and per-block rendering.
- [x] Use Discord nonce enforcement for initial signup-panel sends and reject
  edits of another author's message. This reduces retry duplicates within Discord's
  nonce deduplication window; real Discord delivery still needs verification.
- [x] Add an event-scoped participant schedule view with current-member and active
  registration checks. Project only schedule details, never organizer actions.
- [x] Consolidate the participant event page's return navigation.
- [x] Verify the schedule projection with a disposable PostgreSQL API fixture,
  including unauthenticated and withdrawn access, ordering and action privacy.
- [x] Exercise the served participant journey in Chrome: 68 assertions passed,
  including the schedule tab, return navigation, signup and team journeys. The
  fixture uses synthetic Discord membership, not live Discord.
- [x] Keep reconnecting live updates after transient failures using bounded backoff.
- [x] Replace the whole variable when autocomplete is used inside an existing
  token; cover unfinished tokens and surrounding text with focused tests.
- [x] Verify frontend typecheck and Vite build using the existing generated routes.
  The standard build's route-generator fallback could not complete in this environment.
