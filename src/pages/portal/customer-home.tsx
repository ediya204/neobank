import { useMemo, useState } from 'react';
import { Helmet } from 'react-helmet-async';
import {
  Alert,
  Box,
  Button,
  ButtonBase,
  Card,
  CardContent,
  Chip,
  Container,
  Divider,
  Skeleton,
  Stack,
  Typography,
} from '@mui/material';
import { useNavigate } from 'react-router-dom';
import Chart, { useChart } from 'src/components/chart';
import Iconify from 'src/components/iconify';
import AssetIcon from 'src/components/asset-icon';
import { APP_DISPLAY_NAME } from 'src/config-global';
import { usePortalCustomer } from 'src/features/finance/portal-customer-context';
import { MoneyAccount, Operation } from 'src/features/finance/core-api';
import { ACTION_ICONS } from 'src/theme/iconography';
import { money, OperationStatus } from './customer-shared';

type DisplayCurrency = 'USD' | 'HKD' | 'USDT';
type Period = 7 | 30 | 90;

const DISPLAY_CURRENCIES: DisplayCurrency[] = ['USD', 'HKD', 'USDT'];
const PERIODS: Period[] = [7, 30, 90];
const TREND_COLORS: Record<DisplayCurrency, string> = {
  USD: '#273449',
  HKD: '#BE2D3A',
  USDT: '#348B70',
};

