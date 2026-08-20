import { useCallback, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { Helmet } from 'react-helmet-async';
import { useNavigate } from 'react-router-dom';
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
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
  ToggleButton,
  ToggleButtonGroup,
  Typography,
} from '@mui/material';
import { alpha, useTheme } from '@mui/material/styles';
import AssetIcon from 'src/components/asset-icon';
import Chart, { useChart } from 'src/components/chart';
import Iconify from 'src/components/iconify';
import Label from 'src/components/label';
import UiIconBadge from 'src/components/ui-icon-badge';
import {
  coreApi,
  Customer,
  demoOrganizationId,
  JournalEntry,
  Operation,
  VirtualAccountRequest,
} from 'src/features/finance/core-api';
import {
  buildOverviewAnalytics,
  OverviewAccountKind,
  OverviewAsset,
  OVERVIEW_ASSETS,
} from 'src/features/finance/overview-analytics';
import { paths } from 'src/routes/paths';
import { ACTION_ICONS, ICON_SIZES, UI_ICONS } from 'src/theme/iconography';

const ASSET_COLORS: Record<OverviewAsset, string> = {
  USD: '#2563EB',
  HKD: '#D9465F',
  USDT: '#26A17B',
};

const PRODUCT_LABELS: Record<OverviewAccountKind, string> = {
  SYSTEM_WALLET: '系统钱包',
  VIRTUAL_ACCOUNT: 'VA 钱包',
  CRYPTO_WALLET: '数字货币钱包',
};

const OPERATION_LABELS: Record<Operation['type'], string> = {
  DEPOSIT: '入账',
  PAYOUT: '出款',
  ADJUSTMENT: '调账',
  INTERNAL_TRANSFER: '内部划转',
  FX: '法币换汇',
  OTC: '自动兑换',
};

const STATUS_LABELS: Record<Operation['status'], string> = {
  DRAFT: '草稿',
  SUBMITTED: '待审批',
  APPROVED: '已批准',
  REJECTED: '已拒绝',
  PROCESSING: '执行中',
  COMPLETED: '已完成',
  FAILED: '失败',
  CANCELLED: '已取消',
};

const STATUS_COLOR: Record<
  Operation['status'],
  'default' | 'info' | 'warning' | 'success' | 'error'
> = {
  DRAFT: 'default',
  SUBMITTED: 'warning',
  APPROVED: 'info',
  REJECTED: 'error',
  PROCESSING: 'info',
  COMPLETED: 'success',
  FAILED: 'error',
  CANCELLED: 'default',
};

function formatAmount(value: number, asset: OverviewAsset) {
  return value.toLocaleString('zh-CN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: asset === 'USDT' ? 6 : 2,
  });
}

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Hong_Kong',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date(value));
}

function operationTime(operation: Operation) {
  return operation.executedAt || operation.submittedAt || operation.createdAt;
}

