#!/usr/bin/env bash

set -euo pipefail
set +x

AUTH_BASE_URL="${AUTH_BASE_URL:-http://localhost:8787}"
AUTH_BOOTSTRAP_SECRET="${AUTH_BOOTSTRAP_SECRET:?Set AUTH_BOOTSTRAP_SECRET}"
AUTH_TEST_EMAIL="${AUTH_TEST_EMAIL:?Set AUTH_TEST_EMAIL}"
AUTH_TEST_ROLE="${AUTH_TEST_ROLE:-admin}"
AUTH_TEST_PASSWORD="${AUTH_TEST_PASSWORD:?Set AUTH_TEST_PASSWORD}"
AUTH_RESET_PASSWORD="${AUTH_RESET_PASSWORD:-V1-reset-password-Aa1!}"
AUTH_CHANGED_PASSWORD="${AUTH_CHANGED_PASSWORD:-V1-self-change-password-Aa2!}"

case "${AUTH_BASE_URL}" in
  http://localhost:*|http://127.0.0.1:*) ;;
  *)
    if [[ "${AUTH_ALLOW_REMOTE_SMOKE:-}" != "I_UNDERSTAND_THIS_CHANGES_AUTH_STATE" ]]; then
      echo "Refusing to initialize a non-local auth environment." >&2
      echo "Use an isolated test database, or explicitly set AUTH_ALLOW_REMOTE_SMOKE." >&2
      exit 1
    fi
    ;;
esac

if [[ "${AUTH_TEST_ROLE}" != "admin" && "${AUTH_TEST_ROLE}" != "partner" ]]; then
  echo "AUTH_TEST_ROLE must be admin or partner" >&2
  exit 1
fi
if [[ "${AUTH_TEST_PASSWORD}" == "${AUTH_RESET_PASSWORD}" ]]; then
  echo "AUTH_RESET_PASSWORD must differ from AUTH_TEST_PASSWORD" >&2
  exit 1
fi
if [[ "${AUTH_CHANGED_PASSWORD}" == "${AUTH_TEST_PASSWORD}" ||
      "${AUTH_CHANGED_PASSWORD}" == "${AUTH_RESET_PASSWORD}" ]]; then
  echo "AUTH_CHANGED_PASSWORD must differ from the initial and reset passwords" >&2
  exit 1
fi
if [[ "${AUTH_TEST_ROLE}" == "admin" ]]; then
  AUTH_ENTRY_SCOPE="admin"
  AUTH_OTHER_ENTRY_SCOPE="portal"
  AUTH_SMOKE_IP="${AUTH_SMOKE_IP:-127.0.0.$(( ($$ % 100) + 20 ))}"
else
  AUTH_ENTRY_SCOPE="portal"
  AUTH_OTHER_ENTRY_SCOPE="admin"
  AUTH_SMOKE_IP="${AUTH_SMOKE_IP:-127.0.0.$(( ($$ % 100) + 130 ))}"
fi
AUTH_ENTRY_BASE="${AUTH_BASE_URL}/api/auth/${AUTH_ENTRY_SCOPE}"
AUTH_OTHER_ENTRY_BASE="${AUTH_BASE_URL}/api/auth/${AUTH_OTHER_ENTRY_SCOPE}"

curl() {
  command curl \
    -H "CF-Connecting-IP: ${AUTH_SMOKE_IP}" \
    -H "X-Real-IP: ${AUTH_SMOKE_IP}" \
    "$@"
}

AUTH_TMP_DIR="$(mktemp -d)"
AUTH_COOKIE_JAR="${AUTH_TMP_DIR}/cookies.txt"
AUTH_SECOND_COOKIE_JAR="${AUTH_TMP_DIR}/second-cookies.txt"
AUTH_VERIFY_HEADERS="${AUTH_TMP_DIR}/verify-headers.txt"
cleanup_auth_tmp() {
  [[ -f "${AUTH_COOKIE_JAR}" ]] && unlink "${AUTH_COOKIE_JAR}"
  [[ -f "${AUTH_SECOND_COOKIE_JAR}" ]] && unlink "${AUTH_SECOND_COOKIE_JAR}"
  [[ -f "${AUTH_VERIFY_HEADERS}" ]] && unlink "${AUTH_VERIFY_HEADERS}"
  rmdir "${AUTH_TMP_DIR}"
}
trap cleanup_auth_tmp EXIT

json_value() {
  node -e '
    const [email, role, password, token, purpose] = process.argv.slice(1);
    const output = {};
    if (email) output.email = email;
    if (role) output.role = role;
    if (password) output.password = password;
    if (token) output[process.env.TOKEN_FIELD] = token;
    if (purpose) output.purpose = purpose;
    process.stdout.write(JSON.stringify(output));
  ' "$@"
}

password_change_body() {
  CURRENT_PASSWORD="$1" \
  NEW_PASSWORD="$2" \
  TOTP_CODE_VALUE="$3" \
  node -e '
    process.stdout.write(JSON.stringify({
      current_password: process.env.CURRENT_PASSWORD,
      new_password: process.env.NEW_PASSWORD,
      totp_code: process.env.TOTP_CODE_VALUE,
    }));
  '
}

assert_http() {
  local expected="$1"
  local actual="$2"
  local label="$3"
  if [[ "${actual}" != "${expected}" ]]; then
    echo "${label}: expected HTTP ${expected}, received ${actual}" >&2
    exit 1
  fi
}

assert_error_code() {
  local expected="$1"
  local response="$2"
  local label="$3"
  if ! EXPECTED_ERROR_CODE="${expected}" node -e '
    let input = "";
    process.stdin.on("data", (chunk) => input += chunk);
    process.stdin.on("end", () => {
      const payload = JSON.parse(input);
      if (payload?.error?.code !== process.env.EXPECTED_ERROR_CODE) {
        process.exit(1);
      }
    });
  ' <<<"${response}"; then
    echo "${label}: expected error code ${expected}" >&2
    exit 1
  fi
}

wait_for_totp_window() {
  local seconds_to_boundary
  seconds_to_boundary="$(
    node -e '
      const remaining = 30 - (Math.floor(Date.now() / 1000) % 30);
      process.stdout.write(String(remaining));
    '
  )"
  if (( seconds_to_boundary < 5 )); then
    sleep "${seconds_to_boundary}"
  fi
}

