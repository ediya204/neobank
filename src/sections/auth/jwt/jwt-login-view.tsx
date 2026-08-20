import * as Yup from 'yup';
import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { yupResolver } from '@hookform/resolvers/yup';
import LoadingButton from '@mui/lab/LoadingButton';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import Divider from '@mui/material/Divider';
import IconButton from '@mui/material/IconButton';
import InputAdornment from '@mui/material/InputAdornment';
import Link from '@mui/material/Link';
import Paper from '@mui/material/Paper';
import Stack from '@mui/material/Stack';
import ToggleButton from '@mui/material/ToggleButton';
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup';
import Typography from '@mui/material/Typography';
import { AuthApiError } from 'src/auth/context/jwt/auth-api';
import { useAuthContext } from 'src/auth/hooks';
import { getRoleLogin, safeReturnTo } from 'src/auth/role-access';
import { AuthFlowResult, AuthRole, AuthSessionUser, TotpSetupData } from 'src/auth/types';
import { useBoolean } from 'src/hooks/use-boolean';
import { useRouter, useSearchParams } from 'src/routes/hooks';
import Iconify from 'src/components/iconify';
import FormProvider, { RHFCode, RHFTextField } from 'src/components/hook-form';
import { useSnackbar } from 'src/components/snackbar';
import { APP_NAME_CN, APP_NAME_EN } from 'src/config-global';
import { paths } from 'src/routes/paths';
import { RouterLink } from 'src/routes/components';

type Stage = 'credentials' | 'setup' | 'totp_enroll' | 'totp_verify' | 'recovery_codes';

type Props = {
  initialMode?: 'login' | 'setup';
  expectedRole: AuthRole;
};

const AUTH_ERROR_KEYS: Record<string, string> = {
  invalid_credentials: 'auth.errors.invalid_credentials',
  invalid_email_or_password: 'auth.errors.invalid_credentials',
  invalid_totp: 'auth.errors.invalid_totp',
  invalid_totp_code: 'auth.errors.invalid_totp',
  totp_code_invalid: 'auth.errors.invalid_totp',
  invalid_recovery_code: 'auth.errors.invalid_recovery_code',
  recovery_code_invalid: 'auth.errors.invalid_recovery_code',
  setup_token_invalid: 'auth.errors.setup_token_invalid',
  invalid_setup_token: 'auth.errors.setup_token_invalid',
  setup_token_expired: 'auth.errors.setup_token_expired',
  setup_token_consumed: 'auth.errors.setup_token_invalid',
  setup_already_completed: 'auth.errors.setup_token_invalid',
  invalid_enrollment_token: 'auth.errors.setup_token_invalid',
  enrollment_state_changed: 'auth.errors.session_expired',
  invalid_challenge: 'auth.errors.session_expired',
  challenge_consumed: 'auth.errors.session_expired',
  account_locked: 'auth.errors.account_locked',
  auth_rate_limited: 'auth.errors.rate_limited',
  rate_limited: 'auth.errors.rate_limited',
  rate_limit_exceeded: 'auth.errors.rate_limited',
  session_expired: 'auth.errors.session_expired',
  challenge_expired: 'auth.errors.session_expired',
  network_error: 'auth.errors.network_error',
  invalid_auth_response: 'auth.errors.invalid_response',
  role_mismatch: 'auth.errors.role_mismatch',
  invalid_role: 'auth.errors.role_mismatch',
  wrong_role: 'auth.errors.role_mismatch',
  forbidden_role: 'auth.errors.role_mismatch',
};

function digitsOnly(value: string) {
  return value.replace(/\D/g, '').slice(0, 6);
}

