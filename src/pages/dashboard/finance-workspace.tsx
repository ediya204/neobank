import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import { Helmet } from 'react-helmet-async';
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  Container,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  Drawer,
  FormControl,
  InputLabel,
  MenuItem,
  Select,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  Typography,
} from '@mui/material';
import Iconify from 'src/components/iconify';
import Label from 'src/components/label';
import {
  Beneficiary,
  coreApi,
  Currency,
  Customer,
  demoOrganizationId,
  demoUsers,
  FundingChannel,
  JournalEntry,
  MoneyAccount,
  Operation,
  OperationType,
  RateVersion,
} from 'src/features/finance/core-api';

export type FinanceSection =
  | 'accounts'
  | 'channels'
  | 'beneficiaries'
  | 'rates'
  | 'ledger'
  | 'transactions'
  | 'deposits'
  | 'payouts'
  | 'transfers'
  | 'fx'
  | 'otc'
  | 'adjustments'
  | 'approvals';

const sectionCopy: Record<
  FinanceSection,
  { title: string; description: string; type?: OperationType }
> = {
  accounts: { title: '账户与钱包', description: '查看客户法币钱包、独立 VA 余额和数字钱包状态。' },
  channels: { title: '资金通道', description: '查看法币入账、VA 出款、POBO 和平台代付通道。' },
  beneficiaries: {
    title: '收款人管理',
    description: '维护客户银行收款人，并在出款时复用已验证资料。',
  },
  rates: { title: '汇率与报价', description: '维护 FX 与 OTC 的版本化汇率和费率快照。' },
  ledger: { title: '复式总账', description: '查询不可修改的借贷流水；更正必须通过补偿调账完成。' },
  transactions: {
    title: '交易记录',
    description: '统一查询所有入账、转账、换汇、OTC、出款和调账。',
  },
  deposits: {
    title: '法币入账',
    description: '录入银行到账，经过双人复核后记入指定钱包或 VA。',
    type: 'DEPOSIT',
  },
  payouts: {
    title: '出款管理',
    description: '通过 VA、POBO 或平台账户发起出款并回填银行流水。',
    type: 'PAYOUT',
  },
  transfers: {
    title: '内部转账',
    description: '客户钱包或 VA 之间进行同币种实时账内转账。',
    type: 'INTERNAL_TRANSFER',
  },
  fx: {
    title: '法币换汇',
    description: '在 USD、SGD、HKD、EUR、GBP 之间按版本化汇率兑换。',
    type: 'FX',
  },
  otc: {
    title: 'OTC',
    description: '法币与 USDT 的内部 OTC 订单；链上操作等待 Cregis。',
    type: 'OTC',
  },
  adjustments: {
    title: '调账管理',
    description: '所有余额增减都通过补偿流水和双人复核完成。',
    type: 'ADJUSTMENT',
  },
  approvals: { title: '复核中心', description: '复核其他人员提交的入账、出款、调账、转账与兑换。' },
};

const currencies: Currency[] = ['USD', 'SGD', 'HKD', 'EUR', 'GBP'];

type OperationForm = {
  customerId: string;
  currency: Currency;
  quoteCurrency: Currency;
  amount: string;
  feeAmount: string;
  sourceAccountId: string;
  targetAccountId: string;
  beneficiaryId: string;
  channelId: string;
  payoutMethod: 'VA' | 'POBO' | 'PLATFORM';
  adjustmentDirection: 'CREDIT' | 'DEBIT';
  remitterName: string;
  remitterBank: string;
  remittanceReference: string;
  receivedAt: string;
  narrative: string;
};

const initialForm: OperationForm = {
  customerId: '',
  currency: 'USD',
  quoteCurrency: 'SGD',
  amount: '',
  feeAmount: '0',
  sourceAccountId: '',
  targetAccountId: '',
  beneficiaryId: '',
  channelId: '',
  payoutMethod: 'POBO',
  adjustmentDirection: 'CREDIT',
  remitterName: '',
  remitterBank: '',
  remittanceReference: '',
  receivedAt: new Date().toISOString().slice(0, 16),
  narrative: '',
};

