import { Helmet } from 'react-helmet-async';
import { Link as RouterLink } from 'react-router-dom';
import { Button, Stack, Typography } from '@mui/material';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'src/routes/hooks';

function loginPath(scope: 'customer' | 'portal', returnTo: string | null) {
  if (!returnTo) return `/${scope}/login`;
  return `/${scope}/login?${new URLSearchParams({ returnTo }).toString()}`;
}

export default function PortalRoleEntryPage() {
  const { t } = useTranslation('common');
  const searchParams = useSearchParams();
  const returnTo = searchParams.get('returnTo');

  return (
    <>
      <Helmet>
        <title>{t('auth.role_selection.page_title')} | SSC Digital Bank</title>
      </Helmet>
      <Stack spacing={2.5}>
        <Typography variant="h3">{t('auth.role_selection.title')}</Typography>
        <Typography color="text.secondary">{t('auth.role_selection.description')}</Typography>
        <Button
          component={RouterLink}
          to={loginPath('customer', returnTo)}
          size="large"
          variant="contained"
        >
          {t('auth.role_selection.customer')}
        </Button>
        <Button
          component={RouterLink}
          to={loginPath('portal', returnTo)}
          size="large"
          variant="outlined"
        >
          {t('auth.role_selection.partner')}
        </Button>
      </Stack>
    </>
  );
}
