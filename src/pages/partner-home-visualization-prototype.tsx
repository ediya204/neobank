// PROTOTYPE ONLY — three Partner Portal home visualization directions, switched with ?variant=.
import { ReactNode, useMemo } from 'react';
import { Box, Button, Card, Chip, Divider, Stack, Typography } from '@mui/material';
import { useTheme } from '@mui/material/styles';
import { useTranslation } from 'react-i18next';
import Chart, { useChart } from 'src/components/chart';
import Iconify from 'src/components/iconify';

type Props = {
  customers: any[];
  transactions: any[];
  onNavigate: (path: string) => void;
};

const VARIANT_NAMES = {
  A: ['资产全景', 'Asset panorama'],
  B: ['客户旅程', 'Customer journey'],
  C: ['资金流向', 'Money flow'],
} as const;

function useCopy() {
  const { i18n } = useTranslation();
  const chinese = i18n.resolvedLanguage === 'cn' || i18n.language === 'cn';
  return {
    chinese,
    locale: chinese ? 'zh-CN' : 'en-US',
    text: (cn: string, en: string) => (chinese ? cn : en),
  };
}

function number(value: number, locale: string, digits = 2) {
  return value.toLocaleString(locale, { maximumFractionDigits: digits });
}

function directionSign(direction: string) {
  if (direction === 'credit') return '+';
  if (direction === 'debit') return '−';
  return '';
}

function usePortalSeries(customers: any[], transactions: any[]) {
  const copy = useCopy();
  return useMemo(() => {
    const balances = new Map<string, number>();
    customers.forEach((customer) => {
      (customer.balances || []).forEach((balance: any) => {
        const key = balance.asset === 'USDT' ? balance.network || 'TRON' : balance.asset;
        balances.set(key, (balances.get(key) || 0) + Number(balance.available_balance || 0));
      });
    });
    const types = new Map<string, number>();
    transactions.forEach((row) => types.set(row.type, (types.get(row.type) || 0) + 1));
    const active = customers.filter((customer) => customer.status === 'active').length;
    const onboarding = customers.filter((customer) =>
      ['kyc_link_ready', 'kyc_approved', 'va_processing'].includes(customer.status)
    ).length;
    const submitted = customers.filter((customer) => customer.status === 'submitted').length;
    const credits = transactions.filter((row) => row.direction === 'credit').length;
    const debits = transactions.filter((row) => row.direction === 'debit').length;
    const exchanges = transactions.filter((row) => row.direction === 'exchange').length;
    const automaticConversions = transactions.filter(
      (row) => row.category === 'otc' && row.source_fund_transaction_id
    ).length;
    return {
      ...copy,
      balances: Array.from(balances.entries()).map(([label, value]) => ({ label, value })),
      types: Array.from(types.entries())
        .sort((left, right) => right[1] - left[1])
        .slice(0, 6),
      active,
      onboarding,
      submitted,
      credits,
      debits,
      exchanges,
      automaticConversions,
    };
  }, [copy, customers, transactions]);
}

function Flag({ name }: { name: readonly [string, string] }) {
  const { chinese } = useCopy();
  return (
    <Chip
      size="small"
      color="info"
      label={`PROTOTYPE · ${name[chinese ? 0 : 1]}`}
      sx={{ fontWeight: 700 }}
    />
  );
}

function Shell({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <Card sx={{ p: { xs: 2, sm: 3 }, minWidth: 0 }}>
      <Typography variant="h6">{title}</Typography>
      {description && (
        <Typography variant="body2" color="text.secondary">
          {description}
        </Typography>
      )}
      <Box sx={{ mt: 2 }}>{children}</Box>
    </Card>
  );
}

function PortalRecentList({ rows }: { rows: any[] }) {
  const { locale, text } = useCopy();
  return (
    <Stack divider={<Divider flexItem />}>
      {rows.slice(0, 5).map((row) => (
        <Stack key={row.id} direction="row" spacing={2} alignItems="center" sx={{ py: 1.25 }}>
          <Box
            sx={{
              width: 34,
              height: 34,
              display: 'grid',
              placeItems: 'center',
              borderRadius: 1.5,
              bgcolor: row.direction === 'credit' ? 'success.lighter' : 'primary.lighter',
            }}
          >
            <Iconify
              icon={row.direction === 'credit' ? 'solar:arrow-down-bold' : 'solar:arrow-up-bold'}
              width={18}
            />
          </Box>
          <Box sx={{ minWidth: 0, flex: 1 }}>
            <Typography variant="subtitle2" noWrap>
              {row.customer_name || text('未知客户', 'Unknown customer')}
            </Typography>
            <Typography variant="caption" color="text.secondary">
              {row.type}
            </Typography>
          </Box>
          <Typography
            variant="body2"
            sx={{ color: row.direction === 'credit' ? 'success.dark' : 'text.primary' }}
          >
            {directionSign(row.direction)}
            {number(Number(row.amount || 0), locale, 6)} {row.asset}
          </Typography>
        </Stack>
      ))}
    </Stack>
  );
}

