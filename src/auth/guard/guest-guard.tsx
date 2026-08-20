import { Navigate } from 'react-router-dom';
import { useSearchParams } from 'src/routes/hooks';
import { safeReturnTo } from 'src/auth/role-access';
import { AuthRole } from 'src/auth/types';
import { useAuthContext } from '../hooks';

type Props = {
  expectedRole: AuthRole;
  children: React.ReactNode;
};

export default function GuestGuard({ expectedRole, children }: Props) {
  const searchParams = useSearchParams();
  const { authenticated, loading, user } = useAuthContext();

  if (!loading && authenticated && user?.role === expectedRole) {
    return <Navigate to={safeReturnTo(searchParams.get('returnTo'), user.role)} replace />;
  }

  return <>{children}</>;
}
