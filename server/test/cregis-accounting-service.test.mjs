import assert from 'node:assert/strict';
import test from 'node:test';
import { CregisAccountingService } from '../dist/src/deposit-accounting/cregis-accounting.service.js';

test('direct accounting is fail-closed unless explicitly enabled', async () => {
  const previous = process.env.CREGIS_DIRECT_ACCOUNTING_ENABLED;
  delete process.env.CREGIS_DIRECT_ACCOUNTING_ENABLED;
  try {
    const service = new CregisAccountingService({}, {});
    await assert.rejects(
      () => service.postDeposit('deposit_test'),
      (error) => error.status === 503
    );
  } finally {
    if (previous === undefined) delete process.env.CREGIS_DIRECT_ACCOUNTING_ENABLED;
    else process.env.CREGIS_DIRECT_ACCOUNTING_ENABLED = previous;
  }
});

test('direct deposit posting returns posted and permanent exception outcomes', async () => {
  const previous = process.env.CREGIS_DIRECT_ACCOUNTING_ENABLED;
  process.env.CREGIS_DIRECT_ACCOUNTING_ENABLED = 'true';
  try {
    for (const status of ['posted', 'exception']) {
      const service = new CregisAccountingService(
        {
          processDirect: async () => ({
            status,
            retryable: false,
            idempotent: status === 'posted',
          }),
        },
        {}
      );
      const result = await service.postDeposit('deposit_test');
      assert.equal(result.status, status);
    }
  } finally {
    if (previous === undefined) delete process.env.CREGIS_DIRECT_ACCOUNTING_ENABLED;
    else process.env.CREGIS_DIRECT_ACCOUNTING_ENABLED = previous;
  }
});

test('direct accounting asks the caller to retry an uncommitted financial result', async () => {
  const previous = process.env.CREGIS_DIRECT_ACCOUNTING_ENABLED;
  process.env.CREGIS_DIRECT_ACCOUNTING_ENABLED = 'true';
  try {
    const service = new CregisAccountingService(
      { processDirect: async () => ({ status: 'pending', retryable: true, idempotent: false }) },
      {}
    );
    await assert.rejects(
      () => service.postDeposit('deposit_test'),
      (error) => error.status === 503
    );
  } finally {
    if (previous === undefined) delete process.env.CREGIS_DIRECT_ACCOUNTING_ENABLED;
    else process.env.CREGIS_DIRECT_ACCOUNTING_ENABLED = previous;
  }
});

test('direct withdrawal action exposes only the stored final accounting state', async () => {
  const previous = process.env.CREGIS_DIRECT_ACCOUNTING_ENABLED;
  process.env.CREGIS_DIRECT_ACCOUNTING_ENABLED = 'true';
  try {
    let observed;
    const service = new CregisAccountingService(
      {},
      {
        processDirect: async (id, action) => {
          observed = { id, action };
          return { status: 'released', retryable: false, idempotent: true };
        },
      }
    );
    const result = await service.advanceWithdrawal('withdrawal_test', 'release');
    assert.deepEqual(observed, { id: 'withdrawal_test', action: 'release' });
    assert.deepEqual(result, {
      id: 'withdrawal_test',
      action: 'release',
      status: 'released',
      idempotent: true,
    });
  } finally {
    if (previous === undefined) delete process.env.CREGIS_DIRECT_ACCOUNTING_ENABLED;
    else process.env.CREGIS_DIRECT_ACCOUNTING_ENABLED = previous;
  }
});
