// @mui
import Box, { BoxProps } from '@mui/material/Box';
// hooks
import { useResponsive } from 'src/hooks/use-responsive';
import { usePathname } from 'src/routes/hooks';
// components
import { useSettingsContext } from 'src/components/settings';
//
import { HEADER, NAV } from '../config-layout';

// ----------------------------------------------------------------------

const SPACING = 8;

export default function Main({ children, sx, ...other }: BoxProps) {
  const settings = useSettingsContext();

  const pathname = usePathname();
  const lgUp = useResponsive('up', 'lg');
  const xlUp = useResponsive('up', 'xl');
  const desktopUp = pathname.startsWith('/portal') ? xlUp : lgUp;

  const isNavHorizontal = settings.themeLayout === 'horizontal';

  const isNavMini = settings.themeLayout === 'mini';

  if (isNavHorizontal) {
    return (
      <Box
        component="main"
        sx={{
          minHeight: 1,
          display: 'flex',
          flexDirection: 'column',
          pt: `${HEADER.H_MOBILE + 24}px`,
          pb: 10,
          ...(desktopUp && {
            pt: `${HEADER.H_MOBILE * 2 + 40}px`,
            pb: 15,
          }),
        }}
      >
        {children}
      </Box>
    );
  }

  return (
    <Box
      component="main"
      sx={{
        flexGrow: 1,
        width: 1,
        minWidth: 0,
        minHeight: 1,
        display: 'flex',
        flexDirection: 'column',
        py: `${HEADER.H_MOBILE + SPACING}px`,
        ...(desktopUp && {
          px: 2,
          py: `${HEADER.H_DESKTOP + SPACING}px`,
          width: `calc(100% - ${NAV.W_VERTICAL}px)`,
          ...(isNavMini && {
            width: `calc(100% - ${NAV.W_MINI}px)`,
          }),
        }),
        ...sx,
      }}
      {...other}
    >
      {children}
    </Box>
  );
}
