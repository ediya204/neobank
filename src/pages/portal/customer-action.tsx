import { FormEvent, useEffect, useMemo, useState } from 'react';
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
  Stack,
  Step,
  StepLabel,
  Stepper,
  TextField,
  Typography,
} from '@mui/material';
import Iconify from 'src/components/iconify';
import { usePortalCustomer } from 'src/features/finance/portal-customer-context';
import {
  coreApi,
  Currency,
  Customer,
  FundingChannel,
  OperationType,
} from 'src/features/finance/core-api';
import { accountLabel, money } from './customer-shared';

export type CustomerAction = 'transfer' | 'fx' | 'otc' | 'payout' | 'beneficiaries';

const copy: Record<CustomerAction, { title: string; description: string; icon: string }> = {
  transfer: {
    title: '转账',
    description: '在你的同币种账户之间转移资金。',
    icon: 'solar:transfer-horizontal-bold-duotone',
  },
  fx: {
    title: '换汇',
    description: '在五种法币余额之间完成兑换。',
    icon: 'solar:refresh-square-bold-duotone',
  },
  otc: {
    title: 'OTC 兑换',
    description: '使用法币买入或卖出账户内 USDT。',
    icon: 'solar:hand-money-bold-duotone',
  },
  payout: {
    title: '向第三方付款',
    description: '选择已保存的银行收款人，提交跨境付款申请。',
    icon: 'solar:card-send-bold-duotone',
  },
  beneficiaries: {
    title: '收款人',
    description: '安全保存个人或企业第三方银行收款资料。',
    icon: 'solar:user-id-bold-duotone',
  },
};

export default function CustomerActionPage({ action }: { action: CustomerAction }) {
  const { customer, refresh } = usePortalCustomer();
  const [detail, setDetail] = useState<Customer | null>(null);
  const [channels, setChannels] = useState<FundingChannel[]>([]);
  const [sourceId, setSourceId] = useState('');
  const [targetId, setTargetId] = useState('');
  const [beneficiaryId, setBeneficiaryId] = useState('');
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [payoutMethod, setPayoutMethod] = useState<'VA' | 'POBO' | 'PLATFORM'>('POBO');
  const [beneficiaryOpen, setBeneficiaryOpen] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const loadDetail = async () => {
    if (!customer) return;
    const [customerDetail, channelRows] = await Promise.all([
      coreApi<Customer>(`/customers/${customer.id}`),
      coreApi<FundingChannel[]>('/funding-channels?organizationId=org_demo'),
    ]);
    setDetail(customerDetail);
    setChannels(channelRows);
  };

  useEffect(() => {
    loadDetail().catch((value) => setError(value instanceof Error ? value.message : '加载失败'));
  }, [customer?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const accounts = useMemo(
    () =>
      (detail?.accounts || []).filter(
        (row) =>
          ['SYSTEM_WALLET', 'VIRTUAL_ACCOUNT', 'CRYPTO_WALLET'].includes(row.kind) &&
          row.status === 'ACTIVE'
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
    return payoutMethod === 'VA' ? row.kind === 'VIRTUAL_ACCOUNT' : row.kind === 'SYSTEM_WALLET';
  });
  const sourceOptions =
    action === 'payout'
      ? payoutAccounts
      : accounts.filter((row) => action === 'otc' || row.kind !== 'CRYPTO_WALLET');
  const sourceFieldLabel = action === 'payout' ? '付款账户' : '从账户';

  useEffect(() => {
    setTargetId('');
  }, [sourceId]);
  useEffect(() => {
    if (action === 'payout') setSourceId('');
  }, [action, beneficiaryId, payoutMethod]);

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
        let channelType: FundingChannel['type'] = 'PLATFORM_PAYOUT';
        if (payoutMethod === 'VA') channelType = 'VA_PAYOUT';
        if (payoutMethod === 'POBO') channelType = 'POBO_PAYOUT';
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
          ? '付款已提交。平台复核通过后将由银行或支付通道执行。'
          : '指令已提交审核，完成后余额会自动更新。'
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
        <title>{info.title} | Moventra</title>
      </Helmet>
      <Container maxWidth="md">
        <Stack spacing={3}>
          <Box>
            <Stack direction="row" alignItems="center" spacing={1.5}>
              <Box
                sx={{
                  width: 46,
                  height: 46,
                  borderRadius: 2,
                  display: 'grid',
                  placeItems: 'center',
                  bgcolor: 'primary.lighter',
                }}
              >
                <Iconify icon={info.icon} width={26} color="primary.main" />
              </Box>
              <Box>
                <Typography variant="h4">{info.title}</Typography>
                <Typography color="text.secondary">{info.description}</Typography>
              </Box>
            </Stack>
          </Box>
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
                  <StepLabel>平台复核</StepLabel>
                </Step>
                <Step>
                  <StepLabel>完成</StepLabel>
                </Step>
              </Stepper>
              <Box component="form" onSubmit={submit}>
                <Stack spacing={2.5}>
                  {action === 'payout' && (
                    <>
                      <Stack
                        direction={{ xs: 'column', sm: 'row' }}
                        justifyContent="space-between"
                        gap={1}
                      >
                        <Typography variant="h6">第三方收款人</Typography>
                        <Button
                          startIcon={<Iconify icon="mingcute:add-line" />}
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
                      <FormControl fullWidth>
                        <InputLabel>付款方式</InputLabel>
                        <Select
                          label="付款方式"
                          value={payoutMethod}
                          onChange={(event) =>
                            setPayoutMethod(event.target.value as typeof payoutMethod)
                          }
                        >
                          <MenuItem value="VA">VA 账户直接付款</MenuItem>
                          <MenuItem value="POBO">以客户名义付款（POBO）</MenuItem>
                          <MenuItem value="PLATFORM">平台代付</MenuItem>
                        </Select>
                      </FormControl>
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
                  <TextField
                    label="备注（选填）"
                    value={note}
                    onChange={(event) => setNote(event.target.value)}
                    multiline
                    minRows={2}
                  />
                  <Alert severity="info">
                    提交后进入平台双人复核；复核通过前你可以在交易记录中查看进度。
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
        <title>收款人 | Moventra</title>
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
              startIcon={<Iconify icon="mingcute:add-line" />}
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
                  {(['USD', 'SGD', 'HKD', 'EUR', 'GBP'] as Currency[]).map((item) => (
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
