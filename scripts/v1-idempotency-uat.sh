#!/usr/bin/env bash
set -euo pipefail

command -v node >/dev/null || {
  printf '%s\n' 'node is required' >&2
  exit 2
}

usage() {
  cat <<'EOF'
Usage:
  VA_UAT_ALLOW_WRITES=1 scripts/v1-idempotency-uat.sh --local

This opt-in test writes one append-only submitted withdrawal only to
demo_va_uat_api_v1 in a local, preferably fresh isolated D1 database. It never
deletes accounting records, deploys the Worker, runs migrations, or targets the
remote database.
EOF
}

mode="${1:-}"
if [[ "$mode" != "--local" ]]; then
  usage >&2
  exit 2
fi
if [[ "${VA_UAT_ALLOW_WRITES:-}" != "1" ]]; then
  printf '%s\n' 'Write UAT blocked. Set VA_UAT_ALLOW_WRITES=1.' >&2
  exit 2
fi

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
target_application_id="demo_va_uat_api_v1"
idempotency_key="demo-v1-uat-fiat-$(node -e 'process.stdout.write(crypto.randomUUID())')"
auth_headers=(-H 'Accept: application/json')
base_url="${VA_API_BASE_URL:-http://localhost:8787/api/v1}"
seed_args=(--local)
if [[ -n "${VA_D1_PERSIST_TO:-}" ]]; then
  seed_args+=(--persist-to "$VA_D1_PERSIST_TO")
fi
base_url="${base_url%/}"

"${script_dir}/demo-seed.sh" "${seed_args[@]}"

fees="$(
  curl --fail --silent --show-error \
    "${auth_headers[@]}" \
    "${base_url}/withdrawal-fees"
)"
fiat_fee="$(jq -er '.data[] | select(.type == "fiat_withdrawal") | .amount' <<<"$fees")"

payload="$(
  jq -nc \
    --arg application_id "$target_application_id" \
    --arg expected_fee_amount "$fiat_fee" \
    '{
      application_id: $application_id,
      type: "fiat_withdrawal",
      asset: "USD",
      amount: "100",
      expected_fee_amount: $expected_fee_amount,
      beneficiary_name: "DEMO UAT BENEFICIARY",
      beneficiary_address: "100 DEMO UAT STREET, SINGAPORE 018900",
      bank_name: "DEMO UAT BANK",
      bank_account_number: "DEMO-UAT-100",
      swift_bic: "DEMOSG01XXX",
      bank_address: "DEMO UAT BANK ADDRESS, SINGAPORE",
      note: "[DEMO] reversible idempotency UAT"
    }'
)"

post_with_status() {
  local request_body="$1"
  curl --silent --show-error \
    -H 'content-type: application/json' \
    -H "Idempotency-Key: ${idempotency_key}" \
    "${auth_headers[@]}" \
    --data "$request_body" \
    --write-out $'\n%{http_code}' \
    "${base_url}/fund-transactions"
}

first_response="$(post_with_status "$payload")"
first_status="${first_response##*$'\n'}"
first_body="${first_response%$'\n'*}"
if [[ "$first_status" != "201" ]] ||
   ! jq -e '
     .id
     and .application_id == "demo_va_uat_api_v1"
     and .amount == "100"
     and ((.net_amount | tonumber) == ((.amount | tonumber) - (.fee_amount | tonumber)))
   ' >/dev/null <<<"$first_body"; then
  printf 'FAIL initial idempotent create returned HTTP %s\n' "$first_status" >&2
  jq . <<<"$first_body" >&2 || true
  exit 1
fi
first_id="$(jq -r '.id' <<<"$first_body")"
printf '%s\n' 'PASS initial withdrawal created with fee/net snapshot'

retry_response="$(post_with_status "$payload")"
retry_status="${retry_response##*$'\n'}"
retry_body="${retry_response%$'\n'*}"
if [[ "$retry_status" != "200" ]] ||
   [[ "$(jq -r '.id' <<<"$retry_body")" != "$first_id" ]]; then
  printf 'FAIL identical retry returned HTTP %s\n' "$retry_status" >&2
  jq . <<<"$retry_body" >&2 || true
  exit 1
fi
printf '%s\n' 'PASS identical Idempotency-Key retry returned the original record'

conflict_payload="$(jq '.amount = "1001"' <<<"$payload")"
conflict_response="$(post_with_status "$conflict_payload")"
conflict_status="${conflict_response##*$'\n'}"
conflict_body="${conflict_response%$'\n'*}"
if [[ "$conflict_status" != "409" ]] ||
   ! jq -e '.error.code == "idempotency_conflict"' >/dev/null <<<"$conflict_body"; then
  printf 'FAIL changed-payload retry returned HTTP %s\n' "$conflict_status" >&2
  jq . <<<"$conflict_body" >&2 || true
  exit 1
