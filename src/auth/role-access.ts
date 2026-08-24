import {
  IS_FULL_ADMIN_WALLET_DEPLOYMENT,
  IS_ISOLATED_WALLET_DEPLOYMENT,
} from 'src/config/deployment-mode';
import { AuthRole, AuthSessionUser } from './types';

export const ROLE_HOME: Record<AuthRole, string> = {
  admin: IS_ISOLATED_WALLET_DEPLOYMENT ? '/admin' : '/dashboard/overview',
  customer: '/portal/home',
};

export const ROLE_LOGIN: Record<AuthRole, string> = {
  admin: '/admin/login',
  customer: '/customer/login',
};

export const ROLE_SETUP: Record<AuthRole, string> = {
  admin: '/admin/setup',
  customer: '/customer/setup',
};

export function getRoleHome(role: AuthRole | null | undefined) {
  return role ? ROLE_HOME[role] : '/';
}

function isCustomerWalletPath(pathname: string) {
  return (
    pathname === '/portal' ||
    pathname === '/portal/home' ||
    pathname === '/portal/crypto-wallet' ||
    pathname.startsWith('/portal/crypto-wallet/') ||
    pathname === '/portal/virtual-accounts' ||
    pathname === '/portal/settings' ||
    pathname.startsWith('/portal/settings/') ||
    pathname === '/portal/money/beneficiaries'
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
    pathname === '/portal/money/payouts'
  );
}

export function canAccessPortalPath(user: AuthSessionUser, pathname: string) {
  if (user.role !== 'customer') return false;
  return IS_FULL_ADMIN_WALLET_DEPLOYMENT
    ? isCustomerFullPortalPath(pathname)
    : isCustomerWalletPath(pathname);
}

export function getUserHome(user: AuthSessionUser | null | undefined) {
  return user ? ROLE_HOME[user.role] : '/';
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

export function requiredRoleForPath(pathname: string, _neobankDeployment = true): AuthRole | null {
  if (pathname === '/admin' || pathname.startsWith('/admin/')) return 'admin';
  if (pathname === '/dashboard' || pathname.startsWith('/dashboard/')) return 'admin';
  if (pathname === '/customer' || pathname.startsWith('/customer/')) return 'customer';
  if (pathname === '/portal' || pathname.startsWith('/portal/')) return 'customer';
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
  if (!rawPathname || rawPathname.includes('\\') || rawPathname.includes('//')) return fallback;

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

  if (
    IS_ISOLATED_WALLET_DEPLOYMENT &&
    role === 'admin' &&
    canonicalUrl.pathname !== '/admin' &&
    canonicalUrl.pathname !== '/admin/neobank-crypto'
  ) {
    return fallback;
  }

  if (role === 'customer') {
    const sessionUser = user?.role === 'customer' ? user : null;
    if (!sessionUser || !canAccessPortalPath(sessionUser, canonicalUrl.pathname)) return fallback;
  }

  return `${canonicalUrl.pathname}${canonicalUrl.search}${canonicalUrl.hash}`;
}
