import { useMemo, useState } from 'react';
import Avatar from '@mui/material/Avatar';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Card from '@mui/material/Card';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import Divider from '@mui/material/Divider';
import IconButton from '@mui/material/IconButton';
import Menu from '@mui/material/Menu';
import MenuItem from '@mui/material/MenuItem';
import Stack from '@mui/material/Stack';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableContainer from '@mui/material/TableContainer';
import TableHead from '@mui/material/TableHead';
import TableRow from '@mui/material/TableRow';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import { useTranslation } from 'react-i18next';
import Iconify from 'src/components/iconify';
import Label from 'src/components/label';
import {
  canManagePortalTeamMember,
  hasPortalTeamPermission,
  PORTAL_TEAM_PERMISSIONS,
} from '../permissions';
import { PortalTeamCurrentUser, PortalTeamMember, PortalTeamRoleDefinition } from '../types';
import { MemberStatusLabel, TeamRoleLabel } from './team-labels';

type Props = {
  members: PortalTeamMember[];
  roles: PortalTeamRoleDefinition[];
  currentUser: PortalTeamCurrentUser | null;
  locale: string;
  busy: boolean;
  onChangeRole: (member: PortalTeamMember, roleId: string) => Promise<unknown>;
  onToggleStatus: (member: PortalTeamMember) => Promise<unknown>;
};

function initials(value: string) {
  return value
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part.charAt(0).toUpperCase())
    .join('');
}

function memberName(member: PortalTeamMember) {
  return member.display_name || member.email.split('@')[0] || member.email;
}

function formatDate(value: string | null | undefined, locale: string, fallback: string) {
  if (!value) return fallback;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return fallback;
  return new Intl.DateTimeFormat(locale, { dateStyle: 'medium' }).format(date);
}

