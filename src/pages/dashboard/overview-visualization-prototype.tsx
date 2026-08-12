// PROTOTYPE ONLY — three Admin home visualization directions, switched with ?variant=.
import { ReactNode, useMemo } from 'react';
import { Box, Button, Card, Chip, Divider, Stack, Typography } from '@mui/material';
import { useTheme } from '@mui/material/styles';
import { useTranslation } from 'react-i18next';
import Chart, { useChart } from 'src/components/chart';
import Iconify from 'src/components/iconify';
import type { OverviewData, RecentTransaction } from './overview';

type Props = {
  value: OverviewData;
  onNavigate: (path: string) => void;
};

const VARIANT_NAMES = {
  A: ['经营脉搏', 'Business pulse'],
  B: ['资金驾驶舱', 'Treasury cockpit'],
  C: ['运营指挥台', 'Operations command'],
} as const;

function usePrototypeCopy() {
  const { i18n } = useTranslation();
  const chinese = i18n.resolvedLanguage === 'cn' || i18n.language === 'cn';
  return {
    locale: chinese ? 'zh-CN' : 'en-US',
    text: (cn: string, en: string) => (chinese ? cn : en),
  };
}

function format(value: number, locale: string, digits = 2) {
  return value.toLocaleString(locale, { maximumFractionDigits: digits });
}

function transactionLabel(type: string, chinese: boolean) {
  const labels: Record<string, [string, string]> = {
    fiat_deposit: ['法币转入', 'Fiat deposit'],
    usdt_deposit: ['USDT 转入', 'USDT deposit'],
    fiat_withdrawal: ['法币转出', 'Fiat withdrawal'],
    usdt_withdrawal: ['USDT 转出', 'USDT withdrawal'],
    otc: ['自动兑换', 'Auto conversion'],
    fiat_conversion_debit: ['兑换扣款', 'Conversion debit'],
    crypto_conversion_credit: ['兑换入账', 'Conversion credit'],
    usdt_sweep: ['USDT 汇集', 'USDT sweep'],
  };
  return labels[type]?.[chinese ? 0 : 1] || type;
}

function directionSign(direction: string) {
  if (direction === 'credit') return '+';
  if (direction === 'debit') return '−';
  return '';
}

function useOverviewSeries(value: OverviewData) {
  const { locale, text } = usePrototypeCopy();
  const chinese = locale === 'zh-CN';
  return useMemo(() => {
    const balances = value.balances.map((balance) => ({
      label: balance.network || balance.asset,
      ledger: Number(balance.ledger_balance || 0),
      reserved: Number(balance.reserved || 0),
      available: Number(balance.available_balance || 0),
    }));
    const typeCounts = new Map<string, number>();
    value.recent_transactions.forEach((row) => {
      typeCounts.set(row.type, (typeCounts.get(row.type) || 0) + 1);
    });
    const transactionMix = Array.from(typeCounts.entries())
      .sort((left, right) => right[1] - left[1])
      .slice(0, 6)
      .map(([type, count]) => ({ label: transactionLabel(type, chinese), count }));
    const credits = value.recent_transactions.filter((row) => row.direction === 'credit').length;
    const debits = value.recent_transactions.filter((row) => row.direction === 'debit').length;
    const exchanges = value.recent_transactions.filter(
      (row) => row.direction === 'exchange'
    ).length;
    return { balances, transactionMix, credits, debits, exchanges, locale, text };
  }, [chinese, locale, text, value]);
}

function PrototypeFlag({ name }: { name: readonly [string, string] }) {
  const { locale } = usePrototypeCopy();
  return (
    <Chip
      size="small"
      color="secondary"
      label={`PROTOTYPE · ${name[locale === 'zh-CN' ? 0 : 1]}`}
      sx={{ fontWeight: 700 }}
    />
  );
}

function Metric({
  label,
  value,
  helper,
  icon,
}: {
  label: string;
  value: string;
  helper: string;
  icon: string;
}) {
  return (
    <Box sx={{ minWidth: 0 }}>
      <Stack direction="row" spacing={1} alignItems="center">
        <Iconify icon={icon} width={20} color="primary.main" />
        <Typography variant="caption" color="text.secondary">
          {label}
        </Typography>
      </Stack>
      <Typography variant="h4" sx={{ mt: 0.75 }}>
        {value}
      </Typography>
      <Typography variant="caption" color="text.secondary">
        {helper}
      </Typography>
    </Box>
  );
}

