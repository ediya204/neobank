import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import { Helmet } from 'react-helmet-async';
import { useNavigate, useSearchParams } from 'react-router-dom';
import type { TFunction } from 'i18next';
import { useTranslation } from 'react-i18next';
import {
  Alert,
  Box,
  Button,
  Card,
  CircularProgress,
  Container,
  Divider,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Typography,
} from '@mui/material';
import Iconify from 'src/components/iconify';
import Label from 'src/components/label';
import PrototypeVariantSwitcher from 'src/components/prototype-variant-switcher';
import { useSettingsContext } from 'src/components/settings';
import { getLocalizedApiError } from 'src/locales/api-error';
import { browserApiFetch } from 'src/utils/browser-api';
import { CRYPTO_NETWORK_OPTIONS, USD_ASSET_ICON } from 'src/utils/asset-icons';

export type BalanceSummary = {
  asset: string;
  network: string | null;
  ledger_balance: string;
  reserved: string;
  available_balance: string;
  asset_decimals: number;
};

export type RecentTransaction = {
  id: string;
  application_id: string;
  customer_name: string;
  category: 'fund' | 'otc';
  type: string;
  direction: 'credit' | 'debit' | 'exchange';
  asset: string;
  network: string | null;
  amount: string;
  counter_asset?: string | null;
  counter_network?: string | null;
  counter_amount?: string | null;
  fee_amount?: string | null;
  net_amount?: string | null;
  status: string;
  created_at: string;
};

export type OverviewData = {
  customers: {
    total: number;
    active: number;
    onboarding: number;
  };
  pending: {
    deposits: number;
    withdrawals: number;
    otc: number;
    total: number;
  };
  balances: BalanceSummary[];
  recent_transactions: RecentTransaction[];
};

type ApiEnvelope<T> = {
  data: T;
};

const EMPTY_OVERVIEW: OverviewData = {
  customers: { total: 0, active: 0, onboarding: 0 },
  pending: { deposits: 0, withdrawals: 0, otc: 0, total: 0 },
  balances: [],
  recent_transactions: [],
};

const AdminOverviewVisualizationPrototype = lazy(
  () => import('src/pages/dashboard/overview-visualization-prototype')
);

const CHAINS = CRYPTO_NETWORK_OPTIONS;

async function getOverview(errorMessage: string, signal?: AbortSignal): Promise<OverviewData> {
  const response = await browserApiFetch('/api/browser/v1/admin/overview', {
    headers: { 'content-type': 'application/json' },
    signal,
  });
  const body = (await response.json()) as ApiEnvelope<OverviewData> & {
    error?: { code?: string; message?: string };
  };
  if (!response.ok) throw new Error(getLocalizedApiError(body, errorMessage));
  return body.data || EMPTY_OVERVIEW;
}

function localeForLanguage(language: string) {
  return language === 'cn' || language.startsWith('zh') ? 'zh-CN' : 'en-US';
}

