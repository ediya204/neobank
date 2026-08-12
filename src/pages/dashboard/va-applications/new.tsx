import { Helmet } from 'react-helmet-async';
import { FormEvent, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, Card, Container, Stack, TextField, Typography } from '@mui/material';
import { useSnackbar } from 'src/components/snackbar';
import CustomBreadcrumbs from 'src/components/custom-breadcrumbs';
import CountryCallingCodeAutocomplete from 'src/components/country-calling-code-autocomplete';
import { useSettingsContext } from 'src/components/settings';
import { useRouter } from 'src/routes/hooks';
import { paths } from 'src/routes/paths';
import { createApplication } from 'src/features/va-applications/data';
import { SUPPORTED_CALLING_CODE_VALUES } from 'src/data/supported-country-calling-codes';

export default function VaApplicationNewPage() {
  const { t } = useTranslation('admin');
  const settings = useSettingsContext();
  const router = useRouter();
  const { enqueueSnackbar } = useSnackbar();
  const [values, setValues] = useState({
    partnerCustomerId: '',
    phoneCountryCode: '+65',
    phoneNumber: '',
    email: '',
    customerName: '',
  });
  const [errors, setErrors] = useState<Record<string, string>>({});

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    const nextErrors: Record<string, string> = {};
    if (
      !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(
        values.partnerCustomerId
      )
    ) {
      nextErrors.partnerCustomerId = t('applications.new.validation.partnerCustomerIdInvalid');
    }
    if (!SUPPORTED_CALLING_CODE_VALUES.includes(values.phoneCountryCode)) {
      nextErrors.phoneCountryCode = t('applications.new.validation.countryCodeRequired');
    }
    if (!values.phoneNumber.trim()) {
      nextErrors.phoneNumber = t('applications.new.validation.phoneRequired');
    }
    if (!values.customerName.trim()) {
      nextErrors.customerName = t('applications.new.validation.customerNameRequired');
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(values.email)) {
      nextErrors.email = t('applications.new.validation.emailInvalid');
    }
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length) return;

    try {
      const application = await createApplication(values);
      enqueueSnackbar(t('applications.new.messages.created'));
      router.push(paths.dashboard.vaApplications.details(application.id));
    } catch {
      enqueueSnackbar(t('applications.new.errors.createFailed'), {
        variant: 'error',
      });
    }
  };

  return (
    <>
      <Helmet>
        <title>{t('applications.new.pageTitle')} | SCC Digital Bank</title>
      </Helmet>
      <Container maxWidth={settings.themeStretch ? false : 'md'}>
        <CustomBreadcrumbs
          heading={t('applications.new.title')}
          links={[
            { name: t('navigation.workspace'), href: paths.dashboard.root },
            {
              name: t('navigation.onboardingApplications'),
              href: paths.dashboard.vaApplications.root,
            },
            { name: t('applications.new.breadcrumb') },
          ]}
          sx={{ mb: { xs: 3, md: 5 } }}
        />

        <Card sx={{ p: { xs: 3, md: 5 } }}>
          <Typography variant="h5">{t('applications.new.profileTitle')}</Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 1, mb: 4 }}>
            {t('applications.new.description')}
          </Typography>

          <Stack component="form" onSubmit={handleSubmit} spacing={3}>
            <TextField
              required
              fullWidth
              label={t('applications.new.partnerCustomerId')}
              placeholder="eb9c7fa8-eb8c-45f8-a838-e82033a5b1f4"
              value={values.partnerCustomerId}
              error={Boolean(errors.partnerCustomerId)}
              helperText={errors.partnerCustomerId || t('applications.new.partnerCustomerIdHelp')}
              inputProps={{ maxLength: 36, autoCapitalize: 'none', spellCheck: false }}
              onChange={(event) =>
                setValues((current) => ({
                  ...current,
                  partnerCustomerId: event.target.value
                    .toLowerCase()
                    .replace(/[^0-9a-f-]/g, '')
                    .slice(0, 36),
                }))
              }
            />
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
              <CountryCallingCodeAutocomplete
                required
                value={values.phoneCountryCode}
                initialIso2="SG"
                label={t('applications.new.supportedCountryCallingCode')}
                noOptionsText={t('applications.new.noCountryMatches')}
                error={Boolean(errors.phoneCountryCode)}
                helperText={errors.phoneCountryCode || t('applications.new.countryCodeHelp')}
                onChange={(callingCode) => {
                  setErrors((current) => ({
                    ...current,
                    phoneCountryCode: '',
                  }));
                  setValues((current) => ({
                    ...current,
                    phoneCountryCode: callingCode,
                  }));
                }}
                sx={{ width: { xs: 1, sm: 320 }, flexShrink: 0 }}
              />
              <TextField
                fullWidth
                label={t('common.phoneNumber')}
                placeholder="81234567"
                value={values.phoneNumber}
                error={Boolean(errors.phoneNumber)}
                helperText={errors.phoneNumber}
                onChange={(event) =>
                  setValues((current) => ({
                    ...current,
                    phoneNumber: event.target.value.replace(/[^\d\s-]/g, ''),
                  }))
                }
              />
            </Stack>

            <TextField
              fullWidth
              label={t('common.email')}
              placeholder="customer@example.com"
              value={values.email}
              error={Boolean(errors.email)}
              helperText={errors.email}
              onChange={(event) =>
                setValues((current) => ({ ...current, email: event.target.value }))
              }
            />
            <TextField
              fullWidth
              label={t('common.customerName')}
              placeholder={t('applications.new.customerNamePlaceholder')}
              value={values.customerName}
              error={Boolean(errors.customerName)}
              helperText={errors.customerName}
              onChange={(event) =>
                setValues((current) => ({ ...current, customerName: event.target.value }))
              }
            />

            <Stack direction="row" justifyContent="flex-end" spacing={1.5} sx={{ pt: 2 }}>
              <Button onClick={() => router.back()} color="inherit">
                {t('common.cancel')}
              </Button>
              <Button type="submit" variant="contained" size="large">
                {t('applications.new.submit')}
              </Button>
            </Stack>
          </Stack>
        </Card>
      </Container>
    </>
  );
}
