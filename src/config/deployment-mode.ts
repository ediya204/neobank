export const NEOBANK_DEPLOYMENT_MODE = process.env.REACT_APP_NEOBANK_DEPLOYMENT_MODE || 'full';

export const IS_ISOLATED_WALLET_DEPLOYMENT = NEOBANK_DEPLOYMENT_MODE === 'isolated-wallet';

export function isIsolatedAccessAdminPath(pathname: string) {
  return (
    IS_ISOLATED_WALLET_DEPLOYMENT &&
    (pathname === '/admin/neobank-crypto' || pathname.startsWith('/admin/neobank-crypto/'))
  );
}
