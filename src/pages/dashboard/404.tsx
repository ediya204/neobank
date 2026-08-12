import Container from '@mui/material/Container';
import { Helmet } from 'react-helmet-async';
import { useTranslation } from 'react-i18next';
import { NotFoundView } from 'src/sections/error';

export default function DashboardNotFoundPage() {
  const { t } = useTranslation('common');

  return (
    <>
      <Helmet>
        <title>{t('error_pages.not_found.page_title')} | moventra</title>
      </Helmet>

      <Container
        maxWidth="md"
        sx={{
          flex: 1,
          display: 'grid',
          placeItems: 'center',
          py: { xs: 4, md: 6 },
          textAlign: 'center',
        }}
      >
        <NotFoundView />
      </Container>
    </>
  );
}
