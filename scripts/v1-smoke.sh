#!/usr/bin/env bash
set -euo pipefail

command -v curl >/dev/null || {
  printf '%s\n' 'curl is required' >&2
  exit 2
}
command -v jq >/dev/null || {
  printf '%s\n' 'jq is required' >&2
  exit 2
}

base_url="${VA_API_BASE_URL:-http://localhost:8787/api/v1}"
base_url="${base_url%/}"
demo_application_id="${VA_DEMO_APPLICATION_ID:-demo_va_active_v1}"

auth_headers=(-H 'Accept: application/json')
case "$base_url" in
  http://localhost:*|http://127.0.0.1:*)
    if [[ -n "${CF_ACCESS_CLIENT_ID:-}" && -n "${CF_ACCESS_CLIENT_SECRET:-}" ]]; then
      auth_headers=(
        -H 'Accept: application/json'
        -H "CF-Access-Client-Id: ${CF_ACCESS_CLIENT_ID}"
        -H "CF-Access-Client-Secret: ${CF_ACCESS_CLIENT_SECRET}"
      )
    fi
    ;;
  *)
    : "${CF_ACCESS_CLIENT_ID:?Set CF_ACCESS_CLIENT_ID for a non-local API}"
    : "${CF_ACCESS_CLIENT_SECRET:?Set CF_ACCESS_CLIENT_SECRET for a non-local API}"
    auth_headers=(
      -H 'Accept: application/json'
      -H "CF-Access-Client-Id: ${CF_ACCESS_CLIENT_ID}"
      -H "CF-Access-Client-Secret: ${CF_ACCESS_CLIENT_SECRET}"
    )
    ;;
esac

api_get() {
  curl --fail --silent --show-error \
    "${auth_headers[@]}" \
    "${base_url}$1"
}

assert_json() {
  local label="$1"
  local body="$2"
  local filter="$3"
  if ! jq -e "$filter" >/dev/null <<<"$body"; then
    printf 'FAIL %s\n' "$label" >&2
    jq . <<<"$body" >&2 || true
    exit 1
  fi
  printf 'PASS %s\n' "$label"
}

api_index="$(api_get '')"
assert_json 'API index' "$api_index" '
  .name == "VA BaaS Partner API"
  and .version == "1.4.0"
  and .status == "ok"
  and .links.health == "/api/v1/health"
  and .links.openapi == "/api/v1/openapi.yaml"
  and .links.country_calling_codes == "/api/v1/country-calling-codes"
  and .links.portal_guide == "/portal/api-guide"
'
api_index_slash="$(api_get '/')"
assert_json 'API index with trailing slash' "$api_index_slash" '
  .name == "VA BaaS Partner API"
  and .version == "1.4.0"
  and .status == "ok"
  and .links.health == "/api/v1/health"
'

health_headers="$(
  curl --fail --silent --show-error \
    --dump-header - --output /dev/null \
    "${auth_headers[@]}" \
    "${base_url}/health"
)"
if ! grep -Eiq '^x-request-id:[[:space:]]*[A-Za-z0-9-]+' <<<"$health_headers"; then
  printf '%s\n' 'FAIL health response is missing X-Request-Id' >&2
  exit 1
fi
printf '%s\n' 'PASS health response includes X-Request-Id'

health="$(api_get '/health')"
assert_json 'health body' "$health" '.status == "ok" and .service == "va-api"'

country_calling_codes="$(api_get '/country-calling-codes')"
assert_json 'supported country calling-code policy' "$country_calling_codes" '
  .meta.count == 241
  and .meta.unique_calling_code_count == 203
  and .meta.policy.reviewed_at == "2026-07-29"
  and .meta.policy.excluded_iso2 == ["CU", "IR", "KP"]
  and (.data | any(.[]; .iso2 == "SY" and .calling_code == "+963"))
  and (.data | all(.[]; .iso2 != "CU" and .iso2 != "IR" and .iso2 != "KP"))
'

api_integration="$(api_get '/api-integration')"
assert_json 'API credential lifecycle shape' "$api_integration" '
  (.data.credentials | type == "array")
  and (.data.credential_rotation_requests | type == "array")
  and (.data.security.credential_management.configured | type == "boolean")
'

applications="$(api_get '/va-applications')"
assert_json 'application status coverage' "$applications" '
  (.data | any(.[]; .application_id == "demo_va_active_v1" and .status == "active"))
  and (.data | any(.[]; .application_id == "demo_va_submitted_v1" and .status == "submitted"))
  and (.data | any(.[]; .application_id == "demo_va_kyc_link_ready_v1" and .status == "kyc_link_ready"))
  and (.data | any(.[]; .application_id == "demo_va_kyc_approved_v1" and .status == "kyc_approved"))
  and (.data | any(.[]; .application_id == "demo_va_va_processing_v1" and .status == "va_processing"))
  and (.data | any(.[]; .application_id == "demo_va_uat_api_v1" and .status == "active"))
  and (.data | all(.[]; .status != "kyc_link_ready" or (.kyc_url | type == "string")))
  and (.data | all(.[]; .status == "kyc_link_ready" or .kyc_url == null))
