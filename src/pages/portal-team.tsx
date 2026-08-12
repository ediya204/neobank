import { useEffect, useMemo, useState } from 'react';
import { Helmet } from 'react-helmet-async';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Card from '@mui/material/Card';
import CircularProgress from '@mui/material/CircularProgress';
import Container from '@mui/material/Container';
import Divider from '@mui/material/Divider';
import Stack from '@mui/material/Stack';
import Tab from '@mui/material/Tab';
import Tabs from '@mui/material/Tabs';
import Typography from '@mui/material/Typography';
import { useTranslation } from 'react-i18next';
import Iconify from 'src/components/iconify';
import { useSettingsContext } from 'src/components/settings';
import { useSnackbar } from 'src/components/snackbar';
import InviteMemberDialog from 'src/features/portal-team/components/invite-member-dialog';
import InvitationList from 'src/features/portal-team/components/invitation-list';
import MemberList from 'src/features/portal-team/components/member-list';
import RoleList from 'src/features/portal-team/components/role-list';
import TeamToolbar from 'src/features/portal-team/components/team-toolbar';
import {
  hasPortalTeamPermission,
  PORTAL_TEAM_PERMISSIONS,
} from 'src/features/portal-team/permissions';
import usePortalTeam from 'src/features/portal-team/use-portal-team';
import {
  CreatePortalTeamRoleInput,
  PortalTeamInvitation,
  PortalTeamMember,
  PortalTeamRoleDefinition,
  UpdatePortalTeamRoleInput,
} from 'src/features/portal-team/types';

type TeamTab = 'members' | 'invitations' | 'roles';

const EMPTY_MEMBERS: PortalTeamMember[] = [];
const EMPTY_INVITATIONS: PortalTeamInvitation[] = [];
const EMPTY_ROLES: PortalTeamRoleDefinition[] = [];

