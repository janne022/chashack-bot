# Multi-guild console + Discord OAuth login

Status: implementing
Owner: janne
Related: `PRODUCT.md` (single Discord guild was a *held-true fact* — this plan replaces it)

## Goal

The bot already runs in as many guilds as it is invited to, and every table is
already `guild_id`-scoped. The **console** is what is single-guild: it reads one
guild from `DISCORD_GUILD_ID`, authenticates with a shared password, and every
route closure captures that one guild.

Two changes:

1. **Pick the server to manage.** An organizer who runs several hackathon servers
   (or a helper who administers more than one) logs in once and switches between
   them.
2. **Sign in with Discord.** Replaces "everyone shares one password" with "you are
   who Discord says you are, and you may manage the guilds you already administer."

## Non-goals

- Per-guild *deployment* config (one process still serves every guild it is in).
- Participant-facing auth — participants never log into the console.
- Migrating the password away: self-hosted single-guild installs keep working
  unchanged (see Back-compat).

## Decisions

- **Identity = OAuth2 authorization code, scopes `identify guilds`.** `guilds` is
  enough to read `GET /users/@me/guilds`, which returns the caller's permissions
  per guild — no bot token needed to decide what they may manage.
- **Authorisation = `MANAGE_GUILD` (0x20) or `ADMINISTRATOR` (0x8) on a guild
  where the bot is present.** Both conditions: admin rights alone are useless
  without the bot, and the bot's presence with no rights is useless too.
- **Both session kinds coexist.**
  - *operator session* (existing password login): guild = `DISCORD_GUILD_ID`.
    Old cookies keep verifying, so upgrades do not log anyone out.
  - *discord session* (new): id → `web_sessions` row carrying user + the guild ids
    they may manage + the currently selected one.
- **The authorised guild list lives server-side** (`web_sessions.guild_ids`), not
  in the cookie: switching guilds is validated against it, and it can be revoked
  on logout instead of waiting for cookie expiry.
- **No OAuth access token is stored.** It is used once at login to read the user
  and their guilds, then discarded — the session is our own id, not a bearer we
  would have to protect.
- **Guild names/icons come from the gateway client** (the bot is a member, so it
  has them); when `SKIP_DISCORD=1` the picker lists the env guild only.
- **CSRF:** the authorize redirect sets a short-lived `hackstate` cookie; the
  callback requires `state` to match. Same SSRF-safe story as the session cookie
  (`SameSite=Lax` because the callback is a cross-site redirect).

## Data

```sql
CREATE TABLE IF NOT EXISTS web_sessions (
  id                TEXT PRIMARY KEY,
  user_id           TEXT NOT NULL,
  username          TEXT NOT NULL,
  avatar            TEXT,
  guild_ids         TEXT NOT NULL DEFAULT '[]',   -- authorised guilds
  selected_guild_id TEXT,
  created_at        INTEGER NOT NULL,
  expires_at        INTEGER NOT NULL
);
```

`web_sessions` is deliberately *not* guild-scoped: it belongs to the console, not
to a hackathon.

## HTTP surface

| Route | Purpose |
| --- | --- |
| `GET /auth/discord` | 302 → Discord authorize (sets `hackstate`) |
| `GET /auth/discord/callback` | exchange code → identity + guilds → session cookie → `/` |
| `POST /api/auth/logout` | delete the session row + clear the cookie |
| `GET /api/auth/me` | session kind, user, selected guild, manageable guilds |
| `POST /api/auth/guild` | switch the selected guild (validated against `guild_ids`) |
| `GET /api/login` (existing) | password fallback, unchanged shape |

Every `/api/*` route keeps requiring a session; `guildOf(req)` replaces the
module-level `guildId` const, so a request always acts on the session's selected
guild — falling back to `DISCORD_GUILD_ID` for operator sessions (and for
Discord sessions with no guild yet).

## Config

| Var | Notes |
| --- | --- |
| `DISCORD_CLIENT_SECRET` | required for OAuth; without it the Discord button is hidden and password login is unchanged |
| `OAUTH_REDIRECT_URI` | defaults to `<origin>/auth/discord/callback`; must match the Developer Portal entry exactly |
| `PUBLIC_URL` | optional; used when the console sits behind a proxy and the request origin is not the public one |

Developer Portal: add the redirect URI under OAuth2 → Redirects, and make sure the
bot is invited to each guild with the scopes it needs (`bot` + `applications.commands`).

## UI

- Login screen: **Continue with Discord** primary (when OAuth is configured),
  password form demoted to a disclosure ("Use password instead"). Swedish first-class.
- Sidebar: a **server picker** above the active-event switcher showing the current
  guild's name/icon; switching re-scopes every query (invalidate the React Query
  cache on switch).
- Empty case: "No server to manage — invite the bot to a server where you have
  Manage Server" with an invite link.

## Back-compat

- Password sessions continue to verify (legacy HMAC payload unchanged) and keep
  acting on `DISCORD_GUILD_ID`.
- Installations without `DISCORD_CLIENT_SECRET` see no OAuth UI at all.
- `guildOf()` falls back to `DISCORD_GUILD_ID` whenever a session has no guild,
  so single-guild behaviour is byte-identical.

## Verification

- Unit: session token (new + legacy), guild authorisation filter (permission bits
  × bot presence), `web_sessions` expiry/cleanup.
- Live: `GET /auth/discord` reaches Discord's consent screen (real browser,
  screenshot), callback rejection paths (`state` mismatch, no manageable guild),
  and the picker switching guilds against a two-guild fixture.
- Manual once by janne: complete the consent screen (needs a real Discord login).

## Risks

- **Switching guild must not leak event data**: every query already filters by
  guild id; the picker invalidates the cache, and `/api/state` never accepts a
  guild from the client — only from the session.
- **Guild count**: `guild_ids` in one row is fine for a human's admin set; if an
  account manages hundreds of guilds the list is capped at the bot's own guilds.
