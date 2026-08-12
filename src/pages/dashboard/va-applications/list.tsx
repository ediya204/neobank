import { Helmet } from 'react-helmet-async';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Alert,
  Box,
  Button,
  Card,
  Container,
  InputAdornment,
  MenuItem,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  Typography,
  CircularProgress,
} from '@mui/material';
import Label from 'src/components/label';
import Iconify from 'src/components/iconify';
import Scrollbar from 'src/components/scrollbar';
import CustomBreadcrumbs from 'src/components/custom-breadcrumbs';
import { useSettingsContext } from 'src/components/settings';
import { RouterLink } from 'src/routes/components';
import { paths } from 'src/routes/paths';
import { truncateIdentifier } from 'src/utils/identifier';
import {
  ApplicationStatus,
  getApplications,
  STATUS_META,
  VaApplication,
} from 'src/features/va-applications/data';

function localeForLanguage(language: string) {
  return language === 'cn' || language.startsWith('zh') ? 'zh-CN' : 'en-US';
}

function formatDate(value: string, locale: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '-';
  return new Intl.DateTimeFormat(locale, {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

export default function VaApplicationListPage() {
  const { t, i18n } = useTranslation('admin');
  const locale = localeForLanguage(i18n.resolvedLanguage || i18n.language);
  const settings = useSettingsContext();
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState<'all' | Exclude<ApplicationStatus, 'active'>>('all');
  const [applications, setApplications] = useState<VaApplication[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');

  const load = useCallback(() => {
    setLoading(true);
    setLoadError('');
    getApplications()
      .then(setApplications)
      .catch(() => {
        setLoadError(t('applications.list.errors.read'));
      })
      .finally(() => setLoading(false));
  }, [t]);

  useEffect(() => {
    load();
  }, [load]);

  const pendingApplications = useMemo(
    () => applications.filter((application) => application.status !== 'active'),
    [applications]
  );

  const filtered = useMemo(
    () =>
      pendingApplications.filter((application) => {
        const matchesQuery = `${application.customerName} ${application.email} ${application.id} ${
          application.partnerCustomerId || ''
        }`
          .toLowerCase()
          .includes(query.toLowerCase());
        return matchesQuery && (status === 'all' || application.status === status);
      }),
    [pendingApplications, query, status]
  );

  return (
    <>
      <Helmet>
        <title>{t('applications.list.pageTitle')} | moventra</title>
      </Helmet>
      <Container maxWidth={settings.themeStretch ? false : 'xl'}>
        <CustomBreadcrumbs
          heading={t('applications.list.title')}
          links={[
            { name: t('navigation.workspace'), href: paths.dashboard.root },
            { name: t('navigation.onboardingApplications') },
          ]}
          action={
            <Button
              component={RouterLink}
              href={paths.dashboard.vaApplications.new}
              variant="contained"
              startIcon={<Iconify icon="mingcute:add-line" />}
            >
              {t('applications.list.newApplication')}
            </Button>
          }
          sx={{ mb: { xs: 3, md: 5 } }}
        />

        {loadError && (
          <Alert
            severity="error"
            sx={{ mb: 3 }}
            action={
              <Button color="inherit" size="small" disabled={loading} onClick={load}>
                {t('common.retry')}
              </Button>
            }
          >
            {t('applications.list.errors.readDetail', { error: loadError })}
          </Alert>
        )}

        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} sx={{ mb: 3 }}>
          {[
            [
              t('applications.list.metrics.pending'),
              pendingApplications.length,
              'solar:documents-bold-duotone',
              'primary.main',
            ],
            [
              t('applications.list.metrics.awaitingKyc'),
              pendingApplications.filter((item) =>
                ['submitted', 'kyc_link_ready'].includes(item.status)
              ).length,
              'solar:user-check-bold-duotone',
              'warning.main',
            ],
            [
              t('applications.list.metrics.awaitingVa'),
              pendingApplications.filter((item) =>
                ['kyc_approved', 'va_processing'].includes(item.status)
              ).length,
              'solar:card-2-bold-duotone',
              'info.main',
            ],
          ].map(([title, value, icon, color]) => (
            <Card key={String(title)} sx={{ flex: 1, p: 3 }}>
              <Stack direction="row" alignItems="center" justifyContent="space-between">
                <Box>
                  <Typography variant="body2" color="text.secondary">
                    {title}
                  </Typography>
                  <Typography variant="h3" sx={{ mt: 1 }}>
                    {Number(value).toLocaleString(locale)}
                  </Typography>
                </Box>
                <Iconify icon={String(icon)} width={44} sx={{ color }} />
              </Stack>
            </Card>
          ))}
        </Stack>

        <Card>
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} sx={{ p: 2.5 }}>
            <TextField
              fullWidth
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={t('applications.list.searchPlaceholder')}
              InputProps={{
                startAdornment: (
                  <InputAdornment position="start">
                    <Iconify icon="eva:search-fill" sx={{ color: 'text.disabled' }} />
                  </InputAdornment>
                ),
              }}
            />
            <TextField
              select
              value={status}
              onChange={(event) => setStatus(event.target.value as typeof status)}
              sx={{ minWidth: 180 }}
              label={t('applications.list.statusFilter')}
            >
              <MenuItem value="all">{t('common.allStatuses')}</MenuItem>
              {Object.entries(STATUS_META)
                .filter(([value]) => value !== 'active')
                .map(([value]) => (
                  <MenuItem key={value} value={value}>
                    {t(`status.application.${value}`)}
                  </MenuItem>
                ))}
            </TextField>
          </Stack>

          <TableContainer>
            <Scrollbar>
              <Table sx={{ minWidth: 1120, tableLayout: 'fixed' }}>
                <TableHead>
                  <TableRow>
                    <TableCell sx={{ width: 190, whiteSpace: 'nowrap' }}>
                      {t('common.applicationId')}
                    </TableCell>
                    <TableCell sx={{ width: 190, whiteSpace: 'nowrap' }}>
                      {t('applications.new.partnerCustomerId')}
                    </TableCell>
                    <TableCell sx={{ width: 260 }}>{t('common.customerName')}</TableCell>
                    <TableCell sx={{ width: 150 }}>{t('common.contact')}</TableCell>
                    <TableCell sx={{ width: 130 }}>{t('common.status')}</TableCell>
                    <TableCell sx={{ width: 160 }}>{t('applications.list.submittedAt')}</TableCell>
                    <TableCell align="right" sx={{ width: 100 }}>
                      {t('common.actions')}
                    </TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {filtered.map((application) => {
                    const meta = STATUS_META[application.status];
                    return (
                      <TableRow key={application.id} hover>
                        <TableCell>
                          <Typography
                            component="span"
                            variant="subtitle2"
                            noWrap
                            title={application.id}
                            sx={{ display: 'block' }}
                          >
                            {truncateIdentifier(application.id)}
                          </Typography>
                        </TableCell>
                        <TableCell>
                          <Typography
                            component="span"
                            variant="body2"
                            noWrap
                            title={application.partnerCustomerId || ''}
                            sx={{ display: 'block', color: 'text.secondary' }}
                          >
                            {application.partnerCustomerId
                              ? truncateIdentifier(application.partnerCustomerId)
                              : '—'}
                          </Typography>
                        </TableCell>
                        <TableCell>
                          <Typography variant="subtitle2" noWrap title={application.customerName}>
                            {application.customerName}
                          </Typography>
                          <Typography
                            variant="caption"
                            color="text.secondary"
                            noWrap
                            title={application.email}
                            sx={{ display: 'block' }}
                          >
                            {application.email}
                          </Typography>
                        </TableCell>
                        <TableCell>
                          <Typography
                            variant="body2"
                            noWrap
                            title={`${application.phoneCountryCode} ${application.phoneNumber}`}
                          >
                            {application.phoneCountryCode} {application.phoneNumber}
                          </Typography>
                        </TableCell>
                        <TableCell>
                          <Label color={meta.color}>
                            {t(`status.application.${application.status}`)}
                          </Label>
                        </TableCell>
                        <TableCell>{formatDate(application.createdAt, locale)}</TableCell>
                        <TableCell align="right">
                          <Button
                            component={RouterLink}
                            href={paths.dashboard.vaApplications.details(application.id)}
                            color="inherit"
                            endIcon={<Iconify icon="eva:arrow-ios-forward-fill" />}
                          >
                            {t('common.view')}
                          </Button>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                  {loading && (
                    <TableRow>
                      <TableCell colSpan={7} align="center" sx={{ py: 8 }}>
                        <CircularProgress size={28} />
                      </TableCell>
                    </TableRow>
                  )}
                  {!loading && !filtered.length && (
                    <TableRow>
                      <TableCell colSpan={7} align="center" sx={{ py: 8 }}>
                        <Typography color="text.secondary">
                          {t('applications.list.empty')}
                        </Typography>
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </Scrollbar>
          </TableContainer>
        </Card>
      </Container>
    </>
  );
}
