import InputAdornment from '@mui/material/InputAdornment';
import MenuItem from '@mui/material/MenuItem';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import { useTranslation } from 'react-i18next';
import Iconify from 'src/components/iconify';
import { PortalTeamRoleDefinition } from '../types';

type Props = {
  query: string;
  status: string;
  role: string;
  roles: PortalTeamRoleDefinition[];
  statusType: 'member' | 'invitation';
  onQueryChange: (value: string) => void;
  onStatusChange: (value: string) => void;
  onRoleChange: (value: string) => void;
};

const MEMBER_STATUSES = ['onboarding', 'active', 'suspended'];
const INVITATION_STATUSES = ['pending', 'expired', 'accepted', 'revoked'];

export default function TeamToolbar({
  query,
  status,
  role,
  roles,
  statusType,
  onQueryChange,
  onStatusChange,
  onRoleChange,
}: Props) {
  const { t } = useTranslation('portal');
  const statuses = statusType === 'member' ? MEMBER_STATUSES : INVITATION_STATUSES;
  const statusPrefix =
    statusType === 'member' ? 'portalTeam.memberStatuses' : 'portalTeam.invitationStatuses';

  return (
    <Stack
      direction={{ xs: 'column', md: 'row' }}
      spacing={1.25}
      sx={{ px: { xs: 2, md: 2.5 }, py: 1.75 }}
    >
      <TextField
        fullWidth
        size="small"
        value={query}
        onChange={(event) => onQueryChange(event.target.value)}
        placeholder={t('portalTeam.filters.searchPlaceholder')}
        inputProps={{ 'aria-label': t('portalTeam.filters.searchLabel') }}
        InputProps={{
          startAdornment: (
            <InputAdornment position="start">
              <Iconify icon="eva:search-fill" sx={{ color: 'text.disabled' }} />
            </InputAdornment>
          ),
        }}
      />

      <TextField
        select
        size="small"
        label={t('portalTeam.filters.status')}
        value={status}
        onChange={(event) => onStatusChange(event.target.value)}
        sx={{ minWidth: { md: 180 } }}
      >
        <MenuItem value="all">{t('portalTeam.filters.allStatuses')}</MenuItem>
        {statuses.map((value) => (
          <MenuItem key={value} value={value}>
            {t(`${statusPrefix}.${value}`)}
          </MenuItem>
        ))}
      </TextField>

      <TextField
        select
        size="small"
        label={t('portalTeam.filters.role')}
        value={role}
        onChange={(event) => onRoleChange(event.target.value)}
        sx={{ minWidth: { md: 180 } }}
      >
        <MenuItem value="all">{t('portalTeam.filters.allRoles')}</MenuItem>
        {roles.map((option) => (
          <MenuItem key={option.id} value={option.code}>
            {t(`portalTeam.roles.${option.code}`, {
              defaultValue: option.name || option.code,
            })}
          </MenuItem>
        ))}
      </TextField>
    </Stack>
  );
}
