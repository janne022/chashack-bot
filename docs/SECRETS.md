STATUS: DRAFT — requires review by a qualified person before publication

# Secrets & rotation runbook

How the deployment's secrets are stored, what each one grants, what breaks if it
leaks, and how to rotate it.

The rule first: **secrets live only in `.env` files that are gitignored.** Never in a
commit, never in a log, never in an issue or PR, never in a screenshot. Refer to them
by variable name only. If a secret ever ends up in any of those places, treat it as
leaked and rotate it — do not edit the history and hope.

## Inventory

Verified against `apps/bot/src/shared/env.ts` and `.env.example` on the current
`main`. The hosted deployment today is SQLite + in-process; there is **no**
`DATABASE_URL` and **no** `REDIS_URL` in the code — if a hosted deployment later adds
Postgres or Redis, add those rows here (with rotation steps) in the same change.

| Variable | Lives in | Grants / purpose | If it leaks | Test after rotation |
| --- | --- | --- | --- | --- |
| `DISCORD_TOKEN` | `.env` on the bot host | Full control of the bot application in Discord: read messages in servers it is in, join/leave channels, send messages, manage channels/roles it has permissions for | An attacker can act as the bot everywhere: read every server it sits in, send messages as it, invite it to new servers. Worst secret in the file | Kick old sessions: reset the token in the Discord Developer Portal (Bot → Reset Token), put the new value in `.env`, restart the bot. Verify: bot online, responds to a slash command, console still loads events |
| `DISCORD_CLIENT_SECRET` | `.env` on the web host | OAuth2 client secret for "Sign in with Discord" in the organizer console | An attacker can impersonate the OAuth app: phish organizers with a real-looking login flow, or receive authorization codes meant for the console | Reset in Developer Portal (OAuth2 → Reset Secret), update `.env`, restart web. Verify: log in with Discord works end-to-end |
| `ADMIN_SESSION_SECRET` | `.env` on the web host | Signs the admin session cookies | Cookies can be forged → full console access without any Discord login | Generate a new long random value (`openssl rand -base64 32`), replace in `.env`, restart. Verify: login works, old cookies are rejected (everyone is logged out — that is expected and good) |
| `DISCORD_CLIENT_ID` | `.env` (also in the portal) | Public OAuth2 client identifier | Not secret on its own; only sensitive paired with the client secret | No rotation needed; rotate only with the secret |
| `ADMIN_PASSWORD` | `.env` | The console's shared password (**being removed** — OAuth-only sign-in is the target per issue #22; it remains required until that migration lands) | Console access as a full admin | Change the value, restart. Verify: old password refused, new one works. When the OAuth-only migration lands, delete this variable entirely |
| `OAUTH_REDIRECT_URI` / `PUBLIC_URL` | `.env` | Where Discord sends the OAuth callback / the trusted origin for CSRF and cookie flags | Not secrets, but if tampered with they redirect logins or break CSRF checks. If changed maliciously, treat `DISCORD_CLIENT_SECRET` as exposed | Restore correct values, restart, and verify login + CSRF |
| `ADMIN_IDS` / `HOST_OPERATOR_DISCORD_IDS` | `.env` | Which Discord user ids get admin / host-operator powers | An attacker who can edit the file adds their own id on next restart — file access already means game over, but rotation of other secrets won't fix this | Remove unknown ids, restart, audit the audit log for actions from ids you don't recognise |
| `DB_PATH` | `.env` | Location of the SQLite database file | Not a secret, but the file it points to is the crown jewels: file-level access beats every secret above | Not rotated; backed up and access-controlled. See below |
| `TEAM_CATEGORY_ID`, `AUDIT_CHANNEL_ID`, `ANNOUNCE_CHANNEL_ID` | `.env` | Discord channel/category snowflakes | Not secrets (ids only) | No rotation; restore values if corrupted |
| `SKIP_DISCORD`, `BOT_LANGUAGE`, `ADMIN_PORT` | `.env` | Flags / config | Not secrets | — |

**The database file itself** (`DB_PATH`, e.g. `data/chashack.db`) is a secret in
effect: everyone's signup answers live there. Back it up encrypted, keep it out of
any repo, and when the hosted deployment moves to Postgres, `DATABASE_URL` inherits
this row (rotate by `ALTER ROLE ... PASSWORD`, then update `.env` and restart; old
password revoke closes open connections).