'

customer="$(api_get "/customers/${demo_application_id}")"
assert_json 'active customer and VA account' "$customer" '
  .customer.application_id == "demo_va_active_v1"
  and .customer.status == "active"
  and .customer.kyc_url == null
  and .customer.va_account.account_number == "79632100001001"
'

balances="$(api_get "/balances?application_id=${demo_application_id}")"
assert_json 'USD balance equation' "$balances" '
  .data | any(.[];
    .asset == "USD"
    and .network == null
    and .ledger_balance == "19197.5"
    and .reserved == "1500"
    and .available_balance == "17697.5"
  )
'
assert_json 'four-chain USDT balances' "$balances" '
  (.data | any(.[]; .asset == "USDT" and .network == "TRON"
    and .ledger_balance == "5495" and .reserved == "100" and .available_balance == "5395"))
  and (.data | any(.[]; .asset == "USDT" and .network == "ETHEREUM"
    and .ledger_balance == "5000" and .reserved == "200" and .available_balance == "4800"))
  and (.data | any(.[]; .asset == "USDT" and .network == "SOLANA"
    and .ledger_balance == "4700" and .reserved == "0" and .available_balance == "4700"))
  and (.data | any(.[]; .asset == "USDT" and .network == "BSC"
    and .ledger_balance == "5990.025" and .reserved == "0" and .available_balance == "5990.025"))
'

transactions="$(api_get "/transactions?application_id=${demo_application_id}&category=all&status=all&page=1&limit=100")"
assert_json 'transaction pagination metadata' "$transactions" '
  .meta.count == 16 and .meta.total == 16 and .meta.page == 1
  and .meta.limit == 100 and .meta.total_pages == 1
'
assert_json 'cleared fiat conversion linked history rows' "$transactions" '
  (.data | any(.[]; .id == "demo_fund_fiat_deposit_cleared_converted_v1"
    and .category == "fund" and .type == "fiat_deposit"
    and .direction == "credit" and .asset == "USD" and .amount == "1000"
    and .status == "completed" and .settlement_status == "cleared"
    and .conversion_otc_id == "demo_otc_fiat_conversion_usd_to_usdt_tron_v1"))
  and (.data | any(.[]; .id == "demo_otc_fiat_conversion_usd_to_usdt_tron_v1"
    and .category == "otc" and .type == "otc"
    and .direction == "exchange" and .asset == "USD" and .amount == "1000"
    and .counter_asset == "USDT" and .counter_network == "TRON"
    and .counter_amount == "995" and .net_buy_amount == "995"
    and .fee_amount == "0" and .fee_rate == "0%"
    and .status == "completed"))
  and (.data | any(.[]; .id == "demo_ledger_fiat_conversion_usd_debit_v1"
    and .ledger_entry_id == "demo_ledger_fiat_conversion_usd_debit_v1"
    and .category == "fund" and .type == "fiat_conversion_debit"
    and .direction == "debit" and .asset == "USD" and .network == null
    and .amount == "1000" and .fee_amount == "0" and .net_amount == "1000"
    and .status == "completed" and .settlement_status == "cleared"
    and .source_fund_transaction_id == "demo_fund_fiat_deposit_cleared_converted_v1"
    and .otc_order_id == "demo_otc_fiat_conversion_usd_to_usdt_tron_v1"
    and .conversion_otc_id == "demo_otc_fiat_conversion_usd_to_usdt_tron_v1"
    and .reference == "DEMO-BANK-SETTLED-AUTO-001"))
  and (.data | any(.[]; .id == "demo_ledger_fiat_conversion_usdt_tron_credit_v1"
    and .ledger_entry_id == "demo_ledger_fiat_conversion_usdt_tron_credit_v1"
    and .category == "fund" and .type == "crypto_conversion_credit"
    and .direction == "credit" and .asset == "USDT" and .network == "TRON"
    and .amount == "995" and .fee_amount == "0" and .net_amount == "995"
    and .status == "completed" and .settlement_status == "cleared"
    and .source_fund_transaction_id == "demo_fund_fiat_deposit_cleared_converted_v1"
    and .otc_order_id == "demo_otc_fiat_conversion_usd_to_usdt_tron_v1"
    and .conversion_otc_id == "demo_otc_fiat_conversion_usd_to_usdt_tron_v1"
    and .reference == "DEMO-BANK-SETTLED-AUTO-001"))
  and ([.data[] | select(
    .id == "demo_fund_fiat_deposit_cleared_converted_v1"
    or .id == "demo_otc_fiat_conversion_usd_to_usdt_tron_v1"
    or .id == "demo_ledger_fiat_conversion_usd_debit_v1"
    or .id == "demo_ledger_fiat_conversion_usdt_tron_credit_v1"
  )] | length == 4)
  and ([.data[].id] | index("demo_otc_fiat_conversion_usd_to_usdt_tron_v1")
    < index("demo_ledger_fiat_conversion_usd_debit_v1"))
  and ([.data[].id] | index("demo_ledger_fiat_conversion_usd_debit_v1")
    < index("demo_ledger_fiat_conversion_usdt_tron_credit_v1"))
