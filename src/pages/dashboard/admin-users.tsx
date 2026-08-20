import { useCallback, useEffect, useMemo, useState } from 'react';
import { Helmet } from 'react-helmet-async';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Card from '@mui/material/Card';
import Chip from '@mui/material/Chip';
import CircularProgress from '@mui/material/CircularProgress';
import Container from '@mui/material/Container';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import Divider from '@mui/material/Divider';
import FormControl from '@mui/material/FormControl';
import InputLabel from '@mui/material/InputLabel';
import MenuItem from '@mui/material/MenuItem';
import Select from '@mui/material/Select';
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
import { useAuthContext } from 'src/auth/hooks';
import { AdminAccessRole } from 'src/auth/types';
import Iconify from 'src/components/iconify';
import { useSettingsContext } from 'src/components/settings';
import { useSnackbar } from 'src/components/snackbar';
import { ACTION_ICONS } from 'src/theme/iconography';
import {
  AdminUsersApiError,
  createAdminUser,
  getAdminUsers,
  reissueAdminSetupToken,
  updateAdminUser,
} from 'src/features/admin-users/api';
import {
  AdminRoleDefinition,
  AdminUsersOverview,
  ManagedAdminUser,
} from 'src/features/admin-users/types';

type SetupLink = {
  email: string;
  fragment: string;
  expiresAt: string;
};

const DEFAULT_ROLE: AdminAccessRole = 'read_only_admin';

