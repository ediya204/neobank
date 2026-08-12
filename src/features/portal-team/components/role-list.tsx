import { FormEvent, useEffect, useState } from 'react';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Card from '@mui/material/Card';
import Checkbox from '@mui/material/Checkbox';
import Chip from '@mui/material/Chip';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import FormControlLabel from '@mui/material/FormControlLabel';
import IconButton from '@mui/material/IconButton';
import Stack from '@mui/material/Stack';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableContainer from '@mui/material/TableContainer';
import TableHead from '@mui/material/TableHead';
import TableRow from '@mui/material/TableRow';
import TextField from '@mui/material/TextField';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import { useTranslation } from 'react-i18next';
import Iconify from 'src/components/iconify';
import Label from 'src/components/label';
import {
  CreatePortalTeamRoleInput,
  PortalTeamPermission,
  PortalTeamRoleDefinition,
  UpdatePortalTeamRoleInput,
} from '../types';

type Props = {
  roles: PortalTeamRoleDefinition[];
  canManage: boolean;
  canAssignRestricted: boolean;
  grantablePermissions: PortalTeamPermission[];
  busy: boolean;
  onCreate: (input: CreatePortalTeamRoleInput) => Promise<unknown>;
  onUpdate: (role: PortalTeamRoleDefinition, input: UpdatePortalTeamRoleInput) => Promise<unknown>;
  onDelete: (role: PortalTeamRoleDefinition) => Promise<unknown>;
};

type PermissionGroup = {
  key: string;
  permissions: PortalTeamPermission[];
};

const PERMISSION_GROUPS: PermissionGroup[] = [
  {
    key: 'team',
    permissions: ['team.read', 'team.invite', 'team.manage_members', 'team.manage_roles'],
  },
  { key: 'customers', permissions: ['customers.read', 'customers.create'] },
  { key: 'finance', permissions: ['balances.read', 'transactions.read'] },
  {
    key: 'integrations',
    permissions: ['integrations.read', 'integrations.request_change'],
  },
  { key: 'credentials', permissions: ['credentials.reveal'] },
  { key: 'notifications', permissions: ['notifications.read'] },
];

function PermissionChips({ role }: { role: PortalTeamRoleDefinition }) {
  const { t } = useTranslation('portal');
  return (
    <Stack direction="row" spacing={0.75} useFlexGap flexWrap="wrap">
      {role.permissions.map((permission) => (
        <Chip
          key={permission}
          size="small"
          variant="outlined"
          label={t(`portalTeam.permissions.${permission}`, { defaultValue: permission })}
        />
      ))}
    </Stack>
  );
}