totp_code() {
  local secret="$1"
  TOTP_SECRET="${secret}" node -e '
    const crypto = require("node:crypto");
    const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
    const source = process.env.TOTP_SECRET.replace(/=+$/g, "").toUpperCase();
    let bits = 0;
    let value = 0;
    const bytes = [];
    for (const character of source) {
      value = (value << 5) | alphabet.indexOf(character);
      bits += 5;
      if (bits >= 8) {
        bytes.push((value >>> (bits - 8)) & 255);
        bits -= 8;
      }
    }
    const counter = Math.floor(Date.now() / 1000 / 30);
    const buffer = Buffer.alloc(8);
    buffer.writeBigUInt64BE(BigInt(counter));
    const digest = crypto.createHmac("sha1", Buffer.from(bytes))
      .update(buffer).digest();
    const offset = digest[digest.length - 1] & 15;
    const binary = (
      ((digest[offset] & 127) << 24) |
      ((digest[offset + 1] & 255) << 16) |
      ((digest[offset + 2] & 255) << 8) |
      (digest[offset + 3] & 255)
    );
    process.stdout.write(String(binary % 1000000).padStart(6, "0"));
  '
}

echo "1/20 checking retired shared endpoints and issuing a setup token"
for legacy_endpoint in \
  "login" \
  "setup/complete" \
  "totp/setup" \
  "totp/verify" \
  "password/change"; do
  LEGACY_RESPONSE="$(
    curl --silent --show-error \
      -H "Content-Type: application/json" \
      --data-binary '{}' \
      --write-out $'\n%{http_code}' \
      "${AUTH_BASE_URL}/api/auth/${legacy_endpoint}"
  )"
  LEGACY_STATUS="${LEGACY_RESPONSE##*$'\n'}"
  LEGACY_PAYLOAD="${LEGACY_RESPONSE%$'\n'*}"
  assert_http "404" "${LEGACY_STATUS}" "retired ${legacy_endpoint} endpoint"
  assert_error_code "not_found" "${LEGACY_PAYLOAD}" "retired ${legacy_endpoint} endpoint"
done

SETUP_BODY="$(
  TOKEN_FIELD="" json_value "${AUTH_TEST_EMAIL}" "${AUTH_TEST_ROLE}" "" ""
)"
SETUP_RESPONSE="$(
  curl --silent --show-error --fail-with-body \
    -H "Authorization: Bearer ${AUTH_BOOTSTRAP_SECRET}" \
    -H "Content-Type: application/json" \
    --data-binary "${SETUP_BODY}" \
    "${AUTH_BASE_URL}/api/auth/setup-token"
)"
SETUP_TOKEN="$(
  printf '%s' "${SETUP_RESPONSE}" |
    node -e '
      let input="";
      process.stdin.on("data", (chunk) => input += chunk);
      process.stdin.on("end", () => process.stdout.write(
        JSON.parse(input).data.setup_token
      ));
    '
)"

echo "2/20 rejecting cross-entry setup, then starting TOTP enrollment"
WRONG_COMPLETE_BODY="$(
  TOKEN_FIELD="setup_token" json_value "" "" "${AUTH_TEST_PASSWORD}" "${SETUP_TOKEN}"
)"
WRONG_COMPLETE_RESPONSE="$(
  curl --silent --show-error \
    -H "Content-Type: application/json" \
    --data-binary "${WRONG_COMPLETE_BODY}" \
    --write-out $'\n%{http_code}' \
    "${AUTH_OTHER_ENTRY_BASE}/setup/complete"
)"
WRONG_COMPLETE_STATUS="${WRONG_COMPLETE_RESPONSE##*$'\n'}"
WRONG_COMPLETE_PAYLOAD="${WRONG_COMPLETE_RESPONSE%$'\n'*}"
assert_http "401" "${WRONG_COMPLETE_STATUS}" "cross-entry setup"
assert_error_code \
  "invalid_setup_token" \
  "${WRONG_COMPLETE_PAYLOAD}" \
  "cross-entry setup"

COMPLETE_BODY="$(
  TOKEN_FIELD="setup_token" json_value "" "" "${AUTH_TEST_PASSWORD}" "${SETUP_TOKEN}"
)"
COMPLETE_RESPONSE="$(
  curl --silent --show-error --fail-with-body \
    -H "Content-Type: application/json" \
    --data-binary "${COMPLETE_BODY}" \
    "${AUTH_ENTRY_BASE}/setup/complete"
)"
ENROLLMENT_TOKEN="$(
  printf '%s' "${COMPLETE_RESPONSE}" |
    node -e '
      let input="";
      process.stdin.on("data", (chunk) => input += chunk);
      process.stdin.on("end", () => process.stdout.write(
        JSON.parse(input).data.enrollment_token
      ));
    '
)"

echo "3/20 rejecting cross-entry TOTP setup, then retrieving the secret"
WRONG_TOTP_SETUP_BODY="$(
  TOKEN_FIELD="enrollment_token" json_value "" "" "" "${ENROLLMENT_TOKEN}"
)"
WRONG_TOTP_SETUP_RESPONSE="$(
  curl --silent --show-error \
    -H "Content-Type: application/json" \
    --data-binary "${WRONG_TOTP_SETUP_BODY}" \
    --write-out $'\n%{http_code}' \
    "${AUTH_OTHER_ENTRY_BASE}/totp/setup"
)"
WRONG_TOTP_SETUP_STATUS="${WRONG_TOTP_SETUP_RESPONSE##*$'\n'}"
WRONG_TOTP_SETUP_PAYLOAD="${WRONG_TOTP_SETUP_RESPONSE%$'\n'*}"
assert_http "401" "${WRONG_TOTP_SETUP_STATUS}" "cross-entry TOTP setup"
assert_error_code \
  "invalid_enrollment_token" \
  "${WRONG_TOTP_SETUP_PAYLOAD}" \
  "cross-entry TOTP setup"

TOTP_SETUP_BODY="$(
  TOKEN_FIELD="enrollment_token" json_value "" "" "" "${ENROLLMENT_TOKEN}"
)"
TOTP_SETUP_RESPONSE="$(
  curl --silent --show-error --fail-with-body \
    -H "Content-Type: application/json" \
    --data-binary "${TOTP_SETUP_BODY}" \
    "${AUTH_ENTRY_BASE}/totp/setup"
)"
TOTP_SECRET="$(
  printf '%s' "${TOTP_SETUP_RESPONSE}" |
    node -e '
      let input="";
      process.stdin.on("data", (chunk) => input += chunk);
      process.stdin.on("end", () => process.stdout.write(
        JSON.parse(input).data.secret
      ));
    '
)"

wait_for_totp_window
TOTP_CODE="$(totp_code "${TOTP_SECRET}")"

