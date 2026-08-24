import {
  IS_FULL_ADMIN_WALLET_DEPLOYMENT,
  IS_ISOLATED_WALLET_DEPLOYMENT,
  IS_NEOBANK_DEPLOYMENT,
} from 'src/config/deployment-mode';
import { AuthRole, AuthSessionUser } from './types';
import { hasPortalPermission } from './permissions';

export const ROLE_HOME: Record<AuthRole, string> = {
  admin: IS_ISOLATED_WALLET_DEPLOYMENT ? '/admin' : '/dashboard/overview',
  partner: '/portal/home',
  customer: '/portal/home',
};

export const ROLE_LOGIN: Record<AuthRole, string> = {
  admin: '/admin/login',
  partner: '/portal/login',
  customer: '/customer/login',
};

export const ROLE_SETUP: Record<AuthRole, string> = {
  admin: '/admin/setup',
  partner: '/portal/setup',
  customer: '/customer/setup',
};

export function getRoleHome(role: AuthRole | null | undefined) {
  return role ? ROLE_HOME[role] : '/';
}

function canUsePortalOverview(user: AuthSessionUser) {
  return (
    hasPortalPermission(user, 'customers.read') &&
    hasPortalPermission(user, 'balances.read') &&
    hasPortalPermission(user, 'transactions.read')
  );
}

function canUsePortalBalances(user: AuthSessionUser) {
  return hasPortalPermission(user, 'customers.read') && hasPortalPermission(user, 'balances.read');
}

function canUsePortalWallet(user: AuthSessionUser) {
  return canUsePortalBalances(user) && hasPortalPermission(user, 'transactions.read');
}

function canUsePortalTransactions(user: AuthSessionUser) {
  return (
    hasPortalPermission(user, 'customers.read') && hasPortalPermission(user, 'transactions.read')
  );
}

function isCustomerWalletPath(pathname: string) {
  return (
    pathname === '/portal' ||
    pathname === '/portal/home' ||
    pathname === '/portal/crypto-wallet' ||
    pathname.startsWith('/portal/crypto-wallet/') ||
    pathname === '/portal/virtual-accounts' ||
    pathname === '/portal/settings' ||
    pathname.startsWith('/portal/settings/')
  );
}

function isCustomerFullPortalPath(pathname: string) {
  return (
    isCustomerWalletPath(pathname) ||
    pathname === '/portal/transactions' ||
    pathname.startsWith('/portal/transactions/') ||
    pathname === '/portal/money/accounts' ||
    pathname === '/portal/money/transfers' ||
    pathname === '/portal/money/deposit' ||
    pathname === '/portal/money/fx' ||
    pathname === '/portal/money/otc' ||
    pathname === '/portal/money/payouts' ||
    pathname === '/portal/money/beneficiaries'
  );
}

export function canAccessPortalPath(user: AuthSessionUser, pathname: string) {
  if (user.role === 'customer') {
    const allowed = IS_FULL_ADMIN_WALLET_DEPLOYMENT
      ? isCustomerFullPortalPath(pathname)
      : isCustomerWalletPath(pathname);
    return allowed || pathname === '/portal/settings';
  }
  if (user.role !== 'partner') return false;
  if (
    pathname === '/portal' ||
    pathname === '/portal/settings' ||
    pathname.startsWith('/portal/settings/')
  ) {
    return true;
  }
  if (pathname === '/portal/home') return canUsePortalOverview(user);
  if (pathname === '/portal/reconciliation') return canUsePortalOverview(user);
  if (pathname === '/portal/customers' || pathname.startsWith('/portal/customers/')) {
    return hasPortalPermission(user, 'customers.read');
  }
  if (pathname === '/portal/applications' || pathname.startsWith('/portal/applications/')) {
    return (
      hasPortalPermission(user, 'customers.read') && hasPortalPermission(user, 'customers.create')
    );
  }
  if (pathname === '/portal/balances' || pathname.startsWith('/portal/balances/')) {
    return canUsePortalBalances(user);
  }
  if (
    pathname === '/portal/fiat-wallet' ||
    pathname.startsWith('/portal/fiat-wallet/') ||
    pathname === '/portal/crypto-wallet' ||
    pathname.startsWith('/portal/crypto-wallet/')
  ) {
    return canUsePortalWallet(user);
  }
  if (pathname === '/portal/transactions' || pathname.startsWith('/portal/transactions/')) {
    return canUsePortalTransactions(user);
  }
  if (pathname === '/portal/otc') {
    return canUsePortalTransactions(user);
  }
  if (pathname === '/portal/onboarding' || pathname.startsWith('/portal/money/')) {
    return canUsePortalWallet(user);
  }
  if (
    pathname === '/portal/api' ||
    pathname.startsWith('/portal/api/') ||
    pathname === '/portal/api-guide' ||
    pathname === '/portal/webhook-deliveries'
  ) {
    return hasPortalPermission(user, 'integrations.read');
  }
  if (pathname === '/portal/messages' || pathname.startsWith('/portal/messages/')) {
    return hasPortalPermission(user, 'notifications.read');
  }
  if (pathname === '/portal/team') {
    return hasPortalPermission(user, 'team.read');
  }
  return false;
}

