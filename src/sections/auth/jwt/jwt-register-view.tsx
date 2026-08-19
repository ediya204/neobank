import { ChangeEvent, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import ButtonBase from '@mui/material/ButtonBase';
import Checkbox from '@mui/material/Checkbox';
import Divider from '@mui/material/Divider';
import FormControlLabel from '@mui/material/FormControlLabel';
import LinearProgress from '@mui/material/LinearProgress';
import MenuItem from '@mui/material/MenuItem';
import Paper from '@mui/material/Paper';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import { alpha } from '@mui/material/styles';
import { APP_NAME_CN, APP_NAME_EN } from 'src/config-global';
import { RouterLink } from 'src/routes/components';
import Iconify from 'src/components/iconify';

type AccountType = 'individual' | 'business';

type ApplicationForm = {
  accountType: AccountType | '';
  email: string;
  password: string;
  confirmPassword: string;
  phoneCountryCode: string;
  phone: string;
  residenceCountry: string;
  fullName: string;
  dateOfBirth: string;
  nationality: string;
  legalName: string;
  registrationNumber: string;
  incorporationCountry: string;
  contactName: string;
  contactRole: string;
  beneficialOwnerName: string;
  beneficialOwnerOwnership: string;
  kycConsent: boolean;
  termsAccepted: boolean;
};

type FieldName = keyof ApplicationForm;
type Errors = Partial<Record<FieldName, string>>;

const INITIAL_FORM: ApplicationForm = {
  accountType: '',
  email: '',
  password: '',
  confirmPassword: '',
  phoneCountryCode: '+852',
  phone: '',
  residenceCountry: '',
  fullName: '',
  dateOfBirth: '',
  nationality: '',
  legalName: '',
  registrationNumber: '',
  incorporationCountry: '',
  contactName: '',
  contactRole: '',
  beneficialOwnerName: '',
  beneficialOwnerOwnership: '',
  kycConsent: false,
  termsAccepted: false,
};

const COUNTRIES = [
  { value: 'HK', labelKey: 'auth.registration.countries.hk' },
  { value: 'SG', labelKey: 'auth.registration.countries.sg' },
  { value: 'CN', labelKey: 'auth.registration.countries.cn' },
  { value: 'GB', labelKey: 'auth.registration.countries.gb' },
  { value: 'US', labelKey: 'auth.registration.countries.us' },
];

const PHONE_CODES = ['+852', '+65', '+86', '+44', '+1'];

type Props = {
  loginPath: string;
};

export default function JwtRegisterView({ loginPath }: Props) {
  const { t } = useTranslation('common');
  const [activeStep, setActiveStep] = useState(0);
  const [form, setForm] = useState<ApplicationForm>(INITIAL_FORM);
  const [errors, setErrors] = useState<Errors>({});
  const [submittedReference, setSubmittedReference] = useState('');
  const [submissionError, setSubmissionError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const idempotencyKey = useRef(crypto.randomUUID());

  const fieldError = (field: FieldName) => {
    const key = errors[field];
    return key ? t(key) : '';
  };

  const steps = useMemo(
    () => [
      t('auth.registration.steps.account_type'),
      t('auth.registration.steps.details'),
      t('auth.registration.steps.kyc'),
      t('auth.registration.steps.review'),
    ],
    [t]
  );

  const updateField = (field: FieldName, value: string | boolean) => {
    setForm((current) => ({ ...current, [field]: value }));
    setErrors((current) => ({ ...current, [field]: undefined }));
    setSubmissionError('');
    idempotencyKey.current = crypto.randomUUID();
  };

  const handleTextChange =
    (field: FieldName) => (event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      updateField(field, event.target.value);
    };

  const validateStep = () => {
    const nextErrors: Errors = {};
    const required = (field: FieldName) => {
      if (!String(form[field] || '').trim()) {
        nextErrors[field] = 'auth.registration.validation.required';
      }
    };

    if (activeStep === 0 && !form.accountType) {
      nextErrors.accountType = 'auth.registration.validation.account_type';
    }

    if (activeStep === 1) {
      required('email');
      required('password');
      required('confirmPassword');
      required('phone');
      required('residenceCountry');
      if (form.email && !/^\S+@\S+\.\S+$/.test(form.email)) {
        nextErrors.email = 'auth.registration.validation.email';
      }
      if (
        form.password &&
        (form.password.length < 14 ||
          form.password.length > 128 ||
          !/[a-z]/.test(form.password) ||
          !/[A-Z]/.test(form.password) ||
          !/\d/.test(form.password) ||
          !/[^A-Za-z0-9]/.test(form.password))
      ) {
        nextErrors.password = 'auth.registration.validation.password';
      }
      if (form.confirmPassword && form.confirmPassword !== form.password) {
        nextErrors.confirmPassword = 'auth.registration.validation.passwords_mismatch';
      }
      if (form.phone && form.phone.replace(/\D/g, '').length < 6) {
        nextErrors.phone = 'auth.registration.validation.phone';
      }

      if (form.accountType === 'individual') {
        required('fullName');
        required('dateOfBirth');
        required('nationality');
        if (form.dateOfBirth) {
          const birthDate = new Date(`${form.dateOfBirth}T00:00:00Z`);
          const adultCutoff = new Date();
          adultCutoff.setUTCFullYear(adultCutoff.getUTCFullYear() - 18);
          if (Number.isNaN(birthDate.getTime()) || birthDate > adultCutoff) {
            nextErrors.dateOfBirth = 'auth.registration.validation.adult';
          }
        }
      } else {
        required('legalName');
        required('registrationNumber');
        required('incorporationCountry');
        required('contactName');
        required('contactRole');
        required('beneficialOwnerName');
        required('beneficialOwnerOwnership');
        const ownership = Number(form.beneficialOwnerOwnership);
        if (form.beneficialOwnerOwnership && (ownership <= 0 || ownership > 100)) {
          nextErrors.beneficialOwnerOwnership = 'auth.registration.validation.ownership';
        }
      }
    }

    if (activeStep === 2 && !form.kycConsent) {
      nextErrors.kycConsent = 'auth.registration.validation.kyc_consent';
    }

    if (activeStep === 3 && !form.termsAccepted) {
      nextErrors.termsAccepted = 'auth.registration.validation.terms';
    }

    setErrors(nextErrors);
    return Object.keys(nextErrors).length === 0;
  };

  const nextStep = () => {
    if (!validateStep()) return;
    setActiveStep((step) => Math.min(step + 1, steps.length - 1));
  };

  const previousStep = () => {
    setErrors({});
    setActiveStep((step) => Math.max(step - 1, 0));
  };

  const submitApplication = async () => {
    if (!validateStep()) return;
    setSubmitting(true);
    setSubmissionError('');
    try {
      const response = await fetch('/api/auth/customer/register', {
        method: 'POST',
        credentials: 'same-origin',
        headers: {
          'content-type': 'application/json',
          'idempotency-key': idempotencyKey.current,
        },
        body: JSON.stringify({
          account_type: form.accountType,
          email: form.email,
          password: form.password,
          phone_country_code: form.phoneCountryCode,
          phone: form.phone,
          residence_country: form.residenceCountry,
          full_name: form.fullName,
          date_of_birth: form.dateOfBirth,
          nationality: form.nationality,
          legal_name: form.legalName,
          registration_number: form.registrationNumber,
          incorporation_country: form.incorporationCountry,
          contact_name: form.contactName,
          contact_role: form.contactRole,
          beneficial_owner_name: form.beneficialOwnerName,
          beneficial_owner_ownership: form.beneficialOwnerOwnership,
          kyc_consent: form.kycConsent,
          terms_accepted: form.termsAccepted,
        }),
      });
      const payload = (await response.json().catch(() => null)) as {
        application_reference?: string;
        error?: { code?: string };
      } | null;
      if (!response.ok || !payload?.application_reference) {
        const duplicate = payload?.error?.code === 'application_already_exists';
        throw new Error(
          duplicate
            ? t('auth.registration.errors.already_exists')
            : t('auth.registration.errors.submit')
        );
      }
      setSubmittedReference(payload.application_reference);
      setForm((current) => ({ ...current, password: '', confirmPassword: '' }));
    } catch (caught) {
      setSubmissionError(
        caught instanceof Error ? caught.message : t('auth.registration.errors.submit')
      );
    } finally {
      setSubmitting(false);
    }
  };

  const accountTypeCard = (type: AccountType, icon: string, title: string, description: string) => {
    const selected = form.accountType === type;
    return (
      <ButtonBase
        key={type}
        onClick={() => updateField('accountType', type)}
        aria-pressed={selected}
        sx={{ width: 1, textAlign: 'left', borderRadius: 2 }}
      >
        <Paper
          variant="outlined"
          sx={{
            width: 1,
            p: 2.5,
            borderColor: selected ? 'primary.main' : 'divider',
            bgcolor: selected ? (theme) => alpha(theme.palette.primary.main, 0.06) : 'transparent',
            transition: (theme) =>
              theme.transitions.create(['border-color', 'background-color', 'transform']),
            '.MuiButtonBase-root:hover &': {
              borderColor: 'primary.main',
              transform: 'translateY(-2px)',
            },
          }}
        >
          <Stack direction="row" spacing={2} alignItems="flex-start">
            <Box
              sx={{
                width: 44,
                height: 44,
                borderRadius: 1.5,
                display: 'grid',
                placeItems: 'center',
                color: selected ? 'primary.contrastText' : 'primary.main',
                bgcolor: selected ? 'primary.main' : 'action.hover',
                flexShrink: 0,
              }}
            >
              <Iconify icon={icon} width={24} />
            </Box>
            <Box sx={{ flexGrow: 1 }}>
              <Stack direction="row" justifyContent="space-between" spacing={1}>
                <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>
                  {title}
                </Typography>
                <Iconify
                  icon={selected ? 'solar:check-circle-bold' : 'solar:round-alt-arrow-right-linear'}
                  width={22}
                  sx={{ color: selected ? 'primary.main' : 'text.disabled' }}
                />
              </Stack>
              <Typography variant="body2" sx={{ color: 'text.secondary', mt: 0.5 }}>
                {description}
              </Typography>
            </Box>
          </Stack>
        </Paper>
      </ButtonBase>
    );
  };

  const countrySelect = (field: FieldName, label: string) => (
    <TextField
      select
      fullWidth
      label={label}
      value={form[field]}
      onChange={handleTextChange(field)}
      error={Boolean(errors[field])}
      helperText={fieldError(field)}
    >
      {COUNTRIES.map((country) => (
        <MenuItem key={country.value} value={country.value}>
          {t(country.labelKey)}
        </MenuItem>
      ))}
    </TextField>
  );

  const renderAccountType = (
    <Stack spacing={2}>
      <Typography variant="body1" sx={{ color: 'text.secondary' }}>
        {t('auth.registration.account_type.description')}
      </Typography>
      {accountTypeCard(
        'individual',
        'solar:user-rounded-bold-duotone',
        t('auth.registration.account_type.individual.title'),
        t('auth.registration.account_type.individual.description')
      )}
      {accountTypeCard(
        'business',
        'solar:buildings-3-bold-duotone',
        t('auth.registration.account_type.business.title'),
        t('auth.registration.account_type.business.description')
      )}
      {errors.accountType && <Alert severity="error">{fieldError('accountType')}</Alert>}
    </Stack>
  );

  const renderDetails = (
    <Stack spacing={2.25}>
      <Alert severity="info" icon={<Iconify icon="solar:shield-check-bold-duotone" />}>
        {t('auth.registration.details.privacy')}
      </Alert>

      {form.accountType === 'individual' ? (
        <>
          <TextField
            fullWidth
            label={t('auth.registration.fields.full_name')}
            value={form.fullName}
            onChange={handleTextChange('fullName')}
            error={Boolean(errors.fullName)}
            helperText={fieldError('fullName')}
            autoComplete="name"
          />
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
            <TextField
              fullWidth
              type="date"
              label={t('auth.registration.fields.date_of_birth')}
              value={form.dateOfBirth}
              onChange={handleTextChange('dateOfBirth')}
              error={Boolean(errors.dateOfBirth)}
              helperText={fieldError('dateOfBirth')}
              InputLabelProps={{ shrink: true }}
              inputProps={{ max: new Date().toISOString().slice(0, 10) }}
            />
            {countrySelect('nationality', t('auth.registration.fields.nationality'))}
          </Stack>
        </>
      ) : (
        <>
          <TextField
            fullWidth
            label={t('auth.registration.fields.legal_name')}
            value={form.legalName}
            onChange={handleTextChange('legalName')}
            error={Boolean(errors.legalName)}
            helperText={fieldError('legalName')}
            autoComplete="organization"
          />
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
            <TextField
              fullWidth
              label={t('auth.registration.fields.registration_number')}
              value={form.registrationNumber}
              onChange={handleTextChange('registrationNumber')}
              error={Boolean(errors.registrationNumber)}
              helperText={fieldError('registrationNumber')}
            />
            {countrySelect(
              'incorporationCountry',
              t('auth.registration.fields.incorporation_country')
            )}
          </Stack>
          <Divider>{t('auth.registration.details.authorized_contact')}</Divider>
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
            <TextField
              fullWidth
              label={t('auth.registration.fields.contact_name')}
              value={form.contactName}
              onChange={handleTextChange('contactName')}
              error={Boolean(errors.contactName)}
              helperText={fieldError('contactName')}
              autoComplete="name"
            />
            <TextField
              fullWidth
              label={t('auth.registration.fields.contact_role')}
              value={form.contactRole}
              onChange={handleTextChange('contactRole')}
              error={Boolean(errors.contactRole)}
              helperText={fieldError('contactRole')}
            />
          </Stack>
          <Divider>{t('auth.registration.details.beneficial_owner')}</Divider>
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
            <TextField
              fullWidth
              label={t('auth.registration.fields.beneficial_owner_name')}
              value={form.beneficialOwnerName}
              onChange={handleTextChange('beneficialOwnerName')}
              error={Boolean(errors.beneficialOwnerName)}
              helperText={fieldError('beneficialOwnerName')}
            />
            <TextField
              fullWidth
              type="number"
              label={t('auth.registration.fields.ownership')}
              value={form.beneficialOwnerOwnership}
              onChange={handleTextChange('beneficialOwnerOwnership')}
              error={Boolean(errors.beneficialOwnerOwnership)}
              helperText={fieldError('beneficialOwnerOwnership')}
              inputProps={{ min: 0.01, max: 100, step: 0.01 }}
            />
          </Stack>
        </>
      )}

      <Divider>{t('auth.registration.details.contact')}</Divider>
      <TextField
        fullWidth
        type="email"
        label={t('auth.registration.fields.email')}
        value={form.email}
        onChange={handleTextChange('email')}
        error={Boolean(errors.email)}
        helperText={fieldError('email') || t('auth.registration.details.email_hint')}
        autoComplete="email"
      />
      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
        <TextField
          fullWidth
          type="password"
          label={t('auth.registration.fields.password')}
          value={form.password}
          onChange={handleTextChange('password')}
          error={Boolean(errors.password)}
          helperText={fieldError('password') || t('auth.registration.details.password_hint')}
          autoComplete="new-password"
          inputProps={{ minLength: 14, maxLength: 128 }}
        />
        <TextField
          fullWidth
          type="password"
          label={t('auth.registration.fields.confirm_password')}
          value={form.confirmPassword}
          onChange={handleTextChange('confirmPassword')}
          error={Boolean(errors.confirmPassword)}
          helperText={fieldError('confirmPassword')}
          autoComplete="new-password"
          inputProps={{ minLength: 14, maxLength: 128 }}
        />
      </Stack>
      <Stack direction="row" spacing={2}>
        <TextField
          select
          label={t('auth.registration.fields.phone_code')}
          value={form.phoneCountryCode}
          onChange={handleTextChange('phoneCountryCode')}
          sx={{ width: 132, flexShrink: 0 }}
        >
          {PHONE_CODES.map((code) => (
            <MenuItem key={code} value={code}>
              {code}
            </MenuItem>
          ))}
        </TextField>
        <TextField
          fullWidth
          label={t('auth.registration.fields.phone')}
          value={form.phone}
          onChange={handleTextChange('phone')}
          error={Boolean(errors.phone)}
          helperText={fieldError('phone')}
          autoComplete="tel-national"
          inputProps={{ inputMode: 'tel' }}
        />
      </Stack>
      {countrySelect('residenceCountry', t('auth.registration.fields.residence_country'))}
    </Stack>
  );

  const kycItems =
    form.accountType === 'individual'
      ? [
          ['solar:card-2-bold-duotone', t('auth.registration.kyc.individual.document')],
          ['solar:user-id-bold-duotone', t('auth.registration.kyc.individual.face')],
          ['solar:home-2-bold-duotone', t('auth.registration.kyc.individual.address')],
        ]
      : [
          ['solar:document-text-bold-duotone', t('auth.registration.kyc.business.company')],
          ['solar:users-group-rounded-bold-duotone', t('auth.registration.kyc.business.people')],
          ['solar:diagram-up-bold-duotone', t('auth.registration.kyc.business.ownership')],
        ];

  const renderKyc = (
    <Stack spacing={2.5}>
      <Alert severity="info">{t('auth.registration.kyc.provider_handoff')}</Alert>
      <Stack spacing={1.5}>
        {kycItems.map(([icon, label], index) => (
          <Stack key={label} direction="row" spacing={2} alignItems="center" sx={{ py: 1.25 }}>
            <Box
              sx={{
                width: 40,
                height: 40,
                display: 'grid',
                placeItems: 'center',
                borderRadius: '50%',
                bgcolor: 'action.hover',
                color: 'primary.main',
                flexShrink: 0,
              }}
            >
              <Iconify icon={icon} width={22} />
            </Box>
            <Box sx={{ flexGrow: 1 }}>
              <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                {t('auth.registration.kyc.item_label', { number: index + 1 })}
              </Typography>
              <Typography variant="subtitle2">{label}</Typography>
            </Box>
            <Iconify icon="solar:check-read-linear" width={22} sx={{ color: 'text.disabled' }} />
          </Stack>
        ))}
      </Stack>
      <Paper variant="outlined" sx={{ p: 2.5, bgcolor: 'background.neutral' }}>
        <Stack direction="row" spacing={1.5} alignItems="flex-start">
          <Iconify
            icon="solar:lock-keyhole-bold-duotone"
            width={24}
            sx={{ color: 'primary.main' }}
          />
          <Box>
            <Typography variant="subtitle2">{t('auth.registration.kyc.security_title')}</Typography>
            <Typography variant="body2" sx={{ color: 'text.secondary', mt: 0.5 }}>
              {t('auth.registration.kyc.security_description')}
            </Typography>
          </Box>
        </Stack>
      </Paper>
      <FormControlLabel
        control={
          <Checkbox
            checked={form.kycConsent}
            onChange={(event) => updateField('kycConsent', event.target.checked)}
          />
        }
        label={t('auth.registration.kyc.consent')}
        sx={{ alignItems: 'flex-start', '.MuiCheckbox-root': { mt: -0.75 } }}
      />
      {errors.kycConsent && <Alert severity="error">{fieldError('kycConsent')}</Alert>}
    </Stack>
  );

  const reviewRows = [
    {
      label: t('auth.registration.review.account_type'),
      value:
        form.accountType === 'individual'
          ? t('auth.registration.account_type.individual.title')
          : t('auth.registration.account_type.business.title'),
    },
    {
      label: t('auth.registration.review.applicant'),
      value: form.accountType === 'individual' ? form.fullName : form.legalName,
    },
    { label: t('auth.registration.review.email'), value: form.email },
    {
      label: t('auth.registration.review.phone'),
      value: `${form.phoneCountryCode} ${form.phone}`,
    },
    {
      label: t('auth.registration.review.kyc'),
      value: t('auth.registration.review.kyc_pending'),
    },
  ];

  const renderReview = (
    <Stack spacing={2.5}>
      <Alert severity="warning">{t('auth.registration.review.pending_notice')}</Alert>
      <Paper variant="outlined" sx={{ overflow: 'hidden' }}>
        {reviewRows.map((row, index) => (
          <Box key={row.label}>
            <Stack
              direction={{ xs: 'column', sm: 'row' }}
              justifyContent="space-between"
              spacing={0.5}
              sx={{ px: 2.5, py: 1.75 }}
            >
              <Typography variant="body2" sx={{ color: 'text.secondary' }}>
                {row.label}
              </Typography>
              <Typography variant="subtitle2" sx={{ textAlign: { sm: 'right' } }}>
                {row.value}
              </Typography>
            </Stack>
            {index < reviewRows.length - 1 && <Divider />}
          </Box>
        ))}
      </Paper>
      <FormControlLabel
        control={
          <Checkbox
            checked={form.termsAccepted}
            onChange={(event) => updateField('termsAccepted', event.target.checked)}
          />
        }
        label={t('auth.registration.review.declaration')}
        sx={{ alignItems: 'flex-start', '.MuiCheckbox-root': { mt: -0.75 } }}
      />
      {errors.termsAccepted && <Alert severity="error">{fieldError('termsAccepted')}</Alert>}
    </Stack>
  );

  if (submittedReference) {
    return (
      <Stack spacing={3.5} alignItems="flex-start">
        <Box>
          <Typography variant="h5" sx={{ fontWeight: 800, letterSpacing: '-0.02em' }}>
            {APP_NAME_CN}
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ fontWeight: 600 }}>
            {APP_NAME_EN}
          </Typography>
        </Box>
        <Box
          sx={{
            width: 64,
            height: 64,
            borderRadius: '50%',
            display: 'grid',
            placeItems: 'center',
            bgcolor: 'success.lighter',
            color: 'success.dark',
          }}
        >
          <Iconify icon="solar:check-circle-bold" width={36} />
        </Box>
        <Stack spacing={1}>
          <Typography variant="overline" sx={{ color: 'success.dark', fontWeight: 700 }}>
            {t('auth.registration.success.eyebrow')}
          </Typography>
          <Typography variant="h3">{t('auth.registration.success.title')}</Typography>
          <Typography variant="body1" sx={{ color: 'text.secondary' }}>
            {t('auth.registration.success.subtitle')}
          </Typography>
        </Stack>
        <Paper variant="outlined" sx={{ width: 1, p: 2.5 }}>
          <Typography variant="caption" sx={{ color: 'text.secondary' }}>
            {t('auth.registration.success.reference')}
          </Typography>
          <Typography variant="h6" sx={{ mt: 0.5, fontVariantNumeric: 'tabular-nums' }}>
            {submittedReference}
          </Typography>
        </Paper>
        <Stack spacing={1.5} sx={{ width: 1 }}>
          {[
            t('auth.registration.success.next_email'),
            t('auth.registration.success.next_kyc'),
            t('auth.registration.success.next_review'),
          ].map((item, index) => (
            <Stack key={item} direction="row" spacing={1.5} alignItems="center">
              <Box
                sx={{
                  width: 28,
                  height: 28,
                  borderRadius: '50%',
                  display: 'grid',
                  placeItems: 'center',
                  bgcolor: 'action.hover',
                  flexShrink: 0,
                }}
              >
                <Typography variant="caption" sx={{ fontWeight: 700 }}>
                  {index + 1}
                </Typography>
              </Box>
              <Typography variant="body2">{item}</Typography>
            </Stack>
          ))}
        </Stack>
        <Button
          fullWidth
          component={RouterLink}
          href={loginPath}
          variant="contained"
          color="inherit"
          size="large"
        >
          {t('auth.registration.success.back_to_login')}
        </Button>
      </Stack>
    );
  }

  let primaryActionLabel = t('auth.registration.actions.continue');
  if (activeStep === steps.length - 1) {
    primaryActionLabel = submitting
      ? t('auth.registration.actions.submitting')
      : t('auth.registration.actions.submit');
  }

  return (
    <Box sx={{ width: 1 }}>
      <Stack spacing={1.25} sx={{ mb: 3.5 }}>
        <Box>
          <Typography variant="h5" sx={{ fontWeight: 800, letterSpacing: '-0.02em' }}>
            {APP_NAME_CN}
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ fontWeight: 600 }}>
            {APP_NAME_EN}
          </Typography>
        </Box>
        <Stack direction="row" justifyContent="space-between" alignItems="center">
          <Typography variant="overline" sx={{ color: 'primary.main', fontWeight: 700 }}>
            {t('auth.registration.eyebrow')}
          </Typography>
          <Typography variant="caption" sx={{ color: 'text.secondary' }}>
            {t('auth.registration.progress', { current: activeStep + 1, total: steps.length })}
          </Typography>
        </Stack>
        <LinearProgress
          variant="determinate"
          value={((activeStep + 1) / steps.length) * 100}
          sx={{ height: 6, borderRadius: 1 }}
        />
        <Typography variant="h3">{steps[activeStep]}</Typography>
        <Stack direction="row" spacing={0.5}>
          <Typography variant="body2" sx={{ color: 'text.secondary' }}>
            {t('auth.registration.already_have_account')}
          </Typography>
          <Typography
            component={RouterLink}
            href={loginPath}
            variant="subtitle2"
            sx={{ color: 'primary.main', textDecoration: 'none' }}
          >
            {t('auth.registration.sign_in')}
          </Typography>
        </Stack>
      </Stack>

      {activeStep === 0 && renderAccountType}
      {activeStep === 1 && renderDetails}
      {activeStep === 2 && renderKyc}
      {activeStep === 3 && renderReview}

      {submissionError && (
        <Alert severity="error" sx={{ mt: 2.5 }}>
          {submissionError}
        </Alert>
      )}

      <Stack direction="row" spacing={1.5} sx={{ mt: 4 }}>
        {activeStep > 0 && (
          <Button fullWidth variant="outlined" color="inherit" size="large" onClick={previousStep}>
            {t('auth.registration.actions.back')}
          </Button>
        )}
        <Button
          fullWidth
          variant="contained"
          color="inherit"
          size="large"
          disabled={submitting}
          onClick={
            activeStep === steps.length - 1
              ? () => submitApplication().catch(() => undefined)
              : nextStep
          }
          endIcon={
            activeStep === steps.length - 1 ? (
              <Iconify icon="solar:plain-2-bold-duotone" />
            ) : (
              <Iconify icon="solar:arrow-right-linear" />
            )
          }
        >
          {primaryActionLabel}
        </Button>
      </Stack>
    </Box>
  );
}
