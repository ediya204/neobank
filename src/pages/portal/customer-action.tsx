import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import { Helmet } from 'react-helmet-async';
import { useSearchParams } from 'react-router-dom';
import {
  Alert,
  Box,
  Button,
  ButtonBase,
  Card,
  CardContent,
  CircularProgress,
  Container,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  FormControl,
  InputAdornment,
  InputLabel,
  MenuItem,
  Select,
  Stack,
  Step,
  StepLabel,
  Stepper,
  Tab,
  Tabs,
  TextField,
  Typography,
} from '@mui/material';
import Iconify from 'src/components/iconify';
import AssetIcon from 'src/components/asset-icon';
import CustomBreadcrumbs from 'src/components/custom-breadcrumbs';
import Label from 'src/components/label';
import { useAuthContext } from 'src/auth/hooks';
import BeneficiaryDialog from 'src/features/finance/beneficiary-dialog';
import { usePortalCustomer } from 'src/features/finance/portal-customer-context';
import {
  coreApi,
  Beneficiary,
  Customer,
  customerAuthApi,
  FundingChannel,
  isSupportedPortalAccount,
  neobankApi,
  Operation,
  OperationType,
  RateVersion,
  WithdrawalFeeRule,
  supportedFiatCurrencies,
} from 'src/features/finance/core-api';
import {
  formatConversionAmount,
  resolveConversionQuote,
} from 'src/features/finance/conversion-quote';
import {
  mergeLiveCustomerWallets,
  OtcDirection,
  otcSourceAccounts,
  otcTargetAccounts,
} from 'src/features/finance/otc-account-selection';
import { portalLocale, portalText } from 'src/locales/portal-text';
import { accountLabel, money } from './customer-shared';

export type CustomerAction = 'transfer' | 'fx' | 'otc' | 'payout' | 'beneficiaries';

type PayoutMethod = 'PLATFORM' | 'POBO' | 'VA';

type CustomerWithdrawalAddressRow = {
  id: string;
  label: string;
  network: 'TRON';
  address: string;
  status: 'active' | 'revoked' | 'suspended';
  verified_at: string;
  revoked_at?: string | null;
};

const payoutMethods: Array<{
  value: PayoutMethod;
  title: string;
  description: string;
  icon: string;
}> = [
  {
    value: 'PLATFORM',
    title: '代付',
    description: '通过平台合作银行向收款人付款',
    icon: 'solar:buildings-2-bold-duotone',
  },
  {
    value: 'POBO',
    title: 'POBO',
    description: '以客户名义向已登记收款人付款',
    icon: 'solar:user-check-bold-duotone',
  },
  {
    value: 'VA',
    title: 'VA 转出',
    description: '从客户名下的 USD / HKD VA 账户付款',
    icon: 'solar:wallet-money-bold-duotone',
  },
];

const copy: Record<CustomerAction, { title: string; description: string; icon: string }> = {
  transfer: {
    title: '账户内划转',
    description: '在本人名下的同币种账户之间划转资金。',
    icon: 'solar:transfer-horizontal-bold-duotone',
  },
  fx: {
    title: '法币兑换',
    description: '按当前报价在 USD 与 HKD 账户之间兑换。',
    icon: 'solar:refresh-square-bold-duotone',
  },
  otc: {
    title: 'OTC 兑换',
    description: '按实时报价使用法币买入 USDT，或卖出 USDT 接收法币。',
    icon: 'solar:hand-money-bold-duotone',
  },
  payout: {
    title: '银行转出',
    description: '向已登记的银行收款人提交 USD / HKD 付款申请。',
    icon: 'solar:upload-minimalistic-bold-duotone',
  },
  beneficiaries: {
    title: '转出白名单',
    description: '管理经两步验证的法币银行账户及数字货币地址。',
    icon: 'solar:user-id-bold-duotone',
  },
};