export default function CoreOverview({ portal = false }: { portal?: boolean }) {
  const theme = useTheme();
  const navigate = useNavigate();
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [operations, setOperations] = useState<Operation[]>([]);
  const [vaRequests, setVaRequests] = useState<VirtualAccountRequest[]>([]);
  const [journals, setJournals] = useState<JournalEntry[]>([]);
  const [selectedAsset, setSelectedAsset] = useState<OverviewAsset>('USD');
  const [snapshotAt, setSnapshotAt] = useState(new Date());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [customerRows, operationRows, vaRequestRows, journalRows] = await Promise.all([
        coreApi<Customer[]>(`/customers?organizationId=${demoOrganizationId}`, {
          userId: 'usr_admin',
        }),
        coreApi<Operation[]>(`/operations?organizationId=${demoOrganizationId}`, {
          userId: 'usr_admin',
        }),
        coreApi<VirtualAccountRequest[]>(
          `/virtual-account-requests?organizationId=${demoOrganizationId}`,
          { userId: 'usr_admin' }
        ),
        coreApi<JournalEntry[]>(`/ledger?organizationId=${demoOrganizationId}`, {
          userId: 'usr_admin',
        }),
      ]);
      setCustomers(customerRows);
      setOperations(operationRows);
      setVaRequests(vaRequestRows);
      setJournals(journalRows);
      setSnapshotAt(new Date());
    } catch (value) {
      setError(value instanceof Error ? value.message : '无法读取运营数据');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const analytics = useMemo(
    () => buildOverviewAnalytics({ customers, operations, vaRequests, journals, now: snapshotAt }),
    [customers, journals, operations, snapshotAt, vaRequests]
  );
  const selectedFund = analytics.funds.find((fund) => fund.asset === selectedAsset)!;
  const selectedTrend = analytics.trendByAsset[selectedAsset];
  const trendHasData = selectedTrend.some((point) => point.inflow || point.outflow);
  const productHasData = selectedFund.products.some((product) => product.total > 0);

  const trendOptions = useChart({
    chart: { toolbar: { show: false }, zoom: { enabled: false } },
    colors: [theme.palette.success.main, theme.palette.error.main],
    stroke: { width: 3, curve: 'smooth' },
    fill: {
      type: 'gradient',
      gradient: { opacityFrom: 0.22, opacityTo: 0.02, stops: [0, 95, 100] },
    },
    dataLabels: { enabled: false },
    grid: { borderColor: alpha(theme.palette.grey[500], 0.16), strokeDashArray: 3 },
    xaxis: {
      categories: selectedTrend.map((point) => point.date.slice(5).replace('-', '/')),
    },
    yaxis: {
      labels: {
        formatter: (value: number) =>
          Intl.NumberFormat('zh-CN', { notation: 'compact', maximumFractionDigits: 1 }).format(
            value
          ),
      },
    },
    tooltip: {
      y: { formatter: (value: number) => `${formatAmount(value, selectedAsset)} ${selectedAsset}` },
    },
    legend: { position: 'top', horizontalAlign: 'right' },
  });

  const productOptions = useChart({
    labels: selectedFund.products.map((product) => PRODUCT_LABELS[product.kind]),
    colors: [ASSET_COLORS[selectedAsset], theme.palette.info.main, theme.palette.warning.main],
    stroke: { colors: [theme.palette.background.paper], width: 3 },
    dataLabels: { enabled: false },
    legend: { show: false },
    tooltip: {
      y: { formatter: (value: number) => `${formatAmount(value, selectedAsset)} ${selectedAsset}` },
    },
    plotOptions: { pie: { donut: { size: '72%', labels: { show: false } } } },
  });

  const mixOptions = useChart({
    chart: { toolbar: { show: false } },
    colors: [theme.palette.info.main],
    xaxis: {
      categories: analytics.operationMix.map((item) => OPERATION_LABELS[item.type]),
      labels: { formatter: (value: string) => `${value} 笔` },
    },
    plotOptions: { bar: { horizontal: true, borderRadius: 5, barHeight: '48%' } },
    dataLabels: { enabled: false },
    grid: { borderColor: alpha(theme.palette.grey[500], 0.16), strokeDashArray: 3 },
  });

  const root = portal ? '/portal' : '/dashboard';
  const adminTransactionsByStatus = (status: string) =>
    `${paths.dashboard.fundOperations.transactions}?status=${status}`;
  const quickActions = portal
    ? [
        ['客户开户', `${root}/onboarding`, ACTION_ICONS.onboarding, 'info.main'],
        ['钱包与 VA', `${root}/money/accounts`, ACTION_ICONS.accounts, 'success.main'],
        ['内部转账', `${root}/money/transfers`, ACTION_ICONS.internalTransfer, 'warning.main'],
        ['发起出款', `${root}/money/payouts`, ACTION_ICONS.fundsOut, 'error.main'],
      ]
    : [
        ['开户与 KYC', paths.dashboard.onboarding, ACTION_ICONS.onboarding, 'info.main'],
        ['入账处理', paths.dashboard.fundOperations.deposits, ACTION_ICONS.fundsIn, 'success.main'],
        [
          '待处理业务',
          adminTransactionsByStatus('SUBMITTED'),
          'solar:clipboard-check-bold-duotone',
          'warning.main',
        ],
        [
          '资金对账',
          paths.dashboard.fundOperations.reconciliation,
          ACTION_ICONS.history,
          'primary.main',
        ],
      ];

  return (
    <>
      <Helmet>
        <title>运营总览 | SSC Digital Bank</title>
      </Helmet>
      <Container maxWidth="xl">
        <Stack spacing={3.5}>
          <Stack
            direction={{ xs: 'column', sm: 'row' }}
            alignItems={{ sm: 'flex-end' }}
            justifyContent="space-between"
            spacing={2}
          >
            <Box>
              <Typography variant="h4">运营总览</Typography>
              <Typography color="text.secondary" sx={{ mt: 0.75, maxWidth: 760 }}>
                从真实账户与账本快照查看资金位置、近 7 日流动、业务分布和当前运营待办。
              </Typography>
            </Box>
            <Stack direction="row" spacing={1.5} alignItems="center">
              <Typography variant="caption" color="text.secondary">
                快照 {formatDateTime(analytics.snapshotAt)}
              </Typography>
              <Button
                variant="outlined"
                color="inherit"
                startIcon={
                  loading ? <CircularProgress size={16} /> : <Iconify icon={ACTION_ICONS.refresh} />
                }
                disabled={loading}
                onClick={load}
              >
                刷新数据
              </Button>
            </Stack>
          </Stack>

          {error && (
            <Alert
              severity="error"
              action={
                <Button color="inherit" size="small" onClick={load}>
                  重新加载
                </Button>
              }
            >
              运营数据加载失败：{error}
            </Alert>
          )}

          {loading && !customers.length && !error && (
            <Alert severity="info" icon={<CircularProgress size={20} />}>
              正在汇总账户、账本和运营队列数据…
            </Alert>
          )}

          <Card variant="outlined" sx={{ boxShadow: 'none' }}>
            <Box
              sx={{
                display: 'grid',
                gridTemplateColumns: {
                  xs: 'repeat(2, minmax(0, 1fr))',
                  md: 'repeat(4, minmax(0, 1fr))',
                },
              }}
            >
              <SummaryMetric
                label="已开户客户"
                value={analytics.customers.active}
                helper={`全部客户 ${analytics.customers.total}`}
                icon={ACTION_ICONS.customers}
                color="info"
              />
              <SummaryMetric
                label="需要处理"
                value={analytics.queue.total}
                helper="KYC、VA、审批与执行"
                icon={ACTION_ICONS.notifications}
                color={analytics.queue.total ? 'warning' : 'success'}
              />
              <SummaryMetric
                label="今日完成"
                value={analytics.completedToday}
                helper="已写入账本的业务"
                icon="solar:checklist-minimalistic-bold-duotone"
                color="success"
              />
              <SummaryMetric
                label="失败异常"
                value={analytics.queue.failed}
                helper={analytics.queue.failed ? '需要人工核对' : '当前没有失败业务'}
                icon="solar:shield-warning-bold-duotone"
                color={analytics.queue.failed ? 'error' : 'success'}
                last
              />
            </Box>
          </Card>

          <Box>
            <SectionHeading
              eyebrow="FUNDS"
              title="资金快照"
              description="按币种独立展示可用与冻结金额；不同币种不合并为总额。"
              action={
                <Button onClick={() => navigate(paths.dashboard.accounts)}>查看客户账户</Button>
              }
            />
            <Box
              sx={{
                mt: 2,
                display: 'grid',
                gridTemplateColumns: { xs: '1fr', md: 'repeat(3, minmax(0, 1fr))' },
                gap: 2,
              }}
            >
              {analytics.funds.map((fund) => (
                <FundCard
                  key={fund.asset}
                  fund={fund}
                  selected={selectedAsset === fund.asset}
                  onSelect={() => setSelectedAsset(fund.asset)}
                />
              ))}
            </Box>
          </Box>

          <Box
            sx={{
              display: 'grid',
              gridTemplateColumns: { xs: '1fr', lg: 'minmax(0, 1.7fr) minmax(320px, 0.8fr)' },
              gap: 3,
            }}
          >
            <Card variant="outlined" sx={{ boxShadow: 'none', minWidth: 0 }}>
              <CardContent sx={{ p: { xs: 2.5, md: 3 } }}>
                <Stack
                  direction={{ xs: 'column', sm: 'row' }}
                  justifyContent="space-between"
                  spacing={2}
                  sx={{ mb: 1 }}
                >
                  <Box>
                    <Typography variant="h6">近 7 日资金流动</Typography>
                    <Typography variant="body2" color="text.secondary" sx={{ mt: 0.4 }}>
                      来自客户账户侧账本分录；内部划转不计入流入或流出。
                    </Typography>
                  </Box>
                  <AssetToggle value={selectedAsset} onChange={setSelectedAsset} />
                </Stack>
                {trendHasData ? (
                  <Chart
                    type="area"
                    height={340}
                    options={trendOptions}
                    series={[
                      { name: '流入', data: selectedTrend.map((point) => point.inflow) },
                      { name: '流出', data: selectedTrend.map((point) => point.outflow) },
                    ]}
                  />
                ) : (
                  <ChartEmptyState message={`近 7 日没有 ${selectedAsset} 账本流动`} />
                )}
              </CardContent>
            </Card>

            <Card variant="outlined" sx={{ boxShadow: 'none', minWidth: 0 }}>
              <CardContent sx={{ p: { xs: 2.5, md: 3 } }}>
                <Typography variant="h6">资金承载分布</Typography>
                <Typography variant="body2" color="text.secondary" sx={{ mt: 0.4 }}>
                  {selectedAsset} 当前账面金额按账户产品分布
                </Typography>
                {productHasData ? (
                  <>
                    <Chart
                      type="donut"
                      height={270}
                      options={productOptions}
                      series={selectedFund.products.map((product) => product.total)}
                    />
                    <Stack divider={<Divider flexItem />}>
                      {selectedFund.products.map((product) => (
                        <Stack
                          key={product.kind}
                          direction="row"
                          justifyContent="space-between"
                          spacing={2}
                          sx={{ py: 1 }}
                        >
                          <Typography variant="body2" color="text.secondary">
                            {PRODUCT_LABELS[product.kind]} · {product.accountCount} 个账户
                          </Typography>
                          <Typography
                            variant="subtitle2"
                            sx={{ fontVariantNumeric: 'tabular-nums' }}
                          >
                            {formatAmount(product.total, selectedAsset)}
                          </Typography>
                        </Stack>
                      ))}
                    </Stack>
                  </>
                ) : (
                  <ChartEmptyState message={`暂无 ${selectedAsset} 账户余额`} />
                )}
              </CardContent>
            </Card>
          </Box>

          <Box
            sx={{
              display: 'grid',
              gridTemplateColumns: { xs: '1fr', lg: 'minmax(0, 1.15fr) minmax(340px, 0.85fr)' },
              gap: 3,
            }}
          >
            <Card variant="outlined" sx={{ boxShadow: 'none', minWidth: 0 }}>
              <CardContent sx={{ p: { xs: 2.5, md: 3 } }}>
                <Typography variant="h6">近 30 日业务分布</Typography>
                <Typography variant="body2" color="text.secondary" sx={{ mt: 0.4 }}>
                  按业务记录类型统计笔数，用于观察运营负载结构。
                </Typography>
                {analytics.operationMix.length ? (
                  <Chart
                    type="bar"
                    height={310}
                    options={mixOptions}
                    series={[
                      { name: '业务笔数', data: analytics.operationMix.map((item) => item.count) },
                    ]}
                  />
                ) : (
                  <ChartEmptyState message="近 30 日没有业务记录" />
                )}
              </CardContent>
            </Card>

            <Card variant="outlined" sx={{ boxShadow: 'none' }}>
              <CardContent sx={{ p: { xs: 2.5, md: 3 } }}>
                <Stack direction="row" justifyContent="space-between" alignItems="center">
                  <Box>
                    <Typography variant="h6">运营待办</Typography>
                    <Typography variant="body2" color="text.secondary" sx={{ mt: 0.4 }}>
                      只显示需要人工跟进的当前状态
                    </Typography>
                  </Box>
                  <Label color={analytics.queue.total ? 'warning' : 'success'}>
                    {analytics.queue.total} 项
                  </Label>
                </Stack>
                <Stack divider={<Divider flexItem />} sx={{ mt: 1.5 }}>
                  <QueueRow
                    label="KYC 待审核"
                    value={analytics.queue.kyc}
                    icon={ACTION_ICONS.onboarding}
                    onClick={() => navigate(paths.dashboard.onboarding)}
                  />
                  <QueueRow
                    label="VA 待处理"
                    value={analytics.queue.va}
                    icon="solar:buildings-2-bold-duotone"
                    onClick={() => navigate(paths.dashboard.fundOperations.virtualAccounts)}
                  />
                  <QueueRow
                    label="业务待处理"
                    value={analytics.queue.approvals}
                    icon="solar:clipboard-check-bold-duotone"
                    onClick={() => navigate(adminTransactionsByStatus('SUBMITTED'))}
                  />
                  <QueueRow
                    label="执行中"
                    value={analytics.queue.execution}
                    icon="solar:hourglass-line-bold-duotone"
                    onClick={() => navigate(adminTransactionsByStatus('PROCESSING'))}
                  />
                  <QueueRow
                    label="失败异常"
                    value={analytics.queue.failed}
                    icon="solar:shield-warning-bold-duotone"
                    onClick={() => navigate(adminTransactionsByStatus('FAILED'))}
                  />
                </Stack>
              </CardContent>
            </Card>
          </Box>

          <Card variant="outlined" sx={{ boxShadow: 'none' }}>
            <Stack
              direction={{ xs: 'column', sm: 'row' }}
              justifyContent="space-between"
              alignItems={{ sm: 'center' }}
              spacing={1.5}
              sx={{ px: { xs: 2.5, md: 3 }, pt: 3, pb: 2 }}
            >
              <Box>
                <Typography variant="h6">最近业务</Typography>
                <Typography variant="body2" color="text.secondary" sx={{ mt: 0.4 }}>
                  最新提交、执行和完成的业务状态
                </Typography>
              </Box>
              <Button onClick={() => navigate(paths.dashboard.fundOperations.transactions)}>
                查看全部交易
              </Button>
            </Stack>
            <RecentOperations rows={analytics.recentOperations} />
          </Card>

          <Box>
            <SectionHeading
              eyebrow="SHORTCUTS"
              title="常用入口"
              description="从看板直接进入对应处理队列。"
            />
            <Box
              sx={{
                mt: 2,
                display: 'grid',
                gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, 1fr)', lg: 'repeat(4, 1fr)' },
                gap: 1.5,
              }}
            >
              {quickActions.map(([label, path, icon, color]) => (
                <Button
                  key={path}
                  variant="outlined"
                  color="inherit"
                  startIcon={<Iconify icon={icon} width={ICON_SIZES.navigation} sx={{ color }} />}
                  endIcon={<Iconify icon={UI_ICONS.forward} />}
                  onClick={() => navigate(path)}
                  sx={{
                    minHeight: 64,
                    px: 2,
                    justifyContent: 'space-between',
                    bgcolor: 'background.paper',
                    borderColor: 'divider',
                    '&:hover': { borderColor: color, bgcolor: 'background.paper' },
                  }}
                >
                  {label}
                </Button>
              ))}
            </Box>
          </Box>
        </Stack>
      </Container>
    </>
  );
}

