import assert from 'node:assert/strict';
import test from 'node:test';
import { CustomersService } from '../dist/src/customers/customers.service.js';

const baseCustomer = {
  id: 'customer_test',
  organizationId: 'org_test',
  creatorId: 'maker_test',
  status: 'PENDING_REVIEW',
  kycStatus: 'PENDING',
};

const admin = {
  id: 'admin_test',
  organizationId: 'org_test',
  active: true,
  role: 'ADMIN',
};

test('manual KYC approval does not activate a customer or create wallets', async () => {
  let updateData;
  let walletWrites = 0;
  const database = {
    customer: {
      findUnique: async () => baseCustomer,
      updateMany: async ({ data }) => {
        updateData = data;
        return { count: 1 };
      },
      findUniqueOrThrow: async () => ({ ...baseCustomer, ...updateData, accounts: [] }),
    },
    user: { findUnique: async () => admin },
    account: { upsert: async () => { walletWrites += 1; } },
  };
  const service = new CustomersService(database);
  const result = await service.reviewKyc('customer_test', 'admin_test', 'APPROVE', 'manual review');

  assert.equal(result.status, 'PENDING_REVIEW');
  assert.equal(result.kycStatus, 'APPROVED');
  assert.equal(walletWrites, 0);
});

test('operations approval is blocked until KYC is approved', async () => {
  let walletWrites = 0;
  const transaction = {
    customer: { findUnique: async () => baseCustomer },
    user: { findUnique: async () => admin },
    account: { upsert: async () => { walletWrites += 1; } },
  };
  const service = new CustomersService({
    $transaction: async (operation) => operation(transaction),
  });

  await assert.rejects(
    service.approve('customer_test', 'admin_test', 'operations review'),
    /kyc_approval_required/
  );
  assert.equal(walletWrites, 0);
});
