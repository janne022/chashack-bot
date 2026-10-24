#!/usr/bin/env bash
# Create the two least-privilege application roles on first database initialization.
set -euo pipefail

read_secret() {
    local name="$1" path="${2:-}"
    if [[ -n "$path" ]]; then
        [[ -r "$path" ]] || { printf '%s\n' "Unreadable secret file: $path" >&2; exit 1; }
        cat "$path"
    else
        printf '%s' "${!name:-}"
    fi
}
CHASHACK_APP_PASSWORD="$(read_secret CHASHACK_APP_PASSWORD "${CHASHACK_APP_PASSWORD_FILE:-}")"
CHASHACK_MIGRATION_PASSWORD="$(read_secret CHASHACK_MIGRATION_PASSWORD "${CHASHACK_MIGRATION_PASSWORD_FILE:-}")"
for value in "$CHASHACK_APP_PASSWORD" "$CHASHACK_MIGRATION_PASSWORD"; do
    [[ "$value" =~ ^[a-z0-9]{32,}$ ]] || { printf '%s\n' 'Invalid generated database role password' >&2; exit 1; }
done
[[ "$CHASHACK_APP_PASSWORD" != "$CHASHACK_MIGRATION_PASSWORD" ]] || { printf '%s\n' 'Database role passwords must differ' >&2; exit 1; }

# The password alphabet was validated above, so embedding these values as SQL
# literals cannot change the statement structure or leak them in psql argv.
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<SQL
CREATE ROLE chashack_migrate LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE PASSWORD '$CHASHACK_MIGRATION_PASSWORD';
CREATE ROLE chashack_app LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE PASSWORD '$CHASHACK_APP_PASSWORD';
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
GRANT USAGE, CREATE ON SCHEMA public TO chashack_migrate;
GRANT USAGE ON SCHEMA public TO chashack_app;
ALTER DEFAULT PRIVILEGES FOR ROLE chashack_migrate IN SCHEMA public
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO chashack_app;
ALTER DEFAULT PRIVILEGES FOR ROLE chashack_migrate IN SCHEMA public
    GRANT USAGE ON SEQUENCES TO chashack_app;
SQL
