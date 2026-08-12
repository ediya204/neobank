#!/usr/bin/env bash

set -euo pipefail
set +x

usage() {
  printf '%s\n' 'Usage: scripts/portal-team-rbac-check.sh'
  printf '%s\n' 'Runs static checks and applies all migrations to a fresh, isolated local D1.'
}

if (($#)); then
  case "$1" in
    -h|--help)
      usage
      exit 0
      ;;
    *)
      printf 'Unexpected argument: %s\n' "$1" >&2
      usage >&2
      exit 2
      ;;
  esac
fi

for required_command in awk node rg shasum find ps; do
  if ! command -v "$required_command" >/dev/null 2>&1; then
    printf 'Required command is unavailable: %s\n' "$required_command" >&2
    exit 2
  fi
done

repo_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
config_file="${repo_dir}/wrangler.jsonc"
migration_file="${repo_dir}/migrations/0020_portal_team_rbac.sql"
role_mutation_migration_file="${repo_dir}/migrations/0023_portal_role_mutation_guard.sql"
worker_file="${repo_dir}/worker/index.ts"
team_file="${repo_dir}/worker/portal-team.ts"
auth_file="${repo_dir}/worker/auth.ts"
frontend_api_file="${repo_dir}/src/features/portal-team/api.ts"
wrangler_bin="${repo_dir}/node_modules/.bin/wrangler"
database_name="${VA_D1_DATABASE:-va-api-db}"

if [[ ! "$database_name" =~ ^[A-Za-z0-9_-]+$ ]]; then
  printf 'Unsafe D1 database name: %s\n' "$database_name" >&2
  exit 2
fi
if [[ ! -f "$config_file" ]]; then
  printf 'Wrangler config not found: %s\n' "$config_file" >&2
  exit 2
fi
if [[ ! -f "$migration_file" ]]; then
  printf 'Portal team migration not found: %s\n' "$migration_file" >&2
  exit 2
fi
if [[ ! -f "$role_mutation_migration_file" ]]; then
  printf 'Portal role mutation migration not found: %s\n' "$role_mutation_migration_file" >&2
  exit 2
fi
if [[ ! -x "$wrangler_bin" ]]; then
  printf 'Local Wrangler binary not found: %s\n' "$wrangler_bin" >&2
  printf '%s\n' 'Install the locked workspace dependencies before running this check.' >&2
  exit 2
fi

pass() {
  printf 'PASS %s\n' "$1"
}

fail() {
  printf 'FAIL %s\n' "$1" >&2
  exit 1
}

for required_source in "$worker_file" "$team_file" "$auth_file" "$frontend_api_file"; do
  if [[ ! -f "$required_source" ]]; then
    fail "required integrated source is missing: ${required_source}"
  fi
done

assert_source_pattern() {
  local label="$1"
  local file="$2"
  local pattern="$3"
  if ! rg --quiet --multiline "$pattern" "$file"; then
    fail "$label"
  fi
  pass "$label"
}

state_fingerprint() {
  local state_dir="${repo_dir}/.wrangler"
  if [[ ! -d "$state_dir" ]]; then
    printf '%s' 'absent'
    return
  fi
  (
    cd "$repo_dir"
    {
      find .wrangler -type d -print
      while IFS= read -r state_file; do
        shasum -a 256 "$state_file"
      done < <(find .wrangler -type f -print | LC_ALL=C sort)
    } | LC_ALL=C sort | shasum -a 256 | awk '{print $1}'
  )
}

default_wrangler_state_writer_active() {
  ps -ax -o command= | awk '
    /[w]rangler[[:space:]]+dev/ && $0 !~ /--persist-to/ { found = 1 }
    END { exit(found ? 0 : 1) }
  '
}

temp_base="${TMPDIR:-/tmp}"
temp_base="${temp_base%/}"
test_root="$(mktemp -d "${temp_base}/portal-team-rbac-check.XXXXXX")"
case "$test_root" in
  "${temp_base}"/portal-team-rbac-check.*) ;;
  *)
    printf 'Unexpected temporary directory: %s\n' "$test_root" >&2
    exit 2
    ;;
esac

cleanup() {
  local status=$?
  trap - EXIT
  set +e
  if [[ -d "$test_root" && "$(basename "$test_root")" == portal-team-rbac-check.* ]]; then
    find "$test_root" -depth -mindepth 1 -delete
    rmdir "$test_root"
  fi
  exit "$status"
}
trap cleanup EXIT

persist_dir="${test_root}/persist"
upgrade_persist_dir="${test_root}/upgrade-persist"
upgrade_migrations_dir="${test_root}/upgrade-migrations"
upgrade_config_file="${test_root}/upgrade-wrangler.json"
migration_log="${test_root}/migrations.log"
upgrade_log="${test_root}/upgrade.log"
d1_error_log="${test_root}/d1-error.log"
mkdir "$persist_dir" "$upgrade_persist_dir" "$upgrade_migrations_dir"

wrangler_state_before="$(state_fingerprint)"
default_state_writer_before=0
if default_wrangler_state_writer_active; then
  default_state_writer_before=1
fi

assert_source_pattern \
  'migration enables foreign keys' \
  "$migration_file" \
  'PRAGMA[[:space:]]+foreign_keys[[:space:]]*=[[:space:]]*ON'
assert_source_pattern \
  'pending invitations have an organization-scoped unique index' \
  "$migration_file" \
  'idx_portal_invitations_pending_email'
assert_source_pattern \
  'member roles use an organization-scoped composite foreign key' \
  "$migration_file" \
  'FOREIGN KEY[[:space:]]*\([[:space:]]*role_id[[:space:]]*,[[:space:]]*organization_id[[:space:]]*\)[[:space:]]*REFERENCES[[:space:]]+portal_roles[[:space:]]*\([[:space:]]*id[[:space:]]*,[[:space:]]*organization_id[[:space:]]*\)'
