export type ReconciliationDirection = 'deposit' | 'withdrawal' | 'core';

export type ReconciliationResolutionCode =
  | 'deposit_manual_reconciliation'
  | 'withdrawal_release_reconciliation'
  | 'await_custody_finality'
  | 'withdrawal_terminal_evidence_review'
  | 'withdrawal_settlement_review'
  | 'withdrawal_pre_execution_block'
  | 'callback_conflict_review'
  | 'manual_reconciliation_in_progress'
  | 'accounting_exception_review'
  | 'worker_queue_review'
  | 'core_integrity_review'
  | 'state_mismatch_review';

export type ReconciliationResolution = {
  resolution_code: ReconciliationResolutionCode;
  resolution_priority: 'critical' | 'high' | 'monitor';
  financial_effect:
    | 'credit_after_approval'
    | 'release_after_approval'
    | 'none_until_verified'
    | 'separately_approved_correction';
  manual_reconciliation_eligible: boolean;
};

export type ReconciliationIssueForTriage = {
  direction: ReconciliationDirection;
  custody_status: string;
  accounting_status: string;
  reason: string;
  callback_rejected?: boolean;
  callback_failed?: boolean;
  callback_completed?: boolean;
};

const WITHDRAWAL_PRE_EXECUTION_STATES = new Set(['submitted', 'approved']);
const WITHDRAWAL_IN_FLIGHT_STATES = new Set(['executing', 'submitted_to_cregis']);
const WITHDRAWAL_RELEASE_STATES = new Set(['rejected', 'failed', 'cancelled']);

function resolution(
  resolution_code: ReconciliationResolutionCode,
  resolution_priority: ReconciliationResolution['resolution_priority'],
  financial_effect: ReconciliationResolution['financial_effect'],
  manual_reconciliation_eligible = false
): ReconciliationResolution {
  return {
    resolution_code,
    resolution_priority,
    financial_effect,
    manual_reconciliation_eligible,
  };
}

export function triageReconciliationIssue(
  issue: ReconciliationIssueForTriage
): ReconciliationResolution {
  if (issue.direction === 'core') {
    return resolution('core_integrity_review', 'critical', 'separately_approved_correction');
  }

  if (issue.accounting_status === 'exception') {
    return resolution('accounting_exception_review', 'critical', 'none_until_verified');
  }

  if (issue.accounting_status === 'held') {
    return resolution('manual_reconciliation_in_progress', 'high', 'none_until_verified');
  }

  if (issue.direction === 'deposit') {
    if (issue.accounting_status === 'missing') {
      return resolution('deposit_manual_reconciliation', 'critical', 'credit_after_approval', true);
    }
    return resolution('worker_queue_review', 'monitor', 'none_until_verified');
  }

  if (issue.accounting_status !== 'missing') {
    return resolution('state_mismatch_review', 'high', 'none_until_verified');
  }

  const rejected = issue.callback_rejected === true;
  const failed = issue.callback_failed === true;
  const completed = issue.callback_completed === true;
  const releaseEvidenceIsUnambiguous = rejected !== failed && !completed;
  const finalEvidenceConflicts = completed && (rejected || failed);

  if (finalEvidenceConflicts || (rejected && failed)) {
    return resolution('callback_conflict_review', 'critical', 'none_until_verified');
  }

  if (completed || issue.custody_status === 'completed') {
    return resolution('withdrawal_settlement_review', 'critical', 'separately_approved_correction');
  }

  if (releaseEvidenceIsUnambiguous) {
    return resolution('withdrawal_release_reconciliation', 'high', 'release_after_approval', true);
  }

  if (WITHDRAWAL_RELEASE_STATES.has(issue.custody_status)) {
    return resolution('withdrawal_terminal_evidence_review', 'high', 'none_until_verified');
  }

  if (WITHDRAWAL_IN_FLIGHT_STATES.has(issue.custody_status)) {
    return resolution('await_custody_finality', 'high', 'none_until_verified');
  }

  if (WITHDRAWAL_PRE_EXECUTION_STATES.has(issue.custody_status)) {
    return resolution('withdrawal_pre_execution_block', 'high', 'none_until_verified');
  }

  return resolution('state_mismatch_review', 'high', 'none_until_verified');
}
