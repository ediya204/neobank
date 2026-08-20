import * as Yup from 'yup';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { yupResolver } from '@hookform/resolvers/yup';
import LoadingButton from '@mui/lab/LoadingButton';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import IconButton from '@mui/material/IconButton';
import InputAdornment from '@mui/material/InputAdornment';
import Skeleton from '@mui/material/Skeleton';
import Stack from '@mui/material/Stack';
import ToggleButton from '@mui/material/ToggleButton';
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup';
import Typography from '@mui/material/Typography';
import {
  AuthApiError,
  completeCustomerEmailVerification,
  completeCustomerPasswordReset,
  inspectCustomerPasswordReset,
  requestCustomerPasswordReset,
} from 'src/auth/context/jwt/auth-api';
import { useBoolean } from 'src/hooks/use-boolean';
import { paths } from 'src/routes/paths';
import { RouterLink } from 'src/routes/components';
import Iconify from 'src/components/iconify';
import FormProvider, { RHFTextField } from 'src/components/hook-form';
import { APP_NAME_CN, APP_NAME_EN } from 'src/config-global';
import type { PasswordRecoveryMode } from 'src/pages/auth/jwt/password-recovery';

type Props = {
  mode: PasswordRecoveryMode;
};

type ResetState = 'checking' | 'ready' | 'invalid' | 'complete';
type VerifyState = 'checking' | 'invalid' | 'complete';

function digitsOnly(value: string) {
  return value.replace(/\D/g, '').slice(0, 6);
}