function formatAmount(
  value: string | number | null | undefined,
  locale: string,
  maximumFractionDigits = 6
) {
  const amount = Number(value || 0);
  if (!Number.isFinite(amount)) return '0';
  return amount.toLocaleString(locale, { maximumFractionDigits });
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

function statusColor(status: string): 'success' | 'warning' | 'error' | 'default' {
  if (status === 'completed') return 'success';
  if (status === 'submitted' || status === 'processing') return 'warning';
  if (status === 'rejected' || status === 'cancelled') return 'error';
  return 'default';
}

function transactionTypeLabel(type: string, t: TFunction<'operations'>) {
  const labels: Record<string, string> = {
    fiat_deposit: t('types.fiatDeposit'),
    usdt_deposit: t('types.usdtDeposit'),
    fiat_withdrawal: t('types.fiatWithdrawal'),
    usdt_withdrawal: t('types.usdtWithdrawal'),
    otc: 'OTC',
    fiat_conversion_debit: t('types.fiatConversionDebit'),
    crypto_conversion_credit: t('types.cryptoConversionCredit'),
    usdt_sweep: t('types.usdtSweep'),
  };
  return labels[type] || type || '-';
}

function transactionStatusLabel(status: string, t: TFunction<'operations'>) {
  const labels: Record<string, string> = {
    submitted: t('status.submitted'),
    processing: t('status.processing'),
    completed: t('status.completed'),
    rejected: t('status.rejected'),
    cancelled: t('status.cancelled'),
    posted: t('status.posted'),
  };
  return labels[status] || status || '-';
}

function networkDisplayName(network: string) {
  const chain = CHAINS.find((item) => item.value === network);
  return chain ? `${chain.name} (${chain.standard})` : network;
}

function transactionChannel(row: RecentTransaction) {
  if (row.category === 'otc' || row.type === 'otc') {
    return `${row.asset || '-'} → ${row.counter_asset || '-'}`;
  }
  if (row.network) return networkDisplayName(row.network);
  if (row.type.startsWith('fiat_')) return 'Bank';
  return '-';
}

export default function AdminOverviewPage() {
  const { t, i18n } = useTranslation('admin');
  const locale = localeForLanguage(i18n.resolvedLanguage || i18n.language);
  const settings = useSettingsContext();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const prototypeEnabled = searchParams.get('prototype') === 'charts';
  const prototypeVariant = ['A', 'B', 'C'].includes(searchParams.get('variant') || '')
    ? searchParams.get('variant') || 'A'
    : 'A';
  const [overview, setOverview] = useState<OverviewData>(EMPTY_OVERVIEW);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');

  const load = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    setLoadError('');
    try {
      setOverview(await getOverview(t('overview.errors.read'), signal));
    } catch (caught) {
      if (caught instanceof DOMException && caught.name === 'AbortError') return;
      setLoadError(caught instanceof Error ? caught.message : t('overview.errors.read'));
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    const controller = new AbortController();
    load(controller.signal);
    return () => controller.abort();
  }, [load]);

  const usdBalance = useMemo(
    () => overview.balances.find((item) => item.asset === 'USD' && !item.network),
    [overview.balances]
  );
  const usdtBalances = useMemo(
    () =>
      CHAINS.map((chain) => ({
        ...chain,
        balance: overview.balances.find(
          (item) => item.asset === 'USDT' && item.network === chain.value
        ),
      })),
    [overview.balances]
  );

  return (
    <>
      <Helmet>
        <title>{t('overview.pageTitle')} | SSC Digital Bank</title>
      </Helmet>

      <Container maxWidth={settings.themeStretch ? false : 'xl'}>
        <Stack
          direction={{ xs: 'column', sm: 'row' }}
          alignItems={{ sm: 'center' }}
          justifyContent="space-between"
          spacing={2}
          sx={{ mb: 4 }}
        >
          <Box>
            <Typography variant="h4">{t('overview.title')}</Typography>
            <Typography color="text.secondary" sx={{ mt: 0.5 }}>
              {t('overview.description')}
            </Typography>
          </Box>
          <Button
            color="inherit"
            startIcon={<Iconify icon="solar:refresh-linear" />}
            disabled={loading}
            onClick={() => load()}
          >
            {loading ? t('common.loading') : t('common.refreshData')}
          </Button>
        </Stack>

        {loadError && (
          <Alert
            severity="error"
            sx={{ mb: 3 }}
            action={
              <Button color="inherit" size="small" onClick={() => load()}>
                {t('common.retry')}
              </Button>
            }
          >
            {t('overview.errors.readDetail', { error: loadError })}
          </Alert>
        )}

        {loading && !loadError && (
          <Alert severity="info" icon={<CircularProgress size={20} />} sx={{ mb: 3 }}>
            {t('overview.loading')}
          </Alert>
        )}

        {prototypeEnabled ? (
          <Suspense
            fallback={
              <Box sx={{ py: 10, display: 'grid', placeItems: 'center' }}>
                <CircularProgress />
              </Box>
            }
          >
            <AdminOverviewVisualizationPrototype
              value={overview}
              variant={prototypeVariant}
              onNavigate={navigate}
            />
          </Suspense>
        ) : (
          <>
        <Box
          sx={{
            display: 'grid',
            gridTemplateColumns: {
              xs: '1fr',
              sm: 'repeat(2, minmax(0, 1fr))',
              lg: 'repeat(4, minmax(0, 1fr))',
            },
            gap: 2.5,
            mb: 3,
          }}
        >
          <MetricCard
            title={t('overview.metrics.allCustomers')}
            value={overview.customers.total}
            helper={t('overview.metrics.activeHelper', {
              active: formatAmount(overview.customers.active, locale, 0),
            })}
            icon="solar:users-group-rounded-bold-duotone"
            color="primary"
            onClick={() => navigate('/dashboard/customers')}
          />
          <MetricCard
            title={t('overview.metrics.onboarding')}
            value={overview.customers.onboarding}
            helper={t('overview.metrics.onboardingHelper')}
            icon="solar:user-check-bold-duotone"
            color="info"
            onClick={() => navigate('/dashboard/va-applications')}
          />
          <MetricCard
            title={t('overview.metrics.pendingDeposits')}
            value={overview.pending.deposits}
            helper={t('overview.metrics.pendingDepositsHelper')}
            icon="solar:download-minimalistic-bold-duotone"
            color="success"
            onClick={() => navigate('/dashboard/operations/deposits')}
          />
        </Box>

        <Box
          sx={{
            display: 'grid',
            gridTemplateColumns: { xs: '1fr', lg: 'minmax(0, 0.82fr) minmax(0, 1.18fr)' },
            gap: 3,
            mb: 3,
          }}
        >
          <Card sx={{ p: 3 }}>
            <Stack direction="row" alignItems="center" justifyContent="space-between">
              <Box>
                <Typography variant="overline" color="text.secondary">
                  {t('overview.fiat.title')}
                </Typography>
                <Typography variant="h3" sx={{ mt: 0.75 }}>
                  {formatAmount(usdBalance?.available_balance, locale, 2)}
                  <Typography component="span" variant="body2" color="text.secondary" sx={{ ml: 1 }}>
                    {t('overview.fiat.availableUsd')}
                  </Typography>
                </Typography>
              </Box>
              <Box
                sx={{
                  width: 52,
                  height: 52,
                  display: 'grid',
                  placeItems: 'center',
                  borderRadius: 2,
                  bgcolor: 'info.lighter',
                  color: 'info.dark',
                }}
              >
                <Iconify icon={USD_ASSET_ICON} width={29} />
              </Box>
            </Stack>
            <Divider sx={{ my: 2.5 }} />
            <BalanceBreakdown balance={usdBalance} decimals={2} />
            <Button
              sx={{ mt: 2.5 }}
              onClick={() => navigate('/dashboard/operations/balances?wallet=fiat')}
            >
              {t('overview.fiat.viewBalances')}
            </Button>
          </Card>

          <Card sx={{ p: 3 }}>
            <Stack
              direction={{ xs: 'column', sm: 'row' }}
              justifyContent="space-between"
              spacing={1}
              sx={{ mb: 2.5 }}
            >
              <Box>
                <Typography variant="h6">{t('overview.crypto.title')}</Typography>
                <Typography variant="body2" color="text.secondary">
                  {t('overview.crypto.description')}
                </Typography>
              </Box>
              <Button onClick={() => navigate('/dashboard/operations/balances?wallet=crypto')}>
                {t('overview.crypto.viewWallet')}
              </Button>
            </Stack>
            <Box
              sx={{
                display: 'grid',
                gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, minmax(0, 1fr))' },
                gap: 1.5,
              }}
            >
              {usdtBalances.map((item) => (
                <Box
                  key={item.value}
                  sx={{
                    p: 2,
                    borderRadius: 2,
                    border: '1px solid',
                    borderColor: 'divider',
                    bgcolor: 'background.neutral',
                  }}
                >
                  <Stack direction="row" alignItems="center" spacing={1}>
                    <Iconify icon={item.icon} width={24} />
                    <Box sx={{ minWidth: 0 }}>
                      <Typography variant="subtitle2">{item.name}</Typography>
                      <Typography variant="caption" color="text.secondary">
                        {item.standard}
                      </Typography>
                    </Box>
                  </Stack>
                  <Typography variant="h5" sx={{ mt: 1.5 }}>
                    {formatAmount(item.balance?.available_balance, locale)}
                    <Typography component="span" variant="caption" color="text.secondary" sx={{ ml: 0.75 }}>
                      {t('overview.crypto.availableUsdt')}
                    </Typography>
                  </Typography>
                  <Typography variant="caption" color="text.secondary">
                    {t('overview.crypto.balanceBreakdown', {
                      ledger: formatAmount(item.balance?.ledger_balance, locale),
                      reserved: formatAmount(item.balance?.reserved, locale),
                    })}
                  </Typography>
                </Box>
              ))}
            </Box>
          </Card>
        </Box>

        <Box
          sx={{
            display: 'grid',
            gridTemplateColumns: { xs: '1fr', xl: 'minmax(0, 1fr) 360px' },
            gap: 3,
          }}
        >
          <Card>
            <Stack
              direction="row"
              alignItems="center"
              justifyContent="space-between"
              spacing={2}
              sx={{ p: 3 }}
            >
              <Box>
                <Typography variant="h6">{t('overview.recent.title')}</Typography>
                <Typography variant="body2" color="text.secondary">
                  {t('overview.recent.description')}
                </Typography>
              </Box>
              <Button onClick={() => navigate('/dashboard/operations/transactions')}>
                {t('common.viewAll')}
              </Button>
            </Stack>
            <RecentTransactions
              rows={overview.recent_transactions}
              onView={(row) =>
                navigate(
                  `/dashboard/operations/transactions?application_id=${encodeURIComponent(
                    row.application_id
                  )}`
                )
              }
            />
          </Card>

          <Stack spacing={3}>
            <Card sx={{ p: 3 }}>
              <Typography variant="h6">{t('overview.queue.title')}</Typography>
              <Stack divider={<Divider flexItem />} sx={{ mt: 1.5 }}>
                <QueueItem
                  label={t('overview.queue.deposits')}
                  value={overview.pending.deposits}
                  icon="solar:download-minimalistic-bold-duotone"
                  onClick={() => navigate('/dashboard/operations/deposits')}
                />
              </Stack>
            </Card>

            <Card sx={{ p: 3 }}>
              <Typography variant="h6" sx={{ mb: 2 }}>
                {t('overview.quickActions.title')}
              </Typography>
              <Stack spacing={1.25}>
                <Button
                  fullWidth
                  variant="contained"
                  startIcon={<Iconify icon="solar:download-minimalistic-bold-duotone" />}
                  onClick={() => navigate('/dashboard/operations/deposits')}
                >
                  {t('overview.quickActions.recordDeposit')}
                </Button>
                <Button
                  fullWidth
                  variant="outlined"
                  startIcon={<Iconify icon="solar:user-plus-bold-duotone" />}
                  onClick={() => navigate('/dashboard/va-applications/new')}
                >
                  {t('overview.quickActions.newApplication')}
                </Button>
              </Stack>
            </Card>
          </Stack>
        </Box>
          </>
        )}

        {prototypeEnabled && (
          <PrototypeVariantSwitcher
            variants={[
              { key: 'A', label: '经营脉搏' },
              { key: 'B', label: '资金驾驶舱' },
              { key: 'C', label: '运营指挥台' },
            ]}
            current={prototypeVariant}
            onChange={(variant) => {
              const next = new URLSearchParams(searchParams);
              next.set('prototype', 'charts');
              next.set('variant', variant);
              setSearchParams(next, { replace: true });
            }}
          />
        )}
      </Container>
    </>
  );
}