assert_source_pattern \
  'a user can belong to only one Partner organization in V1' \
  "$migration_file" \
  'user_id[^,\n]*UNIQUE|UNIQUE[[:space:]]*\([[:space:]]*user_id[[:space:]]*\)'
assert_source_pattern \
  'last Owner demotion is guarded' \
  "$migration_file" \
  'portal_members_last_owner_update'
assert_source_pattern \
  'last Owner deletion is guarded' \
  "$migration_file" \
  'portal_members_last_owner_delete'
assert_source_pattern \
  'role updates have a request-unique mutation guard' \
  "$role_mutation_migration_file" \
  '(?s)ALTER TABLE[[:space:]]+portal_roles.{0,160}ADD COLUMN[[:space:]]+mutation_id[[:space:]]+TEXT[[:space:]]+NOT NULL'

printf '%s\n' 'Applying all migrations to a fresh local D1 persistence directory.'
if ! (
  cd "$repo_dir"
  CI=1 "$wrangler_bin" d1 migrations apply "$database_name" \
    --local \
    --persist-to "$persist_dir" \
    --config "$config_file"
) >"$migration_log" 2>&1; then
  tail -n 200 "$migration_log" >&2
  fail 'all migrations apply to an isolated local D1'
fi
pass 'all migrations apply to an isolated local D1'

while IFS= read -r candidate_migration; do
  cp "$candidate_migration" "$upgrade_migrations_dir/"
done < <(
  find "${repo_dir}/migrations" -maxdepth 1 -type f -name '*.sql' \
    ! -name "$(basename "$role_mutation_migration_file")" -print | LC_ALL=C sort
)
node - "$config_file" "$upgrade_config_file" "$upgrade_migrations_dir" <<'NODE'
const fs = require('node:fs');
const [sourcePath, outputPath, migrationsDir] = process.argv.slice(2);
const source = JSON.parse(fs.readFileSync(sourcePath, 'utf8'));
const database = source.d1_databases[0];
fs.writeFileSync(outputPath, JSON.stringify({
  name: 'va-api-rbac-upgrade-check',
  compatibility_date: source.compatibility_date,
  d1_databases: [{
    binding: database.binding,
    database_name: database.database_name,
    database_id: database.database_id,
    migrations_dir: migrationsDir,
  }],
}, null, 2));
NODE
if ! (
  cd "$repo_dir"
  CI=1 "$wrangler_bin" d1 migrations apply "$database_name" \
    --local \
    --persist-to "$upgrade_persist_dir" \
    --config "$upgrade_config_file"
) >"$upgrade_log" 2>&1; then
  tail -n 200 "$upgrade_log" >&2
  fail 'pre-mutation candidate migrations apply to the upgrade fixture'
fi

upgrade_query_scalar() {
  local sql="$1"
  local output
  if ! output="$(
    cd "$repo_dir"
    "$wrangler_bin" d1 execute "$database_name" \
      --local \
      --persist-to "$upgrade_persist_dir" \
      --config "$upgrade_config_file" \
      --command "$sql" \
      --json 2>>"$upgrade_log"
  )"; then
    tail -n 200 "$upgrade_log" >&2
    return 1
  fi
  printf '%s' "$output" | node -e '
    let input = "";
    process.stdin.on("data", (chunk) => input += chunk);
    process.stdin.on("end", () => {
      const batches = JSON.parse(input);
      const batch = batches.find((item) => Array.isArray(item.results) && item.results.length);
      if (!batch) process.exit(2);
      const value = Object.values(batch.results[0])[0];
      if (value === null || value === undefined) process.exit(3);
      process.stdout.write(String(value));
    });
  '
}

if [[ "$(upgrade_query_scalar "SELECT COUNT(*) AS value FROM pragma_table_info('portal_roles') WHERE name='mutation_id';")" != '0' ]]; then
  fail 'the upgrade fixture must reproduce an applied 0020 without mutation_id'
fi
pass 'the upgrade fixture reproduces an applied 0020 without mutation_id'

cp "$role_mutation_migration_file" "$upgrade_migrations_dir/"
if ! (
  cd "$repo_dir"
  CI=1 "$wrangler_bin" d1 migrations apply "$database_name" \
    --local \
    --persist-to "$upgrade_persist_dir" \
    --config "$upgrade_config_file"
) >>"$upgrade_log" 2>&1; then
  tail -n 200 "$upgrade_log" >&2
  fail 'the separate role mutation migration applies to an existing 0020 database'
fi
if [[ "$(upgrade_query_scalar "SELECT COUNT(*) AS value FROM pragma_table_info('portal_roles') WHERE name='mutation_id' AND type='TEXT' AND \"notnull\"=1;")" != '1' ]]; then
  fail 'the role mutation migration adds the guarded column on upgrade'
fi
if [[ "$(upgrade_query_scalar "SELECT COUNT(*) AS value FROM portal_roles WHERE organization_id='org_ethan' AND mutation_id='';")" != '5' ]]; then
  fail 'the role mutation migration preserves existing roles with a safe default'
fi
if [[ "$(upgrade_query_scalar "SELECT COUNT(*) AS value FROM d1_migrations WHERE name IN ('0020_portal_team_rbac.sql','0023_portal_role_mutation_guard.sql');")" != '2' ]]; then
  fail 'Wrangler records both the original and additive mutation migrations'
fi
pass 'the separate role mutation migration upgrades an existing 0020 database safely'

d1_json() {
  local sql="$1"
  local output
  if ! output="$(
    cd "$repo_dir"
    "$wrangler_bin" d1 execute "$database_name" \
      --local \
      --persist-to "$persist_dir" \
      --config "$config_file" \
      --command "$sql" \
      --json 2>"$d1_error_log"
  )"; then
    cat "$d1_error_log" >&2
    return 1
  fi
  printf '%s' "$output"
}