export default function FinanceWorkspace({ section }: { section: FinanceSection }) {
  const copy = sectionCopy[section];
  const [userId, setUserId] = useState<string>('usr_maker');
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [channels, setChannels] = useState<FundingChannel[]>([]);
  const [operations, setOperations] = useState<Operation[]>([]);
  const [rates, setRates] = useState<RateVersion[]>([]);
  const [journals, setJournals] = useState<JournalEntry[]>([]);
  const [selectedCustomerId, setSelectedCustomerId] = useState('');
  const [selected, setSelected] = useState<Operation | null>(null);
  const [status, setStatus] = useState('all');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [createOpen, setCreateOpen] = useState(false);
  const [rejectOpen, setRejectOpen] = useState(false);
  const [rejectReason, setRejectReason] = useState('');
  const [executeOpen, setExecuteOpen] = useState(false);
  const [externalReference, setExternalReference] = useState('');
  const [form, setForm] = useState<OperationForm>(initialForm);
  const [customerDetail, setCustomerDetail] = useState<Customer | null>(null);
  const [beneficiaryOpen, setBeneficiaryOpen] = useState(false);
  const [rateOpen, setRateOpen] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [customerRows, channelRows] = await Promise.all([
        coreApi<Customer[]>(`/customers?organizationId=${demoOrganizationId}`, { userId }),
        coreApi<FundingChannel[]>(`/funding-channels?organizationId=${demoOrganizationId}`, {
          userId,
        }),
      ]);
      setCustomers(customerRows);
      setChannels(channelRows);
      if (!selectedCustomerId && customerRows[0]) setSelectedCustomerId(customerRows[0].id);
      const params = new URLSearchParams({ organizationId: demoOrganizationId });
      if (copy.type) params.set('type', copy.type);
      if (status !== 'all') params.set('status', status);
      const operationRows =
        section === 'approvals'
          ? await coreApi<Operation[]>(
              `/operations/approvals?organizationId=${demoOrganizationId}`,
              { userId }
            )
          : await coreApi<Operation[]>(`/operations?${params.toString()}`, { userId });
      setOperations(operationRows);
      if (section === 'rates') setRates(await coreApi<RateVersion[]>('/rates', { userId }));
      if (section === 'ledger') {
        setJournals(
          await coreApi<JournalEntry[]>(`/ledger?organizationId=${demoOrganizationId}`, { userId })
        );
      }
    } catch (value) {
      setError(value instanceof Error ? value.message : '数据加载失败');
    } finally {
      setLoading(false);
    }
  }, [copy.type, section, selectedCustomerId, status, userId]);

  useEffect(() => {
    load().catch(() => undefined);
  }, [load]);

  useEffect(() => {
    const detailCustomerId = section === 'beneficiaries' ? selectedCustomerId : form.customerId;
    if (!detailCustomerId) {
      setCustomerDetail(null);
      return;
    }
    coreApi<Customer>(`/customers/${detailCustomerId}`, { userId })
      .then(setCustomerDetail)
      .catch((value) => setError(value instanceof Error ? value.message : '客户详情加载失败'));
  }, [form.customerId, section, selectedCustomerId, userId]);

  const selectedCustomer =
    customers.find((customer) => customer.id === selectedCustomerId) || customers[0];
  const displayAccounts = selectedCustomer?.accounts || [];
  const availableAccounts = customerDetail?.accounts || [];
  const beneficiaries = customerDetail?.beneficiaries || [];

  const summary = useMemo(
    () => ({
      submitted: operations.filter((item) => item.status === 'SUBMITTED').length,
      processing: operations.filter((item) => item.status === 'PROCESSING').length,
      completed: operations.filter((item) => item.status === 'COMPLETED').length,
    }),
    [operations]
  );

  const openCreate = () => {
    setForm({ ...initialForm, customerId: customers[0]?.id || '' });
    setCreateOpen(true);
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!copy.type) return;
    setError('');
    try {
      const payload: Record<string, unknown> = {
        customerId: form.customerId,
        type: copy.type,
        currency: form.currency,
        amount: form.amount,
        feeAmount: form.feeAmount,
        narrative: form.narrative,
        idempotencyKey: crypto.randomUUID(),
      };
      if (
        ['PAYOUT', 'INTERNAL_TRANSFER', 'FX', 'OTC'].includes(copy.type) ||
        (copy.type === 'ADJUSTMENT' && form.adjustmentDirection === 'DEBIT')
      ) {
        payload.sourceAccountId = form.sourceAccountId;
      }
      if (
        ['DEPOSIT', 'INTERNAL_TRANSFER', 'FX', 'OTC'].includes(copy.type) ||
        (copy.type === 'ADJUSTMENT' && form.adjustmentDirection === 'CREDIT')
      ) {
        payload.targetAccountId = form.targetAccountId;
      }
      if (copy.type === 'DEPOSIT') {
        Object.assign(payload, {
          channelId: form.channelId,
          remitterName: form.remitterName,
          remitterBank: form.remitterBank,
          remittanceReference: form.remittanceReference,
          receivedAt: new Date(form.receivedAt).toISOString(),
        });
      }
      if (copy.type === 'PAYOUT') {
        Object.assign(payload, {
          channelId: form.channelId,
          beneficiaryId: form.beneficiaryId,
          payoutMethod: form.payoutMethod,
        });
      }
      if (copy.type === 'FX' || copy.type === 'OTC') payload.quoteCurrency = form.quoteCurrency;
      if (copy.type === 'ADJUSTMENT') payload.adjustmentDirection = form.adjustmentDirection;
      await coreApi('/operations', { method: 'POST', body: JSON.stringify(payload), userId });
      setCreateOpen(false);
      setSuccess('已提交，等待另一名人员复核');
      await load();
    } catch (value) {
      setError(value instanceof Error ? value.message : '提交失败');
    }
  };

  const perform = async (action: 'approve' | 'reject' | 'execute') => {
    if (!selected) return;
    setError('');
    try {
      let body: string | undefined;
      if (action === 'reject') body = JSON.stringify({ reason: rejectReason });
      if (action === 'execute') body = JSON.stringify({ externalReference });
      const updated = await coreApi<Operation>(`/operations/${selected.id}/${action}`, {
        method: 'PATCH',
        body,
        userId,
      });
      setSelected(updated);
      setRejectOpen(false);
      setExecuteOpen(false);
      const messages = {
        approve: '复核通过',
        reject: '已拒绝并释放冻结资金',
        execute: '出款执行完成',
      };
      setSuccess(messages[action]);
      await load();
    } catch (value) {
      setError(value instanceof Error ? value.message : '操作失败');
    }
  };

  let workspaceContent = (
    <>
      <Stack direction={{ xs: 'column', md: 'row' }} spacing={2}>
        <Metric
          title="待复核"
          value={summary.submitted}
          color="warning"
          icon="solar:clipboard-check-bold-duotone"
        />
        <Metric
          title="执行中"
          value={summary.processing}
          color="info"
          icon="solar:hourglass-line-bold-duotone"
        />
        <Metric
          title="已完成"
          value={summary.completed}
          color="success"
          icon="solar:check-circle-bold-duotone"
        />
      </Stack>
      <Card>
        <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ p: 2.5 }}>
          <Typography variant="h6">业务记录</Typography>
          {section !== 'approvals' && (
            <FormControl size="small" sx={{ minWidth: 140 }}>
              <InputLabel>状态</InputLabel>
              <Select
                label="状态"
                value={status}
                onChange={(event) => setStatus(event.target.value)}
              >
                <MenuItem value="all">全部</MenuItem>
                <MenuItem value="SUBMITTED">待复核</MenuItem>
                <MenuItem value="PROCESSING">执行中</MenuItem>
                <MenuItem value="COMPLETED">已完成</MenuItem>
                <MenuItem value="REJECTED">已拒绝</MenuItem>
              </Select>
            </FormControl>
          )}
        </Stack>
        <OperationTable rows={operations} loading={loading} onOpen={setSelected} />
      </Card>
    </>
  );
  if (section === 'channels') workspaceContent = <ChannelGrid channels={channels} />;
  if (section === 'accounts') {
    workspaceContent = (
      <AccountWorkspace
        customers={customers}
        selectedCustomerId={selectedCustomer?.id || ''}
        onCustomerChange={setSelectedCustomerId}
        accounts={displayAccounts}
      />
    );
  }
  if (section === 'beneficiaries') {
    workspaceContent = (
      <BeneficiaryWorkspace
        customers={customers}
        selectedCustomerId={selectedCustomer?.id || ''}
        onCustomerChange={setSelectedCustomerId}
        rows={customerDetail?.beneficiaries || []}
        onCreate={() => setBeneficiaryOpen(true)}
      />
    );
  }
  if (section === 'rates') {
    workspaceContent = <RateWorkspace rows={rates} onCreate={() => setRateOpen(true)} />;
  }
  if (section === 'ledger')
    workspaceContent = <LedgerWorkspace rows={journals} loading={loading} />;

  return (
    <>
      <Helmet>
        <title>{copy.title} | Moventra</title>
      </Helmet>
      <Container maxWidth="xl">
        <Stack spacing={3}>
          <Stack direction={{ xs: 'column', md: 'row' }} justifyContent="space-between" gap={2}>
            <Box>
              <Typography variant="h4">{copy.title}</Typography>
              <Typography color="text.secondary" sx={{ mt: 0.75 }}>
                {copy.description}
              </Typography>
            </Box>
            <Stack direction="row" gap={1.5} alignItems="center">
              <FormControl size="small" sx={{ minWidth: 180 }}>
                <InputLabel>本地演示身份</InputLabel>
                <Select
                  label="本地演示身份"
                  value={userId}
                  onChange={(event) => setUserId(event.target.value)}
                >
                  {demoUsers.map((user) => (
                    <MenuItem key={user.id} value={user.id}>
                      {user.label}
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>
              {copy.type && (
                <Button
                  variant="contained"
                  startIcon={<Iconify icon="mingcute:add-line" />}
                  onClick={openCreate}
                >
                  新建{copy.title}
                </Button>
              )}
            </Stack>
          </Stack>

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
          <Alert severity="info">
            所有入账、出款和调账均需双人复核；提交人无法审批自己创建的指令。
          </Alert>

          {workspaceContent}
        </Stack>
      </Container>

      {copy.type && (
        <OperationDialog
          open={createOpen}
          type={copy.type}
          form={form}
          setForm={setForm}
          customers={customers}
          accounts={availableAccounts}
          beneficiaries={beneficiaries}
          channels={channels}
          onClose={() => setCreateOpen(false)}
          onSubmit={submit}
        />
      )}
      <OperationDrawer
        operation={selected}
        currentUserId={userId}
        onClose={() => setSelected(null)}
        onApprove={() => perform('approve').catch(() => undefined)}
        onReject={() => setRejectOpen(true)}
        onExecute={() => setExecuteOpen(true)}
      />
      <Dialog open={rejectOpen} onClose={() => setRejectOpen(false)} fullWidth maxWidth="sm">
        <DialogTitle>拒绝业务指令</DialogTitle>
        <DialogContent>
          <TextField
            fullWidth
            multiline
            minRows={3}
            label="拒绝原因"
            value={rejectReason}
            onChange={(e) => setRejectReason(e.target.value)}
            sx={{ mt: 1 }}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setRejectOpen(false)}>取消</Button>
          <Button
            color="error"
            variant="contained"
            onClick={() => perform('reject').catch(() => undefined)}
          >
            确认拒绝
          </Button>
        </DialogActions>
      </Dialog>
      <Dialog open={executeOpen} onClose={() => setExecuteOpen(false)} fullWidth maxWidth="sm">
        <DialogTitle>完成银行出款</DialogTitle>
        <DialogContent>
          <TextField
            fullWidth
            label="银行/渠道流水号"
            value={externalReference}
            onChange={(e) => setExternalReference(e.target.value)}
            sx={{ mt: 1 }}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setExecuteOpen(false)}>取消</Button>
          <Button variant="contained" onClick={() => perform('execute').catch(() => undefined)}>
            确认完成
          </Button>
        </DialogActions>
      </Dialog>
      <BeneficiaryDialog
        open={beneficiaryOpen}
        customerId={selectedCustomer?.id || ''}
        onClose={() => setBeneficiaryOpen(false)}
        onCreated={() => {
          setBeneficiaryOpen(false);
          setSuccess('收款人已添加');
          load().catch(() => undefined);
        }}
        userId={userId}
      />
      <RateDialog
        open={rateOpen}
        onClose={() => setRateOpen(false)}
        onCreated={() => {
          setRateOpen(false);
          setSuccess('新汇率版本已生效，历史版本已保留');
          load().catch(() => undefined);
        }}
        userId={userId}
      />
    </>
  );
}