function MetricCard({
  title,
  value,
  helper,
  icon,
  color,
  onClick,
}: {
  title: string;
  value: number;
  helper: string;
  icon: string;
  color: 'primary' | 'info' | 'warning' | 'success';
  onClick: () => void;
}) {
  const { i18n } = useTranslation('admin');
  const locale = localeForLanguage(i18n.resolvedLanguage || i18n.language);

  return (
    <Card
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') onClick();
      }}
      sx={{
        p: 3,
        cursor: 'pointer',
        transition: (theme) => theme.transitions.create(['transform', 'box-shadow']),
        '&:hover': { transform: 'translateY(-2px)', boxShadow: 6 },
        '&:focus-visible': { outline: '2px solid', outlineColor: `${color}.main` },
      }}
    >
      <Stack direction="row" alignItems="flex-start" justifyContent="space-between">
        <Box>
          <Typography variant="body2" color="text.secondary">
            {title}
          </Typography>
          <Typography variant="h3" sx={{ my: 0.75 }}>
            {formatAmount(value, locale, 0)}
          </Typography>
          <Typography variant="caption" color="text.secondary">
            {helper}
          </Typography>
        </Box>
        <Box
          sx={{
            p: 1.5,
            display: 'grid',
            placeItems: 'center',
            borderRadius: 2,
            bgcolor: `${color}.lighter`,
            color: `${color}.dark`,
          }}
        >
          <Iconify icon={icon} width={28} />
        </Box>
      </Stack>
    </Card>
  );
}

