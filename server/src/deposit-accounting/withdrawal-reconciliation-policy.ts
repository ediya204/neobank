import { Prisma } from '@prisma/client';

export const CREGIS_USDT_TRC20_CURRENCY = '195@TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t';

export type WithdrawalReconciliationAction = 'preview' | 'hold' | 'release';

export type WithdrawalReconciliationCandidate = {
  withdrawal_id: string;
  tenant_id: string;
  customer_id: string;
  wallet_id: string;
  third_party_id: string;
  currency: string;
  amount_text: string;
  fee_amount_text: string;
  net_amount_text: string;
  from_address: string;
  to_address: string;
  custody_status: string;
  cregis_cid: string | null;
  txid: string | null;
  completed_at: Date | string | null;
  maker_id: string;
  checker_id: string | null;
  operator_id: string | null;
  wallet_customer_id: string;
  wallet_address: string;
  wallet_status: string;
  custody_provider: string | null;
  ownership_verified_at: Date | string | null;
  accounting_status: string | null;
  core_operation_id: string | null;
  core_transfer_id: string | null;
  enqueue_source: string | null;
  enqueued_by: string | null;
  reconciliation_reason: string | null;
  backup_sha256: string | null;
  restore_tested_at: Date | string | null;
  callback_rejected: boolean;
  callback_failed: boolean;
  callback_completed: boolean;
};

export type WithdrawalCoreMatch = {
  operation_id: string;
  operation_customer_id: string;
  operation_status: string;
  operation_type: string;
  operation_currency: string;
  operation_amount: Prisma.Decimal | string | number;
  operation_fee_amount: Prisma.Decimal | string | number;
  operation_source_account_id: string | null;
  operation_external_reference: string | null;
  custody_rail: string | null;
  custody_withdrawal_id: string | null;
  transfer_id: string | null;
  transfer_customer_id: string | null;
  transfer_wallet_id: string | null;
  transfer_asset: string | null;
  transfer_network: string | null;
  transfer_direction: string | null;
  transfer_status: string | null;
  transfer_amount: Prisma.Decimal | string | number | null;
  transfer_fee_amount: Prisma.Decimal | string | number | null;
  transfer_net_amount: Prisma.Decimal | string | number | null;
  transfer_from_address: string | null;
  transfer_to_address: string | null;
  transfer_tx_hash: string | null;
  account_id: string | null;
  account_customer_id: string | null;
  account_kind: string | null;
  account_currency: string | null;
  account_network: string | null;
  account_wallet_address: string | null;
  account_available_balance: Prisma.Decimal | string | number | null;
  account_frozen_balance: Prisma.Decimal | string | number | null;
  core_wallet_id: string | null;
  core_wallet_customer_id: string | null;
  core_wallet_asset: string | null;
  core_wallet_network: string | null;
  core_wallet_address: string | null;
  core_wallet_available_balance: Prisma.Decimal | string | number | null;
  core_wallet_frozen_balance: Prisma.Decimal | string | number | null;
  journal_count: number | bigint | string;
};

export type WithdrawalReconciliationApproval = {
  approvedBy: string;
  reason: string;
  backupSha256: string;
};

function required(env: NodeJS.ProcessEnv, name: string) {
  const value = env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

export function parseWithdrawalReconciliationArguments(args: string[]) {
  const action = (args[0] || 'preview') as WithdrawalReconciliationAction;
  if (!['preview', 'hold', 'release'].includes(action)) {
    throw new Error('usage: withdrawal:reconcile [preview|hold|release] [--withdrawal-id ID]');
  }
  const idIndex = args.indexOf('--withdrawal-id');
  const withdrawalId = idIndex >= 0 ? args[idIndex + 1]?.trim() : undefined;
  if (idIndex >= 0 && (!withdrawalId || !/^[A-Za-z0-9_-]{1,128}$/.test(withdrawalId))) {
    throw new Error('--withdrawal-id must be one exact safe identifier');
  }
  if (action !== 'preview' && !withdrawalId) {
    throw new Error(`${action} requires --withdrawal-id`);
  }
  return { action, withdrawalId };
}

export function withdrawalReconciliationApproval(
  env: NodeJS.ProcessEnv,
  requireReleaseApproval = false
): WithdrawalReconciliationApproval {
  if (env.WITHDRAWAL_RECONCILIATION_APPROVED !== 'true') {
    throw new Error('WITHDRAWAL_RECONCILIATION_APPROVED=true is required');
  }
  if (env.POSTGRES_RESTORE_TESTED !== 'true') {
    throw new Error('POSTGRES_RESTORE_TESTED=true is required');
  }
  if (requireReleaseApproval && env.WITHDRAWAL_RECONCILIATION_RELEASE_APPROVED !== 'true') {
    throw new Error('WITHDRAWAL_RECONCILIATION_RELEASE_APPROVED=true is required');
  }
  const backupSha256 = required(env, 'POSTGRES_BACKUP_SHA256').toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(backupSha256)) {
    throw new Error('POSTGRES_BACKUP_SHA256 must be a SHA-256 checksum');
  }
  const approvedBy = required(env, 'WITHDRAWAL_RECONCILIATION_APPROVED_BY');
  const reason = required(env, 'WITHDRAWAL_RECONCILIATION_REASON');
  if (approvedBy.length < 3 || reason.length < 10) {
    throw new Error('reconciliation approval identity or reason is too short');
  }
  return { approvedBy, reason, backupSha256 };
}

export function withdrawalTerminalResolution(candidate: WithdrawalReconciliationCandidate) {
  if (candidate.callback_completed) {
    throw new Error('completed Cregis callback blocks release');
  }
  if (candidate.callback_rejected === candidate.callback_failed) {
    throw new Error('one unambiguous rejected or failed Cregis callback is required');
  }
  return candidate.callback_rejected ? ('rejected' as const) : ('failed' as const);
}

