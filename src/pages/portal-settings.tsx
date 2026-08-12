import { FormEvent, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import LoadingButton from '@mui/lab/LoadingButton';
import Alert from '@mui/material/Alert';
import Avatar from '@mui/material/Avatar';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Card from '@mui/material/Card';
import Chip from '@mui/material/Chip';
import Divider from '@mui/material/Divider';
import IconButton from '@mui/material/IconButton';
import InputAdornment from '@mui/material/InputAdornment';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import { alpha } from '@mui/material/styles';
import { AuthApiError } from 'src/auth/context/jwt/auth-api';
import { useAuthContext } from 'src/auth/hooks';
import Iconify from 'src/components/iconify';
import { useSettingsContext } from 'src/components/settings';
import { getLocalizedApiError } from 'src/locales/api-error';
import useLocales from 'src/locales/use-locales';

const PASSWORD_MIN_LENGTH = 14;
const PASSWORD_MAX_LENGTH = 128;

type ChoiceProps = {
  active: boolean;
  icon: string;
  label: string;
  onClick: VoidFunction;
};

type PasswordValues = {
  currentPassword: string;
  newPassword: string;
  confirmPassword: string;
  totpCode: string;
};

type PasswordField = keyof PasswordValues;
type PasswordErrors = Partial<Record<PasswordField, string>>;
type PasswordVisibilityField = Exclude<PasswordField, 'totpCode'>;
type PasswordVisibility = Record<PasswordVisibilityField, boolean>;

const EMPTY_PASSWORD_VALUES: PasswordValues = {
  currentPassword: '',
  newPassword: '',
  confirmPassword: '',
  totpCode: '',
};

const HIDDEN_PASSWORDS: PasswordVisibility = {
  currentPassword: false,
  newPassword: false,
  confirmPassword: false,
};

function Choice({ active, icon, label, onClick }: ChoiceProps) {
  return (
    <Button
      type="button"
      fullWidth
      aria-pressed={active}
      variant="outlined"
      color={active ? 'primary' : 'inherit'}
      onClick={onClick}
      startIcon={<Iconify icon={icon} width={20} />}
      sx={{
        minHeight: 48,
        justifyContent: 'flex-start',
        borderColor: (theme) =>
          active ? theme.palette.primary.main : alpha(theme.palette.grey[500], 0.24),
        bgcolor: (theme) => (active ? alpha(theme.palette.primary.main, 0.08) : 'transparent'),
        '&:hover': {
          borderColor: (theme) =>
            active ? theme.palette.primary.main : alpha(theme.palette.grey[500], 0.48),
          bgcolor: (theme) => alpha(theme.palette.primary.main, active ? 0.12 : 0.04),
        },
      }}
    >
      {label}
    </Button>
  );
}

type SectionHeadingProps = {
  icon: string;
  title: string;
  description: string;
  action?: React.ReactNode;
};

function SectionHeading({ icon, title, description, action }: SectionHeadingProps) {
  return (
    <Stack direction="row" alignItems="flex-start" spacing={1.5}>
      <Box
        sx={{
          mt: 0.25,
          width: 36,
          height: 36,
          flexShrink: 0,
          display: 'grid',
          placeItems: 'center',
          borderRadius: 1.25,
          color: 'primary.main',
          bgcolor: (theme) => alpha(theme.palette.primary.main, 0.1),
        }}
      >
        <Iconify icon={icon} width={20} />
      </Box>
      <Box sx={{ flex: '1 1 auto', minWidth: 0 }}>
        <Typography variant="subtitle1">{title}</Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mt: 0.25 }}>
          {description}
        </Typography>
      </Box>
      {action}
    </Stack>
  );
}

type PasswordInputProps = {
  label: string;
  value: string;
  error?: string;
  autoComplete: 'current-password' | 'new-password';
  showPassword: boolean;
  showLabel: string;
  hideLabel: string;
  disabled?: boolean;
  onToggleVisibility: VoidFunction;
  onChange: (value: string) => void;
};

