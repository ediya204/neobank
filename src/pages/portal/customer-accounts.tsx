import { useEffect, useMemo, useState } from 'react';
import { Helmet } from 'react-helmet-async';
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Container,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  FormControl,
  InputLabel,
  MenuItem,
  Select,
  Skeleton,
  Stack,
  Tab,
  Tabs,
  TextField,
  Typography,
} from '@mui/material';
import Iconify from 'src/components/iconify';
import AssetIcon from 'src/components/asset-icon';
import CustomBreadcrumbs from 'src/components/custom-breadcrumbs';
import { APP_DISPLAY_NAME } from 'src/config-global';
import { usePortalCustomer } from 'src/features/finance/portal-customer-context';
import {
  AssetDistributionItem,
  AssetSummary,
  coreApi,
  Currency,
  MarketQuote,
  MoneyAccount,
  supportedFiatCurrencies,
  VirtualAccountRequest,
} from 'src/features/finance/core-api';
import { AccountKindChip, accountLabel, money } from './customer-shared';

type AccountTab = 'all' | 'wallet' | 'va' | 'crypto';

export default function CustomerAccounts() {
  const { customer, error, refresh } = usePortalCustomer();
  const [tab, setTab] = useState<AccountTab>('all');
  const [selected, setSelected] = useState<MoneyAccount | null>(null);
  const [vaOpen, setVaOpen] = useState(false);
  const [summary, setSummary] = useState<AssetSummary | null>(null);
  const [summaryLoading, setSummaryLoading] = useState(true);
  const [summaryError, setSummaryError] = useState('');
  const [marketQuotes, setMarketQuotes] = useState<MarketQuote[]>([]);
  const [marketLoading, setMarketLoading] = useState(false);

  useEffect(() => {
    let active = true;
    if (!customer?.id) {
      setSummary(null);
      setSummaryLoading(false);
      return () => {
        active = false;
      };
    }
    setSummaryLoading(true);
    setSummaryError('');
    coreApi<AssetSummary>(`/accounts/summary?customerId=${encodeURIComponent(customer.id)}`)
      .then((value) => {
        if (active) setSummary(value);
      })
      .catch((value) => {
        if (active) {
          setSummary(null);
          setSummaryError(value instanceof Error ? value.message : '资产汇总加载失败');
        }
      })
      .finally(() => {
        if (active) setSummaryLoading(false);
      });
    return () => {
      active = false;
    };
  }, [customer?.id]);

  useEffect(() => {
    let active = true;
    if (!customer?.id) {
      setMarketQuotes([]);
      setMarketLoading(false);
      return () => {
        active = false;
      };
    }

    setMarketLoading(true);
    Promise.allSettled(
      (['HKD', 'USDT'] as const).map((currency) =>
        coreApi<MarketQuote>(`/customer/market-rate?base=${currency}&quote=USD`)
      )
    )
      .then((results) => {
        if (!active) return;
        setMarketQuotes(
          results.flatMap((result) => (result.status === 'fulfilled' ? [result.value] : []))
        );
      })
      .finally(() => {
        if (active) setMarketLoading(false);
      });

    return () => {
      active = false;
    };
  }, [customer?.id]);

  const usdRates = useMemo(() => {
    const rates = new Map<Currency, UsdRate>();
    rates.set('USD', { rate: 1, source: 'parity' });
    summary?.distribution.forEach((item) => {
      const rate = Number(item.reportingRate);
      if (Number.isFinite(rate) && rate > 0) rates.set(item.currency, { rate, source: 'book' });
    });
    marketQuotes.forEach((quote) => {
      const rate = Number(quote.rate);
      if (quote.quoteCurrency === 'USD' && Number.isFinite(rate) && rate > 0) {
        rates.set(quote.baseCurrency, { rate, source: 'market' });
      }
    });
    return rates;
  }, [marketQuotes, summary]);

  const accounts = (customer?.accounts || []).filter((row) => {
    if (tab === 'wallet') return row.kind === 'SYSTEM_WALLET';
    if (tab === 'va') return row.kind === 'VIRTUAL_ACCOUNT';
    if (tab === 'crypto') return row.kind === 'CRYPTO_WALLET';
    return ['SYSTEM_WALLET', 'VIRTUAL_ACCOUNT', 'CRYPTO_WALLET'].includes(row.kind);
  });
  return (
    <>
      <Helmet>
        <title>我的账户 | {APP_DISPLAY_NAME}</title>
      </Helmet>
      <Container maxWidth="xl">
        <Stack spacing={3}>
          <CustomBreadcrumbs
            heading="资产与账户"
            links={[{ name: '总览', href: '/portal/home' }, { name: '资产与账户' }]}
            action={
              <Button
                variant="contained"
                startIcon={<Iconify icon="solar:add-circle-linear" />}
                onClick={() => setVaOpen(true)}
              >
                申请 VA 账户
              </Button>
            }
          />
          <Typography color="text.secondary" sx={{ mt: -2 }}>
            查看 USD、HKD 与 USDT-TRON 的可用、冻结和账面余额。
          </Typography>
          {error && <Alert severity="error">{error}</Alert>}
          {summaryError && !error && <Alert severity="error">{summaryError}</Alert>}
          <AssetOverview summary={summary} loading={summaryLoading} />
          <Card>
            <Tabs
              value={tab}
              onChange={(_, value) => setTab(value)}
              variant="scrollable"
              scrollButtons="auto"
              sx={{ px: 2 }}
            >
              <Tab value="all" label="全部" />
              <Tab value="wallet" label="多货币法币账户" />
              <Tab value="va" label="VA 账户" />
              <Tab value="crypto" label="数字钱包" />
            </Tabs>
          </Card>
          <Card sx={{ overflow: 'hidden' }}>
            <Box
              sx={{
                display: { xs: 'none', md: 'grid' },
                gridTemplateColumns:
                  'minmax(210px, 1.35fr) 120px minmax(118px, 1fr) minmax(118px, 1fr) minmax(132px, 1fr) 120px',
                gap: 2,
                px: 3,
                py: 1.5,
                bgcolor: 'background.neutral',
                borderBottom: '1px solid',
                borderColor: 'divider',
              }}
            >
              <Typography variant="caption" color="text.secondary">
                账户
              </Typography>
              <Typography variant="caption" color="text.secondary">
                类型
              </Typography>
              <Typography variant="caption" color="text.secondary" textAlign="right">
                可用余额
              </Typography>
              <Typography variant="caption" color="text.secondary" textAlign="right">
                冻结余额
              </Typography>
              <Box sx={{ textAlign: 'right' }}>
                <Typography variant="caption" color="text.secondary" display="block">
                  美金价值
                </Typography>
                <Typography variant="caption" color="text.disabled">
                  含冻结
                </Typography>
              </Box>
              <Typography variant="caption" color="text.secondary" textAlign="right">
                操作
              </Typography>
            </Box>
            {accounts.map((account, index) => (
              <AccountListRow
                key={account.id}
                account={account}
                usdValuation={accountUsdValuation(account, usdRates)}
                valuationLoading={summaryLoading || marketLoading}
                divider={index < accounts.length - 1}
                onOpen={() => setSelected(account)}
              />
            ))}
          </Card>
          {!accounts.length && (
            <Card sx={{ py: 8, textAlign: 'center' }}>
              <Typography color="text.secondary">暂无此类账户</Typography>
            </Card>
          )}
        </Stack>
      </Container>
      <AccountDialog account={selected} onClose={() => setSelected(null)} />
      <VaRequestDialog
        open={vaOpen}
        customerId={customer?.id || ''}
        onClose={() => setVaOpen(false)}
        onCreated={() => {
          setVaOpen(false);
          refresh().catch(() => undefined);
        }}
      />
    </>
  );
}

