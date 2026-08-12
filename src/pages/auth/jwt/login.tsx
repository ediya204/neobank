import { Helmet } from 'react-helmet-async';
import { useTranslation } from 'react-i18next';
import { AuthRole } from 'src/auth/types';
// sections
import { JwtLoginView } from 'src/sections/auth/jwt';

// ----------------------------------------------------------------------

type Props = {
  expectedRole: AuthRole;
};

export default function LoginPage({ expectedRole }: Props) {
  const { t } = useTranslation('common');
  const title =
    expectedRole === 'admin'
      ? t('auth.page_titles.admin_login')
      : t('auth.page_titles.portal_login');

  return (
    <>
      <Helmet>
        <title>{title} | moventra</title>
      </Helmet>

      <JwtLoginView expectedRole={expectedRole} />
    </>
  );
}