function PasswordInput({
  label,
  value,
  error,
  autoComplete,
  showPassword,
  showLabel,
  hideLabel,
  disabled = false,
  onToggleVisibility,
  onChange,
}: PasswordInputProps) {
  return (
    <TextField
      fullWidth
      type={showPassword ? 'text' : 'password'}
      label={label}
      value={value}
      disabled={disabled}
      error={Boolean(error)}
      helperText={error || ' '}
      autoComplete={autoComplete}
      onChange={(event) => onChange(event.target.value)}
      inputProps={{ maxLength: PASSWORD_MAX_LENGTH }}
      InputProps={{
        endAdornment: (
          <InputAdornment position="end">
            <IconButton
              edge="end"
              aria-label={showPassword ? hideLabel : showLabel}
              onClick={onToggleVisibility}
              sx={{ width: 44, height: 44 }}
            >
              <Iconify icon={showPassword ? 'solar:eye-closed-linear' : 'solar:eye-linear'} />
            </IconButton>
          </InputAdornment>
        ),
      }}
    />
  );
}

type PasswordRequirementProps = {
  met: boolean;
  label: string;
  metLabel: string;
  unmetLabel: string;
};

function PasswordRequirement({ met, label, metLabel, unmetLabel }: PasswordRequirementProps) {
  return (
    <Stack
      direction="row"
      alignItems="center"
      spacing={0.75}
      aria-label={`${label}: ${met ? metLabel : unmetLabel}`}
    >
      <Iconify
        icon={met ? 'solar:check-circle-bold' : 'solar:record-circle-linear'}
        width={17}
        aria-hidden
        sx={{ color: met ? 'success.main' : 'text.disabled' }}
      />
      <Typography
        aria-hidden
        variant="caption"
        color={met ? 'text.primary' : 'text.secondary'}
      >
        {label}
      </Typography>
    </Stack>
  );
}

