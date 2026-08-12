#!/usr/bin/env bash
set -euo pipefail

command -v curl >/dev/null
command -v jq >/dev/null

base_url="${VA_API_BASE_URL:-http://127.0.0.1:8787/api/v1}"
base_url="${base_url%/}"
other_application_id="${VA_OTHER_TENANT_APPLICATION_ID:?Set the seeded other-tenant application ID}"
other_fund_id="${VA_OTHER_TENANT_FUND_ID:?Set the seeded other-tenant fund ID}"
own_application_id="${VA_OWN_TENANT_APPLICATION_ID:?Set the seeded current-tenant application ID}"
own_fund_id="${VA_OWN_TENANT_FUND_ID:?Set the seeded current-tenant fund ID}"

auth_headers=(-H 'Accept: application/json')
if [[ -n "${CF_ACCESS_CLIENT_ID:-}" && -n "${CF_ACCESS_CLIENT_SECRET:-}" ]]; then
  auth_headers+=(
    -H "CF-Access-Client-Id: ${CF_ACCESS_CLIENT_ID}"
    -H "CF-Access-Client-Secret: ${CF_ACCESS_CLIENT_SECRET}"
  )
fi

api_get() {
  curl --silent --show-error "${auth_headers[@]}" "${base_url}$1"
}

assert_not_found() {
  local route="$1"
  local response_file
  response_file="$(mktemp)"
  local http_status
  http_status="$(curl --silent --show-error --output "${response_file}" \
    --write-out '%{http_code}' "${auth_headers[@]}" "${base_url}${route}")"
  if [[ "${http_status}" != '404' ]] || ! jq -e '.error.code == "not_found"' "${response_file}" >/dev/null; then
    printf 'FAIL expected tenant-hidden 404: %s\n' "${route}" >&2
    exit 1
  fi
}

applications="$(api_get '/va-applications')"
customers="$(api_get '/customers')"
funds="$(api_get '/fund-transactions')"
other_balances="$(api_get "/balances?application_id=${other_application_id}")"
other_transactions="$(api_get "/transactions?application_id=${other_application_id}")"

jq -e --arg own "${own_application_id}" --arg other "${other_application_id}" '
  (.data | any(.application_id == $own)) and (.data | all(.application_id != $other))
' <<<"${applications}" >/dev/null
jq -e --arg own "${own_application_id}" --arg other "${other_application_id}" '
  (.data | any(.application_id == $own)) and (.data | all(.application_id != $other))
' <<<"${customers}" >/dev/null
jq -e --arg own "${own_fund_id}" --arg other "${other_fund_id}" '
  (.data | any(.id == $own)) and (.data | all(.id != $other))
' <<<"${funds}" >/dev/null
jq -e '.data == []' <<<"${other_balances}" >/dev/null
jq -e '.data == [] and .meta.total == 0' <<<"${other_transactions}" >/dev/null

assert_not_found "/va-applications/${other_application_id}"
assert_not_found "/customers/${other_application_id}"
assert_not_found "/fund-transactions/${other_fund_id}"

printf '%s\n' 'Partner tenant isolation check passed.'