function ChartShell({
  title,
  helper,
  children,
}: {
  title: string;
  helper?: string;
  children: ReactNode;
}) {
  return (
    <Card sx={{ p: { xs: 2, sm: 3 }, minWidth: 0 }}>
      <Typography variant="h6">{title}</Typography>
      {helper && (
        <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
          {helper}
        </Typography>
      )}
      <Box sx={{ mt: 2 }}>{children}</Box>
    </Card>
  );
}

function TransactionList({ rows }: { rows: RecentTransaction[] }) {
  const { locale } = usePrototypeCopy();
  const chinese = locale === 'zh-CN';
  return (
    <Stack divider={<Divider flexItem />}>
      {rows.slice(0, 5).map((row) => (
        <Stack key={`${row.category}:${row.id}`} direction="row" spacing={2} sx={{ py: 1.25 }}>
          <Box sx={{ flex: 1, minWidth: 0 }}>
            <Typography variant="subtitle2" noWrap>
              {row.customer_name}
            </Typography>
            <Typography variant="caption" color="text.secondary">
              {transactionLabel(row.type, chinese)}
            </Typography>
          </Box>
          <Typography
            variant="body2"
            sx={{ color: row.direction === 'credit' ? 'success.dark' : 'text.primary' }}
          >
            {directionSign(row.direction)}
            {format(Number(row.amount || 0), locale, 6)} {row.asset}
          </Typography>
        </Stack>
      ))}
    </Stack>
  );
}

export function AdminVariantA({ value, onNavigate }: Props) {
  const theme = useTheme();
  const data = useOverviewSeries(value);
  const chartOptions = useChart({
    chart: { toolbar: { show: false } },
    colors: [theme.palette.primary.main, theme.palette.success.main, theme.palette.warning.main],
    xaxis: { categories: data.transactionMix.map((item) => item.label) },
    plotOptions: { bar: { borderRadius: 5, columnWidth: '42%' } },
    dataLabels: { enabled: false },
  });
  const donutOptions = useChart({
    labels: [
      data.text('转入', 'Credits'),
      data.text('转出', 'Debits'),
      data.text('兑换', 'Exchange'),
    ],
    colors: [theme.palette.success.main, theme.palette.error.main, theme.palette.warning.main],
    legend: { position: 'bottom' },
    dataLabels: { enabled: false },
  });

  return (
    <Stack spacing={3}>
      <Stack direction={{ xs: 'column', sm: 'row' }} justifyContent="space-between" spacing={2}>
        <Box>
          <PrototypeFlag name={VARIANT_NAMES.A} />
          <Typography variant="h3" sx={{ mt: 1.5 }}>
            {data.text('今天的业务，一眼看清', 'Your business at a glance')}
          </Typography>
        </Box>
        <Button variant="outlined" onClick={() => onNavigate('/dashboard/operations/transactions')}>
          {data.text('查看交易历史', 'View transaction history')}
        </Button>
      </Stack>

      <Card sx={{ p: 3 }}>
        <Box
          sx={{
            display: 'grid',
            gridTemplateColumns: { xs: '1fr 1fr', lg: 'repeat(4, 1fr)' },
            gap: 3,
          }}
        >
          <Metric
            label={data.text('客户', 'Customers')}
            value={String(value.customers.total)}
            helper={data.text(
              `${value.customers.active} 已开通`,
              `${value.customers.active} active`
            )}
            icon="solar:users-group-rounded-bold-duotone"
          />
          <Metric
            label={data.text('开户中', 'Onboarding')}
            value={String(value.customers.onboarding)}
            helper={data.text('KYC 与 VA', 'KYC and VA')}
            icon="solar:user-check-bold-duotone"
          />
          <Metric
            label={data.text('待处理', 'Pending')}
            value={String(value.pending.total)}
            helper={data.text('需要运营关注', 'Needs attention')}
            icon="solar:bell-bing-bold-duotone"
          />
          <Metric
            label={data.text('近期交易', 'Recent activity')}
            value={String(value.recent_transactions.length)}
            helper={data.text('当前数据窗口', 'Current data window')}
            icon="solar:chart-square-bold-duotone"
          />
        </Box>
      </Card>

      <Box
        sx={{
          display: 'grid',
          gridTemplateColumns: { xs: '1fr', lg: 'minmax(0, 1.6fr) minmax(300px, 0.8fr)' },
          gap: 3,
        }}
      >
        <ChartShell
          title={data.text('交易类型热度', 'Transaction mix')}
          helper={data.text('近期业务记录数量', 'Recent business record count')}
        >
          <Chart
            type="bar"
            series={[
              {
                name: data.text('笔数', 'Transactions'),
                data: data.transactionMix.map((item) => item.count),
              },
            ]}
            options={chartOptions}
            height={300}
          />
        </ChartShell>
        <ChartShell title={data.text('资金方向', 'Money direction')}>
          <Chart
            type="donut"
            series={[data.credits, data.debits, data.exchanges]}
            options={donutOptions}
            height={300}
          />
        </ChartShell>
      </Box>
    </Stack>
  );
}