function SummaryMetric({
  label,
  value,
  helper,
  icon,
  color,
  last = false,
}: {
  label: string;
  value: number;
  helper: string;
  icon: string;
  color: 'info' | 'warning' | 'success' | 'error';
  last?: boolean;
}) {
  return (
    <Stack
      direction="row"
      spacing={1.5}
      alignItems="center"
      sx={{
        p: { xs: 2, md: 2.5 },
        minWidth: 0,
        borderRight: { xs: last ? 0 : '1px solid', md: last ? 0 : '1px solid' },
        borderBottom: { xs: '1px solid', md: 0 },
        borderColor: 'divider',
        '&:nth-of-type(2n)': {
          borderRight: { xs: 0, md: last ? 0 : '1px solid' },
        },
        '&:nth-of-type(n+3)': { borderBottom: 0 },
      }}
    >
      <UiIconBadge icon={icon} tone={color} size={42} />
      <Box sx={{ minWidth: 0 }}>
        <Typography variant="caption" color="text.secondary">
          {label}
        </Typography>
        <Typography variant="h5" sx={{ fontVariantNumeric: 'tabular-nums' }}>
          {value.toLocaleString('zh-CN')}
        </Typography>
        <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
          {helper}
        </Typography>
      </Box>
    </Stack>
  );
}