'
assert_json 'fiat withdrawal fee snapshots and net amounts' "$transactions" '
  (.data | any(.[]; .id == "demo_fund_fiat_withdrawal_submitted_v1"
    and .status == "submitted" and .amount == "1000" and .fee_amount == "30" and .net_amount == "970"))
  and (.data | any(.[]; .id == "demo_fund_fiat_withdrawal_processing_v1"
    and .status == "processing" and .amount == "500" and .fee_amount == "30" and .net_amount == "470"))
  and (.data | any(.[]; .id == "demo_fund_fiat_withdrawal_completed_v1"
    and .status == "completed" and .amount == "300" and .fee_amount == "30" and .net_amount == "270"))
'
assert_json 'USDT withdrawal fee snapshots and net amounts' "$transactions" '
  (.data | any(.[]; .id == "demo_fund_usdt_withdrawal_submitted_v1"
    and .network == "TRON" and .status == "submitted"
    and .amount == "100" and .fee_amount == "5" and .net_amount == "95"))
  and (.data | any(.[]; .id == "demo_fund_usdt_withdrawal_processing_v1"
    and .network == "ETHEREUM" and .status == "processing"
    and .amount == "200" and .fee_amount == "5" and .net_amount == "195"))
  and (.data | any(.[]; .id == "demo_fund_usdt_withdrawal_completed_v1"
    and .network == "SOLANA" and .status == "completed"
    and .amount == "300" and .fee_amount == "5" and .net_amount == "295"))
'
assert_json 'bidirectional OTC fee and network coverage' "$transactions" '
  (.data | any(.[]; .id == "demo_otc_usd_to_usdt_completed_v1"
    and .asset == "USD" and .counter_asset == "USDT"
    and .counter_network == "BSC" and .fee_amount == "4.975"
    and .net_buy_amount == "990.025"))
  and (.data | any(.[]; .id == "demo_otc_usdt_to_usd_completed_v1"
    and .asset == "USDT" and .network == "TRON" and .counter_asset == "USD"
    and .fee_amount == "2.5" and .net_buy_amount == "497.5"))
'

fund_filter="$(api_get "/transactions?application_id=${demo_application_id}&category=fund&status=all&page=1&limit=100")"
otc_filter="$(api_get "/transactions?application_id=${demo_application_id}&category=otc&status=all&page=1&limit=100")"
fiat_filter="$(api_get "/transactions?application_id=${demo_application_id}&category=all&status=all&wallet=fiat&page=1&limit=100")"
crypto_filter="$(api_get "/transactions?application_id=${demo_application_id}&category=all&status=all&wallet=crypto&page=1&limit=100")"
tron_filter="$(api_get "/transactions?application_id=${demo_application_id}&category=all&status=all&network=TRON&page=1&limit=100")"
bsc_filter="$(api_get "/transactions?application_id=${demo_application_id}&category=all&status=all&network=BSC&page=1&limit=100")"
date_filter="$(api_get "/transactions?application_id=${demo_application_id}&category=all&status=all&date_from=2026-07-29&date_to=2026-07-29&page=1&limit=100")"
assert_json 'fund filter' "$fund_filter" '.meta.total == 13 and (.data | all(.category == "fund"))'
assert_json 'OTC filter' "$otc_filter" '.meta.total == 3 and (.data | all(.category == "otc"))'
assert_json 'fiat wallet filter includes OTC conversions' "$fiat_filter" '
  .meta.total == 8
  and (.data | all(.category == "otc" or (.type | startswith("fiat_"))))
'
assert_json 'crypto wallet filter includes OTC conversions' "$crypto_filter" '
  .meta.total == 11
  and (.data | all(.category == "otc" or (.type | startswith("usdt_")) or .type == "crypto_conversion_credit"))
'
assert_json 'TRON transaction filter covers fund and OTC' "$tron_filter" '
  .meta.total == 5
  and (.data | all(.network == "TRON" or .counter_network == "TRON"))
'
assert_json 'BSC transaction filter covers fund and OTC' "$bsc_filter" '
  .meta.total == 2
  and (.data | all(.network == "BSC" or .counter_network == "BSC"))
'
assert_json 'date range filter' "$date_filter" '.meta.total == 16'