query_scalar() {
  local sql="$1"
  local json
  json="$(d1_json "$sql")" || return 1
  printf '%s' "$json" | node -e '
    let input = "";
    process.stdin.on("data", (chunk) => input += chunk);
    process.stdin.on("end", () => {
      const batches = JSON.parse(input);
      const batch = batches.find((item) => Array.isArray(item.results) && item.results.length);
      if (!batch) process.exit(2);
      const values = Object.values(batch.results[0]);
      if (!values.length || values[0] === null || values[0] === undefined) process.exit(3);
      process.stdout.write(String(values[0]));
    });
  '
}

run_sql() {
  local label="$1"
  local sql="$2"
  if ! d1_json "$sql" >/dev/null; then
    fail "$label"
  fi
  pass "$label"
}

assert_scalar() {
  local label="$1"
  local expected="$2"
  local sql="$3"
  local actual
  if ! actual="$(query_scalar "$sql")"; then
    fail "$label"
  fi
  if [[ "$actual" != "$expected" ]]; then
    printf 'Expected: %s\nActual:   %s\n' "$expected" "$actual" >&2
    fail "$label"
  fi
  pass "$label"
}

expect_sql_failure() {
  local label="$1"
  local pattern="$2"
  local sql="$3"
  local output
  local status
  set +e
  output="$(
    cd "$repo_dir"
    "$wrangler_bin" d1 execute "$database_name" \
      --local \
      --persist-to "$persist_dir" \
      --config "$config_file" \
      --command "$sql" \
      --json 2>&1
  )"
  status=$?
  set -e
  if ((status == 0)); then
    fail "$label unexpectedly succeeded"
  fi
  if ! rg --quiet "$pattern" <<<"$output"; then
    printf '%s\n' "$output" >&2
    fail "$label failed for an unexpected reason"
  fi
  pass "$label"
}

migration_file_count="$({ find "${repo_dir}/migrations" -maxdepth 1 -type f -name '*.sql' -print; } | wc -l | tr -d '[:space:]')"
assert_scalar \
  'D1 records every migration file as applied' \
  "$migration_file_count" \
  'SELECT COUNT(*) AS value FROM d1_migrations;'

assert_scalar \
  'all seven Portal team tables exist' \
  '7' \
  "SELECT COUNT(*) AS value FROM sqlite_master WHERE type='table' AND name IN ('portal_organizations','portal_permissions','portal_roles','portal_role_permissions','portal_organization_members','portal_invitations','portal_team_audit_events');"
assert_scalar \
  'org_ethan organization seed is exact' \
  'org_ethan:ethan:active' \
  "SELECT id || ':' || partner_key || ':' || status AS value FROM portal_organizations WHERE id='org_ethan';"
assert_scalar \
  'permission seed contains the complete V1 catalog' \
  'balances.read,credentials.reveal,customers.create,customers.read,integrations.read,integrations.request_change,notifications.read,team.invite,team.manage_members,team.manage_roles,team.read,transactions.read' \
  "SELECT GROUP_CONCAT(key, ',') AS value FROM (SELECT key FROM portal_permissions ORDER BY key);"
assert_scalar \
  'org_ethan has the five default role seeds' \
  'role_ethan_admin:admin,role_ethan_developer:developer,role_ethan_operations:operations,role_ethan_owner:owner,role_ethan_viewer:viewer' \
  "SELECT GROUP_CONCAT(id || ':' || code, ',') AS value FROM (SELECT id,code FROM portal_roles WHERE organization_id='org_ethan' ORDER BY id);"
assert_scalar \
  'only the Owner seed carries the protected Owner marker' \
  '1' \
  "SELECT COUNT(*) AS value FROM portal_roles WHERE organization_id='org_ethan' AND is_owner=1 AND code='owner' AND is_system=1;"
assert_scalar \
  'no non-Owner seed carries the protected Owner marker' \
  '0' \
  "SELECT COUNT(*) AS value FROM portal_roles WHERE organization_id='org_ethan' AND code<>'owner' AND is_owner<>0;"
assert_scalar \
  'the role mutation guard column is present after all migrations' \
  '1' \
  "SELECT COUNT(*) AS value FROM pragma_table_info('portal_roles') WHERE name='mutation_id' AND type='TEXT' AND \"notnull\"=1;"
assert_scalar \
  'existing role rows receive the safe mutation guard default' \
  '5' \
  "SELECT COUNT(*) AS value FROM portal_roles WHERE organization_id='org_ethan' AND mutation_id='';"

assert_scalar \
  'Owner receives all twelve permissions' \
  'balances.read,credentials.reveal,customers.create,customers.read,integrations.read,integrations.request_change,notifications.read,team.invite,team.manage_members,team.manage_roles,team.read,transactions.read' \
  "SELECT GROUP_CONCAT(permission_key, ',') AS value FROM (SELECT permission_key FROM portal_role_permissions WHERE role_id='role_ethan_owner' ORDER BY permission_key);"
assert_scalar \
  'Admin receives every permission except credential reveal' \
  'balances.read,customers.create,customers.read,integrations.read,integrations.request_change,notifications.read,team.invite,team.manage_members,team.manage_roles,team.read,transactions.read' \
  "SELECT GROUP_CONCAT(permission_key, ',') AS value FROM (SELECT permission_key FROM portal_role_permissions WHERE role_id='role_ethan_admin' ORDER BY permission_key);"
