# Local development with Aspire

One command brings up the whole stack locally: Postgres (+ pgWeb DB UI), Redis
(+ Insight UI), the bot's admin API, and the admin console — wired together and
visible in the Aspire dashboard.

> Never used Aspire before? Aspire runs a local orchestrator plus a web
> dashboard. The stack is described in `apphost.mts` at the repo root; each
> entry there is a **resource** (a container or process) that the dashboard
> shows with logs, env vars and endpoints.

## TL;DR — from clone to running

```bash
git clone https://github.com/janne022/chashack-bot.git
cd chashack-bot
pnpm install            # workspace deps + AppHost dev deps
pnpm build              # compiles apps/bot to dist/ (the AppHost runs dist/index.js)
pnpm dev                # aspire restore + aspire start (runs in the background)
pnpm exec aspire ps     # or just re-run `pnpm dev`: prints resources + URLs
pnpm dev:stop           # stop the stack (keeps named volumes → data persists)
```

Where things live once it is up:

| Surface | URL | Notes |
|---|---|---|
| Aspire dashboard | printed by `pnpm dev` (e.g. `https://localhost:17xxx`) | resources, logs, env, endpoints |
| Bot admin API | `http://localhost:8420` | `/healthz` answers 200; port pinned in `apphost.mts` |
| Admin console | printed by `pnpm dev` (Vite dev server, typically `http://localhost:5173`) | proxies `/api` → `localhost:8420` (vite.config.ts) |
| pgWeb (Postgres UI) | dashboard → resource `pgweb` | opens pre-wired against the Postgres container |
| Redis Insight | dashboard → resource `cache-insight` (under `cache`) | wiring only; no service reads Redis yet |
| Postgres | internal to the stack | database `chashack`; no host port published |

Tear down completely (including data):

```bash
pnpm dev:stop
docker volume rm chashack-pgdata chashack-redisdata   # optional, destroys data
docker compose -f apps/bot/docker-compose.yml down    # only if you also ran the compose path
```

`pnpm dev` is idempotent: it re-runs `aspire restore` (fast no-op when warm)
and starts any resources that are not running.

## The scripts (root package.json)

- `pnpm dev` — **restore + start + ps**. Restore first is mandatory: `.aspire/`
  (the AppHost's generated typed bindings, imported by `apphost.mts`) is
  gitignored, so `tsc` and `aspire start` fail on a fresh clone until restore
  has run.
- `pnpm dev:stop` — stop the stack.
- `pnpm aspire <args>` — **use this for any other aspire command** (logs,
  describe, ps, stop). Equivalent to `aspire <args>` but with
  `DOTNET_SYSTEM_GLOBALIZATION_INVARIANT=0` set.

### Why INVARIANT=0 is hardcoded

This VM exports `DOTNET_SYSTEM_GLOBALIZATION_INVARIANT=1` globally, and the
Aspire dashboard crashes under it (`TypeInitializationException`, OTLP exports
fail with `DEADLINE_EXCEEDED`). The root `aspire` script pins it to `0` for
every invocation. If you run `aspire` directly in a shell, do:

```bash
DOTNET_SYSTEM_GLOBALIZATION_INVARIANT=0 aspire <command>
```

The failure signature without it is confusing (dashboard dies, then the CLI
waits on a dead resource service) — it does not mention globalization.

## Resource wiring (what injects what)

Declared in `apphost.mts`:

- `postgres` — Postgres container, named volume `chashack-pgdata`, database
  `chashack`, pgWeb UI attached.
- `cache` — Redis container, named volume `chashack-redisdata`, Insight UI
  attached. **Wiring only** — no service reads Redis yet (caching is a later
  workstream); the env var below is injected so that work is additive.
- `bot-api` — `node dist/index.js` in `apps/bot`, receives:
  - `DATABASE_URL` — from the `chashack` **database** reference. Form: an
    **ADO.NET-style connection string**
    (`Host=…;Port=…;Username=…;Password=…;Database=chashack`), **not** a
    `postgresql://` URL. If code needs a URL, translate explicitly. (The bot's
    data layer is SQLite today; the Postgres migration is a later workstream —
    this env var is injected so that work starts from a wired stack.)
  - `REDIS_URL` — from the `cache` reference (same caveat family: Aspire
    injects connection-string style values, not URLs).
  - `SKIP_DISCORD=1` — run the admin web server without the Discord gateway.
  - `ADMIN_PASSWORD` — Aspire parameter (default `admin` locally; override by
    exporting `ADMIN_PASSWORD` before `pnpm dev`). The bot fails fast when it
    is unset, even with `SKIP_DISCORD=1`.
  - `ADMIN_PORT` — pinned to 8420, matching the admin console's dev proxy
    (`/api` → `http://localhost:8420` in `apps/admin-ui/vite.config.ts`).
  - Health check: `GET /healthz` (the dashboard marks the resource healthy).
- `admin-ui` — Vite dev server, receives `API_URL` = the bot API's endpoint
  URL from the resource reference.

## Discord vs SKIP_DISCORD

`SKIP_DISCORD=1` (the default wired by the AppHost) runs only the admin web
server — no gateway connection, no slash commands, no Discord credentials
needed. Good for console/UI/data work.

To point the stack at real Discord:

1. Export `DISCORD_TOKEN` and `DISCORD_CLIENT_ID` (and optionally
   `DISCORD_GUILD_ID`, `ADMIN_IDS`) in your shell before `pnpm dev`.
2. Edit `apphost.mts`: delete the `.withEnvironment('SKIP_DISCORD', '1')` line
   (an exported `SKIP_DISCORD=0` alone is not enough — the AppHost sets the
   variable explicitly and it would win).
3. `pnpm dev:stop && pnpm dev`.

`ADMIN_PASSWORD` is required in both modes.

## Pointing the console at a locally-run bot

If you run the bot yourself outside Aspire (`pnpm --filter bot build && node
apps/bot/dist/index.js` with a `.env`), keep the console's default proxy: it
already forwards `/api` to `http://localhost:8420`. Do not start the AppHost at
the same time — the pinned port 8420 would collide.

## Troubleshooting

- **`Cannot find module './.aspire/modules/aspire.mjs'`** — run `pnpm dev` (or
  `pnpm aspire:restore`) first; `.aspire/` is generated, never committed.
- **`pnpm typecheck` fails inside `.aspire/` files on a fresh clone** — same
  reason; restore generates them.
- **Dashboard crashes / OTLP `DEADLINE_EXCEEDED`** — you ran `aspire` without
  `DOTNET_SYSTEM_GLOBALIZATION_INVARIANT=0`. Use `pnpm aspire …`.
- **`Could not invoke 'addX': Method not found`** (reflection error) — the
  Aspire CLI version and the `Aspire.Hosting.*` package versions in
  `aspire.config.json` have drifted. They must match (currently 13.5.4).
- **`pnpm typecheck && pnpm build && pnpm test` at the root** must keep
  passing; the AppHost is typechecked separately via
  `tsc -p tsconfig.apphost.json --noEmit` (also needs restore first).
- **Ports**: only 8420 (bot API) is pinned to the host; dashboard, Vite and
  pgWeb/Insight get dynamic ports — read them from `pnpm dev` output or
  `pnpm exec aspire ps`.