export default function JwtLoginView({ initialMode = 'login', expectedRole }: Props) {
  const { t } = useTranslation('common');
  const { login, completeSetup, setupTotp, verifyTotp, refreshSession, logout, sessionError } =
    useAuthContext();
  const { enqueueSnackbar } = useSnackbar();
  const router = useRouter();
  const searchParams = useSearchParams();
  const passwordVisible = useBoolean();
  const localPortalBypass =
    expectedRole === 'partner' &&
    ['localhost', '127.0.0.1', '[::1]', '::1'].includes(window.location.hostname);

  const fragmentParams = new URLSearchParams(window.location.hash.replace(/^#/, ''));
  const fragmentSetupToken =
    fragmentParams.get('setup_token') ||
    fragmentParams.get('invite_token') ||
    fragmentParams.get('token') ||
    '';
  const invitationToken = initialMode === 'setup' ? fragmentSetupToken : '';
  const returnTo = searchParams.get('returnTo');
  const invitationEmail = searchParams.get('email') || '';

  const [stage, setStage] = useState<Stage>(initialMode === 'setup' ? 'setup' : 'credentials');
  const [email, setEmail] = useState(invitationEmail);
  const [challengeToken, setChallengeToken] = useState<string | null>(null);
  const [enrollmentToken, setEnrollmentToken] = useState<string | null>(null);
  const [setupToken, setSetupToken] = useState(invitationToken);
  const [totpSetupData, setTotpSetupData] = useState<TotpSetupData | null>(null);
  const [recoveryCodes, setRecoveryCodes] = useState<string[]>([]);
  const [authenticatedUser, setAuthenticatedUser] = useState<AuthSessionUser | null>(null);
  const [verificationMethod, setVerificationMethod] = useState<'totp' | 'recovery'>('totp');
  const [errorMessage, setErrorMessage] = useState('');
  const [preparingTotp, setPreparingTotp] = useState(false);

  useEffect(() => {
    if (!fragmentSetupToken) return;
    const url = new URL(window.location.href);
    url.hash = '';
    window.history.replaceState(window.history.state, '', `${url.pathname}${url.search}`);
  }, [fragmentSetupToken]);

  const loginSchema = useMemo(() => {
    const accountSchema = Yup.string()
      .trim()
      .required(
        localPortalBypass
          ? t('auth.validation.local_account_required')
          : t('auth.validation.email_required')
      )
      .max(254, t('auth.validation.email_too_long'));
    return Yup.object().shape({
      email: localPortalBypass
        ? accountSchema
        : accountSchema.email(t('auth.validation.email_invalid')),
      password: Yup.string()
        .required(t('auth.validation.password_required'))
        .max(128, t('auth.validation.password_too_long')),
    });
  }, [localPortalBypass, t]);

  const setupSchema = useMemo(
    () =>
      Yup.object().shape({
        password: Yup.string()
          .required(t('auth.validation.new_password_required'))
          .min(14, t('auth.validation.password_min'))
          .max(128, t('auth.validation.password_too_long'))
          .matches(
            /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z0-9]).*$/,
            t('auth.validation.password_complexity')
          ),
        confirmPassword: Yup.string()
          .required(t('auth.validation.confirm_password_required'))
          .oneOf([Yup.ref('password')], t('auth.validation.passwords_mismatch')),
      }),
    [t]
  );

  const codeSchema = useMemo(
    () =>
      Yup.object().shape({
        code: Yup.string()
          .matches(/^\d{6}$/, t('auth.validation.totp_six_digits'))
          .required(t('auth.validation.totp_required')),
      }),
    [t]
  );

  const recoverySchema = useMemo(
    () =>
      Yup.object().shape({
        recoveryCode: Yup.string()
          .trim()
          .required(t('auth.validation.recovery_required'))
          .min(8, t('auth.validation.recovery_invalid'))
          .max(128, t('auth.validation.recovery_invalid')),
      }),
    [t]
  );

  const loginMethods = useForm({
    resolver: yupResolver(loginSchema),
    defaultValues: { email: invitationEmail, password: '' },
  });
  const setupMethods = useForm({
    resolver: yupResolver(setupSchema),
    defaultValues: { password: '', confirmPassword: '' },
  });
  const codeMethods = useForm({
    mode: 'onChange',
    resolver: yupResolver(codeSchema),
    defaultValues: { code: '' },
  });
  const recoveryMethods = useForm({
    resolver: yupResolver(recoverySchema),
    defaultValues: { recoveryCode: '' },
  });

  const describeError = useCallback(
    (error: unknown) => {
      if (error instanceof AuthApiError) {
        const key = AUTH_ERROR_KEYS[error.code];
        if (key) return t(key);
        if (error.status === 401) return t('auth.errors.invalid_credentials');
        if (error.status === 429) return t('auth.errors.rate_limited');
        if (error.status >= 500 || error.status === 0) return t('auth.errors.network_error');
      }
      return t('auth.errors.request_failed');
    },
    [t]
  );

  const enforceEntryRole = useCallback(
    async (user: AuthSessionUser, clearSession: boolean) => {
      if (user.role === expectedRole) return;

      if (clearSession) {
        try {
          await logout();
        } catch {
          // The provider still clears the local session if server-side logout fails.
        }
      }

      throw new AuthApiError(
        403,
        'role_mismatch',
        'This account cannot use the selected sign-in entry'
      );
    },
    [expectedRole, logout]
  );

  const redirectAuthenticatedUser = useCallback(
    (user: AuthSessionUser) => {
      router.replace(safeReturnTo(returnTo, user.role, user));
    },
    [returnTo, router]
  );

  const finishAuthentication = useCallback(
    async (result: AuthFlowResult) => {
      const user = result.user || (await refreshSession());
      if (!user) throw new AuthApiError(502, 'invalid_auth_response', 'Session user is missing');
      await enforceEntryRole(user, true);

      if (result.recoveryCodes.length) {
        setAuthenticatedUser(user);
        setRecoveryCodes(result.recoveryCodes);
        setStage('recovery_codes');
        return;
      }

      redirectAuthenticatedUser(user);
    },
    [enforceEntryRole, redirectAuthenticatedUser, refreshSession]
  );

  const loadTotpEnrollment = useCallback(
    async (token: string | null, existing: TotpSetupData | null) => {
      setPreparingTotp(true);
      try {
        const enrollment = existing || (await setupTotp(expectedRole, token));
        if (enrollment.enrollmentToken) setEnrollmentToken(enrollment.enrollmentToken);
        setTotpSetupData(enrollment);
        setStage('totp_enroll');
      } finally {
        setPreparingTotp(false);
      }
    },
    [expectedRole, setupTotp]
  );

  const applyFlowResult = useCallback(
    async (result: AuthFlowResult) => {
      const nextEnrollment = result.enrollmentToken || enrollmentToken;
      if (result.user && result.user.role !== expectedRole && result.nextStep !== 'authenticated') {
        await enforceEntryRole(result.user, false);
      }
      if (result.challengeToken) setChallengeToken(result.challengeToken);
      if (result.enrollmentToken) setEnrollmentToken(result.enrollmentToken);
      if (result.setupToken) setSetupToken(result.setupToken);

      if (result.nextStep === 'setup_required') {
        setStage('setup');
        return;
      }

      if (result.nextStep === 'totp_setup_required' || result.totpSetup) {
        await loadTotpEnrollment(nextEnrollment, result.totpSetup);
        return;
      }

      if (result.nextStep === 'totp_required') {
        codeMethods.reset({ code: '' });
        recoveryMethods.reset({ recoveryCode: '' });
        setStage('totp_verify');
        return;
      }

      if (result.nextStep === 'authenticated') {
        await finishAuthentication(result);
        return;
      }

      const sessionUser = await refreshSession();
      if (sessionUser) {
        await enforceEntryRole(sessionUser, true);
        redirectAuthenticatedUser(sessionUser);
        return;
      }

      throw new AuthApiError(
        502,
        'invalid_auth_response',
        'The next authentication step is missing'
      );
    },
    [
      codeMethods,
      enrollmentToken,
      enforceEntryRole,
      expectedRole,
      finishAuthentication,
      loadTotpEnrollment,
      recoveryMethods,
      redirectAuthenticatedUser,
      refreshSession,
    ]
  );

  const handleCredentials = loginMethods.handleSubmit(async (values) => {
    setErrorMessage('');
    setEmail(values.email.trim().toLowerCase());
    try {
      const result = await login(values.email.trim().toLowerCase(), values.password, expectedRole);
      loginMethods.setValue('password', '');
      await applyFlowResult(result);
    } catch (error) {
      loginMethods.setValue('password', '');
      setErrorMessage(describeError(error));
    }
  });

  const handleCredentialsSubmit = (event: FormEvent<HTMLFormElement>) => {
    const values = loginMethods.getValues();
    let missing = false;
    if (!values.email.trim()) {
      loginMethods.setError('email', {
        type: 'manual',
        message: localPortalBypass
          ? t('auth.validation.local_account_required')
          : t('auth.validation.email_required'),
      });
      missing = true;
    }
    if (!values.password) {
      loginMethods.setError('password', {
        type: 'manual',
        message: t('auth.validation.password_required'),
      });
      missing = true;
    }
    if (missing) {
      event.preventDefault();
      setErrorMessage('');
      return;
    }
    handleCredentials(event);
  };

  const handleSetup = setupMethods.handleSubmit(async (values) => {
    setErrorMessage('');
    if (!setupToken) {
      setErrorMessage(t('auth.errors.setup_token_missing'));
      return;
    }
    try {
      const result = await completeSetup({
        setupToken,
        password: values.password,
        expectedRole,
      });
      setupMethods.reset({ password: '', confirmPassword: '' });
      await applyFlowResult(result);
    } catch (error) {
      setupMethods.reset({ password: '', confirmPassword: '' });
      setErrorMessage(describeError(error));
    }
  });

  const handleTotpCode = codeMethods.handleSubmit(async (values) => {
    setErrorMessage('');
    try {
      const result = await verifyTotp({
        expectedRole,
        code: digitsOnly(values.code),
        ...(stage === 'totp_enroll' ? { enrollmentToken } : { challengeToken }),
      });
      codeMethods.reset({ code: '' });
      await applyFlowResult(result);
    } catch (error) {
      codeMethods.reset({ code: '' });
      setErrorMessage(describeError(error));
    }
  });

  const handleRecoveryCode = recoveryMethods.handleSubmit(async (values) => {
    setErrorMessage('');
    try {
      const result = await verifyTotp({
        expectedRole,
        recoveryCode: values.recoveryCode.trim(),
        challengeToken,
      });
      recoveryMethods.reset({ recoveryCode: '' });
      await applyFlowResult(result);
    } catch (error) {
      recoveryMethods.reset({ recoveryCode: '' });
      setErrorMessage(describeError(error));
    }
  });

  const copyText = useCallback(
    async (value: string) => {
      try {
        if (!navigator.clipboard?.writeText) throw new Error('clipboard_unavailable');
        await navigator.clipboard.writeText(value);
        enqueueSnackbar(t('auth.copy_success'), { variant: 'success' });
      } catch {
        enqueueSnackbar(t('auth.copy_failed'), { variant: 'error' });
      }
    },
    [enqueueSnackbar, t]
  );

  const resetToLogin = () => {
    setStage('credentials');
    setErrorMessage('');
    setChallengeToken(null);
    setEnrollmentToken(null);
    setSetupToken('');
    setTotpSetupData(null);
    setRecoveryCodes([]);
    setAuthenticatedUser(null);
    setVerificationMethod('totp');
    codeMethods.reset({ code: '' });
    recoveryMethods.reset({ recoveryCode: '' });
    router.replace(getRoleLogin(expectedRole));
  };

  const signInCopyScope = expectedRole === 'customer' ? 'auth.sign_in.customer' : 'auth.sign_in';
  let emailFieldLabel = t('auth.fields.email');
  if (expectedRole === 'customer') emailFieldLabel = t('auth.fields.customer_email');
  if (localPortalBypass) emailFieldLabel = t('auth.fields.local_account');

  const stageCopy: Record<Stage, { eyebrow: string; title: string; subtitle: string }> = {
    credentials: {
      eyebrow: localPortalBypass ? t('auth.local_dev.eyebrow') : t(`${signInCopyScope}.eyebrow`),
      title: localPortalBypass ? t('auth.local_dev.title') : t(`${signInCopyScope}.title`),
      subtitle: localPortalBypass ? t('auth.local_dev.subtitle') : t(`${signInCopyScope}.subtitle`),
    },
    setup: {
      eyebrow: t('auth.setup.eyebrow'),
      title: t('auth.setup.title'),
      subtitle: t('auth.setup.subtitle'),
    },
    totp_enroll: {
      eyebrow: t('auth.totp_setup.eyebrow'),
      title: t('auth.totp_setup.title'),
      subtitle: t('auth.totp_setup.subtitle'),
    },
    totp_verify: {
      eyebrow: t('auth.verify.eyebrow'),
      title: t('auth.verify.title'),
      subtitle: t('auth.verify.subtitle', { email }),
    },
    recovery_codes: {
      eyebrow: t('auth.recovery_codes.eyebrow'),
      title: t('auth.recovery_codes.title'),
      subtitle: t('auth.recovery_codes.subtitle'),
    },
  };

  let roleEntryIcon = 'solar:buildings-2-bold-duotone';
  let roleEntryLabel = t('auth.role_entries.portal');
  if (expectedRole === 'admin') {
    roleEntryIcon = 'solar:shield-user-bold-duotone';
    roleEntryLabel = t('auth.role_entries.admin');
  }
  if (expectedRole === 'customer') {
    roleEntryIcon = 'solar:user-circle-bold-duotone';
    roleEntryLabel = t('auth.role_entries.customer');
  }

  const renderHead = (
    <Stack spacing={1.5} sx={{ mb: 4 }}>
      <Box>
        <Typography variant="h5" sx={{ fontWeight: 800, letterSpacing: '-0.02em' }}>
          {APP_NAME_CN}
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ fontWeight: 600 }}>
          {APP_NAME_EN}
        </Typography>
      </Box>
      <Stack direction="row" spacing={1} useFlexGap flexWrap="wrap">
        <Chip icon={<Iconify icon={roleEntryIcon} />} label={roleEntryLabel} size="small" />
        {stage !== 'credentials' && stage !== 'setup' && (
          <Chip
            icon={<Iconify icon="solar:shield-check-bold-duotone" />}
            label={t('auth.secure_verification')}
            size="small"
          />
        )}
        {stage === 'credentials' && localPortalBypass && (
          <Chip
            icon={<Iconify icon="solar:test-tube-bold-duotone" />}
            label={t('auth.local_dev.badge')}
            color="warning"
            size="small"
          />
        )}
      </Stack>
      <Typography
        variant="overline"
        sx={{ color: 'primary.main', letterSpacing: 1, fontWeight: 700 }}
      >
        {stageCopy[stage].eyebrow}
      </Typography>
      <Typography variant="h3">{stageCopy[stage].title}</Typography>
      <Typography variant="body2" sx={{ color: 'text.secondary', maxWidth: 440 }}>
        {stageCopy[stage].subtitle}
      </Typography>
    </Stack>
  );

  const renderError = errorMessage ? (
    <Alert severity="error" aria-live="polite" sx={{ mb: 3 }}>
      {errorMessage}
    </Alert>
  ) : null;

  let credentialsFooter = (
    <Typography variant="caption" sx={{ color: 'text.secondary', textAlign: 'center' }}>
      {t('auth.sign_in.provisioned_only')}
    </Typography>
  );

  if (expectedRole === 'customer') {
    credentialsFooter = (
      <>
        <Typography variant="caption" sx={{ color: 'text.secondary', textAlign: 'center' }}>
          {t('auth.sign_in.customer.activated_only')}
        </Typography>
        <Divider>
          <Typography variant="caption" sx={{ color: 'text.secondary' }}>
            {t('auth.sign_in.customer.new_customer')}
          </Typography>
        </Divider>
        <Button
          fullWidth
          component={RouterLink}
          href={paths.auth.customer.register}
          size="large"
          variant="outlined"
          color="inherit"
          startIcon={<Iconify icon="solar:user-plus-bold-duotone" />}
        >
          {t('auth.sign_in.customer.register')}
        </Button>
        <Typography variant="caption" sx={{ color: 'text.secondary', textAlign: 'center' }}>
          {t('auth.sign_in.customer.registration_helper')}
        </Typography>
      </>
    );
  }

  if (expectedRole === 'partner') {
    credentialsFooter = (
      <>
        {localPortalBypass && (
          <Typography variant="caption" sx={{ color: 'text.secondary', textAlign: 'center' }}>
            {t('auth.local_dev.helper')}
          </Typography>
        )}
        <Divider>
          <Typography variant="caption" sx={{ color: 'text.secondary' }}>
            {t('auth.sign_in.new_customer')}
          </Typography>
        </Divider>
        <Button
          fullWidth
          component={RouterLink}
          href={paths.auth.portal.register}
          size="large"
          variant="outlined"
          color="inherit"
          startIcon={<Iconify icon="solar:user-plus-bold-duotone" />}
        >
          {t('auth.sign_in.open_account')}
        </Button>
        <Typography variant="caption" sx={{ color: 'text.secondary', textAlign: 'center' }}>
          {t('auth.sign_in.registration_helper')}
        </Typography>
      </>
    );
  }

  const renderCredentials = (
    <FormProvider methods={loginMethods} onSubmit={handleCredentialsSubmit}>
      <Stack spacing={2.5}>
        {localPortalBypass && <Alert severity="warning">{t('auth.local_dev.warning')}</Alert>}
        {sessionError && (
          <Alert severity="warning" sx={{ mb: 0.5 }}>
            {t('auth.errors.session_check_failed')}
          </Alert>
        )}
        <RHFTextField
          name="email"
          label={emailFieldLabel}
          autoComplete={localPortalBypass ? 'off' : 'username'}
          inputProps={{ maxLength: 254 }}
        />
        <RHFTextField
          name="password"
          label={t('auth.fields.password')}
          type={passwordVisible.value ? 'text' : 'password'}
          autoComplete="current-password"
          inputProps={{ maxLength: 128 }}
          InputProps={{
            endAdornment: (
              <InputAdornment position="end">
                <IconButton
                  aria-label={
                    passwordVisible.value ? t('auth.hide_password') : t('auth.show_password')
                  }
                  onClick={passwordVisible.onToggle}
                  edge="end"
                >
                  <Iconify
                    icon={passwordVisible.value ? 'solar:eye-linear' : 'solar:eye-closed-linear'}
                  />
                </IconButton>
              </InputAdornment>
            ),
          }}
        />
        {expectedRole === 'customer' && (
          <Box sx={{ mt: -1, textAlign: 'right' }}>
            <Link
              component={RouterLink}
              href={paths.auth.customer.forgotPassword}
              variant="body2"
              color="text.primary"
              underline="hover"
              sx={{ fontWeight: 600 }}
            >
              {t('auth.password_recovery.forgot_link')}
            </Link>
          </Box>
        )}
        <LoadingButton
          fullWidth
          color="inherit"
          size="large"
          type="submit"
          variant="contained"
          loading={loginMethods.formState.isSubmitting || preparingTotp}
        >
          {localPortalBypass ? t('auth.local_dev.submit') : t(`${signInCopyScope}.submit`)}
        </LoadingButton>
        {credentialsFooter}
      </Stack>
    </FormProvider>
  );

  const renderSetup = setupToken ? (
    <FormProvider methods={setupMethods} onSubmit={handleSetup}>
      <Stack spacing={2.5}>
        {invitationEmail && (
          <Paper variant="outlined" sx={{ px: 2, py: 1.5 }}>
            <Typography variant="caption" sx={{ color: 'text.secondary' }}>
              {t('auth.fields.account')}
            </Typography>
            <Typography variant="subtitle2" sx={{ overflowWrap: 'anywhere' }}>
              {invitationEmail}
            </Typography>
          </Paper>
        )}
        <RHFTextField
          name="password"
          label={t('auth.fields.new_password')}
          type={passwordVisible.value ? 'text' : 'password'}
          autoComplete="new-password"
          inputProps={{ maxLength: 128 }}
          helperText={t('auth.setup.password_hint')}
          InputProps={{
            endAdornment: (
              <InputAdornment position="end">
                <IconButton
                  aria-label={
                    passwordVisible.value ? t('auth.hide_password') : t('auth.show_password')
                  }
                  onClick={passwordVisible.onToggle}
                  edge="end"
                >
                  <Iconify
                    icon={passwordVisible.value ? 'solar:eye-linear' : 'solar:eye-closed-linear'}
                  />
                </IconButton>
              </InputAdornment>
            ),
          }}
        />
        <RHFTextField
          name="confirmPassword"
          label={t('auth.fields.confirm_password')}
          type={passwordVisible.value ? 'text' : 'password'}
          autoComplete="new-password"
          inputProps={{ maxLength: 128 }}
        />
        <LoadingButton
          fullWidth
          color="inherit"
          size="large"
          type="submit"
          variant="contained"
          loading={setupMethods.formState.isSubmitting || preparingTotp}
        >
          {t('auth.setup.submit')}
        </LoadingButton>
        <Button color="inherit" onClick={resetToLogin}>
          {t('auth.back_to_sign_in')}
        </Button>
      </Stack>
    </FormProvider>
  ) : (
    <Stack spacing={2}>
      <Alert severity="warning">{t('auth.errors.setup_token_missing')}</Alert>
      <Button variant="contained" color="inherit" onClick={resetToLogin}>
        {t('auth.back_to_sign_in')}
      </Button>
    </Stack>
  );

  const renderTotpEnrollment = totpSetupData ? (
    <Stack spacing={3}>
      {totpSetupData.qrCodeDataUri && (
        <Box
          component="img"
          src={totpSetupData.qrCodeDataUri}
          alt={t('auth.totp_setup.qr_alt')}
          sx={{
            width: 200,
            height: 200,
            p: 1.5,
            mx: 'auto',
            borderRadius: 1.5,
            border: (theme) => `1px solid ${theme.palette.divider}`,
          }}
        />
      )}

      <Paper variant="outlined" sx={{ p: 2.5 }}>
        <Typography variant="caption" sx={{ color: 'text.secondary' }}>
          {t('auth.totp_setup.manual_key')}
        </Typography>
        <Stack direction="row" alignItems="center" spacing={1} sx={{ mt: 0.75 }}>
          <Typography
            variant="subtitle1"
            sx={{ flexGrow: 1, letterSpacing: 1.2, overflowWrap: 'anywhere' }}
          >
            {totpSetupData.secret}
          </Typography>
          <IconButton
            aria-label={t('auth.totp_setup.copy_manual_key')}
            onClick={() => copyText(totpSetupData.secret)}
          >
            <Iconify icon="solar:copy-linear" />
          </IconButton>
        </Stack>
      </Paper>

      {totpSetupData.otpauthUri && (
        <Stack spacing={1}>
          <Typography variant="caption" sx={{ color: 'text.secondary' }}>
            {t('auth.totp_setup.otpauth_uri')}
          </Typography>
          <Stack direction="row" alignItems="flex-start" spacing={1}>
            <Link
              href={totpSetupData.otpauthUri}
              sx={{ typography: 'caption', flexGrow: 1, overflowWrap: 'anywhere' }}
            >
              {totpSetupData.otpauthUri}
            </Link>
            <IconButton
              size="small"
              aria-label={t('auth.totp_setup.copy_otpauth_uri')}
              onClick={() => copyText(totpSetupData.otpauthUri || '')}
            >
              <Iconify icon="solar:copy-linear" />
            </IconButton>
          </Stack>
        </Stack>
      )}

      <Alert severity="info">{t('auth.totp_setup.no_external_qr')}</Alert>

      <Divider>
        <Typography variant="caption" sx={{ color: 'text.secondary' }}>
          {t('auth.totp_setup.confirm_label')}
        </Typography>
      </Divider>

      <FormProvider methods={codeMethods} onSubmit={handleTotpCode}>
        <Stack spacing={2.5}>
          <RHFCode
            name="code"
            onChange={(value) =>
              codeMethods.setValue('code', digitsOnly(value), {
                shouldValidate: true,
              })
            }
          />
          <LoadingButton
            fullWidth
            color="inherit"
            size="large"
            type="submit"
            variant="contained"
            loading={codeMethods.formState.isSubmitting}
          >
            {t('auth.totp_setup.confirm_submit')}
          </LoadingButton>
        </Stack>
      </FormProvider>
    </Stack>
  ) : (
    <Alert severity="warning">{t('auth.errors.totp_setup_missing')}</Alert>
  );

  const renderTotpVerification = (
    <Stack spacing={3}>
      {expectedRole !== 'admin' && (
        <ToggleButtonGroup
          fullWidth
          exclusive
          color="primary"
          value={verificationMethod}
          onChange={(_, value) => value && setVerificationMethod(value)}
          aria-label={t('auth.verify.method_label')}
        >
          <ToggleButton value="totp">{t('auth.verify.authenticator')}</ToggleButton>
          <ToggleButton value="recovery">{t('auth.verify.recovery_code')}</ToggleButton>
        </ToggleButtonGroup>
      )}

      {verificationMethod === 'totp' ? (
        <FormProvider methods={codeMethods} onSubmit={handleTotpCode}>
          <Stack spacing={2.5}>
            <RHFCode
              name="code"
              onChange={(value) =>
                codeMethods.setValue('code', digitsOnly(value), {
                  shouldValidate: true,
                })
              }
            />
            <LoadingButton
              fullWidth
              color="inherit"
              size="large"
              type="submit"
              variant="contained"
              loading={codeMethods.formState.isSubmitting}
            >
              {t('auth.verify.submit')}
            </LoadingButton>
          </Stack>
        </FormProvider>
      ) : (
        <FormProvider methods={recoveryMethods} onSubmit={handleRecoveryCode}>
          <Stack spacing={2.5}>
            <RHFTextField
              name="recoveryCode"
              label={t('auth.fields.recovery_code')}
              autoComplete="one-time-code"
              inputProps={{ maxLength: 128 }}
              helperText={t('auth.verify.recovery_hint')}
            />
            <LoadingButton
              fullWidth
              color="inherit"
              size="large"
              type="submit"
              variant="contained"
              loading={recoveryMethods.formState.isSubmitting}
            >
              {t('auth.verify.recovery_submit')}
            </LoadingButton>
          </Stack>
        </FormProvider>
      )}

      <Button color="inherit" onClick={resetToLogin}>
        {t('auth.back_to_sign_in')}
      </Button>
    </Stack>
  );

  const renderRecoveryCodes = (
    <Stack spacing={3}>
      <Alert severity="warning">{t('auth.recovery_codes.warning')}</Alert>
      <Paper
        variant="outlined"
        sx={{
          p: 2.5,
          display: 'grid',
          gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, minmax(0, 1fr))' },
          gap: 1.25,
        }}
      >
        {recoveryCodes.map((code) => (
          <Typography
            key={code}
            variant="subtitle2"
            sx={{ letterSpacing: 0.8, overflowWrap: 'anywhere' }}
          >
            {code}
          </Typography>
        ))}
      </Paper>
      <Button
        variant="outlined"
        color="inherit"
        startIcon={<Iconify icon="solar:copy-linear" />}
        onClick={() => copyText(recoveryCodes.join('\n'))}
      >
        {t('auth.recovery_codes.copy_all')}
      </Button>
      <Button
        variant="contained"
        color="inherit"
        size="large"
        disabled={!authenticatedUser}
        onClick={() => authenticatedUser && redirectAuthenticatedUser(authenticatedUser)}
      >
        {t('auth.recovery_codes.continue')}
      </Button>
    </Stack>
  );

  return (
    <Box sx={{ width: 1 }}>
      {renderHead}
      {renderError}
      {stage === 'credentials' && renderCredentials}
      {stage === 'setup' && renderSetup}
      {stage === 'totp_enroll' && renderTotpEnrollment}
      {stage === 'totp_verify' && renderTotpVerification}
      {stage === 'recovery_codes' && renderRecoveryCodes}
    </Box>
  );
}