export function AdminVariantB({ value, onNavigate }: Props) {
  const theme = useTheme();
  const data = useOverviewSeries(value);
  const balanceOptions = useChart({
    chart: { stacked: false, toolbar: { show: false } },
    colors: [theme.palette.primary.main, theme.palette.warning.main, theme.palette.success.main],
    xaxis: { categories: data.balances.map((item) => item.label) },
    plotOptions: { bar: { borderRadius: 4, columnWidth: '62%' } },
    dataLabels: { enabled: false },
    legend: { position: 'top' },
  });
  const pendingTotal = Math.max(value.pending.total, 1);
  const pendingOptions = useChart({
    labels: [data.text('待处理占比', 'Pending load')],
    colors: [theme.palette.warning.main],
    plotOptions: {
      radialBar: {
        hollow: { size: '68%' },
        dataLabels: { name: { show: true }, value: { fontSize: '28px' } },
      },
    },
  });

  return (
    <Box
      sx={{
        display: 'grid',
        gridTemplateColumns: { xs: '1fr', xl: 'minmax(0, 1.8fr) 380px' },
        gap: 3,
      }}
    >
      <Stack spacing={3}>
        <Box>
          <PrototypeFlag name={VARIANT_NAMES.B} />
          <Typography variant="h3" sx={{ mt: 1.5 }}>
            {data.text('资金驾驶舱', 'Treasury cockpit')}
          </Typography>
          <Typography color="text.secondary">
            {data.text(
              '先看账本、占用和可用，再处理异常。',
              'Lead with ledger, reserved, and available funds.'
            )}
          </Typography>
        </Box>
        <ChartShell
          title={data.text('分资产资金结构', 'Funds by asset and network')}
          helper={data.text('账本 / 占用 / 可用对比', 'Ledger / reserved / available')}
        >
          <Chart
            type="bar"
            series={[
              { name: data.text('账本', 'Ledger'), data: data.balances.map((item) => item.ledger) },
              {
                name: data.text('占用', 'Reserved'),
                data: data.balances.map((item) => item.reserved),
              },
              {
                name: data.text('可用', 'Available'),
                data: data.balances.map((item) => item.available),
              },
            ]}
            options={balanceOptions}
            height={380}
          />
        </ChartShell>
        <Card sx={{ p: 3 }}>
          <Stack direction="row" justifyContent="space-between" alignItems="center">
            <Typography variant="h6">
              {data.text('最新资金动作', 'Latest fund movements')}
            </Typography>
            <Button onClick={() => onNavigate('/dashboard/operations/transactions')}>
              {data.text('全部', 'All')}
            </Button>
          </Stack>
          <TransactionList rows={value.recent_transactions} />
        </Card>
      </Stack>

      <Stack spacing={3}>
        <Card sx={{ p: 3, bgcolor: 'grey.900', color: 'common.white' }}>
          <Typography variant="overline" sx={{ opacity: 0.7 }}>
            {data.text('需要处理', 'Needs action')}
          </Typography>
          <Chart
            type="radialBar"
            series={[Math.min(100, (value.pending.total / pendingTotal) * 100)]}
            options={pendingOptions}
            height={270}
          />
          <Stack divider={<Divider sx={{ borderColor: 'grey.700' }} />}>
            <Metric
              label={data.text('待确认入账', 'Deposits')}
              value={String(value.pending.deposits)}
              helper={data.text('等待核实', 'Awaiting verification')}
              icon="solar:download-minimalistic-bold-duotone"
            />
            <Box sx={{ pt: 2 }}>
              <Metric
                label={data.text('待处理转出', 'Withdrawals')}
                value={String(value.pending.withdrawals)}
                helper={data.text('等待人工处理', 'Manual action required')}
                icon="solar:upload-minimalistic-bold-duotone"
              />
            </Box>
          </Stack>
        </Card>
        <Button
          size="large"
          variant="contained"
          onClick={() => onNavigate('/dashboard/operations/deposits')}
        >
          {data.text('进入待处理队列', 'Open pending queue')}
        </Button>
      </Stack>
    </Box>
  );
}

