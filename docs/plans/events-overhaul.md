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

## 7. Assignment collections (rework of #1 — corrected model)

janne clarified #1: assignments should not live inside event templates. They want
**standalone collections** — a named, reusable set of assignments with title,
instructions, description and **image** — authored once on the Templates page and
picked at event creation.

**Model:**
- New template kind `assignments` (alongside event/form/announcement). JSON =
  `{ assignments: Assignment[] }`; the template name is the collection name.
- `Assignment` gains `imageUrl?: string` — attached to the Discord message when
  the assignment is dealt to a team channel.
- Event template remembers the **default collection id + strategy**; the create
  dialog can override both. No more embedded assignment arrays in event templates
  (old ones keep working — `templateToEventInput` still maps the legacy key).
- Event keeps its own **snapshot** of the pool at creation (same semantics as the
  signup form). The per-event edit dialog can tweak that snapshot afterwards.
- `createEvent` no longer silently seeds default assignments — if no pool is
  chosen, nothing is distributed. Explicit over implicit.
- The `distribute_assignments` action is only injected when a pool exists.

## Verification

Per workstream: `tsc --noEmit` in both apps, `npm run build` in admin-ui, `npm test` in bot.
New backend logic gets unit tests. Final: push to `origin/main`.

---

## Progress

- [x] 1. Assignments in templates + strategy at create *(superseded by #7)*
- [x] 2. Remove redundant active-event buttons
- [x] 3. Single Edit button
- [x] 4. Save as draft / launch
- [x] 5. All-events search + filter + sort
- [x] 6. Multi-event support
- [x] 7. Assignment collections (rework of #1)

## Notes / follow-ups

- Multi-event: `resolveEventId()` (bot/src/adminweb/routes.ts) takes an explicit
  `eventId` from query or body, else falls back to newest-active → newest-any.
  The UI persists the pick in `localStorage['chas-event']` and only renders the
  switcher when 2+ events are live.
- Multi-event actions: the event-scoped api calls (participant actions, team
  assignment/creation, match preview/commit/lock/unlock/suggestions, reset) all
  carry the selected eventId so actions pin to the event being VIEWED — not
  "newest active". Team delete/settings/remove-member are team-id-scoped and
  need no eventId. Events-tab mutations were already path-scoped (`:eventId`).
- Event cards for live events other than the one being managed get a "Manage"
  button that selects them.
- Bug found by tests: `withAssignmentDistribution` originally returned early on an
  empty schedule, so an event created with no schedule never got the distribute
  action — assignments silently would not fire. Now the Start block is
  synthesised whenever a start time exists.
- The `Link`/`useT` imports in EventsPage are still used by the event cards.
