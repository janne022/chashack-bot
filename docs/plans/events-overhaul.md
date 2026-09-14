# ChasHack — Events tab overhaul + multi-event support

Plan created: 2026-09-14. Status: in progress.

## Scope

Seven workstreams, from janne's request. Each ends with typecheck + build + tests green.

---

## 1. Assignments live in templates; strategy chosen at create time

**Goal:** the assignment pool belongs to the event *template*. When creating an event from a
template you pick the distribution strategy; the pool is already there.

**Decisions (confirmed with janne):**
- Distribution fires **when the hackathon starts** (the pinned Start block).
- The template **remembers** the strategy (`random` | `same`), overridable at create time.

**Implementation:**
- Template JSON gains `assignments: Assignment[]` and `assignmentStrategy: 'random' | 'same'`.
- `EventTemplateEditor` gains an "Assignments" card (reuse `AssignmentsEditor`) + strategy picker.
- `TemplatesPage` `EventTemplateDialog` loads/saves both fields.
- `templateToEventInput()` (bot) maps them.
- `EventsPage.applyTemplate()` pulls both into state.
- `create()` injects a `distribute_assignments` schedule action (with `mode`) into the pinned
  **Start** block, so it runs at hackathon start via the existing schedule planner.
- Create dialog shows the pool + a strategy picker (Random per team / Same for all).
- Edit dialog (`EditableSchedule`) already exposes start-block actions, so the strategy stays
  editable after creation.

**No new runtime machinery needed** — `distribute_assignments` already exists and
`notify.ts` already executes it per team.

---

## 2. Remove redundant ActiveEventCard buttons

`Configure form`, `Change form` and `Post itinerary` are dropped from the active event card —
they duplicate what the Edit flow does.

- Itinerary: `PATCH /api/events/:eventId` already auto-posts/updates the itinerary when the
  schedule changes on an active event. The manual button is redundant.
- Form: must not lose the capability. Move form selection into the Edit event dialog so
  "Edit" is the single place to change everything.
- **Keep:** Announce, End event, Copy ID.

---

## 3. One "Edit" button instead of add/edit schedule buttons

Replace the ActiveEventCard's `Add schedule` / `Edit schedule` ghost button with a single
**Edit event** button that opens the full edit dialog. The schedule is rendered as a read-only
list on the card.

---

## 4. Create as draft, or launch immediately

- Create dialog gets two actions: **Save as draft** and **Create & launch**.
- `Create & launch` creates the event then calls activate.
- Draft cards get a **Launch event** button (rename of the current `Activate`).

---

## 5. All-events list: search, filter, sort

The `All events` section gets a toolbar:
- **Search** — name + description.
- **Status filter** — All / Draft / Active / Ended.
- **Sort** — Newest, Oldest, Name A–Z, Starts soonest.
- Empty state when filters match nothing (distinct from "no events at all").

---

## 6. Multi-event support

**Current blocker:** `activeEventId()` in `routes.ts` picks the newest active event and every
participant/team/matching route implicitly operates on it. Two live events are unaddressable.

**Plan:**
- Backend: let the relevant endpoints accept an explicit `eventId` (query param / body),
  falling back to `activeEventId()` for backwards compatibility.
- Frontend: app context holds a `selectedEventId`, persisted; an event selector in the shell
  switches which event the panels show.
- Verify the maintenance planner already iterates all events (it does — `planMaintenance`
  loops over every event), so Discord-side behaviour is already multi-event safe.

---

## Verification

Per workstream: `tsc --noEmit` in both apps, `npm run build` in admin-ui, `npm test` in bot.
New backend logic gets unit tests. Final: push to `origin/main`.

---

## Progress

- [x] 1. Assignments in templates + strategy at create
- [x] 2. Remove redundant active-event buttons
- [x] 3. Single Edit button
- [x] 4. Save as draft / launch
- [x] 5. All-events search + filter + sort
- [ ] 6. Multi-event support