export function PortalVariantA({ customers, transactions, onNavigate }: Props) {
  const theme = useTheme();
  const data = usePortalSeries(customers, transactions);
  const balanceOptions = useChart({
    labels: data.balances.map((item) => item.label),
    colors: [
      theme.palette.primary.main,
      theme.palette.info.main,
      theme.palette.success.main,
      theme.palette.warning.main,
      theme.palette.secondary.main,
    ],
    legend: { position: 'bottom' },
    dataLabels: { enabled: false },
    plotOptions: { pie: { donut: { size: '72%' } } },
  });
  const activityOptions = useChart({
    chart: { toolbar: { show: false } },
    colors: [theme.palette.primary.main],
    xaxis: { categories: data.types.map(([type]) => type) },
    stroke: { curve: 'smooth', width: 3 },
    fill: { type: 'gradient', gradient: { opacityFrom: 0.45, opacityTo: 0.05 } },
    dataLabels: { enabled: false },
  });

  return (
    <Stack spacing={3}>
      <Card
        sx={{
          p: { xs: 3, md: 4 },
          background: `linear-gradient(135deg, ${theme.palette.primary.lighter}, ${theme.palette.info.lighter})`,
        }}
      >
        <Stack direction={{ xs: 'column', md: 'row' }} justifyContent="space-between" spacing={3}>
          <Box>
            <Flag name={VARIANT_NAMES.A} />
            <Typography variant="h3" sx={{ mt: 1.5 }}>
              {data.text('资产全景首页', 'Asset panorama')}
            </Typography>
            <Typography color="text.secondary">
              {data.text(
                '先看可用余额，再看近期变化。',
                'Lead with available balances, then recent movement.'
              )}
            </Typography>
          </Box>
          <Stack direction="row" spacing={4}>
            <Box>
              <Typography variant="caption">USD</Typography>
              <Typography variant="h3">
                {number(
                  data.balances.find((item) => item.label === 'USD')?.value || 0,
                  data.locale
                )}
              </Typography>
            </Box>
            <Box>
              <Typography variant="caption">USDT</Typography>
              <Typography variant="h3">
                {number(
                  data.balances
                    .filter((item) => item.label !== 'USD')
                    .reduce((sum, item) => sum + item.value, 0),
                  data.locale
                )}
              </Typography>
            </Box>
          </Stack>
        </Stack>
      </Card>
      <Box
        sx={{
          display: 'grid',
          gridTemplateColumns: { xs: '1fr', lg: 'minmax(300px, 0.85fr) minmax(0, 1.45fr)' },
          gap: 3,
        }}
      >
        <Shell title={data.text('资产分布', 'Asset allocation')}>
          <Chart
            type="donut"
            series={data.balances.map((item) => item.value)}
            options={balanceOptions}
            height={330}
          />
        </Shell>
        <Shell
          title={data.text('近期业务活跃度', 'Recent activity')}
          description={data.text('按交易类型统计记录数量', 'Record count by transaction type')}
        >
          <Chart
            type="area"
            series={[
              { name: data.text('笔数', 'Count'), data: data.types.map(([, count]) => count) },
            ]}
            options={activityOptions}
            height={330}
          />
        </Shell>
      </Box>
      <Button variant="contained" onClick={() => onNavigate('/portal/transactions')}>
        {data.text('查看全部交易', 'View all transactions')}
      </Button>
    </Stack>
  );
}

