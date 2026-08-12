import { m } from 'framer-motion';
import { useTranslation } from 'react-i18next';
// @mui
import { alpha } from '@mui/material/styles';
import Box from '@mui/material/Box';
import Stack from '@mui/material/Stack';
import Avatar from '@mui/material/Avatar';
import Divider from '@mui/material/Divider';
import MenuItem from '@mui/material/MenuItem';
import IconButton from '@mui/material/IconButton';
import Typography from '@mui/material/Typography';
// routes
import { useRouter } from 'src/routes/hooks';
// components
import Iconify from 'src/components/iconify';
import { varHover } from 'src/components/animate';
import { useSnackbar } from 'src/components/snackbar';
import CustomPopover, { usePopover } from 'src/components/custom-popover';
import { useAuthContext } from 'src/auth/hooks';
import { getRoleLogin, getUserHome } from 'src/auth/role-access';

// ----------------------------------------------------------------------

export default function AccountPopover() {
  const { t } = useTranslation('common');

  const router = useRouter();

  const { enqueueSnackbar } = useSnackbar();

  const popover = usePopover();

  const { user, logout } = useAuthContext();
  const role = user?.role;
  let roleLabel = '';
  if (role === 'partner') roleLabel = t('account.partner_role');
  if (role === 'admin') roleLabel = t('account.admin_role');

  const identity = {
    displayName: user?.displayName || user?.email?.split('@')[0] || '',
    email: user?.email || '',
    home: getUserHome(user),
    role: roleLabel,
    photoURL: user?.photoURL || undefined,
  };

  const handleLogout = async () => {
    popover.onClose();
    const loginPath = role ? getRoleLogin(role) : '/';
    try {
      await logout();
    } catch {
      enqueueSnackbar(t('account.logout_failed'), { variant: 'warning' });
    } finally {
      router.replace(loginPath);
    }
  };

  const handleClickItem = (path: string) => {
    popover.onClose();
    router.push(path);
  };

  return (
    <>
      <IconButton
        aria-label={identity.displayName}
        component={m.button}
        whileTap="tap"
        whileHover="hover"
        variants={varHover(1.05)}
        onClick={popover.onOpen}
        sx={{
          width: 40,
          height: 40,
          background: (theme) => alpha(theme.palette.grey[500], 0.08),
          ...(popover.open && {
            background: (theme) =>
              `linear-gradient(135deg, ${theme.palette.primary.light} 0%, ${theme.palette.primary.main} 100%)`,
          }),
        }}
      >
        <Avatar
          alt={identity.displayName}
          src={identity.photoURL}
          sx={{
            width: 36,
            height: 36,
            border: (theme) => `solid 2px ${theme.palette.background.default}`,
          }}
        >
          {identity.displayName.charAt(0).toUpperCase() || '•'}
        </Avatar>
      </IconButton>

      <CustomPopover open={popover.open} onClose={popover.onClose} sx={{ width: 240, p: 0 }}>
        <Box sx={{ p: 2, pb: 1.5 }}>
          <Typography variant="subtitle2" noWrap>
            {identity.displayName}
          </Typography>

          <Typography variant="body2" sx={{ color: 'text.secondary' }} noWrap>
            {identity.email}
          </Typography>
          <Typography variant="caption" sx={{ color: 'text.disabled' }} noWrap>
            {identity.role}
          </Typography>
        </Box>

        <Divider sx={{ borderStyle: 'dashed' }} />

        <Stack sx={{ p: 1 }}>
          <MenuItem onClick={() => handleClickItem(identity.home)}>
            <Iconify icon="solar:home-2-bold-duotone" width={20} sx={{ mr: 1.5 }} />
            {t('account.back_home')}
          </MenuItem>
        </Stack>

        <Divider sx={{ borderStyle: 'dashed' }} />

        <MenuItem
          onClick={handleLogout}
          sx={{ m: 1, fontWeight: 'fontWeightBold', color: 'error.main' }}
        >
          <Iconify icon="solar:logout-2-linear" width={20} sx={{ mr: 1.5 }} />
          {t('account.logout')}
        </MenuItem>
      </CustomPopover>
    </>
  );
}
