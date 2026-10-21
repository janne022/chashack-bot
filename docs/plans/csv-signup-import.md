# CSV signup import (backend slice)

Scope: organizer-only CSV import for an explicitly selected existing event, stored separately from Discord participants until verified linking. No Google integration, identity inference, account/team creation, or participant-facing exposure. Frontend journey is owned by the dependent card.

## API contract

All routes are session-authenticated and scoped through `guildOf(req)` plus ownership of the path `eventId`; clients never submit guild IDs. Draft/active events accept imports; ended events reject writes. Private answers are organizer-only.

- `POST /api/events/:eventId/signup-import/preview` `{ csv: string, mapping?: Record<string,string> }` → `{ headers, suggestedMapping, rows: [{ rowNumber, values, answers, issues }], summary: { create, duplicate, conflict } }`. No writes. Mapping keys are CSV headers; values are core field names or current event form question IDs.
- `POST /api/events/:eventId/signup-import` `{ rows: [{ sourceRow, values, answers }] }` → `{ saved, skipped, conflicts, rows: [{ sourceRow, id?, status, issues }] }`. Edited preview rows are revalidated; no hidden partial success.
- `GET /api/events/:eventId/imported-signups` → `{ records: [{ id, sourceTimestamp, values, answers, discordUsername, discordUserId, state, missingFields }] }`.
- `PATCH /api/events/:eventId/imported-signups/:id` `{ values?, answers?, discordUsername?, linkDiscordUserId? }` → `{ record, linked, missingFields }`. Link only an explicitly selected member ID after fresh guild membership checks; incomplete records remain drafts.

CSV parser limits and accepted syntax are enforced server-side. Exact duplicate keys are skipped; contradictory identity keys conflict; keyless rows require review. Existing signup conflicts are never overwritten. Group/member text is metadata only.

## Acceptance checklist

- [ ] Backend parser, storage, scoped routes, explicit linking and privacy/retention behavior implemented and covered.
- [ ] Frontend organizer journey (dependent card; intentionally not implemented here).
- [ ] `pnpm typecheck` and `pnpm build && pnpm test && node apps/bot/scripts/smoke-admin.mjs` on approved disposable PostgreSQL `_test`/`_ci` database.
