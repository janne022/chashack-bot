# CSV signup import (backend slice)

Scope: organizer-only CSV import for an explicitly selected existing event, stored separately from Discord participants until verified linking. No Google integration, identity inference, account/team creation, or participant-facing exposure. Frontend journey is owned by the dependent card.

## API contract

All routes are session-authenticated and scoped through `guildOf(req)` plus ownership of the path `eventId`; clients never submit guild IDs. Draft/active events accept imports; ended events reject writes. Private answers are organizer-only.

- `POST /api/events/:eventId/signup-import/preview` `{ csv: string, mapping?: Record<header,string> }` → `{ headers, suggestedMapping, rows: [{ rowNumber, values, answers, issues, duplicateStatus }], summary: { create, duplicate, conflict } }`. No writes. Mapping keys are CSV headers; targets are core field names or current event form question IDs. Unmapped cells persist as `values['source:<header>']` so answers are not dropped.
- `POST /api/events/:eventId/signup-import` `{ rows: [{ sourceRow, values, answers }] }` → `{ saved, skipped, conflicts, rows: [{ sourceRow, id?, status }] }`. Edited preview rows are revalidated against the current form and core choices; event-local email uniqueness and an event-row transaction lock serialize retries. Exact replays skip; changed candidates conflict without overwriting organizer edits.
- `GET /api/events/:eventId/imported-signups` → `{ records: [{ id, sourceRow, sourceTimestamp, formVersion, values, answers, discordUsername, discordUserId, state, missingFields }] }`.
- `PATCH /api/events/:eventId/imported-signups/:id` `{ values?, answers?, discordUsername?, linkDiscordUserId? }` → `{ record, linked, activated, missingFields }`. Link only an explicitly selected snowflake after fresh guild membership checks; incomplete records retain the verified link but no participant row until complete. Participant/answer creation is transactional and refuses blocked/existing identities.

CSV parser limits and accepted syntax are enforced server-side. Exact duplicate keys are skipped; contradictory identity keys conflict; keyless rows require review. Existing signup conflicts are never overwritten. Group/member text is metadata only.

## Acceptance checklist

- [x] Backend parser, storage, scoped routes, explicit linking and privacy/retention behavior implemented and covered.
- [ ] Frontend organizer journey (dependent card; intentionally not implemented here).
- [ ] `pnpm typecheck` and `pnpm build && pnpm test && node apps/bot/scripts/smoke-admin.mjs` on approved disposable PostgreSQL `_test`/`_ci` database.