echo "4/20 rejecting cross-entry TOTP verification, then issuing the session"
WRONG_VERIFY_BODY="$(
  ENROLLMENT_TOKEN="${ENROLLMENT_TOKEN}" \
  TOTP_CODE="${TOTP_CODE}" \
  node -e '
    process.stdout.write(JSON.stringify({
      enrollment_token: process.env.ENROLLMENT_TOKEN,
      code: process.env.TOTP_CODE,
    }));
  '
)"
WRONG_VERIFY_RESPONSE="$(
  curl --silent --show-error \
    -H "Content-Type: application/json" \
    --data-binary "${WRONG_VERIFY_BODY}" \
    --write-out $'\n%{http_code}' \
    "${AUTH_OTHER_ENTRY_BASE}/totp/verify"
)"
WRONG_VERIFY_STATUS="${WRONG_VERIFY_RESPONSE##*$'\n'}"
WRONG_VERIFY_PAYLOAD="${WRONG_VERIFY_RESPONSE%$'\n'*}"
assert_http "401" "${WRONG_VERIFY_STATUS}" "cross-entry TOTP enrollment"
assert_error_code \
  "invalid_enrollment_token" \
  "${WRONG_VERIFY_PAYLOAD}" \
  "cross-entry TOTP enrollment"

VERIFY_BODY="$(
  ENROLLMENT_TOKEN="${ENROLLMENT_TOKEN}" \
  TOTP_CODE="${TOTP_CODE}" \
  node -e '
    process.stdout.write(JSON.stringify({
      enrollment_token: process.env.ENROLLMENT_TOKEN,
      code: process.env.TOTP_CODE,
    }));
  '
)"
VERIFY_RESPONSE="$(
  curl --silent --show-error --fail-with-body \
    --cookie-jar "${AUTH_COOKIE_JAR}" \
    --dump-header "${AUTH_VERIFY_HEADERS}" \
    -H "Content-Type: application/json" \
    --data-binary "${VERIFY_BODY}" \
    "${AUTH_ENTRY_BASE}/totp/verify"
)"
CSRF_TOKEN="$(
  printf '%s' "${VERIFY_RESPONSE}" |
    node -e '
      let input="";
      process.stdin.on("data", (chunk) => input += chunk);
      process.stdin.on("end", () => {
        const body = JSON.parse(input);
        if (!Array.isArray(body.data.recovery_codes) ||
            body.data.recovery_codes.length !== 10) process.exit(2);
        process.stdout.write(body.data.csrf_token);
      });
    '
)"
RECOVERY_CODE="$(
  printf '%s' "${VERIFY_RESPONSE}" |
    node -e '
      let input="";
      process.stdin.on("data", (chunk) => input += chunk);
      process.stdin.on("end", () => process.stdout.write(
        JSON.parse(input).data.recovery_codes[0]
      ));
    '
)"
SECOND_RECOVERY_CODE="$(
  printf '%s' "${VERIFY_RESPONSE}" |
    node -e '
      let input="";
      process.stdin.on("data", (chunk) => input += chunk);
      process.stdin.on("end", () => process.stdout.write(
        JSON.parse(input).data.recovery_codes[1]
      ));
    '
)"

echo "5/20 checking the authenticated session and hardened cookie"
ME_STATUS="$(
  curl --silent --show-error \
    --cookie "${AUTH_COOKIE_JAR}" \
    --output /dev/null \
    --write-out '%{http_code}' \
    "${AUTH_BASE_URL}/api/auth/me"
)"
assert_http "200" "${ME_STATUS}" "session read"
if ! grep -Eqi '^set-cookie: __Host-va_session=.*; HttpOnly; Secure; SameSite=Strict; Path=/;' "${AUTH_VERIFY_HEADERS}"; then
  echo "session cookie is missing one or more required security attributes" >&2
  exit 1
fi

echo "6/20 checking browser API role isolation"
if [[ "${AUTH_TEST_ROLE}" == "admin" ]]; then
  AUTH_BROWSER_SCOPE="admin"
  AUTH_ALLOWED_PATH="/api/browser/v1/admin/overview"
  AUTH_FORBIDDEN_PATH="/api/browser/v1/portal/customers"
else
  AUTH_BROWSER_SCOPE="portal"
  AUTH_ALLOWED_PATH="/api/browser/v1/portal/customers"
  AUTH_FORBIDDEN_PATH="/api/browser/v1/admin/overview"
fi
ALLOWED_STATUS="$(
  curl --silent --show-error \
    --cookie "${AUTH_COOKIE_JAR}" \
    --output /dev/null \
    --write-out '%{http_code}' \
    "${AUTH_BASE_URL}${AUTH_ALLOWED_PATH}"
)"
assert_http "200" "${ALLOWED_STATUS}" "same-role browser API"
FORBIDDEN_STATUS="$(
  curl --silent --show-error \
    --cookie "${AUTH_COOKIE_JAR}" \
    --output /dev/null \
    --write-out '%{http_code}' \
    "${AUTH_BASE_URL}${AUTH_FORBIDDEN_PATH}"
)"
assert_http "403" "${FORBIDDEN_STATUS}" "cross-role browser API"

echo "7/20 checking business API CSRF and Origin enforcement"
AUTH_CSRF_PROBE="/api/browser/v1/${AUTH_BROWSER_SCOPE}/_csrf-probe"
MISSING_CSRF_STATUS="$(
  curl --silent --show-error \
    --cookie "${AUTH_COOKIE_JAR}" \
    -H "Origin: ${AUTH_BASE_URL}" \
    -X POST \
    --output /dev/null \
    --write-out '%{http_code}' \
    "${AUTH_BASE_URL}${AUTH_CSRF_PROBE}"
)"
assert_http "403" "${MISSING_CSRF_STATUS}" "missing business CSRF"
BAD_ORIGIN_STATUS="$(
  curl --silent --show-error \
    --cookie "${AUTH_COOKIE_JAR}" \
    -H "Origin: https://invalid.example" \
    -H "X-CSRF-Token: ${CSRF_TOKEN}" \
    -X POST \
    --output /dev/null \
    --write-out '%{http_code}' \
    "${AUTH_BASE_URL}${AUTH_CSRF_PROBE}"
)"
assert_http "403" "${BAD_ORIGIN_STATUS}" "cross-origin business request"
VALID_CSRF_STATUS="$(
  curl --silent --show-error \
    --cookie "${AUTH_COOKIE_JAR}" \
    -H "Origin: ${AUTH_BASE_URL}" \
    -H "X-CSRF-Token: ${CSRF_TOKEN}" \
    -X POST \
    --output /dev/null \
    --write-out '%{http_code}' \
    "${AUTH_BASE_URL}${AUTH_CSRF_PROBE}"
)"
assert_http "404" "${VALID_CSRF_STATUS}" "authorized CSRF probe"