export function getUserHome(user: AuthSessionUser | null | undefined) {
  if (!user) return '/';
  if (user.role === 'admin') return ROLE_HOME.admin;
  if (user.role === 'customer') return ROLE_HOME.customer;
  if (canUsePortalOverview(user)) return '/portal/home';
  if (canUsePortalBalances(user)) return '/portal/balances';
  if (canUsePortalTransactions(user)) return '/portal/transactions';
  if (hasPortalPermission(user, 'customers.read')) return '/portal/customers';
  if (hasPortalPermission(user, 'integrations.read')) return '/portal/api';
  if (hasPortalPermission(user, 'notifications.read')) return '/portal/messages';
  if (hasPortalPermission(user, 'team.read')) return '/portal/team';
  return '/portal/settings';
}

export function getRoleLogin(role: AuthRole) {
  return ROLE_LOGIN[role];
}

export function getRoleSetup(role: AuthRole) {
  return ROLE_SETUP[role];
}

export function isNonBlockingSessionCheckPath(pathname: string) {
  const normalizedPathname = pathname.length > 1 ? pathname.replace(/\/+$/, '') : pathname;
  return normalizedPathname === ROLE_LOGIN.admin || normalizedPathname === ROLE_LOGIN.customer;
}

export function requiredRoleForPath(
  pathname: string,
  neobankDeployment = IS_NEOBANK_DEPLOYMENT
): AuthRole | null {
  if (pathname === '/admin' || pathname.startsWith('/admin/')) return 'admin';
  if (pathname === '/dashboard' || pathname.startsWith('/dashboard/')) return 'admin';
  if (pathname === '/customer' || pathname.startsWith('/customer/')) return 'customer';
  if (neobankDeployment && (pathname === '/portal' || pathname.startsWith('/portal/'))) {
    return 'customer';
  }
  if (pathname === '/portal' || pathname.startsWith('/portal/')) return null;
  return null;
}

export function safeReturnTo(
  value: string | null | undefined,
  role: AuthRole,
  user?: AuthSessionUser | null
) {
  const fallback = user?.role === role ? getUserHome(user) : getRoleHome(role);
  if (!value || !value.startsWith('/') || value.startsWith('//')) return fallback;

  const rawPathname = value.split(/[?#]/, 1)[0];
  if (!rawPathname || rawPathname.includes('\\') || rawPathname.includes('//')) {
    return fallback;
  }

  let decodedPathname = rawPathname;
  for (let index = 0; index < 3; index += 1) {
    if (/%(?:2e|2f|5c)/i.test(decodedPathname)) return fallback;

    try {
      const nextValue = decodeURIComponent(decodedPathname);
      if (nextValue === decodedPathname) break;
      decodedPathname = nextValue;
    } catch {
      return fallback;
    }
  }

  let canonicalUrl: URL;
  try {
    canonicalUrl = new URL(value, 'https://return.local');
  } catch {
    return fallback;
  }

  if (
    canonicalUrl.origin !== 'https://return.local' ||
    canonicalUrl.pathname.includes('\\') ||
    canonicalUrl.pathname.includes('//')
  ) {
    return fallback;
  }

  const requiredRole = requiredRoleForPath(canonicalUrl.pathname);

  if (requiredRole && requiredRole !== role) return fallback;
  if (IS_ISOLATED_WALLET_DEPLOYMENT || IS_FULL_ADMIN_WALLET_DEPLOYMENT) {
    if (
      IS_ISOLATED_WALLET_DEPLOYMENT &&
      role === 'admin' &&
      canonicalUrl.pathname !== '/admin' &&
      canonicalUrl.pathname !== '/admin/neobank-crypto'
    ) {
      return fallback;
    }
    const customerPathAllowed = IS_FULL_ADMIN_WALLET_DEPLOYMENT
      ? isCustomerFullPortalPath(canonicalUrl.pathname)
      : isCustomerWalletPath(canonicalUrl.pathname);
    if (role === 'customer' && !customerPathAllowed) {
      return fallback;
    }
    if (role === 'partner') return fallback;
  }
  if (
    (role === 'partner' || role === 'customer') &&
    user &&
    !canAccessPortalPath(user, canonicalUrl.pathname)
  ) {
    return fallback;
  }
  return `${canonicalUrl.pathname}${canonicalUrl.search}${canonicalUrl.hash}`;
}
