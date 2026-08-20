import { Helmet } from 'react-helmet-async';
import { useTranslation } from 'react-i18next';
import { JwtPasswordRecoveryView } from 'src/sections/auth/jwt';
import { APP_DISPLAY_NAME } from 'src/config-global';

export type PasswordRecoveryMode = 'forgot' | 'reset' | 'verify';

type Props = {
  mode: PasswordRecoveryMode;
};

export default function PasswordRecoveryPage({ mode }: Props) {
  const { t } = useTranslation('common');

  return (
    <>
      <Helmet>
        <title>
          {t(`auth.password_recovery.${mode}.page_title`)} | {APP_DISPLAY_NAME}
        </title>
      </Helmet>
      <JwtPasswordRecoveryView mode={mode} />
    </>
  );
}
