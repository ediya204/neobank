import { Helmet } from 'react-helmet-async';
import { useTranslation } from 'react-i18next';
import { AuthRole } from 'src/auth/types';
import { JwtLoginView } from 'src/sections/auth/jwt';

type Props = {
  expectedRole: AuthRole;
};

export default function SetupPage({ expectedRole }: Props) {
  const { t } = useTranslation('common');
  const title =
    expectedRole === 'admin'
      ? t('auth.page_titles.admin_setup')
      : t('auth.page_titles.portal_setup');

  return (
    <>
      <Helmet>
        <title>{title} | moventra</title>
      </Helmet>

      <JwtLoginView initialMode="setup" expectedRole={expectedRole} />
    </>
  );
}
