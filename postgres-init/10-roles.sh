#!/usr/bin/env bash
# Runs only when PostgreSQL initializes an empty Aspire data volume.
set -euo pipefail

for value in "$CHASHACK_APP_PASSWORD" "$CHASHACK_MIGRATION_PASSWORD"; do
    [[ "$value" =~ ^[a-z0-9]{32,}$ ]] || { printf '%s\n' 'Invalid generated database role password' >&2; exit 1; }
done
[[ "$CHASHACK_APP_PASSWORD" != "$CHASHACK_MIGRATION_PASSWORD" ]] || { printf '%s\n' 'Database role passwords must differ' >&2; exit 1; }

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