export default function CustomerHome() {
  const navigate = useNavigate();
  const {
    customer,
    operations,
    assetSummary,
    assetSummaryUsesCachedRates,
    assetSummaryRateCurrencies,
    backendStarting,
    loading,
    error,
    refresh,
  } = usePortalCustomer();
  const [period, setPeriod] = useState<Period>(30);
  const cachedRatesAsOf = assetSummary?.ratesAsOf
    ? new Intl.DateTimeFormat('zh-CN', {
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      }).format(new Date(assetSummary.ratesAsOf))
    : '';

  const accounts = useMemo(() => customer?.accounts || [], [customer?.accounts]);
  const firstName =
    customer?.type === 'INDIVIDUAL' ? customer.displayName : customer?.displayName.split(' ')[0];
  const balances = useMemo(() => aggregateBalances(accounts), [accounts]);
  const trend = useMemo(
    () => buildBalanceTrend(accounts, operations, period),
    [accounts, operations, period]
  );
  const recentOperations = useMemo(
    () =>
      [...operations]
        .sort((left, right) => operationTime(right).getTime() - operationTime(left).getTime())
        .slice(0, 4),
    [operations]
  );
  const attentionRows = useMemo(
    () => [
      {
        label: `${operations.filter((row) => row.status === 'PROCESSING').length} 笔处理中`,
        hint: '资金指令正在执行',
        icon: 'solar:clock-circle-bold-duotone',
        color: '#A5701B',
        background: '#FBF2DE',
      },
      {
        label: `${operations.filter((row) => row.status === 'SUBMITTED').length} 笔审核中`,
        hint: '付款申请已提交',
        icon: 'solar:document-text-bold-duotone',
        color: '#356DBD',
        background: '#EAF0FB',
      },
      {
        label: `${
          operations.filter((row) => row.status === 'REJECTED' || row.status === 'FAILED').length
        } 笔未通过`,
        hint: '查看原因并更新资料',
        icon: 'solar:danger-circle-bold-duotone',
        color: '#B44A58',
        background: '#F9E9EC',
      },
    ],
    [operations]
  );

  const quickActions = [
    {
      label: '转入',
      hint: '查看收款信息',
      path: '/portal/money/deposit',
      icon: ACTION_ICONS.fundsIn,
      color: '#16876A',
      background: '#E7F5F0',
    },
    {
      label: '付款',
      hint: '银行或链上转出',
      path: '/portal/money/payouts',
      icon: ACTION_ICONS.fundsOut,
      color: '#3267C8',
      background: '#EAF0FC',
    },
    {
      label: '兑换',
      hint: '法币与 USDT',
      path: '/portal/money/otc',
      icon: ACTION_ICONS.otc,
      color: '#7654C5',
      background: '#F1EDFB',
    },
  ] as const;

  const chartOptions = useChart({
    colors: DISPLAY_CURRENCIES.map((currency) => TREND_COLORS[currency]),
    chart: { animations: { enabled: true, speed: 320 } },
    stroke: { curve: 'smooth', width: 2.5 },
    labels: trend.map((point) => point.label),
    xaxis: {
      type: 'category',
      tickAmount: period === 7 ? 6 : 7,
      labels: { rotate: 0, hideOverlappingLabels: true },
    },
    yaxis: {
      show: false,
      min: (value) => Math.floor(value - 2),
      max: (value) => Math.ceil(value + 2),
    },
    grid: { borderColor: '#E9EDF2', strokeDashArray: 0, padding: { left: 8, right: 8 } },
    legend: { show: false },
    tooltip: {
      shared: true,
      intersect: false,
      y: {
        formatter: (_value, context) => {
          const currency = DISPLAY_CURRENCIES[context.seriesIndex];
          const point = trend[context.dataPointIndex];
          return point ? money(point.actual[currency], currency) : '—';
        },
      },
    },
  });

  return (
    <>
      <Helmet>
        <title>账户概览 | {APP_DISPLAY_NAME}</title>
      </Helmet>
      <Container maxWidth="xl">
        <Stack spacing={2.5}>
          {backendStarting && (
            <Alert severity="info">后台服务正在启动，账户数据将在连接就绪后自动显示。</Alert>
          )}
          {error && (
            <Alert
              severity={assetSummary ? 'warning' : 'error'}
              action={
                <Button
                  color="inherit"
                  size="small"
                  onClick={() => refresh().catch(() => undefined)}
                >
                  刷新数据
                </Button>
              }
            >
              {error}
            </Alert>
          )}

          {assetSummaryUsesCachedRates && (
            <Alert
              severity="warning"
              action={
                <Button
                  color="inherit"
                  size="small"
                  onClick={() => refresh().catch(() => undefined)}
                >
                  刷新汇率
                </Button>
              }
            >
              {assetSummaryRateCurrencies.length
                ? `实时汇率暂未更新，${assetSummaryRateCurrencies.join(
                    '、'
                  )} 正按最近一次有效汇率显示${
                    cachedRatesAsOf ? `（截至 ${cachedRatesAsOf}）` : ''
                  }。`
                : '部分汇率暂不可用；当前仅显示无需折算或已有有效汇率的资产。'}
            </Alert>
          )}

          <Stack direction="row" justifyContent="space-between" alignItems="flex-start" gap={2}>
            <Box>
              <Stack direction="row" alignItems="center" spacing={1}>
                <Typography variant="h4">您好，{firstName || '欢迎回来'}</Typography>
                {customer && (
                  <Chip
                    size="small"
                    label={customer.type === 'BUSINESS' ? '企业账户' : '个人账户'}
                  />
                )}
              </Stack>
              <Typography color="text.secondary" sx={{ mt: 0.6 }}>
                查看您的可用资金、近期资金变动和交易进度。
              </Typography>
            </Box>
            <Stack
              direction="row"
              spacing={0.75}
              alignItems="center"
              color="text.secondary"
              sx={{ display: { xs: 'none', md: 'flex' }, pt: 0.5 }}
            >
              <Iconify icon="solar:calendar-linear" width={18} />
              <Typography variant="body2">
                {new Intl.DateTimeFormat('zh-CN', {
                  year: 'numeric',
                  month: 'long',
                  day: 'numeric',
                }).format(new Date())}
              </Typography>
            </Stack>
          </Stack>

          <Box
            sx={{
              display: 'grid',
              gridTemplateColumns: { xs: '1fr', md: 'repeat(3, minmax(0, 1fr))' },
              gap: 1.5,
            }}
          >
            {DISPLAY_CURRENCIES.map((currency) => (
              <BalanceCard
                key={currency}
                currency={currency}
                balance={balances[currency]}
                loading={loading}
                onClick={() => navigate('/portal/money/accounts')}
              />
            ))}
          </Box>

          {assetSummary?.valuationStatus === 'partial' && (
            <Stack direction="row" spacing={0.75} alignItems="center" color="warning.dark">
              <Iconify icon="solar:info-circle-linear" width={18} />
              <Typography variant="caption">
                跨币种总额暂不显示；以下币种缺少有效估值汇率：
                {assetSummary.missingRates.join('、') || '部分币种'}
              </Typography>
            </Stack>
          )}

          <Box
            sx={{
              display: 'grid',
              gridTemplateColumns: {
                xs: '1fr',
                lg: 'minmax(0, 2fr) minmax(300px, .92fr)',
              },
              gap: 2.25,
              alignItems: 'stretch',
            }}
          >
            <Card variant="outlined" sx={{ boxShadow: 'none', minWidth: 0 }}>
              <CardContent sx={{ p: { xs: 2, sm: 2.75 }, '&:last-child': { pb: 2.25 } }}>
                <Stack
                  direction={{ xs: 'column', sm: 'row' }}
                  justifyContent="space-between"
                  alignItems={{ sm: 'center' }}
                  spacing={1.5}
                >
                  <Box>
                    <Typography variant="overline" color="text.secondary">
                      资金动态
                    </Typography>
                    <Stack direction="row" spacing={1} alignItems="center">
                      <Typography variant="h5">多币种资金走势</Typography>
                      <Typography variant="caption" color="success.main">
                        已更新
                      </Typography>
                    </Stack>
                    <Typography variant="caption" color="text.secondary">
                      基于可见的已完成交易估算，按变化幅度对比；悬停查看原币余额
                    </Typography>
                  </Box>
                  <Box
                    role="group"
                    aria-label="选择资金走势时间范围"
                    sx={{
                      display: 'flex',
                      p: 0.4,
                      bgcolor: 'background.neutral',
                      borderRadius: 1.25,
                    }}
                  >
                    {PERIODS.map((value) => (
                      <ButtonBase
                        key={value}
                        aria-pressed={period === value}
                        onClick={() => setPeriod(value)}
                        sx={{
                          minWidth: 48,
                          height: 30,
                          borderRadius: 1,
                          typography: 'caption',
                          fontWeight: period === value ? 700 : 500,
                          color: period === value ? 'text.primary' : 'text.secondary',
                          bgcolor: period === value ? 'background.paper' : 'transparent',
                          boxShadow: period === value ? '0 1px 4px rgba(16,24,40,.10)' : 'none',
                        }}
                      >
                        {value}天
                      </ButtonBase>
                    ))}
                  </Box>
                </Stack>
                <Stack
                  direction="row"
                  justifyContent={{ xs: 'flex-start', sm: 'flex-end' }}
                  spacing={1.75}
                  sx={{ mt: 1.5 }}
                >
                  {DISPLAY_CURRENCIES.map((currency) => (
                    <Stack key={currency} direction="row" spacing={0.65} alignItems="center">
                      <AssetIcon
                        asset={currency}
                        network={currency === 'USDT' ? 'TRON' : undefined}
                        size={18}
                      />
                      <Typography
                        variant="caption"
                        sx={{ color: TREND_COLORS[currency], fontWeight: 700 }}
                      >
                        {currency}
                      </Typography>
                    </Stack>
                  ))}
                </Stack>
                <Box sx={{ mt: 1, ml: { xs: -1.5, sm: -0.5 } }}>
                  <Chart
                    type="line"
                    height={330}
                    options={chartOptions}
                    series={DISPLAY_CURRENCIES.map((currency) => ({
                      name: currency,
                      data: trend.map((point) => point.normalized[currency]),
                    }))}
                  />
                </Box>
              </CardContent>
            </Card>

            <Stack spacing={2.25}>
              <Card variant="outlined" sx={{ boxShadow: 'none' }}>
                <CardContent sx={{ p: 2.5 }}>
                  <Stack direction="row" justifyContent="space-between" alignItems="center">
                    <Box>
                      <Typography variant="overline" color="text.secondary">
                        常用服务
                      </Typography>
                      <Typography variant="h5">收付与兑换</Typography>
                    </Box>
                    <Button size="small" onClick={() => navigate('/portal/money')}>
                      全部
                    </Button>
                  </Stack>
                  <Box
                    sx={{
                      mt: 2,
                      display: 'grid',
                      gridTemplateColumns: {
                        xs: '1fr',
                        sm: 'repeat(2, minmax(0, 1fr))',
                      },
                      gap: 1.1,
                    }}
                  >
                    {quickActions.map((action) => (
                      <ActionCard
                        key={action.path}
                        action={action}
                        onClick={() => navigate(action.path)}
                      />
                    ))}
                  </Box>
                </CardContent>
              </Card>

              <Card variant="outlined" sx={{ boxShadow: 'none', flex: 1 }}>
                <CardContent sx={{ p: 2.5 }}>
                  <Stack direction="row" justifyContent="space-between" alignItems="center">
                    <Box>
                      <Typography variant="overline" color="text.secondary">
                        我的交易进度
                      </Typography>
                      <Typography variant="h5">需要关注</Typography>
                    </Box>
                    <Button size="small" onClick={() => navigate('/portal/transactions')}>
                      查看
                    </Button>
                  </Stack>
                  <Stack divider={<Divider flexItem />} sx={{ mt: 1.5 }}>
                    {attentionRows.map((row) => (
                      <ButtonBase
                        key={row.label}
                        onClick={() => navigate('/portal/transactions')}
                        sx={{
                          width: '100%',
                          py: 1.25,
                          textAlign: 'left',
                          justifyContent: 'flex-start',
                        }}
                      >
                        <Box
                          sx={{
                            width: 34,
                            height: 34,
                            borderRadius: 1.25,
                            display: 'grid',
                            placeItems: 'center',
                            color: row.color,
                            bgcolor: row.background,
                            flexShrink: 0,
                          }}
                        >
                          <Iconify icon={row.icon} width={19} />
                        </Box>
                        <Box sx={{ ml: 1.25, flex: 1, minWidth: 0 }}>
                          <Typography variant="subtitle2">{row.label}</Typography>
                          <Typography variant="caption" color="text.secondary">
                            {row.hint}
                          </Typography>
                        </Box>
                        <Iconify
                          icon="solar:alt-arrow-right-linear"
                          width={17}
                          color="text.disabled"
                        />
                      </ButtonBase>
                    ))}
                  </Stack>
                </CardContent>
              </Card>
            </Stack>
          </Box>

          <Card variant="outlined" sx={{ boxShadow: 'none' }}>
            <CardContent sx={{ p: 0 }}>
              <Stack
                direction="row"
                justifyContent="space-between"
                alignItems="center"
                sx={{ px: { xs: 2, sm: 2.75 }, py: 2.25 }}
              >
                <Box>
                  <Typography variant="overline" color="text.secondary">
                    最近交易
                  </Typography>
                  <Typography variant="h5">最近资金变动</Typography>
                </Box>
                <Button onClick={() => navigate('/portal/transactions')}>查看全部</Button>
              </Stack>
              <Divider />
              {recentOperations.map((operation, index) => (
                <RecentOperationRow
                  key={operation.id}
                  operation={operation}
                  divider={index < recentOperations.length - 1}
                  onClick={() => navigate('/portal/transactions')}
                />
              ))}
              {!recentOperations.length && !loading && (
                <Typography color="text.secondary" align="center" sx={{ py: 6 }}>
                  暂无交易记录
                </Typography>
              )}
              {loading && (
                <Stack spacing={1.5} sx={{ p: 2.5 }}>
                  <Skeleton height={44} />
                  <Skeleton height={44} />
                </Stack>
              )}
            </CardContent>
          </Card>
        </Stack>
      </Container>
    </>
  );
}