export default function AdminUsersPage() {
  const { t, i18n } = useTranslation('admin');
  const settings = useSettingsContext();
  const { user: currentUser } = useAuthContext();
  const { enqueueSnackbar } = useSnackbar();
  const [overview, setOverview] = useState<AdminUsersOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [createOpen, setCreateOpen] = useState(false);
  const [editing, setEditing] = useState<ManagedAdminUser | null>(null);
  const [saving, setSaving] = useState(false);
  const [setupLink, setSetupLink] = useState<SetupLink | null>(null);
  const [email, setEmail] = useState('backoffice@sscdigitalbank.com');
  const [displayName, setDisplayName] = useState('SSC Backoffice Administrator');
  const [accessRole, setAccessRole] = useState<AdminAccessRole>(DEFAULT_ROLE);
  const [editDisplayName, setEditDisplayName] = useState('');
  const [editAccessRole, setEditAccessRole] = useState<AdminAccessRole>(DEFAULT_ROLE);
  const [editStatus, setEditStatus] = useState<'active' | 'disabled'>('active');
  const locale = i18n.resolvedLanguage === 'cn' || i18n.language === 'cn' ? 'zh-CN' : 'en-US';

  const load = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    setError('');
    try {
      setOverview(await getAdminUsers(signal));
    } catch (caught) {
      if (caught instanceof DOMException && caught.name === 'AbortError') return;
      const code = caught instanceof AdminUsersApiError ? caught.code : 'request_failed';
      setError(code);
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    load(controller.signal);
    return () => controller.abort();
  }, [load]);

  const roles = overview?.roles || [];
  const activeCount = overview?.users.filter((item) => item.status === 'active').length || 0;
  const pendingCount =
    overview?.users.filter((item) => !item.setup_completed_at && item.status === 'active').length || 0;

  const errorMessage = useMemo(
    () =>
      error
        ? t(`adminUsers.errors.${error}`, {
            defaultValue: t('adminUsers.errors.request_failed'),
          })
        : '',
    [error, t]
  );

  const openCreate = () => {
    setEmail('backoffice@sscdigitalbank.com');
    setDisplayName('SSC Backoffice Administrator');
    setAccessRole(DEFAULT_ROLE);
    setCreateOpen(true);
  };

  const openEdit = (target: ManagedAdminUser) => {
    setEditing(target);
    setEditDisplayName(target.display_name);
    setEditAccessRole(target.access_role);
    setEditStatus(target.status);
  };

  const showSetupLink = (targetEmail: string, fragment: string, expiresAt: string) => {
    setSetupLink({ email: targetEmail, fragment, expiresAt });
  };

  const handleCreate = async () => {
    setSaving(true);
    setError('');
    try {
      const result = await createAdminUser({
        email: email.trim(),
        display_name: displayName.trim(),
        access_role: accessRole,
      });
      setCreateOpen(false);
      showSetupLink(result.user.email, result.setup_url_fragment, result.expires_at);
      enqueueSnackbar(t('adminUsers.messages.created'), { variant: 'success' });
      await load();
    } catch (caught) {
      setError(caught instanceof AdminUsersApiError ? caught.code : 'request_failed');
    } finally {
      setSaving(false);
    }
  };

  const handleUpdate = async () => {
    if (!editing) return;
    setSaving(true);
    setError('');
    try {
      await updateAdminUser(editing.id, {
        display_name: editDisplayName.trim(),
        access_role: editAccessRole,
        status: editStatus,
        version: editing.version,
      });
      setEditing(null);
      enqueueSnackbar(t('adminUsers.messages.updated'), { variant: 'success' });
      await load();
    } catch (caught) {
      setError(caught instanceof AdminUsersApiError ? caught.code : 'request_failed');
    } finally {
      setSaving(false);
    }
  };

  const handleReissue = async (target: ManagedAdminUser) => {
    setSaving(true);
    setError('');
    try {
      const result = await reissueAdminSetupToken(target.id);
      showSetupLink(target.email, result.setup_url_fragment, result.expires_at);
      enqueueSnackbar(t('adminUsers.messages.linkReissued'), { variant: 'success' });
    } catch (caught) {
      setError(caught instanceof AdminUsersApiError ? caught.code : 'request_failed');
    } finally {
      setSaving(false);
    }
  };

  const fullSetupUrl = setupLink
    ? `${window.location.origin}/admin/setup${setupLink.fragment}`
    : '';

  const copySetupLink = async () => {
    if (!fullSetupUrl) return;
    await navigator.clipboard.writeText(fullSetupUrl);
    enqueueSnackbar(t('adminUsers.messages.linkCopied'), { variant: 'success' });
  };

  return (
    <>
      <Helmet>
        <title>{t('adminUsers.pageTitle')} | SSC Digital Bank</title>
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
            <Typography variant="h4">{t('adminUsers.title')}</Typography>
            <Typography color="text.secondary" sx={{ mt: 0.5 }}>
              {t('adminUsers.description')}
            </Typography>
            <Stack direction="row" spacing={1} sx={{ mt: 1.25 }}>
              <Chip size="small" label={t('adminUsers.summary.active', { count: activeCount })} />
              <Chip
                size="small"
                color={pendingCount ? 'warning' : 'default'}
                label={t('adminUsers.summary.pending', { count: pendingCount })}
              />
            </Stack>
          </Box>
          <Button
            variant="contained"
            startIcon={<Iconify icon="solar:user-plus-bold-duotone" />}
            onClick={openCreate}
          >
            {t('adminUsers.actions.add')}
          </Button>
        </Stack>

        {errorMessage && (
          <Alert severity="error" sx={{ mb: 3 }} onClose={() => setError('')}>
            {errorMessage}
          </Alert>
        )}

        <RoleMatrix roles={roles} t={t} />

        <Card sx={{ mt: 3 }}>
          <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ p: 3 }}>
            <Box>
              <Typography variant="h6">{t('adminUsers.list.title')}</Typography>
              <Typography variant="body2" color="text.secondary">
                {t('adminUsers.list.description')}
              </Typography>
            </Box>
            <Button
              size="small"
              startIcon={<Iconify icon={ACTION_ICONS.refresh} />}
              onClick={() => load()}
              disabled={loading}
            >
              {t('common.refresh')}
            </Button>
          </Stack>
          <Divider />
          {loading && !overview ? (
            <Stack alignItems="center" sx={{ py: 8 }}>
              <CircularProgress size={28} />
            </Stack>
          ) : (
            <TableContainer>
              <Table>
                <TableHead>
                  <TableRow>
                    <TableCell>{t('adminUsers.columns.user')}</TableCell>
                    <TableCell>{t('adminUsers.columns.role')}</TableCell>
                    <TableCell>{t('adminUsers.columns.security')}</TableCell>
                    <TableCell>{t('adminUsers.columns.lastLogin')}</TableCell>
                    <TableCell align="right">{t('common.actions')}</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {(overview?.users || []).map((target) => {
                    const isCurrent = target.id === currentUser?.id;
                    return (
                      <TableRow key={target.id} hover>
                        <TableCell>
                          <Stack spacing={0.25}>
                            <Stack direction="row" spacing={1} alignItems="center">
                              <Typography variant="subtitle2">{target.display_name}</Typography>
                              {isCurrent && (
                                <Chip size="small" color="info" label={t('adminUsers.current')} />
                              )}
                            </Stack>
                            <Typography variant="body2" color="text.secondary">
                              {target.email}
                            </Typography>
                          </Stack>
                        </TableCell>
                        <TableCell>
                          <Chip
                            size="small"
                            color={target.access_role === 'super_admin' ? 'primary' : 'default'}
                            label={t(`adminUsers.roles.${target.access_role}.name`)}
                          />
                        </TableCell>
                        <TableCell>
                          <Stack direction="row" spacing={0.75} flexWrap="wrap" useFlexGap>
                            <Chip
                              size="small"
                              color={target.status === 'active' ? 'success' : 'default'}
                              label={t(`adminUsers.status.${target.status}`)}
                            />
                            <Chip
                              size="small"
                              variant="outlined"
                              color={target.totp_enabled ? 'success' : 'warning'}
                              label={
                                target.totp_enabled
                                  ? t('adminUsers.security.totpReady')
                                  : t('adminUsers.security.pendingSetup')
                              }
                            />
                          </Stack>
                        </TableCell>
                        <TableCell>
                          {target.last_login_at
                            ? new Intl.DateTimeFormat(locale, {
                                dateStyle: 'medium',
                                timeStyle: 'short',
                              }).format(new Date(target.last_login_at))
                            : t('adminUsers.never')}
                        </TableCell>
                        <TableCell align="right">
                          <Stack direction="row" spacing={1} justifyContent="flex-end">
                            {!target.setup_completed_at && target.status === 'active' && (
                              <Button size="small" onClick={() => handleReissue(target)} disabled={saving}>
                                {t('adminUsers.actions.reissue')}
                              </Button>
                            )}
                            <Button size="small" onClick={() => openEdit(target)}>
                              {t('adminUsers.actions.manage')}
                            </Button>
                          </Stack>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </TableContainer>
          )}
        </Card>
      </Container>

      <Dialog open={createOpen} onClose={() => !saving && setCreateOpen(false)} fullWidth maxWidth="sm">
        <DialogTitle>{t('adminUsers.create.title')}</DialogTitle>
        <DialogContent>
          <Stack spacing={2.5} sx={{ pt: 1 }}>
            <Alert severity="info">{t('adminUsers.create.noDefaultPassword')}</Alert>
            <TextField
              label={t('adminUsers.fields.email')}
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              autoFocus
              required
            />
            <TextField
              label={t('adminUsers.fields.displayName')}
              value={displayName}
              onChange={(event) => setDisplayName(event.target.value)}
              required
            />
            <RoleSelect value={accessRole} onChange={setAccessRole} roles={roles} t={t} />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setCreateOpen(false)} disabled={saving}>
            {t('common.cancel')}
          </Button>
          <Button
            variant="contained"
            onClick={handleCreate}
            disabled={saving || !email.trim() || !displayName.trim()}
          >
            {t('adminUsers.actions.create')}
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog open={Boolean(editing)} onClose={() => !saving && setEditing(null)} fullWidth maxWidth="sm">
        <DialogTitle>{t('adminUsers.edit.title')}</DialogTitle>
        <DialogContent>
          <Stack spacing={2.5} sx={{ pt: 1 }}>
            <TextField
              label={t('adminUsers.fields.email')}
              value={editing?.email || ''}
              disabled
            />
            <TextField
              label={t('adminUsers.fields.displayName')}
              value={editDisplayName}
              onChange={(event) => setEditDisplayName(event.target.value)}
              required
            />
            <RoleSelect
              value={editAccessRole}
              onChange={setEditAccessRole}
              roles={roles}
              t={t}
              disabled={editing?.id === currentUser?.id}
            />
            <FormControl fullWidth disabled={editing?.id === currentUser?.id}>
              <InputLabel>{t('adminUsers.fields.status')}</InputLabel>
              <Select
                value={editStatus}
                label={t('adminUsers.fields.status')}
                onChange={(event) => setEditStatus(event.target.value as 'active' | 'disabled')}
              >
                <MenuItem value="active">{t('adminUsers.status.active')}</MenuItem>
                <MenuItem value="disabled">{t('adminUsers.status.disabled')}</MenuItem>
              </Select>
            </FormControl>
            {editing?.id === currentUser?.id && (
              <Alert severity="info">{t('adminUsers.edit.selfProtection')}</Alert>
            )}
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setEditing(null)} disabled={saving}>
            {t('common.cancel')}
          </Button>
          <Button
            variant="contained"
            onClick={handleUpdate}
            disabled={saving || !editDisplayName.trim()}
          >
            {t('adminUsers.actions.save')}
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog open={Boolean(setupLink)} onClose={() => setSetupLink(null)} fullWidth maxWidth="sm">
        <DialogTitle>{t('adminUsers.setup.title')}</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ pt: 1 }}>
            <Alert severity="warning">{t('adminUsers.setup.oneTime')}</Alert>
            <Typography variant="body2" color="text.secondary">
              {t('adminUsers.setup.recipient', { email: setupLink?.email })}
            </Typography>
            <TextField value={fullSetupUrl} multiline minRows={3} InputProps={{ readOnly: true }} />
            <Typography variant="caption" color="text.secondary">
              {setupLink?.expiresAt
                ? t('adminUsers.setup.expires', {
                    time: new Intl.DateTimeFormat(locale, {
                      dateStyle: 'medium',
                      timeStyle: 'short',
                    }).format(new Date(setupLink.expiresAt)),
                  })
                : ''}
            </Typography>
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setSetupLink(null)}>{t('adminUsers.actions.close')}</Button>
          <Button variant="contained" startIcon={<Iconify icon={ACTION_ICONS.copy} />} onClick={copySetupLink}>
            {t('adminUsers.actions.copyLink')}
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
}