echo "8/20 revoking the session with same-origin CSRF validation"
LOGOUT_STATUS="$(
  curl --silent --show-error \
    --cookie "${AUTH_COOKIE_JAR}" \
    -H "Origin: ${AUTH_BASE_URL}" \
    -H "X-CSRF-Token: ${CSRF_TOKEN}" \
    -X POST \
    --output /dev/null \
    --write-out '%{http_code}' \
    "${AUTH_BASE_URL}/api/auth/logout"
)"
assert_http "204" "${LOGOUT_STATUS}" "logout"

POST_LOGOUT_STATUS="$(
  curl --silent --show-error \
    --cookie "${AUTH_COOKIE_JAR}" \
    --output /dev/null \
    --write-out '%{http_code}' \
    "${AUTH_BASE_URL}/api/auth/me"
)"
assert_http "401" "${POST_LOGOUT_STATUS}" "revoked session"

echo "9/20 rejecting cross-entry password login, then creating a challenge"
WRONG_LOGIN_BODY="$(
  TOKEN_FIELD="" json_value "${AUTH_TEST_EMAIL}" "" "${AUTH_TEST_PASSWORD}" ""
)"
WRONG_LOGIN_RESPONSE="$(
  curl --silent --show-error \
    -H "Content-Type: application/json" \
    --data-binary "${WRONG_LOGIN_BODY}" \
    --write-out $'\n%{http_code}' \
    "${AUTH_OTHER_ENTRY_BASE}/login"
)"
WRONG_LOGIN_STATUS="${WRONG_LOGIN_RESPONSE##*$'\n'}"
WRONG_LOGIN_PAYLOAD="${WRONG_LOGIN_RESPONSE%$'\n'*}"
assert_http "401" "${WRONG_LOGIN_STATUS}" "cross-entry password login"
assert_error_code \
  "invalid_credentials" \
  "${WRONG_LOGIN_PAYLOAD}" \
  "cross-entry password login"

LOGIN_BODY="$(
  TOKEN_FIELD="" json_value "${AUTH_TEST_EMAIL}" "" "${AUTH_TEST_PASSWORD}" ""
)"
LOGIN_RESPONSE="$(
  curl --silent --show-error --fail-with-body \
    -H "Content-Type: application/json" \
    --data-binary "${LOGIN_BODY}" \
    "${AUTH_ENTRY_BASE}/login"
)"
CHALLENGE_ID="$(
  printf '%s' "${LOGIN_RESPONSE}" |
    node -e '
      let input="";
      process.stdin.on("data", (chunk) => input += chunk);
      process.stdin.on("end", () => process.stdout.write(
        JSON.parse(input).data.challenge_id
      ));
    '
)"

echo "10/20 rejecting cross-entry challenge use and the accepted TOTP counter"
WRONG_CHALLENGE_BODY="$(
  CHALLENGE_ID="${CHALLENGE_ID}" \
  TOTP_CODE="${TOTP_CODE}" \
  node -e '
    process.stdout.write(JSON.stringify({
      challenge_id: process.env.CHALLENGE_ID,
      code: process.env.TOTP_CODE,
    }));
  '
)"
WRONG_CHALLENGE_RESPONSE="$(
  curl --silent --show-error \
    -H "Content-Type: application/json" \
    --data-binary "${WRONG_CHALLENGE_BODY}" \
    --write-out $'\n%{http_code}' \
    "${AUTH_OTHER_ENTRY_BASE}/totp/verify"
)"
WRONG_CHALLENGE_STATUS="${WRONG_CHALLENGE_RESPONSE##*$'\n'}"
WRONG_CHALLENGE_PAYLOAD="${WRONG_CHALLENGE_RESPONSE%$'\n'*}"
assert_http "401" "${WRONG_CHALLENGE_STATUS}" "cross-entry login challenge"
assert_error_code \
  "invalid_challenge" \
  "${WRONG_CHALLENGE_PAYLOAD}" \
  "cross-entry login challenge"

REPLAY_BODY="$(
  CHALLENGE_ID="${CHALLENGE_ID}" \
  TOTP_CODE="${TOTP_CODE}" \
  node -e '
    process.stdout.write(JSON.stringify({
      challenge_id: process.env.CHALLENGE_ID,
      code: process.env.TOTP_CODE,
    }));
  '
)"
REPLAY_STATUS="$(
  curl --silent --show-error \
    -H "Content-Type: application/json" \
    --data-binary "${REPLAY_BODY}" \
    --output /dev/null \
    --write-out '%{http_code}' \
    "${AUTH_ENTRY_BASE}/totp/verify"
)"
assert_http "401" "${REPLAY_STATUS}" "TOTP replay"

echo "11/20 rejecting cross-entry recovery, then consuming it correctly"
RECOVERY_BODY="$(
  CHALLENGE_ID="${CHALLENGE_ID}" \
  RECOVERY_CODE="${RECOVERY_CODE}" \
  node -e '
    process.stdout.write(JSON.stringify({
      challenge_id: process.env.CHALLENGE_ID,
      recovery_code: process.env.RECOVERY_CODE,
    }));
  '
)"
CROSS_ENTRY_RECOVERY_RESPONSE="$(
  curl --silent --show-error \
    -H "Content-Type: application/json" \
    --data-binary "${RECOVERY_BODY}" \
    --write-out $'\n%{http_code}' \
    "${AUTH_OTHER_ENTRY_BASE}/totp/verify"
)"
CROSS_ENTRY_RECOVERY_STATUS="${CROSS_ENTRY_RECOVERY_RESPONSE##*$'\n'}"
CROSS_ENTRY_RECOVERY_PAYLOAD="${CROSS_ENTRY_RECOVERY_RESPONSE%$'\n'*}"
assert_http \
  "401" \
  "${CROSS_ENTRY_RECOVERY_STATUS}" \
  "cross-entry recovery code"
assert_error_code \
  "invalid_challenge" \
  "${CROSS_ENTRY_RECOVERY_PAYLOAD}" \
  "cross-entry recovery code"

RECOVERY_RESPONSE="$(
  curl --silent --show-error --fail-with-body \
    --cookie-jar "${AUTH_COOKIE_JAR}" \
    -H "Content-Type: application/json" \
    --data-binary "${RECOVERY_BODY}" \
    "${AUTH_ENTRY_BASE}/totp/verify"
)"
RECOVERY_CSRF_TOKEN="$(
  printf '%s' "${RECOVERY_RESPONSE}" |
    node -e '
      let input="";
      process.stdin.on("data", (chunk) => input += chunk);
      process.stdin.on("end", () => process.stdout.write(
        JSON.parse(input).data.csrf_token
      ));
    '
)"