function BalanceCard({
  currency,
  balance,
  loading,
  onClick,
}: {
  currency: DisplayCurrency;
  balance: { available: number; frozen: number };
  loading: boolean;
  onClick: () => void;
}) {
  return (
    <ButtonBase
      onClick={onClick}
      sx={{
        minHeight: 96,
        p: 2.25,
        bgcolor: 'background.paper',
        border: '1px solid',
        borderColor: 'divider',
        borderRadius: 2,
        textAlign: 'left',
        justifyContent: 'flex-start',
        transition: 'border-color 160ms ease-out, transform 160ms ease-out',
        '&:hover': { borderColor: TREND_COLORS[currency], transform: 'translateY(-1px)' },
        '&:focus-visible': {
          outline: '2px solid',
          outlineColor: 'primary.main',
          outlineOffset: 2,
        },
      }}
    >
      <Box
        sx={{
          width: 38,
          height: 38,
          borderRadius: '50%',
          bgcolor: 'background.neutral',
          display: 'grid',
          placeItems: 'center',
          flexShrink: 0,
        }}
      >
        <AssetIcon asset={currency} network={currency === 'USDT' ? 'TRON' : undefined} size={28} />
      </Box>
      <Box sx={{ ml: 1.6, minWidth: 0 }}>
        <Typography variant="caption" color="text.secondary">
          {currency} 可用余额
        </Typography>
        {loading ? (
          <Skeleton width={150} height={31} />
        ) : (
          <Typography variant="h5" noWrap sx={{ fontVariantNumeric: 'tabular-nums' }}>
            {money(balance.available, currency)}
          </Typography>
        )}
        <Typography
          variant="caption"
          color={balance.frozen > 0 ? 'warning.main' : 'text.secondary'}
        >
          {balance.frozen > 0 ? `冻结 ${money(balance.frozen, currency)}` : '无冻结资金'}
        </Typography>
      </Box>
    </ButtonBase>
  );
}

