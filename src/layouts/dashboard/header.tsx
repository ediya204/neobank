// @mui
import { useTheme } from '@mui/material/styles';
import Stack from '@mui/material/Stack';
import Box from '@mui/material/Box';
import AppBar from '@mui/material/AppBar';
import Toolbar from '@mui/material/Toolbar';
import IconButton from '@mui/material/IconButton';
import Typography from '@mui/material/Typography';
import { useTranslation } from 'react-i18next';
// theme
import { bgBlur } from 'src/theme/css';
// hooks
import { useOffSetTop } from 'src/hooks/use-off-set-top';
import { useResponsive } from 'src/hooks/use-responsive';
import { usePathname } from 'src/routes/hooks';
import { useAuthContext } from 'src/auth/hooks';
// components
import Logo from 'src/components/logo';
import SvgColor from 'src/components/svg-color';
import { useSettingsContext } from 'src/components/settings';
//
import { HEADER, NAV } from '../config-layout';
import {
  AccountPopover,
  LanguagePopover,
  NotificationsPopover,
  Searchbar,
  SettingsButton,
} from '../_common';

// ----------------------------------------------------------------------

type Props = {
  onOpenNav?: VoidFunction;
};

export default function Header({ onOpenNav }: Props) {
  const { t } = useTranslation('common');
  const theme = useTheme();

  const settings = useSettingsContext();
  const { user } = useAuthContext();

  const isNavHorizontal = settings.themeLayout === 'horizontal';

  const isNavMini = settings.themeLayout === 'mini';

  const lgUp = useResponsive('up', 'lg');
  const xlUp = useResponsive('up', 'xl');

  const offset = useOffSetTop(HEADER.H_DESKTOP);

  const offsetTop = offset && !isNavHorizontal;
  const pathname = usePathname();
  const isPortal = pathname.startsWith('/portal');
  const desktopUp = isPortal ? xlUp : lgUp;
  const identity = user?.email || '';

  const renderContent = (
    <>
      {desktopUp && isNavHorizontal && <Logo sx={{ mr: 2.5 }} />}

      {!desktopUp && (
        <IconButton
          aria-label={t('header.open_navigation')}
          onClick={onOpenNav}
          sx={{ width: 44, height: 44 }}
        >
          <SvgColor src="/assets/icons/navbar/ic_menu_item.svg" />
        </IconButton>
      )}

      <Stack
        flexGrow={1}
        direction="row"
        alignItems="center"
        justifyContent="flex-end"
        spacing={{ xs: 0.5, sm: 1 }}
        sx={{
          minWidth: 0,
          '& .MuiIconButton-root': {
            width: 44,
            height: 44,
          },
        }}
      >
        <Box sx={{ display: { xs: isPortal ? 'none' : 'block', sm: 'block' } }}>
          <Searchbar />
        </Box>
        <LanguagePopover />
        <NotificationsPopover />
        <Box sx={{ display: { xs: isPortal ? 'none' : 'block', sm: 'block' } }}>
          <SettingsButton />
        </Box>
        <Typography
          variant="body2"
          color="text.secondary"
          sx={{ display: { xs: 'none', md: 'block' }, pl: 0.5 }}
        >
          {identity}
        </Typography>
        <AccountPopover />
      </Stack>
    </>
  );

  return (
    <AppBar
      sx={{
        height: HEADER.H_MOBILE,
        zIndex: theme.zIndex.appBar + 1,
        ...bgBlur({
          color: theme.palette.background.default,
        }),
        transition: theme.transitions.create(['height'], {
          duration: theme.transitions.duration.shorter,
        }),
        ...(desktopUp && {
          width: `calc(100% - ${NAV.W_VERTICAL + 1}px)`,
          height: HEADER.H_DESKTOP,
          ...(offsetTop && {
            height: HEADER.H_DESKTOP_OFFSET,
          }),
          ...(isNavHorizontal && {
            width: 1,
            bgcolor: 'background.default',
            height: HEADER.H_DESKTOP_OFFSET,
            borderBottom: `dashed 1px ${theme.palette.divider}`,
          }),
          ...(isNavMini && {
            width: `calc(100% - ${NAV.W_MINI + 1}px)`,
          }),
        }),
      }}
    >
      <Toolbar
        sx={{
          height: 1,
          px: { xs: 1, sm: 2, lg: 5 },
        }}
      >
        {renderContent}
      </Toolbar>
    </AppBar>
  );
}
