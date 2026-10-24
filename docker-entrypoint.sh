#!/bin/sh
# Compose mounts protected secret files and names them with *_FILE variables.
set -eu
for name in DATABASE_URL MIGRATION_DATABASE_URL ADMIN_SESSION_SECRET DISCORD_TOKEN DISCORD_CLIENT_SECRET DELETION_REPLAY_DATABASE_URL; do
  case "$name" in
    DATABASE_URL) secret_file=${DATABASE_URL_FILE:-} ;;
    MIGRATION_DATABASE_URL) secret_file=${MIGRATION_DATABASE_URL_FILE:-} ;;
    ADMIN_SESSION_SECRET) secret_file=${ADMIN_SESSION_SECRET_FILE:-} ;;
    DISCORD_TOKEN) secret_file=${DISCORD_TOKEN_FILE:-} ;;
    DISCORD_CLIENT_SECRET) secret_file=${DISCORD_CLIENT_SECRET_FILE:-} ;;
    DELETION_REPLAY_DATABASE_URL) secret_file=${DELETION_REPLAY_DATABASE_URL_FILE:-} ;;
  esac
  if [ -n "$secret_file" ]; then
    if [ ! -r "$secret_file" ]; then
      printf '%s\n' "Required secret file is unreadable: $secret_file" >&2
      exit 1
    fi
    secret_value=$(cat "$secret_file")
    [ -n "$secret_value" ] || { printf '%s\n' "Required secret file is empty: $secret_file" >&2; exit 1; }
    export "$name=$secret_value"
    unset "${name}_FILE"
  fi
done
if [ "$#" -eq 0 ]; then
  set -- node apps/bot/dist/index.js
fi
exec "$@"
