import { useState } from 'react';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Card from '@mui/material/Card';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import Divider from '@mui/material/Divider';
import IconButton from '@mui/material/IconButton';
import Stack from '@mui/material/Stack';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableContainer from '@mui/material/TableContainer';
import TableHead from '@mui/material/TableHead';
import TableRow from '@mui/material/TableRow';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import { useTranslation } from 'react-i18next';
import Iconify from 'src/components/iconify';
import { hasPortalTeamPermission, PORTAL_TEAM_PERMISSIONS } from '../permissions';
import { PortalTeamCurrentUser, PortalTeamInvitation } from '../types';
import { InvitationStatusLabel, TeamRoleLabel } from './team-labels';

type Props = {
  invitations: PortalTeamInvitation[];
  currentUser: PortalTeamCurrentUser | null;
  locale: string;
  busy: boolean;
  onRevoke: (invitation: PortalTeamInvitation) => Promise<unknown>;
};

function formatDate(value: string | null, locale: string, fallback: string) {
  if (!value) return fallback;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return fallback;
  return new Intl.DateTimeFormat(locale, { dateStyle: 'medium' }).format(date);
}

export default function InvitationList({
  invitations,
  currentUser,
  locale,
  busy,
  onRevoke,
}: Props) {
  const { t } = useTranslation('portal');
  const [revokeInvitation, setRevokeInvitation] = useState<PortalTeamInvitation | null>(null);
  const fallback = t('portalTeam.common.notAvailable');
  const canRevoke = hasPortalTeamPermission(currentUser, PORTAL_TEAM_PERMISSIONS.revokeInvitations);

  const submitRevoke = async () => {
    if (!revokeInvitation) return;
    try {
      await onRevoke(revokeInvitation);
      setRevokeInvitation(null);
    } catch {
      // The page-level mutation alert keeps the dialog recoverable.
    }
  };

  if (!invitations.length) {
    return (
      <Stack alignItems="center" justifyContent="center" sx={{ minHeight: 280, px: 3 }}>
        <Iconify
          icon="solar:letter-unread-bold-duotone"
          width={44}
          sx={{ color: 'text.disabled', mb: 1.5 }}
        />
        <Typography variant="subtitle1">{t('portalTeam.invitations.empty')}</Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
          {t('portalTeam.invitations.emptyDetail')}
        </Typography>
      </Stack>
    );
  }

  const revokeButton = (invitation: PortalTeamInvitation) =>
    canRevoke && invitation.status === 'pending' ? (
      <Tooltip title={t('portalTeam.actions.revokeInvitation')}>
        <IconButton
          size="small"
          color="error"
          aria-label={t('portalTeam.invitations.revokeFor', { email: invitation.email })}
          onClick={() => setRevokeInvitation(invitation)}
        >
          <Iconify icon="solar:trash-bin-trash-bold-duotone" />
        </IconButton>
      </Tooltip>
    ) : null;

  return (
    <>
      <TableContainer sx={{ display: { xs: 'none', md: 'block' } }}>
        <Table
          size="small"
          sx={{
            minWidth: 880,
            '& .MuiTableCell-root': { py: 1.5, whiteSpace: 'nowrap' },
          }}
        >
          <TableHead>
            <TableRow>
              <TableCell>{t('portalTeam.columns.email')}</TableCell>
              <TableCell>{t('portalTeam.columns.role')}</TableCell>
              <TableCell>{t('portalTeam.columns.status')}</TableCell>
              <TableCell>{t('portalTeam.columns.invited')}</TableCell>
              <TableCell>{t('portalTeam.columns.expires')}</TableCell>
              <TableCell align="right">{t('portalTeam.columns.actions')}</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {invitations.map((invitation) => (
              <TableRow hover key={invitation.id}>
                <TableCell>
                  <Stack direction="row" alignItems="center" spacing={1.25}>
                    <Box
                      sx={{
                        width: 32,
                        height: 32,
                        borderRadius: 1,
                        display: 'grid',
                        placeItems: 'center',
                        color: 'text.secondary',
                        bgcolor: 'background.neutral',
                      }}
                    >
                      <Iconify icon="solar:letter-bold-duotone" width={18} />
                    </Box>
                    <Typography variant="body2">{invitation.email}</Typography>
                  </Stack>
                </TableCell>
                <TableCell>
                  <TeamRoleLabel role={invitation.role} />
                </TableCell>
                <TableCell>
                  <InvitationStatusLabel status={invitation.status} />
                </TableCell>
                <TableCell>{formatDate(invitation.created_at, locale, fallback)}</TableCell>
                <TableCell>{formatDate(invitation.expires_at, locale, fallback)}</TableCell>
                <TableCell align="right">{revokeButton(invitation)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableContainer>

      <Stack
        spacing={1.5}
        sx={{ display: { xs: 'flex', md: 'none' }, p: 2, bgcolor: 'background.neutral' }}
      >
        {invitations.map((invitation) => (
          <Card key={invitation.id} sx={{ p: 2, boxShadow: 'none' }}>
            <Stack direction="row" alignItems="flex-start" justifyContent="space-between">
              <Box sx={{ minWidth: 0 }}>
                <Typography variant="subtitle2" noWrap>
                  {invitation.email}
                </Typography>
                <Stack direction="row" spacing={1} sx={{ mt: 1 }}>
                  <TeamRoleLabel role={invitation.role} />
                  <InvitationStatusLabel status={invitation.status} />
                </Stack>
              </Box>
              {revokeButton(invitation)}
            </Stack>
            <Divider sx={{ my: 1.5 }} />
            <Stack direction="row" justifyContent="space-between" spacing={2}>
              <Box>
                <Typography variant="caption" color="text.disabled">
                  {t('portalTeam.columns.invited')}
                </Typography>
                <Typography variant="body2">
                  {formatDate(invitation.created_at, locale, fallback)}
                </Typography>
              </Box>
              <Box sx={{ textAlign: 'right' }}>
                <Typography variant="caption" color="text.disabled">
                  {t('portalTeam.columns.expires')}
                </Typography>
                <Typography variant="body2">
                  {formatDate(invitation.expires_at, locale, fallback)}
                </Typography>
              </Box>
            </Stack>
          </Card>
        ))}
      </Stack>

      <Dialog
        open={Boolean(revokeInvitation)}
        onClose={() => !busy && setRevokeInvitation(null)}
        fullWidth
        maxWidth="xs"
      >
        <DialogTitle>{t('portalTeam.revokeInvitation.title')}</DialogTitle>
        <DialogContent dividers>
          <Typography variant="body2" color="text.secondary">
            {t('portalTeam.revokeInvitation.description', {
              email: revokeInvitation?.email || '',
            })}
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button color="inherit" disabled={busy} onClick={() => setRevokeInvitation(null)}>
            {t('portalTeam.actions.cancel')}
          </Button>
          <Button variant="contained" color="error" disabled={busy} onClick={submitRevoke}>
            {busy ? t('portalTeam.actions.saving') : t('portalTeam.actions.revokeInvitation')}
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
}
