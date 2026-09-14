# ChasHack — Signup block, range picker, relative template schedules

Plan created: 2026-09-14. Status: done.

## Problem (three asks from janne)

1. Signup window should be a first-class block like Hackathon Starts/Ends — expandable, with actions.
2. It should use one range picker, not two separate calendar popovers.
3. A template's schedule must not carry fixed dates — items should be expressed
   relative to anchors (hackathon start / signup opens / signup closes /
   hackathon end) and resolve when the template is applied.

## Findings from the code

- A `DateRangePicker` already exists (`components/ui/date-range-picker.tsx`):
  one Popover, `Calendar mode="range" numberOfMonths={2}` + start/end time selects.
- `templateToEventInput` passes template times straight through `normalizeSchedule`
  — no rebasing. The create dialog's `applyTemplate()` copies those literal epochs
  and (because the client always sends a schedule when non-empty) the client wins
  over the template server-side. So template times are frozen dates today.
- `saveAsTemplate` stores `savedEvent.schedule` verbatim — including the hidden
  synthetic `__start__`/`__end__` blocks (templates therefore carry block actions
  the create dialog never surfaces).
- **Dead path found:** `on_activate`/`on_start` announcements have no consumer in
  the bot any more (grep: only the type union + normalization). The create/edit
  dialogs map Start/End block *announce* actions into those triggers, so those
  announcements are written and never sent. Fix while touching the blocks: block
  actions (announce included) ride on the synthetic schedule item.

## Decisions

- **`ScheduleItem` gains `anchor?` + `offsetMinutes?`** (`'hackathon_start' |
  'signup_start' | 'signup_end' | 'hackathon_end'`, offset from the anchor day's
  00:00, negatives allowed). `time` stays the absolute value the planner uses.
- **Resolution rule** (bot is authoritative, admin mirrors it): anchor date =
  `hackathon_start→startsAt`, `signup_start→signupStartsAt ?? startsAt`,
  `signup_end→signupEndsAt ?? startsAt`, `hackathon_end→endsAt ?? startsAt`;
  `time = startOfDay(anchorDate) + offsetMinutes*60000`. No anchor date at all →
  the literal `time` stands (nothing to compute from).
- **Anchored items follow the dates.** The server re-resolves on every
  create/update, and the dialog re-resolves while you edit dates, so times move
  live. Editing an item's time by hand clears its anchor (it becomes absolute).
- **Synthetic blocks are the only home for block actions.** The dialog keeps
  Start/End/**Signup** actions in state; templates store them on `__start__` /
  `__end__` / `__signup__` items, and `applyTemplate()` splits them back into
  state so the user sees them. Legacy `on_activate`/`on_start` announcements are
  still read (so old events load) but never written any more.
- **Signup block = one `PinnedBlock`** ("Signup window", primary styling) whose
  body is a `DateRangePicker` plus the shared `InlineActions`; its actions fire
  at the window's open time.
- Deferred (say so to janne): signup-window *actions* inside templates.

## Checklist

- [x] Bot: `ScheduleAnchor` + `anchor/offsetMinutes` on `ScheduleItem`,
      `normalizeSchedule` passthrough, `resolveScheduleAnchors()` in create/update
- [x] Bot: tests for resolution (anchors, fallbacks, negative offsets, no dates)
- [x] Bot: `saveAsTemplate` converts the schedule to relative (anchor hackathon_start)
- [x] Admin: `types.ts` + `lib/schedule-anchor.ts` (options, resolve, toRelative)
- [x] Admin: `ScheduleEditor` — signup `PinnedBlock` with `DateRangePicker` +
      actions (`signupActions`/`onSignupActionsChange`), `timeMode="relative"`
      for template editing, anchor chip + "Day N HH:MM" editors
- [x] Admin: EventsPage — signup actions state, block announce actions ride the
      synthetic blocks (no more on_activate/on_start writes), applyTemplate split
      + live re-resolution, `__signup__` filtered from lists
- [x] i18n en + sv for every new string
- [x] Verify: bot build + tests, admin-ui tsc + build; sweep `__start__`/`__end__`
      sites for the new `__signup__` id
