import { FormEvent, useEffect, useMemo, useState } from 'react';
import { Helmet } from 'react-helmet-async';
import { useSearchParams } from 'react-router-dom';
import {
  Alert,
  Box,
  Button,
  ButtonBase,
  Card,
  CardContent,
  Container,
  Divider,
  FormControl,
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
  OperationType,
  RateVersion,
  WithdrawalFeeRule,
  supportedFiatCurrencies,
} from 'src/features/finance/core-api';
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
    icon: 'solar:bank-bold-duotone',
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

export default function CustomerActionPage({ action }: { action: CustomerAction }) {
  const [searchParams] = useSearchParams();
  const { customer, refresh } = usePortalCustomer();
  const [detail, setDetail] = useState<Customer | null>(null);
  const [channels, setChannels] = useState<FundingChannel[]>([]);
  const [rates, setRates] = useState<RateVersion[]>([]);
  const [withdrawalFees, setWithdrawalFees] = useState<WithdrawalFeeRule[]>([]);
  const [sourceId, setSourceId] = useState('');
  const [targetId, setTargetId] = useState('');
  const [beneficiaryId, setBeneficiaryId] = useState('');
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [payoutMethod, setPayoutMethod] = useState<PayoutMethod>('PLATFORM');
  const [beneficiaryOpen, setBeneficiaryOpen] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const loadDetail = async () => {
    if (!customer) return;
    const [customerDetail, channelRows, rateRows, feeRows] = await Promise.all([
      coreApi<Customer>(`/customers/${customer.id}`),
      coreApi<FundingChannel[]>(`/funding-channels?organizationId=${customer.organizationId}`),
      coreApi<RateVersion[]>('/rates'),
      coreApi<WithdrawalFeeRule[]>(
        `/withdrawal-fees?organizationId=${customer.organizationId}&active=true`
      ),
    ]);
    setDetail(customerDetail);
    setChannels(channelRows);
    setRates(rateRows);
    setWithdrawalFees(feeRows);
  };

  useEffect(() => {
    loadDetail().catch((value) => setError(value instanceof Error ? value.message : '加载失败'));
  }, [customer?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const accounts = useMemo(
    () =>
      (detail?.accounts || []).filter(
        (row) =>
          ['SYSTEM_WALLET', 'VIRTUAL_ACCOUNT', 'CRYPTO_WALLET'].includes(row.kind) &&
          row.status === 'ACTIVE' &&
          isSupportedPortalAccount(row)
      ),
    [detail]
  );
  const source = accounts.find((row) => row.id === sourceId);
  const targets = accounts.filter((row) => {
    if (!source || row.id === source.id) return false;
    if (action === 'transfer') return row.currency === source.currency;
    if (action === 'fx') return row.kind !== 'CRYPTO_WALLET' && row.currency !== source.currency;
    if (action === 'otc') return (source.currency === 'USDT') !== (row.currency === 'USDT');
    return false;
  });
  const beneficiaries = (detail?.beneficiaries || []).filter((row) => row.type === 'BANK');
  const selectedBeneficiary = beneficiaries.find((row) => row.id === beneficiaryId);
  const payoutAccounts = accounts.filter((row) => {
    if (!selectedBeneficiary) return false;
    if (row.currency !== selectedBeneficiary.currency) return false;
    const expectedKind = payoutMethod === 'VA' ? 'VIRTUAL_ACCOUNT' : 'SYSTEM_WALLET';
    return row.kind === expectedKind && supportedFiatCurrencies.includes(row.currency);
  });
  const sourceOptions =
    action === 'payout'
      ? payoutAccounts
      : accounts.filter((row) => {
          if (action === 'otc') return true;
          return row.kind === 'SYSTEM_WALLET' && supportedFiatCurrencies.includes(row.currency);
        });
  const sourceFieldLabel = action === 'payout' ? '付款账户' : '从账户';
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
  const quote = useMemo(() => {
    if (!source || !amount || Number(amount) <= 0) return null;
    const target = accounts.find((row) => row.id === targetId);
    if (!target || (action !== 'fx' && action !== 'otc')) return null;
    const rate = rates.find(
      (row) =>
        row.active &&
        row.type === (action === 'fx' ? 'FX' : 'OTC') &&
        row.baseCurrency === source.currency &&
        row.quoteCurrency === target.currency
    );
    if (!rate) return null;
    const received = Number(amount) * Number(rate.sellRate) * (1 - Number(rate.feeBps) / 10000);
    return { rate, target, received };
  }, [accounts, action, amount, rates, source, targetId]);

  useEffect(() => {
    setTargetId('');
  }, [sourceId]);
  useEffect(() => {
    if (action === 'payout') setSourceId('');
  }, [action, beneficiaryId, payoutMethod]);

  useEffect(() => {
    if (action !== 'otc' || !accounts.length) return;
    const requestedSource = searchParams.get('source');
    const requestedTargetKind = searchParams.get('targetKind');
    const preferredSource = accounts.find(
      (row) => row.currency === requestedSource && row.kind === 'CRYPTO_WALLET'
    );
    const resolvedSource = preferredSource || source;
    if (preferredSource && sourceId !== preferredSource.id) {
      setSourceId(preferredSource.id);
      return;
    }
    if (!resolvedSource || !requestedTargetKind) return;
    const preferredTarget = accounts.find(
      (row) =>
        row.id !== resolvedSource.id &&
        row.kind === requestedTargetKind &&
        row.currency !== resolvedSource.currency
    );
    if (preferredTarget && targetId !== preferredTarget.id) setTargetId(preferredTarget.id);
  }, [accounts, action, searchParams, source, sourceId, targetId]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!customer) return;
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
      await coreApi('/operations', { method: 'POST', body: JSON.stringify(payload) });
      setSuccess(
        action === 'payout'
          ? '付款已提交。平台管理员审批后将由银行或支付通道执行。'
          : '指令已提交审批，完成后余额会自动更新。'
      );
      setAmount('');
      setNote('');
      await Promise.all([loadDetail(), refresh()]);
    } catch (value) {
      setError(value instanceof Error ? value.message : '提交失败');
    } finally {
      setSubmitting(false);
    }
  };

  if (action === 'beneficiaries')
    return (
      <BeneficiaryPage
        customer={detail}
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
                  <FormControl required fullWidth>
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
                    <FormControl required fullWidth disabled={!source}>
                      <InputLabel>到账账户</InputLabel>
                      <Select
                        label="到账账户"
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
                  <TextField
                    required
                    label={source ? `金额（${source.currency}）` : '金额'}
                    type="number"
                    value={amount}
                    onChange={(event) => setAmount(event.target.value)}
                    inputProps={{ min: 0.01, step: 0.01 }}
                    helperText={
                      source
                        ? `可用余额 ${money(source.availableBalance, source.currency)}`
                        : '请先选择付款账户'
                    }
                  />
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
                  {(action === 'fx' || action === 'otc') && source && targetId && amount && (
                    <Card variant="outlined" sx={{ bgcolor: 'background.neutral' }}>
                      <CardContent sx={{ p: 2.5 }}>
                        {quote ? (
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
                                当前汇率
                              </Typography>
                              <Typography variant="subtitle2">
                                1 {source.currency} = {Number(quote.rate.sellRate).toLocaleString()}{' '}
                                {quote.target.currency}
                              </Typography>
                            </Stack>
                            <Stack direction="row" justifyContent="space-between" gap={2}>
                              <Typography variant="body2" color="text.secondary">
                                报价费率
                              </Typography>
                              <Typography variant="subtitle2">
                                {(quote.rate.feeBps / 100).toFixed(2)}%
                              </Typography>
                            </Stack>
                            <Divider />
                            <Stack direction="row" justifyContent="space-between" gap={2}>
                              <Typography variant="subtitle2">预计到账</Typography>
                              <Typography variant="h6" color="primary.main">
                                {money(quote.received, quote.target.currency)}
                              </Typography>
                            </Stack>
                          </Stack>
                        ) : (
                          <Alert severity="warning">当前币种组合暂无有效报价。</Alert>
                        )}
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
                    提交后进入平台单人审批；审批完成前你可以在交易记录中查看进度。
                  </Alert>
                  <Button
                    size="large"
                    type="submit"
                    variant="contained"
                    disabled={submitting || !sourceId || !amount}
                  >
                    {submitting && '正在提交…'}
                    {!submitting && action === 'payout' && '确认并提交付款'}
                    {!submitting && action !== 'payout' && '确认并提交'}
                  </Button>
                </Stack>
              </Box>
            </CardContent>
          </Card>
        </Stack>
      </Container>
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
  onCreate,
  onReload,
  dialogOpen,
  setDialogOpen,
}: {
  customer: Customer | null;
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
            <Button
              variant="contained"
              startIcon={<Iconify icon="solar:add-circle-linear" />}
              onClick={onCreate}
            >
              新增收款人
            </Button>
          </Stack>
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
                            : 'solar:bank-bold-duotone'
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
                        cryptoRecipient
                          ? '/portal/crypto-wallet/withdraw'
                          : '/portal/money/payouts'
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
                  <Button onClick={onCreate} sx={{ mt: 1.5 }}>
                    立即添加
                  </Button>
                </Stack>
              )}
            </Stack>
          </Card>
        </Stack>
      </Container>
      <BeneficiaryDialog
        open={dialogOpen}
        customerId={customer?.id || ''}
        onClose={() => setDialogOpen(false)}
        onCreated={() => {
          setDialogOpen(false);
          onReload().catch(() => undefined);
        }}
      />
    </>
  );
}