assert_scalar \
  'Operations receives the expected business permissions' \
  'balances.read,customers.create,customers.read,notifications.read,team.read,transactions.read' \
  "SELECT GROUP_CONCAT(permission_key, ',') AS value FROM (SELECT permission_key FROM portal_role_permissions WHERE role_id='role_ethan_operations' ORDER BY permission_key);"
assert_scalar \
  'Developer receives team, integration, and notification permissions' \
  'integrations.read,integrations.request_change,notifications.read,team.read' \
  "SELECT GROUP_CONCAT(permission_key, ',') AS value FROM (SELECT permission_key FROM portal_role_permissions WHERE role_id='role_ethan_developer' ORDER BY permission_key);"
assert_scalar \
  'Viewer receives the expected read-only business permissions' \
  'balances.read,customers.read,integrations.read,notifications.read,team.read,transactions.read' \
  "SELECT GROUP_CONCAT(permission_key, ',') AS value FROM (SELECT permission_key FROM portal_role_permissions WHERE role_id='role_ethan_viewer' ORDER BY permission_key);"

assert_scalar \
  'pending invitation unique index exists' \
  '1' \
  "SELECT COUNT(*) AS value FROM sqlite_master WHERE type='index' AND name='idx_portal_invitations_pending_email';"
assert_scalar \
  'last Owner update trigger exists' \
  '1' \
  "SELECT COUNT(*) AS value FROM sqlite_master WHERE type='trigger' AND name='portal_members_last_owner_update';"
assert_scalar \
  'last Owner delete trigger exists' \
  '1' \
  "SELECT COUNT(*) AS value FROM sqlite_master WHERE type='trigger' AND name='portal_members_last_owner_delete';"
assert_scalar \
  'member role foreign key includes role and organization' \
  '1' \
  "SELECT COUNT(*) AS value FROM (SELECT id FROM pragma_foreign_key_list('portal_organization_members') WHERE \"table\"='portal_roles' GROUP BY id HAVING SUM(\"from\"='role_id' AND \"to\"='id')=1 AND SUM(\"from\"='organization_id' AND \"to\"='organization_id')=1);"
assert_scalar \
  'invitation role foreign key includes role and organization' \
  '1' \
  "SELECT COUNT(*) AS value FROM (SELECT id FROM pragma_foreign_key_list('portal_invitations') WHERE \"table\"='portal_roles' GROUP BY id HAVING SUM(\"from\"='role_id' AND \"to\"='id')=1 AND SUM(\"from\"='organization_id' AND \"to\"='organization_id')=1);"
assert_scalar \
  'invitations bind optional setup tokens through a foreign key' \
  '1' \
  "SELECT COUNT(*) AS value FROM pragma_foreign_key_list('portal_invitations') WHERE \"table\"='auth_setup_tokens' AND \"from\"='setup_token_id' AND \"to\"='id';"

fixture_time='2026-08-02T00:00:00.000Z'
run_sql \
  'isolated fixture identities and second Partner organization are created' \
  "INSERT INTO auth_users (id,email,role,status,created_at,updated_at) VALUES
    ('usr_rbac_owner','rbac-owner@example.test','partner','active','${fixture_time}','${fixture_time}'),
    ('usr_rbac_second_owner','rbac-second-owner@example.test','partner','active','${fixture_time}','${fixture_time}'),
    ('usr_rbac_member','rbac-member@example.test','partner','active','${fixture_time}','${fixture_time}'),
    ('usr_rbac_onboarding','rbac-onboarding@example.test','partner','active','${fixture_time}','${fixture_time}'),
    ('usr_rbac_expired','rbac-expired@example.test','partner','active','${fixture_time}','${fixture_time}'),
    ('usr_rbac_cross_role','rbac-cross-role@example.test','partner','active','${fixture_time}','${fixture_time}');
   INSERT INTO portal_organizations (id,partner_key,name,status,created_at,updated_at)
     VALUES ('org_other','other','Other Partner','active','${fixture_time}','${fixture_time}');
   INSERT INTO portal_roles (id,organization_id,code,name,description,is_system,is_owner,version,created_at,updated_at)
     VALUES
       ('role_other_viewer','org_other','custom_viewer','Custom Viewer','Other Partner custom viewer',0,0,1,'${fixture_time}','${fixture_time}'),
       ('role_other_owner','org_other','owner','Owner','Other Partner Owner',1,1,1,'${fixture_time}','${fixture_time}');
   INSERT INTO portal_organization_members
     (organization_id,user_id,role_id,status,version,invited_by_user_id,joined_at,created_at,updated_at)
     VALUES ('org_ethan','usr_rbac_owner','role_ethan_owner','active',1,NULL,'${fixture_time}','${fixture_time}','${fixture_time}');"
assert_scalar \
  'normalized custom role codes are accepted without Owner privileges' \
  'custom_viewer:0:0' \
  "SELECT code || ':' || is_system || ':' || is_owner AS value FROM portal_roles WHERE id='role_other_viewer';"
expect_sql_failure \
  'invalid uppercase custom role codes are rejected' \
  'CHECK constraint failed' \
  "INSERT INTO portal_roles
     (id,organization_id,code,name,description,is_system,is_owner,version,created_at,updated_at)
     VALUES ('role_other_invalid','org_other','InvalidRole','Invalid Role','Invalid custom role code',0,0,1,'${fixture_time}','${fixture_time}');"

expect_sql_failure \
  'the sole active Owner cannot be demoted' \
  'last_owner_required' \
  "UPDATE portal_organization_members SET role_id='role_ethan_admin',version=version+1,updated_at='${fixture_time}' WHERE organization_id='org_ethan' AND user_id='usr_rbac_owner';"