export function AdminVariantC({ value, onNavigate }: Props) {
  const theme = useTheme();
  const data = useOverviewSeries(value);
  const totalAvailable = data.balances.reduce((sum, item) => sum + item.available, 0);
  const mixOptions = useChart({
    chart: { toolbar: { show: false } },
    colors: [theme.palette.info.main],
    xaxis: { categories: data.transactionMix.map((item) => item.label) },
    plotOptions: { bar: { horizontal: true, borderRadius: 5, barHeight: '48%' } },
    dataLabels: { enabled: true },
    grid: { show: false },
  });

  return (
    <Stack spacing={3}>
      <Card
        sx={{
          p: { xs: 3, md: 5 },
          color: 'common.white',
          background: `linear-gradient(135deg, ${theme.palette.primary.darker}, ${theme.palette.info.dark})`,
        }}
      >
        <Stack direction={{ xs: 'column', md: 'row' }} justifyContent="space-between" spacing={4}>
          <Box>
            <PrototypeFlag name={VARIANT_NAMES.C} />
            <Typography variant="h2" sx={{ mt: 2, maxWidth: 680 }}>
              {data.text('先发现异常，再深入明细', 'Spot exceptions before drilling into detail')}
            </Typography>
            <Typography sx={{ mt: 1.5, opacity: 0.76 }}>
              {data.text(
                '适合高频运营值班与大屏使用。',
                'Designed for high-frequency operations and wall displays.'
              )}
            </Typography>
          </Box>
          <Box sx={{ minWidth: 240 }}>
            <Typography variant="overline" sx={{ opacity: 0.7 }}>
              {data.text('跨资产可用总量', 'Total available')}
            </Typography>
            <Typography variant="h2">{format(totalAvailable, data.locale, 2)}</Typography>
            <Typography variant="caption" sx={{ opacity: 0.7 }}>
              {data.text(
                '仅作可视化汇总，不用于财务结算',
                'Visualization only; not a settlement total'
              )}
            </Typography>
          </Box>
        </Stack>
      </Card>

      <Box
        sx={{
          display: 'grid',
          gridTemplateColumns: { xs: '1fr', lg: '340px minmax(0, 1fr)' },
          gap: 3,
        }}
      >
        <Stack spacing={2}>
          {[
            [
              data.text('待确认入账', 'Deposits to confirm'),
              value.pending.deposits,
              'warning.main',
            ],
            [
              data.text('待处理转出', 'Withdrawals to process'),
              value.pending.withdrawals,
              'error.main',
            ],
            [data.text('开户处理中', 'Onboarding'), value.customers.onboarding, 'info.main'],
          ].map(([label, count, color]) => (
            <Card
              key={String(label)}
              sx={{ p: 2.5, borderLeft: '5px solid', borderColor: String(color) }}
            >
              <Typography color="text.secondary">{label}</Typography>
              <Typography variant="h3" sx={{ mt: 0.5 }}>
                {count}
              </Typography>
            </Card>
          ))}
          <Button variant="contained" onClick={() => onNavigate('/dashboard/operations/deposits')}>
            {data.text('开始处理', 'Start processing')}
          </Button>
        </Stack>
        <ChartShell
          title={data.text('业务事件排行', 'Business event ranking')}
          helper={data.text('越长表示近期出现越频繁', 'Longer bars indicate more recent activity')}
        >
          <Chart
            type="bar"
            series={[
              {
                name: data.text('笔数', 'Count'),
                data: data.transactionMix.map((item) => item.count),
              },
            ]}
            options={mixOptions}
            height={390}
          />
        </ChartShell>
      </Box>
    </Stack>
  );
}

export default function AdminOverviewVisualizationPrototype({
  variant,
  ...props
}: Props & { variant: string }) {
  if (variant === 'B') return <AdminVariantB {...props} />;
  if (variant === 'C') return <AdminVariantC {...props} />;
  return <AdminVariantA {...props} />;
}
