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
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  FormControl,
  InputLabel,
  MenuItem,
  Select,
  Stack,
  Step,
  StepLabel,
  Stepper,
  TextField,
  Typography,
} from '@mui/material';
import Iconify from 'src/components/iconify';
import CustomBreadcrumbs from 'src/components/custom-breadcrumbs';
import Label from 'src/components/label';
import { usePortalCustomer } from 'src/features/finance/portal-customer-context';
import {
  coreApi,
  Currency,
  Customer,
  FundingChannel,
  isSupportedPortalAccount,
  OperationType,
  RateVersion,
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
    const [customerDetail, channelRows, rateRows] = await Promise.all([
      coreApi<Customer>(`/customers/${customer.id}`),
      coreApi<FundingChannel[]>(`/funding-channels?organizationId=${customer.organizationId}`),
      coreApi<RateVersion[]>('/rates'),
    ]);
    setDetail(customerDetail);
    setChannels(channelRows);
    setRates(rateRows);
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
  const beneficiaries = detail?.beneficiaries || [];
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
        const channelType = payoutChannelType(payoutMethod);
        const channel = channels.find(
          (row) =>
            row.type === channelType &&
            row.active &&
            row.supportedCurrencies.includes(sourceAccount.currency)
        );
        if (!channel) throw new Error('当前付款方式暂不支持该币种');
        Object.assign(payload, {
          beneficiaryId: selectedBeneficiary.id,
          payoutMethod,
          channelId: channel.id,
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
        <title>{info.title} | SCC Digital Bank</title>
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
                                  {row.accountNumber.slice(-4)}
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
                                  {selectedBeneficiary.accountNumber.slice(-4)}
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
  if (method === 'VA') return 'VA_PAYOUT';
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
  return (
    <>
      <Helmet>
        <title>收款人 | SCC Digital Bank</title>
      </Helmet>
      <Container maxWidth="lg">
        <Stack spacing={3}>
          <Stack direction={{ xs: 'column', sm: 'row' }} justifyContent="space-between" gap={2}>
            <Box>
              <Typography variant="h4">第三方收款人</Typography>
              <Typography color="text.secondary" sx={{ mt: 0.75 }}>
                保存常用的个人或企业银行账户，付款时直接选择。
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
          <Box
            sx={{
              display: 'grid',
              gridTemplateColumns: { xs: '1fr', md: 'repeat(2, 1fr)' },
              gap: 2,
            }}
          >
            {rows.map((row) => (
              <Card key={row.id}>
                <CardContent sx={{ p: 3 }}>
                  <Stack direction="row" spacing={2}>
                    <Box
                      sx={{
                        width: 48,
                        height: 48,
                        borderRadius: '50%',
                        bgcolor: 'primary.lighter',
                        display: 'grid',
                        placeItems: 'center',
                      }}
                    >
                      <Iconify icon="solar:bank-bold-duotone" color="primary.main" />
                    </Box>
                    <Box sx={{ flex: 1 }}>
                      <Typography variant="h6">{row.name}</Typography>
                      <Typography variant="body2" color="text.secondary">
                        {row.bankName}
                      </Typography>
                    </Box>
                    <Typography variant="subtitle2">{row.currency}</Typography>
                  </Stack>
                  <Divider sx={{ my: 2 }} />
                  <Typography variant="body2">
                    账号 / IBAN · •••• {row.accountNumber.slice(-4)}
                  </Typography>
                  <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
                    SWIFT · {row.swiftBic || '—'}
                  </Typography>
                  <Button href="/portal/money/payouts" sx={{ mt: 2, px: 0 }}>
                    向此收款人付款
                  </Button>
                </CardContent>
              </Card>
            ))}
          </Box>
          {!rows.length && (
            <Card sx={{ py: 8, textAlign: 'center' }}>
              <Typography color="text.secondary">还没有第三方收款人</Typography>
              <Button onClick={onCreate} sx={{ mt: 1 }}>
                立即添加
              </Button>
            </Card>
          )}
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

function BeneficiaryDialog({
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
  const [name, setName] = useState('');
  const [currency, setCurrency] = useState<Currency>('USD');
  const [bankName, setBankName] = useState('');
  const [accountNumber, setAccountNumber] = useState('');
  const [swiftBic, setSwiftBic] = useState('');
  const [countryCode, setCountryCode] = useState('SG');
  const [error, setError] = useState('');
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError('');
    try {
      await coreApi('/beneficiaries', {
        method: 'POST',
        body: JSON.stringify({
          customerId,
          name,
          currency,
          bankName,
          accountNumber,
          swiftBic: swiftBic || undefined,
          countryCode,
        }),
      });
      onCreated();
    } catch (value) {
      setError(value instanceof Error ? value.message : '保存失败');
    }
  };
  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="sm">
      <Box component="form" onSubmit={submit}>
        <DialogTitle>新增第三方收款人</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ mt: 1 }}>
            {error && <Alert severity="error">{error}</Alert>}
            <TextField
              required
              label="收款人姓名 / 企业名称"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
            <Stack direction="row" spacing={2}>
              <TextField
                required
                fullWidth
                label="国家/地区代码"
                value={countryCode}
                onChange={(e) => setCountryCode(e.target.value.toUpperCase())}
                inputProps={{ maxLength: 2 }}
              />
              <FormControl fullWidth>
                <InputLabel>收款币种</InputLabel>
                <Select
                  label="收款币种"
                  value={currency}
                  onChange={(e) => setCurrency(e.target.value as Currency)}
                >
                  {supportedFiatCurrencies.map((item) => (
                    <MenuItem key={item} value={item}>
                      {item}
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>
            </Stack>
            <TextField
              required
              label="收款银行"
              value={bankName}
              onChange={(e) => setBankName(e.target.value)}
            />
            <TextField
              required
              label="银行账号 / IBAN"
              value={accountNumber}
              onChange={(e) => setAccountNumber(e.target.value)}
            />
            <TextField
              label="SWIFT / BIC"
              value={swiftBic}
              onChange={(e) => setSwiftBic(e.target.value.toUpperCase())}
            />
            <Alert severity="info">付款前请仔细核对第三方资料。保存后可在付款页面直接选择。</Alert>
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={onClose}>取消</Button>
          <Button type="submit" variant="contained">
            保存收款人
          </Button>
        </DialogActions>
      </Box>
    </Dialog>
  );
}