expect_sql_failure \
  'the sole active Owner cannot be suspended' \
  'last_owner_required' \
  "UPDATE portal_organization_members SET status='suspended',version=version+1,updated_at='${fixture_time}' WHERE organization_id='org_ethan' AND user_id='usr_rbac_owner';"
expect_sql_failure \
  'the sole active Owner cannot move to another organization' \
  'last_owner_required' \
  "UPDATE portal_organization_members SET organization_id='org_other',role_id='role_other_owner',version=version+1,updated_at='${fixture_time}' WHERE organization_id='org_ethan' AND user_id='usr_rbac_owner';"
expect_sql_failure \
  'the sole active Owner cannot be deleted' \
  'last_owner_required' \
  "DELETE FROM portal_organization_members WHERE organization_id='org_ethan' AND user_id='usr_rbac_owner';"

run_sql \
  'a second active Owner permits a safe first-Owner demotion' \
  "INSERT INTO portal_organization_members
     (organization_id,user_id,role_id,status,version,invited_by_user_id,joined_at,created_at,updated_at)
     VALUES ('org_ethan','usr_rbac_second_owner','role_ethan_owner','active',1,'usr_rbac_owner','${fixture_time}','${fixture_time}','${fixture_time}');
   UPDATE portal_organization_members SET role_id='role_ethan_admin',version=version+1,updated_at='${fixture_time}' WHERE organization_id='org_ethan' AND user_id='usr_rbac_owner';"
assert_scalar \
  'exactly one active Owner remains after the permitted demotion' \
  '1' \
  "SELECT COUNT(*) AS value FROM portal_organization_members m JOIN portal_roles r ON r.id=m.role_id AND r.organization_id=m.organization_id WHERE m.organization_id='org_ethan' AND m.status='active' AND r.is_owner=1;"
expect_sql_failure \
  'the remaining active Owner still cannot be deleted' \
  'last_owner_required' \
  "DELETE FROM portal_organization_members WHERE organization_id='org_ethan' AND user_id='usr_rbac_second_owner';"

run_sql \
  'the first pending invitation is accepted by the schema' \
  "INSERT INTO portal_invitations
     (id,organization_id,email,role_id,token_hash,status,expires_at,invited_by_user_id,version,created_at,updated_at)
     VALUES ('inv_rbac_first','org_ethan','Pending.User@example.test','role_ethan_viewer','aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa','pending','2026-08-09T00:00:00.000Z','usr_rbac_second_owner',1,'${fixture_time}','${fixture_time}');"
expect_sql_failure \
  'a case-insensitive duplicate pending invitation is rejected' \
  'UNIQUE constraint failed|idx_portal_invitations_pending_email' \
  "INSERT INTO portal_invitations
     (id,organization_id,email,role_id,token_hash,status,expires_at,invited_by_user_id,version,created_at,updated_at)
     VALUES ('inv_rbac_duplicate','org_ethan','pending.user@example.test','role_ethan_viewer','bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb','pending','2026-08-09T00:00:00.000Z','usr_rbac_second_owner',1,'${fixture_time}','${fixture_time}');"
run_sql \
  'a revoked invitation no longer blocks a fresh pending invitation' \
  "UPDATE portal_invitations SET status='revoked',revoked_by_user_id='usr_rbac_second_owner',revoked_at='${fixture_time}',version=version+1,updated_at='${fixture_time}' WHERE id='inv_rbac_first';
   INSERT INTO portal_invitations
     (id,organization_id,email,role_id,token_hash,status,expires_at,invited_by_user_id,version,created_at,updated_at)
     VALUES ('inv_rbac_reissued','org_ethan','pending.user@example.test','role_ethan_viewer','cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc','pending','2026-08-09T00:00:00.000Z','usr_rbac_second_owner',1,'${fixture_time}','${fixture_time}');"
assert_scalar \
  'only the reissued invitation remains pending' \
  '1' \
  "SELECT COUNT(*) AS value FROM portal_invitations WHERE organization_id='org_ethan' AND email='pending.user@example.test' COLLATE NOCASE AND status='pending';"

run_sql \
  'a started but expired invitation enrollment is created' \
  "INSERT INTO auth_setup_tokens (id,user_id,token_hash,expires_at,used_at,created_at)
     VALUES ('set_rbac_expired','usr_rbac_expired','eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee','2026-08-01T00:00:00.000Z',NULL,'${fixture_time}');
   INSERT INTO portal_organization_members
     (organization_id,user_id,role_id,status,version,invited_by_user_id,joined_at,created_at,updated_at)
     VALUES ('org_ethan','usr_rbac_expired','role_ethan_viewer','onboarding',1,'usr_rbac_second_owner',NULL,'${fixture_time}','${fixture_time}');
   INSERT INTO portal_invitations
     (id,organization_id,email,role_id,token_hash,setup_token_id,status,expires_at,invited_by_user_id,version,created_at,updated_at)
     VALUES ('inv_rbac_expired','org_ethan','rbac-expired@example.test','role_ethan_viewer','ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff','set_rbac_expired','pending','2026-08-01T00:00:00.000Z','usr_rbac_second_owner',1,'${fixture_time}','${fixture_time}');"