type UsdRate = {
  rate: number;
  source: 'market' | 'book' | 'parity';
};

type UsdValuation = {
  value: number;
  source: UsdRate['source'];
};

function accountUsdValuation(
  account: MoneyAccount,
  rates: Map<Currency, UsdRate>
): UsdValuation | null {
  const rate = rates.get(account.currency);
  const balance = Number(account.availableBalance) + Number(account.frozenBalance);
  if (!rate || !Number.isFinite(balance)) return null;
  return { value: balance * rate.rate, source: rate.source };
}

const assetColors: Record<Currency, string> = {
  USD: '#B9E6D8',
  SGD: '#82B7F4',
  HKD: '#F0C97A',
  EUR: '#AE9CE6',
  GBP: '#E89B84',
  USDT: '#4FBFA2',
};

function AssetOverview({ summary, loading }: { summary: AssetSummary | null; loading: boolean }) {
  const chartBackground = useMemo(() => {
    if (!summary?.distribution.length) return '#E8ECEA';
    let cursor = 0;
    const segments = summary.distribution.map((item) => {
      const start = cursor;
      cursor += item.shareBps / 100;
      return `${assetColors[item.currency]} ${start}% ${cursor}%`;
    });
    if (cursor < 100) segments.push(`#E8ECEA ${cursor}% 100%`);
    return `conic-gradient(${segments.join(', ')})`;
  }, [summary]);
  const asOf = summary
    ? new Intl.DateTimeFormat('zh-CN', {
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      }).format(new Date(summary.asOf))
    : '';

  return (
    <Box
      sx={{
        display: 'grid',
        gridTemplateColumns: { xs: '1fr', lg: 'minmax(0, 1.15fr) minmax(380px, .85fr)' },
        gap: 2.5,
      }}
    >
      <Card
        sx={{
          color: '#F2F8F5',
          bgcolor: '#123F38',
          backgroundImage:
            'radial-gradient(circle at 90% 10%, rgba(109, 190, 164, .2), transparent 34%)',
          boxShadow: 'none',
        }}
      >
        <CardContent sx={{ p: { xs: 3, sm: 4 } }}>
          <Stack direction="row" justifyContent="space-between" alignItems="flex-start" gap={2}>
            <Box>
              <Typography variant="overline" sx={{ color: '#B9D7CE', letterSpacing: 1.3 }}>
                资产总览
              </Typography>
              {loading ? (
                <Skeleton
                  width={260}
                  height={64}
                  sx={{ bgcolor: 'rgba(255,255,255,.12)', mt: 0.5 }}
                />
              ) : (
                <Typography
                  sx={{
                    mt: 0.5,
                    typography: 'h2',
                    lineHeight: 1.08,
                    fontWeight: 800,
                    letterSpacing: '-0.045em',
                  }}
                >
                  {money(summary?.totalBalance || 0, 'USD')}
                </Typography>
              )}
              <Typography variant="body2" sx={{ color: '#B9D7CE', mt: 1 }}>
                多币种资产 USD 估值{asOf ? ` · ${asOf}` : ''}
              </Typography>
            </Box>
            <Box
              sx={{
                px: 1.25,
                py: 0.75,
                borderRadius: 1.5,
                bgcolor: 'rgba(255,255,255,.09)',
                color: '#DCEBE6',
                typography: 'caption',
                fontWeight: 700,
                whiteSpace: 'nowrap',
              }}
            >
              估算值
            </Box>
          </Stack>
          <Box
            sx={{
              display: 'grid',
              gridTemplateColumns: { xs: 'repeat(2, minmax(0, 1fr))', sm: 'repeat(3, 1fr)' },
              mt: { xs: 4, sm: 5 },
              pt: 2.5,
              borderTop: '1px solid rgba(255,255,255,.14)',
              gap: { xs: 2.5, sm: 2 },
            }}
          >
            <AssetMetric
              label="可用余额"
              value={summary ? money(summary.totalAvailable, 'USD') : '$0.00'}
              loading={loading}
            />
            <AssetMetric
              label="冻结余额"
              value={summary ? money(summary.totalFrozen, 'USD') : '$0.00'}
              loading={loading}
            />
            <AssetMetric
              label="资产账户"
              value={`${summary?.accountCount || 0} 个`}
              loading={loading}
            />
          </Box>
        </CardContent>
      </Card>

      <Card sx={{ boxShadow: 'none', border: '1px solid', borderColor: 'divider' }}>
        <CardContent sx={{ p: { xs: 3, sm: 3.5 } }}>
          <Stack direction="row" justifyContent="space-between" alignItems="baseline">
            <Box>
              <Typography variant="h6">资产分布</Typography>
              <Typography variant="caption" color="text.secondary">
                按 USD 估值计算
              </Typography>
            </Box>
            <Typography variant="caption" color="text.secondary">
              {summary?.distribution.length || 0} 个币种
            </Typography>
          </Stack>
          <Box
            sx={{
              display: 'grid',
              gridTemplateColumns: { xs: '110px minmax(0, 1fr)', sm: '132px minmax(0, 1fr)' },
              alignItems: 'center',
              gap: { xs: 2.25, sm: 3 },
              mt: 3,
            }}
          >
            <Box
              role="img"
              aria-label="资产币种分布图"
              sx={{
                width: { xs: 110, sm: 132 },
                aspectRatio: '1',
                borderRadius: '50%',
                background: chartBackground,
                display: 'grid',
                placeItems: 'center',
                position: 'relative',
                '&::after': {
                  content: '""',
                  position: 'absolute',
                  inset: '19%',
                  borderRadius: '50%',
                  bgcolor: 'background.paper',
                },
              }}
            >
              <Box sx={{ position: 'relative', zIndex: 1, textAlign: 'center' }}>
                <Typography variant="h5">{summary?.distribution.length || 0}</Typography>
                <Typography variant="caption" color="text.secondary">
                  币种
                </Typography>
              </Box>
            </Box>
            <Stack spacing={1.5}>
              {loading && [0, 1, 2].map((item) => <Skeleton key={item} height={24} />)}
              {!loading &&
                summary?.distribution
                  .slice(0, 6)
                  .map((item) => <DistributionRow key={item.currency} item={item} />)}
              {!loading && !summary?.distribution.length && (
                <Typography variant="body2" color="text.secondary">
                  入账后将在这里展示资产分布。
                </Typography>
              )}
            </Stack>
          </Box>
          {summary?.valuationStatus === 'partial' && (
            <Alert severity="warning" sx={{ mt: 2.5 }}>
              {summary.missingRates.join('、')} 暂无有效估值汇率，未计入总资产。
            </Alert>
          )}
        </CardContent>
      </Card>
    </Box>
  );
}

