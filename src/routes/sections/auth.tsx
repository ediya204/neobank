import { lazy, Suspense } from 'react';
import { GuestGuard } from 'src/auth/guard';
import AuthClassicLayout from 'src/layouts/auth/classic';
import { SplashScreen } from 'src/components/loading-screen';

const LoginPage = lazy(() => import('src/pages/auth/jwt/login'));
const SetupPage = lazy(() => import('src/pages/auth/jwt/setup'));
const InvalidAuthEntryPage = lazy(
  () => import('src/pages/auth/jwt/invalid-entry')
);

export const authRoutes = [
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
