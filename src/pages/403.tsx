import { Helmet } from 'react-helmet-async';
import { useTranslation } from 'react-i18next';
// sections
import { View403 } from 'src/sections/error';

// ----------------------------------------------------------------------

export default function Page403() {
  const { t } = useTranslation('common');

  return (
    <>
      <Helmet>
        <title>{t('error_pages.forbidden.page_title')} | SSC Digital Bank</title>
      </Helmet>

      <View403 />
    </>
  );
}
