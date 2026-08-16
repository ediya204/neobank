#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'EOF'
Usage:
  scripts/demo-seed.sh --local [--persist-to DIR]
  VA_DEMO_REMOTE_ACK=demo-va-v1 scripts/demo-seed.sh --remote --confirm-remote-demo-seed

The seed appends only the fixed demo rows listed in scripts/demo-seed.sql and
preserves existing rows and the immutable ledger. Remote execution requires
both the confirmation flag and the acknowledgement environment variable. This
script never runs migrations or deploys the Worker.
EOF
}

mode=""
confirm_remote=0
persist_dir=""

while (($#)); do
  case "$1" in
    --local)
      mode="--local"
      ;;
    --remote)
      mode="--remote"
      ;;
    --confirm-remote-demo-seed|--confirm-remote-demo-reset)
      confirm_remote=1
      ;;
    --persist-to)
      shift
      if (($# == 0)); then
        printf 'Missing value for --persist-to\n' >&2
        exit 2
      fi
      persist_dir="$1"
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      printf 'Unknown argument: %s\n' "$1" >&2
      usage >&2
      exit 2
      ;;
  esac
  shift
done

if [[ -z "$mode" ]]; then
  usage >&2
  exit 2
fi

if [[ "$mode" == "--remote" ]]; then
  if [[ "$confirm_remote" -ne 1 || "${VA_DEMO_REMOTE_ACK:-}" != "demo-va-v1" ]]; then
    printf '%s\n' \
      'Remote seed blocked. Add --confirm-remote-demo-seed and set VA_DEMO_REMOTE_ACK=demo-va-v1.' >&2
    exit 2
  fi
  if [[ -n "$persist_dir" ]]; then
    printf '%s\n' '--persist-to is only valid with --local.' >&2
    exit 2
  fi
elif [[ "$confirm_remote" -eq 1 ]]; then
  printf '%s\n' '--confirm-remote-demo-seed is only valid with --remote.' >&2
  exit 2
fi

database_name="${VA_D1_DATABASE:-va-api-local-db}"
if [[ ! "$database_name" =~ ^[A-Za-z0-9_-]+$ ]]; then
  printf 'Unsafe D1 database name: %s\n' "$database_name" >&2
  exit 2
fi

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
project_dir="$(cd "${script_dir}/.." && pwd)"
seed_sql="${script_dir}/demo-seed.sql"

if [[ ! -f "$seed_sql" ]]; then
  printf 'Seed SQL not found: %s\n' "$seed_sql" >&2
  exit 2
fi

wrangler_args=(
  d1 execute "$database_name" "$mode"
  --config "${project_dir}/wrangler.jsonc"
  --file "$seed_sql"
  --yes
)

if [[ -n "$persist_dir" ]]; then
  wrangler_args+=(--persist-to "$persist_dir")
fi

printf 'Writing append-only demo data in %s (%s only).\n' "$database_name" "${mode#--}"
(
  cd "$project_dir"
  npx wrangler "${wrangler_args[@]}"
)
printf '%s\n' 'Demo seed completed. Run scripts/v1-smoke.sh to verify the expected state.'
