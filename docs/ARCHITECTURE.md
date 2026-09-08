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
