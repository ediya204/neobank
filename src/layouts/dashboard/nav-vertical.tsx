import { useEffect } from 'react';
// @mui
import Box from '@mui/material/Box';
import Stack from '@mui/material/Stack';
import Drawer from '@mui/material/Drawer';
import IconButton from '@mui/material/IconButton';
import { useTranslation } from 'react-i18next';
// hooks
import { useResponsive } from 'src/hooks/use-responsive';
import { useAuthContext } from 'src/auth/hooks';
// components
import Logo from 'src/components/logo';
import Scrollbar from 'src/components/scrollbar';
import { usePathname } from 'src/routes/hooks';
import { NavSectionVertical } from 'src/components/nav-section';
import Iconify from 'src/components/iconify';
//
import { NAV } from '../config-layout';
import { useNavData } from './config-navigation';
import { NavToggleButton } from '../_common';

// ----------------------------------------------------------------------

type Props = {
  openNav: boolean;
  onCloseNav: VoidFunction;
};

export default function NavVertical({ openNav, onCloseNav }: Props) {
  const { t } = useTranslation('common');
  const { user } = useAuthContext();

  const pathname = usePathname();

  const lgUp = useResponsive('up', 'lg');
  const xlUp = useResponsive('up', 'xl');
  const desktopUp = pathname.startsWith('/portal') ? xlUp : lgUp;

  const navData = useNavData();

  useEffect(() => {
    if (openNav) {
      onCloseNav();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname]);

  const renderContent = (
    <Scrollbar
      sx={{
        height: 1,
        '& .simplebar-content': {
          height: 1,
          display: 'flex',
          flexDirection: 'column',
        },
      }}
    >
      <Stack
        direction="row"
        alignItems="center"
        justifyContent="space-between"
        sx={{ mt: 3, ml: 4, mr: 2, mb: 1 }}
      >
        <Logo />
        {!desktopUp && (
          <IconButton
            aria-label={t('header.close_navigation')}
            onClick={onCloseNav}
            sx={{ width: 44, height: 44 }}
          >
            <Iconify icon="solar:close-circle-linear" width={24} />
          </IconButton>
        )}
      </Stack>

      <NavSectionVertical
        data={navData}
        config={{
          currentRole: user?.role || 'admin',
        }}
      />

      <Box sx={{ flexGrow: 1 }} />
    </Scrollbar>
  );

  return (
    <Box
      component="nav"
      sx={{
        ...(desktopUp && {
          flexShrink: 0,
          width: NAV.W_VERTICAL,
        }),
      }}
    >
      <NavToggleButton />

      {desktopUp ? (
        <Stack
          sx={{
            height: 1,
            position: 'fixed',
            width: NAV.W_VERTICAL,
            borderRight: (theme) => `dashed 1px ${theme.palette.divider}`,
          }}
        >
          {renderContent}
        </Stack>
      ) : (
        <Drawer
          open={openNav}
          onClose={onCloseNav}
          PaperProps={{
            sx: {
              width: NAV.W_VERTICAL,
            },
          }}
        >
          {renderContent}
        </Drawer>
      )}
    </Box>
  );
}
