# Neobank D1 to Render PostgreSQL cutover

This runbook moves the complete isolated Neobank core from D1 to Render
PostgreSQL. It does not move only password hashes: customers, authentication,
wallets, deposits, withdrawals, and Cregis callback idempotency records must
share one transactional source of truth.

## Current verified state

As of 2026-08-15:

- Production Go health reports `database=d1`. D1 remains authoritative.
- Render database `neobank-postgres` is PostgreSQL 17 in Singapore on
  Basic-256mb with 1 GB storage.
- PostgreSQL schema `0001_neobank_core` is applied. The remote verification
  found 11 public tables, 37 indexes, 9 foreign keys, no missing leading
  foreign-key index, and zero business rows.
- Render PostgreSQL has no inbound IP rules. A new external TLS connection was
  confirmed to fail after initialization.
- A complete production D1 export was checksummed and restored into isolated
  local D1 state. The restored row counts matched production, SQLite integrity
  returned `ok`, foreign keys passed, negative wallet funds were zero, and
  migration `0005` applied successfully to the restore.
- Production D1 still does not contain the `0005` columns. No data copy to
  Render, production D1 migration, Render service switch, Cloudflare deploy,
  or real-money operation has been performed.

Treat this section as dated evidence, not a permanent statement of live state.
Recheck it before every cutover attempt.

## Runtime model

- `DATABASE_BACKEND=d1` is the safe default and rollback value.
- `DATABASE_BACKEND=postgres` selects PostgreSQL only after a verified copy.
- `DATABASE_URL` on Render must use the database's internal connection string.
- The Go application pool is capped at four connections for Basic-256mb and
  applies statement, lock, and idle-transaction timeouts.
- Do not dual-write. D1 or PostgreSQL is authoritative, never both.
- `CUSTOMER_AUTH_MAINTENANCE=true` on `neobank-web` blocks all public customer
  auth and customer-scoped API paths with `503 customer_auth_maintenance`.
  Administrator and signed Cregis callback boundaries remain separate.

## Stage 1: ship D1-compatible authentication hardening

Complete this before moving data:

1. Export production D1, record SHA-256 independently, and restore it into a
   new isolated D1 database.
2. Apply `migrations-core/0005_customer_auth_hardening.sql` to the isolated
   restore and run `PRAGMA foreign_key_check`.
3. Run the Go tests, D1 funds tests, and gateway policy check. Every changed Go
   write statement must remain in the D1 Gateway allowlist.
4. Deploy the D1 Gateway, Go API, and web Worker as separate releases while
   `DATABASE_BACKEND=d1` remains set.
5. Validate password setup, password login, transparent legacy PBKDF2 upgrade
   to Argon2id, TOTP replay rejection, challenge attempt cap, password change,
   idle expiry, absolute expiry, session revocation, and tenant scope.

Do not start the database cutover if this D1-compatible release is not already
healthy in production.

## Stage 2: final snapshot and verified copy

1. Enable `CUSTOMER_AUTH_MAINTENANCE=true` and verify the public customer API
   returns the maintenance error. Confirm no customer write path bypasses it.
2. Confirm there is no withdrawal being approved, submitted, or reconciled.
   Do not infer this from HTTP health alone.
3. Create a new complete production D1 export. Record its path, size, timestamp,
   and SHA-256. Restore it to a separate isolated D1 database and verify the
   checksum before using it as the migration source.
4. Run foreign-key and negative-funds preflights on the isolated restore.
5. Temporarily allowlist only the operator's current public IPv4 `/32` on the
   Render database. Never use `0.0.0.0/0` for the copy.
6. Set the following only in the operator's current shell. Do not paste values
   into chat, tickets, source files, or shell history:

   ```bash
   export D1_BACKUP_FILE='<complete export path>'
   export D1_BACKUP_SHA256='<independently recorded sha256>'
   export SOURCE_D1_GATEWAY_URL='<isolated restore gateway>'
   export SOURCE_D1_GATEWAY_SECRET='<isolated gateway secret>'
   export PGHOST='<Render external hostname>'
   export PGPORT='5432'
   export PGUSER='<Render database user>'
   export PGPASSWORD='<Render database password>'
   export PGDATABASE='neobank'
   export PGSSLMODE='require'
   export MIGRATION_MANIFEST_PATH='<path outside repository>'
   export ALLOW_ISOLATED_RESTORE_SOURCE='true'
   export ALLOW_EMPTY_POSTGRES_TARGET='true'
   ./scripts/neobank-postgres-cutover.sh
   ```

The command refuses an unverified backup, a manifest path inside the repository,
an unencrypted PostgreSQL connection, a missing restored source, or a nonempty
target. It copies all ten business tables in one serializable transaction and
compares row counts plus per-table SHA-256 values. Integer money and version
fields cross the D1 JSON boundary as decimal text before strict `int64` parsing,
so values above JavaScript's exact-integer range cannot silently round.

7. Store the manifest and its checksum as restricted migration evidence.
8. Remove the temporary Render `/32`, reload the networking page, and prove a
   new external connection fails. Keep only the Render private network.

## Stage 3: switch without dual writes

This stage needs a separate production approval after the manifest is reviewed.

1. Confirm Render `DATABASE_URL` resolves through the internal connection and
   `DATABASE_BACKEND` is still `d1`.
2. Change only `DATABASE_BACKEND` to `postgres` and deploy/restart the Go
   service. Do not deploy Cloudflare or apply another migration implicitly.
3. Verify `/healthz` returns `database=postgres` and assert the JSON body; HTTP
   200 alone is insufficient.
4. While customer maintenance remains enabled, run read-only acceptance for:
   customer count, wallet count, deposit/withdrawal counts by status, balance
   invariants, credential versions, active-session count, and callback
   idempotency keys.
5. Run one approved customer login and TOTP flow. Do not create a wallet or
   payout merely to test database connectivity.
6. Disable `CUSTOMER_AUTH_MAINTENANCE` only after all assertions pass.
7. Record the Render deploy ID, Cloudflare version, D1 backup checksum,
   migration-manifest checksum, database backend, and acceptance results as
   separate evidence.

## Rollback boundary

Before customer maintenance is disabled, a failed acceptance check can roll
back by setting `DATABASE_BACKEND=d1` and restarting the Go service, because no
new customer writes were admitted after the final D1 snapshot.

After maintenance is disabled and PostgreSQL accepts writes, do not simply
switch back to D1. D1 is then stale. Re-enable maintenance, stop state-changing
operations, compare both stores, and obtain a new manual migration decision.
Never attempt an automatic reverse copy or merge for wallet, withdrawal, or
callback state.

## Production acceptance checklist

- [ ] Complete D1 backup exists outside the repository.
- [ ] Backup SHA-256 was independently recorded and rechecked.
- [ ] Isolated restore passed foreign-key and negative-funds checks.
- [ ] D1 hardening migration `0005` is already live and accepted.
- [ ] PostgreSQL target was empty before copy.
- [ ] Every table row count and SHA-256 matched.
- [ ] External PostgreSQL access was removed after copy.
- [ ] Render internal connection and four-connection pool are confirmed.
- [ ] `/healthz` body says `database=postgres` after the explicit switch.
- [ ] Customer auth, session, tenant, wallet, and callback assertions passed.
- [ ] Rollback point and post-cutover write boundary were recorded.
