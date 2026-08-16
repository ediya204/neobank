#!/usr/bin/env bash
set -euo pipefail

if (($# != 0)); then
  printf '%s\n' 'Usage: scripts/local-demo-seed.sh' >&2
  printf '%s\n' 'This command is intentionally local-only and accepts no arguments.' >&2
  exit 2
fi

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
project_dir="$(cd "${script_dir}/.." && pwd)"
database_name="va-api-local-db"

seed_files=(
  "${script_dir}/demo-seed.sql"
  "${script_dir}/local-transaction-history-seed.sql"
  "${script_dir}/local-webhook-demo.sql"
)

for seed_file in "${seed_files[@]}"; do
  if [[ ! -f "$seed_file" ]]; then
    printf 'Local seed file not found: %s\n' "$seed_file" >&2
    exit 2
  fi
done

if [[ ! -f "${script_dir}/local-demo-verify.sql" ]]; then
  printf '%s\n' 'Local verification SQL is missing.' >&2
  exit 2
fi

cd "$project_dir"

for seed_file in "${seed_files[@]}"; do
  printf 'Applying local demo seed: %s\n' "$(basename "$seed_file")"
  npx --no-install wrangler d1 execute "$database_name" \
    --local \
    --config "${project_dir}/wrangler.jsonc" \
    --file "$seed_file" \
    --yes
done

printf '%s\n' 'Verifying local demo data and foreign keys.'
npx --no-install wrangler d1 execute "$database_name" \
  --local \
  --config "${project_dir}/wrangler.jsonc" \
  --file "${script_dir}/local-demo-verify.sql" \
  --yes

printf '%s\n' 'Local demo database is ready. No remote database was contacted.'
