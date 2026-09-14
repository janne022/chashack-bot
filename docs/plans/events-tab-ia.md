# ChasHack — Events tab IA: overview + per-event workspace

Plan created: 2026-09-14. Status: done.

## What's wrong today (janne)

- Ended/draft/active events all sit in one grid; status filter defaults to "all".
- A **dead `View` button** on ended events (and on the currently managed event):
  it links to `/events`, the page you are already on.
- To edit an event you scroll to the list → click `Manage` → scroll back up to the
  management card → click `Edit event`. Three steps where one should do.
- The management card mixes **configuration** (cleanup delay input) with
  **operations** (announce / end). Cleanup delay belongs to create/edit only.
- Insights charts for the selected event sit between the management card and the
  list, lengthening the scroll.
- New-event modal: the "From template:" announcement `Select` is cramped — a
  `h-6 flex-1` trigger with long item labels in an item-aligned popup.

## Decisions

- **Two-tab Events page**: `Overview` (default) and one tab per open event
  (label = event name). Opening an event selects it in app state (so Operations
  keeps following the same event) and switches to its tab.
- **Overview groups by status**: *Live now* / *Drafts* / *Ended* — separate
  sections replace the status filter; search + sort stay.
- **Workspace = information + actions only**: sticky action bar (Edit event,
  Announce, Match now, Lock/Unlock teams, End event, Copy id), read-only info
  strip (dates, signup window, counts, auto-match, cleanup status), itinerary,
  insights. No configuration inputs.
- **Cleanup delay lives in create + edit dialogs only.** The workspace shows
  status only ("cleans up 48h after end" / "cleaned up").
- **Dead View link removed** — every card gets a real action (`Open`, `Launch`).
- Card actions never require scrolling: the workspace tab holds its own actions.
- Impeccable context: no PRODUCT.md (documentation gap); this is a *refinement*
  of an existing Operate surface, so the incumbent design system is authority —
  offer `/impeccable init` afterwards, don't block on it.

## Checklist

- [x] EventsPage: Tabs (Overview | event), status-grouped sections, search+sort
- [x] EventWorkspaceCard: sticky actions + info strip + itinerary + insights,
      status-aware (draft: launch; ended: read-only)
- [x] EventCard: `Open` / `Launch` / `End` actions, no dead link
- [x] Remove `CleanupDelayConfig` from the workspace; add cleanup field to the
      create dialog (if missing) and to the edit dialog payload
- [x] Fix the announcement-template Select (wider trigger, popper content,
      truncating labels)
- [x] i18n en + sv for new strings; delete orphaned keys
- [x] Verify: admin-ui tsc + build, bot tests untouched-green, screenshots of
      both states if the app can boot locally, then the impeccable detector
