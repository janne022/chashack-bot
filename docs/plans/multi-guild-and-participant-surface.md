# Program: multi-guild at scale + participant web surface

Status: **planned** — issues opened, execution delegated to reviewed PRs.
Owner: janne. Related: `multi-guild-oauth.md` (console-side multi-guild, shipped `a125505`).

## Why

1. **Multi-guild is half-done.** Every table is `guild_id`-scoped and the console picks its guild
   server-side (`guildOf(req)`), so several guilds already coexist in one process. But the data
   layer is one SQLite file with a **synchronous** API (`Db = DatabaseSync`) opened by that process.
   That holds for a handful of guilds on one container; it does not hold for more than one process,
   for a managed/external database, or for per-guild databases.
2. **Participants have no web surface.** Discord is their only interface — no browser view of
   status, form answers, team, or schedule.
3. **Local dev has no orchestrator.** Bot + console + (new) participant app + a database is a set of
   manual steps; there is no single entry point and no disposable Postgres for verification.

## What already exists — do not rebuild

| Capability | Where | State |
| --- | --- | --- |
| Guild-scoped tables + per-request `guildOf(req)` | everywhere | shipped |
| Console guild picker, Discord OAuth (admin scopes) | `features/auth/*`, `web_sessions` | shipped |
| Multi-event per guild | `resolveEventId(req)`, event switcher | shipped |
| Kysely | `shared/kysely.ts` — typed SQL, **SQLite-only dialect** | adapter only |
| Vertical slices | `features/<slice>/{domain,data}.ts` + tests | shipped |

## Workstreams

| WS | Issue | Depends on | Exclusive file ownership |
| --- | --- | --- | --- |
| 1 | Residual dead code | — | `apps/admin-ui/src/**` only |
| 2a | Async, dialect-portable data layer | 1 | `apps/bot/src/shared/{db,kysely,env}.ts`, `apps/bot/src/features/*/data.ts`, `apps/bot/src/discord/*` + `adminweb/routes.ts` (call sites) |
| 2b | Postgres dialect + dual-dialect tests | 2a | `apps/bot/src/shared/db/**`, `apps/bot/scripts/**`, CI/docker |
| 3 | Aspire TypeScript AppHost | 2a | `apphost.mts`, `.aspire/`, `tsconfig.apphost.json`, root `package.json` scripts, `docs/DEV.md` |
| 4 | Participant web surface | 2a | `apps/web/**` (new), `apps/bot/src/features/participant/**` (new), `apps/bot/src/adminweb/participant-routes.ts` (new) |
| 5 | Multi-guild isolation audit | 2a | `apps/bot/src/**/*.test.ts` (new tests only) |

Dependency graph:

```
WS1 ──> WS2a ──┬──> WS2b
               ├──> WS3
               ├──> WS4
               └──> WS5
```

WS2b, WS3, WS4 and WS5 may run in parallel once WS2a lands: their file sets are disjoint
(routes.ts call-site edits belong to WS2a; WS4 adds a *new* route module and only registers it).

## Contracts every workstream must honour

- **SQL lives only in `data.ts`**; `domain.ts` stays pure; handlers never write SQL.
- **Guild scoping is per request** — `guildOf(req)` for console routes; a participant route derives
  its guild from the session and the event, never from the client.
- **Both language catalogs** (`en.json` + `sv.json`, `shared/i18n.ts`) in the same commit as any
  user-facing string.
- **No new dependency without janne's review.** Prefer hand-writing small things. A dependency
  published less than 3 days ago is refused by `minimumReleaseAge: 4320` (strict) — report the
  refusal, never lower the gate.
- **A product fact changes → `PRODUCT.md` changes** ("One Discord guild", "participants never touch
  the console", "one SQLite file" are all facts WS2–WS4 invalidate).
- **Changes land through a reviewed PR** — never a direct push to `main`.

## Review process (applies to every workstream)

1. **PR body is the spec.** Numbered requirements (`R1…Rn`) and acceptance criteria as `- [ ]`
   items, written with the code, each settleable by *running* something — the body carries the real
   command and its real output. No criterion that cannot be settled by execution.
2. **Delegated review, posted on the PR.** A reviewer agent (never the author) attacks the diff
   *and the checklist*, tries to defeat new tests rather than run them, and posts findings as a PR
   comment with the commands it used. Self-approval is impossible on a shared token — a comment is
   the review artifact.
3. **Every finding is settled**: fixed, or refuted on the PR with the command that shows it does not
   hold. No silent drops, no cosmetic compliance.
4. **Verification by execution, by the tech-lead, on a fresh worktree** of the pushed sha — never
   the author's working tree. Re-run typecheck/build/tests, plus the workstream's own smoke.
5. **The tech-lead merges** (rebase), noting the reviewed sha and any delta the fixes introduced.
   Agents never merge.

## Security requirements (binding for WS4, checked in WS5)

- Identity comes from the session only. **No route ever accepts a user id, guild id, or event id
  from the client as an authorisation input** — ids are looked up by session identity.
- Participant OAuth scope is `identify` **only**; no guild permissions are requested or read.
- No OAuth access/refresh token is persisted; the exchange is used once and discarded.
- Session cookie `HttpOnly; SameSite=Strict`, `Secure` when the public origin is https; CSRF origin
  check on every state-changing request; one-shot `state` + PKCE on the login handshake.
- Participant reads are self-scoped (own row, own team) — no enumeration of other participants.
- Server-side validation of every form submission against the guild's form config; reject unknown
  field ids and oversized payloads.

## Out of scope

Per-guild deployment configuration, sharding, migrations of live production data, participant→Discord
role sync beyond what the bot already does, payments/accounts beyond Discord identity.