function ActionCard({
  action,
  onClick,
}: {
  action: { label: string; hint: string; icon: string; color: string; background: string };
  onClick: () => void;
}) {
  return (
    <ButtonBase
      onClick={onClick}
      sx={{
        minHeight: 68,
        p: 1.25,
        border: '1px solid',
        borderColor: 'divider',
        borderRadius: 1.5,
        justifyContent: 'flex-start',
        textAlign: 'left',
        '&:hover': { bgcolor: 'action.hover', borderColor: action.color },
        '&:focus-visible': {
          outline: '2px solid',
          outlineColor: 'primary.main',
          outlineOffset: 2,
        },
      }}
    >
      <Box
        sx={{
          width: 36,
          height: 36,
          borderRadius: 1.25,
          display: 'grid',
          placeItems: 'center',
          bgcolor: action.background,
          color: action.color,
          flexShrink: 0,
        }}
      >
        <Iconify icon={action.icon} width={21} />
      </Box>
      <Box sx={{ ml: 1.15, flex: 1, minWidth: 0 }}>
        <Typography variant="subtitle2">{action.label}</Typography>
        <Typography variant="caption" color="text.secondary" noWrap>
          {action.hint}
        </Typography>
      </Box>
      <Iconify icon="solar:alt-arrow-right-linear" width={16} color="text.disabled" />
    </ButtonBase>
  );
}

