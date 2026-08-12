import { Helmet } from 'react-helmet-async';
import { useTranslation } from 'react-i18next';
import { AuthRole } from 'src/auth/types';
import { JwtLoginView } from 'src/sections/auth/jwt';

type Props = {
  expectedRole: AuthRole;
};

export default function SetupPage({ expectedRole }: Props) {
  const { t } = useTranslation('common');
  let title = t('auth.page_titles.portal_setup');
  if (expectedRole === 'admin') title = t('auth.page_titles.admin_setup');
  if (expectedRole === 'customer') title = '激活客户账户';

  return (
    <>
      <Helmet>
        <title>{title} | SCC Digital Bank</title>
      </Helmet>

      <JwtLoginView initialMode="setup" expectedRole={expectedRole} />
    </>
  );
}
