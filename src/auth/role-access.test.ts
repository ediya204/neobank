import { isNonBlockingSessionCheckPath, requiredRoleForPath } from './role-access';

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

describe('isNonBlockingSessionCheckPath', () => {
  it.each(['/admin/login', '/admin/login/', '/customer/login', '/customer/login/'])(
    'renders the %s entry while its session check runs in the background',
    (pathname) => {
      expect(isNonBlockingSessionCheckPath(pathname)).toBe(true);
    }
  );

  it.each(['/admin', '/portal/home', '/portal/login', '/customer/setup'])(
    'keeps %s behind the normal session loading boundary',
    (pathname) => {
      expect(isNonBlockingSessionCheckPath(pathname)).toBe(false);
    }
  );
});
