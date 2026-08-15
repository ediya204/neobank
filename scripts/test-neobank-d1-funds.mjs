import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
// Wrangler 4.122 uses the next Miniflare configuration protocol. Keep this
// database-concurrency test on the stable v4 API until that protocol is public.
import { Miniflare } from 'miniflare-legacy';

const root = new URL('../', import.meta.url);
const migration = async (name) => readFile(new URL(`migrations-core/${name}`, root), 'utf8');
const baseMigrations = await Promise.all([
  migration('0001_cregis_wallets.sql'),
  migration('0002_customer_auth.sql'),
  migration('0003_cregis_wallet_deposit_gate.sql'),
]);
const fundsMigration = await migration('0004_customer_kyc_atomic_funds.sql');
const authHardeningMigration = await migration('0005_customer_auth_hardening.sql');
const goSource = await readFile(new URL('server-go/cmd/api/cregis_handlers.go', root), 'utf8');
const adminGoSource = await readFile(new URL('server-go/cmd/api/customer_admin.go', root), 'utf8');

function goSQL(name, source = goSource) {
  const match = source.match(new RegExp(name + '\\s*= `([\\s\\S]*?)`'));
  assert.ok(match, `missing Go SQL constant ${name}`);
  return match[1];
}

const reserveWithdrawalSQL = goSQL('reserveWithdrawalSQL');
const walletBalancesSQL = goSQL('walletBalancesSQL');
const reviewCustomerKYCSQL = goSQL('reviewCustomerKYCSQL', adminGoSource);
const activateCustomerOperationsSQL = goSQL('activateCustomerOperationsSQL', adminGoSource);

const mf = new Miniflare({
  modules: true,
  script: 'export default { fetch() { return new Response("ok") } }',
  d1Databases: {
    FUNDS: 'funds',
    VALID_BACKFILL: 'valid-backfill',
    INVALID_PRECISION: 'invalid-precision',
    INVALID_OVERFLOW: 'invalid-overflow',
    ADMIN_GATES: 'admin-gates',
  },
});

async function apply(db, migrations) {
  for (const sql of migrations) await execSQL(db, sql);
}

async function execSQL(db, sql) {
  for (const statement of sql
    .split(';')
    .map((value) => value.trim())
    .filter(Boolean)) {
    const executable = statement.replace(/--.*$/gm, '').trim();
    if (!executable || /^PRAGMA\s+foreign_keys\s*=\s*ON$/i.test(executable)) continue;
    await db.prepare(statement).run();
  }
}

async function seedLegacyAmount(db, amountText) {
  await apply(db, baseMigrations);
  await execSQL(
    db,
    `
    INSERT INTO customers (id, tenant_id, email, display_name, status, created_by, created_at, updated_at)
    VALUES ('customer_legacy', 'tenant_test', 'legacy@example.test', 'Legacy', 'active', 'admin', '2026-01-01', '2026-01-01');
    INSERT INTO cregis_wallets
      (id, tenant_id, customer_id, idempotency_key, chain_id, token_id, currency, address, status, created_by, created_at, updated_at)
    VALUES ('wallet_legacy', 'tenant_test', 'customer_legacy', 'wallet-key', '195',
      'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t', '195@TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t',
      'TLegacy11111111111111111111111111', 'active', 'admin', '2026-01-01', '2026-01-01');
    INSERT INTO cregis_withdrawals
      (id, tenant_id, customer_id, wallet_id, idempotency_key, third_party_id, currency, amount_text,
       from_address, to_address, status, maker_id, created_at, updated_at)
    VALUES ('withdrawal_legacy', 'tenant_test', 'customer_legacy', 'wallet_legacy', 'withdrawal-key',
      'third-party-legacy', '195@TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t', '${amountText}',
      'TLegacy11111111111111111111111111', 'TDestination11111111111111111111111',
      'rejected', 'admin', '2026-01-01', '2026-01-01');
  `
  );
}

test('0004 backfills micro-units with exact string arithmetic and fails closed', async () => {
  const valid = await mf.getD1Database('VALID_BACKFILL');
  await seedLegacyAmount(valid, '9223372036854.775807');
  await execSQL(valid, fundsMigration);
  const exact = await valid
    .prepare(
      "SELECT CAST(amount_minor AS TEXT) AS amount_minor FROM cregis_withdrawals WHERE id='withdrawal_legacy'"
    )
    .first();
  assert.equal(exact.amount_minor, '9223372036854775807');

  const invalidPrecision = await mf.getD1Database('INVALID_PRECISION');
  await seedLegacyAmount(invalidPrecision, '1.0000001');
  await assert.rejects(execSQL(invalidPrecision, fundsMigration), /CHECK constraint failed/);

  const invalidOverflow = await mf.getD1Database('INVALID_OVERFLOW');
  await seedLegacyAmount(invalidOverflow, '9223372036854.775808');
  await assert.rejects(execSQL(invalidOverflow, fundsMigration), /CHECK constraint failed/);
});

