import {
  AdminPermission,
  AuthSessionUser,
  PortalPermission,
  SessionPermission,
} from './types';

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

export const ADMIN_PERMISSIONS: readonly AdminPermission[] = [
  'admin_users.manage',
  'customer_credentials.manage',
  'customers.read',
  'customers.review',
  'funds.read',
  'funds.manage',
  'settings.manage',
  'reports.read',
] as const;

const adminPermissionSet = new Set<string>(ADMIN_PERMISSIONS);

export function isPortalPermission(value: unknown): value is PortalPermission {
  return typeof value === 'string' && portalPermissionSet.has(value);
}

export function isAdminPermission(value: unknown): value is AdminPermission {
  return typeof value === 'string' && adminPermissionSet.has(value);
}

export function isSessionPermission(value: unknown): value is SessionPermission {
  return isPortalPermission(value) || isAdminPermission(value);
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

export function hasAdminPermission(
  user: AuthSessionUser | null | undefined,
  permission: AdminPermission
) {
  return Boolean(user?.role === 'admin' && user.permissions.includes(permission));
}
