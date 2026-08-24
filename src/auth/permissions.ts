import { AdminPermission, AuthSessionUser, SessionPermission } from './types';

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

export function isAdminPermission(value: unknown): value is AdminPermission {
  return typeof value === 'string' && adminPermissionSet.has(value);
}

export function isSessionPermission(value: unknown): value is SessionPermission {
  return isAdminPermission(value);
}

export function hasAdminPermission(
  user: AuthSessionUser | null | undefined,
  permission: AdminPermission
) {
  return Boolean(user?.role === 'admin' && user.permissions.includes(permission));
}
