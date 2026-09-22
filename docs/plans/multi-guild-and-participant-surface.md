# Program: multi-guild at scale + participant web surface

Status: **in flight** — issues #9–#16, workstreams dispatched to reviewed PRs.
Owner: janne. Related: `multi-guild-oauth.md` (console-side multi-guild, shipped `a125505`).

## Why

1. **Multi-guild is half-done.** Every table is `guild_id`-scoped and the console picks its guild
   server-side (`guildOf(req)`), so several guilds already coexist in one process. But the data
   layer is one SQLite file with a **synchronous** API (`Db = DatabaseSync`) opened by that process.
   That holds for a handful of guilds on one container; it does not hold for more than one process,
   for a managed/external database, or for per-guild databases.
2. **Participants have no web surface.** Discord is their only interface — no browser view of
   status, form answers, team, or schedule.
3. **Local dev has no orchestrator.** Bot + console + (new) participant app + datastores is a set of
   manual steps; there is no single entry point and no disposable Postgres or Redis.

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
| 1 | #9 Residual dead code | — (disjoint from 2a) | `apps/admin-ui/src/**` |
| 2a | #10 Async, dialect-portable data layer | — (disjoint from 1) | `apps/bot/**` |
| 2b | #11 Postgres dialect + dual-dialect tests | 2a | `apps/bot/src/shared/db/**`, `apps/bot/scripts/**`, CI/docker |
| 3 | #12 Aspire TypeScript AppHost (Postgres + Redis) | 2a (disjoint) | `apphost.mts`, `.aspire/`, `tsconfig.apphost.json`, root scripts, `docs/DEV.md` |
| 4 | #13 Participant web surface | 2a | `apps/web/**` (new), `apps/bot/src/features/participant/**` (new), `apps/bot/src/adminweb/participant-routes.ts` (new) |
| 5 | #14 Multi-guild isolation audit | 2a | `apps/bot/src/**/*.test.ts` (new tests only) |
| 6 | #16 Redis cache with explicit invalidation | 2b, 3 (for the resource) | `apps/bot/src/shared/cache.ts` (new) + read/write call sites |

Dependency graph:

```
WS1  (apps/admin-ui)  ──┐  disjoint trees: run in parallel
WS2a (apps/bot)       ──┴──> WS2a ──┬──> WS2b ──> WS6
                                    ├──> WS3   (AppHost: Postgres + Redis resources)
                                    ├──> WS4
                                    └──> WS5
```

WS1 and WS2a touch disjoint trees, so the bot-side dead code is owned by WS2a — one file set, one PR,
no double-handling. WS2b, WS3, WS4 and WS5 are file-disjoint and may run in parallel once WS2a lands
(WS4 adds a *new* route module; WS3 owns the AppHost; WS5 adds only tests).

**Concurrency note (learned the hard way):** parallel workers share the filesystem and the git index.
Each worker must run in its own `git worktree` (`git worktree add <scratch path> -b <branch> origin/main`)
and must never run git commands in the primary checkout while another worker is using it.

## Contracts every workstream must honour

- **SQL lives only in `data.ts`**; `domain.ts` stays pure; handlers never write SQL.
- **Guild scoping is per request** — `guildOf(req)` for console routes; a participant route derives
  its guild from the session and the event, never from the client.
- **Both language catalogs** (`en.json` + `sv.json`, `shared/i18n.ts`) in the same commit as any
  user-facing string.
- **No new dependency without janne's review.** Approved so far: `pg` (WS2b) and the official `redis`
  client (WS6). A dependency published less than 3 days ago is refused by
  `minimumReleaseAge: 4320` (strict) — pin an older version, and report a refusal rather than
  lowering the gate.
- **Redis is optional at runtime.** An unset `REDIS_URL` or an unreachable Redis means *no caching and
  a fully working app* (fail-open). The single-container self-hosted install keeps working with no
  Redis at all.
- **Nothing security-relevant is cached.** `web_sessions` stays authoritative in the database — a
  session served from a cache would destroy revocation-by-row-delete.
- **A product fact changes → `PRODUCT.md` changes** ("One Discord guild", "participants never touch
  the console", "one SQLite file" are all facts WS2–WS4 invalidate).
- **Changes land through a reviewed PR** — never a direct push to `main`.

## Known papercuts found while planning

- `shared/env.ts` resolves `.env` relative to **`apps/bot`**, not the repo root, while `AGENTS.md`
  and `.env.example` both imply a root-level `.env`. A root `.env` is silently never read. Local
  credentials belong in `apps/bot/.env` (gitignored). Worth a docs fix.
- The console owns `GET /auth/discord/callback`; the participant flow needs its **own** callback path
  (proposed `/auth/participant/callback`) registered in the Discord developer portal. Sharing the
  path would mix session kinds and let organiser scope leak into the participant flow.

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
- Cache keys are guild/event-scoped and versioned; a cross-guild cache read is a **security defect**,
  not a performance one.

## Out of scope

Per-guild deployment configuration, sharding, migrations of live production data, participant→Discord
role sync beyond what the bot already does, payments/accounts beyond Discord identity, Redis as a
session store or job queue.
