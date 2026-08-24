import { Helmet } from 'react-helmet-async';
import { useTranslation } from 'react-i18next';
import { AuthRole } from 'src/auth/types';
import { JwtLoginView } from 'src/sections/auth/jwt';

type Props = {
  expectedRole: AuthRole;
};

export default function SetupPage({ expectedRole }: Props) {
  const { t } = useTranslation('common');
  const title = t(
    expectedRole === 'admin' ? 'auth.page_titles.admin_setup' : 'auth.page_titles.customer_setup'
  );

  return (
    <>
      <Helmet>
        <title>{title} | SSC Digital Bank</title>
      </Helmet>

      <JwtLoginView initialMode="setup" expectedRole={expectedRole} />
    </>
  );
}
