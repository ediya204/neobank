import { lazy, Suspense } from 'react';
import { Navigate, useLocation, useParams, useRoutes } from 'react-router-dom';
import PartnerPortalPage from 'src/pages/partner-portal';
import PortalLayout from 'src/layouts/portal';
import { LoadingScreen, SplashScreen } from 'src/components/loading-screen';
import { AuthGuard, PermissionRouteGuard, RoleRouteGuard } from 'src/auth/guard';
import { useAuthContext } from 'src/auth/hooks';
import { getUserHome } from 'src/auth/role-access';
import { PortalPermission } from 'src/auth/types';
import {
  IS_FULL_ADMIN_WALLET_DEPLOYMENT,
  IS_ISOLATED_WALLET_DEPLOYMENT,
} from 'src/config/deployment-mode';
import { dashboardRoutes } from './dashboard';
import { adminAuthRoutes, authRoutes, customerAuthRoutes } from './auth';

const Page404 = lazy(() => import('src/pages/404'));
const CustomerHome = lazy(() => import('src/pages/portal/customer-home'));
const CustomerAccounts = lazy(() => import('src/pages/portal/customer-accounts'));
const CustomerActivity = lazy(() => import('src/pages/portal/customer-activity'));
const CustomerActionPage = lazy(() => import('src/pages/portal/customer-action'));
const PortalSettings = lazy(() => import('src/pages/portal-settings'));
const CustomerSettings = lazy(() => import('src/pages/portal/customer-settings'));
const PortalTeam = lazy(() => import('src/pages/portal-team'));
const PortalMessages = lazy(() => import('src/pages/portal-messages'));
const PortalWebhookDeliveries = lazy(() => import('src/pages/portal-webhook-deliveries'));
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

function PortalIndexRedirect() {
  const { user } = useAuthContext();
  return user ? <Navigate to={getUserHome(user)} replace /> : null;
}

function PortalSettingsEntry() {
  const { user } = useAuthContext();
  return user?.role === 'customer' ? <CustomerSettings /> : <PortalSettings />;
}

function FullPortalAuthBoundary({ children }: { children: React.ReactNode }) {
  const location = useLocation();
  const { authenticated, loading } = useAuthContext();

  if (loading) return <SplashScreen />;
  if (!authenticated) {
    const returnTo = `${location.pathname}${location.search}`;
    return (
      <Navigate to={`/portal/access?${new URLSearchParams({ returnTo }).toString()}`} replace />
    );
  }
  return <>{children}</>;
}

function PortalMessagesRoute() {
  const { messageId } = useParams();
  return <PortalMessages selectedId={messageId} />;
}