echo "12/20 rejecting reuse of the consumed recovery code"
SECOND_LOGIN_RESPONSE="$(
  curl --silent --show-error --fail-with-body \
    -H "Content-Type: application/json" \
    --data-binary "${LOGIN_BODY}" \
    "${AUTH_ENTRY_BASE}/login"
)"
SECOND_CHALLENGE_ID="$(
  printf '%s' "${SECOND_LOGIN_RESPONSE}" |
    node -e '
      let input="";
      process.stdin.on("data", (chunk) => input += chunk);
      process.stdin.on("end", () => process.stdout.write(
        JSON.parse(input).data.challenge_id
      ));
    '
)"
REUSED_RECOVERY_BODY="$(
  CHALLENGE_ID="${SECOND_CHALLENGE_ID}" \
  RECOVERY_CODE="${RECOVERY_CODE}" \
  node -e '
    process.stdout.write(JSON.stringify({
      challenge_id: process.env.CHALLENGE_ID,
      recovery_code: process.env.RECOVERY_CODE,
    }));
  '
)"
REUSED_RECOVERY_STATUS="$(
  curl --silent --show-error \
    -H "Content-Type: application/json" \
    --data-binary "${REUSED_RECOVERY_BODY}" \
    --output /dev/null \
    --write-out '%{http_code}' \
    "${AUTH_ENTRY_BASE}/totp/verify"
)"
assert_http "401" "${REUSED_RECOVERY_STATUS}" "recovery code reuse"

echo "13/20 preparing a second session and a pending login challenge"
SECOND_RECOVERY_BODY="$(
  CHALLENGE_ID="${SECOND_CHALLENGE_ID}" \
  RECOVERY_CODE="${SECOND_RECOVERY_CODE}" \
  node -e '
    process.stdout.write(JSON.stringify({
      challenge_id: process.env.CHALLENGE_ID,
      recovery_code: process.env.RECOVERY_CODE,
    }));
  '
)"
curl --silent --show-error --fail-with-body \
  --cookie-jar "${AUTH_SECOND_COOKIE_JAR}" \
  -H "Content-Type: application/json" \
  --data-binary "${SECOND_RECOVERY_BODY}" \
  "${AUTH_ENTRY_BASE}/totp/verify" >/dev/null

PRE_CHANGE_LOGIN_RESPONSE="$(
  curl --silent --show-error --fail-with-body \
    -H "Content-Type: application/json" \
    --data-binary "${LOGIN_BODY}" \
    "${AUTH_ENTRY_BASE}/login"
)"
PRE_CHANGE_CHALLENGE_ID="$(
  printf '%s' "${PRE_CHANGE_LOGIN_RESPONSE}" |
    node -e '
      let input="";
      process.stdin.on("data", (chunk) => input += chunk);
      process.stdin.on("end", () => process.stdout.write(
        JSON.parse(input).data.challenge_id
      ));
    '
)"

CHANGE_TOTP_CODE="$(totp_code "${TOTP_SECRET}")"
if [[ "${CHANGE_TOTP_CODE}" == "${TOTP_CODE}" ]]; then
  SECONDS_TO_NEXT_TOTP="$(
    node -e '
      const remaining = 30 - (Math.floor(Date.now() / 1000) % 30);
      process.stdout.write(String(remaining + 1));
    '
  )"
  sleep "${SECONDS_TO_NEXT_TOTP}"
  CHANGE_TOTP_CODE="$(totp_code "${TOTP_SECRET}")"
fi

echo "14/20 rejecting unsafe and invalid password-change requests"
PASSWORD_CHANGE_URL="${AUTH_ENTRY_BASE}/password/change"
OTHER_PASSWORD_CHANGE_URL="${AUTH_OTHER_ENTRY_BASE}/password/change"
VALID_CHANGE_BODY="$(
  password_change_body \
    "${AUTH_TEST_PASSWORD}" \
    "${AUTH_CHANGED_PASSWORD}" \
    "${CHANGE_TOTP_CODE}"
)"

NO_SESSION_CHANGE_RESPONSE="$(
  curl --silent --show-error \
    -H "Origin: ${AUTH_BASE_URL}" \
    -H "Content-Type: application/json" \
    --data-binary "${VALID_CHANGE_BODY}" \
    --write-out $'\n%{http_code}' \
    "${PASSWORD_CHANGE_URL}"
)"
NO_SESSION_CHANGE_STATUS="${NO_SESSION_CHANGE_RESPONSE##*$'\n'}"
NO_SESSION_CHANGE_PAYLOAD="${NO_SESSION_CHANGE_RESPONSE%$'\n'*}"
assert_http "401" "${NO_SESSION_CHANGE_STATUS}" "password change without session"
assert_error_code \
  "authentication_required" \
  "${NO_SESSION_CHANGE_PAYLOAD}" \
  "password change without session"

CROSS_ROLE_CHANGE_RESPONSE="$(
  curl --silent --show-error \
    --cookie "${AUTH_COOKIE_JAR}" \
    -H "Origin: ${AUTH_BASE_URL}" \
    -H "X-CSRF-Token: ${RECOVERY_CSRF_TOKEN}" \
    -H "Content-Type: application/json" \
    --data-binary "${VALID_CHANGE_BODY}" \
    --write-out $'\n%{http_code}' \
    "${OTHER_PASSWORD_CHANGE_URL}"
)"
CROSS_ROLE_CHANGE_STATUS="${CROSS_ROLE_CHANGE_RESPONSE##*$'\n'}"
CROSS_ROLE_CHANGE_PAYLOAD="${CROSS_ROLE_CHANGE_RESPONSE%$'\n'*}"
assert_http "403" "${CROSS_ROLE_CHANGE_STATUS}" "cross-role password change"
assert_error_code "forbidden" "${CROSS_ROLE_CHANGE_PAYLOAD}" "cross-role password change"

MISSING_ORIGIN_CHANGE_RESPONSE="$(
  curl --silent --show-error \
    --cookie "${AUTH_COOKIE_JAR}" \
    -H "X-CSRF-Token: ${RECOVERY_CSRF_TOKEN}" \
    -H "Content-Type: application/json" \
    --data-binary "${VALID_CHANGE_BODY}" \
    --write-out $'\n%{http_code}' \
    "${PASSWORD_CHANGE_URL}"
)"
MISSING_ORIGIN_CHANGE_STATUS="${MISSING_ORIGIN_CHANGE_RESPONSE##*$'\n'}"
MISSING_ORIGIN_CHANGE_PAYLOAD="${MISSING_ORIGIN_CHANGE_RESPONSE%$'\n'*}"
assert_http "403" "${MISSING_ORIGIN_CHANGE_STATUS}" "password change without Origin"
assert_error_code \
  "invalid_origin" \
  "${MISSING_ORIGIN_CHANGE_PAYLOAD}" \
  "password change without Origin"