export default function PortalSettings() {
  const { t } = useTranslation('portal');
  const settings = useSettingsContext();
  const { currentLang, onChangeLang } = useLocales();
  const { user, changePassword } = useAuthContext();
  const [passwords, setPasswords] = useState<PasswordValues>(EMPTY_PASSWORD_VALUES);
  const [passwordErrors, setPasswordErrors] = useState<PasswordErrors>({});
  const [visiblePasswords, setVisiblePasswords] = useState<PasswordVisibility>(HIDDEN_PASSWORDS);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState('');
  const [changed, setChanged] = useState(false);
  const passwordChangeAvailable = user?.id !== 'usr_local_portal';

  const passwordRules = useMemo(
    () => [
      {
        key: 'length',
        met:
          passwords.newPassword.length >= PASSWORD_MIN_LENGTH &&
          passwords.newPassword.length <= PASSWORD_MAX_LENGTH,
        label: t('settings_page.security.rules.length'),
      },
      {
        key: 'letters',
        met: /[a-z]/.test(passwords.newPassword) && /[A-Z]/.test(passwords.newPassword),
        label: t('settings_page.security.rules.letters'),
      },
      {
        key: 'number',
        met: /\d/.test(passwords.newPassword),
        label: t('settings_page.security.rules.number'),
      },
      {
        key: 'symbol',
        met: /[^A-Za-z0-9]/.test(passwords.newPassword),
        label: t('settings_page.security.rules.symbol'),
      },
    ],
    [passwords.newPassword, t]
  );

  const setPasswordValue = (field: PasswordField, value: string) => {
    setPasswords((current) => ({ ...current, [field]: value }));
    setPasswordErrors((current) => ({ ...current, [field]: undefined }));
    setSubmitError('');
    setChanged(false);
  };

  const handleLanguageChange = (language: 'cn' | 'en') => {
    setPasswordErrors({});
    setSubmitError('');
    onChangeLang(language);
  };

  const togglePasswordVisibility = (field: PasswordVisibilityField) => {
    setVisiblePasswords((current) => ({ ...current, [field]: !current[field] }));
  };

  const validatePasswordForm = () => {
    const errors: PasswordErrors = {};
    if (!passwords.currentPassword) {
      errors.currentPassword = t('settings_page.security.validation.current_required');
    }
    if (!passwords.newPassword) {
      errors.newPassword = t('settings_page.security.validation.new_required');
    } else if (!passwordRules.every((rule) => rule.met)) {
      errors.newPassword = t('settings_page.security.validation.new_invalid');
    } else if (passwords.newPassword === passwords.currentPassword) {
      errors.newPassword = t('settings_page.security.validation.same_password');
    }
    if (!passwords.confirmPassword) {
      errors.confirmPassword = t('settings_page.security.validation.confirm_required');
    } else if (passwords.confirmPassword !== passwords.newPassword) {
      errors.confirmPassword = t('settings_page.security.validation.passwords_mismatch');
    }
    if (!/^\d{6}$/.test(passwords.totpCode)) {
      errors.totpCode = t('settings_page.security.validation.totp_invalid');
    }
    setPasswordErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const handlePasswordSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSubmitError('');
    setChanged(false);
    if (!passwordChangeAvailable) return;
    if (!validatePasswordForm()) return;

    setSubmitting(true);
    try {
      await changePassword({
        currentPassword: passwords.currentPassword,
        newPassword: passwords.newPassword,
        totpCode: passwords.totpCode,
      });
      setPasswords(EMPTY_PASSWORD_VALUES);
      setPasswordErrors({});
      setVisiblePasswords(HIDDEN_PASSWORDS);
      setChanged(true);
    } catch (error) {
      const code = error instanceof AuthApiError ? error.code : '';
      const message = getLocalizedApiError(
        code ? { error: { code } } : undefined,
        t('settings_page.security.change_failed')
      );
      setSubmitError(message);
      if (code === 'invalid_current_password') {
        setPasswordErrors((current) => ({ ...current, currentPassword: message }));
      }
      if (code === 'invalid_totp_code') {
        setPasswordErrors((current) => ({ ...current, totpCode: message }));
      }
    } finally {
      setSubmitting(false);
    }
  };

  const roleLabel =
    user?.role === 'admin'
      ? t('settings_page.account.admin_role')
      : t('settings_page.account.partner_role');
  const identityName = user?.displayName || user?.email?.split('@')[0] || '';

  return (
    <Box sx={{ width: 1, maxWidth: 1120 }}>
      <Box
        sx={{
          display: 'grid',
          alignItems: 'start',
          gridTemplateColumns: {
            xs: 'minmax(0, 1fr)',
            lg: 'minmax(0, 1.35fr) minmax(320px, 0.85fr)',
          },
          gap: 3,
        }}
      >
        <Card sx={{ overflow: 'hidden' }}>
          <Box sx={{ p: { xs: 2.5, sm: 3.5 } }}>
            <SectionHeading
              icon="solar:shield-user-bold-duotone"
              title={t('settings_page.security.title')}
              description={t('settings_page.security.description')}
            />
          </Box>

          <Divider />

          <Stack
            direction={{ xs: 'column', sm: 'row' }}
            alignItems={{ xs: 'flex-start', sm: 'center' }}
            spacing={2}
            sx={{ px: { xs: 2.5, sm: 3.5 }, py: 2.75 }}
          >
            <Avatar
              alt={identityName}
              src={user?.photoURL || undefined}
              sx={{ width: 48, height: 48, bgcolor: 'primary.main', fontWeight: 700 }}
            >
              {identityName.charAt(0).toUpperCase() || '•'}
            </Avatar>
            <Box sx={{ flex: '1 1 auto', minWidth: 0 }}>
              <Stack direction="row" alignItems="center" spacing={1} flexWrap="wrap" useFlexGap>
                <Typography variant="subtitle1" noWrap>
                  {user?.email || t('settings_page.account.unavailable')}
                </Typography>
                <Chip size="small" label={roleLabel} />
              </Stack>
              <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
                {t('settings_page.account.managed_hint')}
              </Typography>
            </Box>
            <Chip
              icon={<Iconify icon="solar:lock-password-bold" />}
              color="success"
              variant="soft"
              label={t('settings_page.account.secure_session')}
            />
          </Stack>

          <Divider />

          <Box
            component="form"
            noValidate
            onSubmit={handlePasswordSubmit}
            sx={{ p: { xs: 2.5, sm: 3.5 } }}
          >
            <Typography variant="subtitle1">{t('settings_page.security.change_title')}</Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5, mb: 2.5 }}>
              {t('settings_page.security.change_description')}
            </Typography>

            <Alert severity={passwordChangeAvailable ? 'info' : 'warning'} sx={{ mb: 2.5 }}>
              {passwordChangeAvailable
                ? t('settings_page.security.session_notice')
                : t('settings_page.security.local_bypass_notice')}
            </Alert>

            <Box
              sx={{
                display: 'grid',
                gridTemplateColumns: { xs: 'minmax(0, 1fr)', sm: 'repeat(2, minmax(0, 1fr))' },
                columnGap: 2,
              }}
            >
              <PasswordInput
                label={t('settings_page.security.current_password')}
                value={passwords.currentPassword}
                error={passwordErrors.currentPassword}
                disabled={!passwordChangeAvailable}
                autoComplete="current-password"
                showPassword={visiblePasswords.currentPassword}
                showLabel={t('settings_page.security.show_password')}
                hideLabel={t('settings_page.security.hide_password')}
                onToggleVisibility={() => togglePasswordVisibility('currentPassword')}
                onChange={(value) => setPasswordValue('currentPassword', value)}
              />
              <TextField
                fullWidth
                label={t('settings_page.security.totp_code')}
                value={passwords.totpCode}
                disabled={!passwordChangeAvailable}
                error={Boolean(passwordErrors.totpCode)}
                helperText={passwordErrors.totpCode || t('settings_page.security.totp_hint')}
                autoComplete="one-time-code"
                onChange={(event) =>
                  setPasswordValue('totpCode', event.target.value.replace(/\D/g, '').slice(0, 6))
                }
                inputProps={{ inputMode: 'numeric', pattern: '[0-9]*', maxLength: 6 }}
              />
              <PasswordInput
                label={t('settings_page.security.new_password')}
                value={passwords.newPassword}
                error={passwordErrors.newPassword}
                disabled={!passwordChangeAvailable}
                autoComplete="new-password"
                showPassword={visiblePasswords.newPassword}
                showLabel={t('settings_page.security.show_password')}
                hideLabel={t('settings_page.security.hide_password')}
                onToggleVisibility={() => togglePasswordVisibility('newPassword')}
                onChange={(value) => setPasswordValue('newPassword', value)}
              />
              <PasswordInput
                label={t('settings_page.security.confirm_password')}
                value={passwords.confirmPassword}
                error={passwordErrors.confirmPassword}
                disabled={!passwordChangeAvailable}
                autoComplete="new-password"
                showPassword={visiblePasswords.confirmPassword}
                showLabel={t('settings_page.security.show_password')}
                hideLabel={t('settings_page.security.hide_password')}
                onToggleVisibility={() => togglePasswordVisibility('confirmPassword')}
                onChange={(value) => setPasswordValue('confirmPassword', value)}
              />
            </Box>

            <Box
              aria-live="polite"
              sx={{
                p: 2,
                borderRadius: 1.5,
                bgcolor: (theme) => alpha(theme.palette.grey[500], 0.06),
              }}
            >
              <Typography variant="subtitle2" sx={{ mb: 1.25 }}>
                {t('settings_page.security.rules.title')}
              </Typography>
              <Box
                sx={{
                  display: 'grid',
                  gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, minmax(0, 1fr))' },
                  gap: 1,
                }}
              >
                {passwordRules.map((rule) => (
                  <PasswordRequirement
                    key={rule.key}
                    met={rule.met}
                    label={rule.label}
                    metLabel={t('settings_page.security.rules.met')}
                    unmetLabel={t('settings_page.security.rules.unmet')}
                  />
                ))}
              </Box>
            </Box>

            {submitError && (
              <Alert severity="error" sx={{ mt: 2.5 }}>
                {submitError}
              </Alert>
            )}
            {changed && (
              <Alert severity="success" sx={{ mt: 2.5 }}>
                {t('settings_page.security.change_success')}
              </Alert>
            )}

            <Stack direction="row" justifyContent="flex-end" sx={{ mt: 2.5 }}>
              <LoadingButton
                type="submit"
                variant="contained"
                disabled={!passwordChangeAvailable}
                loading={submitting}
                startIcon={<Iconify icon="solar:lock-password-bold-duotone" />}
                sx={{ minHeight: 44, width: { xs: 1, sm: 'auto' } }}
              >
                {t('settings_page.security.submit')}
              </LoadingButton>
            </Stack>
          </Box>
        </Card>

        <Card sx={{ overflow: 'hidden' }}>
          <Box sx={{ p: { xs: 2.5, sm: 3.5 } }}>
            <SectionHeading
              icon="solar:palette-bold-duotone"
              title={t('settings_page.preferences.title')}
              description={t('settings_page.preferences.description')}
              action={
                <Chip
                  size="small"
                  color="success"
                  variant="soft"
                  label={t('settings_page.preferences.saved_locally')}
                  sx={{ display: { xs: 'none', sm: 'inline-flex' } }}
                />
              }
            />
          </Box>

          <Divider />

          <Stack spacing={3} divider={<Divider flexItem />} sx={{ p: { xs: 2.5, sm: 3.5 } }}>
            <Stack spacing={1.25}>
              <Typography variant="subtitle2">{t('settings_page.preferences.language')}</Typography>
              <Box
                sx={{
                  display: 'grid',
                  gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, minmax(0, 1fr))' },
                  gap: 1,
                }}
              >
                <Choice
                  active={currentLang.value === 'cn'}
                  icon="flagpack:cn"
                  label="简体中文"
                  onClick={() => handleLanguageChange('cn')}
                />
                <Choice
                  active={currentLang.value === 'en'}
                  icon="flagpack:gb-nir"
                  label="English"
                  onClick={() => handleLanguageChange('en')}
                />
              </Box>
            </Stack>

            <Stack spacing={1.25}>
              <Typography variant="subtitle2">
                {t('settings_page.preferences.color_mode')}
              </Typography>
              <Box
                sx={{
                  display: 'grid',
                  gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, minmax(0, 1fr))' },
                  gap: 1,
                }}
              >
                <Choice
                  active={settings.themeMode === 'light'}
                  icon="solar:sun-2-bold-duotone"
                  label={t('settings_page.preferences.light')}
                  onClick={() => settings.onUpdate('themeMode', 'light')}
                />
                <Choice
                  active={settings.themeMode === 'dark'}
                  icon="solar:moon-bold-duotone"
                  label={t('settings_page.preferences.dark')}
                  onClick={() => settings.onUpdate('themeMode', 'dark')}
                />
              </Box>
            </Stack>

            <Stack spacing={1.25}>
              <Typography variant="subtitle2">
                {t('settings_page.preferences.navigation')}
              </Typography>
              <Box
                sx={{
                  display: 'grid',
                  gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, minmax(0, 1fr))' },
                  gap: 1,
                }}
              >
                <Choice
                  active={settings.themeLayout === 'vertical'}
                  icon="solar:sidebar-minimalistic-bold-duotone"
                  label={t('settings_page.preferences.expanded')}
                  onClick={() => settings.onUpdate('themeLayout', 'vertical')}
                />
                <Choice
                  active={settings.themeLayout === 'mini'}
                  icon="solar:sidebar-code-bold-duotone"
                  label={t('settings_page.preferences.collapsed')}
                  onClick={() => settings.onUpdate('themeLayout', 'mini')}
                />
              </Box>
            </Stack>

            <Stack spacing={1.25}>
              <Typography variant="subtitle2">
                {t('settings_page.preferences.content_width')}
              </Typography>
              <Box
                sx={{
                  display: 'grid',
                  gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, minmax(0, 1fr))' },
                  gap: 1,
                }}
              >
                <Choice
                  active={!settings.themeStretch}
                  icon="solar:monitor-bold-duotone"
                  label={t('settings_page.preferences.standard')}
                  onClick={() => settings.onUpdate('themeStretch', false)}
                />
                <Choice
                  active={settings.themeStretch}
                  icon="solar:full-screen-square-bold-duotone"
                  label={t('settings_page.preferences.wide')}
                  onClick={() => settings.onUpdate('themeStretch', true)}
                />
              </Box>
            </Stack>

            <Stack spacing={1.5} alignItems="flex-start">
              <Box>
                <Typography variant="subtitle2">
                  {t('settings_page.preferences.more_options')}
                </Typography>
                <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
                  {t('settings_page.preferences.more_options_hint')}
                </Typography>
              </Box>
              <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} sx={{ width: 1 }}>
                <Button
                  variant="outlined"
                  onClick={settings.onToggle}
                  endIcon={<Iconify icon="solar:arrow-right-linear" />}
                  sx={{ minHeight: 44, flex: 1 }}
                >
                  {t('settings_page.preferences.open_complete')}
                </Button>
                <Button
                  color="inherit"
                  disabled={!settings.canReset}
                  onClick={settings.onReset}
                  startIcon={<Iconify icon="solar:restart-bold" />}
                  sx={{ minHeight: 44 }}
                >
                  {t('settings_page.preferences.reset')}
                </Button>
              </Stack>
            </Stack>
          </Stack>
        </Card>
      </Box>
    </Box>
  );
}
