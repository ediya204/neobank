import { AdminPermission } from './types';

export function requiredAdminPermissionForPath(pathname: string): AdminPermission {
  if (
    pathname === '/dashboard' ||
    pathname === '/dashboard/operations' ||
    pathname === '/dashboard/404' ||
    pathname === '/dashboard/500' ||
    pathname.startsWith('/dashboard/overview')
  ) {
    return 'reports.read';
  }
  if (pathname.startsWith('/dashboard/admin-users')) return 'admin_users.manage';
  if (pathname.startsWith('/dashboard/onboarding')) return 'customers.review';
  if (pathname.startsWith('/dashboard/va-applications')) return 'customers.review';
  if (pathname.startsWith('/dashboard/operations/virtual-accounts')) {
    return 'customers.review';
  }
  if (pathname.startsWith('/dashboard/customers')) return 'customers.read';
  if (pathname.startsWith('/dashboard/accounts')) return 'funds.read';
  if (
    pathname.startsWith('/dashboard/operations/reconciliation') ||
    pathname.startsWith('/dashboard/operations/transactions') ||
    pathname.startsWith('/dashboard/operations/ledger')
  ) {
    return 'reports.read';
  }
  if (
    pathname === '/dashboard/settings' ||
    pathname.startsWith('/dashboard/funding-channels') ||
    pathname.startsWith('/dashboard/settings')
  ) {
    return 'settings.manage';
  }
  if (
    pathname.startsWith('/dashboard/operations/deposits') ||
    pathname.startsWith('/dashboard/operations/withdrawals') ||
    pathname.startsWith('/dashboard/operations/crypto-wallets') ||
    pathname.startsWith('/dashboard/operations/adjustments') ||
    pathname.startsWith('/dashboard/operations/fx') ||
    pathname.startsWith('/dashboard/operations/otc') ||
    pathname.startsWith('/dashboard/operations/beneficiaries') ||
    pathname.startsWith('/dashboard/usdt-sweeps')
  ) {
    return 'funds.manage';
  }
  return 'admin_users.manage';
}
