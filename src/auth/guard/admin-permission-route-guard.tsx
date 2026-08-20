import { Navigate, useLocation } from 'react-router-dom';
import { requiredAdminPermissionForPath } from 'src/auth/admin-access';
import { hasAdminPermission } from 'src/auth/permissions';
import { AdminPermission } from 'src/auth/types';
import { useAuthContext } from '../hooks';
import { getUserHome } from '../role-access';

type Props = {
  permission: AdminPermission;
  children: React.ReactNode;
};

export default function AdminPermissionRouteGuard({ permission, children }: Props) {
  const { user } = useAuthContext();
  if (!hasAdminPermission(user, permission)) {
    return <Navigate to={getUserHome(user)} replace />;
  }
  return <>{children}</>;
}

export function AdminPathAccessGuard({ children }: { children: React.ReactNode }) {
  const { user } = useAuthContext();
  const location = useLocation();
  const permission = requiredAdminPermissionForPath(location.pathname);
  if (!hasAdminPermission(user, permission)) {
    return <Navigate to={getUserHome(user)} replace />;
  }
  return <>{children}</>;
}