MISSING_CSRF_CHANGE_RESPONSE="$(
  curl --silent --show-error \
    --cookie "${AUTH_COOKIE_JAR}" \
    -H "Origin: ${AUTH_BASE_URL}" \
    -H "Content-Type: application/json" \
    --data-binary "${VALID_CHANGE_BODY}" \
    --write-out $'\n%{http_code}' \
    "${PASSWORD_CHANGE_URL}"
)"
MISSING_CSRF_CHANGE_STATUS="${MISSING_CSRF_CHANGE_RESPONSE##*$'\n'}"
MISSING_CSRF_CHANGE_PAYLOAD="${MISSING_CSRF_CHANGE_RESPONSE%$'\n'*}"
assert_http "403" "${MISSING_CSRF_CHANGE_STATUS}" "password change without CSRF"
assert_error_code \
  "invalid_csrf_token" \
  "${MISSING_CSRF_CHANGE_PAYLOAD}" \
  "password change without CSRF"

INVALID_CURRENT_BODY="$(
  password_change_body \
    "V1-wrong-current-password-Aa3!" \
    "${AUTH_CHANGED_PASSWORD}" \
    "${CHANGE_TOTP_CODE}"
)"
INVALID_CURRENT_RESPONSE="$(
  curl --silent --show-error \
    --cookie "${AUTH_COOKIE_JAR}" \
    -H "Origin: ${AUTH_BASE_URL}" \
    -H "X-CSRF-Token: ${RECOVERY_CSRF_TOKEN}" \
    -H "Content-Type: application/json" \
    --data-binary "${INVALID_CURRENT_BODY}" \
    --write-out $'\n%{http_code}' \
    "${PASSWORD_CHANGE_URL}"
)"
INVALID_CURRENT_STATUS="${INVALID_CURRENT_RESPONSE##*$'\n'}"
INVALID_CURRENT_PAYLOAD="${INVALID_CURRENT_RESPONSE%$'\n'*}"
assert_http "401" "${INVALID_CURRENT_STATUS}" "wrong current password"
assert_error_code \
  "invalid_current_password" \
  "${INVALID_CURRENT_PAYLOAD}" \
  "wrong current password"

WEAK_PASSWORD_BODY="$(
  password_change_body "${AUTH_TEST_PASSWORD}" "too-short" "${CHANGE_TOTP_CODE}"
)"
WEAK_PASSWORD_RESPONSE="$(
  curl --silent --show-error \
    --cookie "${AUTH_COOKIE_JAR}" \
    -H "Origin: ${AUTH_BASE_URL}" \
    -H "X-CSRF-Token: ${RECOVERY_CSRF_TOKEN}" \
    -H "Content-Type: application/json" \
    --data-binary "${WEAK_PASSWORD_BODY}" \
    --write-out $'\n%{http_code}' \
    "${PASSWORD_CHANGE_URL}"
)"
WEAK_PASSWORD_STATUS="${WEAK_PASSWORD_RESPONSE##*$'\n'}"
WEAK_PASSWORD_PAYLOAD="${WEAK_PASSWORD_RESPONSE%$'\n'*}"
assert_http "422" "${WEAK_PASSWORD_STATUS}" "weak new password"
assert_error_code "validation_error" "${WEAK_PASSWORD_PAYLOAD}" "weak new password"

UNCHANGED_PASSWORD_BODY="$(
  password_change_body \
    "${AUTH_TEST_PASSWORD}" \
    "${AUTH_TEST_PASSWORD}" \
    "${CHANGE_TOTP_CODE}"
)"
UNCHANGED_PASSWORD_RESPONSE="$(
  curl --silent --show-error \
    --cookie "${AUTH_COOKIE_JAR}" \
    -H "Origin: ${AUTH_BASE_URL}" \
    -H "X-CSRF-Token: ${RECOVERY_CSRF_TOKEN}" \
    -H "Content-Type: application/json" \
    --data-binary "${UNCHANGED_PASSWORD_BODY}" \
    --write-out $'\n%{http_code}' \
    "${PASSWORD_CHANGE_URL}"
)"
UNCHANGED_PASSWORD_STATUS="${UNCHANGED_PASSWORD_RESPONSE##*$'\n'}"
UNCHANGED_PASSWORD_PAYLOAD="${UNCHANGED_PASSWORD_RESPONSE%$'\n'*}"
assert_http "422" "${UNCHANGED_PASSWORD_STATUS}" "unchanged password"
assert_error_code \
  "password_unchanged" \
  "${UNCHANGED_PASSWORD_PAYLOAD}" \
  "unchanged password"

REPLAYED_TOTP_BODY="$(
  password_change_body \
    "${AUTH_TEST_PASSWORD}" \
    "${AUTH_CHANGED_PASSWORD}" \
    "${TOTP_CODE}"
)"
REPLAYED_TOTP_RESPONSE="$(
  curl --silent --show-error \
    --cookie "${AUTH_COOKIE_JAR}" \
    -H "Origin: ${AUTH_BASE_URL}" \
    -H "X-CSRF-Token: ${RECOVERY_CSRF_TOKEN}" \
    -H "Content-Type: application/json" \
    --data-binary "${REPLAYED_TOTP_BODY}" \
    --write-out $'\n%{http_code}' \
    "${PASSWORD_CHANGE_URL}"
)"
REPLAYED_TOTP_STATUS="${REPLAYED_TOTP_RESPONSE##*$'\n'}"
REPLAYED_TOTP_PAYLOAD="${REPLAYED_TOTP_RESPONSE%$'\n'*}"
assert_http "401" "${REPLAYED_TOTP_STATUS}" "password-change TOTP replay"
assert_error_code \
  "invalid_totp_code" \
  "${REPLAYED_TOTP_PAYLOAD}" \
  "password-change TOTP replay"