function BalanceBreakdown({
  balance,
  decimals,
}: {
  balance?: BalanceSummary;
  decimals: number;
}) {
  const { t, i18n } = useTranslation('admin');
  const locale = localeForLanguage(i18n.resolvedLanguage || i18n.language);

  return (
    <Stack direction="row" divider={<Divider orientation="vertical" flexItem />} spacing={2}>
      <Box sx={{ flex: 1 }}>
        <Typography variant="caption" color="text.secondary">
          {t('common.ledgerBalance')}
        </Typography>
        <Typography variant="subtitle1">
          {formatAmount(balance?.ledger_balance, locale, decimals)}
        </Typography>
      </Box>
      <Box sx={{ flex: 1 }}>
        <Typography variant="caption" color="text.secondary">
          {t('common.pendingReserved')}
        </Typography>
        <Typography variant="subtitle1">
          {formatAmount(balance?.reserved, locale, decimals)}
        </Typography>
      </Box>
    </Stack>
  );
}

function QueueItem({
  label,
  value,
  icon,
  onClick,
}: {
  label: string;
  value: number;
  icon: string;
  onClick: () => void;
}) {
  const { i18n } = useTranslation('admin');
  const locale = localeForLanguage(i18n.resolvedLanguage || i18n.language);

  return (
    <Button
      color="inherit"
      onClick={onClick}
      sx={{ px: 0.5, py: 1.5, justifyContent: 'space-between' }}
    >
      <Stack direction="row" alignItems="center" spacing={1.25}>
        <Iconify icon={icon} width={22} color="text.secondary" />
        <Typography variant="body2">{label}</Typography>
      </Stack>
      <Label color={value ? 'warning' : 'default'}>
        {formatAmount(value, locale, 0)}
      </Label>
    </Button>
  );
}