export default function PortalTeamPage() {
  const { t, i18n } = useTranslation('portal');
  const settings = useSettingsContext();
  const { enqueueSnackbar } = useSnackbar();
  const {
    overview,
    loading,
    loadError,
    mutation,
    mutationError,
    reload,
    invite,
    revokeInvitation,
    updateMember,
    createRole,
    updateRole,
    deleteRole,
  } = usePortalTeam();
  const [tab, setTab] = useState<TeamTab>('members');
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState('all');
  const [role, setRole] = useState('all');
  const [inviteOpen, setInviteOpen] = useState(false);
  const locale = i18n.resolvedLanguage === 'cn' || i18n.language === 'cn' ? 'zh-CN' : 'en-US';
  const currentUser = overview?.current_user || null;
  const members = overview?.members || EMPTY_MEMBERS;
  const invitations = overview?.invitations || EMPTY_INVITATIONS;
  const roles = overview?.roles || EMPTY_ROLES;
  const pendingInvitations = invitations.filter((invitation) => invitation.status === 'pending');
  const canReadMembers = hasPortalTeamPermission(currentUser, PORTAL_TEAM_PERMISSIONS.readMembers);
  const canReadInvitations = hasPortalTeamPermission(
    currentUser,
    PORTAL_TEAM_PERMISSIONS.readInvitations
  );
  const canReadRoles = hasPortalTeamPermission(currentUser, PORTAL_TEAM_PERMISSIONS.readRoles);
  const canInvite = hasPortalTeamPermission(currentUser, PORTAL_TEAM_PERMISSIONS.createInvitations);
  const canManageRoles = hasPortalTeamPermission(currentUser, PORTAL_TEAM_PERMISSIONS.manageRoles);

  const tabs = useMemo(
    () =>
      [
        canReadMembers ? { value: 'members' as const, label: t('portalTeam.tabs.members') } : null,
        canReadInvitations
          ? { value: 'invitations' as const, label: t('portalTeam.tabs.invitations') }
          : null,
        canReadRoles ? { value: 'roles' as const, label: t('portalTeam.tabs.roles') } : null,
      ].filter((value): value is { value: TeamTab; label: string } => Boolean(value)),
    [canReadInvitations, canReadMembers, canReadRoles, t]
  );

  useEffect(() => {
    if (!tabs.length || tabs.some((item) => item.value === tab)) return;
    setTab(tabs[0].value);
  }, [tab, tabs]);

  const normalizedQuery = query.trim().toLowerCase();
  const filteredMembers = useMemo(
    () =>
      members.filter((member) => {
        const name = member.display_name || member.email.split('@')[0] || '';
        const matchesQuery =
          !normalizedQuery ||
          [name, member.email].some((value) => value.toLowerCase().includes(normalizedQuery));
        const matchesStatus = status === 'all' || member.status === status;
        const matchesRole = role === 'all' || member.role.code === role;
        return matchesQuery && matchesStatus && matchesRole;
      }),
    [members, normalizedQuery, role, status]
  );
  const filteredInvitations = useMemo(
    () =>
      invitations.filter((invitation) => {
        const matchesQuery =
          !normalizedQuery || invitation.email.toLowerCase().includes(normalizedQuery);
        const matchesStatus = status === 'all' || invitation.status === status;
        const matchesRole = role === 'all' || invitation.role.code === role;
        return matchesQuery && matchesStatus && matchesRole;
      }),
    [invitations, normalizedQuery, role, status]
  );

  const changeTab = (value: TeamTab) => {
    setTab(value);
    setQuery('');
    setStatus('all');
    setRole('all');
  };

  const tabLabel = (item: { value: TeamTab; label: string }) => {
    if (item.value === 'members') {
      return t('portalTeam.tabs.withCount', { label: item.label, count: members.length });
    }
    if (item.value === 'invitations') {
      return t('portalTeam.tabs.withCount', { label: item.label, count: invitations.length });
    }
    return item.label;
  };

  const errorText = (error: { code: string; requestId: string } | null) => {
    if (!error) return '';
    const message = t(`portalTeam.errors.${error.code}`, {
      defaultValue: t('portalTeam.errors.request_failed'),
    });
    return error.requestId
      ? t('portalTeam.errors.withRequestId', { message, requestId: error.requestId })
      : message;
  };

  const handleChangeRole = async (member: PortalTeamMember, roleId: string) => {
    await updateMember(member.id, {
      role_id: roleId,
      version: member.version,
    });
    enqueueSnackbar(t('portalTeam.messages.roleUpdated'), { variant: 'success' });
  };

  const handleToggleStatus = async (member: PortalTeamMember) => {
    const nextStatus = member.status === 'active' ? 'suspended' : 'active';
    await updateMember(member.id, {
      status: nextStatus,
      version: member.version,
    });
    enqueueSnackbar(
      nextStatus === 'active'
        ? t('portalTeam.messages.memberActivated')
        : t('portalTeam.messages.memberSuspended'),
      { variant: 'success' }
    );
  };

  const handleRevokeInvitation = async (invitation: PortalTeamInvitation) => {
    await revokeInvitation(invitation.id);
    enqueueSnackbar(t('portalTeam.messages.invitationRevoked'), { variant: 'success' });
  };

  const handleCreateRole = async (input: CreatePortalTeamRoleInput) => {
    await createRole(input);
    enqueueSnackbar(t('portalTeam.messages.roleCreated'), { variant: 'success' });
  };

  const handleUpdateRole = async (
    roleDefinition: PortalTeamRoleDefinition,
    input: UpdatePortalTeamRoleInput
  ) => {
    await updateRole(roleDefinition.id, input);
    enqueueSnackbar(t('portalTeam.messages.roleSaved'), { variant: 'success' });
  };

  const handleDeleteRole = async (roleDefinition: PortalTeamRoleDefinition) => {
    await deleteRole(roleDefinition.id, roleDefinition.version);
    enqueueSnackbar(t('portalTeam.messages.roleDeleted'), { variant: 'success' });
  };

  return (
    <>
      <Helmet>
        <title>{t('portalTeam.pageTitle')} | moventra</title>
      </Helmet>

      <Container maxWidth={settings.themeStretch ? false : 'xl'}>
        <Stack
          direction={{ xs: 'column', sm: 'row' }}
          alignItems={{ sm: 'flex-start' }}
          justifyContent="space-between"
          spacing={2}
          sx={{ mb: 3 }}
        >
          <Box>
            <Typography variant="h4">{t('portalTeam.title')}</Typography>
            <Typography color="text.secondary" sx={{ mt: 0.5 }}>
              {t('portalTeam.description')}
            </Typography>
            <Stack direction="row" spacing={1} alignItems="center" sx={{ mt: 1.25 }}>
              <Typography variant="body2" color="text.secondary">
                {t('portalTeam.summary.totalUsers', { count: members.length })}
              </Typography>
              <Typography variant="body2" color="text.disabled">
                {t('portalTeam.summary.separator')}
              </Typography>
              <Typography variant="body2" color="text.secondary">
                {t('portalTeam.summary.pendingInvites', { count: pendingInvitations.length })}
              </Typography>
            </Stack>
          </Box>

          {canInvite && (
            <Button
              variant="contained"
              startIcon={<Iconify icon="solar:user-plus-bold-duotone" />}
              onClick={() => setInviteOpen(true)}
            >
              {t('portalTeam.actions.inviteMember')}
            </Button>
          )}
        </Stack>

        {loadError && (
          <Alert
            severity="error"
            sx={{ mb: 2 }}
            action={
              <Button color="inherit" size="small" onClick={() => reload()}>
                {t('portalTeam.actions.retry')}
              </Button>
            }
          >
            {errorText(loadError)}
          </Alert>
        )}

        {mutationError && (
          <Alert severity="error" sx={{ mb: 2 }}>
            {errorText(mutationError)}
          </Alert>
        )}

        <Card
          sx={{
            overflow: 'hidden',
            boxShadow: 'none',
            border: (theme) => `1px solid ${theme.palette.divider}`,
          }}
        >
          {loading && !overview && (
            <Stack alignItems="center" justifyContent="center" sx={{ minHeight: 420 }}>
              <CircularProgress size={32} />
              <Typography variant="body2" color="text.secondary" sx={{ mt: 2 }}>
                {t('portalTeam.loading')}
              </Typography>
            </Stack>
          )}
          {(!loading || Boolean(overview)) && Boolean(tabs.length) && (
            <>
              <Tabs
                value={tab}
                onChange={(_, value: TeamTab) => changeTab(value)}
                variant="scrollable"
                scrollButtons="auto"
                sx={{ px: { xs: 1, md: 2 } }}
              >
                {tabs.map((item) => (
                  <Tab key={item.value} value={item.value} label={tabLabel(item)} />
                ))}
              </Tabs>
              <Divider />

              {(tab === 'members' || tab === 'invitations') && (
                <>
                  <TeamToolbar
                    query={query}
                    status={status}
                    role={role}
                    roles={roles}
                    statusType={tab === 'members' ? 'member' : 'invitation'}
                    onQueryChange={setQuery}
                    onStatusChange={setStatus}
                    onRoleChange={setRole}
                  />
                  <Divider />
                </>
              )}

              {tab === 'members' && (
                <MemberList
                  members={filteredMembers}
                  roles={roles}
                  currentUser={currentUser}
                  locale={locale}
                  busy={mutation === 'update-member'}
                  onChangeRole={handleChangeRole}
                  onToggleStatus={handleToggleStatus}
                />
              )}
              {tab === 'invitations' && (
                <InvitationList
                  invitations={filteredInvitations}
                  currentUser={currentUser}
                  locale={locale}
                  busy={mutation === 'revoke-invitation'}
                  onRevoke={handleRevokeInvitation}
                />
              )}
              {tab === 'roles' && (
                <RoleList
                  roles={roles}
                  canManage={canManageRoles}
                  canAssignRestricted={currentUser?.role === 'owner'}
                  grantablePermissions={currentUser?.permissions || []}
                  busy={['create-role', 'update-role', 'delete-role'].includes(mutation || '')}
                  onCreate={handleCreateRole}
                  onUpdate={handleUpdateRole}
                  onDelete={handleDeleteRole}
                />
              )}
            </>
          )}
          {(!loading || Boolean(overview)) && !tabs.length && (
            <Stack alignItems="center" justifyContent="center" sx={{ minHeight: 360, px: 3 }}>
              <Iconify
                icon="solar:shield-warning-bold-duotone"
                width={44}
                sx={{ color: 'warning.main', mb: 1.5 }}
              />
              <Typography variant="subtitle1">{t('portalTeam.noAccess.title')}</Typography>
              <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
                {t('portalTeam.noAccess.description')}
              </Typography>
            </Stack>
          )}
        </Card>
      </Container>

      <InviteMemberDialog
        open={inviteOpen}
        roles={roles.filter(
          (roleDefinition) => currentUser?.role === 'owner' || roleDefinition.code !== 'admin'
        )}
        submitting={mutation === 'invite'}
        error={mutation === 'invite' ? errorText(mutationError) : ''}
        onClose={() => setInviteOpen(false)}
        onSubmit={invite}
      />
    </>
  );
}
