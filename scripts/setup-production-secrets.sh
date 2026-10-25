#!/usr/bin/env bash
# One-time creator for the local Compose secret files used by Unraid production.
set -euo pipefail
umask 077

repo_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
secrets_dir="$repo_root/deploy/secrets"
if [[ "$(id -u)" -ne 0 ]]; then
    printf '%s\n' 'Run this helper as root so it can set the container-readable secret file ownership.' >&2
    exit 1
fi
command -v openssl >/dev/null 2>&1 || { printf '%s\n' 'OpenSSL is required to generate secrets.' >&2; exit 1; }
mkdir -p -- "$secrets_dir"
chmod 700 -- "$secrets_dir"

generated_files=(
    postgres_bootstrap_password
    chashack_app_password
    chashack_migration_password
    database_url
    migration_database_url
    admin_session_secret
)

present=0
for name in "${generated_files[@]}"; do
    if [[ -e "$secrets_dir/$name" || -L "$secrets_dir/$name" ]]; then
        if [[ -f "$secrets_dir/$name" && ! -L "$secrets_dir/$name" ]]; then
            ((present += 1))
        else
            printf 'Secret path is not a regular file: %s\n' "$name" >&2
            exit 1
        fi
    fi
done

write_new_secret() {
    local name="$1" group="$2" value="$3" path="$secrets_dir/$1"
    if [[ -e "$path" || -L "$path" ]]; then
        printf 'Refusing to overwrite existing secret: %s\n' "$name" >&2
        return 1
    fi
    (set -o noclobber; printf '%s\n' "$value" > "$path")
    chown "0:$group" -- "$path"
    chmod 440 -- "$path"
}

if (( present == 0 )); then
    bootstrap_password="$(openssl rand -hex 32)"
    app_password="$(openssl rand -hex 32)"
    migration_password="$(openssl rand -hex 32)"
    session_secret="$(openssl rand -hex 32)"

    write_new_secret postgres_bootstrap_password 70 "$bootstrap_password"
    write_new_secret chashack_app_password 70 "$app_password"
    write_new_secret chashack_migration_password 70 "$migration_password"
    write_new_secret database_url 10001 "postgresql://chashack_app:${app_password}@db:5432/chashack"
    write_new_secret migration_database_url 10001 "postgresql://chashack_migrate:${migration_password}@db:5432/chashack"
    write_new_secret admin_session_secret 10001 "$session_secret"

    unset bootstrap_password app_password migration_password session_secret
elif (( present != ${#generated_files[@]} )); then
    printf '%s\n' 'The generated database/session secret set is only partially present.' \
        'No files were overwritten. Restore the missing files from a secure backup,' \
        'or remove the entire generated set only if this database has never been initialized.' >&2
    exit 1
else
    printf '%s\n' 'Generated database/session secret files already exist; keeping them unchanged.'
fi

prompt_secret() {
    local name="$1" group="$2" label="$3" value confirm
    if [[ -e "$secrets_dir/$name" || -L "$secrets_dir/$name" ]]; then
        [[ -f "$secrets_dir/$name" && ! -L "$secrets_dir/$name" ]] || {
            printf 'Secret path is not a regular file: %s\n' "$name" >&2
            return 1
        }
        return 0
    fi
    while true; do
        IFS= read -r -s -p "$label: " value
        printf '\n' >&2
        [[ -n "$value" ]] || { printf '%s\n' 'Value cannot be empty.' >&2; continue; }
        IFS= read -r -s -p 'Confirm: ' confirm
        printf '\n' >&2
        if [[ "$value" == "$confirm" ]]; then
            write_new_secret "$name" "$group" "$value"
            unset value confirm
            return
        fi
        printf '%s\n' 'Values did not match; try again.' >&2
        unset value confirm
    done
}

prompt_secret discord_token 10001 'Discord bot token'
prompt_secret discord_client_secret 10001 'Discord OAuth client secret'

printf '\n%s\n' 'Secret files are ready in deploy/secrets. Values were not printed.' \
    'Keep this directory private and back it up securely. Do not regenerate these values after PostgreSQL initializes.'
