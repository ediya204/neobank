#!/usr/bin/env bash

set -euo pipefail
set +x

repo_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
: "${D1_BACKUP_FILE:?Set D1_BACKUP_FILE to the complete production export}"
: "${D1_BACKUP_SHA256:?Set D1_BACKUP_SHA256 to the independently recorded checksum}"
: "${SOURCE_D1_GATEWAY_URL:?Point SOURCE_D1_GATEWAY_URL at the isolated restored D1 database}"
: "${SOURCE_D1_GATEWAY_SECRET:?Set the isolated restore gateway secret}"
: "${PGHOST:?Set PGHOST to the temporarily allowlisted Render Postgres external hostname}"
: "${PGUSER:?Set PGUSER to the Render Postgres user}"
: "${PGPASSWORD:?Set PGPASSWORD without placing it in the command line}"
: "${PGDATABASE:?Set PGDATABASE to the empty Render Postgres database name}"
: "${MIGRATION_MANIFEST_PATH:?Set MIGRATION_MANIFEST_PATH outside the repository}"

export PGPORT="${PGPORT:-5432}"
export PGSSLMODE="${PGSSLMODE:-require}"
export PGAPPNAME="neobank-core-cutover"
if [[ "$PGSSLMODE" != "require" && "$PGSSLMODE" != "verify-ca" && "$PGSSLMODE" != "verify-full" ]]; then
  printf '%s\n' 'PGSSLMODE must require encrypted transport.' >&2
  exit 2
fi

if [[ "${ALLOW_ISOLATED_RESTORE_SOURCE:-}" != "true" ]]; then
  printf '%s\n' 'Refusing migration without ALLOW_ISOLATED_RESTORE_SOURCE=true.' >&2
  exit 2
fi
if [[ "${ALLOW_EMPTY_POSTGRES_TARGET:-}" != "true" ]]; then
  printf '%s\n' 'Refusing migration without ALLOW_EMPTY_POSTGRES_TARGET=true.' >&2
  exit 2
fi
if [[ ! -f "$D1_BACKUP_FILE" ]]; then
  printf 'D1 backup does not exist: %s\n' "$D1_BACKUP_FILE" >&2
  exit 2
fi
if [[ "$MIGRATION_MANIFEST_PATH" == "$repo_dir"/* ]]; then
  printf '%s\n' 'Migration evidence contains sensitive counts and hashes; keep it outside the repository.' >&2
  exit 2
fi
if ! command -v psql >/dev/null 2>&1; then
  printf '%s\n' 'psql is required to apply and verify the Postgres schema.' >&2
  exit 2
fi

actual_checksum="$(shasum -a 256 "$D1_BACKUP_FILE" | awk '{print $1}')"
if [[ ! "$D1_BACKUP_SHA256" =~ ^[0-9a-fA-F]{64}$ ]] ||
   [[ "${actual_checksum,,}" != "${D1_BACKUP_SHA256,,}" ]]; then
  printf '%s\n' 'The D1 backup checksum does not match the independently recorded value.' >&2
  exit 1
fi

psql -X -v ON_ERROR_STOP=1 \
  -f "$repo_dir/migrations-postgres/0001_neobank_core.sql" >/dev/null

mkdir -p "$(dirname "$MIGRATION_MANIFEST_PATH")"
(
  cd "$repo_dir/server-go"
  go run ./cmd/core-migrate
) >"$MIGRATION_MANIFEST_PATH"

manifest_checksum="$(shasum -a 256 "$MIGRATION_MANIFEST_PATH" | awk '{print $1}')"
printf 'Postgres migration verification passed. manifest_sha256=%s\n' "$manifest_checksum"
printf '%s\n' 'DATABASE_BACKEND remains unchanged. Switch it to postgres only after reviewing this manifest and the acceptance checks.'
