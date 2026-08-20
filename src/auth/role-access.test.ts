import { requiredRoleForPath } from './role-access';

describe('requiredRoleForPath', () => {
  it.each([
    ['/admin/login', 'admin'],
    ['/dashboard/overview', 'admin'],
    ['/customer/login', 'customer'],
    ['/portal/home', 'customer'],
  ] as const)('selects the Neobank %s workspace session', (pathname, role) => {
    expect(requiredRoleForPath(pathname, true)).toBe(role);
  });

  it('keeps the legacy Partner Portal role-neutral outside the Neobank profile', () => {
    expect(requiredRoleForPath('/portal/home', false)).toBeNull();
  });
});
