import { Navigate } from 'react-router-dom';
import { PortalPermission } from 'src/auth/types';
import { hasPortalPermission } from 'src/auth/permissions';
import { useAuthContext } from '../hooks';

type Props = {
  permission: PortalPermission;
  children: React.ReactNode;
};

export default function PermissionRouteGuard({ permission, children }: Props) {
  const { user } = useAuthContext();

  if (!user) return null;
  if (!hasPortalPermission(user, permission)) {
    return <Navigate to="/403" replace />;
  }

  return <>{children}</>;
}