echo "15/20 changing the password and revoking other sessions and challenges"
CHANGE_RESPONSE="$(
  curl --silent --show-error --fail-with-body \
    --cookie "${AUTH_COOKIE_JAR}" \
    -H "Origin: ${AUTH_BASE_URL}" \
    -H "X-CSRF-Token: ${RECOVERY_CSRF_TOKEN}" \
    -H "Content-Type: application/json" \
    --data-binary "${VALID_CHANGE_BODY}" \
    "${PASSWORD_CHANGE_URL}"
)"
printf '%s' "${CHANGE_RESPONSE}" |
  node -e '
    let input="";
    process.stdin.on("data", (chunk) => input += chunk);
    process.stdin.on("end", () => {
      const data = JSON.parse(input)?.data;
      if (typeof data?.password_changed_at !== "string" ||
          !Number.isInteger(data?.revoked_sessions) ||
          data.revoked_sessions < 1) process.exit(2);
    });
  '

CURRENT_SESSION_STATUS="$(
  curl --silent --show-error \
    --cookie "${AUTH_COOKIE_JAR}" \
    --output /dev/null \
    --write-out '%{http_code}' \
    "${AUTH_BASE_URL}/api/auth/me"
)"
assert_http "200" "${CURRENT_SESSION_STATUS}" "password-change current session"

SECOND_SESSION_STATUS="$(
  curl --silent --show-error \
    --cookie "${AUTH_SECOND_COOKIE_JAR}" \
    --output /dev/null \
    --write-out '%{http_code}' \
    "${AUTH_BASE_URL}/api/auth/me"
)"
assert_http "401" "${SECOND_SESSION_STATUS}" "password-change other session"

PRE_CHANGE_CHALLENGE_BODY="$(
  CHALLENGE_ID="${PRE_CHANGE_CHALLENGE_ID}" \
  TOTP_CODE="${CHANGE_TOTP_CODE}" \
  node -e '
    process.stdout.write(JSON.stringify({
      challenge_id: process.env.CHALLENGE_ID,
      code: process.env.TOTP_CODE,
    }));
  '
)"
PRE_CHANGE_CHALLENGE_RESPONSE="$(
  curl --silent --show-error \
    -H "Content-Type: application/json" \
    --data-binary "${PRE_CHANGE_CHALLENGE_BODY}" \
    --write-out $'\n%{http_code}' \
    "${AUTH_ENTRY_BASE}/totp/verify"
)"
PRE_CHANGE_CHALLENGE_STATUS="${PRE_CHANGE_CHALLENGE_RESPONSE##*$'\n'}"
PRE_CHANGE_CHALLENGE_PAYLOAD="${PRE_CHANGE_CHALLENGE_RESPONSE%$'\n'*}"
assert_http "401" "${PRE_CHANGE_CHALLENGE_STATUS}" "pre-change login challenge"
assert_error_code \
  "invalid_challenge" \
  "${PRE_CHANGE_CHALLENGE_PAYLOAD}" \
  "pre-change login challenge"

echo "16/20 proving the old password fails and the new password creates a challenge"
OLD_PASSWORD_LOGIN_RESPONSE="$(
  curl --silent --show-error \
    -H "Content-Type: application/json" \
    --data-binary "${LOGIN_BODY}" \
    --write-out $'\n%{http_code}' \
    "${AUTH_ENTRY_BASE}/login"
)"
OLD_PASSWORD_LOGIN_STATUS="${OLD_PASSWORD_LOGIN_RESPONSE##*$'\n'}"
OLD_PASSWORD_LOGIN_PAYLOAD="${OLD_PASSWORD_LOGIN_RESPONSE%$'\n'*}"
assert_http "401" "${OLD_PASSWORD_LOGIN_STATUS}" "old password after self-service change"
assert_error_code \
  "invalid_credentials" \
  "${OLD_PASSWORD_LOGIN_PAYLOAD}" \
  "old password after self-service change"

SELF_CHANGE_LOGIN_BODY="$(
  TOKEN_FIELD="" json_value "${AUTH_TEST_EMAIL}" "" "${AUTH_CHANGED_PASSWORD}" ""
)"
SELF_CHANGE_LOGIN_RESPONSE="$(
  curl --silent --show-error --fail-with-body \
    -H "Content-Type: application/json" \
    --data-binary "${SELF_CHANGE_LOGIN_BODY}" \
    "${AUTH_ENTRY_BASE}/login"
)"
SELF_CHANGE_CHALLENGE_ID="$(
  printf '%s' "${SELF_CHANGE_LOGIN_RESPONSE}" |
    node -e '
      let input="";
      process.stdin.on("data", (chunk) => input += chunk);
      process.stdin.on("end", () => process.stdout.write(
        JSON.parse(input).data.challenge_id
      ));
    '
)"

echo "17/20 issuing an audited credential-reset token"
RESET_SETUP_BODY="$(
  TOKEN_FIELD="" json_value \
    "${AUTH_TEST_EMAIL}" \
    "${AUTH_TEST_ROLE}" \
    "" \
    "" \
    "credential_reset"
)"
RESET_SETUP_RESPONSE="$(
  curl --silent --show-error --fail-with-body \
    -H "Authorization: Bearer ${AUTH_BOOTSTRAP_SECRET}" \
    -H "Content-Type: application/json" \
    --data-binary "${RESET_SETUP_BODY}" \
    "${AUTH_BASE_URL}/api/auth/setup-token"
)"
RESET_SETUP_TOKEN="$(
  printf '%s' "${RESET_SETUP_RESPONSE}" |
    node -e '
      let input="";
      process.stdin.on("data", (chunk) => input += chunk);
      process.stdin.on("end", () => {
        const body = JSON.parse(input);
        if (body?.data?.purpose !== "credential_reset") process.exit(2);
        process.stdout.write(body.data.setup_token);
      });
    '
)"

echo "18/20 proving the old session, password, and challenge are invalid"
RESET_OLD_SESSION_STATUS="$(
  curl --silent --show-error \
    --cookie "${AUTH_COOKIE_JAR}" \
    --output /dev/null \
    --write-out '%{http_code}' \
    "${AUTH_BASE_URL}/api/auth/me"
)"
assert_http "401" "${RESET_OLD_SESSION_STATUS}" "credential-reset old session"

RESET_OLD_LOGIN_RESPONSE="$(
  curl --silent --show-error \
    -H "Content-Type: application/json" \
    --data-binary "${SELF_CHANGE_LOGIN_BODY}" \
    --write-out $'\n%{http_code}' \
    "${AUTH_ENTRY_BASE}/login"
)"
RESET_OLD_LOGIN_STATUS="${RESET_OLD_LOGIN_RESPONSE##*$'\n'}"
RESET_OLD_LOGIN_PAYLOAD="${RESET_OLD_LOGIN_RESPONSE%$'\n'*}"
assert_http "401" "${RESET_OLD_LOGIN_STATUS}" "credential-reset active password"
assert_error_code \
  "invalid_credentials" \
  "${RESET_OLD_LOGIN_PAYLOAD}" \
  "credential-reset active password"

