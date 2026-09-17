# chashack-bot — architecture map (read this first)

## Monorepo

```
apps/bot         Discord bot + Fastify API (TypeScript, node:sqlite)
apps/admin-ui    React admin panel (Vite, TanStack Router, Tailwind 4)
```

## Backend: vertical slices (apps/bot/src)

Each feature slice is self-contained. **Dependency rule: slices may import
each other's `domain/` files and public service functions; nothing outside a
slice touches its `data/` (SQL) files.**

```
features/<slice>/
  domain.ts      pure types + pure logic (no SQL, no Discord, no I/O)
  data.ts        ALL SQL for the slice (prepared statements, row mapping)
  service.ts     orchestration (when a slice needs composition) — optional
  *.test.ts      colocated tests
```

| Slice      | Owns                                                        |
| ---------- | ----------------------------------------------------------- |
| `form/`    | Form config domain (validation, palette), form_config SQL   |
| `signup/`  | Participants: signup data, status lifecycle                 |
| `teams/`   | Teams data, join requests/invites data                      |
| `matching/`| Compatibility engine (pure domain), match commit data       |
| `events/`  | Event CRUD + lifecycle + templates + maintenance planner    |
| `auth/`    | Guild authorisation (permissions ∩ bot presence), session mint/verify, `web_sessions` SQL |

Where things live:

```
discord/          interaction layer only (commands, modals, buttons, DMs)
  provision.ts    role/channel creation + teardown (Discord API side effects)
  notify.ts       announcements, DM blasts, scheduled events, maintenance loop
  signup-panel.ts the persistent signup panel message
  dispatch.ts     interaction router — builds Ctx, checks admin, dispatches
adminweb/         Fastify API routes + static serving of the built admin UI
shared/           db.ts (migrations), env.ts, result.ts, audit.ts
```

Rules:

1. **SQL only in `data.ts` files.** Everything is `?`-parameterized; no
   string interpolation of values, ever. (SQLite cannot parameterize PRAGMA,
   so table-name interpolation there is limited to internal constants.)
2. **domain.ts is pure.** No node:sqlite, no discord.js imports.
3. Discord handlers never write SQL — they call slices and map Results.
4. New feature = new slice folder + a row in this table.

## Frontend (apps/admin-ui/src)

```
routes/     TanStack Router file routes (routeTree.gen.ts is generated)
views/      panels per route (thin; data via api.ts)
components/ui/  hand-rolled shadcn-style primitives (Radix based)
assets/brand/   ChasHack marks (hex motif)
```

World: "Honeycomb playtech" — see src/index.css @theme block. Dark default,
light mode via `data-theme` on `<html>`.

## Two surfaces, one data layer

Every capability is reachable from the **web console** and the **Discord bot**,
and both write the same rows — there is no Discord-side copy of anything:

```
admin UI → api.ts → adminweb/routes.ts ─┐
                                        ├→ features/*/data.ts → SQLite
Discord interaction → dispatch.ts ──────┘
```

Consequences worth remembering:

- **Guild scoping is per request.** Every route resolves its guild with
  `guildOf(req)` (session → configured `DISCORD_GUILD_ID` fallback); never capture
  a guild id at module scope, it silently reads and writes another server's data.
- **Rich editors live in the console** (schedule blocks, signup form, assignment
  collections), Discord gets actions (lock, match, announce, itinerary) and
  `/hackathon-admin console` for the link. Don't rebuild an editor as a slash
  command with eight options.
- **Two commands, split by audience**: `/hackathon` is participant-facing, and
  `/hackathon-admin` carries `default_member_permissions` so Discord hides it from
  everyone else. Discord only supports that field on the top-level command —
  a per-subcommand value is dropped at registration.

## Change propagation (update every twin, or it silently half-works)

| When you change… | Also update | Failure mode when you forget |
| --- | --- | --- |
| An event/template field | DB column + `INSERT`/`UPDATE` value lists · row mapper · type · `normalizeX()` · `createEvent`/`updateEvent` · `templateToEventInput()` · admin `types.ts` + `api.ts` · the dialogs · the `notify.ts` consumer | Column missing from the INSERT list stays `NULL` — no error, just never persists |
| A user-facing string | `admin-ui .../i18n/en.json` **and** `sv.json` · bot strings in `shared/i18n.ts` (en + sv) | Swedish is first-class for participants and organizers |
| A slash command / subcommand | `discord/commands.ts` · `cmd.<name>.desc` in both catalogs · `dispatch.ts` routing (`eventAdminSubs` for event tools) · the handler | A declared-but-unhandled subcommand fails only at runtime |
| A schedule action type | `ScheduleAction` union · `normalizeSchedule` · `schedule-editor.tsx` · the `notify.ts` runner · planner tests | Three editors render actions; `assign_random` is a legacy alias of `auto_match` |
| A guild-scoped setting | `guild_settings` column (+ `addColumnIfMissing`) · type · `updateGuildSettings` · `POST /api/guild/settings` validation · `ConfigPage` · every bot reader | Works in the console, ignored in Discord |
| An HTTP endpoint | `routes.ts` with `guildOf(req)` / `resolveEventId(req)` · `api.ts` method + input type · the caller | Unscoped route reads the wrong server |
| Auth/session logic | `features/auth/domain.ts` + `data.ts` + `routes.ts` · `web_sessions` · the login/picker UI · keep `/api/login` and `/api/auth/mode` the only public routes | A valid cookie whose row is gone must authenticate nothing |
| Public env keys | `.env.example` · README setup · `shared/env.ts` | `PUBLIC_URL` drives the cookie `Secure` flag and the CSRF origin check |
| Visual tokens | `DESIGN.md` · re-run `impeccable detect` | The detector reports drift |
| Product facts | `PRODUCT.md` — rewrite the changed "held-true fact" | The next reader trusts a stale fact |

## Verify before committing

```bash
cd apps/bot && npm run build && npm test      # tests run dist/**, so build first
cd apps/admin-ui && npx tsc --noEmit && npm run build
```

Command coverage — every declared subcommand needs a handler:

```bash
cd apps/bot/src/discord
grep -oE "sub\('[a-z-]+'" commands.ts | sed "s/sub('//;s/'//" | sort -u > /tmp/declared.txt
grep -ohE "case '[a-z-]+'" user-commands.ts admin-commands.ts event-commands.ts | sed "s/case '//;s/'//" | sort -u > /tmp/handled.txt
comm -23 /tmp/declared.txt /tmp/handled.txt    # anything listed here is unroutable
```

Discord ground truth — read back what Discord stored, not what you sent:

```bash
curl -s -H "Authorization: Bot $DISCORD_TOKEN" \
  "https://discord.com/api/v10/applications/$CID/commands?with_localizations=true"
```

(`with_localizations` is accepted only on the **global** list endpoint, and
`default_member_permissions` is stored only on the top-level command.)
