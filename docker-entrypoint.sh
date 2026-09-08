#!/bin/sh
# Entrypoint: support PUID/PGID (LinuxServer.io convention, the default on
# Unraid/Synology) by re-owning the data dir and dropping privileges before
# exec'ing the bot.
#
# - When PUID/PGID are unset (or already match uid 1000), run directly as the
#   current user — no root process lingers.
# - The container must start as root for the chown path to work; docker's
#   `user:` directive overrides this script, so leave it unset when using
#   PUID/PGID.
set -e

PUID="${PUID:-1000}"
PGID="${PGID:-1000}"

# Only attempt privilege work when actually running as root.
if [ "$(id -u)" = "0" ]; then
  # Create the group/user if they don't exist (PUID/PGID may be arbitrary host ids).
  if ! getent group "$PGID" >/dev/null 2>&1; then
    addgroup -g "$PGID" appgroup
  fi
  if ! getent passwd "$PUID" >/dev/null 2>&1; then
    adduser -D -u "$PUID" -G "$(getent group "$PGID" | cut -d: -f1)" appuser
  fi
  USER_NAME=$(getent passwd "$PUID" | cut -d: -f1)

  # Take ownership of the data dir so SQLite can create db + WAL files.
  DATA_DIR=${DB_PATH:-/data/chashack.db}
  DATA_DIR=$(dirname "$DATA_DIR")
  mkdir -p "$DATA_DIR"
  chown -R "$PUID:$PGID" "$DATA_DIR"

  # setpriv: drop privileges permanently, then exec the bot (PID 1 = node).
  exec setpriv --reuid "$PUID" --regid "$PGID" --init-groups \
    node apps/bot/dist/index.js
fi

# Non-root start (user: directive or PUID already correct): run as-is.
exec node apps/bot/dist/index.js