RESET_OLD_CHALLENGE_BODY="$(
  CHALLENGE_ID="${SELF_CHANGE_CHALLENGE_ID}" \
  TOTP_CODE="${CHANGE_TOTP_CODE}" \
  node -e '
    process.stdout.write(JSON.stringify({
      challenge_id: process.env.CHALLENGE_ID,
      code: process.env.TOTP_CODE,
    }));
  '
)"
RESET_OLD_CHALLENGE_RESPONSE="$(
  curl --silent --show-error \
    -H "Content-Type: application/json" \
    --data-binary "${RESET_OLD_CHALLENGE_BODY}" \
    --write-out $'\n%{http_code}' \
    "${AUTH_ENTRY_BASE}/totp/verify"
)"
RESET_OLD_CHALLENGE_STATUS="${RESET_OLD_CHALLENGE_RESPONSE##*$'\n'}"
RESET_OLD_CHALLENGE_PAYLOAD="${RESET_OLD_CHALLENGE_RESPONSE%$'\n'*}"
assert_http "401" "${RESET_OLD_CHALLENGE_STATUS}" "credential-reset old challenge"
assert_error_code \
  "invalid_challenge" \
  "${RESET_OLD_CHALLENGE_PAYLOAD}" \
  "credential-reset old challenge"

echo "19/20 enforcing reset-token role isolation and one-time use"
RESET_COMPLETE_BODY="$(
  TOKEN_FIELD="setup_token" \
    json_value "" "" "${AUTH_RESET_PASSWORD}" "${RESET_SETUP_TOKEN}"
)"
RESET_WRONG_COMPLETE_RESPONSE="$(
  curl --silent --show-error \
    -H "Content-Type: application/json" \
    --data-binary "${RESET_COMPLETE_BODY}" \
    --write-out $'\n%{http_code}' \
    "${AUTH_OTHER_ENTRY_BASE}/setup/complete"
)"
RESET_WRONG_COMPLETE_STATUS="${RESET_WRONG_COMPLETE_RESPONSE##*$'\n'}"
RESET_WRONG_COMPLETE_PAYLOAD="${RESET_WRONG_COMPLETE_RESPONSE%$'\n'*}"
assert_http "401" "${RESET_WRONG_COMPLETE_STATUS}" "cross-entry credential reset"
assert_error_code \
  "invalid_setup_token" \
  "${RESET_WRONG_COMPLETE_PAYLOAD}" \
  "cross-entry credential reset"

RESET_COMPLETE_RESPONSE="$(
  curl --silent --show-error --fail-with-body \
    -H "Content-Type: application/json" \
    --data-binary "${RESET_COMPLETE_BODY}" \
    "${AUTH_ENTRY_BASE}/setup/complete"
)"
RESET_ENROLLMENT_TOKEN="$(
  printf '%s' "${RESET_COMPLETE_RESPONSE}" |
    node -e '
      let input="";
      process.stdin.on("data", (chunk) => input += chunk);
      process.stdin.on("end", () => process.stdout.write(
        JSON.parse(input).data.enrollment_token
      ));
    '
)"
RESET_TOKEN_REUSE_RESPONSE="$(
  curl --silent --show-error \
    -H "Content-Type: application/json" \
    --data-binary "${RESET_COMPLETE_BODY}" \
    --write-out $'\n%{http_code}' \
    "${AUTH_ENTRY_BASE}/setup/complete"
)"
RESET_TOKEN_REUSE_STATUS="${RESET_TOKEN_REUSE_RESPONSE##*$'\n'}"
RESET_TOKEN_REUSE_PAYLOAD="${RESET_TOKEN_REUSE_RESPONSE%$'\n'*}"
assert_http "401" "${RESET_TOKEN_REUSE_STATUS}" "credential-reset token reuse"
assert_error_code \
  "invalid_setup_token" \
  "${RESET_TOKEN_REUSE_PAYLOAD}" \
  "credential-reset token reuse"

echo "20/20 completing a new TOTP enrollment after credential reset"
RESET_TOTP_SETUP_BODY="$(
  TOKEN_FIELD="enrollment_token" \
    json_value "" "" "" "${RESET_ENROLLMENT_TOKEN}"
)"
RESET_TOTP_SETUP_RESPONSE="$(
  curl --silent --show-error --fail-with-body \
    -H "Content-Type: application/json" \
    --data-binary "${RESET_TOTP_SETUP_BODY}" \
    "${AUTH_ENTRY_BASE}/totp/setup"
)"
RESET_TOTP_SECRET="$(
  printf '%s' "${RESET_TOTP_SETUP_RESPONSE}" |
    node -e '
      let input="";
      process.stdin.on("data", (chunk) => input += chunk);
      process.stdin.on("end", () => process.stdout.write(
        JSON.parse(input).data.secret
      ));
    '
)"
wait_for_totp_window
RESET_TOTP_CODE="$(totp_code "${RESET_TOTP_SECRET}")"
RESET_VERIFY_BODY="$(
  ENROLLMENT_TOKEN="${RESET_ENROLLMENT_TOKEN}" \
  TOTP_CODE="${RESET_TOTP_CODE}" \
  node -e '
    process.stdout.write(JSON.stringify({
      enrollment_token: process.env.ENROLLMENT_TOKEN,
      code: process.env.TOTP_CODE,
    }));
  '
)"
RESET_VERIFY_RESPONSE="$(
  curl --silent --show-error --fail-with-body \
    --cookie-jar "${AUTH_COOKIE_JAR}" \
    -H "Content-Type: application/json" \
    --data-binary "${RESET_VERIFY_BODY}" \
    "${AUTH_ENTRY_BASE}/totp/verify"
)"
printf '%s' "${RESET_VERIFY_RESPONSE}" |
  node -e '
    let input="";
    process.stdin.on("data", (chunk) => input += chunk);
    process.stdin.on("end", () => {
      const body = JSON.parse(input);
      if (!Array.isArray(body?.data?.recovery_codes) ||
          body.data.recovery_codes.length !== 10) process.exit(2);
    });
  '
RESET_SESSION_STATUS="$(
  curl --silent --show-error \
    --cookie "${AUTH_COOKIE_JAR}" \
    --output /dev/null \
    --write-out '%{http_code}' \
    "${AUTH_BASE_URL}/api/auth/me"
)"
assert_http "200" "${RESET_SESSION_STATUS}" "credential-reset new session"

echo "Auth V1 smoke test passed."
