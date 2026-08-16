#!/usr/bin/env bash
set -euo pipefail

project_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
test_state="$(mktemp -d -t va-application-resubmission.XXXXXX)"

cd "$project_root"

npx wrangler d1 migrations apply va-api-local-db --local --persist-to "$test_state"
npx wrangler d1 execute va-api-local-db --local --persist-to "$test_state" \
  --file scripts/application-resubmission-check.sql

echo "Application changes-requested and resubmission database checks passed."