## Where secrets are allowed to live

- `.env` on the specific host, created from `.env.example`. `.env` must be
  gitignored — verify with `git check-ignore .env` before your first commit on any
  new checkout.
- The host's own secret store (systemd `EnvironmentFile` with root-only permissions,
  or a proper secrets manager) is fine; `.env` is the documented baseline.
- Nowhere else: not in shell history, not in `docker logs`, not in an issue, PR,
  gist or chat message. When pasting logs for debugging, redact values and refer to
  variables by name.

## Rotation rhythms

- **On any suspected leak:** immediately, before investigating how.
- **On staff change:** `ADMIN_SESSION_SECRET` and `ADMIN_PASSWORD` when anyone with
  host access leaves (rotation logs out every console session — that is the point).
- **Routine:** `DISCORD_TOKEN` and `DISCORD_CLIENT_SECRET` on a schedule you will
  actually keep (e.g. quarterly), because both are resettable in the Discord portal
  with a restart.
- `ADMIN_SESSION_SECRET` is cheap to rotate and breaks nothing except sessions: do
  it without fear.

## The one command to remember

```sh
openssl rand -base64 32
```

Use it for every new secret value. Never invent secrets by hand.

## If a leak happens

1. Rotate the leaked secret (portal reset for Discord values, new random value for
   session secret).
2. Restart the affected process and run its verification step from the table above.
3. Check the blast radius: for `DISCORD_TOKEN`, review the audit log
   (`audit_log`) and the Discord servers the bot is in for actions you didn't take;
   for `ADMIN_SESSION_SECRET`, assume console access and review `audit_log` for
   unfamiliar actors.
4. Write down what happened and when rotation finished. If personal data may have
   been seen, that is a data-breach conversation with the affected organizations —
   see the privacy policy's roles section (organizations are the controllers; tell
   them).

## For the maintainer

Keep this section out of any published copy.

### (a) Claims not verified against the code

- **`DISCORD_CLIENT_SECRET` / OAuth behaviour** — present in `env.ts`, but the
  OAuth flow details (token exchange, session minting) were not audited line by
  line; the "what breaks if it leaks" column is an assessment, not a tested fact.
- **`ADMIN_SESSION_SECRET` fallback** — `env.ts` currently falls back to
  `ADMIN_PASSWORD` when unset (`apps/bot/src/shared/env.ts`: `adminSessionSecret:
  get('ADMIN_SESSION_SECRET') || adminPassword`). Issue #22 R2 will make an explicit
  secret mandatory and refuse to boot without it; until then, a deployment without
  `ADMIN_SESSION_SECRET` signs cookies with the shared password — the runbook's
  "generate a long random value" instruction matters more until that lands.
- **Redis** — `REDIS_URL` was asked about for the runbook; no Redis exists anywhere
  in the code today. If it is added, this file must gain its row.
- **Postgres** — same: no `DATABASE_URL` in the code; the Postgres/RLS work (issue
  #19) will add it, and this runbook must be updated in the same change.
- **`ANNOUNCE_CHANNEL_ID`** — present in `env.ts` but not in `.env.example`;
  listed from code, flagged here for symmetry.
- The **gitignore claim** (`git check-ignore .env`) was not run against a real
  `.env` in this repo; verify on the deploy host.

### (b) Promises not yet implemented

- OAuth-only sign-in with mandatory `ADMIN_SESSION_SECRET` (no
  `ADMIN_PASSWORD` at all) — issue #22 R1/R2, mid-migration.
- Host-operator allowlist (`HOST_OPERATOR_DISCORD_IDS` or equivalent) — issue #22
  consequence section; name in `.env` is provisional.
- Postgres `DATABASE_URL` and any `REDIS_URL` rows — pending issues #19/#23.

### (c) Numbers and names that must be updated if configuration changes

- Any variable added to or removed from `.env.example` — the inventory table above
  must be updated in the same change.
- If `ADMIN_SESSION_SECRET` becomes mandatory (issue #22 R2), remove the
  fallback note and the `ADMIN_PASSWORD` row.
- Session TTL (7 days) and cookie flags depend on `PUBLIC_URL`; if session handling
  changes, re-check that rotation still logs everyone out.