export default function CustomerActionPage({
  action,
  submissionDisabledReason,
}: {
  action: CustomerAction;
  submissionDisabledReason?: string;
}) {
  const [searchParams] = useSearchParams();
  const { user } = useAuthContext();
  const { customer, refresh } = usePortalCustomer();
  const customerSession = user?.role === 'customer';
  const [detail, setDetail] = useState<Customer | null>(null);
  const [customerCryptoBeneficiaries, setCustomerCryptoBeneficiaries] = useState<Beneficiary[]>([]);
  const [channels, setChannels] = useState<FundingChannel[]>([]);
  const [rates, setRates] = useState<RateVersion[]>([]);
  const [ratesLoading, setRatesLoading] = useState(false);
  const [ratesError, setRatesError] = useState('');
  const [withdrawalFees, setWithdrawalFees] = useState<WithdrawalFeeRule[]>([]);
  const [sourceId, setSourceId] = useState('');
  const [targetId, setTargetId] = useState('');
  const [beneficiaryId, setBeneficiaryId] = useState('');
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [otcDirection, setOtcDirection] = useState<OtcDirection>(() =>
    searchParams.get('source') === 'USDT' ? 'SELL_USDT' : 'BUY_USDT'
  );
  const [payoutMethod, setPayoutMethod] = useState<PayoutMethod>('PLATFORM');
  const [beneficiaryOpen, setBeneficiaryOpen] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [pendingQuote, setPendingQuote] = useState<Operation | null>(null);
  const [quoteCountdownMs, setQuoteCountdownMs] = useState(0);
  let conversionType: RateVersion['type'] | null = null;
  if (action === 'fx') conversionType = 'FX';
  if (action === 'otc') conversionType = 'OTC';

  const loadRates = useCallback(async () => {
    if (!conversionType) {
      setRates([]);
      setRatesError('');
      setRatesLoading(false);
      return;
    }
    setRatesLoading(true);
    try {
      const rows = await coreApi<RateVersion[]>(`/rates?type=${conversionType}`);
      setRates(rows);
      setRatesError('');
    } catch (value) {
      setRatesError(
        value instanceof Error ? value.message : portalText('暂时无法获取实时报价，请稍后重试。')
      );
    } finally {
      setRatesLoading(false);
    }
  }, [conversionType]);

  const loadDetail = async () => {
    if (!customer) return;
    const loadPayoutConfiguration = action === 'payout' && !submissionDisabledReason;
    const [customerDetail, channelRows, feeRows, withdrawalAddressPayload] = await Promise.all([
      coreApi<Customer>(`/customers/${customer.id}`),
      loadPayoutConfiguration
        ? coreApi<FundingChannel[]>(`/funding-channels?organizationId=${customer.organizationId}`)
        : Promise.resolve([] as FundingChannel[]),
      loadPayoutConfiguration
        ? coreApi<WithdrawalFeeRule[]>(
            `/withdrawal-fees?organizationId=${customer.organizationId}&active=true`
          )
        : Promise.resolve([] as WithdrawalFeeRule[]),
      action === 'beneficiaries' && customerSession
        ? neobankApi<{ data: CustomerWithdrawalAddressRow[] }>(
            '/customer/withdrawal-addresses'
          )
        : Promise.resolve(null),
    ]);
    setDetail(customerDetail);
    setChannels(channelRows);
    setWithdrawalFees(feeRows);
    setCustomerCryptoBeneficiaries(
      withdrawalAddressPayload
        ? withdrawalAddressPayload.data.map((row) => ({
            id: row.id,
            customerId: customer.id,
            type: 'CRYPTO' as const,
            name: row.label,
            currency: 'USDT' as const,
            walletAddress: row.address,
            network: row.network,
            active: row.status === 'active',
            status: row.status.toUpperCase() as Beneficiary['status'],
            verifiedAt: row.verified_at,
            revokedAt: row.revoked_at || undefined,
          }))
        : []
    );
  };

  useEffect(() => {
    loadDetail().catch((value) =>
      setError(
        value instanceof Error ? value.message : portalText('暂时无法读取账户资料，请稍后重试。')
      )
    );
  }, [customer?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!conversionType) return undefined;
    loadRates().catch(() => undefined);
    const intervalId = window.setInterval(() => loadRates().catch(() => undefined), 60 * 1000);
    return () => window.clearInterval(intervalId);
  }, [conversionType, loadRates]);

  const accounts = useMemo(() => {
    const mergedAccounts = mergeLiveCustomerWallets(
      detail?.accounts || [],
      customer?.accounts || []
    );
    return mergedAccounts.filter(
      (row) =>
        ['SYSTEM_WALLET', 'VIRTUAL_ACCOUNT', 'CRYPTO_WALLET'].includes(row.kind) &&
        row.status === 'ACTIVE' &&
        isSupportedPortalAccount(row)
    );
  }, [customer?.accounts, detail?.accounts]);
  const source = accounts.find((row) => row.id === sourceId);
  const targets = useMemo(
    () =>
      action === 'otc'
        ? otcTargetAccounts(accounts, otcDirection, sourceId)
        : accounts.filter((row) => {
            if (!source || row.id === source.id) return false;
            if (action === 'transfer') return row.currency === source.currency;
            if (action === 'fx')
              return row.kind !== 'CRYPTO_WALLET' && row.currency !== source.currency;
            return false;
          }),
    [accounts, action, otcDirection, source, sourceId]
  );
  const beneficiaries = (detail?.beneficiaries || []).filter(
    (row) => row.type === 'BANK' && row.active
  );
  const selectedBeneficiary = beneficiaries.find((row) => row.id === beneficiaryId);
  const sourceOptions = useMemo(() => {
    if (action === 'payout') {
      return accounts.filter((row) => {
        if (!selectedBeneficiary || row.currency !== selectedBeneficiary.currency) return false;
        const expectedKind = payoutMethod === 'VA' ? 'VIRTUAL_ACCOUNT' : 'SYSTEM_WALLET';
        return row.kind === expectedKind && supportedFiatCurrencies.includes(row.currency);
      });
    }
    if (action === 'otc') return otcSourceAccounts(accounts, otcDirection);
    return accounts.filter(
      (row) => row.kind === 'SYSTEM_WALLET' && supportedFiatCurrencies.includes(row.currency)
    );
  }, [accounts, action, otcDirection, payoutMethod, selectedBeneficiary]);
  let sourceFieldLabel = action === 'payout' ? portalText('付款账户') : portalText('从账户');
  if (action === 'otc') {
    sourceFieldLabel =
      otcDirection === 'BUY_USDT' ? portalText('付款账户') : portalText('USDT 账户');
  }
  const targetFieldLabel =
    action === 'otc' && otcDirection === 'BUY_USDT'
      ? portalText('到账 USDT 账户')
      : portalText('到账账户');
  const payoutChannel =
    action === 'payout' && source
      ? channels.find(
          (row) =>
            row.type === payoutChannelType(payoutMethod) &&
            row.active &&
            row.supportedCurrencies.includes(source.currency) &&
            (payoutMethod !== 'VA' || row.id === source.fundingChannelId)
        )
      : undefined;
  const payoutFee = payoutChannel
    ? withdrawalFees.find(
        (row) =>
          row.assetClass === 'FIAT' &&
          row.currency === source?.currency &&
          row.method === payoutMethod &&
          row.channelCode === payoutChannel.code &&
          row.active
      )
    : undefined;
  const target = accounts.find((row) => row.id === targetId);
  const quote = useMemo(
    () =>
      conversionType
        ? resolveConversionQuote({
            type: conversionType,
            source,
            target,
            amount,
            rates,
            loading: ratesLoading,
          })
        : null,
    [amount, conversionType, rates, ratesLoading, source, target]
  );
  const readyQuote =
    quote?.status === 'ready' && quote.rate && quote.received !== undefined
      ? { rate: quote.rate, received: quote.received }
      : null;
  const quoteReady = Boolean(readyQuote);
  const quoteInvalid = quote?.status === 'unavailable' || quote?.status === 'stale';
  let quoteHelperText = portalText('选择付款与收款账户并输入金额后获取报价');
  if (quote?.status === 'loading') quoteHelperText = portalText('正在获取实时报价…');
  if (quote?.status === 'unavailable') {
    quoteHelperText = ratesError
      ? portalText('实时报价加载失败，请稍后重试')
      : portalText('当前币种组合暂无有效报价，请稍后重试');
  }
  if (quote?.status === 'stale') quoteHelperText = portalText('报价已过期，正在重新获取实时报价');
  if (readyQuote) {
    quoteHelperText = portalText(
      '按当前实时报价估算{{value0}}；确认前将重新取价并锁定最终成交金额',
      {
        value0: readyQuote.rate.marketUpdatedAt
          ? portalText('· 行情时间 {{value0}}', {
              value0: new Date(readyQuote.rate.marketUpdatedAt).toLocaleString(portalLocale()),
            })
          : '',
      }
    );
  }

  useEffect(() => {
    setTargetId('');
    setAmount('');
  }, [sourceId]);
  useEffect(() => {
    if (action === 'payout') setSourceId('');
  }, [action, beneficiaryId, payoutMethod]);

  useEffect(() => {
    if (action !== 'otc' || !sourceOptions.length) return;
    const requestedSource = searchParams.get('source');
    const currentSourceIsValid = sourceOptions.some((row) => row.id === sourceId);
    if (currentSourceIsValid) return;
    const preferredSource = sourceOptions.find((row) => row.currency === requestedSource);
    const nextSource = preferredSource || (sourceOptions.length === 1 ? sourceOptions[0] : null);
    setSourceId(nextSource?.id || '');
  }, [action, searchParams, sourceId, sourceOptions]);

  useEffect(() => {
    if (action !== 'otc' || !source) return;
    if (targets.some((row) => row.id === targetId)) return;
    const requestedTargetKind = searchParams.get('targetKind');
    const preferredTarget = targets.find((row) => row.kind === requestedTargetKind);
    const nextTarget = preferredTarget || (targets.length === 1 ? targets[0] : null);
    setTargetId(nextTarget?.id || '');
  }, [action, searchParams, source, targetId, targets]);

  useEffect(() => {
    if (!pendingQuote?.quoteExpiresAt) return undefined;
    const updateCountdown = () => {
      setQuoteCountdownMs(Math.max(0, Date.parse(pendingQuote.quoteExpiresAt || '') - Date.now()));
    };
    updateCountdown();
    const intervalId = window.setInterval(updateCountdown, 100);
    return () => window.clearInterval(intervalId);
  }, [pendingQuote?.id, pendingQuote?.quoteExpiresAt]);

  const changeOtcDirection = (direction: OtcDirection) => {
    if (direction === otcDirection) return;
    setOtcDirection(direction);
    setSourceId('');
    setTargetId('');
    setAmount('');
    setError('');
  };

  const insufficientBalance = Boolean(
    source && amount && Number(amount) > Number(source.availableBalance)
  );
  const availableBalanceLabel = source ? money(source.availableBalance, source.currency) : '';
  let amountHelperText = portalText('请先选择付款账户');
  if (action === 'otc' && otcDirection === 'SELL_USDT') {
    amountHelperText = portalText('请先选择 USDT 账户');
  }
  if (source)
    amountHelperText = portalText('可用余额 {{value0}}', {
      value0: availableBalanceLabel,
    });
  if (insufficientBalance)
    amountHelperText = portalText('金额超过可用余额 {{value0}}', {
      value0: availableBalanceLabel,
    });

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!customer) return;
    if (submissionDisabledReason) {
      setError(portalText(submissionDisabledReason));
      return;
    }
    if (conversionType && !quoteReady) {
      setError(portalText('当前报价已失效，请重新获取报价后再确认。'));
      return;
    }
    setError('');
    setSuccess('');
    setSubmitting(true);
    try {
      const sourceAccount = accounts.find((row) => row.id === sourceId);
      const targetAccount = accounts.find((row) => row.id === targetId);
      if (!sourceAccount || !amount || Number(amount) <= 0)
        throw new Error(portalText('请选择付款账户并输入有效金额'));
      let type: OperationType = 'INTERNAL_TRANSFER';
      const payload: Record<string, unknown> = {
        customerId: customer.id,
        sourceAccountId: sourceAccount.id,
        currency: sourceAccount.currency,
        amount,
        feeAmount: '0',
        narrative: note,
        idempotencyKey: crypto.randomUUID(),
      };
      if (action === 'transfer' || action === 'fx' || action === 'otc') {
        if (!targetAccount) throw new Error(portalText('请选择收款账户'));
        payload.targetAccountId = targetAccount.id;
      }
      if (action === 'fx') {
        type = 'FX';
        payload.quoteCurrency = targetAccount?.currency;
      }
      if (action === 'otc') {
        type = 'OTC';
        payload.quoteCurrency = targetAccount?.currency;
      }
      if (action === 'payout') {
        type = 'PAYOUT';
        if (!selectedBeneficiary) throw new Error(portalText('请选择第三方收款人'));
        const channel = payoutChannel;
        if (!channel) {
          throw new Error(
            payoutMethod === 'VA'
              ? portalText('所选 VA 账户未绑定可用的开户银行通道')
              : portalText('当前付款方式暂不支持该币种')
          );
        }
        if (!payoutFee) throw new Error(portalText('当前渠道尚未配置转出手续费'));
        Object.assign(payload, {
          beneficiaryId: selectedBeneficiary.id,
          payoutMethod,
          channelId: channel.id,
          expectedFeeAmount: payoutFee.amount,
          expectedFeeRuleVersion: payoutFee.version,
        });
      }
      payload.type = type;
      const operationPath = action === 'otc' ? '/operations/quote' : '/operations';
      const created = await coreApi<Operation>(operationPath, {
        method: 'POST',
        body: JSON.stringify(payload),
      });
      if (action === 'otc') {
        if (!created.quoteExpiresAt || !created.rate || !created.quoteAmount) {
          throw new Error(portalText('服务端未返回完整的确认报价'));
        }
        setQuoteCountdownMs(Math.max(0, Date.parse(created.quoteExpiresAt) - Date.now()));
        setPendingQuote(created);
        return;
      }
      let successMessage = portalText('申请已提交审核。处理完成后，账户余额将自动更新。');
      if (action === 'payout') {
        successMessage = portalText('付款申请已提交。审核通过后将由银行或支付通道执行。');
      } else if (action === 'fx' && created.rate && created.quoteAmount && created.quoteCurrency) {
        successMessage = portalText(
          '成交报价已锁定：1 {{value0}} = {{value1}} {{value2}}，预计到账 {{value3}}。',
          {
            value0: created.currency,
            value1: created.rate,
            value2: created.quoteCurrency,
            value3: money(created.quoteAmount, created.quoteCurrency),
          }
        );
      }
      setSuccess(successMessage);
      setAmount('');
      setNote('');
      await Promise.all([loadDetail(), refresh(), loadRates()]);
    } catch (value) {
      setError(
        value instanceof Error ? value.message : portalText('申请暂时无法提交，请稍后重试。')
      );
    } finally {
      setSubmitting(false);
    }
  };

  const confirmPendingQuote = async () => {
    if (!pendingQuote || quoteCountdownMs <= 0) return;
    setError('');
    setSuccess('');
    setSubmitting(true);
    try {
      const completed = await coreApi<Operation>(`/operations/${pendingQuote.id}/confirm`, {
        method: 'POST',
        body: JSON.stringify({}),
      });
      setPendingQuote(null);
      setQuoteCountdownMs(0);
      setSuccess(
        portalText('兑换已完成：1 {{value0}} = {{value1}} {{value2}}，到账 {{value3}}。', {
          value0: completed.currency,
          value1: completed.rate,
          value2: completed.quoteCurrency,
          value3: money(completed.quoteAmount || '0', completed.quoteCurrency || 'USDT'),
        })
      );
      setAmount('');
      setNote('');
      await Promise.all([loadDetail(), refresh(), loadRates()]);
    } catch (value) {
      const message =
        value instanceof Error ? value.message : portalText('暂时无法完成兑换，请重新获取报价。');
      if (message.includes('quote_expired')) {
        setQuoteCountdownMs(0);
        setError(portalText('报价已失效，请重新获取报价。'));
      } else {
        setError(message);
      }
    } finally {
      setSubmitting(false);
    }
  };

  let submissionInfoText = portalText('提交后将进入审核流程，您可在交易明细中随时查看处理进度。');
  if (submissionDisabledReason) {
    submissionInfoText = portalText('当前仅提供账户与报价查询，不会创建或执行资金交易。');
  } else if (action === 'otc') {
    submissionInfoText = portalText(
      '成交报价有效期为 15 秒。确认后将立即完成兑换并更新余额，交易不可撤销。'
    );
  }
  let quoteConfirmButtonText = portalText('报价已失效');
  if (submitting) quoteConfirmButtonText = portalText('正在执行…');
  else if (quoteCountdownMs > 0) {
    quoteConfirmButtonText = portalText('确认执行（{{value0}}）', {
      value0: Math.ceil(quoteCountdownMs / 1000),
    });
  }

  if (action === 'beneficiaries')
    return (
      <BeneficiaryPage
        customer={detail}
        readOnlyReason={submissionDisabledReason}
        onCreate={() => setBeneficiaryOpen(true)}
        onReload={loadDetail}
        dialogOpen={beneficiaryOpen}
        setDialogOpen={setBeneficiaryOpen}
        customerSession={customerSession}
        totpEnabled={Boolean(user?.totpEnabled)}
        customerCryptoBeneficiaries={customerCryptoBeneficiaries}
      />
    );

  const info = copy[action];
  return (
    <>
      <Helmet>
        <title>{portalText(info.title)} | SSC Digital Bank</title>
      </Helmet>
      <Container maxWidth="md">
        <Stack spacing={3}>
          <CustomBreadcrumbs
            heading={portalText(info.title)}
            links={[
              {
                name: portalText('收付与兑换'),
                href: '/portal/money/transfers',
              },
              { name: portalText(info.title) },
            ]}
          />

          <Typography color="text.secondary" sx={{ mt: -2 }}>
            {portalText(info.description)}
          </Typography>
          {submissionDisabledReason && (
            <Alert severity="info">
              {portalText(submissionDisabledReason)} {portalText('历史记录可在“交易明细”中查询。')}
            </Alert>
          )}
          {error && (
            <Alert
              severity="error"
              action={
                <Button
                  color="inherit"
                  size="small"
                  onClick={() => {
                    setError('');
                    loadDetail().catch(() =>
                      setError(portalText('账户资料暂时无法读取，请刷新页面或重新登录后重试。'))
                    );
                    loadRates().catch(() => undefined);
                  }}
                >
                  {portalText('重新加载')}
                </Button>
              }
            >
              {error}
            </Alert>
          )}
          {success && (
            <Alert severity="success" onClose={() => setSuccess('')}>
              {success}
            </Alert>
          )}
          <Card>
            <CardContent sx={{ p: { xs: 2.5, md: 4 } }}>
              <Stepper activeStep={0} sx={{ mb: 4, display: { xs: 'none', sm: 'flex' } }}>
                <Step>
                  <StepLabel>{portalText('填写交易信息')}</StepLabel>
                </Step>
                <Step>
                  <StepLabel>
                    {action === 'otc' ? portalText('确认成交') : portalText('审核处理')}
                  </StepLabel>
                </Step>
                <Step>
                  <StepLabel>{portalText('完成')}</StepLabel>
                </Step>
              </Stepper>
              <Box component="form" onSubmit={submit}>
                <Stack spacing={2.5}>
                  {action === 'payout' && (
                    <>
                      <Typography variant="h6">{portalText('选择转出方式')}</Typography>
                      <Box
                        sx={{
                          display: 'grid',
                          gridTemplateColumns: { xs: '1fr', sm: 'repeat(3, 1fr)' },
                          gap: 1.5,
                        }}
                      >
                        {payoutMethods.map((method) => {
                          const selected = payoutMethod === method.value;
                          return (
                            <ButtonBase
                              key={method.value}
                              onClick={() => setPayoutMethod(method.value)}
                              sx={{
                                p: 2,
                                borderRadius: 1.5,
                                border: '1px solid',
                                borderColor: selected ? 'primary.main' : 'divider',
                                bgcolor: selected ? 'primary.lighter' : 'background.paper',
                                textAlign: 'left',
                                alignItems: 'flex-start',
                                '&:hover': { borderColor: 'primary.main' },
                              }}
                            >
                              <Stack spacing={1} sx={{ width: 1 }}>
                                <Stack
                                  direction="row"
                                  alignItems="center"
                                  justifyContent="space-between"
                                >
                                  <Iconify icon={method.icon} width={26} color="primary.main" />
                                  {selected && (
                                    <Label color="primary">{portalText('已选择')}</Label>
                                  )}
                                </Stack>
                                <Typography variant="subtitle2">
                                  {portalText(method.title)}
                                </Typography>
                                <Typography variant="caption" color="text.secondary">
                                  {portalText(method.description)}
                                </Typography>
                              </Stack>
                            </ButtonBase>
                          );
                        })}
                      </Box>
                      <Stack
                        direction={{ xs: 'column', sm: 'row' }}
                        justifyContent="space-between"
                        gap={1}
                      >
                        <Typography variant="h6">{portalText('第三方收款人')}</Typography>
                        <Button
                          startIcon={<Iconify icon="solar:add-circle-linear" />}
                          onClick={() => setBeneficiaryOpen(true)}
                        >
                          {portalText('新增收款人')}
                        </Button>
                      </Stack>
                      <FormControl required fullWidth>
                        <InputLabel>{portalText('选择收款人')}</InputLabel>
                        <Select
                          label={portalText('选择收款人')}
                          value={beneficiaryId}
                          onChange={(event) => setBeneficiaryId(event.target.value)}
                        >
                          {beneficiaries.map((row) => (
                            <MenuItem key={row.id} value={row.id}>
                              <Stack>
                                <Typography variant="subtitle2">{row.name}</Typography>
                                <Typography variant="caption" color="text.secondary">
                                  {row.bankName} · {row.currency} · ••••
                                  {row.accountNumber?.slice(-4)}
                                </Typography>
                              </Stack>
                            </MenuItem>
                          ))}
                        </Select>
                      </FormControl>
                      {selectedBeneficiary && (
                        <Card variant="outlined" sx={{ bgcolor: 'background.neutral' }}>
                          <CardContent sx={{ p: 2.5 }}>
                            <Stack spacing={1.25}>
                              <Stack direction="row" justifyContent="space-between" gap={2}>
                                <Typography variant="body2" color="text.secondary">
                                  {portalText('收款人')}
                                </Typography>
                                <Typography variant="subtitle2">
                                  {selectedBeneficiary.name}
                                </Typography>
                              </Stack>
                              <Stack direction="row" justifyContent="space-between" gap={2}>
                                <Typography variant="body2" color="text.secondary">
                                  {portalText('收款银行')}
                                </Typography>
                                <Typography variant="subtitle2">
                                  {selectedBeneficiary.bankName}
                                </Typography>
                              </Stack>
                              <Stack direction="row" justifyContent="space-between" gap={2}>
                                <Typography variant="body2" color="text.secondary">
                                  {portalText('币种与账号')}
                                </Typography>
                                <Typography variant="subtitle2">
                                  {selectedBeneficiary.currency} · ••••
                                  {selectedBeneficiary.accountNumber?.slice(-4)}
                                </Typography>
                              </Stack>
                              <Stack direction="row" justifyContent="space-between" gap={2}>
                                <Typography variant="body2" color="text.secondary">
                                  SWIFT / BIC
                                </Typography>
                                <Typography variant="subtitle2">
                                  {selectedBeneficiary.swiftBic || '—'}
                                </Typography>
                              </Stack>
                            </Stack>
                          </CardContent>
                        </Card>
                      )}
                    </>
                  )}
                  {action === 'otc' && (
                    <>
                      <Typography variant="h6">{portalText('兑换方向')}</Typography>
                      <Box
                        role="radiogroup"
                        aria-label={portalText('OTC 兑换方向')}
                        sx={{
                          display: 'grid',
                          gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, minmax(0, 1fr))' },
                          gap: 1.5,
                        }}
                      >
                        {(
                          [
                            {
                              value: 'BUY_USDT',
                              title: portalText('法币买入 USDT'),
                              description: 'USD / HKD → USDT · TRON（TRC20）',
                            },
                            {
                              value: 'SELL_USDT',
                              title: portalText('卖出 USDT'),
                              description: 'USDT · TRON（TRC20）→ USD / HKD',
                            },
                          ] as const
                        ).map((option) => {
                          const selected = otcDirection === option.value;
                          return (
                            <ButtonBase
                              key={option.value}
                              role="radio"
                              aria-checked={selected}
                              onClick={() => changeOtcDirection(option.value)}
                              sx={{
                                minHeight: 78,
                                p: 2,
                                border: '1px solid',
                                borderColor: selected ? 'primary.main' : 'divider',
                                borderRadius: 1.5,
                                bgcolor: selected ? 'primary.lighter' : 'background.paper',
                                textAlign: 'left',
                                justifyContent: 'space-between',
                                gap: 2,
                                '&:hover': { borderColor: 'primary.main' },
                                '&:focus-visible': {
                                  outline: '2px solid',
                                  outlineColor: 'primary.main',
                                  outlineOffset: 2,
                                },
                              }}
                            >
                              <Box>
                                <Typography variant="subtitle2">{option.title}</Typography>
                                <Typography
                                  variant="caption"
                                  color="text.secondary"
                                  sx={{ display: 'block', mt: 0.5 }}
                                >
                                  {option.description}
                                </Typography>
                              </Box>
                              {selected && <Label color="primary">{portalText('已选择')}</Label>}
                            </ButtonBase>
                          );
                        })}
                      </Box>
                      {!sourceOptions.length && (
                        <Alert severity="warning">
                          {otcDirection === 'BUY_USDT'
                            ? portalText('当前没有可用于买入 USDT 的有效法币账户。')
                            : portalText('当前没有可用于卖出的有效 USDT-TRC20 账户。')}
                        </Alert>
                      )}
                    </>
                  )}
                  <FormControl required fullWidth disabled={!sourceOptions.length}>
                    <InputLabel>{sourceFieldLabel}</InputLabel>
                    <Select
                      label={sourceFieldLabel}
                      value={sourceId}
                      onChange={(event) => setSourceId(event.target.value)}
                    >
                      {sourceOptions.map((row) => (
                        <MenuItem key={row.id} value={row.id}>
                          {accountLabel(row)} · {money(row.availableBalance, row.currency)}
                        </MenuItem>
                      ))}
                    </Select>
                  </FormControl>
                  {action !== 'payout' && (
                    <FormControl required fullWidth disabled={!source || !targets.length}>
                      <InputLabel>{targetFieldLabel}</InputLabel>
                      <Select
                        label={targetFieldLabel}
                        value={targetId}
                        onChange={(event) => setTargetId(event.target.value)}
                      >
                        {targets.map((row) => (
                          <MenuItem key={row.id} value={row.id}>
                            {accountLabel(row)} · {money(row.availableBalance, row.currency)}
                          </MenuItem>
                        ))}
                      </Select>
                    </FormControl>
                  )}
                  {action === 'otc' && source && !targets.length && (
                    <Alert severity="warning">
                      {otcDirection === 'BUY_USDT'
                        ? portalText('当前没有可接收资产的有效 USDT-TRC20 账户。')
                        : portalText('当前没有可接收卖出款项的有效 USD / HKD 账户。')}
                    </Alert>
                  )}
                  <TextField
                    required
                    label={
                      source
                        ? portalText('金额（{{value0}}）', {
                            value0: source.currency,
                          })
                        : portalText('金额')
                    }
                    type="number"
                    value={amount}
                    onChange={(event) => setAmount(event.target.value)}
                    error={insufficientBalance}
                    inputProps={{ min: 0.01, step: source?.currency === 'USDT' ? 0.000001 : 0.01 }}
                    helperText={amountHelperText}
                  />

                  {conversionType && (
                    <TextField
                      fullWidth
                      label={
                        target
                          ? portalText('预计到账（{{value0}}）', {
                              value0: target.currency,
                            })
                          : portalText('预计到账')
                      }
                      value={
                        readyQuote && target
                          ? formatConversionAmount(readyQuote.received, target.currency)
                          : ''
                      }
                      placeholder={portalText('选择账户并输入金额后显示')}
                      error={quoteInvalid}
                      helperText={quoteHelperText}
                      FormHelperTextProps={{ 'aria-live': 'polite' }}
                      InputProps={{
                        readOnly: true,
                        endAdornment: (
                          <InputAdornment position="end">
                            {ratesLoading && <CircularProgress size={16} sx={{ mr: 1 }} />}
                            {target?.currency || '—'}
                          </InputAdornment>
                        ),
                      }}
                      inputProps={{
                        'aria-label': portalText('预计到账目标资产金额'),
                      }}
                      sx={{
                        '& .MuiOutlinedInput-root': {
                          bgcolor: 'background.neutral',
                        },
                      }}
                    />
                  )}
                  {action === 'payout' && source && (
                    <Card variant="outlined" sx={{ bgcolor: 'background.neutral' }}>
                      <CardContent sx={{ p: 2.5 }}>
                        {payoutChannel && payoutFee ? (
                          <Stack spacing={1.25}>
                            <Stack direction="row" justifyContent="space-between" gap={2}>
                              <Typography variant="body2" color="text.secondary">
                                {portalText('转出渠道')}
                              </Typography>
                              <Typography variant="subtitle2">{payoutChannel.name}</Typography>
                            </Stack>
                            <Stack direction="row" justifyContent="space-between" gap={2}>
                              <Typography variant="body2" color="text.secondary">
                                {portalText('转出手续费')}
                              </Typography>
                              <Typography variant="subtitle2">
                                {money(payoutFee.amount, source.currency)}
                              </Typography>
                            </Stack>
                            <Divider />
                            <Stack direction="row" justifyContent="space-between" gap={2}>
                              <Typography variant="subtitle2">
                                {portalText('账户总扣款')}
                              </Typography>
                              <Typography variant="h6" color="primary.main">
                                {money(
                                  Number(amount || 0) + Number(payoutFee.amount),
                                  source.currency
                                )}
                              </Typography>
                            </Stack>
                          </Stack>
                        ) : (
                          <Alert severity="warning">
                            {payoutMethod === 'VA' && !source.fundingChannelId
                              ? portalText(
                                  '该 VA 是历史账户，未绑定开户银行通道，暂不能发起 VA 转出。'
                                )
                              : portalText('当前渠道尚未配置可用的转出手续费。')}
                          </Alert>
                        )}
                      </CardContent>
                    </Card>
                  )}
                  {conversionType && source && target && amount && readyQuote && (
                    <Card variant="outlined" sx={{ bgcolor: 'background.neutral' }}>
                      <CardContent sx={{ p: 2.5 }}>
                        <Stack spacing={1.25}>
                          <Stack direction="row" justifyContent="space-between" gap={2}>
                            <Typography variant="body2" color="text.secondary">
                              {portalText('卖出金额')}
                            </Typography>
                            <Typography variant="subtitle2">
                              {money(amount, source.currency)}
                            </Typography>
                          </Stack>
                          <Stack direction="row" justifyContent="space-between" gap={2}>
                            <Typography variant="body2" color="text.secondary">
                              {portalText('参考中间价')}
                            </Typography>
                            <Typography variant="subtitle2">
                              1 {source.currency} ={' '}
                              {Number(readyQuote.rate.marketRate).toLocaleString()}{' '}
                              {target.currency}
                            </Typography>
                          </Stack>
                          <Stack direction="row" justifyContent="space-between" gap={2}>
                            <Typography variant="body2" color="text.secondary">
                              {portalText('客户成交报价')}
                            </Typography>
                            <Typography variant="subtitle2">
                              1 {source.currency} ={' '}
                              {Number(readyQuote.rate.customerRate).toLocaleString()}{' '}
                              {target.currency}
                            </Typography>
                          </Stack>
                          <Stack direction="row" justifyContent="space-between" gap={2}>
                            <Typography variant="body2" color="text.secondary">
                              {portalText('报价费率')}
                            </Typography>
                            <Typography variant="subtitle2">
                              {(readyQuote.rate.feeBps / 100).toFixed(2)}%
                            </Typography>
                          </Stack>
                          <Typography variant="caption" color="text.secondary">
                            {portalText(
                              '市场中间价仅供参考，预计到账金额已包含报价费率。确认时系统会重新取价， 并锁定最终成交价及到账金额。'
                            )}
                          </Typography>
                        </Stack>
                      </CardContent>
                    </Card>
                  )}
                  <TextField
                    label={portalText('备注（选填）')}
                    value={note}
                    onChange={(event) => setNote(event.target.value)}
                    multiline
                    minRows={2}
                  />

                  <Alert severity="info">{submissionInfoText}</Alert>
                  <Button
                    size="large"
                    type="submit"
                    variant="contained"
                    disabled={
                      Boolean(submissionDisabledReason) ||
                      submitting ||
                      !sourceId ||
                      !amount ||
                      (action !== 'payout' && !targetId) ||
                      insufficientBalance ||
                      Boolean(conversionType && !quoteReady)
                    }
                  >
                    {submissionDisabledReason && portalText('当前不可提交')}
                    {submitting && portalText('正在提交…')}
                    {!submissionDisabledReason &&
                      !submitting &&
                      action === 'otc' &&
                      portalText('获取 15 秒确认报价')}
                    {!submissionDisabledReason &&
                      !submitting &&
                      action === 'payout' &&
                      portalText('确认并提交付款')}
                    {!submissionDisabledReason &&
                      !submitting &&
                      action !== 'otc' &&
                      action !== 'payout' &&
                      portalText('确认并提交')}
                  </Button>
                </Stack>
              </Box>
            </CardContent>
          </Card>
        </Stack>
      </Container>
      <Dialog
        open={Boolean(pendingQuote)}
        onClose={submitting ? undefined : () => setPendingQuote(null)}
        fullWidth
        maxWidth="sm"
      >
        <DialogTitle>{portalText('确认 OTC 成交报价')}</DialogTitle>
        <DialogContent>
          {pendingQuote && (
            <Stack spacing={2} sx={{ pt: 1 }}>
              <Alert severity={quoteCountdownMs > 0 ? 'warning' : 'error'}>
                {quoteCountdownMs > 0
                  ? portalText('报价将在 {{value0}} 秒后失效，请确认后立即执行。', {
                      value0: Math.ceil(quoteCountdownMs / 1000),
                    })
                  : portalText('报价已失效，不会执行或扣减余额，请重新获取报价。')}
              </Alert>
              <Stack spacing={1.25}>
                <Stack direction="row" justifyContent="space-between" gap={2}>
                  <Typography color="text.secondary">{portalText('卖出金额')}</Typography>
                  <Typography fontWeight={600}>
                    {money(pendingQuote.amount, pendingQuote.currency)}
                  </Typography>
                </Stack>
                <Stack direction="row" justifyContent="space-between" gap={2}>
                  <Typography color="text.secondary">{portalText('锁定成交价')}</Typography>
                  <Typography fontWeight={600}>
                    1 {pendingQuote.currency} = {pendingQuote.rate} {pendingQuote.quoteCurrency}
                  </Typography>
                </Stack>
                <Divider />
                <Stack direction="row" justifyContent="space-between" gap={2}>
                  <Typography fontWeight={600}>{portalText('实际到账')}</Typography>
                  <Typography variant="h6" color="primary.main">
                    {money(pendingQuote.quoteAmount || '0', pendingQuote.quoteCurrency || 'USDT')}
                  </Typography>
                </Stack>
              </Stack>
            </Stack>
          )}
        </DialogContent>
        <DialogActions>
          <Button disabled={submitting} onClick={() => setPendingQuote(null)}>
            {quoteCountdownMs > 0 ? portalText('取消') : portalText('重新获取报价')}
          </Button>
          <Button
            variant="contained"
            disabled={submitting || quoteCountdownMs <= 0}
            onClick={confirmPendingQuote}
          >
            {quoteConfirmButtonText}
          </Button>
        </DialogActions>
      </Dialog>
      <BeneficiaryDialog
        open={beneficiaryOpen}
        customerId={customer?.id || ''}
        customerSession={customerSession}
        totpEnabled={Boolean(user?.totpEnabled)}
        onClose={() => setBeneficiaryOpen(false)}
        onCreated={() => {
          setBeneficiaryOpen(false);
          loadDetail().catch(() => undefined);
        }}
      />
    </>
  );
}

