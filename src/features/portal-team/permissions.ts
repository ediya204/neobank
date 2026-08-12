import { PortalTeamCurrentUser, PortalTeamMember, PortalTeamPermission } from './types';

export const PORTAL_TEAM_PERMISSIONS = {
  readMembers: 'team.read',
  readInvitations: 'team.read',
  createInvitations: 'team.invite',
  resendInvitations: 'team.invite',
  revokeInvitations: 'team.invite',
  updateMemberRole: 'team.manage_members',
  updateMemberStatus: 'team.manage_members',
  readRoles: 'team.read',
  manageRoles: 'team.manage_roles',
} as const satisfies Record<string, PortalTeamPermission>;

export function hasPortalTeamPermission(
  currentUser: PortalTeamCurrentUser | null | undefined,
  permission: PortalTeamPermission
) {
  if (!currentUser) return false;
  if (currentUser.role === 'owner') return true;
  return currentUser.permissions.some((value) => ['*', permission].includes(value));
}

export function canManagePortalTeamMember(
  currentUser: PortalTeamCurrentUser | null | undefined,
  member: PortalTeamMember
) {
  if (!currentUser || member.role.code === 'owner' || member.is_current_user) return false;
  if (member.role.code === 'admin' && currentUser.role !== 'owner') return false;

  const currentMemberId = currentUser.member_id || currentUser.user_id;
  return ![member.id, member.user_id].some((memberId) => memberId === currentMemberId);
}
