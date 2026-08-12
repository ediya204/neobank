import { useCallback, useEffect, useMemo, useState } from 'react';
import { Helmet } from 'react-helmet-async';
import { useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { alpha, useTheme } from '@mui/material/styles';
import {
  Alert,
  Box,
  Button,
  Card,
  CircularProgress,
  Container,
  Drawer,
  IconButton,
  MenuItem,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TablePagination,
  TableRow,
  TextField,
  Typography,
} from '@mui/material';
import Chart, { useChart } from 'src/components/chart';
import Iconify from 'src/components/iconify';
import Label from 'src/components/label';
import { useSettingsContext } from 'src/components/settings';
import { getLocalizedApiError } from 'src/locales/api-error';
import { browserApiFetch } from 'src/utils/browser-api';
import { USD_ASSET_ICON } from 'src/utils/asset-icons';

type Scope = 'admin' | 'portal';
type AmountRow = {
  asset: string;
  network: string | null;
  amount: string;
  count: number;
};
type OtcRow = {
  sell_asset: string;
  sell_network: string | null;
  sell_amount: string;
  buy_asset: string;
  buy_network: string | null;
  buy_amount: string;
  count: number;
};
type BalanceRow = {
  asset: string;
  network: string | null;
  ledger_balance: string;
  reserved: string;
  available_balance: string;
};
type ReconciliationRow = {
  asset: string;
  network: string | null;
  opening_balance: string;
  credits: string;
  debits: string;
  expected_closing: string;
  closing_balance: string;
  delta: string;
};
type Summary = {
  date: string;
  timezone: string;
  as_of: string;
  window: { start: string; end: string };
  deposits: AmountRow[];
  otc: OtcRow[];
  sweeps: AmountRow[];
  sweep_pending: Array<{ status: string; count: number; amount: string }>;
  exceptions: { pending_settlement: number; settlement_exception: number; sweep_pending: number };
  balances: BalanceRow[];
  reconciliation: ReconciliationRow[];
  comparison: {
    type: 'previous_day';
    window: { start: string; end: string };
    deposits: AmountRow[];
    otc: OtcRow[];
    sweeps: AmountRow[];
  };
  trend: Array<{
    day: string;
    asset: string;
    network: string | null;
    credits: string;
    debits: string;
    net: string;
  }>;
};
type Movement = Record<string, any> & {
  id: string;
  type: string;
  customer_name?: string;
  asset: string;
  network?: string | null;
  amount: string;
  counter_asset?: string | null;
  counter_amount?: string | null;
  status: string;
  created_at: string;
};

const EMPTY_SUMMARY: Summary = {
  date: '',
  timezone: 'Asia/Shanghai',
  as_of: '',
  window: { start: '', end: '' },
  deposits: [],
  otc: [],
  sweeps: [],
  sweep_pending: [],
  exceptions: { pending_settlement: 0, settlement_exception: 0, sweep_pending: 0 },
  balances: [],
  reconciliation: [],
  comparison: {
    type: 'previous_day',
    window: { start: '', end: '' },
    deposits: [],
    otc: [],
    sweeps: [],
  },
  trend: [],
};

function shanghaiToday() {
  const values = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Shanghai',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    })
      .formatToParts(new Date())
      .map((part) => [part.type, part.value])
  );
  return `${values.year}-${values.month}-${values.day}`;
}

function formatAmount(value: string, language: string) {
  return Number(value || 0).toLocaleString(
    language.startsWith('zh') || language === 'cn' ? 'zh-CN' : 'en-US',
    {
      maximumFractionDigits: 6,
    }
  );
}

function assetLabel(asset: string, network: string | null) {
  return `${asset}${network ? ` · ${network}` : ''}`;
}

function statusColor(status: string): 'success' | 'warning' | 'error' | 'default' {
  if (status === 'completed' || status === 'posted') return 'success';
  if (status === 'submitted' || status === 'processing') return 'warning';
  if (status === 'rejected' || status === 'cancelled') return 'error';
  return 'default';
}

function percentageChange(current: number, previous: number) {
  if (!previous) return current ? null : 0;
  return ((current - previous) / previous) * 100;
}