function payoutChannelType(method: PayoutMethod): FundingChannel['type'] {
  if (method === 'VA') return 'VIRTUAL_ACCOUNT';
  if (method === 'POBO') return 'POBO_PAYOUT';
  return 'PLATFORM_PAYOUT';
}

function BeneficiaryPage({
  customer,
  readOnlyReason,
  onCreate,
  onReload,
  dialogOpen,
  setDialogOpen,
  customerSession,
  totpEnabled,
  customerCryptoBeneficiaries,
}: {
  customer: Customer | null;
  readOnlyReason?: string;
  onCreate: () => void;
  onReload: () => Promise<void>;
  dialogOpen: boolean;
  setDialogOpen: (open: boolean) => void;
  customerSession: boolean;
  totpEnabled: boolean;
  customerCryptoBeneficiaries: Beneficiary[];
}) {
  const coreRows = customer?.beneficiaries || [];
  const rows = customerSession
    ? [...coreRows.filter((row) => row.type === 'BANK'), ...customerCryptoBeneficiaries]
    : coreRows;
  const [filter, setFilter] = useState<'ALL' | 'BANK' | 'CRYPTO'>('ALL');
  const visibleRows = rows.filter((row) => filter === 'ALL' || row.type === filter);
  const bankCount = rows.filter((row) => row.type === 'BANK').length;
  const cryptoCount = rows.filter((row) => row.type === 'CRYPTO').length;
  const activeCount = rows.filter((row) => row.active).length;
  const [revokeTarget, setRevokeTarget] = useState<Beneficiary | null>(null);
  const [revokeOtpCode, setRevokeOtpCode] = useState('');
  const [revokeError, setRevokeError] = useState('');
  const [revokeSuccess, setRevokeSuccess] = useState('');
  const [revoking, setRevoking] = useState(false);

  const closeRevokeDialog = () => {
    if (revoking) return;
    setRevokeTarget(null);
    setRevokeOtpCode('');
    setRevokeError('');
  };

  const revokeDestination = async (event: FormEvent) => {
    event.preventDefault();
    if (!revokeTarget || !/^\d{6}$/.test(revokeOtpCode)) {
      setRevokeError(portalText('请输入验证器当前显示的 6 位动态码。'));
      return;
    }
    setRevoking(true);
    setRevokeError('');
    try {
      const stepUp = await customerAuthApi<{ step_up_token: string }>('/step-up/totp', {
        method: 'POST',
        body: JSON.stringify({
          purpose: 'revoke_withdrawal_address',
          otp_code: revokeOtpCode,
        }),
      });
      const route =
        revokeTarget.type === 'CRYPTO'
          ? `/customer/withdrawal-addresses/${encodeURIComponent(revokeTarget.id)}/revoke`
          : `/customer/fiat-beneficiaries/${encodeURIComponent(revokeTarget.id)}/revoke`;
      await neobankApi(route, {
        method: 'POST',
        body: JSON.stringify({ step_up_token: stepUp.step_up_token }),
      });
      const targetName = revokeTarget.name;
      setRevokeTarget(null);
      setRevokeOtpCode('');
      setRevokeError('');
      setRevokeSuccess(
        portalText('白名单“{{value0}}”已停用，后续转出将不能再选择该目标。', {
          value0: targetName,
        })
      );
      await onReload();
    } catch (value) {
      const message = value instanceof Error ? value.message : portalText('暂时无法停用白名单。');
      if (message === 'invalid_totp_code') {
        setRevokeError(portalText('动态码无效、已过期或已使用，请输入当前动态码。'));
      } else {
        setRevokeError(message);
      }
    } finally {
      setRevoking(false);
    }
  };
  return (
    <>
      <Helmet>
        <title>{portalText('转出白名单 | SSC Digital Bank')}</title>
      </Helmet>
      <Container maxWidth="lg">
        <Stack spacing={3}>
          <Stack direction={{ xs: 'column', sm: 'row' }} justifyContent="space-between" gap={2}>
            <Box>
              <Typography variant="h4">{portalText('转出白名单')}</Typography>
              <Typography color="text.secondary" sx={{ mt: 0.75 }}>
                {portalText(
                  '统一管理法币银行账户与 USDT-TRON 地址。新增和停用均需两步验证，已保存资料不可修改。'
                )}
              </Typography>
            </Box>
            {!readOnlyReason && (
              <Button
                variant="contained"
                startIcon={<Iconify icon="solar:add-circle-linear" />}
                onClick={onCreate}
              >
                {portalText('新增白名单')}
              </Button>
            )}
          </Stack>
          {readOnlyReason && <Alert severity="info">{portalText(readOnlyReason)}</Alert>}
          {revokeSuccess && (
            <Alert severity="success" onClose={() => setRevokeSuccess('')}>
              {revokeSuccess}
            </Alert>
          )}
          <Alert
            severity={activeCount ? 'info' : 'warning'}
            icon={<Iconify icon="solar:shield-check-bold-duotone" width={24} />}
          >
            {portalText('当前共有 {{value0}} 个可用目标；停用只影响后续转出，不会删除历史交易。', {
              value0: activeCount,
            })}
          </Alert>
          <Card>
            <Tabs
              value={filter}
              onChange={(_, value) => setFilter(value)}
              sx={{ px: { xs: 1, sm: 2 }, borderBottom: '1px solid', borderColor: 'divider' }}
            >
              <Tab value="ALL" label={portalText('全部 {{value0}}', { value0: rows.length })} />

              <Tab value="BANK" label={portalText('法币 {{value0}}', { value0: bankCount })} />

              <Tab
                value="CRYPTO"
                label={portalText('数字货币 {{value0}}', { value0: cryptoCount })}
              />
            </Tabs>
            <Stack divider={<Divider flexItem />}>
              {visibleRows.map((row) => {
                const cryptoRecipient = row.type === 'CRYPTO';
                const address = row.walletAddress || '';
                const maskedDestination = cryptoRecipient
                  ? `${address.slice(0, 7)}…${address.slice(-6)}`
                  : `•••• ${(row.accountNumber || '').slice(-4)}`;
                return (
                  <Stack
                    key={row.id}
                    direction={{ xs: 'column', sm: 'row' }}
                    alignItems={{ sm: 'center' }}
                    spacing={2}
                    sx={{ px: { xs: 2, sm: 2.5 }, py: 2.25 }}
                  >
                    <Box
                      sx={{
                        width: 44,
                        height: 44,
                        borderRadius: '50%',
                        bgcolor: 'background.paper',
                        border: '1px solid',
                        borderColor: 'divider',
                        display: 'grid',
                        placeItems: 'center',
                        flexShrink: 0,
                      }}
                    >
                      <AssetIcon
                        asset={cryptoRecipient ? 'USDT' : row.currency}
                        network={cryptoRecipient ? row.network : undefined}
                        size={30}
                      />
                    </Box>
                    <Box sx={{ flex: 1, minWidth: 0 }}>
                      <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap">
                        <Typography variant="subtitle1">{row.name}</Typography>
                        <Label color={cryptoRecipient ? 'success' : 'info'}>
                          {cryptoRecipient ? portalText('数字货币') : portalText('法币')}
                        </Label>
                        <Label color={row.active ? 'success' : 'default'}>
                          {row.active ? portalText('可用') : portalText('已停用')}
                        </Label>
                      </Stack>
                      <Typography variant="body2" color="text.secondary">
                        {cryptoRecipient
                          ? `USDT · TRON (TRC20) · ${maskedDestination}`
                          : `${row.bankName} · ${row.currency} · ${maskedDestination}`}
                      </Typography>
                    </Box>
                    <Stack
                      direction="row"
                      spacing={0.5}
                      sx={{ alignSelf: { xs: 'flex-start', sm: 'center' }, flexShrink: 0 }}
                    >
                      {row.active && (
                        <Button
                          href={
                            cryptoRecipient
                              ? '/portal/crypto-wallet/withdraw'
                              : '/portal/money/payouts'
                          }
                          endIcon={<Iconify icon="solar:alt-arrow-right-linear" />}
                        >
                          {cryptoRecipient ? portalText('用于转出') : portalText('用于付款')}
                        </Button>
                      )}
                      {customerSession && row.active && (
                        <Button
                          color="error"
                          onClick={() => {
                            setRevokeTarget(row);
                            setRevokeOtpCode('');
                            setRevokeError('');
                          }}
                        >
                          {portalText('停用')}
                        </Button>
                      )}
                    </Stack>
                  </Stack>
                );
              })}
              {!visibleRows.length && (
                <Stack alignItems="center" sx={{ py: 7, px: 2 }}>
                  <Iconify
                    icon={
                      filter === 'CRYPTO'
                        ? 'solar:wallet-money-bold-duotone'
                        : 'solar:user-id-bold-duotone'
                    }
                    width={38}
                    color="text.disabled"
                  />

                  <Typography variant="subtitle1" sx={{ mt: 1.5 }}>
                    {filter === 'CRYPTO'
                      ? portalText('暂无数字货币白名单')
                      : portalText('暂无法币白名单')}
                  </Typography>
                  <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
                    {filter === 'CRYPTO'
                      ? portalText('添加经过两步验证的 USDT · TRON（TRC20）地址。')
                      : portalText('添加银行账户或数字货币地址后，可在转出页面直接选择。')}
                  </Typography>
                  {!readOnlyReason && (
                    <Button onClick={onCreate} sx={{ mt: 1.5 }}>
                      {portalText('新增白名单')}
                    </Button>
                  )}
                </Stack>
              )}
            </Stack>
          </Card>
        </Stack>
      </Container>
      {!readOnlyReason && (
        <BeneficiaryDialog
          open={dialogOpen}
          customerId={customer?.id || ''}
          customerSession={customerSession}
          totpEnabled={totpEnabled}
          onClose={() => setDialogOpen(false)}
          onCreated={() => {
            setDialogOpen(false);
            onReload().catch(() => undefined);
          }}
        />
      )}
      <Dialog open={Boolean(revokeTarget)} onClose={closeRevokeDialog} fullWidth maxWidth="xs">
        <Box component="form" onSubmit={revokeDestination}>
          <DialogTitle>{portalText('停用转出白名单')}</DialogTitle>
          <DialogContent>
            <Stack spacing={2} sx={{ pt: 0.5 }}>
              <Alert severity="warning">
                {portalText(
                  '停用“{{value0}}”后，新的转出申请不能再选择该目标；历史交易记录不会被删除。',
                  { value0: revokeTarget?.name || '' }
                )}
              </Alert>
              {!totpEnabled && (
                <Alert severity="error">
                  {portalText('当前账户尚未启用两步验证，请先前往“安全与设置”完成绑定。')}
                </Alert>
              )}
              {revokeError && <Alert severity="error">{revokeError}</Alert>}
              <TextField
                required
                autoFocus
                disabled={!totpEnabled}
                label={portalText('6 位动态码')}
                value={revokeOtpCode}
                onChange={(event) => {
                  setRevokeOtpCode(event.target.value.replace(/\D/g, '').slice(0, 6));
                  setRevokeError('');
                }}
                inputProps={{ inputMode: 'numeric', pattern: '[0-9]*', maxLength: 6 }}
              />
            </Stack>
          </DialogContent>
          <DialogActions>
            <Button disabled={revoking} onClick={closeRevokeDialog}>
              {portalText('保留白名单')}
            </Button>
            <Button
              type="submit"
              color="error"
              variant="contained"
              disabled={revoking || !totpEnabled || revokeOtpCode.length !== 6}
            >
              {revoking ? portalText('正在验证并停用…') : portalText('验证并停用')}
            </Button>
          </DialogActions>
        </Box>
      </Dialog>
    </>
  );
}