export function PortalVariantB({ customers, transactions, onNavigate }: Props) {
  const theme = useTheme();
  const data = usePortalSeries(customers, transactions);
  const journeyOptions = useChart({
    chart: { toolbar: { show: false } },
    colors: [theme.palette.info.main],
    xaxis: {
      categories: [
        data.text('已提交', 'Submitted'),
        data.text('KYC / 开户中', 'KYC / onboarding'),
        data.text('已开通', 'Active'),
      ],
    },
    plotOptions: {
      bar: { horizontal: true, borderRadius: 6, barHeight: '48%', distributed: true },
    },
    dataLabels: { enabled: true },
    legend: { show: false },
  });
  const networkOptions = useChart({
    chart: { toolbar: { show: false } },
    colors: [theme.palette.success.main],
    xaxis: {
      categories: data.balances.filter((item) => item.label !== 'USD').map((item) => item.label),
    },
    plotOptions: { bar: { borderRadius: 5, columnWidth: '38%' } },
    dataLabels: { enabled: false },
  });

  return (
    <Box
      sx={{
        display: 'grid',
        gridTemplateColumns: { xs: '1fr', xl: 'minmax(0, 1.35fr) minmax(360px, 0.65fr)' },
        gap: 3,
      }}
    >
      <Stack spacing={3}>
        <Box>
          <Flag name={VARIANT_NAMES.B} />
          <Typography variant="h3" sx={{ mt: 1.5 }}>
            {data.text('从客户进度开始', 'Start with customer progress')}
          </Typography>
          <Typography color="text.secondary">
            {data.text(
              '适合以开户转化和客户服务为中心的团队。',
              'For teams centered on onboarding and customer service.'
            )}
          </Typography>
        </Box>
        <Shell title={data.text('客户开户旅程', 'Customer onboarding journey')}>
          <Chart
            type="bar"
            series={[
              {
                name: data.text('客户数', 'Customers'),
                data: [data.submitted, data.onboarding, data.active],
              },
            ]}
            options={journeyOptions}
            height={300}
          />
        </Shell>
        <Shell title={data.text('USDT 分网络可用余额', 'USDT available by network')}>
          <Chart
            type="bar"
            series={[
              {
                name: 'USDT',
                data: data.balances
                  .filter((item) => item.label !== 'USD')
                  .map((item) => item.value),
              },
            ]}
            options={networkOptions}
            height={280}
          />
        </Shell>
      </Stack>
      <Card sx={{ p: 3 }}>
        <Stack direction="row" justifyContent="space-between">
          <Typography variant="h6">
            {data.text('最近客户动态', 'Recent customer activity')}
          </Typography>
          <Button onClick={() => onNavigate('/portal/customers')}>
            {data.text('客户总览', 'Customers')}
          </Button>
        </Stack>
        <PortalRecentList rows={transactions} />
      </Card>
    </Box>
  );
}

export function PortalVariantC({ customers, transactions, onNavigate }: Props) {
  const theme = useTheme();
  const data = usePortalSeries(customers, transactions);
  const flowOptions = useChart({
    labels: [
      data.text('转入', 'Credits'),
      data.text('转出', 'Debits'),
      data.text('兑换', 'Exchange'),
    ],
    colors: [theme.palette.success.main, theme.palette.error.main, theme.palette.warning.main],
    legend: { position: 'bottom' },
    dataLabels: { enabled: true },
  });

  return (
    <Stack spacing={3}>
      <Stack direction={{ xs: 'column', md: 'row' }} justifyContent="space-between" spacing={3}>
        <Box>
          <Flag name={VARIANT_NAMES.C} />
          <Typography variant="h3" sx={{ mt: 1.5 }}>
            {data.text('资金流向首页', 'Money-flow home')}
          </Typography>
          <Typography color="text.secondary">
            {data.text(
              '突出资金方向、自动兑换和异常变化。',
              'Highlights direction, automatic conversion, and exceptions.'
            )}
          </Typography>
        </Box>
        <Button variant="outlined" onClick={() => onNavigate('/portal/transactions')}>
          {data.text('进入交易中心', 'Open transaction center')}
        </Button>
      </Stack>
      <Card sx={{ p: { xs: 3, md: 4 }, bgcolor: 'grey.900', color: 'common.white' }}>
        <Box
          sx={{
            display: 'grid',
            gridTemplateColumns: { xs: '1fr 1fr', md: 'repeat(4, 1fr)' },
            gap: 3,
          }}
        >
          {[
            [data.text('转入记录', 'Credits'), data.credits],
            [data.text('转出记录', 'Debits'), data.debits],
            [data.text('自动兑换', 'Auto conversions'), data.automaticConversions],
            [data.text('活跃客户', 'Active customers'), data.active],
          ].map(([label, value]) => (
            <Box key={String(label)}>
              <Typography variant="caption" sx={{ opacity: 0.65 }}>
                {label}
              </Typography>
              <Typography variant="h2">{value}</Typography>
            </Box>
          ))}
        </Box>
      </Card>
      <Box
        sx={{
          display: 'grid',
          gridTemplateColumns: { xs: '1fr', lg: '400px minmax(0, 1fr)' },
          gap: 3,
        }}
      >
        <Shell title={data.text('交易方向构成', 'Direction mix')}>
          <Chart
            type="pie"
            series={[data.credits, data.debits, data.exchanges]}
            options={flowOptions}
            height={340}
          />
        </Shell>
        <Shell
          title={data.text('资金事件流', 'Money event stream')}
          description={data.text('最近五笔资金动作', 'Five most recent fund movements')}
        >
          <PortalRecentList rows={transactions} />
        </Shell>
      </Box>
    </Stack>
  );
}

export default function PartnerHomeVisualizationPrototype({
  variant,
  ...props
}: Props & { variant: string }) {
  if (variant === 'B') return <PortalVariantB {...props} />;
  if (variant === 'C') return <PortalVariantC {...props} />;
  return <PortalVariantA {...props} />;
}
