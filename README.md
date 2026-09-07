# chashack-bot

Discord bot for hackathon team signups, compatibility-based team matching, and a
web admin panel for organizers.

## Features

**Discord bot** (`/hackathon`)

- `join` — modern Discord modal (labels + select menus, discord.js ≥ 14.23):
  name, experience level, role track, skills (multi-select), team preference.
  The form is admin-configurable and changes apply immediately.
- `status` — your signup + team
- `teammates` — declare up to 5 friends you want on a team (mutual mentions are
  kept together during matching)
- `create-team` — public (listed) or private (join code) teams
- `teams` / `join-code` / `team-code` / `leave-team` — browse and manage teams
- `leave` — withdraw your signup
- `admin …` — organizer subcommands: block/unblock/remove signups, move people
  between teams (with a picker), preview/commit matching, reset the event

**Matching engine**

- Pairwise compatibility score (0–100): skill overlap, complementary role
  tracks (frontend×backend, design×backend, …), experience mix, friend pulls.
- Skill groups (e.g. backend languages) are mutually exclusive in the form, so
  a "C# backend" and a "Node backend" are distinguishable people.
- Mutual friend mentions are hard constraints; one-way mentions are strong soft
  preferences and are reported when split.
- Greedy agglomerative formation: friend groups seed teams, then the globally
  best (team, candidate) pairing is placed repeatedly. Nothing is written until
  an organizer commits; committing announces lineups and can be re-run.

**Admin web panel** (React 19 + Tailwind v4 + Radix-based UI, served by the bot)

- Overview with live stats, recent activity and the event reset danger zone
- Participants: search/filter, inline team reassignment, block/unblock,
  remove/reactivate signups
- Teams: create/delete, kick members, rotate private join codes
- Matching: preview → conflict report → commit, with per-team scores
- Form editor: title, team size, description, role tracks and skill groups —
  the Discord modal rebuilds from this config on every open
- Audit log of every mutation

## Stack

| Piece         | Choice                                                       |
| ------------- | ------------------------------------------------------------ |
| Runtime       | Node ≥ 22.13 (uses built-in `node:sqlite` — no native deps)  |
| Bot           | discord.js 14.27                                             |
| API/server    | Fastify 5 + @fastify/static (serves the built admin UI)      |
| Admin UI      | React 19, Tailwind CSS 4, Radix primitives, lucide icons     |
| Storage       | SQLite (WAL) at `data/chashack.db`                           |
| Tests         | `node:test` (16 tests: form domain, matching engine, integration) |

Both apps are exact-pinned and governed by a **supply-chain risk lock**:
`minimumReleaseAge: 4320` (3 days) + `minimumReleaseAgeStrict: true` in
`pnpm-workspace.yaml`, plus a `postinstall` guard that refuses dependency
install scripts (`apps/bot/scripts/no-install-scripts.mjs`).

## Layout (pnpm workspace)

```
apps/bot         Discord bot + API + admin server (TypeScript, vertical slices)
  src/features/  form | signup | teams | matching  (domain + service per slice)
  src/discord/   commands, modal builder, handlers, dispatch
  src/adminweb/  Fastify routes + static serving
  src/shared/    db (migrations), env, result, audit
apps/admin-ui    React admin panel (Vite)
```

## Setup

```bash
pnpm install                      # workspace install (supply-chain gated)
cp .env.example .env              # fill in Discord creds + admin password
pnpm build                        # bot (tsc) + admin UI (vite)
pnpm register:commands            # register /hackathon (guild = instant)
pnpm --filter bot start           # bot + admin UI on ADMIN_PORT
```

Environment variables: see `.env.example`. `DISCORD_GUILD_ID` is recommended
(single-guild, instant command registration). Admins = `ADMIN_IDS` + anyone
with Manage Server. The admin panel lives at `http://localhost:8420`.

## Development

```bash
pnpm typecheck            # both apps, strict TS
pnpm test                 # node:test suite (compiled first)
pnpm --filter bot test    # bot suite only
node apps/bot/scripts/smoke-admin.mjs          # API/auth/SPA smoke checks
BOOT_ADMIN=1 node apps/bot/scripts/dev-admin.mjs  # seeded demo on :8491
```

## Notes

- The matching engine is deterministic and pure (`features/matching/engine.ts`)
  — team scores, friend merging and placement are all unit-tested.
- `commitMatch` dissolves previous matched teams before writing new ones, so
  re-running matching after dropouts is safe.
- Event reset clears participants + teams but keeps the form config.
