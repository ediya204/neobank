import { requiredAdminPermissionForPath } from './admin-access';

describe('requiredAdminPermissionForPath', () => {
  it.each([
    ['/dashboard/onboarding', 'customers.review'],
    ['/dashboard/va-applications', 'customers.review'],
    ['/dashboard/va-applications/request_1', 'customers.review'],
    ['/dashboard/operations/virtual-accounts', 'customers.review'],
    ['/dashboard/customers/customer_1', 'customers.read'],
    ['/dashboard/operations', 'reports.read'],
    ['/dashboard/404', 'reports.read'],
    ['/dashboard/500', 'reports.read'],
    ['/dashboard/settings', 'settings.manage'],
  ] as const)('maps %s to %s', (path, permission) => {
    expect(requiredAdminPermissionForPath(path)).toBe(permission);
  });

  it('fails closed for unknown dashboard paths', () => {
    expect(requiredAdminPermissionForPath('/dashboard/unknown')).toBe('admin_users.manage');
  });
});