function RoleMatrix({ roles, t }: { roles: AdminRoleDefinition[]; t: (key: string) => string }) {
  return (
    <Card sx={{ p: 3 }}>
      <Typography variant="h6">{t('adminUsers.matrix.title')}</Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2.5 }}>
        {t('adminUsers.matrix.description')}
      </Typography>
      <Box
        sx={{
          display: 'grid',
          gridTemplateColumns: { xs: '1fr', md: 'repeat(4, minmax(0, 1fr))' },
          gap: 1.5,
        }}
      >
        {roles.map((role) => (
          <Box
            key={role.code}
            sx={{
              p: 2,
              border: (theme) => `1px solid ${theme.palette.divider}`,
              borderRadius: 1.5,
              bgcolor: role.code === 'super_admin' ? 'primary.lighter' : 'background.neutral',
            }}
          >
            <Typography variant="subtitle2">{t(`adminUsers.roles.${role.code}.name`)}</Typography>
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.5 }}>
              {t(`adminUsers.roles.${role.code}.description`)}
            </Typography>
            <Stack spacing={0.75} sx={{ mt: 1.5 }}>
              {role.permissions.map((permission) => (
                <Stack key={permission} direction="row" spacing={0.75} alignItems="center">
                  <Iconify icon="solar:check-circle-bold" width={16} sx={{ color: 'success.main' }} />
                  <Typography variant="caption">{t(`adminUsers.permissions.${permission}`)}</Typography>
                </Stack>
              ))}
            </Stack>
          </Box>
        ))}
      </Box>
    </Card>
  );
}

function RoleSelect({
  value,
  onChange,
  roles,
  t,
  disabled = false,
}: {
  value: AdminAccessRole;
  onChange: (value: AdminAccessRole) => void;
  roles: AdminRoleDefinition[];
  t: (key: string) => string;
  disabled?: boolean;
}) {
  return (
    <FormControl fullWidth disabled={disabled}>
      <InputLabel>{t('adminUsers.fields.role')}</InputLabel>
      <Select
        value={value}
        label={t('adminUsers.fields.role')}
        onChange={(event) => onChange(event.target.value as AdminAccessRole)}
      >
        {roles.map((role) => (
          <MenuItem key={role.code} value={role.code}>
            {t(`adminUsers.roles.${role.code}.name`)}
          </MenuItem>
        ))}
      </Select>
    </FormControl>
  );
}
