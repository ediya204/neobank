import { useCallback, useEffect, useMemo, useState } from 'react';
import { Helmet } from 'react-helmet-async';
import {
  Alert,
  Box,
  Button,
  Card,
  Container,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Drawer,
  IconButton,
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
import { IS_NEOBANK_DEPLOYMENT } from 'src/config/deployment-mode';
import {
  coreApi,
  CryptoTransfer,
  Customer,
  demoOrganizationId,
  neobankApi,
} from 'src/features/finance/core-api';
import { paths } from 'src/routes/paths';

type CregisHistoryRow = {
  id: string;
  customer_id: string;
  amount: string;
  fee_amount?: string;
  net_amount?: string;
  fee_rule_version?: string;
  status: string;
  address: string;
  txid?: string;
  maker_id?: string;
  checker_id?: string;
  operator_id?: string;
  approved_at?: string;
  submitted_at?: string;
  completed_at?: string;
  created_at: string;
};

type AdminCryptoTransfer = CryptoTransfer & { rawStatus?: string; customerName?: string };

type AdminCustomer = {
  id: string;
  email: string;
  display_name: string;
  status: string;
  kyc_status: string;
  operations_status: string;
  kyc_reviewed_by?: string;
  kyc_reviewed_at?: string;
  kyc_review_note?: string;
  activated_by?: string;
  activated_at?: string;
  created_at: string;
  application_reference?: string;
  account_type?: 'individual' | 'business';
  phone_country_code?: string;
  phone?: string;
  residence_country?: string;
  full_name?: string;
  date_of_birth?: string;
  nationality?: string;
  legal_name?: string;
  registration_number?: string;
  incorporation_country?: string;
  contact_name?: string;
  contact_role?: string;
  beneficial_owner_name?: string;
  beneficial_owner_ownership?: string;
  kyc_consent_at?: string;
  terms_accepted_at?: string;
  application_submitted_at?: string;
  wallet_count?: number;
  wallet_status?: string | null;
};

function normalizedCregisStatus(status: string): CryptoTransfer['status'] {
  if (status === 'submitted') return 'SUBMITTED';
  if (status === 'completed') return 'COMPLETED';
  if (status === 'rejected') return 'REJECTED';
  if (['failed', 'exception', 'cancelled'].includes(status)) return 'FAILED';
  return 'PROCESSING';
}

function automaticWalletStatusLabel(customer: AdminCustomer) {
  if (customer.wallet_status === 'active') return '已自动激活，钱包已启用';
  if (customer.wallet_status === 'error') return '已自动激活，钱包待重试';
  return '已自动激活，钱包生成中';
}

function operationErrorMessage(value: unknown) {
  const message = value instanceof Error ? value.message : '';
  if (message === 'invalid_payout_address')
    return 'Cregis 拒绝了出款地址，请核对地址与 TRON 网络后重新创建指令';
  if (message === 'withdrawal_not_executable')
    return '该指令已离开“已审批”状态，请刷新后按当前状态处理';
  if (message === 'cregis_payout_failed') return 'Cregis 未接受该出款请求，指令已进入异常调单状态';
  return message || '操作失败';
}

function executeActionLabel(performing: boolean) {
  if (performing) return '提交中…';
  if (IS_NEOBANK_DEPLOYMENT) return '提交至 Cregis';
  return '模拟通道执行并回填 TXID';
}

function mapCregisWithdrawal(row: CregisHistoryRow): AdminCryptoTransfer {
  const status = normalizedCregisStatus(row.status);
  const wallet: CryptoTransfer['wallet'] = {
    id: 'cregis-wallet',
    customerId: row.customer_id,
    asset: 'USDT',
    network: 'TRON',
    networkLabel: 'Tron',
    tokenStandard: 'TRC20',
    walletAddress: '',
    status: 'ACTIVE',
    availableBalance: '0',
    frozenBalance: '0',
    minimumDeposit: '0',
    withdrawalFee: row.fee_amount || '0',
    withdrawalFeeRuleVersion: row.fee_rule_version,
    confirmationsRequired: 20,
  };
  return {
    id: row.id,
    reference: row.id,
    customerId: row.customer_id,
    walletId: wallet.id,
    asset: 'USDT',
    network: 'TRON',
    direction: 'WITHDRAWAL',
    status,
    rawStatus: row.status,
    amount: row.amount,
    feeAmount: row.fee_amount || '0',
    netAmount: row.net_amount || row.amount,
    fromAddress: '',
    toAddress: row.address,
    txHash: row.txid,
    confirmations: status === 'COMPLETED' ? 20 : 0,
    createdAt: row.created_at,
    wallet,
    maker: row.maker_id ? { id: row.maker_id, displayName: row.maker_id } : undefined,
    checker: row.checker_id ? { id: row.checker_id, displayName: row.checker_id } : undefined,
    operator: row.operator_id ? { id: row.operator_id, displayName: row.operator_id } : undefined,
    approvedAt: row.approved_at,
    submittedAt: row.submitted_at || row.created_at,
    completedAt: row.completed_at,
  };
}

export default function CryptoOperationsAdmin() {
  const userId = 'usr_admin';
  const [rows, setRows] = useState<AdminCryptoTransfer[]>([]);
  const [selected, setSelected] = useState<AdminCryptoTransfer | null>(null);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [rejectOpen, setRejectOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [reconcileOpen, setReconcileOpen] = useState(false);
  const [reconcileNote, setReconcileNote] = useState('');
  const [provisionOpen, setProvisionOpen] = useState(false);
  const [customerName, setCustomerName] = useState('');
  const [customerEmail, setCustomerEmail] = useState('');
  const [provisioning, setProvisioning] = useState(false);
  const [customers, setCustomers] = useState<AdminCustomer[]>([]);
  const [performingAction, setPerformingAction] = useState<
    'approve' | 'reject' | 'execute' | 'reconcile' | null
  >(null);

  const load = useCallback(async () => {
    setError('');
    try {
      if (!IS_NEOBANK_DEPLOYMENT) {
        const localCustomers = await coreApi<Customer[]>(
          `/customers?organizationId=${demoOrganizationId}`,
          { userId }
        );
        const batches = await Promise.all(
          localCustomers.map((customer) =>
            coreApi<CryptoTransfer[]>(`/crypto-wallets/transfers?customerId=${customer.id}`, {
              userId,
            })
          )
        );
        const customerNames = new Map(
          localCustomers.map((customer) => [customer.id, customer.displayName])
        );
        setRows(
          batches
            .flat()
            .map((row) => ({
              ...row,
              customerName: customerNames.get(row.customerId),
            }))
            .sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt))
        );
        setCustomers([]);
        return;
      }

      const [history, customerPayload] = await Promise.all([
        neobankApi<{ withdrawals: CregisHistoryRow[] }>('/crypto/history', { userId }),
        neobankApi<{ data: AdminCustomer[] }>('/admin/customers', { userId }),
      ]);
      const customerNames = new Map(
        customerPayload.data.map((customer) => [customer.id, customer.display_name])
      );
      setRows(
        history.withdrawals
          .map((row) => ({
            ...mapCregisWithdrawal(row),
            customerName: customerNames.get(row.customer_id),
          }))
          .sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt))
      );
      setCustomers(customerPayload.data);
    } catch (value) {
      setError(value instanceof Error ? value.message : '链上指令加载失败');
    }
  }, [userId]);

  useEffect(() => {
    load().catch(() => undefined);
  }, [load]);

  const metrics = useMemo(
    () => ({
      submitted: rows.filter((row) => row.status === 'SUBMITTED').length,
      processing: rows.filter((row) => row.status === 'PROCESSING').length,
      completed: rows.filter((row) => row.status === 'COMPLETED').length,
    }),
    [rows]
  );

  const perform = async (action: 'approve' | 'reject' | 'execute') => {
    if (!selected || performingAction) return;
    setPerformingAction(action);
    setError('');
    setSuccess('');
    try {
      let body: string | undefined;
      if (action === 'reject') body = JSON.stringify({ reason });

      if (!IS_NEOBANK_DEPLOYMENT) {
        if (action === 'execute') {
          const txHash = `0x${Array.from(crypto.getRandomValues(new Uint8Array(32)))
            .map((byte) => byte.toString(16).padStart(2, '0'))
            .join('')}`;
          body = JSON.stringify({ txHash });
        }
        const updated = await coreApi<CryptoTransfer>(
          `/crypto-wallets/transfers/${selected.id}/${action}`,
          { method: 'PATCH', body, userId }
        );
        setSelected(updated);
        setRejectOpen(false);
        setReason('');
        let localMessage = '本地链上执行已完成并生成交易哈希';
        if (action === 'approve') localMessage = '复核通过，指令已进入本地执行队列';
        if (action === 'reject') localMessage = '指令已拒绝，冻结余额已释放';
        setSuccess(localMessage);
        await load();
        return;
      }

      await neobankApi(`/crypto/withdrawals/${selected.id}/${action}`, {
        method: 'POST',
        body,
        userId,
      });
      setRejectOpen(false);
      setReason('');
      let message = '请求已发送至 Cregis，等待签名通知确认最终结果';
      if (action === 'approve') message = '审批通过；尚未请求 Cregis，请继续执行提交';
      if (action === 'reject') message = '指令已拒绝，冻结余额已释放';
      setSuccess(message);
      await load();
      setSelected(null);
    } catch (value) {
      const message = operationErrorMessage(value);
      if (action === 'execute') {
        setSelected(null);
        await load().catch(() => undefined);
      }
      setError(message);
    } finally {
      setPerformingAction(null);
    }
  };

  const reconcileFailedWithdrawal = async () => {
    if (!selected || selected.rawStatus !== 'exception' || performingAction) return;
    const note = reconcileNote.trim();
    if (!note) return;
    setPerformingAction('reconcile');
    setError('');
    setSuccess('');
    try {
      await neobankApi(`/crypto/withdrawals/${selected.id}/reconcile`, {
        method: 'POST',
        body: JSON.stringify({ resolution: 'failed', note }),
        userId,
      });
      setReconcileOpen(false);
      setReconcileNote('');
      setSelected(null);
      await load();
      setSuccess('异常指令已调单为失败，冻结余额已释放。');
    } catch (value) {
      setError(operationErrorMessage(value));
    } finally {
      setPerformingAction(null);
    }
  };

  const createTestCustomer = async () => {
    setProvisioning(true);
    setError('');
    try {
      await neobankApi<AdminCustomer>('/admin/customers', {
        method: 'POST',
        body: JSON.stringify({ email: customerEmail, display_name: customerName }),
        userId,
      });
      setCustomerName('');
      setCustomerEmail('');
      setSuccess('客户档案已创建；KYC 通过后将自动激活并创建 USDT-TRC20 钱包。');
      await load();
    } catch (value) {
      setError(value instanceof Error ? value.message : '测试客户创建失败');
    } finally {
      setProvisioning(false);
    }
  };

  return (
    <>
      <Helmet>
        <title>USDT 出款 | SSC Digital Bank</title>
      </Helmet>
      <Container maxWidth="xl">
        <Stack spacing={3}>
          <Stack direction={{ xs: 'column', md: 'row' }} justifyContent="space-between" gap={2}>
            <Box>
              <Typography variant="h4">USDT 出款</Typography>
              <Typography color="text.secondary" sx={{ mt: 0.75 }}>
                {IS_NEOBANK_DEPLOYMENT
                  ? '单人审批 USDT 付币指令，并在人工执行后登记链上交易哈希。'
                  : '复核本地 USDT 付币指令，并在模拟通道执行后登记交易哈希。'}
              </Typography>
            </Box>
            {IS_NEOBANK_DEPLOYMENT && (
              <Button
                variant="contained"
                startIcon={<Iconify icon="solar:user-plus-bold-duotone" />}
                onClick={() => setProvisionOpen(true)}
              >
                创建测试客户
              </Button>
            )}
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
            {IS_NEOBANK_DEPLOYMENT
              ? '当前为单人审批模式：审批只改变内部状态；只有再次点击“提交至 Cregis”才会发起 API 请求，最终结果与 TXID 以 Cregis 签名通知为准。'
              : '本地完整模式保留提交人与复核人分离；执行步骤仅生成测试交易哈希，不会发起真实链上转账。'}
          </Alert>
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
            <Metric label="待审批" value={metrics.submitted} color="warning.main" />
            <Metric label="链上处理中" value={metrics.processing} color="info.main" />
            <Metric label="已完成" value={metrics.completed} color="success.main" />
          </Stack>
          <Card>
            <TableContainer>
              <Table>
                <TableHead>
                  <TableRow>
                    <TableCell>指令</TableCell>
                    <TableCell>客户</TableCell>
                    <TableCell>网络</TableCell>
                    <TableCell>金额</TableCell>
                    <TableCell>手续费</TableCell>
                    <TableCell>状态</TableCell>
                    <TableCell>提交人</TableCell>
                    <TableCell>时间</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {rows.map((row) => (
                    <TableRow
                      key={row.id}
                      hover
                      onClick={() => setSelected(row)}
                      sx={{ cursor: 'pointer' }}
                    >
                      <TableCell>{row.reference}</TableCell>
                      <TableCell title={row.customerId}>
                        {row.customerName || row.customerId}
                      </TableCell>
                      <TableCell>
                        {row.network} · {row.wallet.tokenStandard}
                      </TableCell>
                      <TableCell>{row.amount} USDT</TableCell>
                      <TableCell>{row.feeAmount} USDT</TableCell>
                      <TableCell>
                        <StatusLabel status={row.status} rawStatus={row.rawStatus} />
                      </TableCell>
                      <TableCell>{row.maker?.displayName || row.maker?.id}</TableCell>
                      <TableCell>{new Date(row.createdAt).toLocaleString('zh-CN')}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>
          </Card>
        </Stack>
      </Container>
      <Drawer
        anchor="right"
        open={Boolean(selected)}
        onClose={() => setSelected(null)}
        PaperProps={{ sx: { width: { xs: 1, sm: 500 }, p: 3 } }}
      >
        {selected && (
          <Stack spacing={3}>
            <Stack direction="row" justifyContent="space-between">
              <Box>
                <Typography variant="h5">付币指令</Typography>
                <Typography color="text.secondary">{selected.reference}</Typography>
              </Box>
              <IconButton onClick={() => setSelected(null)}>
                <Iconify icon="solar:close-circle-linear" />
              </IconButton>
            </Stack>
            <Card variant="outlined" sx={{ p: 2.5 }}>
              <Info label="网络" value={`${selected.network} · ${selected.wallet.tokenStandard}`} />
              <Info label="钱包总扣账" value={`${selected.amount} USDT`} />
              <Info label="转出手续费" value={`${selected.feeAmount} USDT`} />
              <Info label="链上实际发送" value={`${selected.netAmount} USDT`} />
              <Info label="预计到账" value={`${selected.netAmount} USDT`} />
              <Info label="目标地址" value={selected.toAddress} mono />
              <Info label="交易哈希" value={selected.txHash || '执行后生成'} mono />
            </Card>
            {selected.rawStatus === 'exception' && (
              <Stack spacing={1.5}>
                <Alert severity="warning">
                  该指令仍为异常调单状态，资金继续冻结。请先在 Cregis 核对没有对应订单或
                  CID；确认未提交后才能调单为失败并释放冻结，切勿重复提交。
                </Alert>
                <Button
                  color="warning"
                  variant="outlined"
                  disabled={Boolean(performingAction)}
                  onClick={() => setReconcileOpen(true)}
                >
                  确认 Cregis 无订单，释放冻结
                </Button>
              </Stack>
            )}
            {selected.status === 'SUBMITTED' && (
              <Stack direction="row" spacing={1}>
                <Button
                  fullWidth
                  color="error"
                  variant="outlined"
                  disabled={Boolean(performingAction)}
                  onClick={() => setRejectOpen(true)}
                >
                  拒绝
                </Button>
                <Button
                  fullWidth
                  variant="contained"
                  disabled={
                    Boolean(performingAction) ||
                    (!IS_NEOBANK_DEPLOYMENT && selected.maker?.id === userId)
                  }
                  onClick={() => perform('approve').catch(() => undefined)}
                >
                  {IS_NEOBANK_DEPLOYMENT ? '审批通过' : '复核通过'}
                </Button>
              </Stack>
            )}
            {(IS_NEOBANK_DEPLOYMENT
              ? selected.rawStatus === 'approved'
              : selected.status === 'PROCESSING') && (
              <Button
                variant="contained"
                disabled={Boolean(performingAction)}
                onClick={() => perform('execute').catch(() => undefined)}
              >
                {executeActionLabel(performingAction === 'execute')}
              </Button>
            )}
          </Stack>
        )}
      </Drawer>
      <Dialog open={rejectOpen} onClose={() => setRejectOpen(false)} fullWidth maxWidth="sm">
        <DialogTitle>拒绝付币指令</DialogTitle>
        <DialogContent>
          <TextField
            fullWidth
            multiline
            minRows={3}
            label="拒绝原因"
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            sx={{ mt: 1 }}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setRejectOpen(false)}>取消</Button>
          <Button
            variant="contained"
            color="error"
            disabled={!reason.trim() || Boolean(performingAction)}
            onClick={() => perform('reject').catch(() => undefined)}
          >
            确认拒绝
          </Button>
        </DialogActions>
      </Dialog>
      <Dialog
        open={reconcileOpen}
        onClose={() => {
          if (!performingAction) setReconcileOpen(false);
        }}
        fullWidth
        maxWidth="sm"
      >
        <DialogTitle>异常出款调单</DialogTitle>
        <DialogContent>
          <Alert severity="warning" sx={{ mb: 2 }}>
            仅在 Cregis 客户端确认没有对应订单、CID 或待审批记录时使用。确认后该指令将变为失败，
            {selected?.amount || '0'} USDT 冻结会按账本规则释放；该操作保留管理员与备注审计记录。
          </Alert>
          <TextField
            autoFocus
            fullWidth
            multiline
            minRows={3}
            label="Cregis 核对结果与调单备注"
            placeholder="例如：已在 Cregis 核对，无对应订单或 CID，确认释放冻结。"
            value={reconcileNote}
            onChange={(event) => setReconcileNote(event.target.value)}
            inputProps={{ maxLength: 1000 }}
          />
        </DialogContent>
        <DialogActions>
          <Button disabled={Boolean(performingAction)} onClick={() => setReconcileOpen(false)}>
            取消
          </Button>
          <Button
            variant="contained"
            color="warning"
            disabled={!reconcileNote.trim() || Boolean(performingAction)}
            onClick={() => reconcileFailedWithdrawal().catch(() => undefined)}
          >
            {performingAction === 'reconcile' ? '处理中…' : '确认失败并释放冻结'}
          </Button>
        </DialogActions>
      </Dialog>
      <Dialog
        open={IS_NEOBANK_DEPLOYMENT && provisionOpen}
        onClose={() => setProvisionOpen(false)}
        fullWidth
        maxWidth="lg"
      >
        <DialogTitle>客户 KYC 与自动钱包开通</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ mt: 1 }}>
            <Alert severity="warning">
              固定顺序：创建客户 → 人工 KYC 审核 → 自动激活并创建经 Cregis 归属验证的 USDT-TRC20
              钱包。钱包开通不会自动发起真实转账。
            </Alert>
            <Stack direction={{ xs: 'column', md: 'row' }} spacing={1.5}>
              <TextField
                fullWidth
                label="客户名称"
                value={customerName}
                onChange={(event) => setCustomerName(event.target.value)}
              />
              <TextField
                fullWidth
                label="客户登录邮箱"
                type="email"
                value={customerEmail}
                onChange={(event) => setCustomerEmail(event.target.value)}
              />
              <Button
                variant="contained"
                disabled={!customerName.trim() || !customerEmail.trim() || provisioning}
                onClick={() => createTestCustomer().catch(() => undefined)}
                sx={{ minWidth: 150 }}
              >
                {provisioning ? '创建中…' : '创建客户档案'}
              </Button>
            </Stack>
            <Alert severity="info">
              KYC 审核统一在独立审核工作台完成；本页仅保留测试客户创建和数字钱包运营。
            </Alert>
            <TableContainer component={Card} variant="outlined">
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell>客户</TableCell>
                    <TableCell>账户</TableCell>
                    <TableCell>KYC</TableCell>
                    <TableCell>运营</TableCell>
                    <TableCell align="right">下一步</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {customers.map((customer) => (
                    <TableRow key={customer.id}>
                      <TableCell>
                        <Typography variant="subtitle2">{customer.display_name}</Typography>
                        <Typography variant="caption" color="text.secondary">
                          {customer.email}
                        </Typography>
                      </TableCell>
                      <TableCell>{customer.status}</TableCell>
                      <TableCell>{customer.kyc_status}</TableCell>
                      <TableCell>{customer.operations_status}</TableCell>
                      <TableCell align="right">
                        <Stack
                          direction="row"
                          spacing={1}
                          justifyContent="flex-end"
                          flexWrap="wrap"
                          useFlexGap
                        >
                          {customer.kyc_status === 'pending' && (
                            <Button
                              size="small"
                              variant="outlined"
                              onClick={() =>
                                window.location.assign(
                                  paths.dashboard.onboardingReview(customer.id)
                                )
                              }
                            >
                              进入 KYC 审核
                            </Button>
                          )}
                          {customer.kyc_status === 'approved' &&
                            customer.operations_status === 'active' && (
                              <Typography variant="caption" color="success.main">
                                {automaticWalletStatusLabel(customer)}
                              </Typography>
                            )}
                          {customer.operations_status === 'active' &&
                            customer.status === 'pending_setup' && (
                              <Typography variant="caption" color="text.secondary">
                                等待客户完成密码与 TOTP
                              </Typography>
                            )}
                        </Stack>
                      </TableCell>
                    </TableRow>
                  ))}
                  {!customers.length && (
                    <TableRow>
                      <TableCell colSpan={5} align="center">
                        暂无客户
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </TableContainer>
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button
            onClick={() => {
              setProvisionOpen(false);
              setCustomerName('');
              setCustomerEmail('');
            }}
          >
            关闭
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
}

function Metric({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <Card sx={{ flex: 1, p: 2.5 }}>
      <Typography color="text.secondary">{label}</Typography>
      <Typography variant="h3" sx={{ mt: 1, color }}>
        {value}
      </Typography>
    </Card>
  );
}
function Info({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <Stack direction="row" justifyContent="space-between" spacing={2} sx={{ py: 1 }}>
      <Typography color="text.secondary">{label}</Typography>
      <Typography
        variant="subtitle2"
        sx={{
          textAlign: 'right',
          fontFamily: mono ? 'monospace' : undefined,
          wordBreak: 'break-all',
        }}
      >
        {value}
      </Typography>
    </Stack>
  );
}
function StatusLabel({
  status,
  rawStatus,
}: {
  status: CryptoTransfer['status'];
  rawStatus?: string;
}) {
  if (rawStatus === 'exception') return <Label color="warning">异常调单</Label>;
  if (rawStatus === 'cancelled') return <Label color="default">已取消</Label>;
  const names = {
    SUBMITTED: '待审批',
    PROCESSING: '处理中',
    COMPLETED: '已完成',
    REJECTED: '已拒绝',
    FAILED: '失败',
  };
  let color: 'default' | 'warning' | 'info' | 'success' | 'error' = 'default';
  if (status === 'SUBMITTED') color = 'warning';
  if (status === 'PROCESSING') color = 'info';
  if (status === 'COMPLETED') color = 'success';
  if (status === 'REJECTED' || status === 'FAILED') color = 'error';
  return <Label color={color}>{names[status]}</Label>;
}