function BeneficiaryWorkspace({
  customers,
  selectedCustomerId,
  onCustomerChange,
  rows,
  onCreate,
}: {
  customers: Customer[];
  selectedCustomerId: string;
  onCustomerChange: (id: string) => void;
  rows: Beneficiary[];
  onCreate: () => void;
}) {
  return (
    <Stack spacing={2}>
      <Card sx={{ p: 2.5 }}>
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
          <FormControl fullWidth>
            <InputLabel>客户</InputLabel>
            <Select
              label="客户"
              value={selectedCustomerId}
              onChange={(event) => onCustomerChange(event.target.value)}
            >
              {customers.map((customer) => (
                <MenuItem key={customer.id} value={customer.id}>
                  {customer.displayName}
                </MenuItem>
              ))}
            </Select>
          </FormControl>
          <Button variant="contained" sx={{ minWidth: 140 }} onClick={onCreate}>
            新增收款人
          </Button>
        </Stack>
      </Card>
      <Card>
        <TableContainer>
          <Table>
            <TableHead>
              <TableRow>
                <TableCell>收款人</TableCell>
                <TableCell>币种</TableCell>
                <TableCell>银行</TableCell>
                <TableCell>账号 / IBAN</TableCell>
                <TableCell>SWIFT</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {rows.map((row) => (
                <TableRow key={row.id}>
                  <TableCell>{row.name}</TableCell>
                  <TableCell>{row.currency}</TableCell>
                  <TableCell>{row.bankName}</TableCell>
                  <TableCell>{row.accountNumber}</TableCell>
                  <TableCell>{row.swiftBic || '-'}</TableCell>
                </TableRow>
              ))}
              {!rows.length && (
                <TableRow>
                  <TableCell colSpan={5} align="center" sx={{ py: 7 }}>
                    暂无收款人
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </TableContainer>
      </Card>
    </Stack>
  );
}

function RateWorkspace({ rows, onCreate }: { rows: RateVersion[]; onCreate: () => void }) {
  return (
    <Card>
      <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ p: 2.5 }}>
        <Box>
          <Typography variant="h6">当前与历史汇率</Typography>
          <Typography variant="body2" color="text.secondary">
            新建版本不会覆盖历史交易使用的汇率快照。
          </Typography>
        </Box>
        <Button variant="contained" onClick={onCreate}>
          新建汇率版本
        </Button>
      </Stack>
      <TableContainer>
        <Table>
          <TableHead>
            <TableRow>
              <TableCell>类型</TableCell>
              <TableCell>币对</TableCell>
              <TableCell>买入价</TableCell>
              <TableCell>卖出价</TableCell>
              <TableCell>费率</TableCell>
              <TableCell>生效时间</TableCell>
              <TableCell>状态</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {rows.map((row) => (
              <TableRow key={row.id}>
                <TableCell>{row.type}</TableCell>
                <TableCell>
                  {row.baseCurrency}/{row.quoteCurrency}
                </TableCell>
                <TableCell>{row.buyRate}</TableCell>
                <TableCell>{row.sellRate}</TableCell>
                <TableCell>{row.feeBps} bps</TableCell>
                <TableCell>{new Date(row.effectiveFrom).toLocaleString('zh-CN')}</TableCell>
                <TableCell>
                  <Label color={row.active ? 'success' : 'default'}>
                    {row.active ? '生效中' : '历史'}
                  </Label>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableContainer>
    </Card>
  );
}

function LedgerWorkspace({ rows, loading }: { rows: JournalEntry[]; loading: boolean }) {
  return (
    <Card>
      <TableContainer>
        <Table>
          <TableHead>
            <TableRow>
              <TableCell>凭证号</TableCell>
              <TableCell>业务</TableCell>
              <TableCell>客户</TableCell>
              <TableCell>借贷明细</TableCell>
              <TableCell>入账时间</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {rows.map((row) => (
              <TableRow key={row.id}>
                <TableCell>{row.reference}</TableCell>
                <TableCell>{row.operation.reference}</TableCell>
                <TableCell>{row.operation.customer.displayName}</TableCell>
                <TableCell>
                  <Stack spacing={0.5}>
                    {row.lines.map((line) => (
                      <Typography key={line.id} variant="caption">
                        {line.side === 'DEBIT' ? '借' : '贷'} · {line.account.name} ·{' '}
                        {formatMoney(line.amount, line.currency)}
                      </Typography>
                    ))}
                  </Stack>
                </TableCell>
                <TableCell>{new Date(row.postedAt).toLocaleString('zh-CN')}</TableCell>
              </TableRow>
            ))}
            {!rows.length && (
              <TableRow>
                <TableCell colSpan={5} align="center" sx={{ py: 7 }}>
                  {loading ? '加载中…' : '暂无已入账凭证'}
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </TableContainer>
    </Card>
  );
}

function BeneficiaryDialog({
  open,
  customerId,
  userId,
  onClose,
  onCreated,
}: {
  open: boolean;
  customerId: string;
  userId: string;
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
    try {
      await coreApi('/beneficiaries', {
        method: 'POST',
        userId,
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
      setError(value instanceof Error ? value.message : '新增失败');
    }
  };
  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="sm">
      <Box component="form" onSubmit={submit}>
        <DialogTitle>新增银行收款人</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ mt: 1 }}>
            {error && <Alert severity="error">{error}</Alert>}
            <TextField
              required
              label="收款人名称"
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
            <FormControl fullWidth>
              <InputLabel>币种</InputLabel>
              <Select
                label="币种"
                value={currency}
                onChange={(event) => setCurrency(event.target.value as Currency)}
              >
                {currencies.map((item) => (
                  <MenuItem key={item} value={item}>
                    {item}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
            <TextField
              required
              label="银行名称"
              value={bankName}
              onChange={(event) => setBankName(event.target.value)}
            />
            <TextField
              required
              label="银行账号 / IBAN"
              value={accountNumber}
              onChange={(event) => setAccountNumber(event.target.value)}
            />
            <Stack direction="row" spacing={2}>
              <TextField
                fullWidth
                label="SWIFT/BIC"
                value={swiftBic}
                onChange={(event) => setSwiftBic(event.target.value.toUpperCase())}
              />
              <TextField
                required
                fullWidth
                label="国家代码"
                value={countryCode}
                onChange={(event) => setCountryCode(event.target.value.toUpperCase())}
                inputProps={{ maxLength: 2 }}
              />
            </Stack>
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

function RateDialog({
  open,
  userId,
  onClose,
  onCreated,
}: {
  open: boolean;
  userId: string;
  onClose: () => void;
  onCreated: () => void;
}) {
  const [type, setType] = useState<'FX' | 'OTC'>('FX');
  const [baseCurrency, setBaseCurrency] = useState<Currency>('USD');
  const [quoteCurrency, setQuoteCurrency] = useState<Currency>('SGD');
  const [buyRate, setBuyRate] = useState('1');
  const [sellRate, setSellRate] = useState('1');
  const [feeBps, setFeeBps] = useState('20');
  const [error, setError] = useState('');
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    try {
      await coreApi('/rates', {
        method: 'POST',
        userId,
        body: JSON.stringify({
          type,
          baseCurrency,
          quoteCurrency,
          buyRate,
          sellRate,
          feeBps: Number(feeBps),
          effectiveFrom: new Date().toISOString(),
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
        <DialogTitle>新建汇率版本</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ mt: 1 }}>
            {error && <Alert severity="error">{error}</Alert>}
            <FormControl fullWidth>
              <InputLabel>类型</InputLabel>
              <Select
                label="类型"
                value={type}
                onChange={(event) => setType(event.target.value as 'FX' | 'OTC')}
              >
                <MenuItem value="FX">法币换汇</MenuItem>
                <MenuItem value="OTC">OTC</MenuItem>
              </Select>
            </FormControl>
            <Stack direction="row" spacing={2}>
              <FormControl fullWidth>
                <InputLabel>基础币种</InputLabel>
                <Select
                  label="基础币种"
                  value={baseCurrency}
                  onChange={(event) => setBaseCurrency(event.target.value as Currency)}
                >
                  {currencies.map((item) => (
                    <MenuItem key={item} value={item}>
                      {item}
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>
              <FormControl fullWidth>
                <InputLabel>报价币种</InputLabel>
                <Select
                  label="报价币种"
                  value={quoteCurrency}
                  onChange={(event) => setQuoteCurrency(event.target.value as Currency)}
                >
                  {(type === 'OTC' ? ['USDT'] : currencies).map((item) => (
                    <MenuItem key={item} value={item}>
                      {item}
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>
            </Stack>
            <Stack direction="row" spacing={2}>
              <TextField
                required
                fullWidth
                type="number"
                label="买入价"
                value={buyRate}
                onChange={(event) => setBuyRate(event.target.value)}
              />
              <TextField
                required
                fullWidth
                type="number"
                label="卖出价"
                value={sellRate}
                onChange={(event) => setSellRate(event.target.value)}
              />
            </Stack>
            <TextField
              required
              type="number"
              label="费率 (bps)"
              value={feeBps}
              onChange={(event) => setFeeBps(event.target.value)}
            />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={onClose}>取消</Button>
          <Button type="submit" variant="contained">
            创建版本
          </Button>
        </DialogActions>
      </Box>
    </Dialog>
  );
}

function Metric({
  title,
  value,
  color,
  icon,
}: {
  title: string;
  value: number;
  color: 'warning' | 'info' | 'success';
  icon: string;
}) {
  return (
    <Card sx={{ flex: 1 }}>
      <CardContent>
        <Stack direction="row" justifyContent="space-between">
          <Box>
            <Typography color="text.secondary" variant="body2">
              {title}
            </Typography>
            <Typography variant="h3" sx={{ mt: 1 }}>
              {value}
            </Typography>
          </Box>
          <Box
            sx={{
              width: 48,
              height: 48,
              borderRadius: 2,
              bgcolor: `${color}.lighter`,
              color: `${color}.dark`,
              display: 'grid',
              placeItems: 'center',
            }}
          >
            <Iconify icon={icon} width={26} />
          </Box>
        </Stack>
      </CardContent>
    </Card>
  );
}

function ChannelGrid({ channels }: { channels: FundingChannel[] }) {
  const descriptions: Record<FundingChannel['type'], string> = {
    FIAT_INBOUND: '接收银行汇款，匹配客户与目标 VA/钱包，复核后入账。',
    VA_PAYOUT: '从指定独立 VA 余额扣款，以该 VA 持有人信息作为付款人。',
    POBO_PAYOUT: '从系统钱包扣款，由通道以客户名义执行 POBO 付款。',
    PLATFORM_PAYOUT: '从系统钱包扣款，以平台母账户作为银行付款人。',
  };
  return (
    <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: 'repeat(2, 1fr)' }, gap: 2 }}>
      {channels.map((channel) => (
        <Card key={channel.id}>
          <CardContent>
            <Stack direction="row" justifyContent="space-between">
              <Box>
                <Typography variant="h6">{channel.name}</Typography>
                <Typography variant="caption" color="text.secondary">
                  {channel.code}
                </Typography>
              </Box>
              <Chip
                color={channel.active ? 'success' : 'default'}
                label={channel.active ? '启用' : '停用'}
                size="small"
              />
            </Stack>
            <Typography color="text.secondary" sx={{ my: 2 }}>
              {descriptions[channel.type]}
            </Typography>
            <Stack direction="row" flexWrap="wrap" gap={0.75}>
              {channel.supportedCurrencies.map((currency) => (
                <Chip key={currency} label={currency} size="small" />
              ))}
            </Stack>
            {channel.settlementBankName && (
              <Typography variant="body2" sx={{ mt: 2 }}>
                {channel.settlementBankName} · {channel.settlementAccount}
              </Typography>
            )}
          </CardContent>
        </Card>
      ))}
    </Box>
  );
}

function AccountWorkspace({
  customers,
  selectedCustomerId,
  onCustomerChange,
  accounts,
}: {
  customers: Customer[];
  selectedCustomerId: string;
  onCustomerChange: (id: string) => void;
  accounts: MoneyAccount[];
}) {
  return (
    <Stack spacing={2}>
      <Card sx={{ p: 2.5 }}>
        <FormControl fullWidth>
          <InputLabel>客户</InputLabel>
          <Select
            value={selectedCustomerId}
            label="客户"
            onChange={(event) => onCustomerChange(event.target.value)}
          >
            {customers.map((customer) => (
              <MenuItem key={customer.id} value={customer.id}>
                {customer.displayName}
              </MenuItem>
            ))}
          </Select>
        </FormControl>
      </Card>
      <Box
        sx={{
          display: 'grid',
          gridTemplateColumns: { xs: '1fr', md: 'repeat(2, 1fr)', xl: 'repeat(3, 1fr)' },
          gap: 2,
        }}
      >
        {accounts.map((account) => (
          <Card key={account.id}>
            <CardContent>
              <Stack direction="row" justifyContent="space-between">
                <Box>
                  <Typography variant="subtitle1">{account.name}</Typography>
                  <Typography variant="caption" color="text.secondary">
                    {account.accountNumber}
                  </Typography>
                </Box>
                <Label
                  color={account.kind !== 'CRYPTO_WALLET' && account.status === 'ACTIVE' ? 'success' : 'default'}
                >
                  {account.kind === 'CRYPTO_WALLET' ? '等待 Cregis' : account.status}
                </Label>
              </Stack>
              <Typography variant="h4" sx={{ mt: 2 }}>
                {formatMoney(account.availableBalance, account.currency)}
              </Typography>
              <Typography variant="body2" color="text.secondary">
                冻结：{formatMoney(account.frozenBalance, account.currency)}
              </Typography>
              <Divider sx={{ my: 2 }} />
              <Typography variant="body2">{accountDescription(account)}</Typography>
            </CardContent>
          </Card>
        ))}
      </Box>
    </Stack>
  );
}

function OperationTable({
  rows,
  loading,
  onOpen,
}: {
  rows: Operation[];
  loading: boolean;
  onOpen: (row: Operation) => void;
}) {
  return (
    <TableContainer>
      <Table>
        <TableHead>
          <TableRow>
            <TableCell>业务编号</TableCell>
            <TableCell>客户</TableCell>
            <TableCell>类型</TableCell>
            <TableCell>金额</TableCell>
            <TableCell>通道/方式</TableCell>
            <TableCell>状态</TableCell>
            <TableCell>提交人</TableCell>
            <TableCell>时间</TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {rows.map((row) => (
            <TableRow key={row.id} hover onClick={() => onOpen(row)} sx={{ cursor: 'pointer' }}>
              <TableCell>
                <Typography variant="subtitle2">{row.reference}</Typography>
              </TableCell>
              <TableCell>{row.customer.displayName}</TableCell>
              <TableCell>{operationTypeText(row.type)}</TableCell>
              <TableCell>{formatMoney(row.amount, row.currency)}</TableCell>
              <TableCell>{row.channel?.name || row.payoutMethod || '-'}</TableCell>
              <TableCell>
                <StatusLabel status={row.status} />
              </TableCell>
              <TableCell>{row.maker.displayName}</TableCell>
              <TableCell>{new Date(row.createdAt).toLocaleString('zh-CN')}</TableCell>
            </TableRow>
          ))}
          {!rows.length && (
            <TableRow>
              <TableCell colSpan={8} align="center" sx={{ py: 8, color: 'text.secondary' }}>
                {loading ? '加载中…' : '暂无记录'}
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
    </TableContainer>
  );
}

function OperationDialog({
  open,
  type,
  form,
  setForm,
  customers,
  accounts,
  beneficiaries,
  channels,
  onClose,
  onSubmit,
}: {
  open: boolean;
  type: OperationType;
  form: OperationForm;
  setForm: (form: OperationForm) => void;
  customers: Customer[];
  accounts: MoneyAccount[];
  beneficiaries: Beneficiary[];
  channels: FundingChannel[];
  onClose: () => void;
  onSubmit: (event: FormEvent) => void;
}) {
  const set = (key: keyof OperationForm, value: string) => setForm({ ...form, [key]: value });
  const sourceRequired =
    ['PAYOUT', 'INTERNAL_TRANSFER', 'FX', 'OTC'].includes(type) ||
    (type === 'ADJUSTMENT' && form.adjustmentDirection === 'DEBIT');
  const targetRequired =
    ['DEPOSIT', 'INTERNAL_TRANSFER', 'FX', 'OTC'].includes(type) ||
    (type === 'ADJUSTMENT' && form.adjustmentDirection === 'CREDIT');
  let payoutChannelType: FundingChannel['type'] = 'PLATFORM_PAYOUT';
  if (form.payoutMethod === 'VA') payoutChannelType = 'VA_PAYOUT';
  if (form.payoutMethod === 'POBO') payoutChannelType = 'POBO_PAYOUT';
  let validChannels: FundingChannel[] = [];
  if (type === 'DEPOSIT') {
    validChannels = channels.filter((channel) => channel.type === 'FIAT_INBOUND');
  }
  if (type === 'PAYOUT') {
    validChannels = channels.filter((channel) => channel.type === payoutChannelType);
  }
  const validSources = accounts.filter(
    (account) =>
      account.currency === form.currency &&
      account.status === 'ACTIVE' &&
      (type !== 'PAYOUT' ||
        (form.payoutMethod === 'VA'
          ? account.kind === 'VIRTUAL_ACCOUNT'
          : account.kind === 'SYSTEM_WALLET'))
  );
  const validTargets = accounts.filter(
    (account) =>
      account.status === 'ACTIVE' &&
      account.currency === (type === 'FX' || type === 'OTC' ? form.quoteCurrency : form.currency)
  );
  const dialogNotice =
    type === 'DEPOSIT'
      ? '提交后进入待复核；另一名人员复核通过后才会记入目标钱包或 VA。'
      : '提交后将冻结相关余额并进入复核；请切换到另一名复核人员完成审批。';
  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="md">
      <Box component="form" onSubmit={onSubmit}>
        <DialogTitle>新建{operationTypeText(type)}</DialogTitle>
        <DialogContent>
          <Stack spacing={2.5} sx={{ mt: 1 }}>
            <Alert severity="info">{dialogNotice}</Alert>
            <FormControl fullWidth required>
              <InputLabel>客户</InputLabel>
              <Select
                label="客户"
                value={form.customerId}
                onChange={(e) => set('customerId', e.target.value)}
              >
                {customers.map((customer) => (
                  <MenuItem key={customer.id} value={customer.id}>
                    {customer.displayName}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
            {type === 'ADJUSTMENT' && (
              <FormControl fullWidth>
                <InputLabel>调账方向</InputLabel>
                <Select
                  label="调账方向"
                  value={form.adjustmentDirection}
                  onChange={(e) => set('adjustmentDirection', e.target.value)}
                >
                  <MenuItem value="CREDIT">增加余额</MenuItem>
                  <MenuItem value="DEBIT">减少余额</MenuItem>
                </Select>
              </FormControl>
            )}
            {type === 'PAYOUT' && (
              <FormControl fullWidth>
                <InputLabel>出款方式</InputLabel>
                <Select
                  label="出款方式"
                  value={form.payoutMethod}
                  onChange={(e) =>
                    setForm({
                      ...form,
                      payoutMethod: e.target.value as OperationForm['payoutMethod'],
                      sourceAccountId: '',
                      channelId: '',
                    })
                  }
                >
                  <MenuItem value="VA">VA 出款</MenuItem>
                  <MenuItem value="POBO">POBO 出款</MenuItem>
                  <MenuItem value="PLATFORM">平台代付</MenuItem>
                </Select>
              </FormControl>
            )}
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
              <FormControl fullWidth>
                <InputLabel>币种</InputLabel>
                <Select
                  label="币种"
                  value={form.currency}
                  onChange={(e) => set('currency', e.target.value)}
                >
                  {currencies.map((currency) => (
                    <MenuItem key={currency} value={currency}>
                      {currency}
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>
              {(type === 'FX' || type === 'OTC') && (
                <FormControl fullWidth>
                  <InputLabel>目标币种</InputLabel>
                  <Select
                    label="目标币种"
                    value={form.quoteCurrency}
                    onChange={(e) => set('quoteCurrency', e.target.value)}
                  >
                    {(type === 'OTC'
                      ? ['USDT']
                      : currencies.filter((item) => item !== form.currency)
                    ).map((currency) => (
                      <MenuItem key={currency} value={currency}>
                        {currency}
                      </MenuItem>
                    ))}
                  </Select>
                </FormControl>
              )}
              <TextField
                fullWidth
                required
                label="金额"
                type="number"
                inputProps={{ min: 0.01, step: 0.01 }}
                value={form.amount}
                onChange={(e) => set('amount', e.target.value)}
              />
            </Stack>
            {sourceRequired && (
              <AccountSelect
                label="扣款账户"
                value={form.sourceAccountId}
                accounts={validSources}
                onChange={(value) => set('sourceAccountId', value)}
              />
            )}
            {targetRequired && (
              <AccountSelect
                label="入账账户"
                value={form.targetAccountId}
                accounts={validTargets}
                onChange={(value) => set('targetAccountId', value)}
              />
            )}
            {(type === 'DEPOSIT' || type === 'PAYOUT') && (
              <FormControl fullWidth required>
                <InputLabel>资金通道</InputLabel>
                <Select
                  label="资金通道"
                  value={form.channelId}
                  onChange={(e) => set('channelId', e.target.value)}
                >
                  {validChannels.map((channel) => (
                    <MenuItem key={channel.id} value={channel.id}>
                      {channel.name}
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>
            )}
            {type === 'DEPOSIT' && (
              <>
                <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
                  <TextField
                    fullWidth
                    required
                    label="汇款人"
                    value={form.remitterName}
                    onChange={(e) => set('remitterName', e.target.value)}
                  />
                  <TextField
                    fullWidth
                    label="汇出银行"
                    value={form.remitterBank}
                    onChange={(e) => set('remitterBank', e.target.value)}
                  />
                </Stack>
                <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
                  <TextField
                    fullWidth
                    required
                    label="银行流水号"
                    value={form.remittanceReference}
                    onChange={(e) => set('remittanceReference', e.target.value)}
                  />
                  <TextField
                    fullWidth
                    required
                    label="到账时间"
                    type="datetime-local"
                    InputLabelProps={{ shrink: true }}
                    value={form.receivedAt}
                    onChange={(e) => set('receivedAt', e.target.value)}
                  />
                </Stack>
              </>
            )}
            {type === 'PAYOUT' && (
              <FormControl fullWidth required>
                <InputLabel>收款人</InputLabel>
                <Select
                  label="收款人"
                  value={form.beneficiaryId}
                  onChange={(e) => set('beneficiaryId', e.target.value)}
                >
                  {beneficiaries
                    .filter((item) => item.currency === form.currency)
                    .map((item) => (
                      <MenuItem key={item.id} value={item.id}>
                        {item.name} · {item.bankName} · {item.accountNumber}
                      </MenuItem>
                    ))}
                </Select>
              </FormControl>
            )}
            <TextField
              fullWidth
              multiline
              minRows={2}
              label="业务备注"
              value={form.narrative}
              onChange={(e) => set('narrative', e.target.value)}
            />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={onClose}>取消</Button>
          <Button type="submit" variant="contained">
            提交复核
          </Button>
        </DialogActions>
      </Box>
    </Dialog>
  );
}

function AccountSelect({
  label,
  value,
  accounts,
  onChange,
}: {
  label: string;
  value: string;
  accounts: MoneyAccount[];
  onChange: (value: string) => void;
}) {
  return (
    <FormControl fullWidth required>
      <InputLabel>{label}</InputLabel>
      <Select label={label} value={value} onChange={(e) => onChange(e.target.value)}>
        {accounts.map((account) => (
          <MenuItem key={account.id} value={account.id}>
            {account.name} · {account.currency} · 可用 {account.availableBalance}
          </MenuItem>
        ))}
      </Select>
    </FormControl>
  );
}

function OperationDrawer({
  operation,
  currentUserId,
  onClose,
  onApprove,
  onReject,
  onExecute,
}: {
  operation: Operation | null;
  currentUserId: string;
  onClose: () => void;
  onApprove: () => void;
  onReject: () => void;
  onExecute: () => void;
}) {
  if (!operation) return null;
  const isOwn = operation.maker.id === currentUserId;
  return (
    <Drawer
      anchor="right"
      open
      onClose={onClose}
      PaperProps={{ sx: { width: { xs: 1, sm: 520 }, p: 3 } }}
    >
      <Stack spacing={3}>
        <Stack direction="row" justifyContent="space-between">
          <Box>
            <Typography variant="h5">{operationTypeText(operation.type)}</Typography>
            <Typography color="text.secondary">{operation.reference}</Typography>
          </Box>
          <StatusLabel status={operation.status} />
        </Stack>
        {isOwn && operation.status === 'SUBMITTED' && (
          <Alert severity="warning">这是你提交的指令，不能由你本人复核。</Alert>
        )}
        <Detail label="客户" value={operation.customer.displayName} />
        <Detail label="金额" value={formatMoney(operation.amount, operation.currency)} />
        <Detail label="手续费" value={formatMoney(operation.feeAmount, operation.currency)} />
        <Detail
          label="扣款账户"
          value={
            operation.sourceAccount
              ? `${operation.sourceAccount.name} · ${operation.sourceAccount.accountNumber}`
              : '-'
          }
        />
        <Detail
          label="入账账户"
          value={
            operation.targetAccount
              ? `${operation.targetAccount.name} · ${operation.targetAccount.accountNumber}`
              : '-'
          }
        />
        <Detail label="资金通道" value={operation.channel?.name || '-'} />
        <Detail
          label="收款人"
          value={
            operation.beneficiary
              ? `${operation.beneficiary.name} · ${operation.beneficiary.bankName}`
              : '-'
          }
        />
        {operation.remitterName && (
          <Detail
            label="汇款信息"
            value={`${operation.remitterName} · ${operation.remittanceReference}`}
          />
        )}
        {operation.externalReference && (
          <Detail label="外部流水" value={operation.externalReference} />
        )}
        <Divider />
        <Detail label="提交人" value={operation.maker.displayName} />
        <Detail label="复核人" value={operation.checker?.displayName || '待复核'} />
        <Detail label="执行人" value={operation.operator?.displayName || '-'} />
        {operation.rejectionReason && (
          <Alert severity="error">拒绝原因：{operation.rejectionReason}</Alert>
        )}
        <Box sx={{ flexGrow: 1 }} />
        {operation.status === 'SUBMITTED' && (
          <Stack direction="row" spacing={1}>
            <Button fullWidth color="error" variant="outlined" onClick={onReject}>
              拒绝
            </Button>
            <Button fullWidth variant="contained" disabled={isOwn} onClick={onApprove}>
              复核通过
            </Button>
          </Stack>
        )}
        {operation.status === 'PROCESSING' && (
          <Button variant="contained" onClick={onExecute}>
            回填银行流水并完成
          </Button>
        )}
      </Stack>
    </Drawer>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <Stack direction="row" justifyContent="space-between" gap={2}>
      <Typography color="text.secondary">{label}</Typography>
      <Typography variant="subtitle2" textAlign="right">
        {value}
      </Typography>
    </Stack>
  );
}
function StatusLabel({ status }: { status: Operation['status'] }) {
  let color: 'success' | 'error' | 'info' | 'warning' = 'warning';
  if (status === 'COMPLETED') color = 'success';
  if (status === 'REJECTED' || status === 'FAILED') color = 'error';
  if (status === 'PROCESSING') color = 'info';
  const labels: Record<Operation['status'], string> = {
    DRAFT: '草稿',
    SUBMITTED: '待复核',
    APPROVED: '已批准',
    REJECTED: '已拒绝',
    PROCESSING: '执行中',
    COMPLETED: '已完成',
    FAILED: '失败',
    CANCELLED: '已取消',
  };
  return <Label color={color}>{labels[status]}</Label>;
}
function accountDescription(account: MoneyAccount) {
  if (account.kind === 'VIRTUAL_ACCOUNT') return `${account.bankName || '-'} · 独立余额`;
  if (account.kind === 'CRYPTO_WALLET') return `${account.network || 'TRON'} · 操作已禁用`;
  return '系统法币钱包';
}
function operationTypeText(type: OperationType) {
  return (
    {
      DEPOSIT: '法币入账',
      PAYOUT: '出款',
      ADJUSTMENT: '调账',
      INTERNAL_TRANSFER: '内部转账',
      FX: '法币换汇',
      OTC: 'OTC',
    } as Record<OperationType, string>
  )[type];
}
function formatMoney(value: string, currency: Currency) {
  return `${new Intl.NumberFormat('zh-CN', {
    minimumFractionDigits: currency === 'USDT' ? 2 : 2,
    maximumFractionDigits: currency === 'USDT' ? 6 : 2,
  }).format(Number(value))} ${currency}`;
}
