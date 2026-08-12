import { lazy, Suspense } from 'react';
import { GuestGuard } from 'src/auth/guard';
import AuthClassicLayout from 'src/layouts/auth/classic';
import { SplashScreen } from 'src/components/loading-screen';

const LoginPage = lazy(() => import('src/pages/auth/jwt/login'));
const SetupPage = lazy(() => import('src/pages/auth/jwt/setup'));
const RegisterPage = lazy(() => import('src/pages/auth/jwt/register'));
const PortalRoleEntryPage = lazy(() => import('src/pages/auth/portal-role-entry'));
const InvalidAuthEntryPage = lazy(() => import('src/pages/auth/jwt/invalid-entry'));

const adminAuthRoutes = [
  {
    path: 'admin/login',
    element: (
      <Suspense fallback={<SplashScreen />}>
        <GuestGuard>
          <AuthClassicLayout workspaceRole="admin">
            <LoginPage expectedRole="admin" />
          </AuthClassicLayout>
        </GuestGuard>
      </Suspense>
    ),
  },
  {
    path: 'admin/setup',
    element: (
      <Suspense fallback={<SplashScreen />}>
        <AuthClassicLayout workspaceRole="admin">
          <SetupPage expectedRole="admin" />
        </AuthClassicLayout>
      </Suspense>
    ),
  },
];

export const customerAuthRoutes = [
  {
    path: 'customer/login',
    element: (
      <Suspense fallback={<SplashScreen />}>
        <GuestGuard>
          <AuthClassicLayout workspaceRole="partner">
            <LoginPage expectedRole="customer" />
          </AuthClassicLayout>
        </GuestGuard>
      </Suspense>
    ),
  },
  {
    path: 'customer/setup',
    element: (
      <Suspense fallback={<SplashScreen />}>
        <AuthClassicLayout workspaceRole="partner">
          <SetupPage expectedRole="customer" />
        </AuthClassicLayout>
      </Suspense>
    ),
  },
];

const partnerAuthRoutes = [
  {
    path: 'portal/login',
    element: (
      <Suspense fallback={<SplashScreen />}>
        <GuestGuard>
          <AuthClassicLayout workspaceRole="partner">
            <LoginPage expectedRole="partner" />
          </AuthClassicLayout>
        </GuestGuard>
      </Suspense>
    ),
  },
  {
    path: 'portal/setup',
    element: (
      <Suspense fallback={<SplashScreen />}>
        <AuthClassicLayout workspaceRole="partner">
          <SetupPage expectedRole="partner" />
        </AuthClassicLayout>
      </Suspense>
    ),
  },
  {
    path: 'portal/register',
    element: (
      <Suspense fallback={<SplashScreen />}>
        <GuestGuard>
          <AuthClassicLayout workspaceRole="partner">
            <RegisterPage />
          </AuthClassicLayout>
        </GuestGuard>
      </Suspense>
    ),
  },
  {
    path: 'portal/access',
    element: (
      <Suspense fallback={<SplashScreen />}>
        <AuthClassicLayout workspaceRole="partner">
          <PortalRoleEntryPage />
        </AuthClassicLayout>
      </Suspense>
    ),
  },
];

export const authRoutes = [
  ...adminAuthRoutes,
  ...customerAuthRoutes,
  ...partnerAuthRoutes,
  {
    path: 'auth/*',
    element: (
      <Suspense fallback={<SplashScreen />}>
        <AuthClassicLayout>
          <InvalidAuthEntryPage />
        </AuthClassicLayout>
      </Suspense>
    ),
  },
];
