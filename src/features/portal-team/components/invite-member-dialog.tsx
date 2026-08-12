import { FormEvent, useEffect, useMemo, useState } from 'react';
import Alert from '@mui/material/Alert';
import Button from '@mui/material/Button';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import MenuItem from '@mui/material/MenuItem';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import { useTranslation } from 'react-i18next';
import Iconify from 'src/components/iconify';
import {
  InvitePortalTeamMemberInput,
  PortalTeamInvitationCreateResult,
  PortalTeamRoleDefinition,
} from '../types';

type Props = {
  open: boolean;
  roles: PortalTeamRoleDefinition[];
  submitting: boolean;
  error: string;
  onClose: VoidFunction;
  onSubmit: (input: InvitePortalTeamMemberInput) => Promise<PortalTeamInvitationCreateResult>;
};

export default function InviteMemberDialog({
  open,
  roles,
  submitting,
  error,
  onClose,
  onSubmit,
}: Props) {
  const { t } = useTranslation('portal');
  const assignableRoles = useMemo(
    () => roles.filter((role) => role.assignable !== false && role.code !== 'owner'),
    [roles]
  );
  const [email, setEmail] = useState('');
  const [role, setRole] = useState('viewer');
  const [validationError, setValidationError] = useState('');
  const [createdInvitation, setCreatedInvitation] =
    useState<PortalTeamInvitationCreateResult | null>(null);
  const [copied, setCopied] = useState(false);
  const selectedRole = assignableRoles.find((option) => option.id === role);

  useEffect(() => {
    if (!open) return;
    setEmail('');
    setRole(
      assignableRoles.find((option) => option.code === 'viewer')?.id || assignableRoles[0]?.id || ''
    );
    setValidationError('');
    setCreatedInvitation(null);
    setCopied(false);
  }, [assignableRoles, open]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setValidationError('');
    const normalizedEmail = email.trim().toLowerCase();
    if (!/^\S+@\S+\.\S+$/.test(normalizedEmail)) {
      setValidationError(t('portalTeam.invite.emailInvalid'));
      return;
    }
    if (!role) {
      setValidationError(t('portalTeam.invite.roleRequired'));
      return;
    }
    try {
      setCreatedInvitation(await onSubmit({ email: normalizedEmail, role_id: role }));
    } catch {
      // The parent renders the localized mutation error inside this dialog.
    }
  };

  const copySetupLink = async () => {
    if (!createdInvitation?.setup_url) return;
    try {
      await navigator.clipboard.writeText(createdInvitation.setup_url);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };

  return (
    <Dialog
      open={open}
      onClose={() => !submitting && onClose()}
      fullWidth
      maxWidth="sm"
      PaperProps={{ component: 'form', onSubmit: submit }}
    >
      <DialogTitle>{t('portalTeam.invite.title')}</DialogTitle>
      <DialogContent dividers>
        {createdInvitation ? (
          <Stack spacing={2.5}>
            <Alert severity="success">{t('portalTeam.invite.success')}</Alert>
            <Stack spacing={0.5}>
              <Typography variant="subtitle2">{createdInvitation.invitation.email}</Typography>
              <Typography variant="body2" color="text.secondary">
                {t('portalTeam.invite.successDetail')}
              </Typography>
            </Stack>
            {createdInvitation.setup_url && (
              <Stack spacing={1}>
                <TextField
                  fullWidth
                  value={createdInvitation.setup_url}
                  label={t('portalTeam.invite.setupLink')}
                  InputProps={{ readOnly: true }}
                />
                <Button
                  color="inherit"
                  variant="outlined"
                  startIcon={<Iconify icon="solar:copy-bold-duotone" />}
                  onClick={copySetupLink}
                >
                  {copied ? t('portalTeam.invite.linkCopied') : t('portalTeam.invite.copyLink')}
                </Button>
                <Typography variant="caption" color="text.secondary">
                  {t('portalTeam.invite.setupLinkNotice')}
                </Typography>
              </Stack>
            )}
          </Stack>
        ) : (
          <Stack spacing={2.5} sx={{ pt: 1 }}>
            <Typography variant="body2" color="text.secondary">
              {t('portalTeam.invite.description')}
            </Typography>
            <TextField
              autoFocus
              required
              type="email"
              label={t('portalTeam.invite.email')}
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              autoComplete="off"
            />
            <TextField
              select
              required
              label={t('portalTeam.invite.role')}
              value={role}
              onChange={(event) => setRole(event.target.value)}
            >
              {assignableRoles.map((option) => (
                <MenuItem key={option.id} value={option.id}>
                  {t(`portalTeam.roles.${option.code}`, {
                    defaultValue: option.name || option.code,
                  })}
                </MenuItem>
              ))}
            </TextField>
            {role && (
              <Alert severity="info" icon={<Iconify icon="solar:shield-user-bold-duotone" />}>
                {t(`portalTeam.roleDescriptions.${selectedRole?.code || 'viewer'}`, {
                  defaultValue:
                    selectedRole?.description || selectedRole?.name || selectedRole?.code || '',
                })}
              </Alert>
            )}
            {(validationError || error) && (
              <Alert severity="error">{validationError || error}</Alert>
            )}
          </Stack>
        )}
      </DialogContent>
      <DialogActions>
        <Button color="inherit" disabled={submitting} onClick={onClose}>
          {createdInvitation ? t('portalTeam.actions.done') : t('portalTeam.actions.cancel')}
        </Button>
        {!createdInvitation && (
          <Button
            type="submit"
            variant="contained"
            disabled={submitting || !assignableRoles.length}
          >
            {submitting ? t('portalTeam.invite.submitting') : t('portalTeam.invite.submit')}
          </Button>
        )}
      </DialogActions>
    </Dialog>
  );
}
