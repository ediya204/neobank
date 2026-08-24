import type { Customer } from './core-api';

export function completedAccountCustomers(customers: Customer[]) {
  return customers.filter(
    (customer) => customer.status === 'ACTIVE' && customer.kycStatus === 'APPROVED'
  );
}