function AssetMetric({
  label,
  value,
  loading,
}: {
  label: string;
  value: string;
  loading: boolean;
}) {
  return (
    <Box>
      <Typography variant="caption" sx={{ color: '#AFCFC5' }}>
        {label}
      </Typography>
      {loading ? (
        <Skeleton width={100} sx={{ bgcolor: 'rgba(255,255,255,.12)' }} />
      ) : (
        <Typography variant="subtitle1" sx={{ mt: 0.35, fontWeight: 700 }}>
          {value}
        </Typography>
      )}
    </Box>
  );
}

function DistributionRow({ item }: { item: AssetDistributionItem }) {
  return (
    <Stack direction="row" alignItems="center" spacing={1.25}>
      <Box
        sx={{
          width: 9,
          height: 9,
          borderRadius: '50%',
          bgcolor: assetColors[item.currency],
          flexShrink: 0,
        }}
      />
      <Typography variant="subtitle2" sx={{ width: 42 }}>
        {item.currency}
      </Typography>
      <Box sx={{ flex: 1, minWidth: 0 }}>
        <Typography variant="body2" noWrap sx={{ fontWeight: 600 }}>
          {item.reportingValue ? money(item.reportingValue, 'USD') : '暂无汇率'}
        </Typography>
      </Box>
      <Typography
        variant="caption"
        color="text.secondary"
        sx={{ minWidth: 38, textAlign: 'right' }}
      >
        {(item.shareBps / 100).toFixed(item.shareBps % 100 ? 1 : 0)}%
      </Typography>
    </Stack>
  );
}