run_sql \
  'expired enrollment cleanup removes only incomplete onboarding state' \
  "UPDATE portal_invitations SET status='expired',version=version+1,updated_at='${fixture_time}'
     WHERE id='inv_rbac_expired' AND organization_id='org_ethan' AND status='pending' AND expires_at<='${fixture_time}';
   UPDATE auth_setup_tokens SET used_at='${fixture_time}'
     WHERE id='set_rbac_expired' AND used_at IS NULL
       AND EXISTS (SELECT 1 FROM portal_invitations WHERE id='inv_rbac_expired' AND organization_id='org_ethan' AND status='expired' AND updated_at='${fixture_time}');
   DELETE FROM portal_organization_members
     WHERE organization_id='org_ethan' AND status='onboarding'
       AND user_id=(SELECT user_id FROM auth_setup_tokens WHERE id='set_rbac_expired')
       AND EXISTS (SELECT 1 FROM portal_invitations WHERE id='inv_rbac_expired' AND organization_id='org_ethan' AND status='expired' AND updated_at='${fixture_time}');
   DELETE FROM auth_users
     WHERE id=(SELECT user_id FROM auth_setup_tokens WHERE id='set_rbac_expired')
       AND setup_completed_at IS NULL
       AND NOT EXISTS (SELECT 1 FROM portal_organization_members WHERE user_id=auth_users.id)
       AND EXISTS (SELECT 1 FROM portal_invitations WHERE id='inv_rbac_expired' AND organization_id='org_ethan' AND status='expired' AND updated_at='${fixture_time}');"
assert_scalar \
  'expired enrollment keeps the invitation but removes reusable identity state' \
  'expired:null:0:0:0' \
  "SELECT i.status || ':' || CASE WHEN i.setup_token_id IS NULL THEN 'null' ELSE 'set' END || ':' ||
      (SELECT COUNT(*) FROM auth_users WHERE id='usr_rbac_expired') || ':' ||
      (SELECT COUNT(*) FROM auth_setup_tokens WHERE id='set_rbac_expired') || ':' ||
      (SELECT COUNT(*) FROM portal_organization_members WHERE user_id='usr_rbac_expired') AS value
   FROM portal_invitations i WHERE i.id='inv_rbac_expired';"
run_sql \
  'an expired enrollment email can be invited again' \
  "INSERT INTO portal_invitations
     (id,organization_id,email,role_id,token_hash,status,expires_at,invited_by_user_id,version,created_at,updated_at)
     VALUES ('inv_rbac_expired_reissued','org_ethan','rbac-expired@example.test','role_ethan_viewer','9999999999999999999999999999999999999999999999999999999999999999','pending','2026-08-09T00:00:00.000Z','usr_rbac_second_owner',1,'${fixture_time}','${fixture_time}');"

expect_sql_failure \
  'a role from org_ethan cannot be assigned to an org_other member' \
  'FOREIGN KEY constraint failed' \
  "INSERT INTO portal_organization_members
     (organization_id,user_id,role_id,status,version,invited_by_user_id,joined_at,created_at,updated_at)
     VALUES ('org_other','usr_rbac_cross_role','role_ethan_viewer','active',1,NULL,'${fixture_time}','${fixture_time}','${fixture_time}');"
expect_sql_failure \
  'a role from org_ethan cannot be assigned to an org_other invitation' \
  'FOREIGN KEY constraint failed' \
  "INSERT INTO portal_invitations
     (id,organization_id,email,role_id,token_hash,status,expires_at,invited_by_user_id,version,created_at,updated_at)
     VALUES ('inv_rbac_cross_role','org_other','cross-role@example.test','role_ethan_viewer','dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd','pending','2026-08-09T00:00:00.000Z','usr_rbac_second_owner',1,'${fixture_time}','${fixture_time}');"

run_sql \
  'a normal org_ethan member can be created with an org_ethan role' \
  "INSERT INTO portal_organization_members
     (organization_id,user_id,role_id,status,version,invited_by_user_id,joined_at,created_at,updated_at)
     VALUES ('org_ethan','usr_rbac_member','role_ethan_viewer','active',1,'usr_rbac_second_owner','${fixture_time}','${fixture_time}','${fixture_time}');"
run_sql \
  'an onboarding member can exist before joined_at is assigned' \
  "INSERT INTO portal_organization_members
     (organization_id,user_id,role_id,status,version,invited_by_user_id,joined_at,created_at,updated_at)
     VALUES ('org_ethan','usr_rbac_onboarding','role_ethan_viewer','onboarding',1,'usr_rbac_second_owner',NULL,'${fixture_time}','${fixture_time}');"
assert_scalar \
  'onboarding membership retains a null joined_at' \
  'onboarding:null' \
  "SELECT status || ':' || CASE WHEN joined_at IS NULL THEN 'null' ELSE 'set' END AS value FROM portal_organization_members WHERE user_id='usr_rbac_onboarding';"
expect_sql_failure \
  'the same auth user cannot cross into a second Partner organization' \
  'UNIQUE constraint failed' \
  "INSERT INTO portal_organization_members
     (organization_id,user_id,role_id,status,version,invited_by_user_id,joined_at,created_at,updated_at)
     VALUES ('org_other','usr_rbac_member','role_other_viewer','active',1,NULL,'${fixture_time}','${fixture_time}','${fixture_time}');"