function decimal(value: Prisma.Decimal | string | number | null, name: string) {
  if (value === null) throw new Error(`${name} is missing`);
  try {
    return new Prisma.Decimal(value);
  } catch {
    throw new Error(`${name} is invalid`);
  }
}

function requireDecimalEqual(
  actual: Prisma.Decimal | string | number | null,
  expected: string,
  name: string
) {
  if (!decimal(actual, name).equals(new Prisma.Decimal(expected))) {
    throw new Error(`${name} does not match the custody withdrawal`);
  }
}

function validateCoreMatch(
  candidate: WithdrawalReconciliationCandidate,
  match: WithdrawalCoreMatch
) {
  if (
    !match.transfer_id ||
    match.operation_id !== match.transfer_id ||
    match.operation_customer_id !== candidate.customer_id ||
    match.transfer_customer_id !== candidate.customer_id ||
    match.operation_type !== 'PAYOUT' ||
    match.operation_currency !== 'USDT' ||
    match.transfer_asset !== 'USDT' ||
    match.transfer_network !== 'TRON' ||
    match.transfer_direction !== 'WITHDRAWAL' ||
    match.custody_rail !== 'CREGIS' ||
    match.custody_withdrawal_id !== candidate.withdrawal_id
  ) {
    throw new Error('Core withdrawal identity does not match custody evidence');
  }
  if (
    match.operation_status !== match.transfer_status ||
    !['SUBMITTED', 'PROCESSING'].includes(match.operation_status)
  ) {
    throw new Error('Core withdrawal is not in a releasable state');
  }
  if (match.operation_external_reference || match.transfer_tx_hash) {
    throw new Error('Core transaction evidence blocks release');
  }
  if (Number(match.journal_count) !== 0) {
    throw new Error('an existing Core journal blocks release');
  }
  requireDecimalEqual(match.operation_amount, candidate.net_amount_text, 'Core operation amount');
  requireDecimalEqual(match.operation_fee_amount, candidate.fee_amount_text, 'Core operation fee');
  requireDecimalEqual(match.transfer_amount, candidate.amount_text, 'Core transfer amount');
  requireDecimalEqual(match.transfer_fee_amount, candidate.fee_amount_text, 'Core transfer fee');
  requireDecimalEqual(match.transfer_net_amount, candidate.net_amount_text, 'Core transfer net');
  if (
    match.transfer_from_address !== candidate.from_address ||
    match.transfer_to_address !== candidate.to_address
  ) {
    throw new Error('Core transfer address does not match custody evidence');
  }
  if (
    !match.account_id ||
    match.operation_source_account_id !== match.account_id ||
    match.account_customer_id !== candidate.customer_id ||
    match.account_kind !== 'CRYPTO_WALLET' ||
    match.account_currency !== 'USDT' ||
    match.account_network !== 'TRON' ||
    match.account_wallet_address !== candidate.wallet_address ||
    !match.core_wallet_id ||
    match.transfer_wallet_id !== match.core_wallet_id ||
    match.core_wallet_customer_id !== candidate.customer_id ||
    match.core_wallet_asset !== 'USDT' ||
    match.core_wallet_network !== 'TRON' ||
    match.core_wallet_address !== candidate.wallet_address
  ) {
    throw new Error('Core account or wallet binding does not match custody evidence');
  }
  const accountAvailable = decimal(
    match.account_available_balance,
    'Core account available balance'
  );
  const accountFrozen = decimal(match.account_frozen_balance, 'Core account frozen balance');
  const walletAvailable = decimal(
    match.core_wallet_available_balance,
    'Core wallet available balance'
  );
  const walletFrozen = decimal(match.core_wallet_frozen_balance, 'Core wallet frozen balance');
  const total = new Prisma.Decimal(candidate.amount_text);
  if (!accountAvailable.equals(walletAvailable) || !accountFrozen.equals(walletFrozen)) {
    throw new Error('Core Account and CryptoWallet balances are not mirrored');
  }
  if (accountFrozen.lessThan(total)) {
    throw new Error('Core frozen balance is insufficient for the exact release');
  }
}

export function validateHistoricalWithdrawalRelease(
  candidate: WithdrawalReconciliationCandidate,
  coreMatches: WithdrawalCoreMatch[]
) {
  const resolution = withdrawalTerminalResolution(candidate);
  if (
    !candidate.cregis_cid ||
    candidate.txid ||
    candidate.completed_at ||
    candidate.currency !== CREGIS_USDT_TRC20_CURRENCY ||
    candidate.wallet_customer_id !== candidate.customer_id ||
    candidate.custody_provider !== 'cregis' ||
    !candidate.ownership_verified_at ||
    candidate.wallet_address !== candidate.from_address
  ) {
    throw new Error('custody, wallet, or chain evidence is incomplete');
  }
  if (!['exception', 'submitted_to_cregis', resolution].includes(candidate.custody_status)) {
    throw new Error('custody withdrawal is not in a reconcilable terminal state');
  }
  if (coreMatches.length > 1) {
    throw new Error('multiple Core withdrawal matches require exception review');
  }
  if (coreMatches.length === 1) validateCoreMatch(candidate, coreMatches[0]);
  return {
    resolution,
    releaseMode:
      coreMatches.length === 1
        ? ('linked_core_reservation' as const)
        : ('no_core_reservation' as const),
    coreOperationId: coreMatches[0]?.operation_id || null,
    coreTransferId: coreMatches[0]?.transfer_id || null,
  };
}
