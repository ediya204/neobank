import { Navigate, useLocation } from 'react-router-dom';
import { SplashScreen } from 'src/components/loading-screen';
import { getRoleLogin } from 'src/auth/role-access';
import { AuthRole } from 'src/auth/types';
import { useAuthContext } from '../hooks';

type Props = {
  expectedRole: AuthRole;
  children: React.ReactNode;
};

export default function AuthGuard({ expectedRole, children }: Props) {
  const location = useLocation();
  const { authenticated, loading, user } = useAuthContext();

  if (loading) return <SplashScreen />;

  if (!authenticated || user?.role !== expectedRole) {
    const returnTo = `${location.pathname}${location.search}`;
    const searchParams = new URLSearchParams({ returnTo });
    return <Navigate to={`${getRoleLogin(expectedRole)}?${searchParams.toString()}`} replace />;
  }

  return <>{children}</>;
}