assert_source_pattern \
    'authenticated principals carry a server-resolved organization' \
    "$team_file" \
    'organizationId:[[:space:]]*string'
  assert_source_pattern \
    'Portal organization is resolved only from the authenticated user membership' \
    "$team_file" \
    '(?s)WHERE[[:space:]]+m[.]user_id=[?].{0,300}[.]bind[(]principal[.]userId[)]'
  assert_source_pattern \
    'member listing is scoped to the principal organization' \
    "$team_file" \
    '(?s)function[[:space:]]+listPortalTeamMembers.{0,2400}WHERE[[:space:]]+m[.]organization_id=[?].{0,300}[.]bind[(]principal[.]organizationId[)]'
  assert_source_pattern \
    'invitation listing is scoped to the principal organization' \
    "$team_file" \
    '(?s)function[[:space:]]+listPortalTeamInvitations.{0,1800}WHERE[[:space:]]+i[.]organization_id=[?].{0,300}[.]bind[(]principal[.]organizationId[)]'
  assert_source_pattern \
    'role listing is scoped to the principal organization' \
    "$team_file" \
    '(?s)function[[:space:]]+listPortalTeamRoles.{0,2600}WHERE[[:space:]]+r[.]organization_id=[?].{0,300}[.]bind[(]principal[.]organizationId[)]'
  assert_source_pattern \
    'invitation creation validates the role inside the principal organization' \
    "$team_file" \
    '(?s)function[[:space:]]+createPortalTeamInvitation.{0,2200}loadPortalRole[(]env,[[:space:]]*principal[.]organizationId,[[:space:]]*roleId[)]'
  assert_source_pattern \
    'invitation creation writes the principal organization' \
    "$team_file" \
    '(?s)function[[:space:]]+createPortalTeamInvitation.{0,5200}INSERT INTO portal_invitations.{0,1000}[.]bind[(][[:space:]]*invitationId,[[:space:]]*principal[.]organizationId'
  assert_source_pattern \
    'invitation revocation loads the invitation inside the principal organization' \
    "$team_file" \
    '(?s)function[[:space:]]+revokePortalTeamInvitation.{0,1800}loadPortalInvitation[(][[:space:]]*env,[[:space:]]*principal[.]organizationId,[[:space:]]*invitationId'
  assert_source_pattern \
    'expired invitation enrollment cleanup removes incomplete identities' \
    "$team_file" \
    "(?s)function[[:space:]]+expirePortalInvitationEnrollment.{0,1600}status='expired'.{0,1200}changes[(][)][[:space:]]*=[[:space:]]*1.{0,800}team[.]invitation_expired.{0,2800}DELETE FROM portal_organization_members.{0,1800}DELETE FROM auth_users"
  assert_source_pattern \
    'invitation creation cleans expired enrollment state before member conflict checks' \
    "$team_file" \
    '(?s)function[[:space:]]+createPortalTeamInvitation.{0,3600}expirePortalInvitationEnrollment[(].{0,1200}const[[:space:]]+existingMember'
  assert_source_pattern \
    'invitation setup cleans expired enrollment state' \
    "$team_file" \
    '(?s)function[[:space:]]+beginPortalInvitationEnrollment.{0,2200}expirePortalInvitationEnrollment[(]env,[[:space:]]*invitation,[[:space:]]*createdAt[)]'
  assert_source_pattern \
    'member updates load the member inside the principal organization' \
    "$team_file" \
    '(?s)function[[:space:]]+patchPortalTeamMember.{0,2600}loadPortalMember[(]env,[[:space:]]*principal[.]organizationId,[[:space:]]*memberId[)]'
  assert_source_pattern \
    'member updates constrain the write to the principal organization' \
    "$team_file" \
    '(?s)function[[:space:]]+patchPortalTeamMember.{0,6200}WHERE[[:space:]]+organization_id=[?][[:space:]]+AND[[:space:]]+user_id=[?][[:space:]]+AND[[:space:]]+version=[?].{0,700}principal[.]organizationId'
  assert_source_pattern \
    'custom role creation writes the principal organization' \
    "$team_file" \
    '(?s)function[[:space:]]+createPortalTeamRole.{0,3000}INSERT INTO portal_roles.{0,900}[.]bind[(][[:space:]]*roleId,[[:space:]]*principal[.]organizationId'
  assert_source_pattern \
    'custom role updates load the role inside the principal organization' \
    "$team_file" \
    '(?s)function[[:space:]]+patchPortalTeamRole.{0,1500}loadPortalRole[(]env,[[:space:]]*principal[.]organizationId,[[:space:]]*roleId[)]'
  assert_source_pattern \
    'custom role permission writes are bound to the winning mutation' \
    "$team_file" \
    '(?s)function[[:space:]]+patchPortalTeamRole.{0,4800}mutationId[[:space:]]*=[[:space:]]*randomId[(].{0,900}mutation_id=[?].{0,2600}DELETE FROM portal_role_permissions.{0,900}mutation_id=[?].{0,1600}INSERT INTO portal_role_permissions.{0,900}mutation_id=[?]'
  assert_source_pattern \
    'custom role deletion is constrained to the principal organization' \
    "$team_file" \
    '(?s)function[[:space:]]+deletePortalTeamRole.{0,3000}DELETE FROM portal_roles.{0,500}WHERE id=[?] AND organization_id=[?] AND version=[?].{0,300}[.]bind[(]roleId,[[:space:]]*principal[.]organizationId,[[:space:]]*current[.]version[)]'
  assert_source_pattern \
    'restricted permissions cannot be delegated by non-Owners' \
    "$team_file" \
    "(?s)function[[:space:]]+validateDelegatedPermissions.{0,600}!principal[.]isOwner.{0,200}credentials[.]reveal"
  assert_source_pattern \
    'Owner cannot be granted through an ordinary invitation' \
    "$team_file" \
    "(?s)function[[:space:]]+createPortalTeamInvitation.{0,1800}role[.]is_owner[[:space:]]*===[[:space:]]*1.{0,300}owner_transfer_required"
  assert_source_pattern \
    'members cannot modify their own role or status' \
    "$team_file" \
    "(?s)function[[:space:]]+patchPortalTeamMember.{0,2500}memberId[[:space:]]*===[[:space:]]*principal[.]userId.{0,300}cannot_modify_self"
  assert_source_pattern \
    'invitation links include the invited email without storing the raw token' \
    "$team_file" \
    '(?s)setup_url:.{0,180}portal/setup[?]email='
  assert_source_pattern \
    'invitation setup links are normalized to an absolute same-origin URL' \
    "$frontend_api_file" \
    "(?s)new URL[(]setupUrl,[[:space:]]*window[.]location[.]origin[)].{0,500}candidate[.]origin[[:space:]]*===[[:space:]]*window[.]location[.]origin.{0,500}candidate[.]pathname[[:space:]]*===[[:space:]]*'/portal/setup'"
  assert_source_pattern \
    'role deletion verifies the exact deleted row with RETURNING' \
    "$team_file" \
    '(?s)function[[:space:]]+deletePortalTeamRole.{0,4200}DELETE FROM portal_roles.{0,500}RETURNING id.{0,600}results\[1\][.]results'
  assert_source_pattern \
    'invitation enrollment has a transactional acceptance assertion' \
    "$team_file" \
    "(?s)function[[:space:]]+portalInvitationEnrollmentStatements.{0,6500}INSERT INTO portal_team_audit_events.{0,900}status='accepted'"
  assert_source_pattern \
    'Partner setup converts raw invitation tokens into auth setup tokens' \
    "$auth_file" \
    'beginPortalInvitationEnrollment[(][[:space:]]*env,[[:space:]]*setupToken[[:space:]]*[)]'
  assert_source_pattern \
    'TOTP completion appends invitation activation to the same D1 batch' \
    "$auth_file" \
    '(?s)env[.]DB[.]batch[(]\[.{0,2400}[.][.][.]invitationStatements'
  assert_source_pattern \
    'Worker resolves Portal membership from the authenticated identity' \
    "$worker_file" \
    'resolvePortalTeamPrincipal[(]env,[[:space:]]*authorization[)]'
  assert_source_pattern \
    'Worker enforces mapped permissions against the resolved Portal principal' \
    "$worker_file" \
    '(?s)requirePortalTeamPermission[(][[:space:]]*portalPrincipal,[[:space:]]*requiredPermission[[:space:]]*[)]'
  assert_source_pattern \
    'Worker maps Portal transaction visibility to the read permission' \
    "$worker_file" \
    "(?s)function[[:space:]]+portalPermissionForRequest.{0,3200}scopedPath[[:space:]]*===[[:space:]]*'/fund-transactions'.{0,900}return[[:space:]]+'transactions[.]read'"
  assert_source_pattern \
    'Worker maps sweep batch list and detail visibility to transaction read permission' \
    "$worker_file" \
    "(?s)function[[:space:]]+portalPermissionForRequest.{0,3600}scopedPath[[:space:]]*===[[:space:]]*'/sweep-batches'.{0,300}sweep-batches.{0,300}return[[:space:]]+'transactions[.]read'"
  assert_source_pattern \
    'Portal fund creation remains operator-only' \
    "$worker_file" \
    "(?s)async[[:space:]]+function[[:space:]]+createFund.{0,2600}if[[:space:]]*[(]customerInitiated[)].{0,300}'operator_only'"
  assert_source_pattern \
    'Portal manual OTC creation remains disabled' \
    "$worker_file" \
    "(?s)if[[:space:]]*[(]scopedPath[[:space:]]*===[[:space:]]*'/otc-orders'[)].{0,800}request[.]method[[:space:]]*===[[:space:]]*'POST'.{0,300}'manual_otc_disabled'"
  assert_source_pattern \
    'Fund settlement updates remain Admin-only' \
    "$worker_file" \
    "(?s)const[[:space:]]+fundMatch.{0,500}request[.]method[[:space:]]*===[[:space:]]*'PATCH'[[:space:]]*&&[[:space:]]*scope[[:space:]]*===[[:space:]]*'admin'"
  assert_source_pattern \
    'OTC settlement updates remain Admin-only' \
    "$worker_file" \
    "(?s)const[[:space:]]+otcMatch.{0,500}request[.]method[[:space:]]*===[[:space:]]*'PATCH'[[:space:]]*&&[[:space:]]*scope[[:space:]]*===[[:space:]]*'admin'"
  if rg --quiet \
    '(body|payload)[.](organizationId|organization_id|orgId|partnerKey|partner_key)' \
    "$team_file"; then
    fail 'team APIs must not trust request-supplied organization or partner keys'
  fi
  if rg --quiet \
    'searchParams[^;\n]*(organizationId|organization_id|orgId|partnerKey|partner_key)' \
    "$team_file"; then
    fail 'team APIs must not trust query-supplied organization or partner keys'
  fi
  if ! node - "$team_file" <<'NODE'