fi
printf '%s\n' 'PASS reused Idempotency-Key with a different payload returned 409'

detail="$(
  curl --fail --silent --show-error \
    "${auth_headers[@]}" \
    "${base_url}/fund-transactions/${first_id}"
)"
if ! jq -e --arg id "$first_id" '
  .id == $id
  and .application_id == "demo_va_uat_api_v1"
  and .type == "fiat_withdrawal"
' >/dev/null <<<"$detail"; then
  printf '%s\n' 'FAIL fund transaction detail did not return the created resource' >&2
  jq . <<<"$detail" >&2 || true
  exit 1
fi
printf '%s\n' 'PASS created withdrawal is available from the detail endpoint'

otc_collision_payload="$(
  jq -nc \
    --arg application_id "$target_application_id" \
    '{
      application_id: $application_id,
      sell_asset: "USD",
      sell_amount: "100",
      buy_asset: "USDT",
      buy_amount: "100",
      buy_network: "TRON",
      exchange_rate: "1",
      note: "[DEMO] cross-endpoint idempotency collision probe"
    }'
)"
otc_collision="$(
  curl --silent --show-error \
    -H 'content-type: application/json' \
    -H "Idempotency-Key: ${idempotency_key}" \
    "${auth_headers[@]}" \
    --data "$otc_collision_payload" \
    --write-out $'\n%{http_code}' \
    "${base_url}/otc-orders"
)"
otc_collision_status="${otc_collision##*$'\n'}"
otc_collision_body="${otc_collision%$'\n'*}"
if [[ "$otc_collision_status" != "409" ]] ||
   ! jq -e '.error.code == "idempotency_conflict"' >/dev/null <<<"$otc_collision_body"; then
  printf 'FAIL cross-endpoint Idempotency-Key reuse returned HTTP %s\n' \
    "$otc_collision_status" >&2
  jq . <<<"$otc_collision_body" >&2 || true
  exit 1
fi
printf '%s\n' 'PASS cross-endpoint Idempotency-Key reuse returned 409'

unknown_field_key="demo-v1-uat-unknown-$(node -e 'process.stdout.write(crypto.randomUUID())')"
unknown_field_response="$(
  curl --silent --show-error \
    -H 'content-type: application/json' \
    -H "Idempotency-Key: ${unknown_field_key}" \
    "${auth_headers[@]}" \
    --data "$(jq '.unexpected_field = true' <<<"$payload")" \
    --write-out $'\n%{http_code}' \
    "${base_url}/fund-transactions"
)"
unknown_field_status="${unknown_field_response##*$'\n'}"
unknown_field_body="${unknown_field_response%$'\n'*}"
if [[ "$unknown_field_status" != "422" ]] ||
   ! jq -e '
     .error.code == "unknown_fields"
     and .error.details.fields == ["unexpected_field"]
   ' >/dev/null <<<"$unknown_field_body"; then
  printf 'FAIL unknown field validation returned HTTP %s\n' "$unknown_field_status" >&2
  jq . <<<"$unknown_field_body" >&2 || true
  exit 1
fi
printf '%s\n' 'PASS unknown request fields are rejected with a stable error contract'

usd_network_key="demo-v1-uat-usd-network-$(node -e 'process.stdout.write(crypto.randomUUID())')"
usd_network_response="$(
  curl --silent --show-error \
    -H 'content-type: application/json' \
    -H "Idempotency-Key: ${usd_network_key}" \
    "${auth_headers[@]}" \
    --data "$(jq '.sell_network = "BSC"' <<<"$otc_collision_payload")" \
    --write-out $'\n%{http_code}' \
    "${base_url}/otc-orders"
)"
usd_network_status="${usd_network_response##*$'\n'}"
usd_network_body="${usd_network_response%$'\n'*}"
if [[ "$usd_network_status" != "422" ]] ||
   ! jq -e '.error.code == "validation_error"' >/dev/null <<<"$usd_network_body"; then
  printf 'FAIL USD-side OTC network returned HTTP %s\n' "$usd_network_status" >&2
  jq . <<<"$usd_network_body" >&2 || true
  exit 1
fi
printf '%s\n' 'PASS OTC rejects a network on the USD side'

printf 'Append-only idempotency UAT passed against %s\n' "$base_url"
