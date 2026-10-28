# Event create wizard + edit tabs, theme modes, distinct team colours

Plan created: 2026-10-28. Status: in progress.

## What's wrong today (janne)

- Creating an event is one long scroll: basics, dates, block schedule,
  assignments, form, channels, cleanup delay, checkboxes and the action bar all
  live in a single modal. Nothing is grouped, and the actions sit at the very
  bottom.
- Editing an event has the same problem — the edit dialog stacks name,
  description, team size, cleanup, schedule, signup policy, assignments, form
  and theme in one column.
- The light/dark control is a toggle. There is no way to follow the operating
  system.
- Teams created by matching / group imports store `color = NULL`, so every role
  renders the same blurple fallback. The palette is also only seven colours,
  which is not enough for a hackathon with a dozen teams.

## Decisions

- **Create = 5-step wizard** inside the existing dialog: Basics → Schedule →
  Assignments → Form → Review. A step rail shows where you are; Back/Next move
  between steps; every step offers **Save as draft** (events already support
  `status = 'draft'`, so no new endpoint). Only Review offers **Create &
  launch**.
- **Edit = one modal with tabs** (`Basics · Schedule · Assignments · Form ·
  Theme`) using the shared `Tabs` primitive. Save/Cancel stay pinned to the
  bottom and save every tab at once, exactly like today's single form.
- **Draft saving is the same create call** (`launch: false`), so nothing on the
  server changes.
- **Theme = three modes** (`light`, `dark`, `system`), stored under the existing
  `chas-theme` key. `system` follows `prefers-color-scheme` live. The pre-paint
  script in `index.html` resolves the stored mode before first paint.
- **Team colours: distinct by default.** New teams without an explicit colour
  take the first palette colour not already used in the event; when the palette
  is exhausted it cycles. Existing teams retain their colours and Discord role appearance.
- **Palette grows to 16 colours**, kept identical in the bot (`TEAM_COLORS`) and
  the admin console (`TEAM_COLOR_SWATCHES`).

## Checklist

- [x] Bot: expand `TEAM_COLORS`; add `nextTeamColor`
- [x] Bot: use the default in `createTeam`, `joinGroupTeam`, `commitMatch`
- [x] Bot: tests for distinct colours; preserve existing teams
- [x] Admin UI: 16 swatches matching the bot palette
- [x] Admin UI: three-mode theme menu (desktop + mobile) and pre-paint script
- [x] Admin UI: create wizard with draft saving on every step
- [x] Admin UI: edit dialog split into tabs
- [x] i18n en + sv for every new string
- [x] Verify: bot build + tests, admin-ui tsc + build + tests
- [x] PR against `main`

## Audit follow-up

- [x] Accessible participant member selection and actionable search errors.
- [x] Rate-limit participant Discord member searches.
- [x] Preserve incomplete event form drafts and reject activation until valid.
- [x] Avoid orphan form templates when event creation fails.
- [x] Localize event creation, support participant theme choices, and remove the design merge marker.
- [x] Verify affected database and browser flows; update the existing PR.

## Independent review follow-up

- [x] Verify that random opt-ins are distributed evenly across partially filled teams.
- [x] Preserve old published form answers while rejecting blank new questions on activation.
- [x] Keep draft form, theme and signup-policy edits synchronized across tabs.
- [x] Verify the repaired flows and update the PR.
