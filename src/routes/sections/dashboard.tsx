import { lazy, Suspense } from 'react';
import { Navigate, Outlet } from 'react-router-dom';
import DashboardLayout from 'src/layouts/dashboard';
import { LoadingScreen } from 'src/components/loading-screen';
import { paths } from 'src/routes/paths';
import { AuthGuard, RoleRouteGuard } from 'src/auth/guard';

const DashboardNotFoundPage = lazy(() => import('src/pages/dashboard/404'));
const DashboardServerErrorPage = lazy(() => import('src/pages/dashboard/500'));
const VaApplicationListPage = lazy(() => import('src/pages/dashboard/va-applications/list'));
const VaApplicationNewPage = lazy(() => import('src/pages/dashboard/va-applications/new'));
const VaApplicationDetailsPage = lazy(() => import('src/pages/dashboard/va-applications/details'));
const FinanceWorkspace = lazy(() => import('src/pages/dashboard/finance-workspace'));
const OnboardingWorkspace = lazy(() => import('src/pages/dashboard/onboarding-workspace'));
const CoreOverview = lazy(() => import('src/pages/dashboard/core-overview'));
const CryptoOperationsAdmin = lazy(() => import('src/pages/dashboard/crypto-operations'));

export const dashboardRoutes = [
  {
    path: 'dashboard',
    element: (
      <AuthGuard expectedRole="admin">
        <RoleRouteGuard roles={['admin']}>
          <DashboardLayout>
            <Suspense fallback={<LoadingScreen />}>
              <Outlet />
            </Suspense>
          </DashboardLayout>
        </RoleRouteGuard>
      </AuthGuard>
    ),
    children: [
      { element: <Navigate to={paths.dashboard.overview} replace />, index: true },
      { path: '404', element: <DashboardNotFoundPage /> },
      { path: '500', element: <DashboardServerErrorPage /> },
      { path: 'overview', element: <CoreOverview /> },
      {
        path: 'customers',
        children: [
          { element: <Navigate to={paths.dashboard.onboarding} replace />, index: true },
          { path: ':id', element: <Navigate to={paths.dashboard.onboarding} replace /> },
        ],
      },
      {
        path: 'va-applications',
        children: [
          { element: <VaApplicationListPage />, index: true },
          { path: 'new', element: <VaApplicationNewPage /> },
          { path: ':id', element: <VaApplicationDetailsPage /> },
        ],
      },
      { path: 'onboarding', element: <OnboardingWorkspace /> },
      {
        path: 'operations',
        children: [
          {
            element: <Navigate to={paths.dashboard.fundOperations.deposits} replace />,
            index: true,
          },
          { path: 'deposits', element: <FinanceWorkspace section="deposits" /> },
          { path: 'reconciliation', element: <FinanceWorkspace section="ledger" /> },
          { path: 'withdrawals', element: <FinanceWorkspace section="payouts" /> },
          {
            path: 'transfers',
            element: <Navigate to={paths.dashboard.fundOperations.transactions} replace />,
          },
          { path: 'fx', element: <FinanceWorkspace section="fx" /> },
          { path: 'otc', element: <FinanceWorkspace section="otc" /> },
          { path: 'adjustments', element: <FinanceWorkspace section="adjustments" /> },
          { path: 'approvals', element: <FinanceWorkspace section="approvals" /> },
          { path: 'balances', element: <FinanceWorkspace section="accounts" /> },
          { path: 'transactions', element: <FinanceWorkspace section="transactions" /> },
          { path: 'ledger', element: <FinanceWorkspace section="ledger" /> },
          { path: 'beneficiaries', element: <FinanceWorkspace section="beneficiaries" /> },
          { path: 'crypto-wallets', element: <CryptoOperationsAdmin /> },
        ],
      },
      { path: 'accounts', element: <FinanceWorkspace section="accounts" /> },
      { path: 'funding-channels', element: <FinanceWorkspace section="channels" /> },
      { path: 'usdt-sweeps', element: <CryptoOperationsAdmin /> },
      {
        path: 'settings',
        children: [
          {
            element: <Navigate to={paths.dashboard.settings.rates} replace />,
            index: true,
          },
          {
            path: 'fees',
            element: <Navigate to={paths.dashboard.settings.rates} replace />,
          },
          {
            path: 'api-integration',
            element: <Navigate to={paths.dashboard.settings.rates} replace />,
          },
          {
            path: 'api-security',
            element: <Navigate to={paths.dashboard.settings.rates} replace />,
          },
          { path: 'rates', element: <FinanceWorkspace section="rates" /> },
        ],
      },
      { path: 'audit-logs', element: <FinanceWorkspace section="ledger" /> },
    ],
  },
];
