import { Helmet } from 'react-helmet-async';
import { useTranslation } from 'react-i18next';
import Alert from '@mui/material/Alert';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';

export default function InvalidAuthEntryPage() {
  const { t } = useTranslation('common');

  return (
    <>
      <Helmet>
        <title>{t('auth.invalid_entry.page_title')} | moventra</title>
      </Helmet>

      <Stack spacing={2.5}>
        <Typography
          variant="overline"
          sx={{ color: 'error.main', fontWeight: 700, letterSpacing: 1 }}
        >
          404
        </Typography>
        <Typography variant="h3">{t('auth.invalid_entry.title')}</Typography>
        <Alert severity="warning">{t('auth.invalid_entry.description')}</Alert>
      </Stack>
    </>
  );
}