function RecentTransactions({
  rows,
  onView,
}: {
  rows: RecentTransaction[];
  onView: (row: RecentTransaction) => void;
}) {
  const { t, i18n } = useTranslation('admin');
  const { t: operationText } = useTranslation('operations');
  const locale = localeForLanguage(i18n.resolvedLanguage || i18n.language);

  return (
    <TableContainer sx={{ overflowX: 'auto' }}>
      <Table sx={{ minWidth: 1180 }}>
        <TableHead>
          <TableRow>
            <TableCell>{operationText('table.time')}</TableCell>
            <TableCell>{operationText('fields.customer')}</TableCell>
            <TableCell>{operationText('fields.type')}</TableCell>
            <TableCell>{operationText('table.channelNetwork')}</TableCell>
            <TableCell>{operationText('fields.amount')}</TableCell>
            <TableCell>{operationText('fields.status')}</TableCell>
            <TableCell>{operationText('table.transactionId')}</TableCell>
            <TableCell align="right">{operationText('table.actions')}</TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {rows.map((row) => (
            <TableRow key={`${row.category}:${row.id}`} hover>
              <TableCell>{formatDate(row.created_at, locale)}</TableCell>
              <TableCell>
                <Typography variant="subtitle2">{row.customer_name}</Typography>
                <Typography variant="caption" color="text.secondary">
                  {row.application_id}
                </Typography>
              </TableCell>
              <TableCell>{transactionTypeLabel(row.type, operationText)}</TableCell>
              <TableCell>{transactionChannel(row)}</TableCell>
              <TableCell>
                <RecentTransactionAmount row={row} locale={locale} />
                {['fiat_withdrawal', 'usdt_withdrawal'].includes(row.type) && (
                  <Typography variant="caption" color="text.secondary">
                    {operationText('table.feeAndNet', {
                      fee: formatAmount(row.fee_amount, locale),
                      net: formatAmount(
                        row.net_amount ?? Number(row.amount || 0) - Number(row.fee_amount || 0),
                        locale
                      ),
                      asset: row.asset,
                    })}
                  </Typography>
                )}
              </TableCell>
              <TableCell>
                <Label color={statusColor(row.status)}>
                  {transactionStatusLabel(row.status, operationText)}
                </Label>
              </TableCell>
              <TableCell>
                <Typography variant="caption" sx={{ overflowWrap: 'anywhere' }}>
                  {row.id}
                </Typography>
              </TableCell>
              <TableCell align="right">
                <Button size="small" color="inherit" onClick={() => onView(row)}>
                  {operationText('actions.view')}
                </Button>
              </TableCell>
            </TableRow>
          ))}
          {!rows.length && (
            <TableRow>
              <TableCell colSpan={8} align="center" sx={{ py: 7 }}>
                <Typography color="text.secondary">{t('overview.recent.empty')}</Typography>
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
    </TableContainer>
  );
}

function RecentTransactionAmount({ row, locale }: { row: RecentTransaction; locale: string }) {
  if (row.category === 'otc') {
    const completed = row.status === 'completed';
    return (
      <Stack direction="row" spacing={0.75} alignItems="center" flexWrap="wrap">
        <Typography
          component="span"
          variant="body2"
          sx={{
            color: completed ? 'error.dark' : 'text.primary',
            fontWeight: completed ? 600 : 400,
          }}
        >
          {completed ? '−' : ''}
          {formatAmount(row.amount, locale)} {row.asset}
        </Typography>
        <Iconify icon="solar:alt-arrow-right-linear" width={15} color="text.disabled" />
        <Typography
          component="span"
          variant="body2"
          sx={{
            color: completed ? 'success.dark' : 'text.primary',
            fontWeight: completed ? 600 : 400,
          }}
        >
          {completed ? '+' : ''}
          {formatAmount(row.counter_amount, locale)} {row.counter_asset}
        </Typography>
      </Stack>
    );
  }

  let presentation: { prefix: string; color: string; fontWeight: number } = {
    prefix: '',
    color: 'text.primary',
    fontWeight: 400,
  };
  if (row.direction === 'credit') {
    presentation = { prefix: '+', color: 'success.dark', fontWeight: 600 };
  } else if (row.direction === 'debit') {
    presentation = { prefix: '−', color: 'error.dark', fontWeight: 600 };
  }

  return (
    <Typography
      variant="body2"
      sx={{ color: presentation.color, fontWeight: presentation.fontWeight }}
    >
      {presentation.prefix}
      {formatAmount(row.amount, locale)} {row.asset}
    </Typography>
  );
}
