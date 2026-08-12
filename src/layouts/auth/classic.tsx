import { useTranslation } from 'react-i18next';
import { alpha, useTheme } from '@mui/material/styles';
import Box from '@mui/material/Box';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import { useResponsive } from 'src/hooks/use-responsive';
import { bgGradient } from 'src/theme/css';
import Logo from 'src/components/logo';
import Iconify from 'src/components/iconify';
import { LanguagePopover } from 'src/layouts/_common';
import { AuthRole } from 'src/auth/types';

type Props = {
  workspaceRole?: AuthRole;
  title?: string;
  image?: string;
  children: React.ReactNode;
};

export default function AuthClassicLayout({ children, image, workspaceRole, title }: Props) {
  const { t } = useTranslation('common');
  const theme = useTheme();
  const mdUp = useResponsive('up', 'md');
  const copyScope = workspaceRole === 'partner' ? 'auth.layout.partner' : 'auth.layout';

  const renderHeader = (
    <Stack
      direction="row"
      alignItems="center"
      justifyContent="space-between"
      sx={{
        position: 'absolute',
        top: { xs: 16, md: 28 },
        left: { xs: 16, md: 32 },
        right: { xs: 16, md: 32 },
        zIndex: 9,
      }}
    >
      <Logo disabledLink />
      <LanguagePopover />
    </Stack>
  );

  const renderContent = (
    <Stack
      sx={{
        width: 1,
        mx: 'auto',
        maxWidth: 520,
        px: { xs: 3, sm: 6, md: 8 },
        pt: { xs: 13, md: 16 },
        pb: { xs: 8, md: 10 },
        justifyContent: 'center',
        minHeight: '100vh',
      }}
    >
      {children}
    </Stack>
  );

  const assurances = [
    {
      icon: 'solar:shield-check-bold-duotone',
      label: t(`${copyScope}.assurance_session`),
    },
    {
      icon: 'solar:key-minimalistic-square-3-bold-duotone',
      label: t(`${copyScope}.assurance_totp`),
    },
    {
      icon: 'solar:clipboard-check-bold-duotone',
      label: t(`${copyScope}.assurance_audit`),
    },
  ];

  const renderSection = (
    <Stack
      flexGrow={1}
      justifyContent="center"
      sx={{
        px: { md: 8, lg: 12 },
        position: 'relative',
        overflow: 'hidden',
        ...bgGradient({
          color: alpha(
            theme.palette.background.default,
            theme.palette.mode === 'light' ? 0.9 : 0.95
          ),
          imgUrl: '/assets/background/overlay_2.jpg',
        }),
        '&:after': {
          content: "''",
          position: 'absolute',
          width: 280,
          height: 280,
          right: -100,
          bottom: -120,
          borderRadius: '50%',
          border: `1px solid ${alpha(theme.palette.primary.main, 0.2)}`,
          boxShadow: `0 0 0 56px ${alpha(theme.palette.primary.main, 0.04)}`,
        },
      }}
    >
      <Stack spacing={5} sx={{ maxWidth: 560, position: 'relative', zIndex: 1 }}>
        <Stack spacing={2}>
          <Typography
            variant="overline"
            sx={{ color: 'primary.main', letterSpacing: 1.2, fontWeight: 700 }}
          >
            {t(`${copyScope}.eyebrow`)}
          </Typography>
          <Typography variant="h2" sx={{ maxWidth: 520 }}>
            {title || t(`${copyScope}.title`)}
          </Typography>
          <Typography variant="body1" sx={{ color: 'text.secondary', maxWidth: 500 }}>
            {t(`${copyScope}.subtitle`)}
          </Typography>
        </Stack>

        <Box
          component="img"
          alt=""
          src={image || '/assets/illustrations/illustration_dashboard.png'}
          sx={{ width: 1, maxWidth: 460, alignSelf: 'center' }}
        />

        <Stack spacing={1.5}>
          {assurances.map((item) => (
            <Stack key={item.label} direction="row" alignItems="center" spacing={1.5}>
              <Iconify icon={item.icon} width={24} sx={{ color: 'primary.main', flexShrink: 0 }} />
              <Typography variant="body2" sx={{ color: 'text.secondary' }}>
                {item.label}
              </Typography>
            </Stack>
          ))}
        </Stack>
      </Stack>
    </Stack>
  );

  return (
    <Stack component="main" direction="row" sx={{ minHeight: '100vh', position: 'relative' }}>
      {renderHeader}
      {mdUp && renderSection}
      {renderContent}
    </Stack>
  );
}
