import { Helmet } from 'react-helmet-async';
import { useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  Alert,
  Box,
  Button,
  Card,
  Checkbox,
  Container,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  FormControlLabel,
  IconButton,
  MenuItem,
  Stack,
  Step,
  StepLabel,
  Stepper,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import Label from 'src/components/label';
import Iconify from 'src/components/iconify';
import CustomBreadcrumbs from 'src/components/custom-breadcrumbs';
import CountryCallingCodeAutocomplete from 'src/components/country-calling-code-autocomplete';
import { useSettingsContext } from 'src/components/settings';
import { useSnackbar } from 'src/components/snackbar';
import { paths } from 'src/routes/paths';
import {
  getApplication,
  requestApplicationChanges,
  STATUS_META,
  updateApplication,
  updateApplicationProfile,
  VaAccount,
  VaApplication,
  VaApplicationProfile,
} from 'src/features/va-applications/data';
import { SUPPORTED_CALLING_CODE_VALUES } from 'src/data/supported-country-calling-codes';

const STEP_KEYS = ['submitted', 'kycVerification', 'vaOpening', 'accountAvailable'] as const;
const STEP_BY_STATUS = {
  submitted: 0,
  kyc_link_ready: 1,
  kyc_approved: 2,
  va_processing: 2,
  active: 3,
};

const EMPTY_ACCOUNT: VaAccount = {
  accountName: '',
  accountNumber: '',
  iban: '',
  currency: 'USD',
  swiftBic: '',
  bankName: '',
  bankAddress: '',
};

const CHANGE_REASON_CODES = [
  'customer_information_incomplete',
  'customer_information_mismatch',
  'phone_unverifiable',
  'email_unverifiable',
  'kyc_documents_incomplete',
  'kyc_documents_expired',
  'kyc_retry_required',
  'duplicate_customer',
  'unsupported_customer_profile',
  'other',
] as const;

const CORRECTABLE_FIELDS = [
  'customer_name',
  'phone_country_code',
  'phone_number',
  'email',
  'kyc_documents',
] as const;

function CopyField({ label, value }: { label: string; value: string }) {
  const { t } = useTranslation('admin');
  const { enqueueSnackbar } = useSnackbar();
  const copy = async () => {
    await navigator.clipboard.writeText(value);
    enqueueSnackbar(t('applications.details.messages.fieldCopied', { field: label }));
  };
  return (
    <Box sx={{ py: 2 }}>
      <Typography variant="caption" color="text.secondary">
        {label}
      </Typography>
      <Stack direction="row" alignItems="flex-start" justifyContent="space-between" spacing={2}>
        <Typography variant="body1" sx={{ mt: 0.5, whiteSpace: 'pre-line' }}>
          {value}
        </Typography>
        <Tooltip title={t('common.copy')}>
          <IconButton color="primary" onClick={copy}>
            <Iconify icon="solar:copy-linear" />
          </IconButton>
        </Tooltip>
      </Stack>
    </Box>
  );
}

export default function VaApplicationDetailsPage() {
  const { t } = useTranslation('admin');
  const { id = '' } = useParams();
  const settings = useSettingsContext();
  const { enqueueSnackbar } = useSnackbar();
  const [application, setApplication] = useState<VaApplication>();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [editingProfile, setEditingProfile] = useState(false);
  const [requestChangesOpen, setRequestChangesOpen] = useState(false);
  const [reasonCode, setReasonCode] = useState('');
  const [reasonText, setReasonText] = useState('');
  const [requiredFields, setRequiredFields] = useState<string[]>([]);
  const [internalNote, setInternalNote] = useState('');
  const [kycUrl, setKycUrl] = useState('');
  const [account, setAccount] = useState<VaAccount>(EMPTY_ACCOUNT);
  const [profile, setProfile] = useState<VaApplicationProfile>({
    partnerCustomerId: null,
    customerName: '',
    phoneCountryCode: '+65',
    phoneNumber: '',
    email: '',
  });

  useEffect(() => {
    getApplication(id)
      .then((value) => {
        setApplication(value);
        setKycUrl(value.kycUrl || '');
        setProfile({
          partnerCustomerId: value.partnerCustomerId,
          customerName: value.customerName,
          phoneCountryCode: value.phoneCountryCode,
          phoneNumber: value.phoneNumber,
          email: value.email,
        });
        setAccount(
          value.vaAccount || {
            ...EMPTY_ACCOUNT,
            accountName: value.customerName,
          }
        );
      })
      .catch(() => setApplication(undefined))
      .finally(() => setLoading(false));
  }, [id]);

  const meta = application ? STATUS_META[application.status] : null;
  const activeStep = application ? STEP_BY_STATUS[application.onboardingStage] : 0;
  const accountFields = useMemo(
    () =>
      application?.vaAccount
        ? [
            [t('common.accountName'), application.vaAccount.accountName],
            [t('common.accountNumber'), application.vaAccount.accountNumber],
            [t('common.iban'), application.vaAccount.iban || '-'],
            [t('common.currency'), application.vaAccount.currency],
            ['SWIFT / BIC', application.vaAccount.swiftBic],
            [t('common.bankName'), application.vaAccount.bankName],
            [t('common.bankAddress'), application.vaAccount.bankAddress],
          ]
        : [],
    [application, t]
  );
  const kycUrlIsValid = /^https:\/\/\S+$/i.test(kycUrl.trim());
  const kycUrlChanged = kycUrl.trim() !== (application?.kycUrl || '');
  const accountChanged =
    !!application &&
    (Object.keys(account) as Array<keyof VaAccount>).some(
      (key) => account[key].trim() !== (application.vaAccount?.[key] || '').trim()
    );

  const persist = async (patch: Partial<VaApplication>, message: string) => {
    setSaving(true);
    try {
      const updated = await updateApplication(id, patch);
      setApplication(updated);
      setKycUrl(updated.kycUrl || '');
      setAccount(
        updated.vaAccount || {
          ...EMPTY_ACCOUNT,
          accountName: updated.customerName,
        }
      );
      enqueueSnackbar(message);
      return updated;
    } catch {
      enqueueSnackbar(t('applications.details.errors.updateFailed'), {
        variant: 'error',
      });
      return undefined;
    } finally {
      setSaving(false);
    }
  };

  const saveProfile = async () => {
    setSaving(true);
    try {
      const updated = await updateApplicationProfile(id, profile);
      setApplication(updated);
      setProfile({
        partnerCustomerId: updated.partnerCustomerId,
        customerName: updated.customerName,
        phoneCountryCode: updated.phoneCountryCode,
        phoneNumber: updated.phoneNumber,
        email: updated.email,
      });
      setEditingProfile(false);
      enqueueSnackbar(t('applications.details.messages.profileUpdated'));
    } catch {
      enqueueSnackbar(t('applications.details.errors.profileUpdateFailed'), {
        variant: 'error',
      });
    } finally {
      setSaving(false);
    }
  };

  const submitChangesRequest = async () => {
    if (!application) return;
    setSaving(true);
    try {
      const updated = await requestApplicationChanges(application.id, {
        reasonCode,
        reasonText: reasonText.trim(),
        requiredFields,
        internalNote,
        expectedVersion: application.applicationVersion,
      });
      setApplication(updated);
      setRequestChangesOpen(false);
      setReasonCode('');
      setReasonText('');
      setRequiredFields([]);
      setInternalNote('');
      enqueueSnackbar(t('applications.details.messages.changesRequested'));
    } catch {
      enqueueSnackbar(t('applications.details.errors.requestChangesFailed'), {
        variant: 'error',
      });
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return <Container>{t('applications.details.loading')}</Container>;
  }

  if (!application || !meta) {
    return (
      <Container>
        <Alert severity="error">{t('applications.details.notFound')}</Alert>
      </Container>
    );
  }

  return (
    <>
      <Helmet>
        <title>
          {t('applications.details.documentTitle', { name: application.customerName })} | SCC Digital Bank
        </title>
      </Helmet>
      <Container maxWidth={settings.themeStretch ? false : 'xl'}>
        <CustomBreadcrumbs
          heading={application.customerName}
          links={[
            { name: t('navigation.workspace'), href: paths.dashboard.root },
            {
              name: t('navigation.onboardingApplications'),
              href: paths.dashboard.vaApplications.root,
            },
            { name: application.id },
          ]}
          action={<Label color={meta.color}>{t(`status.application.${application.status}`)}</Label>}
          sx={{ mb: { xs: 3, md: 5 } }}
        />

        <Card sx={{ p: { xs: 2.5, md: 4 }, mb: 3 }}>
          <Stepper activeStep={activeStep} alternativeLabel>
            {STEP_KEYS.map((key) => (
              <Step key={key}>
                <StepLabel>{t(`applications.details.steps.${key}`)}</StepLabel>
              </Step>
            ))}
          </Stepper>
        </Card>

        {application.actionRequired && (
          <Alert severity="error" sx={{ mb: 3 }}>
            <Typography variant="subtitle2">
              {t('applications.details.review.waitingForResubmission')}
            </Typography>
            <Typography variant="body2" sx={{ mt: 0.5 }}>
              {application.actionRequired.reasonMessage}
            </Typography>
            <Typography variant="caption" sx={{ display: 'block', mt: 1 }}>
              {t('applications.details.review.requiredFields')}:{' '}
              {application.actionRequired.requiredFields
                .map((field) => t(`applications.details.review.fields.${field}`))
                .join('、')}
            </Typography>
          </Alert>
        )}

        <Stack direction={{ xs: 'column', lg: 'row' }} spacing={3} alignItems="flex-start">
          <Stack spacing={3} sx={{ flex: 1, width: 1 }}>
            <Card sx={{ p: 3 }}>
              <Stack direction="row" justifyContent="space-between" alignItems="center">
                <Box>
                  <Typography variant="h6">{t('applications.details.profile.title')}</Typography>
                  <Typography variant="body2" color="text.secondary">
                    {t('applications.details.profile.description')}
                  </Typography>
                </Box>
                <Button
                  color="inherit"
                  disabled={application.status === 'changes_requested'}
                  startIcon={
                    <Iconify icon={editingProfile ? 'solar:close-circle-linear' : 'solar:pen-bold'} />
                  }
                  onClick={() => {
                    if (editingProfile) {
                      setProfile({
                        partnerCustomerId: application.partnerCustomerId,
                        customerName: application.customerName,
                        phoneCountryCode: application.phoneCountryCode,
                        phoneNumber: application.phoneNumber,
                        email: application.email,
                      });
                    }
                    setEditingProfile((current) => !current);
                  }}
                >
                  {editingProfile ? t('common.cancel') : t('applications.details.profile.edit')}
                </Button>
              </Stack>
              <Divider sx={{ my: 2 }} />
              {editingProfile ? (
                <Stack spacing={2.5}>
                  <TextField
                    label={t('applications.new.partnerCustomerId')}
                    placeholder="eb9c7fa8-eb8c-45f8-a838-e82033a5b1f4"
                    value={profile.partnerCustomerId || ''}
                    error={
                      Boolean(profile.partnerCustomerId) &&
                      !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(
                        profile.partnerCustomerId || ''
                      )
                    }
                    helperText={t('applications.details.profile.partnerCustomerIdHelp')}
                    inputProps={{ maxLength: 36, autoCapitalize: 'none', spellCheck: false }}
                    onChange={(event) =>
                      setProfile((current) => ({
                        ...current,
                        partnerCustomerId:
                          event.target.value
                            .toLowerCase()
                            .replace(/[^0-9a-f-]/g, '')
                            .slice(0, 36) || null,
                      }))
                    }
                  />
                  <TextField
                    required
                    label={t('common.customerName')}
                    value={profile.customerName}
                    onChange={(event) =>
                      setProfile((current) => ({
                        ...current,
                        customerName: event.target.value,
                      }))
                    }
                    inputProps={{ maxLength: 160 }}
                  />
                  <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
                    <CountryCallingCodeAutocomplete
                      required
                      value={profile.phoneCountryCode}
                      label={t('applications.new.supportedCountryCallingCode')}
                      noOptionsText={t('applications.new.noCountryMatches')}
                      error={
                        !!profile.phoneCountryCode &&
                        !SUPPORTED_CALLING_CODE_VALUES.includes(profile.phoneCountryCode)
                      }
                      helperText={t('applications.details.profile.countryCodeHelp')}
                      onChange={(callingCode) =>
                        setProfile((current) => ({
                          ...current,
                          phoneCountryCode: callingCode,
                        }))
                      }
                      sx={{ width: { xs: 1, sm: 320 }, flexShrink: 0 }}
                    />
                    <TextField
                      required
                      fullWidth
                      label={t('common.phoneNumber')}
                      value={profile.phoneNumber}
                      error={!!profile.phoneNumber && !/^[\d\s-]{4,24}$/.test(profile.phoneNumber)}
                      helperText={t('applications.details.profile.phoneHelp')}
                      onChange={(event) =>
                        setProfile((current) => ({
                          ...current,
                          phoneNumber: event.target.value,
                        }))
                      }
                    />
                  </Stack>
                  <TextField
                    required
                    type="email"
                    label={t('common.email')}
                    value={profile.email}
                    error={!!profile.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(profile.email)}
                    onChange={(event) =>
                      setProfile((current) => ({
                        ...current,
                        email: event.target.value,
                      }))
                    }
                  />
                  <Button
                    variant="contained"
                    disabled={
                      saving ||
                      (Boolean(profile.partnerCustomerId) &&
                        !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(
                          profile.partnerCustomerId || ''
                        )) ||
                      !profile.customerName.trim() ||
                      !SUPPORTED_CALLING_CODE_VALUES.includes(profile.phoneCountryCode) ||
                      !/^[\d\s-]{4,24}$/.test(profile.phoneNumber) ||
                      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(profile.email)
                    }
                    onClick={saveProfile}
                    sx={{ alignSelf: 'flex-start' }}
                  >
                    {t('applications.details.profile.save')}
                  </Button>
                </Stack>
              ) : (
                <Stack direction={{ xs: 'column', sm: 'row' }} spacing={4}>
                  <Box sx={{ flex: 1 }}>
                    <Typography variant="caption" color="text.secondary">
                      {t('applications.new.partnerCustomerId')}
                    </Typography>
                    <Typography variant="subtitle1">
                      {application.partnerCustomerId || '—'}
                    </Typography>
                  </Box>
                  <Box sx={{ flex: 1 }}>
                    <Typography variant="caption" color="text.secondary">
                      {t('common.customerName')}
                    </Typography>
                    <Typography variant="subtitle1">{application.customerName}</Typography>
                  </Box>
                  <Box sx={{ flex: 1 }}>
                    <Typography variant="caption" color="text.secondary">
                      {t('common.phoneNumber')}
                    </Typography>
                    <Typography variant="subtitle1">
                      {application.phoneCountryCode} {application.phoneNumber}
                    </Typography>
                  </Box>
                  <Box sx={{ flex: 1 }}>
                    <Typography variant="caption" color="text.secondary">
                      {t('common.email')}
                    </Typography>
                    <Typography variant="subtitle1">{application.email}</Typography>
                  </Box>
                </Stack>
              )}
            </Card>

            {application.vaAccount && (
              <Card sx={{ p: 3 }}>
                <Stack direction="row" justifyContent="space-between" alignItems="center">
                  <Box>
                    <Typography variant="h6">
                      {t('applications.details.vaAccount.title')}
                    </Typography>
                    <Typography variant="body2" color="text.secondary">
                      {t('applications.details.vaAccount.description')}
                    </Typography>
                  </Box>
                  <Button
                    startIcon={<Iconify icon="solar:copy-linear" />}
                    onClick={async () => {
                      await navigator.clipboard.writeText(
                        accountFields.map(([label, value]) => `${label}: ${value}`).join('\n')
                      );
                      enqueueSnackbar(t('applications.details.messages.accountCopied'));
                    }}
                  >
                    {t('common.copyAll')}
                  </Button>
                </Stack>
                <Divider sx={{ mt: 2 }} />
                {accountFields.map(([label, value], index) => (
                  <Box key={label}>
                    <CopyField label={label} value={value} />
                    {index < accountFields.length - 1 && <Divider />}
                  </Box>
                ))}
              </Card>
            )}
          </Stack>

          <Card sx={{ width: { xs: 1, lg: 420 }, p: 3 }}>
            <Typography variant="h6">{t('applications.details.processing.title')}</Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5, mb: 3 }}>
              {t('applications.details.processing.description')}
            </Typography>

            <Stack spacing={2}>
              <Box>
                <Typography variant="subtitle2">{t('applications.details.kyc.title')}</Typography>
                <Typography variant="caption" color="text.secondary">
                  {t('applications.details.kyc.description')}
                </Typography>
              </Box>
              <TextField
                label={t('common.kycLink')}
                placeholder="https://in.sumsub.com/..."
                value={kycUrl}
                onChange={(event) => setKycUrl(event.target.value)}
                disabled={application.status === 'changes_requested'}
                error={!!kycUrl && !kycUrlIsValid}
                helperText={
                  !!kycUrl && !kycUrlIsValid ? t('applications.details.kyc.invalidUrl') : ' '
                }
                multiline
                minRows={2}
              />
              <Button
                variant={application.status === 'submitted' ? 'contained' : 'outlined'}
                disabled={
                  saving ||
                  application.status === 'changes_requested' ||
                  !kycUrlIsValid ||
                  !kycUrlChanged
                }
                onClick={() =>
                  persist(
                    { kycUrl: kycUrl.trim() },
                    application.status === 'submitted'
                      ? t('applications.details.messages.kycLinkShared')
                      : t('applications.details.messages.kycLinkUpdated')
                  )
                }
              >
                {application.status === 'submitted'
                  ? t('applications.details.kyc.saveAndShare')
                  : t('applications.details.kyc.saveCorrection')}
              </Button>
            </Stack>

            {application.status === 'kyc_link_ready' && (
              <Stack spacing={2} sx={{ mt: 3 }}>
                <Divider />
                <Alert severity="info">{t('applications.details.kyc.availableNotice')}</Alert>
                <Button
                  variant="contained"
                  color="success"
                  disabled={saving}
                  onClick={() =>
                    persist(
                      { status: 'kyc_approved' },
                      t('applications.details.messages.kycApproved')
                    )
                  }
                >
                  {t('applications.details.kyc.confirmApproved')}
                </Button>
              </Stack>
            )}

            {['kyc_approved', 'va_processing', 'active'].includes(application.status) && (
              <Stack spacing={2} sx={{ mt: 3 }}>
                <Divider />
                {application.status === 'active' ? (
                  <Alert severity="success" icon={<Iconify icon="solar:verified-check-bold" />}>
                    {t('applications.details.vaAccount.activeNotice')}
                  </Alert>
                ) : (
                  <Box>
                    <Typography variant="subtitle2">
                      {t('applications.details.vaAccount.enterTitle')}
                    </Typography>
                    <Typography variant="caption" color="text.secondary">
                      {t('applications.details.vaAccount.enterDescription')}
                    </Typography>
                  </Box>
                )}
                {(Object.keys(account) as Array<keyof VaAccount>).map((key) => {
                  const labels: Record<keyof VaAccount, string> = {
                    accountName: t('common.accountName'),
                    accountNumber: t('common.accountNumber'),
                    iban: t('common.ibanOptional'),
                    currency: t('common.currency'),
                    swiftBic: 'SWIFT / BIC',
                    bankName: t('common.bankName'),
                    bankAddress: t('common.bankAddress'),
                  };
                  return (
                    <TextField
                      key={key}
                      label={labels[key]}
                      value={account[key]}
                      multiline={key === 'bankAddress'}
                      minRows={key === 'bankAddress' ? 2 : undefined}
                      disabled={key === 'currency'}
                      onChange={(event) =>
                        setAccount((current) => ({ ...current, [key]: event.target.value }))
                      }
                    />
                  );
                })}
                <Button
                  variant="contained"
                  disabled={
                    saving ||
                    (Object.keys(account) as Array<keyof VaAccount>).some(
                      (key) => key !== 'iban' && !account[key].trim()
                    ) ||
                    (application.status === 'active' && !accountChanged)
                  }
                  onClick={() =>
                    persist(
                      { vaAccount: account },
                      application.status === 'active'
                        ? t('applications.details.messages.accountUpdated')
                        : t('applications.details.messages.accountOpened')
                    )
                  }
                >
                  {application.status === 'active'
                    ? t('applications.details.vaAccount.saveCorrection')
                    : t('applications.details.vaAccount.confirmAndShare')}
                </Button>
              </Stack>
            )}

            {application.status !== 'active' && application.status !== 'changes_requested' && (
              <Stack spacing={2} sx={{ mt: 3 }}>
                <Divider />
                <Button
                  color="error"
                  variant="outlined"
                  startIcon={<Iconify icon="solar:danger-triangle-bold" />}
                  disabled={saving}
                  onClick={() => setRequestChangesOpen(true)}
                >
                  {t('applications.details.review.requestChanges')}
                </Button>
              </Stack>
            )}
          </Card>
        </Stack>
      </Container>

      <Dialog
        open={requestChangesOpen}
        onClose={() => !saving && setRequestChangesOpen(false)}
        fullWidth
        maxWidth="sm"
      >
        <DialogTitle>{t('applications.details.review.dialogTitle')}</DialogTitle>
        <DialogContent>
          <Stack spacing={2.5} sx={{ pt: 1 }}>
            <Alert severity="warning">{t('applications.details.review.dialogDescription')}</Alert>
            <TextField
              select
              required
              label={t('applications.details.review.reasonCode')}
              value={reasonCode}
              onChange={(event) => setReasonCode(event.target.value)}
            >
              {CHANGE_REASON_CODES.map((code) => (
                <MenuItem key={code} value={code}>
                  {t(`applications.details.review.reasons.${code}`)}
                </MenuItem>
              ))}
            </TextField>
            <TextField
              required
              multiline
              minRows={3}
              label={t('applications.details.review.publicReason')}
              value={reasonText}
              inputProps={{ maxLength: 500 }}
              helperText={`${reasonText.trim().length}/500`}
              onChange={(event) => setReasonText(event.target.value)}
            />
            <Box>
              <Typography variant="subtitle2" sx={{ mb: 1 }}>
                {t('applications.details.review.requiredFields')}
              </Typography>
              <Stack>
                {CORRECTABLE_FIELDS.map((field) => (
                  <FormControlLabel
                    key={field}
                    control={
                      <Checkbox
                        checked={requiredFields.includes(field)}
                        onChange={(event) =>
                          setRequiredFields((current) =>
                            event.target.checked
                              ? [...current, field]
                              : current.filter((value) => value !== field)
                          )
                        }
                      />
                    }
                    label={t(`applications.details.review.fields.${field}`)}
                  />
                ))}
              </Stack>
            </Box>
            <TextField
              multiline
              minRows={2}
              label={t('applications.details.review.internalNote')}
              value={internalNote}
              inputProps={{ maxLength: 1000 }}
              helperText={t('applications.details.review.internalNoteHelp')}
              onChange={(event) => setInternalNote(event.target.value)}
            />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button color="inherit" disabled={saving} onClick={() => setRequestChangesOpen(false)}>
            {t('common.cancel')}
          </Button>
          <Button
            color="error"
            variant="contained"
            disabled={
              saving || !reasonCode || reasonText.trim().length < 10 || !requiredFields.length
            }
            onClick={submitChangesRequest}
          >
            {t('applications.details.review.confirm')}
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
}
