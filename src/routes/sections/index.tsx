import { lazy, Suspense } from 'react';
import { Navigate, useRoutes } from 'react-router-dom';
import PartnerPortalPage from 'src/pages/partner-portal';
import PortalLayout from 'src/layouts/portal';
import { LoadingScreen } from 'src/components/loading-screen';
import { AuthGuard, PermissionRouteGuard, RoleRouteGuard } from 'src/auth/guard';
import { useAuthContext } from 'src/auth/hooks';
import { getUserHome } from 'src/auth/role-access';
import { dashboardRoutes } from './dashboard';
import { authRoutes } from './auth';

const Page404 = lazy(() => import('src/pages/404'));
const CustomerHome = lazy(() => import('src/pages/portal/customer-home'));
const CustomerAccounts = lazy(() => import('src/pages/portal/customer-accounts'));
const CustomerActivity = lazy(() => import('src/pages/portal/customer-activity'));
const CustomerActionPage = lazy(() => import('src/pages/portal/customer-action'));
const CustomerSettings = lazy(() => import('src/pages/portal/customer-settings'));
const CryptoWalletPage = lazy(() => import('src/pages/portal/crypto-wallet'));

function HomeRedirect() {
  const { authenticated, user } = useAuthContext();
  if (!authenticated || !user) return <Page404 />;
  return <Navigate to={getUserHome(user)} replace />;
}

function PortalIndexRedirect() {
  const { user } = useAuthContext();
  return user ? <Navigate to={getUserHome(user)} replace /> : null;
}

export default function Router() {
  return useRoutes([
    { path: '/', element: <HomeRedirect /> },
    {
      path: '/portal',
      element: (
        <AuthGuard expectedRole="partner">
          <RoleRouteGuard roles={['partner']}>
            <PortalLayout />
          </RoleRouteGuard>
        </AuthGuard>
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
        { path: 'transactions', element: <CustomerActivity /> },
        { path: 'transfers', element: <CustomerActionPage action="transfer" /> },
        { path: 'otc', element: <CustomerActionPage action="otc" /> },
        {
          path: 'fiat-wallet/:customerId/withdraw',
          element: <Navigate to="/portal/fiat-wallet" replace />,
        },
        {
          path: 'crypto-wallet/:customerId/withdraw',
          element: <Navigate to="/portal/crypto-wallet" replace />,
        },
        { path: 'team', element: <CustomerSettings /> },
        {
          path: 'reconciliation',
          element: (
            <PermissionRouteGuard permission="customers.read">
              <PermissionRouteGuard permission="balances.read">
                <PermissionRouteGuard permission="transactions.read">
                  <Suspense fallback={<LoadingScreen />}>
                    <CustomerActivity />
                  </Suspense>
                </PermissionRouteGuard>
              </PermissionRouteGuard>
            </PermissionRouteGuard>
          ),
        },
        { path: 'settings', element: <CustomerSettings /> },
        { path: 'webhook-deliveries', element: <Navigate to="/portal/settings" replace /> },
        { path: 'api', element: <Navigate to="/portal/settings" replace /> },
        { path: 'api-guide', element: <Navigate to="/portal/settings" replace /> },
        { path: 'messages', element: <Navigate to="/portal/settings" replace /> },
        { path: 'money/accounts', element: <CustomerAccounts /> },
        { path: 'money/transfers', element: <CustomerActionPage action="transfer" /> },
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
    ...dashboardRoutes,
    { path: '/partner-api-guide', element: <Navigate to="/portal/api-guide" replace /> },
    { path: '*', element: <Page404 /> },
  ]);
}