sweep_page_one="$(api_get "/sweep-batches?status=cancelled&application_id=${demo_application_id}&page=1&limit=1")"
assert_json 'sweep batch first page' "$sweep_page_one" '
  .meta.total == 2 and .meta.page == 1 and .meta.limit == 1
  and .meta.total_pages == 2 and (.data | length == 1)
  and .data[0].batch_id == "demo_sweep_cancelled_second_v1"
  and .data[0].status == "cancelled"
  and .data[0].items[0].application_id == "demo_va_active_v1"
'
sweep_last_page="$(api_get "/sweep-batches?status=cancelled&application_id=${demo_application_id}&page=2&limit=1")"
assert_json 'sweep batch last page' "$sweep_last_page" '
  .meta.total == 2 and .meta.page == 2 and .meta.limit == 1
  and .meta.total_pages == 2 and (.data | length == 1)
  and .data[0].batch_id == "demo_sweep_cancelled_first_v1"
'
sweep_detail="$(api_get '/sweep-batches/demo_sweep_cancelled_second_v1')"
assert_json 'sweep batch detail' "$sweep_detail" '
  .data.batch_id == "demo_sweep_cancelled_second_v1"
  and .data.status == "cancelled" and .data.total_amount == "2"
  and .data.items[0].amount == "2"
'
sweep_over_limit_response="$(
  curl --silent --show-error --write-out $'\n%{http_code}' \
    "${auth_headers[@]}" \
    "${base_url}/sweep-batches?page=1&limit=101"
)"
sweep_over_limit_status="${sweep_over_limit_response##*$'\n'}"
sweep_over_limit_body="${sweep_over_limit_response%$'\n'*}"
if [[ "$sweep_over_limit_status" != '422' ]]; then
  printf 'FAIL sweep batch limit above 100 returned HTTP %s\n' \
    "$sweep_over_limit_status" >&2
  exit 1
fi
assert_json 'sweep batch limit above 100' "$sweep_over_limit_body" '
  .error.code == "validation_error"
'

fund_detail="$(api_get '/fund-transactions/demo_fund_usdt_solana_deposit_completed_v1')"
assert_json 'fund detail resource' "$fund_detail" '
  .id == "demo_fund_usdt_solana_deposit_completed_v1"
  and .application_id == "demo_va_active_v1"
  and .type == "usdt_deposit"
  and .network == "SOLANA"
'
otc_detail="$(api_get '/otc-orders/demo_otc_usdt_to_usd_completed_v1')"
assert_json 'OTC detail resource' "$otc_detail" '
  .id == "demo_otc_usdt_to_usd_completed_v1"
  and .application_id == "demo_va_active_v1"
  and .sell_asset == "USDT"
  and .sell_network == "TRON"
  and .buy_asset == "USD"
  and (has("operator_note") | not)
  and (has("settlement_reference") | not)
'

solana_funds="$(api_get "/fund-transactions?application_id=${demo_application_id}&network=SOLANA")"
assert_json 'fund network filter' "$solana_funds" '
  .meta.count == 2 and (.data | all(.asset == "USDT" and .network == "SOLANA"))
'
bsc_otc="$(api_get "/otc-orders?application_id=${demo_application_id}&network=BSC")"
assert_json 'OTC network filter' "$bsc_otc" '
  .meta.count == 1
  and .data[0].id == "demo_otc_usd_to_usdt_completed_v1"
  and .data[0].buy_network == "BSC"
'

openapi="$(curl --fail --silent --show-error "${auth_headers[@]}" "${base_url}/openapi.yaml")"
if ! grep -q '^openapi: 3.1.0' <<<"$openapi" ||
   ! grep -q 'fee_amount' <<<"$openapi" ||
   ! grep -q 'net_amount' <<<"$openapi" ||
   ! grep -q 'beneficiary_address' <<<"$openapi"; then
  printf '%s\n' 'FAIL OpenAPI is missing the V1 transaction contract' >&2
  exit 1
fi
printf '%s\n' 'PASS OpenAPI V1 transaction contract'

if grep -q 'idempotency_conflict' <<<"$openapi" &&
   grep -q 'X-Request-Id' <<<"$openapi"; then
  printf '%s\n' 'PASS OpenAPI integrity and request ID contract'
elif [[ "${VA_UAT_REQUIRE_OPENAPI_INTEGRITY:-0}" == "1" ]]; then
  printf '%s\n' 'FAIL OpenAPI does not yet document idempotency_conflict and X-Request-Id' >&2
  exit 1
else
  printf '%s\n' \
    'WARN OpenAPI does not yet document idempotency_conflict and X-Request-Id (set VA_UAT_REQUIRE_OPENAPI_INTEGRITY=1 to enforce)' >&2
fi

printf 'V1 read-only smoke passed for %s using %s\n' "$demo_application_id" "$base_url"
