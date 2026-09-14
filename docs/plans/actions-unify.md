# ChasHack — Unify schedule actions, drop legacy & duplicates

Plan created: 2026-09-14. Status: done.

## Scope

From janne: remove the schedule-channel helper text in the create dialog, strip
legacy/"Zapier-style" copy from the actions editors, and stop the same options
(distribute assignments, random/same) appearing in two different places. Unify
the duplicated components behind one implementation.

## Decisions

- **Distribution has one config point per surface.** Create dialog: the
  Assignments card (collection + strategy) — the server injects the
  `distribute_assignments` action onto Start. Edit dialog: the Start block's
  existing distribute card (mode Select reusing `STRATEGY_OPTIONS` labels).
  The manual "Distribute assignments" add-button is removed from both action
  editors; existing distribute cards stay visible/editable.
- **`assign_random` is display-only legacy.** Bot keeps accepting the old id
  (compat with stored rows). UI renders it as `auto_match`, never offers it in
  the type Select, and migrates it to `auto_match` if the user re-picks.
- **One action-card implementation.** `InlineActions` (pinned Start/End) and
  `ScheduleItemActions` (middle blocks) keep their layouts but share
  `ActionCard` / `ActionList` / `AddActionButtons` / `useActionResources`.

## Checklist

- [x] Create dialog: remove schedule/itinerary channel helper text (EventsPage)
- [x] schedule-editor: drop "(Zapier-style)" copy and the long empty-state
      paragraph; new i18n keys `events.schedule_actions_add_hint`,
      `events.schedule_actions_empty`
- [x] schedule-editor: remove "Assign random (legacy)" option/label/desc;
      `assign_random` renders as `auto_match`
- [x] schedule-editor: remove the manual "Distribute assignments" add-button;
      distribute cards reuse `STRATEGY_OPTIONS` labels; new i18n keys
      `events.schedule_action_distribute`, `events.schedule_distribute_desc`
- [x] schedule-editor: merge the two duplicated action-card JSX blocks into
      shared components; unify icons (Lock/Shuffle/UsersRound); fix the
      "startss" announce default copy bug
- [x] EditableSchedule: sync the Start distribute action with the pool on save
      (inject when pool non-empty & missing, drop when pool empty — mirrors
      createEvent's `withAssignmentDistribution` contract)
- [x] Copy sweep: TagHelp "per-block Zapier action" → "per-block action";
      AssignmentsEditor "let the zap" → plain wording; bot comment
- [x] i18n: en + sv for all new keys
- [x] Verify: admin-ui `tsc --noEmit` + build; bot build + tests green
