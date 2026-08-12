import { Helmet } from 'react-helmet-async';
import { useTranslation } from 'react-i18next';
import { APP_DISPLAY_NAME } from 'src/config-global';
// sections
import { JwtRegisterView } from 'src/sections/auth/jwt';

// ----------------------------------------------------------------------

export default function RegisterPage() {
  const { t } = useTranslation('common');

  return (
    <>
      <Helmet>
        <title>{t('auth.page_titles.registration')} | {APP_DISPLAY_NAME}</title>
      </Helmet>

      <JwtRegisterView />
    </>
  );
}
