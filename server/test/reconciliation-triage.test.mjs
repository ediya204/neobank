import assert from 'node:assert/strict';
import test from 'node:test';
import { triageReconciliationIssue } from '../dist/src/ledger/reconciliation-triage.js';

function issue(overrides = {}) {
  return {
    direction: 'withdrawal',
    custody_status: 'submitted_to_cregis',
    accounting_status: 'missing',
    reason: 'accounting_intent_missing',
    callback_rejected: false,
    callback_failed: false,
    callback_completed: false,
    ...overrides,
  };
}

test('a completed deposit without an intent enters the guarded historical deposit flow', () => {
  assert.deepEqual(
    triageReconciliationIssue(issue({ direction: 'deposit', custody_status: 'completed' })),
    {
      resolution_code: 'deposit_manual_reconciliation',
      resolution_priority: 'critical',
      financial_effect: 'credit_after_approval',
      manual_reconciliation_eligible: true,
    }
  );
});

test('an in-flight withdrawal is held until signed final custody evidence exists', () => {
  assert.deepEqual(triageReconciliationIssue(issue()), {
    resolution_code: 'await_custody_finality',
    resolution_priority: 'high',
    financial_effect: 'none_until_verified',
    manual_reconciliation_eligible: false,
  });
});

test('one rejected or failed callback makes a withdrawal eligible for guarded release', () => {
  for (const callback of [{ callback_rejected: true }, { callback_failed: true }]) {
    assert.deepEqual(triageReconciliationIssue(issue(callback)), {
      resolution_code: 'withdrawal_release_reconciliation',
      resolution_priority: 'high',
      financial_effect: 'release_after_approval',
      manual_reconciliation_eligible: true,
    });
  }
});

test('terminal-looking custody without final evidence cannot release funds', () => {
  assert.equal(
    triageReconciliationIssue(issue({ custody_status: 'rejected' })).resolution_code,
    'withdrawal_terminal_evidence_review'
  );
});

test('completed or conflicting callbacks require a separate critical review', () => {
  assert.deepEqual(triageReconciliationIssue(issue({ callback_completed: true })), {
    resolution_code: 'withdrawal_settlement_review',
    resolution_priority: 'critical',
    financial_effect: 'separately_approved_correction',
    manual_reconciliation_eligible: false,
  });
  assert.equal(
    triageReconciliationIssue(issue({ callback_completed: true, callback_rejected: true }))
      .resolution_code,
    'callback_conflict_review'
  );
});

test('Core integrity and accounting exceptions never become automatic repair actions', () => {
  assert.equal(
    triageReconciliationIssue(issue({ direction: 'core', accounting_status: 'balance_mirror' }))
      .financial_effect,
    'separately_approved_correction'
  );
  assert.deepEqual(triageReconciliationIssue(issue({ accounting_status: 'exception' })), {
    resolution_code: 'accounting_exception_review',
    resolution_priority: 'critical',
    financial_effect: 'none_until_verified',
    manual_reconciliation_eligible: false,
  });
});
