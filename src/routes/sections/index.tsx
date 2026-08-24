import { lazy, Suspense } from 'react';
import { Navigate, useRoutes } from 'react-router-dom';
import PortalLayout from 'src/layouts/portal';
import { LoadingScreen } from 'src/components/loading-screen';
import { AuthGuard, RoleRouteGuard } from 'src/auth/guard';
import { useAuthContext } from 'src/auth/hooks';
import { getUserHome } from 'src/auth/role-access';
import { IS_ISOLATED_WALLET_DEPLOYMENT } from 'src/config/deployment-mode';
import { dashboardRoutes } from './dashboard';
import { adminAuthRoutes, customerAuthRoutes } from './auth';

const Page404 = lazy(() => import('src/pages/404'));
const CustomerHome = lazy(() => import('src/pages/portal/customer-home'));
const CustomerAccounts = lazy(() => import('src/pages/portal/customer-accounts'));
const CustomerActivity = lazy(() => import('src/pages/portal/customer-activity'));
const CustomerActionPage = lazy(() => import('src/pages/portal/customer-action'));
const CustomerSettings = lazy(() => import('src/pages/portal/customer-settings'));
const CryptoWalletPage = lazy(() => import('src/pages/portal/crypto-wallet'));
const FundsHub = lazy(() => import('src/pages/portal/funds-hub'));
const FiatDepositPage = lazy(() => import('src/pages/portal/fiat-deposit'));
const VirtualAccountsPage = lazy(() => import('src/pages/portal/virtual-accounts'));
const CryptoOperationsAdmin = lazy(() => import('src/pages/dashboard/crypto-operations'));

function HomeRedirect() {
  const { authenticated, user } = useAuthContext();
  if (!authenticated || !user) return <Page404 />;
  return <Navigate to={getUserHome(user)} replace />;
}

const isolatedWalletRoutes = [
  { path: '/', element: <HomeRedirect /> },
  {
    path: '/portal',
    element: (
      <AuthGuard expectedRole="customer">
        <RoleRouteGuard roles={['customer']}>
          <PortalLayout />
        </RoleRouteGuard>
      </AuthGuard>
    ),
    children: [
      { index: true, element: <Navigate to="/portal/home" replace /> },
      { path: 'home', element: <CryptoWalletPage /> },
      { path: 'crypto-wallet', element: <Navigate to="/portal/home" replace /> },
      { path: 'crypto-wallet/deposit', element: <CryptoWalletPage view="deposit" /> },
      { path: 'crypto-wallet/withdraw', element: <CryptoWalletPage view="withdraw" /> },
      { path: 'virtual-accounts', element: <VirtualAccountsPage /> },
      { path: 'settings', element: <CustomerSettings /> },
      { path: 'settings/allowlist', element: <CustomerActionPage action="beneficiaries" /> },
      {
        path: 'money/beneficiaries',
        element: <Navigate to="/portal/settings/allowlist" replace />,
      },
      { path: '*', element: <Page404 /> },
    ],
  },
  ...customerAuthRoutes,
  ...adminAuthRoutes,
  {
    path: '/admin',
    element: (
      <AuthGuard expectedRole="admin">
        <Suspense fallback={<LoadingScreen />}>
          <CryptoOperationsAdmin />
        </Suspense>
      </AuthGuard>
    ),
  },
  { path: '/admin/neobank-crypto', element: <Navigate to="/admin" replace /> },
  { path: '*', element: <Page404 /> },
];

const fullAdminWalletRoutes = [
  { path: '/', element: <HomeRedirect /> },
  {
    path: '/portal',
    element: (
      <AuthGuard expectedRole="customer">
        <RoleRouteGuard roles={['customer']}>
          <PortalLayout />
        </RoleRouteGuard>
      </AuthGuard>
    ),
    children: [
      { index: true, element: <Navigate to="/portal/home" replace /> },
      { path: 'home', element: <CustomerHome /> },
      { path: 'money/accounts', element: <CustomerAccounts /> },
      { path: 'money/transfers', element: <FundsHub /> },
      { path: 'money/deposit', element: <FiatDepositPage /> },
      { path: 'money/fx', element: <CustomerActionPage action="fx" /> },
      { path: 'money/otc', element: <CustomerActionPage action="otc" /> },
      {
        path: 'money/payouts',
        element: (
          <CustomerActionPage
            action="payout"
            submissionDisabledReason="银行转出服务当前暂未开放。"
          />
        ),
      },
      { path: 'settings/allowlist', element: <CustomerActionPage action="beneficiaries" /> },
      {
        path: 'money/beneficiaries',
        element: <Navigate to="/portal/settings/allowlist" replace />,
      },
      { path: 'transactions', element: <CustomerActivity /> },
      { path: 'crypto-wallet', element: <CryptoWalletPage /> },
      { path: 'crypto-wallet/deposit', element: <CryptoWalletPage view="deposit" /> },
      { path: 'crypto-wallet/withdraw', element: <CryptoWalletPage view="withdraw" /> },
      { path: 'virtual-accounts', element: <VirtualAccountsPage /> },
      { path: 'settings', element: <CustomerSettings /> },
      { path: '*', element: <Page404 /> },
    ],
  },
  ...customerAuthRoutes,
  ...adminAuthRoutes,
  {
    path: '/admin',
    element: (
      <AuthGuard expectedRole="admin">
        <Navigate to="/dashboard/overview" replace />
      </AuthGuard>
    ),
  },
  {
    path: '/admin/neobank-crypto',
    element: <Navigate to="/dashboard/operations/crypto-wallets" replace />,
  },
  ...dashboardRoutes,
  { path: '*', element: <Page404 /> },
];

export default function Router() {
  return useRoutes(IS_ISOLATED_WALLET_DEPLOYMENT ? isolatedWalletRoutes : fullAdminWalletRoutes);
}