function consumeFragmentToken(parameter: string) {
  const fragment = new URLSearchParams(window.location.hash.replace(/^#/, ''));
  const token = fragment.get(parameter) || '';
  const url = new URL(window.location.href);
  url.hash = '';
  window.history.replaceState(window.history.state, '', `${url.pathname}${url.search}`);
  return token;
}

export default function JwtPasswordRecoveryView({ mode }: Props) {
  const { t } = useTranslation('common');
  const passwordVisible = useBoolean();
  const initialized = useRef(false);
  const [requestComplete, setRequestComplete] = useState(false);
  const [resetState, setResetState] = useState<ResetState>('checking');
  const [verifyState, setVerifyState] = useState<VerifyState>('checking');
  const [resetToken, setResetToken] = useState('');
  const [totpRequired, setTotpRequired] = useState(false);
  const [verificationMethod, setVerificationMethod] = useState<'totp' | 'recovery'>('totp');
  const [errorMessage, setErrorMessage] = useState('');

  const forgotSchema = useMemo(
    () =>
      Yup.object({
        email: Yup.string()
          .trim()
          .email(t('auth.validation.email_invalid'))
          .required(t('auth.validation.email_required'))
          .max(254, t('auth.validation.email_too_long')),
      }),
    [t]
  );
  const resetSchema = useMemo(
    () =>
      Yup.object({
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
        totpCode:
          totpRequired && verificationMethod === 'totp'
            ? Yup.string()
                .matches(/^\d{6}$/, t('auth.validation.totp_six_digits'))
                .required(t('auth.validation.totp_required'))
            : Yup.string(),
        recoveryCode:
          totpRequired && verificationMethod === 'recovery'
            ? Yup.string().trim().required(t('auth.validation.recovery_required'))
            : Yup.string(),
      }),
    [t, totpRequired, verificationMethod]
  );
  const forgotMethods = useForm({
    resolver: yupResolver(forgotSchema),
    defaultValues: { email: '' },
  });
  const resetMethods = useForm({
    resolver: yupResolver(resetSchema),
    defaultValues: { password: '', confirmPassword: '', totpCode: '', recoveryCode: '' },
  });

  const describeError = useCallback(
    (error: unknown) => {
      if (error instanceof AuthApiError) {
        if (error.status === 429) return t('auth.errors.rate_limited');
        if (error.status >= 500 || error.status === 0) return t('auth.errors.network_error');
        if (error.code === 'password_unchanged') return t('auth.errors.password_unchanged');
        if (error.code === 'invalid_totp_code') return t('auth.errors.invalid_totp');
        if (error.code === 'invalid_recovery_code') return t('auth.errors.invalid_recovery_code');
        if (error.code === 'password_reset_state_changed') {
          return t('auth.password_recovery.reset.state_changed');
        }
      }
      return t('auth.errors.request_failed');
    },
    [t]
  );

  useEffect(() => {
    if (initialized.current || mode === 'forgot') return undefined;
    initialized.current = true;
    let active = true;
    if (mode === 'reset') {
      const token = consumeFragmentToken('reset_token');
      setResetToken(token);
      if (!token) {
        setResetState('invalid');
        return undefined;
      }
      inspectCustomerPasswordReset(token)
        .then((result) => {
          if (!active || !result.valid) return;
          setTotpRequired(result.totpRequired);
          setResetState('ready');
        })
        .catch(() => {
          if (active) setResetState('invalid');
        });
    } else {
      const token = consumeFragmentToken('verification_token');
      if (!token) {
        setVerifyState('invalid');
        return undefined;
      }
      completeCustomerEmailVerification(token)
        .then(() => {
          if (active) setVerifyState('complete');
        })
        .catch(() => {
          if (active) setVerifyState('invalid');
        });
    }
    return () => {
      active = false;
    };
  }, [mode]);

  const handleForgot = forgotMethods.handleSubmit(async ({ email }) => {
    setErrorMessage('');
    try {
      await requestCustomerPasswordReset(email);
      forgotMethods.reset({ email: '' });
      setRequestComplete(true);
    } catch (error) {
      setErrorMessage(describeError(error));
    }
  });

  const handleReset = resetMethods.handleSubmit(async (values) => {
    setErrorMessage('');
    try {
      await completeCustomerPasswordReset({
        resetToken,
        newPassword: values.password,
        ...(totpRequired && verificationMethod === 'totp'
          ? { totpCode: digitsOnly(values.totpCode || '') }
          : {}),
        ...(totpRequired && verificationMethod === 'recovery'
          ? { recoveryCode: (values.recoveryCode || '').trim() }
          : {}),
      });
      resetMethods.reset();
      setResetToken('');
      setResetState('complete');
    } catch (error) {
      setErrorMessage(describeError(error));
      resetMethods.setValue('totpCode', '');
      resetMethods.setValue('recoveryCode', '');
    }
  });

  const heading = (
    <Stack spacing={1.5} sx={{ mb: 4 }}>
      <Box>
        <Typography variant="h5" sx={{ fontWeight: 800, letterSpacing: '-0.02em' }}>
          {APP_NAME_CN}
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ fontWeight: 600 }}>
          {APP_NAME_EN}
        </Typography>
      </Box>
      <Chip
        icon={<Iconify icon="solar:shield-keyhole-bold-duotone" />}
        label={t('auth.role_entries.customer')}
        size="small"
        sx={{ alignSelf: 'flex-start' }}
      />
      <Typography variant="overline" sx={{ color: 'primary.main', letterSpacing: 1, fontWeight: 700 }}>
        {t(`auth.password_recovery.${mode}.eyebrow`)}
      </Typography>
      <Typography variant="h3">{t(`auth.password_recovery.${mode}.title`)}</Typography>
      <Typography variant="body2" sx={{ color: 'text.secondary', maxWidth: 440 }}>
        {t(`auth.password_recovery.${mode}.subtitle`)}
      </Typography>
    </Stack>
  );

  const backToLogin = (
    <Button component={RouterLink} href={paths.auth.customer.login} color="inherit">
      {t('auth.back_to_sign_in')}
    </Button>
  );

  let content: React.ReactNode;
  if (mode === 'forgot') {
    content = requestComplete ? (
      <Stack spacing={2.5}>
        <Alert severity="success" icon={<Iconify icon="solar:letter-opened-bold-duotone" />}>
          {t('auth.password_recovery.forgot.accepted')}
        </Alert>
        <Typography variant="body2" color="text.secondary">
          {t('auth.password_recovery.forgot.accepted_helper')}
        </Typography>
        <Button variant="outlined" color="inherit" onClick={() => setRequestComplete(false)}>
          {t('auth.password_recovery.forgot.try_another')}
        </Button>
        {backToLogin}
      </Stack>
    ) : (
      <FormProvider methods={forgotMethods} onSubmit={handleForgot}>
        <Stack spacing={2.5}>
          {errorMessage && <Alert severity="error">{errorMessage}</Alert>}
          <RHFTextField
            name="email"
            label={t('auth.fields.customer_email')}
            autoComplete="email"
            inputProps={{ maxLength: 254 }}
          />
          <LoadingButton
            fullWidth
            color="inherit"
            size="large"
            type="submit"
            variant="contained"
            loading={forgotMethods.formState.isSubmitting}
          >
            {t('auth.password_recovery.forgot.submit')}
          </LoadingButton>
          {backToLogin}
        </Stack>
      </FormProvider>
    );
  } else if (mode === 'verify') {
    if (verifyState === 'checking') {
      content = <Stack spacing={1.5}><Skeleton height={56} /><Skeleton width="70%" /></Stack>;
    } else if (verifyState === 'complete') {
      content = (
        <Stack spacing={2.5}>
          <Alert severity="success">{t('auth.password_recovery.verify.complete')}</Alert>
          <Button component={RouterLink} href={paths.auth.customer.forgotPassword} variant="contained" color="inherit">
            {t('auth.password_recovery.verify.continue')}
          </Button>
          {backToLogin}
        </Stack>
      );
    } else {
      content = (
        <Stack spacing={2.5}>
          <Alert severity="error">{t('auth.password_recovery.verify.invalid')}</Alert>
          <Button component={RouterLink} href={paths.auth.customer.forgotPassword} variant="outlined" color="inherit">
            {t('auth.password_recovery.verify.request_again')}
          </Button>
          {backToLogin}
        </Stack>
      );
    }
  } else if (resetState === 'checking') {
    content = <Stack spacing={1.5}><Skeleton height={56} /><Skeleton height={56} /><Skeleton width="70%" /></Stack>;
  } else if (resetState === 'invalid') {
    content = (
      <Stack spacing={2.5}>
        <Alert severity="error">{t('auth.password_recovery.reset.invalid')}</Alert>
        <Button component={RouterLink} href={paths.auth.customer.forgotPassword} variant="outlined" color="inherit">
          {t('auth.password_recovery.reset.request_again')}
        </Button>
        {backToLogin}
      </Stack>
    );
  } else if (resetState === 'complete') {
    content = (
      <Stack spacing={2.5}>
        <Alert severity="success">{t('auth.password_recovery.reset.complete')}</Alert>
        <Button component={RouterLink} href={paths.auth.customer.login} variant="contained" color="inherit">
          {t('auth.password_recovery.reset.sign_in')}
        </Button>
      </Stack>
    );
  } else {
    content = (
      <FormProvider methods={resetMethods} onSubmit={handleReset}>
        <Stack spacing={2.5}>
          {errorMessage && <Alert severity="error">{errorMessage}</Alert>}
          <RHFTextField
            name="password"
            label={t('auth.fields.new_password')}
            type={passwordVisible.value ? 'text' : 'password'}
            autoComplete="new-password"
            helperText={t('auth.password_recovery.reset.password_hint')}
            inputProps={{ maxLength: 128 }}
            InputProps={{
              endAdornment: (
                <InputAdornment position="end">
                  <IconButton onClick={passwordVisible.onToggle} edge="end" aria-label={t(passwordVisible.value ? 'auth.hide_password' : 'auth.show_password')}>
                    <Iconify icon={passwordVisible.value ? 'solar:eye-linear' : 'solar:eye-closed-linear'} />
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
          {totpRequired && (
            <>
              <ToggleButtonGroup
                exclusive
                fullWidth
                value={verificationMethod}
                onChange={(_, value) => value && setVerificationMethod(value)}
                size="small"
              >
                <ToggleButton value="totp">{t('auth.password_recovery.reset.use_totp')}</ToggleButton>
                <ToggleButton value="recovery">{t('auth.password_recovery.reset.use_recovery')}</ToggleButton>
              </ToggleButtonGroup>
              {verificationMethod === 'totp' ? (
                <RHFTextField
                  name="totpCode"
                  label={t('auth.password_recovery.reset.totp_label')}
                  autoComplete="one-time-code"
                  inputProps={{ inputMode: 'numeric', maxLength: 6 }}
                />
              ) : (
                <RHFTextField
                  name="recoveryCode"
                  label={t('auth.fields.recovery_code')}
                  autoComplete="off"
                  inputProps={{ maxLength: 128 }}
                />
              )}
            </>
          )}
          <LoadingButton
            fullWidth
            color="inherit"
            size="large"
            type="submit"
            variant="contained"
            loading={resetMethods.formState.isSubmitting}
          >
            {t('auth.password_recovery.reset.submit')}
          </LoadingButton>
          <Typography variant="caption" color="text.secondary" textAlign="center">
            {t('auth.password_recovery.reset.session_notice')}
          </Typography>
        </Stack>
      </FormProvider>
    );
  }

  return <>{heading}{content}</>;
}