export default function RoleList({
  roles,
  canManage,
  canAssignRestricted,
  grantablePermissions,
  busy,
  onCreate,
  onUpdate,
  onDelete,
}: Props) {
  const { t } = useTranslation('portal');
  const [editRole, setEditRole] = useState<PortalTeamRoleDefinition | 'new' | null>(null);
  const [deleteRole, setDeleteRole] = useState<PortalTeamRoleDefinition | null>(null);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [permissions, setPermissions] = useState<PortalTeamPermission[]>([]);
  const [validationError, setValidationError] = useState('');

  useEffect(() => {
    if (!editRole) return;
    setName(editRole === 'new' ? '' : editRole.name);
    setDescription(editRole === 'new' ? '' : editRole.description || '');
    setPermissions(editRole === 'new' ? ['team.read'] : editRole.permissions);
    setValidationError('');
  }, [editRole]);

  const togglePermission = (permission: PortalTeamPermission) => {
    setPermissions((current) =>
      current.includes(permission)
        ? current.filter((value) => value !== permission)
        : [...current, permission]
    );
  };

  const cannotGrantPermission = (permission: PortalTeamPermission) => {
    if (permission === 'credentials.reveal') return !canAssignRestricted;
    return !grantablePermissions.some((value) => value === '*' || value === permission);
  };

  const submitRole = async (event: FormEvent) => {
    event.preventDefault();
    const normalizedName = name.trim();
    setValidationError('');
    if (!normalizedName) {
      setValidationError(t('portalTeam.roleEditor.nameRequired'));
      return;
    }
    const normalizedDescription = description.trim();
    if (!normalizedDescription) {
      setValidationError(t('portalTeam.roleEditor.descriptionRequired'));
      return;
    }
    if (!permissions.length) {
      setValidationError(t('portalTeam.roleEditor.permissionRequired'));
      return;
    }
    const input: CreatePortalTeamRoleInput = {
      name: normalizedName,
      description: normalizedDescription,
      permissions,
    };
    try {
      if (editRole === 'new') await onCreate(input);
      else if (editRole) await onUpdate(editRole, { ...input, version: editRole.version });
      setEditRole(null);
    } catch {
      // The page-level mutation alert keeps the dialog recoverable.
    }
  };

  const submitDelete = async () => {
    if (!deleteRole) return;
    try {
      await onDelete(deleteRole);
      setDeleteRole(null);
    } catch {
      // The page-level mutation alert keeps the dialog recoverable.
    }
  };

  const roleName = (role: PortalTeamRoleDefinition) =>
    t(`portalTeam.roles.${role.code}`, { defaultValue: role.name || role.code });

  const roleDescription = (role: PortalTeamRoleDefinition) =>
    t(`portalTeam.roleDescriptions.${role.code}`, {
      defaultValue: role.description || role.code,
    });

  const roleActions = (role: PortalTeamRoleDefinition) =>
    canManage && !role.is_system ? (
      <Stack direction="row" justifyContent="flex-end" spacing={0.25}>
        <Tooltip title={t('portalTeam.actions.editRole')}>
          <IconButton
            size="small"
            aria-label={t('portalTeam.rolesTab.editFor', { role: roleName(role) })}
            onClick={() => setEditRole(role)}
          >
            <Iconify icon="solar:pen-bold" />
          </IconButton>
        </Tooltip>
        <Tooltip title={t('portalTeam.actions.deleteRole')}>
          <IconButton
            size="small"
            color="error"
            aria-label={t('portalTeam.rolesTab.deleteFor', { role: roleName(role) })}
            onClick={() => setDeleteRole(role)}
          >
            <Iconify icon="solar:trash-bin-trash-bold-duotone" />
          </IconButton>
        </Tooltip>
      </Stack>
    ) : (
      <Typography variant="caption" color="text.disabled">
        {role.is_system ? t('portalTeam.rolesTab.readOnly') : ''}
      </Typography>
    );

  return (
    <>
      {canManage && (
        <Stack direction="row" justifyContent="flex-end" sx={{ px: 2.5, py: 1.75 }}>
          <Button
            variant="outlined"
            startIcon={<Iconify icon="solar:shield-plus-bold-duotone" />}
            onClick={() => setEditRole('new')}
          >
            {t('portalTeam.actions.createRole')}
          </Button>
        </Stack>
      )}

      {!roles.length ? (
        <Stack alignItems="center" justifyContent="center" sx={{ minHeight: 280, px: 3 }}>
          <Iconify
            icon="solar:shield-user-bold-duotone"
            width={44}
            sx={{ color: 'text.disabled', mb: 1.5 }}
          />
          <Typography variant="subtitle1">{t('portalTeam.rolesTab.empty')}</Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
            {t('portalTeam.rolesTab.emptyDetail')}
          </Typography>
        </Stack>
      ) : (
        <>
          <TableContainer sx={{ display: { xs: 'none', md: 'block' } }}>
            <Table size="small" sx={{ minWidth: 900 }}>
              <TableHead>
                <TableRow>
                  <TableCell>{t('portalTeam.columns.role')}</TableCell>
                  <TableCell>{t('portalTeam.columns.permissions')}</TableCell>
                  <TableCell align="right">{t('portalTeam.columns.members')}</TableCell>
                  <TableCell align="right">{t('portalTeam.columns.actions')}</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {roles.map((role) => (
                  <TableRow hover key={role.id}>
                    <TableCell sx={{ width: 280, py: 2 }}>
                      <Stack direction="row" alignItems="center" spacing={1}>
                        <Typography variant="subtitle2">{roleName(role)}</Typography>
                        {role.is_system && <Label>{t('portalTeam.roles.system')}</Label>}
                      </Stack>
                      <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
                        {roleDescription(role)}
                      </Typography>
                    </TableCell>
                    <TableCell>
                      <PermissionChips role={role} />
                    </TableCell>
                    <TableCell align="right">
                      <Typography variant="subtitle2">{role.member_count}</Typography>
                    </TableCell>
                    <TableCell align="right">{roleActions(role)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>

          <Box
            sx={{
              display: { xs: 'grid', md: 'none' },
              gridTemplateColumns: '1fr',
              gap: 1.5,
              p: 2,
              bgcolor: 'background.neutral',
            }}
          >
            {roles.map((role) => (
              <Card key={role.id} sx={{ p: 2, boxShadow: 'none' }}>
                <Stack direction="row" alignItems="flex-start" justifyContent="space-between">
                  <Box sx={{ minWidth: 0 }}>
                    <Stack direction="row" alignItems="center" spacing={1}>
                      <Typography variant="subtitle2">{roleName(role)}</Typography>
                      {role.is_system && <Label>{t('portalTeam.roles.system')}</Label>}
                    </Stack>
                    <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
                      {roleDescription(role)}
                    </Typography>
                  </Box>
                  {roleActions(role)}
                </Stack>
                <Box sx={{ mt: 1.5 }}>
                  <PermissionChips role={role} />
                </Box>
                <Typography
                  variant="caption"
                  color="text.disabled"
                  sx={{ mt: 1.5, display: 'block' }}
                >
                  {t('portalTeam.rolesTab.memberCount', { count: role.member_count })}
                </Typography>
              </Card>
            ))}
          </Box>
        </>
      )}

      <Dialog
        open={Boolean(editRole)}
        onClose={() => !busy && setEditRole(null)}
        fullWidth
        maxWidth="sm"
        PaperProps={{ component: 'form', onSubmit: submitRole }}
      >
        <DialogTitle>
          {editRole === 'new'
            ? t('portalTeam.roleEditor.createTitle')
            : t('portalTeam.roleEditor.editTitle')}
        </DialogTitle>
        <DialogContent dividers>
          <Stack spacing={2.5} sx={{ pt: 1 }}>
            <TextField
              autoFocus
              required
              label={t('portalTeam.roleEditor.name')}
              value={name}
              onChange={(event) => setName(event.target.value)}
              inputProps={{ maxLength: 80 }}
            />
            <TextField
              required
              multiline
              minRows={2}
              label={t('portalTeam.roleEditor.description')}
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              inputProps={{ minLength: 1, maxLength: 300 }}
            />
            <Box>
              <Typography variant="subtitle2">{t('portalTeam.roleEditor.permissions')}</Typography>
              <Typography variant="body2" color="text.secondary" sx={{ mt: 0.25, mb: 1 }}>
                {t('portalTeam.roleEditor.permissionsDescription')}
              </Typography>
              <Stack spacing={1.5}>
                {PERMISSION_GROUPS.map((group) => (
                  <Box
                    key={group.key}
                    sx={{
                      px: 1.5,
                      py: 1.25,
                      border: (theme) => `1px solid ${theme.palette.divider}`,
                      borderRadius: 1,
                    }}
                  >
                    <Typography variant="overline" color="text.secondary">
                      {t(`portalTeam.permissionGroups.${group.key}`)}
                    </Typography>
                    <Stack>
                      {group.permissions.map((permission) => (
                        <FormControlLabel
                          key={permission}
                          sx={{ alignItems: 'flex-start', m: 0 }}
                          control={
                            <Checkbox
                              checked={permissions.includes(permission)}
                              disabled={
                                cannotGrantPermission(permission) &&
                                (permission === 'credentials.reveal' ||
                                  !permissions.includes(permission))
                              }
                              onChange={() => togglePermission(permission)}
                            />
                          }
                          label={
                            <Stack
                              direction="row"
                              alignItems="center"
                              spacing={1}
                              useFlexGap
                              flexWrap="wrap"
                              sx={{ pt: 1 }}
                            >
                              <Typography variant="body2">
                                {t(`portalTeam.permissions.${permission}`)}
                              </Typography>
                              {permission === 'credentials.reveal' && (
                                <Chip
                                  size="small"
                                  color="warning"
                                  label={t('portalTeam.roleEditor.restricted')}
                                />
                              )}
                              {permission === 'credentials.reveal' && !canAssignRestricted && (
                                <Typography variant="caption" color="text.secondary">
                                  {t('portalTeam.roleEditor.restrictedOwnerOnly')}
                                </Typography>
                              )}
                            </Stack>
                          }
                        />
                      ))}
                    </Stack>
                  </Box>
                ))}
              </Stack>
              {canAssignRestricted && permissions.includes('credentials.reveal') && (
                <Alert severity="warning" sx={{ mt: 1.5 }}>
                  {t('portalTeam.roleEditor.restrictedWarning')}
                </Alert>
              )}
            </Box>
            {validationError && (
              <Typography variant="body2" color="error.main">
                {validationError}
              </Typography>
            )}
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button color="inherit" disabled={busy} onClick={() => setEditRole(null)}>
            {t('portalTeam.actions.cancel')}
          </Button>
          <Button type="submit" variant="contained" disabled={busy}>
            {busy ? t('portalTeam.actions.saving') : t('portalTeam.actions.save')}
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog
        open={Boolean(deleteRole)}
        onClose={() => !busy && setDeleteRole(null)}
        fullWidth
        maxWidth="xs"
      >
        <DialogTitle>{t('portalTeam.deleteRole.title')}</DialogTitle>
        <DialogContent dividers>
          <Typography variant="body2" color="text.secondary">
            {t('portalTeam.deleteRole.description', {
              role: deleteRole ? roleName(deleteRole) : '',
            })}
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button color="inherit" disabled={busy} onClick={() => setDeleteRole(null)}>
            {t('portalTeam.actions.cancel')}
          </Button>
          <Button variant="contained" color="error" disabled={busy} onClick={submitDelete}>
            {busy ? t('portalTeam.actions.saving') : t('portalTeam.actions.deleteRole')}
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
}