function VaRequestDialog({
  open,
  customerId,
  onClose,
  onCreated,
}: {
  open: boolean;
  customerId: string;
  onClose: () => void;
  onCreated: () => void;
}) {
  const [currency, setCurrency] = useState<Currency>('USD');
  const [country, setCountry] = useState('HK');
  const [purpose, setPurpose] = useState('接收客户货款');
  const [error, setError] = useState('');
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError('');
    try {
      await coreApi<VirtualAccountRequest>(`/customers/${customerId}/virtual-account-requests`, {
        method: 'POST',
        body: JSON.stringify({ currency, preferredCountry: country, purpose }),
      });
      onCreated();
    } catch (value) {
      setError(value instanceof Error ? value.message : '申请提交失败');
    }
  };
  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="sm">
      <Box component="form" onSubmit={submit}>
        <DialogTitle>申请 VA 账户</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ mt: 1 }}>
            {error && <Alert severity="error">{error}</Alert>}
            <FormControl fullWidth>
              <InputLabel>币种</InputLabel>
              <Select
                label="币种"
                value={currency}
                onChange={(event) => setCurrency(event.target.value as Currency)}
              >
                {supportedFiatCurrencies.map((item) => (
                  <MenuItem key={item} value={item}>
                    {item}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
            <TextField
              required
              label="开户地区代码"
              value={country}
              onChange={(event) => setCountry(event.target.value.toUpperCase())}
              inputProps={{ maxLength: 2 }}
            />
            <TextField
              required
              label="账户用途"
              value={purpose}
              onChange={(event) => setPurpose(event.target.value)}
              multiline
              minRows={2}
            />
            <Alert severity="info">
              申请需要平台审批。批准后会在账户页显示独立账号、银行和 SWIFT 信息。
            </Alert>
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={onClose}>取消</Button>
          <Button type="submit" variant="contained">
            提交申请
          </Button>
        </DialogActions>
      </Box>
    </Dialog>
  );
}

function AccountListRow({
  account,
  usdValuation,
  valuationLoading,
  onOpen,
  divider,
}: {
  account: MoneyAccount;
  usdValuation: UsdValuation | null;
  valuationLoading: boolean;
  onOpen: () => void;
  divider: boolean;
}) {
  const crypto = account.kind === 'CRYPTO_WALLET';
  let mobileValuationLabel = '美金价值暂无估值';
  if (valuationLoading) mobileValuationLabel = '美金价值计算中…';
  else if (usdValuation) {
    mobileValuationLabel = `${money(usdValuation.value, 'USD')} 美金价值`;
  }
  return (
    <Box
      sx={{
        display: 'grid',
        gridTemplateColumns: {
          xs: 'minmax(0, 1fr) auto',
          md: 'minmax(210px, 1.35fr) 120px minmax(118px, 1fr) minmax(118px, 1fr) minmax(132px, 1fr) 120px',
        },
        alignItems: 'center',
        gap: { xs: 1.5, md: 2 },
        px: { xs: 2, md: 3 },
        py: 2,
        borderBottom: divider ? '1px solid' : 0,
        borderColor: 'divider',
      }}
    >
      <Stack direction="row" spacing={1.5} alignItems="center" sx={{ minWidth: 0 }}>
        <Box
          sx={{
            width: 42,
            height: 42,
            flexShrink: 0,
            borderRadius: '50%',
            display: 'grid',
            placeItems: 'center',
            bgcolor: crypto ? '#E6F6F1' : '#EEF3F8',
          }}
        >
          <AssetIcon asset={account.currency} network={account.network} size={crypto ? 31 : 29} />
        </Box>
        <Box sx={{ minWidth: 0 }}>
          <Typography variant="subtitle2">{accountLabel(account)}</Typography>
          <Typography variant="caption" color="text.secondary" noWrap sx={{ display: 'block' }}>
            {account.name}
          </Typography>
        </Box>
      </Stack>
      <Box sx={{ display: { xs: 'none', md: 'block' } }}>
        <AccountKindChip account={account} />
      </Box>
      <Box sx={{ textAlign: 'right' }}>
        <Typography variant="subtitle2">
          {money(account.availableBalance, account.currency)}
        </Typography>
        <Typography
          variant="caption"
          color="text.secondary"
          sx={{ display: { xs: 'block', md: 'none' } }}
        >
          可用
        </Typography>
        <Typography
          variant="caption"
          color="text.secondary"
          sx={{ display: { xs: 'block', md: 'none' }, mt: 0.25 }}
        >
          {mobileValuationLabel}
        </Typography>
        <Button
          size="small"
          href={crypto ? '/portal/crypto-wallet' : undefined}
          onClick={crypto ? undefined : onOpen}
          sx={{ display: { xs: 'inline-flex', md: 'none' }, mt: 0.5, px: 0 }}
        >
          {crypto ? '管理钱包' : '查看信息'}
        </Button>
      </Box>
      <Typography
        variant="body2"
        color={Number(account.frozenBalance) > 0 ? 'warning.main' : 'text.secondary'}
        textAlign="right"
        sx={{ display: { xs: 'none', md: 'block' } }}
      >
        {money(account.frozenBalance, account.currency)}
      </Typography>
      <Box sx={{ display: { xs: 'none', md: 'block' }, textAlign: 'right' }}>
        {valuationLoading ? (
          <Skeleton width={88} sx={{ ml: 'auto' }} />
        ) : (
          <>
            <Typography variant="subtitle2">
              {usdValuation ? money(usdValuation.value, 'USD') : '暂无估值'}
            </Typography>
            <Typography variant="caption" color="text.secondary">
              {usdValuation?.source === 'market' ? '行情估算' : '账面估算'}
            </Typography>
          </>
        )}
      </Box>
      <Box sx={{ display: { xs: 'none', md: 'flex' }, justifyContent: 'flex-end' }}>
        {crypto ? (
          <Button size="small" href="/portal/crypto-wallet">
            管理钱包
          </Button>
        ) : (
          <Button size="small" onClick={onOpen}>
            查看信息
          </Button>
        )}
      </Box>
    </Box>
  );
}

function AccountDialog({
  account,
  onClose,
}: {
  account: MoneyAccount | null;
  onClose: () => void;
}) {
  if (!account) return null;
  const isVa = account.kind === 'VIRTUAL_ACCOUNT';
  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="sm">
      <DialogTitle>{isVa ? '使用专属 VA 收款' : `${account.currency} 入账信息`}</DialogTitle>
      <DialogContent>
        <Alert severity="info" sx={{ mb: 2 }}>
          请确保汇款人名称与客户资料一致。银行到账后需平台审批，完成后余额自动更新。
        </Alert>
        <Stack divider={<Divider flexItem />}>
          <Detail label="账户名称" value={account.name} />
          <Detail label="银行" value={account.bankName || 'SCC数字银行合作银行'} />
          <Detail label="账户号码" value={account.accountNumber || '-'} mono />
          <Detail label="SWIFT / BIC" value={account.swiftBic || '-'} mono />
          <Detail label="币种" value={account.currency} />
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>关闭</Button>
        <Button
          variant="contained"
          onClick={() => navigator.clipboard?.writeText(account.accountNumber || '')}
        >
          复制账户号码
        </Button>
      </DialogActions>
    </Dialog>
  );
}

function Detail({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <Stack direction="row" justifyContent="space-between" sx={{ py: 1.5 }}>
      <Typography color="text.secondary">{label}</Typography>
      <Typography
        variant="subtitle2"
        sx={{ fontFamily: mono ? 'monospace' : undefined, textAlign: 'right' }}
      >
        {value}
      </Typography>
    </Stack>
  );
}
