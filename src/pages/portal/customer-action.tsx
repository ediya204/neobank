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
import CustomBreadcrumbs from 'src/components/custom-breadcrumbs';
import Label from 'src/components/label';
import BeneficiaryDialog from 'src/features/finance/beneficiary-dialog';
import { usePortalCustomer } from 'src/features/finance/portal-customer-context';
import {
  coreApi,
  Customer,
  FundingChannel,
  isSupportedPortalAccount,
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
import { accountLabel, money } from './customer-shared';

export type CustomerAction = 'transfer' | 'fx' | 'otc' | 'payout' | 'beneficiaries';

type PayoutMethod = 'PLATFORM' | 'POBO' | 'VA';

const payoutMethods: Array<{
  value: PayoutMethod;
  title: string;
  description: string;
  icon: string;
}> = [
  {
    value: 'PLATFORM',
    title: '代付',
    description: '平台银行通道代为执行付款',
    icon: 'solar:buildings-2-bold-duotone',
  },
  {
    value: 'POBO',
    title: 'POBO',
    description: '以客户名义向第三方付款',
    icon: 'solar:user-check-bold-duotone',
  },
  {
    value: 'VA',
    title: 'VA 转出',
    description: '从客户的 USD / HKD VA 账户付款',
    icon: 'solar:wallet-money-bold-duotone',
  },
];

const copy: Record<CustomerAction, { title: string; description: string; icon: string }> = {
  transfer: {
    title: '账户内划转',
    description: '在自己的同币种账户之间转移资金。',
    icon: 'solar:transfer-horizontal-bold-duotone',
  },
  fx: {
    title: 'USD / HKD 换汇',
    description: '使用当前报价在 USD 与 HKD 余额之间兑换。',
    icon: 'solar:refresh-square-bold-duotone',
  },
  otc: {
    title: 'OTC 兑换',
    description: '使用法币买入或卖出账户内 USDT。',
    icon: 'solar:hand-money-bold-duotone',
  },
  payout: {
    title: '法币转出',
    description: '向已登记的银行收款人提交 USD / HKD 付款申请。',
    icon: 'solar:upload-minimalistic-bold-duotone',
  },
  beneficiaries: {
    title: '收款人',
    description: '安全保存个人或企业第三方银行收款资料。',
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
  const { customer, refresh } = usePortalCustomer();
  const [detail, setDetail] = useState<Customer | null>(null);
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
      setRatesError(value instanceof Error ? value.message : '实时报价加载失败');
    } finally {
      setRatesLoading(false);
    }
  }, [conversionType]);

  const loadDetail = async () => {
    if (!customer) return;
    const loadPayoutConfiguration = action === 'payout' && !submissionDisabledReason;
    const [customerDetail, channelRows, feeRows] = await Promise.all([
      coreApi<Customer>(`/customers/${customer.id}`),
      loadPayoutConfiguration
        ? coreApi<FundingChannel[]>(`/funding-channels?organizationId=${customer.organizationId}`)
        : Promise.resolve([] as FundingChannel[]),
      loadPayoutConfiguration
        ? coreApi<WithdrawalFeeRule[]>(
            `/withdrawal-fees?organizationId=${customer.organizationId}&active=true`
          )
        : Promise.resolve([] as WithdrawalFeeRule[]),
    ]);
    setDetail(customerDetail);
    setChannels(channelRows);
    setWithdrawalFees(feeRows);
  };

  useEffect(() => {
    loadDetail().catch((value) => setError(value instanceof Error ? value.message : '加载失败'));
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
  const beneficiaries = (detail?.beneficiaries || []).filter((row) => row.type === 'BANK');
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
  let sourceFieldLabel = action === 'payout' ? '付款账户' : '从账户';
  if (action === 'otc') {
    sourceFieldLabel = otcDirection === 'BUY_USDT' ? '付款账户' : '付款钱包';
  }
  const targetFieldLabel =
    action === 'otc' && otcDirection === 'BUY_USDT' ? '到账钱包' : '到账账户';
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
  let quoteHelperText = '选择付款和到账账户并输入金额后计算';
  if (quote?.status === 'loading') quoteHelperText = '正在获取实时报价…';
  if (quote?.status === 'unavailable') {
    quoteHelperText = ratesError
      ? '实时报价加载失败，请稍后重试'
      : '当前币种组合暂无有效报价，请稍后重试';
  }
  if (quote?.status === 'stale') quoteHelperText = '报价已过期，系统将自动刷新，请稍后重试';
  if (readyQuote) {
    quoteHelperText = `按当前客户报价估算${
      readyQuote.rate.marketUpdatedAt
        ? ` · 行情时间 ${new Date(readyQuote.rate.marketUpdatedAt).toLocaleString('zh-CN')}`
        : ''
    }；提交时将重新取价并锁定最终金额`;
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
  let amountHelperText = '请先选择付款账户';
  if (action === 'otc' && otcDirection === 'SELL_USDT') {
    amountHelperText = '请先选择付款钱包';
  }
  if (source) amountHelperText = `可用余额 ${availableBalanceLabel}`;
  if (insufficientBalance) amountHelperText = `金额超过可用余额 ${availableBalanceLabel}`;

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!customer) return;
    if (submissionDisabledReason) {
      setError(submissionDisabledReason);
      return;
    }
    if (conversionType && !quoteReady) {
      setError('当前没有可提交的有效报价，请等待报价刷新后重试');
      return;
    }
    setError('');
    setSuccess('');
    setSubmitting(true);
    try {
      const sourceAccount = accounts.find((row) => row.id === sourceId);
      const targetAccount = accounts.find((row) => row.id === targetId);
      if (!sourceAccount || !amount || Number(amount) <= 0)
        throw new Error('请选择付款账户并输入有效金额');
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
        if (!targetAccount) throw new Error('请选择收款账户');
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
        if (!selectedBeneficiary) throw new Error('请选择第三方收款人');
        const channel = payoutChannel;
        if (!channel) {
          throw new Error(
            payoutMethod === 'VA'
              ? '所选 VA 账户未绑定可用的开户银行通道'
              : '当前付款方式暂不支持该币种'
          );
        }
        if (!payoutFee) throw new Error('当前渠道尚未配置转出手续费');
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
          throw new Error('服务端未返回完整的确认报价');
        }
        setQuoteCountdownMs(Math.max(0, Date.parse(created.quoteExpiresAt) - Date.now()));
        setPendingQuote(created);
        return;
      }
      let successMessage = '指令已提交审批，完成后余额会自动更新。';
      if (action === 'payout') {
        successMessage = '付款已提交。平台管理员审批后将由银行或支付通道执行。';
      } else if (action === 'fx' && created.rate && created.quoteAmount && created.quoteCurrency) {
        successMessage = `指令已按提交时实时行情锁定：1 ${created.currency} = ${created.rate} ${
          created.quoteCurrency
        }，预计到账 ${money(created.quoteAmount, created.quoteCurrency)}。`;
      }
      setSuccess(successMessage);
      setAmount('');
      setNote('');
      await Promise.all([loadDetail(), refresh(), loadRates()]);
    } catch (value) {
      setError(value instanceof Error ? value.message : '提交失败');
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
        `兑换已执行：1 ${completed.currency} = ${completed.rate} ${
          completed.quoteCurrency
        }，到账 ${money(completed.quoteAmount || '0', completed.quoteCurrency || 'USDT')}。`
      );
      setAmount('');
      setNote('');
      await Promise.all([loadDetail(), refresh(), loadRates()]);
    } catch (value) {
      const message = value instanceof Error ? value.message : '确认执行失败';
      if (message.includes('quote_expired')) {
        setQuoteCountdownMs(0);
        setError('报价已失效，请重新获取报价。');
      } else {
        setError(message);
      }
    } finally {
      setSubmitting(false);
    }
  };

  let submissionInfoText =
    '提交后进入平台单人审批；审批完成前你可以在交易记录中查看进度。';
  if (submissionDisabledReason) {
    submissionInfoText = '当前页面保留账户与报价展示，不会创建资金指令。';
  } else if (action === 'otc') {
    submissionInfoText =
      '先获取服务端成交报价；报价仅保留 5 秒，点击确认后立即执行，无需审批。';
  }
  let quoteConfirmButtonText = '报价已失效';
  if (submitting) quoteConfirmButtonText = '正在执行…';
  else if (quoteCountdownMs > 0) {
    quoteConfirmButtonText = `确认执行（${Math.ceil(quoteCountdownMs / 1000)}）`;
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
      />
    );
  const info = copy[action];
  return (
    <>
      <Helmet>
        <title>{info.title} | SSC Digital Bank</title>
      </Helmet>
      <Container maxWidth="md">
        <Stack spacing={3}>
          <CustomBreadcrumbs
            heading={info.title}
            links={[{ name: '收付与兑换', href: '/portal/money/transfers' }, { name: info.title }]}
          />
          <Typography color="text.secondary" sx={{ mt: -2 }}>
            {info.description}
          </Typography>
          {submissionDisabledReason && (
            <Alert severity="info">{submissionDisabledReason} 历史记录可在“交易记录”中查询。</Alert>
          )}
          {error && (
            <Alert severity="error" onClose={() => setError('')}>
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
                  <StepLabel>填写信息</StepLabel>
                </Step>
                <Step>
                  <StepLabel>平台审批</StepLabel>
                </Step>
                <Step>
                  <StepLabel>完成</StepLabel>
                </Step>
              </Stepper>
              <Box component="form" onSubmit={submit}>
                <Stack spacing={2.5}>
                  {action === 'payout' && (
                    <>
                      <Typography variant="h6">选择转出方式</Typography>
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
                                  {selected && <Label color="primary">已选择</Label>}
                                </Stack>
                                <Typography variant="subtitle2">{method.title}</Typography>
                                <Typography variant="caption" color="text.secondary">
                                  {method.description}
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
                        <Typography variant="h6">第三方收款人</Typography>
                        <Button
                          startIcon={<Iconify icon="solar:add-circle-linear" />}
                          onClick={() => setBeneficiaryOpen(true)}
                        >
                          新增收款人
                        </Button>
                      </Stack>
                      <FormControl required fullWidth>
                        <InputLabel>选择收款人</InputLabel>
                        <Select
                          label="选择收款人"
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
                                  收款人
                                </Typography>
                                <Typography variant="subtitle2">
                                  {selectedBeneficiary.name}
                                </Typography>
                              </Stack>
                              <Stack direction="row" justifyContent="space-between" gap={2}>
                                <Typography variant="body2" color="text.secondary">
                                  收款银行
                                </Typography>
                                <Typography variant="subtitle2">
                                  {selectedBeneficiary.bankName}
                                </Typography>
                              </Stack>
                              <Stack direction="row" justifyContent="space-between" gap={2}>
                                <Typography variant="body2" color="text.secondary">
                                  币种与账号
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
                      <Typography variant="h6">兑换方向</Typography>
                      <Box
                        role="radiogroup"
                        aria-label="OTC 兑换方向"
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
                              title: '法币买入 USDT',
                              description: 'USD / HKD → USDT · TRON（TRC20）',
                            },
                            {
                              value: 'SELL_USDT',
                              title: '卖出 USDT',
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
                              {selected && <Label color="primary">已选择</Label>}
                            </ButtonBase>
                          );
                        })}
                      </Box>
                      {!sourceOptions.length && (
                        <Alert severity="warning">
                          {otcDirection === 'BUY_USDT'
                            ? '当前没有可用于买入 USDT 的活动法币账户。'
                            : '当前没有可用于卖出的活动 USDT-TRC20 钱包。'}
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
                        ? '当前没有可接收资产的活动 USDT-TRC20 钱包。'
                        : '当前没有可接收卖出款项的活动 USD / HKD 账户。'}
                    </Alert>
                  )}
                  <TextField
                    required
                    label={source ? `金额（${source.currency}）` : '金额'}
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
                      label={target ? `预计到账（${target.currency}）` : '预计到账'}
                      value={
                        readyQuote && target
                          ? formatConversionAmount(readyQuote.received, target.currency)
                          : ''
                      }
                      placeholder="选择账户并输入金额后显示"
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
                      inputProps={{ 'aria-label': '预计到账目标资产金额' }}
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
                                转出渠道
                              </Typography>
                              <Typography variant="subtitle2">{payoutChannel.name}</Typography>
                            </Stack>
                            <Stack direction="row" justifyContent="space-between" gap={2}>
                              <Typography variant="body2" color="text.secondary">
                                转出手续费
                              </Typography>
                              <Typography variant="subtitle2">
                                {money(payoutFee.amount, source.currency)}
                              </Typography>
                            </Stack>
                            <Divider />
                            <Stack direction="row" justifyContent="space-between" gap={2}>
                              <Typography variant="subtitle2">账户总扣款</Typography>
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
                              ? '该 VA 是历史账户，未绑定开户银行通道，暂不能发起 VA 转出。'
                              : '当前渠道尚未配置可用的转出手续费。'}
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
                              卖出金额
                            </Typography>
                            <Typography variant="subtitle2">
                              {money(amount, source.currency)}
                            </Typography>
                          </Stack>
                          <Stack direction="row" justifyContent="space-between" gap={2}>
                            <Typography variant="body2" color="text.secondary">
                              参考中间价
                            </Typography>
                            <Typography variant="subtitle2">
                              1 {source.currency} ={' '}
                              {Number(readyQuote.rate.marketRate).toLocaleString()}{' '}
                              {target.currency}
                            </Typography>
                          </Stack>
                          <Stack direction="row" justifyContent="space-between" gap={2}>
                            <Typography variant="body2" color="text.secondary">
                              当前客户报价
                            </Typography>
                            <Typography variant="subtitle2">
                              1 {source.currency} ={' '}
                              {Number(readyQuote.rate.customerRate).toLocaleString()}{' '}
                              {target.currency}
                            </Typography>
                          </Stack>
                          <Stack direction="row" justifyContent="space-between" gap={2}>
                            <Typography variant="body2" color="text.secondary">
                              报价费率
                            </Typography>
                            <Typography variant="subtitle2">
                              {(readyQuote.rate.feeBps / 100).toFixed(2)}%
                            </Typography>
                          </Stack>
                          <Typography variant="caption" color="text.secondary">
                            FastForex 实时中间价仅供参考；预计到账已包含报价费率。提交时服务端会再次
                            取价，并把最终成交价和到账金额锁定到指令。
                          </Typography>
                        </Stack>
                      </CardContent>
                    </Card>
                  )}
                  <TextField
                    label="备注（选填）"
                    value={note}
                    onChange={(event) => setNote(event.target.value)}
                    multiline
                    minRows={2}
                  />
                  <Alert severity="info">
                    {submissionInfoText}
                  </Alert>
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
                    {submissionDisabledReason && '暂未开放提交'}
                    {submitting && '正在提交…'}
                    {!submissionDisabledReason &&
                      !submitting &&
                      action === 'otc' &&
                      '获取 5 秒确认报价'}
                    {!submissionDisabledReason &&
                      !submitting &&
                      action === 'payout' &&
                      '确认并提交付款'}
                    {!submissionDisabledReason &&
                      !submitting &&
                      action !== 'otc' &&
                      action !== 'payout' &&
                      '确认并提交'}
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
        <DialogTitle>确认 OTC 成交报价</DialogTitle>
        <DialogContent>
          {pendingQuote && (
            <Stack spacing={2} sx={{ pt: 1 }}>
              <Alert severity={quoteCountdownMs > 0 ? 'warning' : 'error'}>
                {quoteCountdownMs > 0
                  ? `报价将在 ${Math.ceil(quoteCountdownMs / 1000)} 秒后失效，请确认后立即执行。`
                  : '报价已失效，不会执行或扣减余额，请重新获取报价。'}
              </Alert>
              <Stack spacing={1.25}>
                <Stack direction="row" justifyContent="space-between" gap={2}>
                  <Typography color="text.secondary">卖出金额</Typography>
                  <Typography fontWeight={600}>
                    {money(pendingQuote.amount, pendingQuote.currency)}
                  </Typography>
                </Stack>
                <Stack direction="row" justifyContent="space-between" gap={2}>
                  <Typography color="text.secondary">锁定成交价</Typography>
                  <Typography fontWeight={600}>
                    1 {pendingQuote.currency} = {pendingQuote.rate} {pendingQuote.quoteCurrency}
                  </Typography>
                </Stack>
                <Divider />
                <Stack direction="row" justifyContent="space-between" gap={2}>
                  <Typography fontWeight={600}>实际到账</Typography>
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
            {quoteCountdownMs > 0 ? '取消' : '重新获取报价'}
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
}: {
  customer: Customer | null;
  readOnlyReason?: string;
  onCreate: () => void;
  onReload: () => Promise<void>;
  dialogOpen: boolean;
  setDialogOpen: (open: boolean) => void;
}) {
  const rows = customer?.beneficiaries || [];
  const [filter, setFilter] = useState<'ALL' | 'BANK' | 'CRYPTO'>('ALL');
  const visibleRows = rows.filter((row) => filter === 'ALL' || row.type === filter);
  const bankCount = rows.filter((row) => row.type === 'BANK').length;
  const cryptoCount = rows.filter((row) => row.type === 'CRYPTO').length;
  return (
    <>
      <Helmet>
        <title>收款人 | SSC Digital Bank</title>
      </Helmet>
      <Container maxWidth="lg">
        <Stack spacing={3}>
          <Stack direction={{ xs: 'column', sm: 'row' }} justifyContent="space-between" gap={2}>
            <Box>
              <Typography variant="h4">第三方收款人</Typography>
              <Typography color="text.secondary" sx={{ mt: 0.75 }}>
                统一管理银行账户和数字货币地址，付款时直接选择并再次核对。
              </Typography>
            </Box>
            {!readOnlyReason && (
              <Button
                variant="contained"
                startIcon={<Iconify icon="solar:add-circle-linear" />}
                onClick={onCreate}
              >
                新增收款人
              </Button>
            )}
          </Stack>
          {readOnlyReason && <Alert severity="info">{readOnlyReason}</Alert>}
          <Card>
            <Tabs
              value={filter}
              onChange={(_, value) => setFilter(value)}
              sx={{ px: { xs: 1, sm: 2 }, borderBottom: '1px solid', borderColor: 'divider' }}
            >
              <Tab value="ALL" label={`全部 ${rows.length}`} />
              <Tab value="BANK" label={`银行账户 ${bankCount}`} />
              <Tab value="CRYPTO" label={`数字货币 ${cryptoCount}`} />
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
                        borderRadius: 1.5,
                        bgcolor: cryptoRecipient ? 'success.lighter' : 'primary.lighter',
                        display: 'grid',
                        placeItems: 'center',
                        flexShrink: 0,
                      }}
                    >
                      <Iconify
                        icon={
                          cryptoRecipient
                            ? 'solar:wallet-money-bold-duotone'
                            : 'solar:buildings-2-bold-duotone'
                        }
                        color={cryptoRecipient ? 'success.main' : 'primary.main'}
                        width={24}
                      />
                    </Box>
                    <Box sx={{ flex: 1, minWidth: 0 }}>
                      <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap">
                        <Typography variant="subtitle1">{row.name}</Typography>
                        <Label color={cryptoRecipient ? 'success' : 'info'}>
                          {cryptoRecipient ? '数字货币' : '银行账户'}
                        </Label>
                      </Stack>
                      <Typography variant="body2" color="text.secondary">
                        {cryptoRecipient
                          ? `USDT · TRON (TRC20) · ${maskedDestination}`
                          : `${row.bankName} · ${row.currency} · ${maskedDestination}`}
                      </Typography>
                    </Box>
                    <Button
                      href={
                        cryptoRecipient ? '/portal/crypto-wallet/withdraw' : '/portal/money/payouts'
                      }
                      endIcon={<Iconify icon="solar:alt-arrow-right-linear" />}
                      sx={{ alignSelf: { xs: 'flex-start', sm: 'center' }, flexShrink: 0 }}
                    >
                      {cryptoRecipient ? '用于付币' : '用于付款'}
                    </Button>
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
                    {filter === 'CRYPTO' ? '还没有数字货币收款人' : '还没有第三方收款人'}
                  </Typography>
                  <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
                    {filter === 'CRYPTO'
                      ? '添加经过核对的 USDT · TRON (TRC20) 地址。'
                      : '添加银行账户或数字货币地址后，可在付款页面直接选择。'}
                  </Typography>
                  {!readOnlyReason && (
                    <Button onClick={onCreate} sx={{ mt: 1.5 }}>
                      立即添加
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
          onClose={() => setDialogOpen(false)}
          onCreated={() => {
            setDialogOpen(false);
            onReload().catch(() => undefined);
          }}
        />
      )}
    </>
  );
}