function SectionHeading({
  eyebrow,
  title,
  description,
  action,
}: {
  eyebrow: string;
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <Stack
      direction={{ xs: 'column', sm: 'row' }}
      justifyContent="space-between"
      alignItems={{ xs: 'flex-start', sm: 'flex-end' }}
      spacing={2}
    >
      <Box>
        <Typography variant="overline" color="primary.main" sx={{ letterSpacing: 1.2 }}>
          {eyebrow}
        </Typography>
        <Typography variant="h5">{title}</Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mt: 0.4 }}>
          {description}
        </Typography>
      </Box>
      {action}
    </Stack>
  );
}

function FundCard({
  fund,
  selected,
  onSelect,
}: {
  fund: ReturnType<typeof buildOverviewAnalytics>['funds'][number];
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <Card
      component="button"
      type="button"
      variant="outlined"
      onClick={onSelect}
      sx={{
        width: '100%',
        p: 0,
        textAlign: 'left',
        cursor: 'pointer',
        boxShadow: 'none',
        bgcolor: 'background.paper',
        borderColor: selected ? ASSET_COLORS[fund.asset] : 'divider',
        transition: (theme) => theme.transitions.create(['border-color', 'transform']),
        '&:hover': { borderColor: ASSET_COLORS[fund.asset], transform: 'translateY(-2px)' },
        '&:focus-visible': {
          outline: `2px solid ${ASSET_COLORS[fund.asset]}`,
          outlineOffset: 2,
        },
      }}
    >
      <CardContent sx={{ p: 2.5 }}>
        <Stack direction="row" alignItems="center" justifyContent="space-between">
          <Stack direction="row" spacing={1.25} alignItems="center">
            <AssetIcon asset={fund.asset} network={fund.asset === 'USDT' ? 'TRON' : undefined} />
            <Box>
              <Typography variant="subtitle1">{fund.asset}</Typography>
              <Typography variant="caption" color="text.secondary">
                {fund.accountCount} 个账户
              </Typography>
            </Box>
          </Stack>
          {selected && <Label color="info">当前查看</Label>}
        </Stack>
        <Typography variant="h4" sx={{ mt: 2.5, fontVariantNumeric: 'tabular-nums' }}>
          {formatAmount(fund.available, fund.asset)}
        </Typography>
        <Typography variant="caption" color="text.secondary">
          可用余额
        </Typography>
        <Divider sx={{ my: 1.75 }} />
        <Stack direction="row" justifyContent="space-between" spacing={2}>
          <Box>
            <Typography variant="caption" color="text.secondary">
              冻结
            </Typography>
            <Typography variant="subtitle2" sx={{ fontVariantNumeric: 'tabular-nums' }}>
              {formatAmount(fund.frozen, fund.asset)}
            </Typography>
          </Box>
          <Box sx={{ textAlign: 'right' }}>
            <Typography variant="caption" color="text.secondary">
              账面合计
            </Typography>
            <Typography variant="subtitle2" sx={{ fontVariantNumeric: 'tabular-nums' }}>
              {formatAmount(fund.total, fund.asset)}
            </Typography>
          </Box>
        </Stack>
      </CardContent>
    </Card>
  );
}

