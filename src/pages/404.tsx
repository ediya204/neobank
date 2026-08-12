import { Helmet } from 'react-helmet-async';
import { useTranslation } from 'react-i18next';
// sections
import { NotFoundView } from 'src/sections/error';

// ----------------------------------------------------------------------

export default function NotFoundPage() {
  const { t } = useTranslation('common');

  return (
    <>
      <Helmet>
        <title>{t('error_pages.not_found.page_title')} | SCC Digital Bank</title>
      </Helmet>

      <NotFoundView />
    </>
  );
}
