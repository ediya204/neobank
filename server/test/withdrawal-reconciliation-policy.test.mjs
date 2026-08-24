import assert from 'node:assert/strict';
import test from 'node:test';
import {
  parseWithdrawalReconciliationArguments,
  validateHistoricalWithdrawalRelease,
  withdrawalReconciliationApproval,
} from '../dist/src/deposit-accounting/withdrawal-reconciliation-policy.js';

const candidate = {
  withdrawal_id: 'withdrawal_historical',
  tenant_id: 'neobank',
  customer_id: 'customer_historical',
  wallet_id: 'custody_wallet',
  third_party_id: 'third-party-historical',
  currency: '195@TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t',
  amount_text: '1.25',
  fee_amount_text: '0.05',
  net_amount_text: '1.20',
  from_address: 'TXsmKpEuW7qWnXzJLGP9eDLvWPR2GRn1FS',
  to_address: 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t',
  custody_status: 'submitted_to_cregis',
  cregis_cid: '1463535767997999',
  txid: null,
  completed_at: null,
  maker_id: 'maker@example.test',
  checker_id: 'checker@example.test',
  operator_id: 'operator@example.test',
  wallet_customer_id: 'customer_historical',
  wallet_address: 'TXsmKpEuW7qWnXzJLGP9eDLvWPR2GRn1FS',
  wallet_status: 'active',
  custody_provider: 'cregis',
  ownership_verified_at: '2026-08-20T04:00:00.000Z',
  accounting_status: null,
  core_operation_id: null,
  core_transfer_id: null,
  enqueue_source: null,
  enqueued_by: null,
  reconciliation_reason: null,
  backup_sha256: null,
  restore_tested_at: null,
  callback_rejected: true,
  callback_failed: false,
  callback_completed: false,
};

const coreMatch = {
  operation_id: 'core_withdrawal',
  operation_customer_id: candidate.customer_id,
  operation_status: 'PROCESSING',
  operation_type: 'PAYOUT',
  operation_currency: 'USDT',
  operation_amount: '1.20',
  operation_fee_amount: '0.05',
  operation_source_account_id: 'account_usdt',
  operation_external_reference: null,
  custody_rail: 'CREGIS',
  custody_withdrawal_id: candidate.withdrawal_id,
  transfer_id: 'core_withdrawal',
  transfer_customer_id: candidate.customer_id,
  transfer_wallet_id: 'core_wallet',
  transfer_asset: 'USDT',
  transfer_network: 'TRON',
  transfer_direction: 'WITHDRAWAL',
  transfer_status: 'PROCESSING',
  transfer_amount: '1.25',
  transfer_fee_amount: '0.05',
  transfer_net_amount: '1.20',
  transfer_from_address: candidate.from_address,
  transfer_to_address: candidate.to_address,
  transfer_tx_hash: null,
  account_id: 'account_usdt',
  account_customer_id: candidate.customer_id,
  account_kind: 'CRYPTO_WALLET',
  account_currency: 'USDT',
  account_network: 'TRON',
  account_wallet_address: candidate.from_address,
  account_available_balance: '8.75',
  account_frozen_balance: '1.25',
  core_wallet_id: 'core_wallet',
  core_wallet_customer_id: candidate.customer_id,
  core_wallet_asset: 'USDT',
  core_wallet_network: 'TRON',
  core_wallet_address: candidate.from_address,
  core_wallet_available_balance: '8.75',
  core_wallet_frozen_balance: '1.25',
  journal_count: 0,
};

test('historical rejection without a Core reservation closes as a no-balance release', () => {
  assert.deepEqual(validateHistoricalWithdrawalRelease(candidate, []), {
    resolution: 'rejected',
    releaseMode: 'no_core_reservation',
    coreOperationId: null,
    coreTransferId: null,
  });
});

test('one exact frozen Core withdrawal may be linked for worker release', () => {
  assert.deepEqual(validateHistoricalWithdrawalRelease(candidate, [coreMatch]), {
    resolution: 'rejected',
    releaseMode: 'linked_core_reservation',
    coreOperationId: coreMatch.operation_id,
    coreTransferId: coreMatch.transfer_id,
  });
});

test('completed or conflicting provider evidence blocks release', () => {
  assert.throws(
    () => validateHistoricalWithdrawalRelease({ ...candidate, callback_completed: true }, []),
    /completed Cregis callback blocks release/
  );
  assert.throws(
    () => validateHistoricalWithdrawalRelease({ ...candidate, callback_failed: true }, []),
    /unambiguous rejected or failed/
  );
  assert.throws(
    () =>
      validateHistoricalWithdrawalRelease(candidate, [
        coreMatch,
        { ...coreMatch, operation_id: 'duplicate_core', transfer_id: 'duplicate_core' },
      ]),
    /multiple Core withdrawal matches/
  );
});

test('a mismatched Core amount or mirror balance blocks release', () => {
  assert.throws(
    () =>
      validateHistoricalWithdrawalRelease(candidate, [{ ...coreMatch, transfer_amount: '1.24' }]),
    /Core transfer amount does not match/
  );
  assert.throws(
    () =>
      validateHistoricalWithdrawalRelease(candidate, [
        { ...coreMatch, core_wallet_frozen_balance: '1.24' },
      ]),
    /balances are not mirrored/
  );
});

test('mutations require an exact identifier and explicit backup approval gates', () => {
  assert.throws(
    () => parseWithdrawalReconciliationArguments(['hold']),
    /hold requires --withdrawal-id/
  );
  assert.deepEqual(
    parseWithdrawalReconciliationArguments(['release', '--withdrawal-id', candidate.withdrawal_id]),
    { action: 'release', withdrawalId: candidate.withdrawal_id }
  );
  const env = {
    WITHDRAWAL_RECONCILIATION_APPROVED: 'true',
    WITHDRAWAL_RECONCILIATION_RELEASE_APPROVED: 'true',
    POSTGRES_RESTORE_TESTED: 'true',
    POSTGRES_BACKUP_SHA256: 'a'.repeat(64),
    WITHDRAWAL_RECONCILIATION_APPROVED_BY: 'ops@example.test',
    WITHDRAWAL_RECONCILIATION_REASON: 'Exact signed rejection reviewed and approved',
  };
  assert.deepEqual(withdrawalReconciliationApproval(env, true), {
    approvedBy: env.WITHDRAWAL_RECONCILIATION_APPROVED_BY,
    reason: env.WITHDRAWAL_RECONCILIATION_REASON,
    backupSha256: env.POSTGRES_BACKUP_SHA256,
  });
  assert.throws(
    () =>
      withdrawalReconciliationApproval(
        { ...env, WITHDRAWAL_RECONCILIATION_RELEASE_APPROVED: 'false' },
        true
      ),
    /WITHDRAWAL_RECONCILIATION_RELEASE_APPROVED=true/
  );
});