export default function MemberList({
  members,
  roles,
  currentUser,
  locale,
  busy,
  onChangeRole,
  onToggleStatus,
}: Props) {
  const { t } = useTranslation('portal');
  const [menuAnchor, setMenuAnchor] = useState<HTMLElement | null>(null);
  const [menuMember, setMenuMember] = useState<PortalTeamMember | null>(null);
  const [roleMember, setRoleMember] = useState<PortalTeamMember | null>(null);
  const [statusMember, setStatusMember] = useState<PortalTeamMember | null>(null);
  const [selectedRole, setSelectedRole] = useState('');
  const assignableRoles = useMemo(
    () =>
      roles.filter(
        (role) =>
          role.assignable !== false &&
          role.code !== 'owner' &&
          (currentUser?.role === 'owner' || role.code !== 'admin')
      ),
    [currentUser?.role, roles]
  );
  const fallback = t('portalTeam.common.notAvailable');
  const selectedRoleDefinition = assignableRoles.find((option) => option.id === selectedRole);

  const canChangeRole = (member: PortalTeamMember) =>
    member.status !== 'onboarding' &&
    canManagePortalTeamMember(currentUser, member) &&
    hasPortalTeamPermission(currentUser, PORTAL_TEAM_PERMISSIONS.updateMemberRole);
  const canChangeStatus = (member: PortalTeamMember) =>
    member.status !== 'onboarding' &&
    canManagePortalTeamMember(currentUser, member) &&
    hasPortalTeamPermission(currentUser, PORTAL_TEAM_PERMISSIONS.updateMemberStatus);

  const openMenu = (event: React.MouseEvent<HTMLElement>, member: PortalTeamMember) => {
    setMenuAnchor(event.currentTarget);
    setMenuMember(member);
  };

  const closeMenu = () => {
    setMenuAnchor(null);
    setMenuMember(null);
  };

  const openRoleDialog = () => {
    if (!menuMember) return;
    setSelectedRole(menuMember.role.id);
    setRoleMember(menuMember);
    closeMenu();
  };

  const openStatusDialog = () => {
    if (!menuMember) return;
    setStatusMember(menuMember);
    closeMenu();
  };

  const submitRole = async () => {
    if (!roleMember || selectedRole === roleMember.role.id) {
      setRoleMember(null);
      return;
    }
    try {
      await onChangeRole(roleMember, selectedRole);
      setRoleMember(null);
    } catch {
      // The page-level mutation alert keeps the dialog recoverable.
    }
  };

  const submitStatus = async () => {
    if (!statusMember) return;
    try {
      await onToggleStatus(statusMember);
      setStatusMember(null);
    } catch {
      // The page-level mutation alert keeps the dialog recoverable.
    }
  };

  if (!members.length) {
    return (
      <Stack alignItems="center" justifyContent="center" sx={{ minHeight: 280, px: 3 }}>
        <Iconify
          icon="solar:users-group-rounded-bold-duotone"
          width={44}
          sx={{ color: 'text.disabled', mb: 1.5 }}
        />
        <Typography variant="subtitle1">{t('portalTeam.members.empty')}</Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
          {t('portalTeam.members.emptyDetail')}
        </Typography>
      </Stack>
    );
  }

  const renderActions = (member: PortalTeamMember) => {
    if (!canChangeRole(member) && !canChangeStatus(member)) return null;
    return (
      <IconButton
        size="small"
        aria-label={t('portalTeam.members.openActions', { name: memberName(member) })}
        onClick={(event) => openMenu(event, member)}
      >
        <Iconify icon="solar:menu-dots-bold" />
      </IconButton>
    );
  };

  const statusActionKey =
    statusMember?.status === 'active'
      ? 'portalTeam.actions.suspend'
      : 'portalTeam.actions.activate';
  const statusActionLabel = busy ? t('portalTeam.actions.saving') : t(statusActionKey);

  return (
    <>
      <TableContainer sx={{ display: { xs: 'none', md: 'block' } }}>
        <Table
          size="small"
          sx={{
            minWidth: 980,
            '& .MuiTableCell-root': { py: 1.25, whiteSpace: 'nowrap' },
          }}
        >
          <TableHead>
            <TableRow>
              <TableCell>{t('portalTeam.columns.user')}</TableCell>
              <TableCell>{t('portalTeam.columns.email')}</TableCell>
              <TableCell>{t('portalTeam.columns.role')}</TableCell>
              <TableCell>{t('portalTeam.columns.status')}</TableCell>
              <TableCell>{t('portalTeam.columns.joined')}</TableCell>
              <TableCell>{t('portalTeam.columns.lastLogin')}</TableCell>
              <TableCell align="right">{t('portalTeam.columns.actions')}</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {members.map((member) => (
              <TableRow hover key={member.id}>
                <TableCell>
                  <Stack direction="row" alignItems="center" spacing={1.25}>
                    <Avatar sx={{ width: 32, height: 32, typography: 'caption' }}>
                      {initials(memberName(member))}
                    </Avatar>
                    <Stack direction="row" alignItems="center" spacing={0.75}>
                      <Typography variant="subtitle2">{memberName(member)}</Typography>
                      {member.is_current_user && <Label>{t('portalTeam.members.you')}</Label>}
                    </Stack>
                  </Stack>
                </TableCell>
                <TableCell>
                  <Typography variant="body2" color="text.secondary">
                    {member.email}
                  </Typography>
                </TableCell>
                <TableCell>
                  <TeamRoleLabel role={member.role} />
                </TableCell>
                <TableCell>
                  <MemberStatusLabel status={member.status} />
                </TableCell>
                <TableCell>{formatDate(member.joined_at, locale, fallback)}</TableCell>
                <TableCell>{formatDate(member.last_login_at, locale, fallback)}</TableCell>
                <TableCell align="right">{renderActions(member)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableContainer>

      <Stack
        spacing={1.5}
        sx={{ display: { xs: 'flex', md: 'none' }, p: 2, bgcolor: 'background.neutral' }}
      >
        {members.map((member) => (
          <Card key={member.id} sx={{ p: 2, boxShadow: 'none' }}>
            <Stack direction="row" alignItems="flex-start" spacing={1.5}>
              <Avatar sx={{ width: 40, height: 40, typography: 'body2' }}>
                {initials(memberName(member))}
              </Avatar>
              <Box sx={{ minWidth: 0, flex: 1 }}>
                <Stack direction="row" alignItems="center" spacing={0.75}>
                  <Typography variant="subtitle2" noWrap>
                    {memberName(member)}
                  </Typography>
                  {member.is_current_user && <Label>{t('portalTeam.members.you')}</Label>}
                </Stack>
                <Typography variant="body2" color="text.secondary" noWrap>
                  {member.email}
                </Typography>
              </Box>
              {renderActions(member)}
            </Stack>
            <Divider sx={{ my: 1.5 }} />
            <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 1.25 }}>
              <TeamRoleLabel role={member.role} />
              <MemberStatusLabel status={member.status} />
            </Stack>
            <Stack direction="row" justifyContent="space-between" spacing={2}>
              <Box>
                <Typography variant="caption" color="text.disabled">
                  {t('portalTeam.columns.joined')}
                </Typography>
                <Typography variant="body2">
                  {formatDate(member.joined_at, locale, fallback)}
                </Typography>
              </Box>
              <Box sx={{ textAlign: 'right' }}>
                <Typography variant="caption" color="text.disabled">
                  {t('portalTeam.columns.lastLogin')}
                </Typography>
                <Typography variant="body2">
                  {formatDate(member.last_login_at, locale, fallback)}
                </Typography>
              </Box>
            </Stack>
          </Card>
        ))}
      </Stack>

      <Menu anchorEl={menuAnchor} open={Boolean(menuAnchor)} onClose={closeMenu}>
        {menuMember && canChangeRole(menuMember) && (
          <MenuItem onClick={openRoleDialog}>
            <Iconify icon="solar:shield-user-bold-duotone" sx={{ mr: 1.25 }} />
            {t('portalTeam.actions.changeRole')}
          </MenuItem>
        )}
        {menuMember && canChangeStatus(menuMember) && (
          <MenuItem
            onClick={openStatusDialog}
            sx={{ color: menuMember.status === 'active' ? 'warning.main' : 'success.main' }}
          >
            <Iconify
              icon={
                menuMember.status === 'active'
                  ? 'solar:user-block-rounded-bold-duotone'
                  : 'solar:user-check-rounded-bold-duotone'
              }
              sx={{ mr: 1.25 }}
            />
            {menuMember.status === 'active'
              ? t('portalTeam.actions.suspend')
              : t('portalTeam.actions.activate')}
          </MenuItem>
        )}
      </Menu>

      <Dialog
        open={Boolean(roleMember)}
        onClose={() => !busy && setRoleMember(null)}
        fullWidth
        maxWidth="xs"
      >
        <DialogTitle>{t('portalTeam.memberRole.title')}</DialogTitle>
        <DialogContent dividers>
          <Stack spacing={2.5}>
            <Typography variant="body2" color="text.secondary">
              {t('portalTeam.memberRole.description', {
                name: roleMember ? memberName(roleMember) : '',
              })}
            </Typography>
            <TextField
              select
              fullWidth
              label={t('portalTeam.memberRole.role')}
              value={selectedRole}
              onChange={(event) => setSelectedRole(event.target.value)}
            >
              {assignableRoles.map((role) => (
                <MenuItem key={role.id} value={role.id}>
                  {t(`portalTeam.roles.${role.code}`, {
                    defaultValue: role.name || role.code,
                  })}
                </MenuItem>
              ))}
            </TextField>
            {selectedRole && (
              <Typography variant="body2" color="text.secondary">
                {t(`portalTeam.roleDescriptions.${selectedRoleDefinition?.code || 'viewer'}`, {
                  defaultValue:
                    selectedRoleDefinition?.description ||
                    selectedRoleDefinition?.name ||
                    selectedRoleDefinition?.code ||
                    '',
                })}
              </Typography>
            )}
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button color="inherit" disabled={busy} onClick={() => setRoleMember(null)}>
            {t('portalTeam.actions.cancel')}
          </Button>
          <Button variant="contained" disabled={busy} onClick={submitRole}>
            {busy ? t('portalTeam.actions.saving') : t('portalTeam.actions.save')}
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog
        open={Boolean(statusMember)}
        onClose={() => !busy && setStatusMember(null)}
        fullWidth
        maxWidth="xs"
      >
        <DialogTitle>
          {statusMember?.status === 'active'
            ? t('portalTeam.memberStatus.suspendTitle')
            : t('portalTeam.memberStatus.activateTitle')}
        </DialogTitle>
        <DialogContent dividers>
          <Typography variant="body2" color="text.secondary">
            {statusMember?.status === 'active'
              ? t('portalTeam.memberStatus.suspendDescription', {
                  name: statusMember ? memberName(statusMember) : '',
                })
              : t('portalTeam.memberStatus.activateDescription', {
                  name: statusMember ? memberName(statusMember) : '',
                })}
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button color="inherit" disabled={busy} onClick={() => setStatusMember(null)}>
            {t('portalTeam.actions.cancel')}
          </Button>
          <Button
            variant="contained"
            color={statusMember?.status === 'active' ? 'warning' : 'success'}
            disabled={busy}
            onClick={submitStatus}
          >
            {statusActionLabel}
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
}
