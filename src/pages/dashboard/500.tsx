import Container from '@mui/material/Container';
import { Helmet } from 'react-helmet-async';
import { useTranslation } from 'react-i18next';
import { View500 } from 'src/sections/error';

export default function DashboardServerErrorPage() {
  const { t } = useTranslation('common');

  return (
    <>
      <Helmet>
        <title>{t('error_pages.server_error.page_title')} | moventra</title>
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
        <View500 />
      </Container>
    </>
  );
}
