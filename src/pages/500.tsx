import { Helmet } from 'react-helmet-async';
import { useTranslation } from 'react-i18next';
// sections
import { View500 } from 'src/sections/error';

// ----------------------------------------------------------------------

export default function Page500() {
  const { t } = useTranslation('common');

  return (
    <>
      <Helmet>
        <title>{t('error_pages.server_error.page_title')} | SCC Digital Bank</title>
      </Helmet>

      <View500 />
    </>
  );
}
