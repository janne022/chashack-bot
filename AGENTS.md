# AGENTS.md — how this repo is wired

Written for whoever changes chashack-bot next, human or agent. The important
thing here is **change propagation**: one capability is spread across several
layers, and updating one layer without its twins fails *silently* — a column that
never persists, a string with no Swedish, a command nobody can invoke. Read this
before the change; extend it when you add a layer.

Deeper detail lives in `docs/ARCHITECTURE.md` (layout, propagation map, verify
recipes) and in the **chashack-admin** skill.

## What this is

A Discord hackathon-ops bot plus its organizer web console, for ChaS's own
hackathons. Two surfaces, **one data layer** — the console and the bot read and
write the same rows; there is no Discord-side copy of anything.

```
admin UI → api.ts → adminweb/routes.ts ─┐
                                        ├→ features/*/data.ts → SQLite
Discord interaction → dispatch.ts ──────┘
```

## Layout

```
apps/bot     src/features/<slice>/   domain.ts (pure) · data.ts (all SQL) · *.test.ts
             src/discord/            commands.ts · dispatch.ts · user-|admin-|event-commands.ts
             src/adminweb/routes.ts  every HTTP route (all guild-scoped)
             src/shared/             db.ts (schema + migrate) · env.ts · i18n.ts · audit.ts
apps/admin-ui  React PWA — views/, panels/, components/ui/, lib/i18n/{en,sv}.json
docs/plans/    one plan doc per multi-part feature (write it before building)
PRODUCT.md · DESIGN.md · docs/ARCHITECTURE.md
```

## The rules that are not obvious

- **SQL lives only in `data.ts`.** Handlers call slices, they never write SQL.
- **`domain.ts` is pure** — no SQLite, no discord.js.
- **Guild scoping is per request.** Routes resolve their guild with `guildOf(req)`;
  a guild id captured at module scope reads and writes another server's data.
- **The session row is the session.** A cookie whose `web_sessions` row is gone
  must authenticate nothing.
- **Swedish is first-class**, for participants *and* organizers. Every
  user-facing string lands in both catalogs (`en.json` + `sv.json` in the admin
  UI, `shared/i18n.ts` for the bot) in the same commit.
- **Plan docs first** for anything multi-part; tick items as they land.
- **No new dependency without janne's review** — hand-write it if it's small
  (the whole Discord OAuth flow is ~60 lines of `fetch` + `node:crypto`).

## Change propagation — update every twin

| When you change… | Also update | Failure mode when you forget |
| --- | --- | --- |
| An event/template field | DB column + `INSERT` **and** `UPDATE` value lists · row mapper · type · `normalizeX()` · `createEvent`/`updateEvent` · `templateToEventInput()` · admin `types.ts` + `api.ts` · the dialogs · the `notify.ts` consumer | Column missing from the INSERT list stays `NULL` — no error, it just never persists |
| A user-facing string | `admin-ui .../i18n/en.json` **and** `sv.json` · bot strings in `shared/i18n.ts` (en + sv) | Someone reads English mid-flow in a Swedish hackathon |
| A slash command / subcommand | `discord/commands.ts` · `cmd.<name>.desc` in both catalogs · `dispatch.ts` routing (`eventAdminSubs` for event tools) · the handler | Declared-but-unhandled only fails at runtime, in front of users |
| A schedule action type | `ScheduleAction` union · `normalizeSchedule` · `schedule-editor.tsx` · the `notify.ts` runner · planner tests | Three editors render actions; `assign_random` is a legacy alias of `auto_match` |
| A guild-scoped setting | `guild_settings` column (+ `addColumnIfMissing`) · type · `updateGuildSettings` · `POST /api/guild/settings` validation · `ConfigPage` · every bot reader | Works in the console, ignored in Discord |
| An HTTP endpoint | `routes.ts` with `guildOf(req)` / `resolveEventId(req)` · `api.ts` method + input type · the caller | A route that ignores the session's guild crosses servers |
| Auth / session logic | `features/auth/{domain,data}.ts` + `routes.ts` · `web_sessions` · login/picker UI · keep `/api/login` and `/api/auth/mode` the **only** public routes | A revoked cookie keeps working |
| Public env keys | `.env.example` · README setup · `shared/env.ts` | `PUBLIC_URL` drives the cookie `Secure` flag and the CSRF origin check |
| Visual tokens / patterns | `DESIGN.md` · re-run `impeccable detect` | The detector reports drift |
| A product fact | `PRODUCT.md` — rewrite the changed "held-true fact" (e.g. single guild → multi-guild) | The next reader trusts a stale fact |

## Deliberate design choices (don't "fix" these)

- **Two commands, split by audience**: `/hackathon` (participants) and
  `/hackathon-admin` (organizers, `default_member_permissions`). Discord honours
  that field **only on the top-level command** — a per-subcommand value is dropped
  at registration — so one command cannot both gate admin tools and stay public.
- **Rich editors live in the web console** (schedule blocks, signup form,
  assignment collections). Discord gets the actions (lock, match, announce,
  itinerary) plus `/hackathon-admin console` for the link. Don't rebuild an editor
  as a slash command with eight options.
- **Registration is per guild for every guild the bot is in** — instant
  propagation, and the opposite layer is cleared so a command never shows twice.
  `DISCORD_GUILD_ID` is only the password-session fallback guild now.
- **The console is multi-server; the client never names a guild.** Switching is
  validated server-side against the session's stored guild list.

## Verify before you commit

```bash
cd apps/bot && npm run build && npm test        # tests run dist/**, so build first
cd apps/admin-ui && npx tsc --noEmit && npm run build
```

Command coverage — every declared subcommand needs a handler:

```bash
cd apps/bot/src/discord
grep -oE "sub\('[a-z-]+'" commands.ts | sed "s/sub('//;s/'//" | sort -u > /tmp/declared.txt
grep -ohE "case '[a-z-]+'" user-commands.ts admin-commands.ts event-commands.ts | sed "s/case '//;s/'//" | sort -u > /tmp/handled.txt
comm -23 /tmp/declared.txt /tmp/handled.txt    # anything here is unroutable
```

Read back what **Discord** stored instead of trusting what you sent: list the
application's commands (`GET /applications/{application_id}/commands` for the
global set, `.../guilds/{guild_id}/commands` for a guild) and inspect each entry.

- `description_localizations` — an `sv-SE` value on every command *and* subcommand
  means the Swedish help text survived registration.
- `default_member_permissions` — must be `32` (Manage Server) on `hackathon-admin`
  and absent on `hackathon`.

Two details that cost time to rediscover: `with_localizations=true` is accepted
only on the **global** command list (the guild-scoped one rejects it), and Discord
stores `default_member_permissions` only on the top-level command.

## Running it locally without touching Discord

```bash
cd apps/bot && SKIP_DISCORD=1 ADMIN_PASSWORD=<tmp> DISCORD_GUILD_ID=<snowflake> DB_PATH=/tmp/x.db node dist/index.js
```

- A snowflake-shaped guild id is required, or event creation returns `guild_not_configured`.
- The API serves the **built** UI and caches its file list at boot: rebuild, then restart.
- Sessions are `HttpOnly`; for a headless browser use a proxy that injects the cookie
  **and forwards the browser's `Host`/`Origin`** — the API rejects mismatched origins.
- Kill by port (`ss -ltnpH 'sport = :8420'`), not `pgrep`: `DB_PATH` is an env var.
- To test a Discord session without a real login, insert a `web_sessions` row and sign
  the cookie: `hmac_sha256(ADMIN_SESSION_SECRET ?? ADMIN_PASSWORD, 'session:<exp>:<id>')`.
