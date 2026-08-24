import { Helmet } from 'react-helmet-async';
import { useTranslation } from 'react-i18next';
import { AuthRole } from 'src/auth/types';
import { APP_DISPLAY_NAME } from 'src/config-global';
// sections
import { JwtLoginView } from 'src/sections/auth/jwt';

// ----------------------------------------------------------------------

type Props = {
  expectedRole: AuthRole;
};

export default function LoginPage({ expectedRole }: Props) {
  const { t } = useTranslation('common');
  const title = t(
    expectedRole === 'admin' ? 'auth.page_titles.admin_login' : 'auth.page_titles.customer_login'
  );

  return (
    <>
      <Helmet>
        <title>
          {title} | {APP_DISPLAY_NAME}
        </title>
      </Helmet>

      <JwtLoginView expectedRole={expectedRole} />
    </>
  );
}
