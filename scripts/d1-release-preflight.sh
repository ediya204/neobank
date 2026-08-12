#!/usr/bin/env bash

set -euo pipefail
set +x

repo_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
database_name="${VA_D1_DATABASE:-va-api-db}"
wrangler_bin="${repo_dir}/node_modules/.bin/wrangler"

if [[ ! "$database_name" =~ ^[A-Za-z0-9_-]+$ ]]; then
  printf 'Unsafe D1 database name: %s\n' "$database_name" >&2
  exit 2
fi
if [[ ! -x "$wrangler_bin" ]]; then
  printf '%s\n' 'Install the locked workspace dependencies before running this check.' >&2
  exit 2
fi

read -r -d '' preflight_sql <<'SQL' || true
SELECT
  (SELECT COUNT(*) FROM pragma_foreign_key_check) AS foreign_key_violations,
  (SELECT COUNT(*)
   FROM usdt_sweep_items i
   JOIN usdt_sweep_batches b ON b.id=i.batch_id
   JOIN va_applications a ON a.id=i.application_id
   WHERE b.partner_key<>a.partner_key) AS sweep_tenant_mismatches,
  (SELECT COUNT(*)
   FROM usdt_sweep_batches b
   WHERE b.total_amount_minor<>COALESCE((
     SELECT SUM(i.amount_minor) FROM usdt_sweep_items i WHERE i.batch_id=b.id
   ),0)) AS sweep_total_mismatches,
  (SELECT COUNT(*)
   FROM usdt_sweep_batches b
   JOIN usdt_sweep_items i ON i.batch_id=b.id
   WHERE b.status='completed'
     AND (
       i.ledger_entry_id IS NULL
       OR NOT EXISTS (
         SELECT 1 FROM ledger_entries l
         WHERE l.id=i.ledger_entry_id
           AND l.application_id=i.application_id
           AND l.source_type='adjustment'
           AND l.source_id=i.id
           AND l.asset='USDT'
           AND l.network='TRON'
           AND l.amount_minor=-i.amount_minor
           AND l.asset_decimals=i.asset_decimals
           AND l.entry_type='adjustment_debit'
       )
     )) AS completed_ledger_mismatches;
SQL

output="$({
  cd "$repo_dir"
  "$wrangler_bin" d1 execute "$database_name" \
    --remote \
    --config "${repo_dir}/wrangler.jsonc" \
    --command "$preflight_sql" \
    --json \
    --yes
})"

printf '%s' "$output" | node -e '
  let input = "";
  process.stdin.on("data", (chunk) => input += chunk);
  process.stdin.on("end", () => {
    const payload = JSON.parse(input);
    const row = payload.find((item) => item?.results?.[0])?.results?.[0];
    const keys = [
      "foreign_key_violations",
      "sweep_tenant_mismatches",
      "sweep_total_mismatches",
      "completed_ledger_mismatches",
    ];
    if (!row || keys.some((key) => !Number.isInteger(Number(row[key])))) {
      console.error("Remote D1 release preflight returned an invalid response.");
      process.exit(2);
    }
    const counts = Object.fromEntries(keys.map((key) => [key, Number(row[key])]));
    const summary = keys.map((key) => `${key}=${counts[key]}`).join(" ");
    if (keys.some((key) => counts[key] !== 0)) {
      console.error(`Remote D1 release preflight failed: ${summary}`);
      console.error("Do not migrate or deploy until Operations reconciles the underlying records.");
      process.exit(1);
    }
    console.log(`Remote D1 release preflight passed: ${summary}`);
  });
'
