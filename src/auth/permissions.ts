import { AuthSessionUser, PortalPermission } from './types';

export const PORTAL_PERMISSIONS: readonly PortalPermission[] = [
  'team.read',
  'team.invite',
  'team.manage_members',
  'team.manage_roles',
  'customers.read',
  'customers.create',
  'balances.read',
  'transactions.read',
  'integrations.read',
  'integrations.request_change',
  'credentials.reveal',
  'notifications.read',
] as const;

const portalPermissionSet = new Set<string>(PORTAL_PERMISSIONS);

export function isPortalPermission(value: unknown): value is PortalPermission {
  return typeof value === 'string' && portalPermissionSet.has(value);
}

export function hasPortalPermission(
  user: AuthSessionUser | null | undefined,
  permission: PortalPermission
) {
  return Boolean(
    user?.role === 'partner' &&
      user.membership?.status === 'active' &&
      user.permissions.includes(permission)
  );
}