const fs = require('node:fs');
const source = fs.readFileSync(process.argv[2], 'utf8');
const requestScopeField = /['"](?:organizationId|organization_id|orgId|partnerKey|partner_key)['"]/;
const allowlists = source.matchAll(
  /rejectUnknownFields\s*\(\s*body\s*,\s*\[([\s\S]*?)\]\s*\)/g
);
let count = 0;
for (const allowlist of allowlists) {
  count += 1;
  if (requestScopeField.test(allowlist[1])) process.exit(1);
}
if (count === 0) process.exit(2);
NODE
  then
    fail 'team API body allowlists must reject organization and partner keys'
  fi
  pass 'team module does not trust request-supplied organization or partner keys'

assert_source_pattern \
  'Worker dispatches team APIs with the authenticated principal' \
  "$worker_file" \
  '(?s)(route|handle)PortalTeam[A-Za-z]*Request[(].{0,500}portalPrincipal'

wrangler_state_after="$(state_fingerprint)"
if [[ "$wrangler_state_after" != "$wrangler_state_before" ]]; then
  if ((default_state_writer_before == 1)) || default_wrangler_state_writer_active; then
    printf '%s\n' \
      'NOTE Existing .wrangler state changed while a separate default-state wrangler dev process was active.'
    pass 'RBAC check Wrangler calls remained isolated by their explicit temporary --persist-to path'
  else
    fail 'existing .wrangler state changed during isolated checks'
  fi
else
  pass 'existing .wrangler state is unchanged'
fi

printf '%s\n' 'Portal team RBAC checks passed.'
