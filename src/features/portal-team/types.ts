export type PortalTeamRoleKey = 'owner' | 'admin' | 'operations' | 'developer' | 'viewer' | string;

export type PortalTeamMemberStatus = 'onboarding' | 'active' | 'suspended' | string;

export type PortalTeamInvitationStatus = 'pending' | 'expired' | 'accepted' | 'revoked' | string;

export type PortalTeamPermission =
  | 'team.read'
  | 'team.invite'
  | 'team.manage_members'
  | 'team.manage_roles'
  | 'customers.read'
  | 'customers.create'
  | 'balances.read'
  | 'transactions.read'
  | 'integrations.read'
  | 'integrations.request_change'
  | 'credentials.reveal'
  | 'notifications.read'
  | '*'
  | string;

export type PortalTeamCurrentUser = {
  member_id: string;
  user_id?: string | null;
  role: PortalTeamRoleKey;
  permissions: PortalTeamPermission[];
};

export type PortalTeamRoleSummary = {
  id: string;
  code: PortalTeamRoleKey;
  name: string;
};

export type PortalTeamMember = {
  id: string;
  user_id?: string | null;
  display_name?: string | null;
  email: string;
  role: PortalTeamRoleSummary;
  status: PortalTeamMemberStatus;
  joined_at: string | null;
  last_login_at?: string | null;
  created_at: string | null;
  updated_at: string | null;
  version: number;
  is_current_user?: boolean;
};

export type PortalTeamInvitation = {
  id: string;
  email: string;
  role: PortalTeamRoleSummary;
  status: PortalTeamInvitationStatus;
  created_at: string | null;
  updated_at: string | null;
  expires_at: string | null;
  invited_by_name?: string | null;
  setup_url?: string | null;
};

export type PortalTeamRoleDefinition = {
  id: string;
  code: PortalTeamRoleKey;
  name: string;
  description?: string | null;
  permissions: PortalTeamPermission[];
  member_count: number;
  is_system?: boolean;
  version: number;
  assignable?: boolean;
};

export type PortalTeamOverview = {
  current_user: PortalTeamCurrentUser | null;
  members: PortalTeamMember[];
  invitations: PortalTeamInvitation[];
  roles: PortalTeamRoleDefinition[];
};

export type InvitePortalTeamMemberInput = {
  email: string;
  role_id: string;
};

export type UpdatePortalTeamMemberInput = {
  role_id?: string;
  status?: 'active' | 'suspended';
  version: number;
};

export type CreatePortalTeamRoleInput = {
  name: string;
  description: string;
  permissions: PortalTeamPermission[];
};

export type UpdatePortalTeamRoleInput = CreatePortalTeamRoleInput & {
  version: number;
};

export type PortalTeamInvitationCreateResult = {
  invitation: PortalTeamInvitation;
  invite_token?: string | null;
  invite_url_fragment?: string | null;
  setup_url?: string | null;
};

export type PortalTeamMutation =
  | 'invite'
  | 'revoke-invitation'
  | 'update-member'
  | 'create-role'
  | 'update-role'
  | 'delete-role'
  | null;
