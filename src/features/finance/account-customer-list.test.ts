import { completedAccountCustomers } from './account-customer-list';
import type { Customer } from './core-api';

function customer(id: string, status: string, kycStatus: Customer['kycStatus']): Customer {
  return {
    id,
    organizationId: 'org_neobank',
    type: 'INDIVIDUAL',
    status,
    displayName: id,
    legalName: id,
    email: `${id}@example.test`,
    countryCode: 'HK',
    kycStatus,
    accounts: [],
  };
}

describe('completedAccountCustomers', () => {
  it('只保留已激活且 KYC 已通过的客户', () => {
    const rows = [
      customer('active-approved', 'ACTIVE', 'APPROVED'),
      customer('pending-approved', 'PENDING_REVIEW', 'APPROVED'),
      customer('active-pending', 'ACTIVE', 'PENDING'),
      customer('rejected', 'REJECTED', 'REJECTED'),
    ];

    expect(completedAccountCustomers(rows).map((row) => row.id)).toEqual(['active-approved']);
  });
});
