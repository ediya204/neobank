#!/usr/bin/env bash
set -euo pipefail

repo_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
test_dir="$(mktemp -d)"
test_db="${test_dir}/partner-customer-id.db"
trap 'rm -rf "${test_dir}"' EXIT

for migration in "${repo_dir}"/migrations/*.sql; do
  if [[ "$(basename "${migration}")" == "0024_partner_customer_id.sql" ]]; then
    sqlite3 "${test_db}" <<'SQL'
INSERT INTO va_applications (
  id,phone_country_code,phone_number,email,customer_name,status,created_at,updated_at
) VALUES (
  'legacy_without_partner_id','+65','81230000','legacy@example.test',
  '[TEST] Legacy','active','2026-08-02T00:00:00.000Z','2026-08-02T00:00:00.000Z'
);
SQL
  fi
  sqlite3 "${test_db}" < "${migration}"
done

legacy_null_count="$(sqlite3 "${test_db}" \
  "SELECT COUNT(*) FROM va_applications WHERE id='legacy_without_partner_id' AND partner_customer_id IS NULL;")"
[[ "${legacy_null_count}" == "1" ]] || {
  echo "FAIL: migration did not preserve the legacy NULL identifier" >&2
  exit 1
}

if sqlite3 "${test_db}" <<'SQL' 2>/dev/null
INSERT INTO va_applications (
  id,phone_country_code,phone_number,email,customer_name,status,created_at,updated_at
) VALUES (
  'missing_partner_id','+65','81230001','missing@example.test',
  '[TEST] Missing','active','2026-08-02T00:00:00.000Z','2026-08-02T00:00:00.000Z'
);
SQL
then
  echo "FAIL: a new application omitted partner_customer_id" >&2
  exit 1
fi

sqlite3 "${test_db}" <<'SQL'
INSERT INTO va_applications (
  id,partner_key,partner_customer_id,phone_country_code,phone_number,email,
  customer_name,status,created_at,updated_at
) VALUES (
  'valid_partner_id','ethan','eb9c7fa8-eb8c-45f8-a838-e82033a5b1f4','+65','81230002',
  'valid@example.test','[TEST] Valid','active',
  '2026-08-02T00:00:00.000Z','2026-08-02T00:00:00.000Z'
);
SQL

stored_id="$(sqlite3 "${test_db}" \
  "SELECT partner_customer_id FROM va_applications WHERE id='valid_partner_id';")"
[[ "${stored_id}" == "eb9c7fa8-eb8c-45f8-a838-e82033a5b1f4" ]] || {
  echo "FAIL: canonical UUID v4 was not preserved" >&2
  exit 1
}

if sqlite3 "${test_db}" <<'SQL' 2>/dev/null
INSERT INTO va_applications (
  id,partner_key,partner_customer_id,phone_country_code,phone_number,email,
  customer_name,status,created_at,updated_at
) VALUES (
  'duplicate_partner_id','ethan','eb9c7fa8-eb8c-45f8-a838-e82033a5b1f4','+65','81230003',
  'duplicate@example.test','[TEST] Duplicate','active',
  '2026-08-02T00:00:00.000Z','2026-08-02T00:00:00.000Z'
);
SQL
then
  echo "FAIL: duplicate ID was accepted in one Partner tenant" >&2
  exit 1
fi

sqlite3 "${test_db}" <<'SQL'
INSERT INTO va_applications (
  id,partner_key,partner_customer_id,phone_country_code,phone_number,email,
  customer_name,status,created_at,updated_at
) VALUES (
  'same_id_other_partner','other','eb9c7fa8-eb8c-45f8-a838-e82033a5b1f4','+65','81230004',
  'other@example.test','[TEST] Other Partner','active',
  '2026-08-02T00:00:00.000Z','2026-08-02T00:00:00.000Z'
);

UPDATE va_applications
SET partner_customer_id='0243790f-0c56-49a4-b228-1177e889b101'
WHERE id='legacy_without_partner_id';
SQL

if sqlite3 "${test_db}" \
  "UPDATE va_applications SET partner_customer_id='1234' WHERE id='legacy_without_partner_id';" \
  2>/dev/null; then
  echo "FAIL: invalid backfill format was accepted" >&2
  exit 1
fi

for invalid_uuid in \
  'EB9C7FA8-EB8C-45F8-A838-E82033A5B1F4' \
  'eb9c7fa8-eb8c-15f8-a838-e82033a5b1f4' \
  'eb9c7fa8-eb8c-45f8-c838-e82033a5b1f4'; do
  if sqlite3 "${test_db}" \
    "UPDATE va_applications SET partner_customer_id='${invalid_uuid}' WHERE id='legacy_without_partner_id';" \
    2>/dev/null; then
    echo "FAIL: non-canonical UUID v4 was accepted: ${invalid_uuid}" >&2
    exit 1
  fi
done

echo "Partner customer ID checks passed."
