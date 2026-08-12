import { useTranslation } from 'react-i18next';
// @mui
import { useTheme } from '@mui/material/styles';
import IconButton, { IconButtonProps } from '@mui/material/IconButton';
// hooks
import { useResponsive } from 'src/hooks/use-responsive';
import { usePathname } from 'src/routes/hooks';
// theme
import { bgBlur } from 'src/theme/css';
// components
import Iconify from 'src/components/iconify';
import { useSettingsContext } from 'src/components/settings';
//
import { NAV } from '../config-layout';

// ----------------------------------------------------------------------

export default function NavToggleButton({ sx, ...other }: IconButtonProps) {
  const { t } = useTranslation('common');

  const theme = useTheme();

  const settings = useSettingsContext();

  const pathname = usePathname();
  const lgUp = useResponsive('up', 'lg');
  const xlUp = useResponsive('up', 'xl');
  const desktopUp = pathname.startsWith('/portal') ? xlUp : lgUp;

  if (!desktopUp) {
    return null;
  }

  return (
    <IconButton
      aria-label={
        settings.themeLayout === 'vertical'
          ? t('settings.collapse_navigation')
          : t('settings.expand_navigation')
      }
      size="small"
      onClick={() =>
        settings.onUpdate('themeLayout', settings.themeLayout === 'vertical' ? 'mini' : 'vertical')
      }
      sx={{
        p: 0.5,
        top: 32,
        position: 'fixed',
        left: NAV.W_VERTICAL - 12,
        zIndex: theme.zIndex.appBar + 1,
        border: `dashed 1px ${theme.palette.divider}`,
        ...bgBlur({ opacity: 0.48, color: theme.palette.background.default }),
        '&:hover': {
          bgcolor: 'background.default',
        },
        ...sx,
      }}
      {...other}
    >
      <Iconify
        width={16}
        icon={
          settings.themeLayout === 'vertical'
            ? 'solar:alt-arrow-left-linear'
            : 'solar:alt-arrow-right-linear'
        }
      />
    </IconButton>
  );
}
