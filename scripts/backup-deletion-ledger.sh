#!/usr/bin/env bash
# Keep identifier-only deletion ledgers independently of the full DB snapshot.
set -euo pipefail
: "${AGE_RECIPIENT:?Set the age public recipient (never a private key)}"
: "${BACKUP_HOST:?Set a preconfigured SSH host alias}"
: "${BACKUP_REMOTE_DIR:?Set an absolute restricted remote directory}"
case "$BACKUP_REMOTE_DIR" in /*) ;; *) echo 'BACKUP_REMOTE_DIR must be absolute' >&2; exit 2 ;; esac
case "$BACKUP_REMOTE_DIR" in *[!A-Za-z0-9_./-]*) echo 'BACKUP_REMOTE_DIR contains unsafe characters' >&2; exit 2 ;; esac
stamp=$(date -u +%Y%m%dT%H%M%SZ)
file="chashack-deletion-ledger-${stamp}.sql.age"
docker compose --env-file deploy/production.env -f compose.production.yaml exec -T db pg_dump -U chashack_bootstrap -d chashack --data-only --column-inserts \
  --table=public.member_deletions --table=public.private_answer_deletions \
  | age -r "$AGE_RECIPIENT" \
  | ssh "$BACKUP_HOST" "umask 077; cat > '$BACKUP_REMOTE_DIR/$file'"
printf 'Encrypted deletion ledger written to %s:%s/%s\n' "$BACKUP_HOST" "$BACKUP_REMOTE_DIR" "$file"