function RecentOperationRow({
  operation,
  divider,
  onClick,
}: {
  operation: Operation;
  divider: boolean;
  onClick: () => void;
}) {
  const incoming = operation.type === 'DEPOSIT';
  return (
    <ButtonBase
      onClick={onClick}
      sx={{
        width: '100%',
        display: 'grid',
        gridTemplateColumns: {
          xs: 'auto minmax(0, 1fr) auto',
          md: 'auto 1.5fr 1fr .85fr auto',
        },
        alignItems: 'center',
        gap: 1.5,
        px: { xs: 2, sm: 2.75 },
        py: 1.45,
        textAlign: 'left',
        borderBottom: divider ? '1px solid' : 0,
        borderColor: 'divider',
        '&:hover': { bgcolor: 'action.hover' },
      }}
    >
      <Box
        sx={{
          width: 36,
          height: 36,
          borderRadius: '50%',
          display: 'grid',
          placeItems: 'center',
          bgcolor: incoming ? 'success.lighter' : 'background.neutral',
          color: incoming ? 'success.main' : 'text.secondary',
        }}
      >
        <Iconify
          icon={
            incoming
              ? 'solar:download-minimalistic-bold-duotone'
              : 'solar:upload-minimalistic-bold-duotone'
          }
          width={20}
        />
      </Box>
      <Box sx={{ minWidth: 0 }}>
        <Typography variant="subtitle2">{operationTypeLabel(operation.type)}</Typography>
        <Typography variant="caption" color="text.secondary" noWrap sx={{ display: 'block' }}>
          {operation.narrative || operation.reference}
        </Typography>
      </Box>
      <Box sx={{ display: { xs: 'none', md: 'block' } }}>
        <Typography variant="caption" color="text.secondary">
          {operation.reference}
        </Typography>
        <Typography variant="caption" color="text.secondary" display="block">
          {formatOperationTime(operation)}
        </Typography>
      </Box>
      <Box sx={{ textAlign: 'right' }}>
        <Typography variant="subtitle2" sx={{ fontVariantNumeric: 'tabular-nums' }}>
          {incoming ? '+' : '-'}
          {money(operation.amount, operation.currency)}
        </Typography>
        <OperationStatus status={operation.status} />
      </Box>
      <Iconify
        icon="solar:alt-arrow-right-linear"
        width={17}
        sx={{ display: { xs: 'none', md: 'block' }, color: 'text.disabled' }}
      />
    </ButtonBase>
  );
}

