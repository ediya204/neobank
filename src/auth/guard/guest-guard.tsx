import { Navigate } from 'react-router-dom';
import { SplashScreen } from 'src/components/loading-screen';
import { useSearchParams } from 'src/routes/hooks';
import { safeReturnTo } from 'src/auth/role-access';
import { useAuthContext } from '../hooks';

type Props = {
  children: React.ReactNode;
};

export default function GuestGuard({ children }: Props) {
  const searchParams = useSearchParams();
  const { authenticated, loading, user } = useAuthContext();

  if (loading) return <SplashScreen />;

  if (authenticated && user) {
    return <Navigate to={safeReturnTo(searchParams.get('returnTo'), user.role)} replace />;
  }

  return <>{children}</>;
}
