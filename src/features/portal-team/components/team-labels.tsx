import Label, { LabelColor } from 'src/components/label';
import { useTranslation } from 'react-i18next';
import {
  PortalTeamInvitationStatus,
  PortalTeamMemberStatus,
  PortalTeamRoleSummary,
} from '../types';

function roleColor(role: string): LabelColor {
  if (role === 'owner') return 'success';
  if (role === 'admin') return 'info';
  if (role === 'operations') return 'warning';
  if (role === 'developer') return 'secondary';
  return 'default';
}

export function TeamRoleLabel({ role }: { role: PortalTeamRoleSummary }) {
  const { t } = useTranslation('portal');
  return (
    <Label color={roleColor(role.code)}>
      {t(`portalTeam.roles.${role.code}`, { defaultValue: role.name || role.code })}
    </Label>
  );
}

export function MemberStatusLabel({ status }: { status: PortalTeamMemberStatus }) {
  const { t } = useTranslation('portal');
  return (
    <Label
      color={
        (status === 'active' && 'success') || (status === 'onboarding' && 'warning') || 'default'
      }
    >
      {t(`portalTeam.memberStatuses.${status}`, { defaultValue: status })}
    </Label>
  );
}

export function InvitationStatusLabel({ status }: { status: PortalTeamInvitationStatus }) {
  const { t } = useTranslation('portal');
  const color: LabelColor =
    (status === 'pending' && 'warning') ||
    (status === 'accepted' && 'success') ||
    (status === 'expired' && 'error') ||
    'default';
  return (
    <Label color={color}>
      {t(`portalTeam.invitationStatuses.${status}`, { defaultValue: status })}
    </Label>
  );
}
