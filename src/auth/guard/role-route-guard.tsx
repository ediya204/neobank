import { Navigate, useLocation } from 'react-router-dom';
import { AuthRole } from 'src/auth/types';
import { canAccessPortalPath, getUserHome } from 'src/auth/role-access';
import { useAuthContext } from '../hooks';

type Props = {
  roles: AuthRole[];
  children: React.ReactNode;
};

export default function RoleRouteGuard({ roles, children }: Props) {
  const { user } = useAuthContext();
  const { pathname } = useLocation();

  if (!user) return null;
  if (!roles.includes(user.role)) return <Navigate to={getUserHome(user)} replace />;
  if (
    user.role === 'partner' &&
    pathname.startsWith('/portal') &&
    !canAccessPortalPath(user, pathname)
  ) {
    return <Navigate to={getUserHome(user)} replace />;
  }

  return <>{children}</>;
}
