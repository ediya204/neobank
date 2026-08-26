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
  buildAssetSummaryFromLastKnownRates,
  ResolvedAssetSummary,
  resolveAssetSummaryRates,
} from 'src/features/finance/asset-summary-rates';
import {
  AssetDistributionItem,
  AssetSummary,
  coreApi,
  Currency,
  demoOrganizationId,
  FundingChannel,
  MoneyAccount,
  SYSTEM_WALLET_PRODUCT_NAME,
  VirtualAccountRequest,
} from 'src/features/finance/core-api';
import { portalLocale, portalText } from 'src/locales/portal-text';
import { AccountKindChip, accountLabel, money } from './customer-shared';

type AccountTab = 'all' | 'wallet' | 'va' | 'crypto';

function summaryFallbackMessage(fallback: ResolvedAssetSummary | null) {
  if (!fallback) return portalText('暂时无法读取资产汇总，请稍后重试。');
  if (fallback.lastKnownCurrencies.length) {
    return portalText('实时汇率暂未更新，当前估值按最近一次有效汇率显示。');
  }
  return portalText('部分汇率暂不可用；当前总值仅计入无需折算或已有有效汇率的资产。');
}

export default function CustomerAccounts() {
  const { customer, error, refresh } = usePortalCustomer();
  const [tab, setTab] = useState<AccountTab>('all');
  const [selected, setSelected] = useState<MoneyAccount | null>(null);
  const [vaOpen, setVaOpen] = useState(false);
  const [summary, setSummary] = useState<AssetSummary | null>(null);
  const [summaryLoading, setSummaryLoading] = useState(true);
  const [summaryError, setSummaryError] = useState('');
  const [lastKnownRateCurrencies, setLastKnownRateCurrencies] = useState<Currency[]>([]);

  useEffect(() => {
    let active = true;
    if (!customer?.id) {
      setSummary(null);
      setSummaryLoading(false);
      setLastKnownRateCurrencies([]);
      return () => {
        active = false;
      };
    }
    const fallback = buildAssetSummaryFromLastKnownRates(customer.id, customer.accounts || []);
    setSummary(fallback?.summary || null);
    setLastKnownRateCurrencies(fallback?.lastKnownCurrencies || []);
    setSummaryLoading(!fallback);
    setSummaryError('');
    coreApi<AssetSummary>(`/accounts/summary?customerId=${encodeURIComponent(customer.id)}`)
      .then((value) => {
        if (active) {
          const resolved = resolveAssetSummaryRates(value);
          setSummary(resolved.summary);
          setLastKnownRateCurrencies(resolved.lastKnownCurrencies);
          setSummaryError(
            resolved.lastKnownCurrencies.length
              ? portalText('实时汇率暂未更新，当前估值按最近一次有效汇率显示。')
              : ''
          );
        }
      })
      .catch(() => {
        if (active) {
          setSummary(fallback?.summary || null);
          setLastKnownRateCurrencies(fallback?.lastKnownCurrencies || []);
          setSummaryError(summaryFallbackMessage(fallback));
        }
      })
      .finally(() => {
        if (active) setSummaryLoading(false);
      });
    return () => {
      active = false;
    };
  }, [customer]);

  const usdRates = useMemo(() => {
    const rates = new Map<Currency, UsdRate>();
    rates.set('USD', { rate: 1, source: 'parity' });
    summary?.distribution.forEach((item) => {
      const rate = Number(item.reportingRate);
      if (Number.isFinite(rate) && rate > 0) {
        rates.set(item.currency, {
          rate,
          source: lastKnownRateCurrencies.includes(item.currency) ? 'last_known' : 'book',
        });
      }
    });
    return rates;
  }, [lastKnownRateCurrencies, summary]);

  const accounts = (customer?.accounts || []).filter((row) => {
    if (tab === 'wallet') return row.kind === 'SYSTEM_WALLET';
    if (tab === 'va') return row.kind === 'VIRTUAL_ACCOUNT';
    if (tab === 'crypto') return row.kind === 'CRYPTO_WALLET';
    return ['SYSTEM_WALLET', 'VIRTUAL_ACCOUNT', 'CRYPTO_WALLET'].includes(row.kind);
  });
  return (
    <>
      <Helmet>
        <title>{portalText('账户与资产')} | {APP_DISPLAY_NAME}</title>
      </Helmet>
      <Container maxWidth="xl">
        <Stack spacing={3}>
          <CustomBreadcrumbs
            heading={portalText('资产与账户')}
            links={[
              { name: portalText('账户概览'), href: '/portal/home' },
              { name: portalText('账户与资产') },
            ]}
            action={
              <Button
                variant="contained"
                startIcon={<Iconify icon="solar:add-circle-linear" />}
                onClick={() => setVaOpen(true)}
              >
                {portalText('申请 VA 账户')}
              </Button>
            }
          />

          <Typography color="text.secondary" sx={{ mt: -2 }}>
            {portalText('查看 USD、HKD 与 USDT 的账面余额、冻结金额及可用余额。')}
          </Typography>
          {error && (
            <Alert
              severity={summary ? 'warning' : 'error'}
              action={
                <Button
                  color="inherit"
                  size="small"
                  onClick={() => refresh().catch(() => undefined)}
                >
                  {portalText('刷新数据')}
                </Button>
              }
            >
              {error}
            </Alert>
          )}
          {summaryError && <Alert severity={summary ? 'warning' : 'error'}>{summaryError}</Alert>}
          <AssetOverview
            summary={summary}
            loading={summaryLoading}
            usingLastKnownRates={lastKnownRateCurrencies.length > 0}
          />

          <Card>
            <Tabs
              value={tab}
              onChange={(_, value) => setTab(value)}
              variant="scrollable"
              scrollButtons="auto"
              sx={{ px: 2 }}
            >
              <Tab value="all" label={portalText('全部')} />
              <Tab value="wallet" label={SYSTEM_WALLET_PRODUCT_NAME} />
              <Tab value="va" label={portalText('VA 账户')} />
              <Tab value="crypto" label={portalText('数字资产账户')} />
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
                {portalText('账户')}
              </Typography>
              <Typography variant="caption" color="text.secondary">
                {portalText('类型')}
              </Typography>
              <Typography variant="caption" color="text.secondary" textAlign="right">
                {portalText('可用余额')}
              </Typography>
              <Typography variant="caption" color="text.secondary" textAlign="right">
                {portalText('冻结余额')}
              </Typography>
              <Box sx={{ textAlign: 'right' }}>
                <Typography variant="caption" color="text.secondary" display="block">
                  {portalText('美元折算价值')}
                </Typography>
                <Typography variant="caption" color="text.disabled">
                  {portalText('含冻结')}
                </Typography>
              </Box>
              <Typography variant="caption" color="text.secondary" textAlign="right">
                {portalText('操作')}
              </Typography>
            </Box>
            {accounts.map((account, index) => (
              <AccountListRow
                key={account.id}
                account={account}
                usdValuation={accountUsdValuation(account, usdRates)}
                valuationLoading={summaryLoading}
                divider={index < accounts.length - 1}
                onOpen={() => setSelected(account)}
              />
            ))}
          </Card>
          {!accounts.length && (
            <Card sx={{ py: 8, textAlign: 'center' }}>
              <Typography color="text.secondary">{portalText('当前分类下暂无账户')}</Typography>
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
  source: 'market' | 'book' | 'parity' | 'last_known';
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

function AssetOverview({
  summary,
  loading,
  usingLastKnownRates,
}: {
  summary: AssetSummary | null;
  loading: boolean;
  usingLastKnownRates: boolean;
}) {
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
    ? new Intl.DateTimeFormat(portalLocale(), {
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      }).format(new Date(summary.asOf))
    : '';
  const ratesAsOf = summary?.ratesAsOf
    ? new Intl.DateTimeFormat(portalLocale(), {
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      }).format(new Date(summary.ratesAsOf))
    : '';
  let valuationTime = '';
  if (usingLastKnownRates && ratesAsOf)
    valuationTime = portalText('· 汇率截至 {{value0}}', { value0: ratesAsOf });
  else if (asOf) valuationTime = ` · ${asOf}`;

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
                {portalText('资产总览')}
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
                {portalText('多币种资产美元折算价值')}
                {valuationTime}
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
              {portalText('参考估值')}
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
              label={portalText('可用余额')}
              value={summary ? money(summary.totalAvailable, 'USD') : '$0.00'}
              loading={loading}
            />

            <AssetMetric
              label={portalText('冻结余额')}
              value={summary ? money(summary.totalFrozen, 'USD') : '$0.00'}
              loading={loading}
            />

            <AssetMetric
              label={portalText('资产账户')}
              value={portalText('{{value0}} 个', { value0: summary?.accountCount || 0 })}
              loading={loading}
            />
          </Box>
        </CardContent>
      </Card>

      <Card sx={{ boxShadow: 'none', border: '1px solid', borderColor: 'divider' }}>
        <CardContent sx={{ p: { xs: 3, sm: 3.5 } }}>
          <Stack direction="row" justifyContent="space-between" alignItems="baseline">
            <Box>
              <Typography variant="h6">{portalText('资产分布')}</Typography>
              <Typography variant="caption" color="text.secondary">
                {portalText('按美元参考估值计算')}
              </Typography>
            </Box>
            <Typography variant="caption" color="text.secondary">
              {summary?.distribution.length || 0}
              {portalText('个币种')}
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
              aria-label={portalText('资产币种分布图')}
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
                  {portalText('币种')}
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
                  {portalText('账户产生余额后，将在这里显示资产分布。')}
                </Typography>
              )}
            </Stack>
          </Box>
          {summary?.valuationStatus === 'partial' && (
            <Alert severity="warning" sx={{ mt: 2.5 }}>
              {summary.missingRates.join('、')}
              {portalText('暂无有效估值汇率，未计入总资产。')}
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
          {item.reportingValue ? money(item.reportingValue, 'USD') : portalText('暂不可估值')}
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
  const [channels, setChannels] = useState<FundingChannel[]>([]);
  const [channelId, setChannelId] = useState('');
  const [purpose, setPurpose] = useState(portalText('接收客户货款'));
  const [error, setError] = useState('');
  const selectedChannel = channels.find((channel) => channel.id === channelId);

  useEffect(() => {
    if (!open) return;
    coreApi<FundingChannel[]>(
      `/funding-channels?organizationId=${demoOrganizationId}&type=VIRTUAL_ACCOUNT&active=true`
    )
      .then((rows) => {
        setChannels(rows);
        const first = rows[0];
        setChannelId(first?.id || '');
        if (first?.supportedCurrencies[0]) setCurrency(first.supportedCurrencies[0]);
      })
      .catch((value) =>
        setError(
          value instanceof Error ? value.message : portalText('暂时无法读取可选银行，请稍后重试。')
        )
      );
  }, [open]);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError('');
    try {
      await coreApi<VirtualAccountRequest>(`/customers/${customerId}/virtual-account-requests`, {
        method: 'POST',
        body: JSON.stringify({ channelId, currency, purpose }),
      });
      onCreated();
    } catch (value) {
      setError(
        value instanceof Error ? value.message : portalText('VA 账户申请暂时无法提交，请稍后重试。')
      );
    }
  };
  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="sm">
      <Box component="form" onSubmit={submit}>
        <DialogTitle>{portalText('申请 VA 账户')}</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ mt: 1 }}>
            {error && <Alert severity="error">{error}</Alert>}
            <FormControl fullWidth required>
              <InputLabel>{portalText('银行')}</InputLabel>
              <Select
                label={portalText('银行')}
                value={channelId}
                onChange={(event) => {
                  const nextId = event.target.value;
                  const channel = channels.find((item) => item.id === nextId);
                  setChannelId(nextId);
                  if (channel?.supportedCurrencies[0]) setCurrency(channel.supportedCurrencies[0]);
                }}
              >
                {channels.map((channel) => (
                  <MenuItem key={channel.id} value={channel.id}>
                    {channel.settlementBankName || channel.name}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
            {selectedChannel ? (
              <Alert severity="info">
                {selectedChannel.bankCountry || '--'} · SWIFT {selectedChannel.swiftBic || '—'}
                <br />
                {portalText('支持币种：')}
                {selectedChannel.supportedCurrencies.join(' / ')}
              </Alert>
            ) : (
              <Alert severity="warning">{portalText('当前暂无可受理 VA 账户申请的银行。')}</Alert>
            )}
            <FormControl fullWidth required disabled={!selectedChannel}>
              <InputLabel>{portalText('币种')}</InputLabel>
              <Select
                label={portalText('币种')}
                value={currency}
                onChange={(event) => setCurrency(event.target.value as Currency)}
              >
                {(selectedChannel?.supportedCurrencies || []).map((item) => (
                  <MenuItem key={item} value={item}>
                    {item}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
            <TextField
              required
              label={portalText('账户用途')}
              value={purpose}
              onChange={(event) => setPurpose(event.target.value)}
              multiline
              minRows={2}
            />

            <Alert severity="info">
              {portalText(
                '申请提交后将进入审核。账户开通后，本页会显示银行、账号及 SWIFT/BIC 信息。'
              )}
            </Alert>
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={onClose}>{portalText('取消')}</Button>
          <Button type="submit" variant="contained" disabled={!selectedChannel}>
            {portalText('提交申请')}
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
  let mobileValuationLabel = portalText('美元价值暂不可估值');
  if (valuationLoading) mobileValuationLabel = portalText('正在计算美元价值…');
  else if (usdValuation) {
    mobileValuationLabel = portalText('{{value0}} 美元价值', {
      value0: money(usdValuation.value, 'USD'),
    });
  }
  let valuationSourceLabel = portalText('账面参考值');
  if (usdValuation?.source === 'last_known') valuationSourceLabel = portalText('按最近有效汇率');
  else if (usdValuation?.source === 'market') valuationSourceLabel = portalText('按当前市场汇率');
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
          {portalText('可用')}
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
          {crypto ? portalText('管理账户') : portalText('查看账户资料')}
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
              {usdValuation ? money(usdValuation.value, 'USD') : portalText('暂不可估值')}
            </Typography>
            <Typography variant="caption" color="text.secondary">
              {valuationSourceLabel}
            </Typography>
          </>
        )}
      </Box>
      <Box sx={{ display: { xs: 'none', md: 'flex' }, justifyContent: 'flex-end' }}>
        {crypto ? (
          <Button size="small" href="/portal/crypto-wallet">
            {portalText('管理账户')}
          </Button>
        ) : (
          <Button size="small" onClick={onOpen}>
            {portalText('查看账户资料')}
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
      <DialogTitle>
        {isVa
          ? portalText('使用专属 VA 收款')
          : portalText('{{value0}} 入账信息', { value0: account.currency })}
      </DialogTitle>
      <DialogContent>
        <Alert severity="info" sx={{ mb: 2 }}>
          {portalText(
            '请确保汇款人名称与客户资料一致。银行来账核验及清算完成后，可用余额将自动更新。'
          )}
        </Alert>
        <Stack divider={<Divider flexItem />}>
          <Detail label={portalText('账户名称')} value={account.name} />
          <Detail
            label={portalText('开户银行')}
            value={account.bankName || portalText('SSC数字银行服务银行')}
          />

          {isVa && <Detail label={portalText('银行地址')} value={account.bankAddress || '-'} />}

          <Detail label={portalText('账户号码')} value={account.accountNumber || '-'} mono />

          <Detail label="SWIFT / BIC" value={account.swiftBic || '-'} mono />
          <Detail label={portalText('币种')} value={account.currency} />
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>{portalText('关闭')}</Button>
        <Button
          variant="contained"
          onClick={() => navigator.clipboard?.writeText(account.accountNumber || '')}
        >
          {portalText('复制账户号码')}
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