function aggregateBalances(accounts: MoneyAccount[]) {
  return DISPLAY_CURRENCIES.reduce(
    (result, currency) => {
      const matching = accounts.filter((account) => account.currency === currency);
      result[currency] = {
        available: matching.reduce(
          (sum, account) => sum + Number(account.availableBalance || 0),
          0
        ),
        frozen: matching.reduce((sum, account) => sum + Number(account.frozenBalance || 0), 0),
      };
      return result;
    },
    {} as Record<DisplayCurrency, { available: number; frozen: number }>
  );
}

function buildBalanceTrend(accounts: MoneyAccount[], operations: Operation[], days: Period) {
  const current = aggregateBalances(accounts);
  const now = new Date();
  const points = Array.from({ length: days }, (_, index) => {
    const date = new Date(now);
    date.setHours(23, 59, 59, 999);
    date.setDate(now.getDate() - (days - index - 1));
    return date;
  });
  const completed = operations.filter((operation) => operation.status === 'COMPLETED');
  const actualRows = points.map((date) => {
    const movementsAfter = emptyCurrencyValues();
    completed.forEach((operation) => {
      if (operationTime(operation) > date) applyOperationMovement(movementsAfter, operation);
    });
    const actual = emptyCurrencyValues();
    DISPLAY_CURRENCIES.forEach((currency) => {
      actual[currency] = current[currency].available - movementsAfter[currency];
    });
    return actual;
  });
  const first = actualRows[0] || emptyCurrencyValues();
  return points.map((date, index) => {
    const normalized = emptyCurrencyValues();
    DISPLAY_CURRENCIES.forEach((currency) => {
      const baseline = first[currency];
      const scale = Math.max(Math.abs(baseline), Math.abs(current[currency].available), 1);
      normalized[currency] = Number(
        (100 + ((actualRows[index][currency] - baseline) / scale) * 100).toFixed(3)
      );
    });
    return {
      label: new Intl.DateTimeFormat('zh-CN', { month: 'numeric', day: 'numeric' }).format(date),
      actual: actualRows[index],
      normalized,
    };
  });
}

function emptyCurrencyValues(): Record<DisplayCurrency, number> {
  return { USD: 0, HKD: 0, USDT: 0 };
}

function applyOperationMovement(movement: Record<DisplayCurrency, number>, operation: Operation) {
  const currency = operation.currency as DisplayCurrency;
  if (!DISPLAY_CURRENCIES.includes(currency)) return;
  if (operation.type === 'DEPOSIT') movement[currency] += Number(operation.amount || 0);
  if (operation.type === 'PAYOUT') {
    movement[currency] -= Number(operation.amount || 0) + Number(operation.feeAmount || 0);
  }
  if ((operation.type === 'FX' || operation.type === 'OTC') && operation.quoteCurrency) {
    movement[currency] -= Number(operation.amount || 0);
    const quoteCurrency = operation.quoteCurrency as DisplayCurrency;
    if (DISPLAY_CURRENCIES.includes(quoteCurrency)) {
      movement[quoteCurrency] += Number(operation.quoteAmount || 0);
    }
  }
}

function operationTime(operation: Operation) {
  return new Date(
    operation.executedAt || operation.approvedAt || operation.submittedAt || operation.createdAt
  );
}

function formatOperationTime(operation: Operation) {
  return new Intl.DateTimeFormat('zh-CN', {
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(operationTime(operation));
}

function operationTypeLabel(type: Operation['type']) {
  const labels: Record<Operation['type'], string> = {
    DEPOSIT: '法币转入',
    PAYOUT: '付款',
    ADJUSTMENT: '余额调整',
    INTERNAL_TRANSFER: '账户划转',
    FX: '换汇',
    OTC: 'OTC 兑换',
  };
  return labels[type];
}