function permissionRoute(permission: PortalPermission, element: React.ReactNode) {
  return <PermissionRouteGuard permission={permission}>{element}</PermissionRouteGuard>;
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
      {
        path: 'money/fx',
        element: (
          <CustomerActionPage
            action="fx"
            submissionDisabledReason="当前版本仅展示账户与历史记录，客户主动换汇暂未开放。"
          />
        ),
      },
      {
        path: 'money/otc',
        element: (
          <CustomerActionPage
            action="otc"
            submissionDisabledReason="当前版本的 OTC 由已清算法币自动生成，客户暂不能手动创建订单。"
          />
        ),
      },
      {
        path: 'money/payouts',
        element: (
          <CustomerActionPage
            action="payout"
            submissionDisabledReason="当前版本暂未开放客户法币转出申请。"
          />
        ),
      },
      {
        path: 'money/beneficiaries',
        element: (
          <CustomerActionPage
            action="beneficiaries"
            submissionDisabledReason="当前版本的收款人资料仅供查看，新增和修改暂未开放。"
          />
        ),
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

const fullApplicationRoutes = [
  { path: '/', element: <HomeRedirect /> },
  {
    path: '/portal',
    element: (
      <FullPortalAuthBoundary>
        <RoleRouteGuard roles={['partner', 'customer']}>
          <PortalLayout />
        </RoleRouteGuard>
      </FullPortalAuthBoundary>
    ),
    children: [
      { index: true, element: <PortalIndexRedirect /> },
      { path: 'home', element: <CustomerHome /> },
      { path: 'customers', element: <Navigate to="/portal/home" replace /> },
      { path: 'applications', element: <Navigate to="/portal/money/accounts" replace /> },
      { path: 'balances', element: <CustomerAccounts /> },
      { path: 'fiat-wallet', element: <CustomerAccounts /> },
      { path: 'crypto-wallet', element: <CryptoWalletPage /> },
      { path: 'crypto-wallet/deposit', element: <CryptoWalletPage view="deposit" /> },
      { path: 'crypto-wallet/withdraw', element: <CryptoWalletPage view="withdraw" /> },
      { path: 'virtual-accounts', element: <VirtualAccountsPage /> },
      { path: 'transactions', element: <CustomerActivity /> },
      { path: 'transfers', element: <Navigate to="/portal/money/transfers" replace /> },
      { path: 'otc', element: <CustomerActionPage action="otc" /> },
      {
        path: 'fiat-wallet/:customerId/withdraw',
        element: <Navigate to="/portal/fiat-wallet" replace />,
      },
      {
        path: 'crypto-wallet/:customerId/withdraw',
        element: <Navigate to="/portal/crypto-wallet" replace />,
      },
      {
        path: 'team',
        element: permissionRoute('team.read', <PortalTeam />),
      },
      {
        path: 'reconciliation',
        element: permissionRoute(
          'customers.read',
          permissionRoute(
            'balances.read',
            permissionRoute(
              'transactions.read',
              <Suspense fallback={<LoadingScreen />}>
                <CustomerActivity />
              </Suspense>
            )
          )
        ),
      },
      { path: 'settings', element: <PortalSettingsEntry /> },
      {
        path: 'webhook-deliveries',
        element: permissionRoute('integrations.read', <PortalWebhookDeliveries />),
      },
      {
        path: 'api',
        element: <Navigate to="/portal/settings" replace />,
      },
      {
        path: 'api-guide',
        element: <Navigate to="/portal/settings" replace />,
      },
      {
        path: 'messages',
        element: permissionRoute('notifications.read', <PortalMessages />),
      },
      {
        path: 'messages/:messageId',
        element: permissionRoute('notifications.read', <PortalMessagesRoute />),
      },
      { path: 'money/accounts', element: <CustomerAccounts /> },
      { path: 'money/transfers', element: <FundsHub /> },
      { path: 'money/deposit', element: <FiatDepositPage /> },
      {
        path: 'money/internal-transfer',
        element: <Navigate to="/portal/money/transfers" replace />,
      },
      { path: 'money/fx', element: <CustomerActionPage action="fx" /> },
      { path: 'money/otc', element: <CustomerActionPage action="otc" /> },
      { path: 'money/payouts', element: <CustomerActionPage action="payout" /> },
      { path: 'money/beneficiaries', element: <CustomerActionPage action="beneficiaries" /> },
      { path: 'onboarding', element: <Navigate to="/portal/money/accounts" replace /> },
      { path: ':view/:customerId/:action', element: <PartnerPortalPage /> },
      { path: ':view/:customerId?', element: <PartnerPortalPage /> },
    ],
  },
  ...authRoutes,
  {
    path: '/admin/neobank-crypto',
    element: (
      <AuthGuard expectedRole="admin">
        <RoleRouteGuard roles={['admin']}>
          <Suspense fallback={<LoadingScreen />}>
            <CryptoOperationsAdmin />
          </Suspense>
        </RoleRouteGuard>
      </AuthGuard>
    ),
  },
  ...dashboardRoutes,
  { path: '/partner-api-guide', element: <Navigate to="/portal/api-guide" replace /> },
  { path: '*', element: <Page404 /> },
];

export default function Router() {
  let routes = fullApplicationRoutes;
  if (IS_ISOLATED_WALLET_DEPLOYMENT) routes = isolatedWalletRoutes;
  if (IS_FULL_ADMIN_WALLET_DEPLOYMENT) routes = fullAdminWalletRoutes;
  return useRoutes(routes);
}