function sevenDaysEnding(date: string) {
  const end = new Date(`${date}T00:00:00.000Z`);
  return Array.from({ length: 7 }, (_, index) =>
    new Date(end.getTime() - (6 - index) * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
  );
}

function MetricCard({
  icon,
  title,
  value,
  helper,
  comparison,
  tone = 'primary',
}: {
  icon: string;
  title: string;
  value: string;
  helper: string;
  comparison?: { label: string; direction: 'up' | 'down' | 'flat' | 'new' };
  tone?: 'primary' | 'success' | 'warning' | 'error' | 'info';
}) {
  const theme = useTheme();
  const color = theme.palette[tone].main;
  let comparisonColor: 'success' | 'warning' | 'default' = 'default';
  if (comparison?.direction === 'up' || comparison?.direction === 'new') {
    comparisonColor = 'success';
  } else if (comparison?.direction === 'down') {
    comparisonColor = 'warning';
  }
  return (
    <Card sx={{ p: 2.5, position: 'relative', overflow: 'hidden' }}>
      <Box
        sx={{
          width: 48,
          height: 48,
          borderRadius: 1.5,
          display: 'grid',
          placeItems: 'center',
          color,
          bgcolor: alpha(color, 0.1),
        }}
      >
        <Iconify icon={icon} width={26} />
      </Box>
      <Typography variant="subtitle2" color="text.secondary" sx={{ mt: 2 }}>
        {title}
      </Typography>
      <Typography variant="h5" sx={{ mt: 0.5, wordBreak: 'break-word' }}>
        {value}
      </Typography>
      <Stack direction="row" spacing={1} alignItems="center" sx={{ mt: 1, minHeight: 24 }}>
        {comparison && <Label color={comparisonColor}>{comparison.label}</Label>}
        <Typography variant="caption" color="text.secondary">
          {helper}
        </Typography>
      </Stack>
    </Card>
  );
}

function CurrentFundsCard({
  title,
  usd,
  usdt,
  language,
}: {
  title: string;
  usd: number;
  usdt: number;
  language: string;
}) {
  const rows = [
    { asset: 'USD', amount: usd, icon: USD_ASSET_ICON, color: 'primary.main' },
    {
      asset: 'USDT',
      amount: usdt,
      icon: 'cryptocurrency-color:usdt',
      color: 'success.main',
    },
  ];
  return (
    <Card sx={{ p: 2.5 }}>
      <Typography variant="subtitle2" color="text.secondary">
        {title}
      </Typography>
      <Stack spacing={1.5} sx={{ mt: 2 }}>
        {rows.map((row) => (
          <Stack
            key={row.asset}
            direction="row"
            alignItems="center"
            justifyContent="space-between"
            spacing={1.5}
          >
            <Stack direction="row" alignItems="center" spacing={1}>
              <Box
                sx={{
                  width: 36,
                  height: 36,
                  borderRadius: 1.25,
                  display: 'grid',
                  placeItems: 'center',
                  bgcolor: (theme) => alpha(theme.palette.grey[500], 0.08),
                }}
              >
                <Iconify icon={row.icon} width={22} />
              </Box>
              <Typography variant="subtitle2">{row.asset}</Typography>
            </Stack>
            <Typography variant="h6" sx={{ color: row.color, textAlign: 'right' }}>
              {formatAmount(String(row.amount), language)}
            </Typography>
          </Stack>
        ))}
      </Stack>
    </Card>
  );
}

export default function ReconciliationPage({ scope }: { scope: Scope }) {
  const { t, i18n } = useTranslation('admin');
  const theme = useTheme();
  const settings = useSettingsContext();
  const [searchParams, setSearchParams] = useSearchParams();
  const requestedDate = searchParams.get('date');
  const [date, setDate] = useState(() =>
    requestedDate && /^\d{4}-\d{2}-\d{2}$/.test(requestedDate) ? requestedDate : shanghaiToday()
  );
  const [summary, setSummary] = useState<Summary>(EMPTY_SUMMARY);
  const [movements, setMovements] = useState<Movement[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [type, setType] = useState('all');
  const [assetFilter, setAssetFilter] = useState<'all' | 'USD' | 'USDT'>('all');
  const [networkFilter, setNetworkFilter] = useState('all');
  const [chartAsset, setChartAsset] = useState<'USD' | 'USDT'>('USD');
  const [chartNetwork, setChartNetwork] = useState('all');
  const [selected, setSelected] = useState<Movement | null>(null);
  const [loading, setLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState('');
  const base = `/api/browser/v1/${scope}`;

  const load = useCallback(
    async (signal?: AbortSignal) => {
      setLoading(true);
      setErrorMessage('');
      try {
        const summaryResponse = await browserApiFetch(`${base}/reconciliation?date=${date}`, {
          signal,
        });
        const summaryBody = await summaryResponse.json();
        if (!summaryResponse.ok)
          throw new Error(getLocalizedApiError(summaryBody, t('reconciliation.errors.read')));
        const nextSummary = (summaryBody.data || EMPTY_SUMMARY) as Summary;
        const params = new URLSearchParams({
          datetime_from: nextSummary.window.start,
          datetime_to: nextSummary.window.end,
          page: String(page + 1),
          limit: '50',
          type,
        });
        if (assetFilter !== 'all') {
          params.set('wallet', assetFilter === 'USD' ? 'fiat' : 'crypto');
        }
        if (assetFilter === 'USDT' && networkFilter !== 'all') {
          params.set('network', networkFilter);
        }
        const movementResponse = await browserApiFetch(
          `${base}/reconciliation/movements?${params}`,
          { signal }
        );
        const movementBody = await movementResponse.json();
        if (!movementResponse.ok)
          throw new Error(getLocalizedApiError(movementBody, t('reconciliation.errors.read')));
        setSummary(nextSummary);
        setMovements(movementBody.data || []);
        setTotal(Number(movementBody.meta?.total || 0));
      } catch (error) {
        if ((error as Error).name !== 'AbortError') setErrorMessage((error as Error).message);
      } finally {
        if (!signal?.aborted) setLoading(false);
      }
    },
    [assetFilter, base, date, networkFilter, page, t, type]
  );

  useEffect(() => {
    const controller = new AbortController();
    load(controller.signal);
    return () => controller.abort();
  }, [load]);

  const exceptionCount = useMemo(
    () =>
      summary.exceptions.pending_settlement +
      summary.exceptions.settlement_exception +
      summary.exceptions.sweep_pending,
    [summary.exceptions]
  );
  const allBalanced = summary.reconciliation.every((row) => Number(row.delta) === 0);
  const detailFilterActive = assetFilter !== 'all' || networkFilter !== 'all' || type !== 'all';
  const metricText = (rows: AmountRow[]) =>
    rows.length
      ? rows.map((row) => `${formatAmount(row.amount, i18n.language)} ${row.asset}`).join(' · ')
      : t('reconciliation.emptyAmount');
  const otcText = summary.otc.length
    ? summary.otc
        .map(
          (row) =>
            `${formatAmount(row.sell_amount, i18n.language)} ${row.sell_asset} → ${formatAmount(
              row.buy_amount,
              i18n.language
            )} ${row.buy_asset}`
        )
        .join(' · ')
    : t('reconciliation.emptyAmount');

  const comparisonForCounts = (current: number, previous: number) => {
    const percentage = percentageChange(current, previous);
    if (percentage === null) {
      return { label: t('reconciliation.comparison.new'), direction: 'new' as const };
    }
    if (percentage === 0) {
      return { label: t('reconciliation.comparison.unchanged'), direction: 'flat' as const };
    }
    return {
      label: `${percentage > 0 ? '↑' : '↓'} ${Math.abs(percentage).toLocaleString(undefined, {
        maximumFractionDigits: 1,
      })}%`,
      direction: percentage > 0 ? ('up' as const) : ('down' as const),
    };
  };
  const depositCount = summary.deposits.reduce((sum, row) => sum + row.count, 0);
  const previousDepositCount = summary.comparison.deposits.reduce((sum, row) => sum + row.count, 0);
  const otcCount = summary.otc.reduce((sum, row) => sum + row.count, 0);
  const previousOtcCount = summary.comparison.otc.reduce((sum, row) => sum + row.count, 0);
  const sweepCount = summary.sweeps.reduce((sum, row) => sum + row.count, 0);
  const previousSweepCount = summary.comparison.sweeps.reduce((sum, row) => sum + row.count, 0);
  const availableByAsset = summary.balances.reduce<Record<string, number>>((result, row) => {
    result[row.asset] = (result[row.asset] || 0) + Number(row.available_balance);
    return result;
  }, {});
  const trendDays = sevenDaysEnding(summary.date || date);
  const trendValues = trendDays.map((day) => {
    const rows = summary.trend.filter(
      (row) =>
        row.day === day &&
        row.asset === chartAsset &&
        (chartAsset === 'USD' || chartNetwork === 'all' || row.network === chartNetwork)
    );
    return rows.reduce(
      (result, row) => ({
        credits: result.credits + Number(row.credits),
        debits: result.debits + Number(row.debits),
        net: result.net + Number(row.net),
      }),
      { credits: 0, debits: 0, net: 0 }
    );
  });
  const usdtComposition = summary.balances.filter((row) => row.asset === 'USDT');
  const flowOptions = useChart({
    chart: {
      stacked: false,
      toolbar: { show: false },
      events: {
        dataPointSelection: (_event, _chart, config) => {
          const selectedDay = trendDays[config.dataPointIndex];
          if (selectedDay) {
            setDate(selectedDay);
            setSearchParams({ date: selectedDay });
            setAssetFilter(chartAsset);
            setNetworkFilter(chartAsset === 'USDT' ? chartNetwork : 'all');
            setPage(0);
          }
        },
      },
    },
    colors: [theme.palette.success.main, theme.palette.warning.main, theme.palette.info.main],
    xaxis: { categories: trendDays.map((day) => day.slice(5)) },
    yaxis: { labels: { formatter: (value) => value.toLocaleString() } },
    stroke: { width: [0, 0, 3], curve: 'smooth' },
    plotOptions: { bar: { borderRadius: 4, columnWidth: '52%' } },
    legend: { position: 'top', horizontalAlign: 'right' },
    tooltip: { shared: true, intersect: false },
  });
  const compositionOptions = useChart({
    labels: usdtComposition.map((row) => row.network || t('reconciliation.charts.noNetwork')),
    colors: [
      theme.palette.primary.main,
      theme.palette.info.main,
      theme.palette.warning.main,
      theme.palette.success.main,
    ],
    chart: {
      events: {
        dataPointSelection: (_event, _chart, config) => {
          const network = usdtComposition[config.dataPointIndex]?.network;
          if (network) {
            setChartAsset('USDT');
            setChartNetwork(network);
            setAssetFilter('USDT');
            setNetworkFilter(network);
            setPage(0);
          }
        },
      },
    },
    legend: { position: 'bottom' },
    dataLabels: { enabled: false },
    plotOptions: {
      pie: {
        donut: {
          size: '68%',
          labels: {
            show: true,
            total: { show: true, label: 'USDT', formatter: () => '' },
          },
        },
      },
    },
  });

  return (
    <>
      <Helmet>
        <title>{t('reconciliation.pageTitle')}</title>
      </Helmet>
      <Container maxWidth={settings.themeStretch ? false : 'xl'} sx={{ py: 4 }}>
        <Stack spacing={3}>
          <Stack direction={{ xs: 'column', md: 'row' }} justifyContent="space-between" gap={2}>
            <Box>
              <Typography variant="h3">{t('reconciliation.title')}</Typography>
              <Typography color="text.secondary" sx={{ mt: 1 }}>
                {t(`reconciliation.description.${scope}`)}
              </Typography>
            </Box>
            <Stack direction="row" spacing={1} alignItems="center">
              <TextField
                type="date"
                size="small"
                label={t('reconciliation.date')}
                value={date}
                onChange={(event) => {
                  setDate(event.target.value);
                  setSearchParams(event.target.value ? { date: event.target.value } : {});
                  setPage(0);
                }}
                InputLabelProps={{ shrink: true }}
              />
              <Button
                variant="outlined"
                startIcon={<Iconify icon="solar:refresh-bold" />}
                onClick={() => load()}
              >
                {t('common.refresh')}
              </Button>
            </Stack>
          </Stack>

          {errorMessage && (
            <Alert
              severity="error"
              action={<Button onClick={() => load()}>{t('common.retry')}</Button>}
            >
              {errorMessage}
            </Alert>
          )}
          {loading && !summary.as_of ? (
            <Box sx={{ py: 10, textAlign: 'center' }}>
              <CircularProgress />
            </Box>
          ) : (
            <>
              <Box
                sx={{
                  display: 'grid',
                  gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, 1fr)', xl: 'repeat(5, 1fr)' },
                  gap: 2,
                }}
              >
                <MetricCard
                  icon="solar:download-minimalistic-bold-duotone"
                  title={t('reconciliation.metrics.deposits')}
                  value={metricText(summary.deposits)}
                  helper={t('reconciliation.comparison.previousDay')}
                  comparison={comparisonForCounts(depositCount, previousDepositCount)}
                  tone="success"
                />
                <MetricCard
                  icon="solar:transfer-horizontal-bold-duotone"
                  title={t('reconciliation.metrics.otc')}
                  value={otcText}
                  helper={t('reconciliation.comparison.previousDay')}
                  comparison={comparisonForCounts(otcCount, previousOtcCount)}
                  tone="info"
                />
                <MetricCard
                  icon="solar:upload-minimalistic-bold-duotone"
                  title={t('reconciliation.metrics.sweeps')}
                  value={metricText(summary.sweeps)}
                  helper={t('reconciliation.pendingSweeps', {
                    count: summary.exceptions.sweep_pending,
                  })}
                  comparison={comparisonForCounts(sweepCount, previousSweepCount)}
                  tone="warning"
                />
                <CurrentFundsCard
                  title={t('reconciliation.metrics.funds')}
                  usd={availableByAsset.USD || 0}
                  usdt={availableByAsset.USDT || 0}
                  language={i18n.language}
                />
                <MetricCard
                  icon="solar:danger-triangle-bold-duotone"
                  title={t('reconciliation.metrics.exceptions')}
                  value={String(exceptionCount)}
                  helper={t('reconciliation.exceptionHelper')}
                  tone={exceptionCount ? 'error' : 'success'}
                />
              </Box>

              <Box
                sx={{
                  display: 'grid',
                  gridTemplateColumns: { xs: '1fr', xl: 'minmax(0, 1.5fr) minmax(320px, 0.7fr)' },
                  gap: 3,
                }}
              >
                <Card sx={{ p: 3 }}>
                  <Stack
                    direction={{ xs: 'column', sm: 'row' }}
                    justifyContent="space-between"
                    gap={2}
                  >
                    <Box>
                      <Typography variant="h6">{t('reconciliation.charts.flowTitle')}</Typography>
                      <Typography variant="body2" color="text.secondary">
                        {t('reconciliation.charts.flowDescription')}
                      </Typography>
                    </Box>
                    <Stack direction="row" spacing={1}>
                      <TextField
                        select
                        size="small"
                        label={t('reconciliation.charts.asset')}
                        value={chartAsset}
                        onChange={(event) => {
                          setChartAsset(event.target.value as 'USD' | 'USDT');
                          if (event.target.value === 'USD') setChartNetwork('all');
                        }}
                        sx={{ minWidth: 110 }}
                      >
                        <MenuItem value="USD">USD</MenuItem>
                        <MenuItem value="USDT">USDT</MenuItem>
                      </TextField>
                      {chartAsset === 'USDT' && (
                        <TextField
                          select
                          size="small"
                          label={t('common.network')}
                          value={chartNetwork}
                          onChange={(event) => setChartNetwork(event.target.value)}
                          sx={{ minWidth: 130 }}
                        >
                          <MenuItem value="all">{t('reconciliation.charts.allNetworks')}</MenuItem>
                          {usdtComposition.map((row) => (
                            <MenuItem key={row.network || 'none'} value={row.network || 'all'}>
                              {row.network || t('reconciliation.charts.noNetwork')}
                            </MenuItem>
                          ))}
                        </TextField>
                      )}
                    </Stack>
                  </Stack>
                  <Chart
                    type="line"
                    series={[
                      {
                        name: t('reconciliation.check.credits'),
                        type: 'column',
                        data: trendValues.map((item) => item.credits),
                      },
                      {
                        name: t('reconciliation.check.debits'),
                        type: 'column',
                        data: trendValues.map((item) => item.debits),
                      },
                      {
                        name: t('reconciliation.charts.netChange'),
                        type: 'line',
                        data: trendValues.map((item) => item.net),
                      },
                    ]}
                    options={flowOptions}
                    height={330}
                  />
                </Card>

                <Card sx={{ p: 3 }}>
                  <Typography variant="h6">
                    {t('reconciliation.charts.compositionTitle')}
                  </Typography>
                  <Typography variant="body2" color="text.secondary">
                    {t('reconciliation.charts.compositionDescription')}
                  </Typography>
                  {usdtComposition.length ? (
                    <Chart
                      type="donut"
                      series={usdtComposition.map((row) => Number(row.available_balance))}
                      options={compositionOptions}
                      height={330}
                    />
                  ) : (
                    <Typography color="text.secondary" sx={{ py: 10, textAlign: 'center' }}>
                      {t('reconciliation.charts.empty')}
                    </Typography>
                  )}
                </Card>
              </Box>

              <Box
                sx={{
                  display: 'grid',
                  gridTemplateColumns: { xs: '1fr', lg: '0.8fr 1.2fr' },
                  gap: 3,
                }}
              >
                <Card>
                  <Box sx={{ p: 3 }}>
                    <Typography variant="h6">{t('reconciliation.balances.title')}</Typography>
                    <Typography variant="body2" color="text.secondary">
                      {t('reconciliation.balances.description')}
                    </Typography>
                  </Box>
                  <TableContainer>
                    <Table>
                      <TableHead>
                        <TableRow>
                          <TableCell>{t('common.currency')}</TableCell>
                          <TableCell align="right">{t('common.ledgerBalance')}</TableCell>
                          <TableCell align="right">{t('common.reserved')}</TableCell>
                          <TableCell align="right">{t('common.availableBalance')}</TableCell>
                        </TableRow>
                      </TableHead>
                      <TableBody>
                        {summary.balances.map((row) => (
                          <TableRow key={`${row.asset}-${row.network}`}>
                            <TableCell>{assetLabel(row.asset, row.network)}</TableCell>
                            <TableCell align="right">
                              {formatAmount(row.ledger_balance, i18n.language)}
                            </TableCell>
                            <TableCell align="right">
                              {formatAmount(row.reserved, i18n.language)}
                            </TableCell>
                            <TableCell align="right">
                              <Typography variant="subtitle2">
                                {formatAmount(row.available_balance, i18n.language)}
                              </Typography>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </TableContainer>
                </Card>
                <Card>
                  <Stack
                    direction={{ xs: 'column', sm: 'row' }}
                    justifyContent="space-between"
                    gap={2}
                    sx={{ p: 3 }}
                  >
                    <Box>
                      <Typography variant="h6">{t('reconciliation.check.title')}</Typography>
                      <Typography variant="body2" color="text.secondary">
                        {t('reconciliation.check.description')}
                      </Typography>
                    </Box>
                    <Label color={allBalanced ? 'success' : 'error'}>
                      <Iconify
                        icon={
                          allBalanced ? 'solar:check-circle-bold' : 'solar:danger-triangle-bold'
                        }
                        width={16}
                        sx={{ mr: 0.5 }}
                      />
                      {t(
                        allBalanced
                          ? 'reconciliation.check.allBalanced'
                          : 'reconciliation.check.hasDifference'
                      )}
                    </Label>
                  </Stack>
                  <TableContainer>
                    <Table>
                      <TableHead>
                        <TableRow>
                          <TableCell>{t('common.currency')}</TableCell>
                          <TableCell align="right">{t('reconciliation.check.opening')}</TableCell>
                          <TableCell align="right">{t('reconciliation.check.credits')}</TableCell>
                          <TableCell align="right">{t('reconciliation.check.debits')}</TableCell>
                          <TableCell align="right">{t('reconciliation.check.closing')}</TableCell>
                          <TableCell align="right">{t('reconciliation.check.delta')}</TableCell>
                        </TableRow>
                      </TableHead>
                      <TableBody>
                        {summary.reconciliation.map((row) => (
                          <TableRow key={`${row.asset}-${row.network}`}>
                            <TableCell>{assetLabel(row.asset, row.network)}</TableCell>
                            <TableCell align="right">
                              {formatAmount(row.opening_balance, i18n.language)}
                            </TableCell>
                            <TableCell align="right">
                              +{formatAmount(row.credits, i18n.language)}
                            </TableCell>
                            <TableCell align="right">
                              −{formatAmount(row.debits, i18n.language)}
                            </TableCell>
                            <TableCell align="right">
                              {formatAmount(row.closing_balance, i18n.language)}
                            </TableCell>
                            <TableCell align="right">
                              <Label color={Number(row.delta) === 0 ? 'success' : 'error'}>
                                {formatAmount(row.delta, i18n.language)}
                              </Label>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </TableContainer>
                </Card>
              </Box>

              <Card>
                <Stack
                  direction={{ xs: 'column', sm: 'row' }}
                  justifyContent="space-between"
                  gap={2}
                  sx={{ p: 3 }}
                >
                  <Box>
                    <Typography variant="h6">{t('reconciliation.movements.title')}</Typography>
                    <Typography variant="body2" color="text.secondary">
                      {t('reconciliation.movements.description')}
                    </Typography>
                  </Box>
                  <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1}>
                    <TextField
                      select
                      size="small"
                      label={t('reconciliation.charts.asset')}
                      value={assetFilter}
                      onChange={(event) => {
                        const value = event.target.value as 'all' | 'USD' | 'USDT';
                        setAssetFilter(value);
                        if (value !== 'USDT') setNetworkFilter('all');
                        setPage(0);
                      }}
                      sx={{ minWidth: 120 }}
                    >
                      <MenuItem value="all">{t('reconciliation.charts.allAssets')}</MenuItem>
                      <MenuItem value="USD">USD</MenuItem>
                      <MenuItem value="USDT">USDT</MenuItem>
                    </TextField>
                    {assetFilter === 'USDT' && (
                      <TextField
                        select
                        size="small"
                        label={t('common.network')}
                        value={networkFilter}
                        onChange={(event) => {
                          setNetworkFilter(event.target.value);
                          setPage(0);
                        }}
                        sx={{ minWidth: 130 }}
                      >
                        <MenuItem value="all">{t('reconciliation.charts.allNetworks')}</MenuItem>
                        {usdtComposition.map((row) => (
                          <MenuItem key={row.network || 'none'} value={row.network || 'all'}>
                            {row.network || t('reconciliation.charts.noNetwork')}
                          </MenuItem>
                        ))}
                      </TextField>
                    )}
                    <TextField
                      select
                      size="small"
                      label={t('common.type')}
                      value={type}
                      onChange={(event) => {
                        setType(event.target.value);
                        setPage(0);
                      }}
                      sx={{ minWidth: 190 }}
                    >
                      {['all', 'fiat_deposit', 'usdt_deposit', 'otc', 'usdt_sweep'].map((value) => (
                        <MenuItem key={value} value={value}>
                          {t(`reconciliation.types.${value}`)}
                        </MenuItem>
                      ))}
                    </TextField>
                    {detailFilterActive && (
                      <Button
                        color="inherit"
                        onClick={() => {
                          setAssetFilter('all');
                          setNetworkFilter('all');
                          setType('all');
                          setPage(0);
                        }}
                      >
                        {t('reconciliation.movements.clearFilters')}
                      </Button>
                    )}
                  </Stack>
                </Stack>
                <TableContainer>
                  <Table>
                    <TableHead>
                      <TableRow>
                        <TableCell>{t('common.time')}</TableCell>
                        <TableCell>{t('common.customer')}</TableCell>
                        <TableCell>{t('common.type')}</TableCell>
                        <TableCell>{t('common.amount')}</TableCell>
                        <TableCell>{t('common.status')}</TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {movements.map((row) => (
                        <TableRow
                          key={`${row.type}-${row.id}`}
                          hover
                          onClick={() => setSelected(row)}
                          sx={{ cursor: 'pointer' }}
                        >
                          <TableCell>
                            {new Date(row.completed_at || row.created_at).toLocaleString()}
                          </TableCell>
                          <TableCell>
                            {row.customer_name || row.partner_customer_id || '-'}
                          </TableCell>
                          <TableCell>
                            {t(`reconciliation.types.${row.type}`, { defaultValue: row.type })}
                          </TableCell>
                          <TableCell>
                            {formatAmount(row.amount, i18n.language)} {row.asset}
                            {row.counter_asset
                              ? ` → ${formatAmount(row.counter_amount || '0', i18n.language)} ${
                                  row.counter_asset
                                }`
                              : ''}
                          </TableCell>
                          <TableCell>
                            <Label color={statusColor(row.status)}>
                              {t(`reconciliation.status.${row.status}`, {
                                defaultValue: row.status,
                              })}
                            </Label>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </TableContainer>
                {!movements.length && (
                  <Typography color="text.secondary" sx={{ p: 4, textAlign: 'center' }}>
                    {t('reconciliation.movements.empty')}
                  </Typography>
                )}
                <TablePagination
                  component="div"
                  count={total}
                  page={page}
                  rowsPerPage={50}
                  rowsPerPageOptions={[50]}
                  onPageChange={(_, value) => setPage(value)}
                />
              </Card>
            </>
          )}
        </Stack>
      </Container>

      <Drawer
        anchor="right"
        open={Boolean(selected)}
        onClose={() => setSelected(null)}
        PaperProps={{ sx: { width: { xs: 1, sm: 480 } } }}
      >
        {selected && (
          <>
            <Stack
              direction="row"
              alignItems="center"
              justifyContent="space-between"
              sx={{ p: 3, borderBottom: '1px solid', borderColor: 'divider' }}
            >
              <Box>
                <Typography variant="h6">{t('reconciliation.movements.detail')}</Typography>
                <Typography variant="caption" color="text.secondary">
                  {selected.id}
                </Typography>
              </Box>
              <IconButton onClick={() => setSelected(null)}>
                <Iconify icon="mingcute:close-line" />
              </IconButton>
            </Stack>
            <Stack spacing={2} sx={{ p: 3 }}>
              {[
                [t('common.customer'), selected.customer_name || selected.partner_customer_id],
                [
                  t('common.type'),
                  t(`reconciliation.types.${selected.type}`, { defaultValue: selected.type }),
                ],
                [
                  t('common.status'),
                  t(`reconciliation.status.${selected.status}`, { defaultValue: selected.status }),
                ],
                [
                  t('common.amount'),
                  `${formatAmount(selected.amount, i18n.language)} ${selected.asset}`,
                ],
                [t('common.network'), selected.network],
                [
                  t('reconciliation.movements.counterAmount'),
                  selected.counter_asset
                    ? `${formatAmount(selected.counter_amount || '0', i18n.language)} ${
                        selected.counter_asset
                      }`
                    : null,
                ],
                [
                  t('reconciliation.movements.reference'),
                  selected.reference ||
                    selected.transaction_reference ||
                    selected.external_reference,
                ],
                [t('reconciliation.movements.settlement'), selected.settlement_status],
                [t('reconciliation.movements.completedAt'), selected.completed_at],
                ...(scope === 'admin'
                  ? [[t('reconciliation.movements.operatorNote'), selected.operator_note]]
                  : []),
              ]
                .filter((item) => item[1])
                .map(([label, value]) => (
                  <Box key={String(label)}>
                    <Typography variant="caption" color="text.secondary">
                      {label}
                    </Typography>
                    <Typography variant="body2" sx={{ mt: 0.5, wordBreak: 'break-all' }}>
                      {String(value)}
                    </Typography>
                  </Box>
                ))}
            </Stack>
          </>
        )}
      </Drawer>
    </>
  );
}
