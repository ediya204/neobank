import { AdminAccessRole, AdminPermission } from 'src/auth/types';

export type ManagedAdminUser = {
  id: string;
  email: string;
  display_name: string;
  access_role: AdminAccessRole;
  permissions: AdminPermission[];
  status: 'active' | 'disabled';
  version: number;
  totp_enabled: boolean;
  setup_completed_at: string | null;
  last_login_at: string | null;
  created_at: string;
  updated_at: string;
};

export type AdminRoleDefinition = {
  code: AdminAccessRole;
  permissions: AdminPermission[];
};

export type AdminUsersOverview = {
  users: ManagedAdminUser[];
  roles: AdminRoleDefinition[];
};

export type CreateAdminUserInput = {
  email: string;
  display_name: string;
  access_role: AdminAccessRole;
};

export type UpdateAdminUserInput = {
  display_name?: string;
  access_role?: AdminAccessRole;
  status?: 'active' | 'disabled';
  version: number;
};

export type AdminSetupLinkResult = {
  setup_token: string;
  setup_url_fragment: string;
  expires_at: string;
};

export type CreateAdminUserResult = AdminSetupLinkResult & {
  user: ManagedAdminUser;
};