test('two concurrent idempotency keys cannot reserve more than the wallet balance', async () => {
  const db = await mf.getD1Database('FUNDS');
  await apply(db, [...baseMigrations, fundsMigration, authHardeningMigration]);
  await execSQL(
    db,
    `
    INSERT INTO customers
      (id, tenant_id, email, display_name, status, kyc_status, operations_status, created_by, created_at, updated_at)
    VALUES ('customer_active', 'tenant_test', 'active@example.test', 'Active', 'active', 'approved', 'active',
      'admin', '2026-01-01', '2026-01-01');
    INSERT INTO cregis_wallets
      (id, tenant_id, customer_id, idempotency_key, chain_id, token_id, currency, address, status,
       created_by, created_at, updated_at, custody_provider, ownership_verified_at)
    VALUES ('wallet_active', 'tenant_test', 'customer_active', 'wallet-key', '195',
      'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t', '195@TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t',
      'TActive11111111111111111111111111', 'active', 'admin', '2026-01-01', '2026-01-01',
      'cregis', '2026-01-01');
    INSERT INTO cregis_deposits
      (id, tenant_id, wallet_id, cregis_cid, chain_id, token_id, currency, address, amount_text, amount_minor,
       status, received_at, raw_sha256)
    VALUES ('deposit_10', 'tenant_test', 'wallet_active', 'cid-deposit-10', '195',
      'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t', '195@TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t',
      'TActive11111111111111111111111111', '10', 10000000, 'completed', '2026-01-01', 'hash');
  `
  );

  const reserve = (id, idempotency) =>
    db
      .prepare(reserveWithdrawalSQL)
      .bind(
        id,
        'tenant_test',
        'customer_active',
        idempotency,
        `third-${id}`,
        '195@TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t',
        '7',
        7000000,
        'TDestination11111111111111111111111',
        null,
        null,
        'admin',
        '2026-01-02',
        '2026-01-02',
        'wallet_active',
        'tenant_test',
        'customer_active',
        '195',
        'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t',
        '195@TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t',
        7000000
      )
      .run();

  await db.prepare("UPDATE customers SET kyc_status='pending' WHERE id='customer_active'").run();
  assert.equal(
    Number((await reserve('withdrawal_kyc_blocked', 'idempotency-kyc-blocked')).meta.changes),
    0
  );
  await db
    .prepare(
      "UPDATE customers SET kyc_status='approved', operations_status='pending' WHERE id='customer_active'"
    )
    .run();
  assert.equal(
    Number((await reserve('withdrawal_ops_blocked', 'idempotency-ops-blocked')).meta.changes),
    0
  );
  await db
    .prepare("UPDATE customers SET operations_status='active' WHERE id='customer_active'")
    .run();

  const [first, second] = await Promise.all([
    reserve('withdrawal_a', 'idempotency-a'),
    reserve('withdrawal_b', 'idempotency-b'),
  ]);
  assert.equal(Number(first.meta.changes) + Number(second.meta.changes), 1);

  const stored = await db
    .prepare(
      `SELECT COUNT(*) AS count, SUM(amount_minor) AS total
    FROM cregis_withdrawals WHERE wallet_id='wallet_active'`
    )
    .first();
  assert.equal(Number(stored.count), 1);
  assert.equal(Number(stored.total), 7000000);

  const balance = await db
    .prepare(walletBalancesSQL)
    .bind(
      'tenant_test',
      'wallet_active',
      'tenant_test',
      'wallet_active',
      'customer_active',
      'tenant_test',
      'wallet_active',
      'customer_active'
    )
    .first();
  assert.equal(balance.available_minor, '3000000');
  assert.equal(balance.frozen_minor, '7000000');
});

test('existing active customer can pass manual gates without credential reset', async () => {
  const db = await mf.getD1Database('ADMIN_GATES');
  await apply(db, [...baseMigrations, fundsMigration, authHardeningMigration]);
  await execSQL(
    db,
    `
    INSERT INTO customers
      (id, tenant_id, email, display_name, status, created_by, created_at, updated_at)
    VALUES ('customer_existing', 'tenant_test', 'existing@example.test', 'Existing', 'active',
      'admin', '2026-01-01', '2026-01-01');
    INSERT INTO customer_credentials
      (customer_id, password_salt, password_hash, password_iterations, totp_secret_ciphertext,
       setup_token_hash, setup_expires_at, updated_at)
    VALUES ('customer_existing', 'salt-before', 'hash-before', 210000, 'totp-before',
      NULL, NULL, '2026-01-01');
  `
  );
  const reviewedAt = '2026-08-13T10:00:00.000000000Z';
  const review = await db
    .prepare(reviewCustomerKYCSQL)
    .bind(
      'approved',
      'admin@example.test',
      reviewedAt,
      'manual review',
      reviewedAt,
      'customer_existing',
      'tenant_test'
    )
    .run();
  assert.equal(Number(review.meta.changes), 1);
  const activatedAt = '2026-08-13T10:05:00.000000000Z';
  const activation = await db
    .prepare(activateCustomerOperationsSQL)
    .bind('admin@example.test', activatedAt, activatedAt, 'customer_existing', 'tenant_test')
    .run();
  assert.equal(Number(activation.meta.changes), 1);

  const state = await db
    .prepare(
      `SELECT status, kyc_status, operations_status
    FROM customers WHERE id='customer_existing'`
    )
    .first();
  assert.deepEqual(state, {
    status: 'active',
    kyc_status: 'approved',
    operations_status: 'active',
  });
  const credential = await db
    .prepare(
      `SELECT password_salt, password_hash, totp_secret_ciphertext,
    setup_token_hash FROM customer_credentials WHERE customer_id='customer_existing'`
    )
    .first();
  assert.deepEqual(credential, {
    password_salt: 'salt-before',
    password_hash: 'hash-before',
    totp_secret_ciphertext: 'totp-before',
    setup_token_hash: null,
  });
});

test.after(async () => mf.dispose());