function AssetToggle({
  value,
  onChange,
}: {
  value: OverviewAsset;
  onChange: (asset: OverviewAsset) => void;
}) {
  return (
    <ToggleButtonGroup
      exclusive
      size="small"
      value={value}
      onChange={(_, next: OverviewAsset | null) => next && onChange(next)}
      aria-label="选择资金趋势币种"
    >
      {OVERVIEW_ASSETS.map((asset) => (
        <ToggleButton key={asset} value={asset} aria-label={`查看 ${asset} 趋势`}>
          <Stack direction="row" spacing={0.75} alignItems="center">
            <AssetIcon asset={asset} network={asset === 'USDT' ? 'TRON' : undefined} size={18} />
            <span>{asset}</span>
          </Stack>
        </ToggleButton>
      ))}
    </ToggleButtonGroup>
  );
}

function ChartEmptyState({ message }: { message: string }) {
  return (
    <Stack alignItems="center" justifyContent="center" spacing={1} sx={{ minHeight: 290 }}>
      <Iconify icon="solar:chart-2-linear" width={ICON_SIZES.emptyState} color="text.disabled" />
      <Typography variant="body2" color="text.secondary">
        {message}
      </Typography>
    </Stack>
  );
}

function QueueRow({
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
  return (
    <Button
      color="inherit"
      onClick={onClick}
      sx={{ px: 0, py: 1.25, justifyContent: 'space-between', borderRadius: 0 }}
    >
      <Stack direction="row" spacing={1.25} alignItems="center">
        <Box
          sx={{
            width: 34,
            height: 34,
            display: 'grid',
            placeItems: 'center',
            borderRadius: 1.25,
            bgcolor: 'background.neutral',
            color: value ? 'warning.dark' : 'text.secondary',
          }}
        >
          <Iconify icon={icon} width={ICON_SIZES.default} />
        </Box>
        <Typography variant="body2">{label}</Typography>
      </Stack>
      <Stack direction="row" spacing={0.75} alignItems="center">
        <Typography
          variant="subtitle2"
          color={value ? 'warning.dark' : 'text.secondary'}
          sx={{ fontVariantNumeric: 'tabular-nums' }}
        >
          {value}
        </Typography>
        <Iconify icon={UI_ICONS.forward} width={ICON_SIZES.inline} />
      </Stack>
    </Button>
  );
}

function RecentOperations({ rows }: { rows: Operation[] }) {
  if (!rows.length) {
    return (
      <Stack alignItems="center" spacing={1} sx={{ py: 6 }}>
        <Iconify icon={ACTION_ICONS.history} width={ICON_SIZES.emptyState} color="text.disabled" />
        <Typography color="text.secondary">暂无业务记录</Typography>
      </Stack>
    );
  }
  return (
    <TableContainer>
      <Table sx={{ minWidth: 860 }}>
        <TableHead>
          <TableRow>
            <TableCell>业务编号</TableCell>
            <TableCell>客户</TableCell>
            <TableCell>类型</TableCell>
            <TableCell align="right">金额</TableCell>
            <TableCell>状态</TableCell>
            <TableCell>更新时间</TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {rows.map((row) => (
            <TableRow key={row.id} hover>
              <TableCell>
                <Typography variant="subtitle2">{row.reference}</Typography>
              </TableCell>
              <TableCell>{row.customer.displayName}</TableCell>
              <TableCell>{OPERATION_LABELS[row.type]}</TableCell>
              <TableCell align="right">
                <Typography variant="subtitle2" sx={{ fontVariantNumeric: 'tabular-nums' }}>
                  {formatAmount(Number(row.amount), row.currency as OverviewAsset)} {row.currency}
                </Typography>
              </TableCell>
              <TableCell>
                <Label color={STATUS_COLOR[row.status]}>{STATUS_LABELS[row.status]}</Label>
              </TableCell>
              <TableCell>{formatDateTime(operationTime(row))}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </TableContainer>
  );
}
