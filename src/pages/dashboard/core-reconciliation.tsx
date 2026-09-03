import { type ReactNode, useCallback, useEffect, useMemo, useState } from 'react';
import { Helmet } from 'react-helmet-async';
import {
  Alert,
  Box,
  Button,
  Card,
  CircularProgress,
  Container,
  MenuItem,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TablePagination,
  TableRow,
  TextField,
  Typography,
} from '@mui/material';
import AssetIcon from 'src/components/asset-icon';
import Iconify from 'src/components/iconify';
import Label from 'src/components/label';
import UiIconBadge, { UiIconBadgeTone } from 'src/components/ui-icon-badge';
import {
  coreApi,
  Customer,
  demoOrganizationId,
  JournalEntry,
  Operation,
  VirtualAccountRequest,
} from 'src/features/finance/core-api';
import {
  buildCoreReconciliationSnapshot,
  type VaOpeningFeeIssue,
} from 'src/features/finance/core-reconciliation';
import { ACTION_ICONS } from 'src/theme/iconography';

const OPERATION_LABELS: Record<Operation['type'], string> = {
  DEPOSIT: '法币入账',
  PAYOUT: '法币转出',
  ADJUSTMENT: '调账',
  INTERNAL_TRANSFER: '内部划转',
  FX: '法币换汇',
  OTC: 'OTC 兑换',
  VA_OPENING_FEE: 'VA 开户手续费',
};

const STATUS_LABELS: Record<Operation['status'], string> = {
  DRAFT: '草稿',
  SUBMITTED: '待审批',
  APPROVED: '待执行',
  REJECTED: '已拒绝',
  PROCESSING: '执行中',
  COMPLETED: '已完成',
  FAILED: '失败',
  CANCELLED: '已取消',
};

const STATUS_COLORS: Record<
  Operation['status'],
  'default' | 'info' | 'warning' | 'success' | 'error'
> = {
  DRAFT: 'default',
  SUBMITTED: 'warning',
  APPROVED: 'info',
  REJECTED: 'error',
  PROCESSING: 'info',
  COMPLETED: 'success',
  FAILED: 'error',
  CANCELLED: 'default',
};

function hongKongToday() {
  const values = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Hong_Kong',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    })
      .formatToParts(new Date())
      .map((part) => [part.type, part.value])
  );
  return `${values.year}-${values.month}-${values.day}`;
}

function formatAmount(value: number) {
  return value.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 6 });
}

function formatAmounts(values: Partial<Record<string, number>>) {
  const rows = Object.entries(values).filter(([, value]) => value);
  return rows.length
    ? rows.map(([currency, value]) => `${formatAmount(value || 0)} ${currency}`).join(' · ')
    : '0.00';
}

function operationTime(operation: Operation) {
  return operation.executedAt || operation.submittedAt || operation.createdAt;
}

type UsdtReconciliation = {
  checkedAt: string;
  issueCount: number;
  truncated: boolean;
  checksComplete?: boolean;
  unavailableChecks?: string[];
  issues: Array<{
    id: string;
    direction: 'deposit' | 'withdrawal' | 'core';
    custody_status: string;
    accounting_status: string;
    core_operation_id: string | null;
    reason: string;
    resolution_code?: ResolutionCode;
    resolution_priority?: ResolutionPriority;
    financial_effect?: FinancialEffect;
    manual_reconciliation_eligible?: boolean;
  }>;
};

type ResolutionCode =
  | 'deposit_manual_reconciliation'
  | 'withdrawal_release_reconciliation'
  | 'await_custody_finality'
  | 'withdrawal_terminal_evidence_review'
  | 'withdrawal_settlement_review'
  | 'withdrawal_pre_execution_block'
  | 'callback_conflict_review'
  | 'manual_reconciliation_in_progress'
  | 'accounting_exception_review'
  | 'worker_queue_review'
  | 'core_integrity_review'
  | 'state_mismatch_review';

type ResolutionPriority = 'critical' | 'high' | 'monitor';
type FinancialEffect =
  | 'credit_after_approval'
  | 'release_after_approval'
  | 'none_until_verified'
  | 'separately_approved_correction';

const ISSUE_DIRECTION_LABELS: Record<UsdtReconciliation['issues'][number]['direction'], string> = {
  deposit: 'Cregis 入账',
  withdrawal: 'Cregis 出款',
  core: 'Core 账务',
};

const ISSUE_REASON_LABELS: Record<string, string> = {
  accounting_intent_missing: '缺少托管到 Core 的记账意图',
  accounting_exception: '记账处理进入异常状态',
  completed_custody_not_posted: '托管已完成，但 Core 尚未入账',
  completed_custody_not_settled: '托管已完成，但 Core 尚未结算',
  terminal_custody_not_released: '托管已终止，但 Core 尚未释放冻结资金',
  custody_accounting_state_mismatch: '托管状态与 Core 记账状态不匹配',
  core_operation_without_custody_handoff: 'Core 业务缺少对应的托管交接记录',
  core_crypto_account_missing: '数字钱包缺少对应的 Core 资金账户',
  core_crypto_account_duplicated: '数字钱包存在重复的 Core 资金账户',
  core_crypto_materialized_balance_mismatch: '数字钱包与 Core 资金账户余额不一致',
};

const RESOLUTION_LABELS: Record<ResolutionCode, string> = {
  deposit_manual_reconciliation:
    '先执行单笔只读预览。完成 PostgreSQL 全量备份、校验和、隔离恢复及审批后，分两次执行 hold / release，由财务 Worker 入账。',
  withdrawal_release_reconciliation:
    '最终拒绝/失败证据已存在。先预览核验 Core 匹配，再完成备份、恢复及审批，分两次执行 hold / release。',
  await_custody_finality:
    '保持阻断，不释放、不补扣、不重提。等待签名最终回调，并核对 Cregis 与链上结果。',
  withdrawal_terminal_evidence_review:
    '业务状态看似终止，但最终回调证据缺失或不明确；先补齐托管证据，当前禁止释放资金。',
  withdrawal_settlement_review:
    '托管可能已完成，禁止走释放流程。核对交易哈希、链上结果及既有 Core 记录后，另行审批补偿账务。',
  withdrawal_pre_execution_block:
    '尚未形成安全的 Core 预留交接；阻止继续执行或提交 Cregis，先核对客户请求与 Core 状态。',
  callback_conflict_review:
    '检测到互相冲突的最终回调证据；冻结自动处置，升级人工核证 Cregis 原始记录和链上结果。',
  manual_reconciliation_in_progress:
    '项目已处于 hold；复核客户、钱包、金额、地址、交易证据及 Core 唯一性后，才能单独批准 release。',
  accounting_exception_review:
    '读取 last_error_code 并核验失败的不变量；修复原因后再走受控重试，禁止直接改状态或余额。',
  worker_queue_review:
    '检查财务 Worker、队列锁、重试次数与 last_error_code；确认不是正常处理中后再升级。',
  core_integrity_review:
    '停止相关资金操作，核对复式凭证、Operation、账户与钱包镜像；如需更正，只能另行批准补偿记账。',
  state_mismatch_review:
    '阻止后续状态推进，逐项核对托管、记账意图、Core 业务与回调证据后再决定恢复路径。',
};

const PRIORITY_LABELS: Record<ResolutionPriority, string> = {
  critical: '紧急',
  high: '高',
  monitor: '观察',
};

const PRIORITY_COLORS: Record<ResolutionPriority, 'error' | 'warning' | 'info'> = {
  critical: 'error',
  high: 'warning',
  monitor: 'info',
};

const FINANCIAL_EFFECT_LABELS: Record<FinancialEffect, string> = {
  credit_after_approval: '审批后才可入账',
  release_after_approval: '审批后才可释放/关闭',
  none_until_verified: '核实前不动账',
  separately_approved_correction: '仅限单独批准的补偿记账',
};

export default function CoreReconciliationPage() {
  const [date, setDate] = useState(hongKongToday);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [operations, setOperations] = useState<Operation[]>([]);
  const [journals, setJournals] = useState<JournalEntry[]>([]);
  const [virtualAccountRequests, setVirtualAccountRequests] = useState<VirtualAccountRequest[]>([]);
  const [usdtReconciliation, setUsdtReconciliation] = useState<UsdtReconciliation | null>(null);
  const [status, setStatus] = useState<'all' | Operation['status']>('all');
  const [page, setPage] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [snapshotAt, setSnapshotAt] = useState<Date | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [customerRows, operationRows, journalRows, vaRequestRows, usdtRows] = await Promise.all(
        [
          coreApi<Customer[]>(`/customers?organizationId=${demoOrganizationId}`, {
            userId: 'usr_admin',
          }),
          coreApi<Operation[]>(`/operations?organizationId=${demoOrganizationId}`, {
            userId: 'usr_admin',
          }),
          coreApi<JournalEntry[]>(`/ledger?organizationId=${demoOrganizationId}`, {
            userId: 'usr_admin',
          }),
          coreApi<VirtualAccountRequest[]>(
            `/virtual-account-requests?organizationId=${demoOrganizationId}`,
            { userId: 'usr_admin' }
          ),
          coreApi<UsdtReconciliation>(
            `/ledger/reconciliation/usdt?organizationId=${demoOrganizationId}`,
            { userId: 'usr_admin' }
          ),
        ]
      );
      setCustomers(customerRows);
      setOperations(operationRows);
      setJournals(journalRows);
      setVirtualAccountRequests(vaRequestRows);
      setUsdtReconciliation(usdtRows);
      setSnapshotAt(new Date());
    } catch (value) {
      setError(value instanceof Error ? value.message : '无法读取对账数据');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const snapshot = useMemo(
    () =>
      buildCoreReconciliationSnapshot({
        date,
        customers,
        operations,
        journals,
        virtualAccountRequests,
      }),
    [customers, date, journals, operations, virtualAccountRequests]
  );
  const filteredMovements = snapshot.movements.filter(
    (operation) => status === 'all' || operation.status === status
  );
  const visibleMovements = filteredMovements.slice(page * 25, page * 25 + 25);
  const ledgerChecksPass = snapshot.unbalancedJournalCount === 0;
  const custodyChecksComplete = usdtReconciliation?.checksComplete !== false;
  const checksPass =
    ledgerChecksPass &&
    snapshot.completedWithoutJournal.length === 0 &&
    snapshot.vaOpeningFeeIssues.length === 0 &&
    custodyChecksComplete &&
    usdtReconciliation?.issueCount === 0;
  const consistencyIssueCount =
    snapshot.unbalancedJournalCount +
    snapshot.completedWithoutJournal.length +
    snapshot.vaOpeningFeeIssues.length +
    (usdtReconciliation?.issueCount || 0);
  const consistencyIssues = useMemo(
    () => [
      ...snapshot.unbalancedJournals.map((journal) => ({
        key: `journal-${journal.id}`,
        category: '账本凭证',
        item: `${journal.reference} · ${journal.id}`,
        businessStatus: new Date(journal.postedAt).toLocaleString('zh-CN'),
        accountingStatus: '借贷不平衡',
        reason: journal.deltas
          .map(
            (row) =>
              `${row.currency}：借 ${formatAmount(row.debits)}，贷 ${formatAmount(
                row.credits
              )}，差额 ${formatAmount(row.delta)}`
          )
          .join('；'),
        coreOperationId: '—',
        resolutionCode: 'core_integrity_review' as ResolutionCode,
        resolutionPriority: 'critical' as ResolutionPriority,
        financialEffect: 'separately_approved_correction' as FinancialEffect,
      })),
      ...snapshot.completedWithoutJournal.map((operation) => ({
        key: `operation-${operation.id}`,
        category: 'Core 业务',
        item: `${operation.reference} · ${operation.id}`,
        businessStatus: STATUS_LABELS[operation.status],
        accountingStatus: '缺少账本凭证',
        reason: '业务已完成，但未找到对应的复式账本凭证',
        coreOperationId: operation.id,
        resolutionCode: 'core_integrity_review' as ResolutionCode,
        resolutionPriority: 'critical' as ResolutionPriority,
        financialEffect: 'separately_approved_correction' as FinancialEffect,
      })),
      ...snapshot.vaOpeningFeeIssues.map((issue) => ({
        key: `va-fee-${issue.requestId}-${issue.reason}`,
        category: 'VA 开户手续费',
        item: issue.reference || issue.requestId,
        businessStatus: issue.requestId === 'all' ? '汇总核对' : issue.requestId,
        accountingStatus: '手续费链路异常',
        reason: vaFeeIssueReason(issue.reason),
        coreOperationId: issue.operationId || '—',
        resolutionCode: 'core_integrity_review' as ResolutionCode,
        resolutionPriority: 'critical' as ResolutionPriority,
        financialEffect: 'separately_approved_correction' as FinancialEffect,
      })),
      ...(usdtReconciliation?.issues || []).map((issue) => {
        const resolutionCode = issue.resolution_code || 'state_mismatch_review';
        return {
          key: `usdt-${issue.direction}-${issue.id}-${issue.reason}`,
          category: ISSUE_DIRECTION_LABELS[issue.direction],
          item: issue.id,
          businessStatus: issue.custody_status,
          accountingStatus: issue.accounting_status,
          reason: ISSUE_REASON_LABELS[issue.reason] || issue.reason,
          coreOperationId: issue.core_operation_id || '—',
          resolutionCode,
          resolutionPriority: issue.resolution_priority || ('high' as ResolutionPriority),
          financialEffect: issue.financial_effect || ('none_until_verified' as FinancialEffect),
        };
      }),
    ],
    [
      snapshot.completedWithoutJournal,
      snapshot.unbalancedJournals,
      snapshot.vaOpeningFeeIssues,
      usdtReconciliation,
    ]
  );

  let reconciliationAlertSeverity: 'success' | 'error' | 'warning' = 'success';
  let reconciliationAlertMessage = `账本及 Cregis 托管一致性检查通过：${snapshot.journalCount} 张凭证借贷平衡，已完成业务均有账本凭证。`;
  let consistencyStatusColor: 'success' | 'error' | 'warning' = 'success';
  let consistencyStatusLabel = '未发现异常';
  if (!custodyChecksComplete) {
    reconciliationAlertSeverity = 'warning';
    reconciliationAlertMessage =
      'Cregis 托管对账表尚不可用，本次检查不完整；当前结果不能视为一致性通过。';
    consistencyStatusColor = 'warning';
    consistencyStatusLabel = '检查不完整';
  } else if (!checksPass) {
    reconciliationAlertSeverity = 'error';
    reconciliationAlertMessage = `发现 ${snapshot.unbalancedJournalCount} 张借贷不平衡凭证、${
      snapshot.completedWithoutJournal.length
    } 笔已完成但缺少凭证的业务、${snapshot.vaOpeningFeeIssues.length} 项 VA 开户费异常、${
      usdtReconciliation?.issueCount || 0
    } 笔 Cregis 与 Core 状态不一致，请立即核对。`;
    consistencyStatusColor = 'error';
    consistencyStatusLabel = `${consistencyIssueCount} 项待核对`;
  }

  useEffect(() => setPage(0), [date, status]);

  return (
    <>
      <Helmet>
        <title>资金对账 | SSC Digital Bank</title>
      </Helmet>
      <Container maxWidth="xl">
        <Stack spacing={3}>
          <Stack
            direction={{ xs: 'column', sm: 'row' }}
            justifyContent="space-between"
            alignItems={{ sm: 'flex-end' }}
            spacing={2}
          >
            <Box>
              <Typography variant="h4">资金对账</Typography>
              <Typography color="text.secondary" sx={{ mt: 0.75 }}>
                基于 Render Core 与 PostgreSQL 的账户余额、业务记录和复式账本进行同源核对。
              </Typography>
            </Box>
            <Stack direction="row" spacing={1.5} alignItems="center">
              {snapshotAt && (
                <Typography variant="caption" color="text.secondary">
                  快照 {snapshotAt.toLocaleString('zh-CN')}
                </Typography>
              )}
              <TextField
                type="date"
                size="small"
                label="对账日期"
                value={date}
                onChange={(event) => setDate(event.target.value)}
                InputLabelProps={{ shrink: true }}
              />
              <Button
                variant="outlined"
                color="inherit"
                disabled={loading}
                startIcon={
                  loading ? <CircularProgress size={16} /> : <Iconify icon={ACTION_ICONS.refresh} />
                }
                onClick={load}
              >
                刷新
              </Button>
            </Stack>
          </Stack>

          {error && (
            <Alert severity="error" action={<Button onClick={load}>重试</Button>}>
              对账数据加载失败：{error}
            </Alert>
          )}
          {loading && !snapshotAt && !error && (
            <Alert severity="info" icon={<CircularProgress size={20} />}>
              正在读取账户、业务记录与账本凭证…
            </Alert>
          )}
          {!loading && !error && (
            <Alert severity={reconciliationAlertSeverity}>{reconciliationAlertMessage}</Alert>
          )}

          <Box
            sx={{
              display: 'grid',
              gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, 1fr)', xl: 'repeat(4, 1fr)' },
              gap: 2,
            }}
          >
            <MetricCard
              title="当日业务"
              value={`${snapshot.movements.length} 笔`}
              helper={`全局待处理 ${snapshot.pendingOperations.length} 笔`}
              icon="solar:document-text-bold-duotone"
              tone="info"
            />
            <MetricCard
              title="当日入账"
              value={formatAmounts(snapshot.inflows)}
              helper="仅统计已完成业务"
              icon="solar:download-minimalistic-bold-duotone"
              tone="success"
            />
            <MetricCard
              title="当日转出"
              value={formatAmounts(snapshot.outflows)}
              helper={`仅统计已完成业务 · VA 开户费 USD ${formatAmount(
                snapshot.completedVaOpeningFeeUsd
              )}`}
              icon="solar:upload-minimalistic-bold-duotone"
              tone="warning"
            />
            <MetricCard
              title="一致性异常"
              value={`${consistencyIssueCount}`}
              helper={
                custodyChecksComplete ? '账本、托管或 Core 状态不一致' : 'Cregis 托管检查不完整'
              }
              icon="solar:shield-warning-bold-duotone"
              tone={checksPass ? 'success' : 'error'}
              action={
                consistencyIssueCount > 0 ? (
                  <Button size="small" color="error" href="#consistency-issues" sx={{ mt: 1 }}>
                    查看异常项目
                  </Button>
                ) : undefined
              }
            />
          </Box>

          <Card id="consistency-issues" variant="outlined" sx={{ boxShadow: 'none' }}>
            <Stack
              direction={{ xs: 'column', sm: 'row' }}
              justifyContent="space-between"
              spacing={2}
              sx={{ p: 3 }}
            >
              <Box>
                <Typography variant="h6">一致性异常明细</Typography>
                <Typography variant="body2" color="text.secondary">
                  分别核对复式账本、已完成业务凭证，以及 Cregis 托管与 Core 账务状态。
                </Typography>
              </Box>
              <Label color={consistencyStatusColor}>{consistencyStatusLabel}</Label>
            </Stack>
            {usdtReconciliation?.truncated && (
              <Alert severity="warning" sx={{ mx: 3, mb: 2 }}>
                异常结果已达到接口上限，当前列表可能不完整，请先处理已显示项目后刷新。
              </Alert>
            )}
            {!!consistencyIssueCount && (
              <Alert severity="info" sx={{ mx: 3, mb: 2 }}>
                本页只做只读分诊，不直接改状态或余额。人工对账仍须逐笔完成 PostgreSQL
                全量备份、SHA-256 校验、隔离恢复验证、具名审批及 hold / release 双阶段操作。
              </Alert>
            )}
            {!custodyChecksComplete && (
              <Alert severity="warning" sx={{ mx: 3, mb: 2 }}>
                PostgreSQL 中缺少完整的 Cregis
                托管与记账表，本页无法核对托管侧异常。请先核实施工/部署状态；不要将空列表解释为无异常。
              </Alert>
            )}
            <TableContainer>
              <Table>
                <TableHead>
                  <TableRow>
                    <TableCell>类别</TableCell>
                    <TableCell>异常项目</TableCell>
                    <TableCell>托管/业务状态</TableCell>
                    <TableCell>记账状态</TableCell>
                    <TableCell>异常原因</TableCell>
                    <TableCell>Core 业务 ID</TableCell>
                    <TableCell>处置建议</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {consistencyIssues.map((issue) => (
                    <TableRow key={issue.key} hover>
                      <TableCell>
                        <Label color="error">{issue.category}</Label>
                      </TableCell>
                      <TableCell sx={{ fontFamily: 'monospace', wordBreak: 'break-all' }}>
                        {issue.item}
                      </TableCell>
                      <TableCell>{issue.businessStatus}</TableCell>
                      <TableCell>{issue.accountingStatus}</TableCell>
                      <TableCell sx={{ minWidth: 260 }}>{issue.reason}</TableCell>
                      <TableCell sx={{ fontFamily: 'monospace', wordBreak: 'break-all' }}>
                        {issue.coreOperationId}
                      </TableCell>
                      <TableCell sx={{ minWidth: 360 }}>
                        <Stack spacing={0.75} alignItems="flex-start">
                          <Stack direction="row" spacing={0.75} flexWrap="wrap" useFlexGap>
                            <Label color={PRIORITY_COLORS[issue.resolutionPriority]}>
                              {PRIORITY_LABELS[issue.resolutionPriority]}
                            </Label>
                            <Label color="default">
                              {FINANCIAL_EFFECT_LABELS[issue.financialEffect]}
                            </Label>
                          </Stack>
                          <Typography variant="body2">
                            {RESOLUTION_LABELS[issue.resolutionCode]}
                          </Typography>
                        </Stack>
                      </TableCell>
                    </TableRow>
                  ))}
                  {!consistencyIssues.length && (
                    <EmptyRow colSpan={7} text="当前未发现一致性异常" />
                  )}
                </TableBody>
              </Table>
            </TableContainer>
          </Card>

          <Box
            sx={{
              display: 'grid',
              gridTemplateColumns: { xs: '1fr', lg: 'minmax(0, 0.85fr) minmax(0, 1.15fr)' },
              gap: 3,
            }}
          >
            <Card variant="outlined" sx={{ boxShadow: 'none' }}>
              <Box sx={{ p: 3 }}>
                <Typography variant="h6">当前客户资金</Typography>
                <Typography variant="body2" color="text.secondary">
                  当前物化账户余额；按币种独立展示，不进行跨币种合并。
                </Typography>
              </Box>
              <TableContainer>
                <Table>
                  <TableHead>
                    <TableRow>
                      <TableCell>币种</TableCell>
                      <TableCell align="right">可用</TableCell>
                      <TableCell align="right">冻结</TableCell>
                      <TableCell align="right">账面资产</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {snapshot.balances.map((row) => (
                      <TableRow key={row.currency}>
                        <TableCell>
                          <Stack direction="row" spacing={1} alignItems="center">
                            <AssetIcon asset={row.currency} size={28} />
                            <Box>
                              <Typography variant="subtitle2">{row.currency}</Typography>
                              <Typography variant="caption" color="text.secondary">
                                {row.accountCount} 个账户
                              </Typography>
                            </Box>
                          </Stack>
                        </TableCell>
                        <TableCell align="right">{formatAmount(row.available)}</TableCell>
                        <TableCell align="right">{formatAmount(row.frozen)}</TableCell>
                        <TableCell align="right">
                          <Typography variant="subtitle2">{formatAmount(row.total)}</Typography>
                        </TableCell>
                      </TableRow>
                    ))}
                    {!snapshot.balances.length && <EmptyRow colSpan={4} text="暂无账户余额" />}
                  </TableBody>
                </Table>
              </TableContainer>
            </Card>

            <Card variant="outlined" sx={{ boxShadow: 'none' }}>
              <Stack direction="row" justifyContent="space-between" sx={{ p: 3 }}>
                <Box>
                  <Typography variant="h6">复式账本平衡检查</Typography>
                  <Typography variant="body2" color="text.secondary">
                    按所选日期与币种汇总借方、贷方和差额。
                  </Typography>
                </Box>
                <Label color={ledgerChecksPass ? 'success' : 'error'}>
                  {ledgerChecksPass ? '检查通过' : '发现异常'}
                </Label>
              </Stack>
              <TableContainer>
                <Table>
                  <TableHead>
                    <TableRow>
                      <TableCell>币种</TableCell>
                      <TableCell align="right">凭证</TableCell>
                      <TableCell align="right">借方</TableCell>
                      <TableCell align="right">贷方</TableCell>
                      <TableCell align="right">差额</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {snapshot.ledgerChecks.map((row) => (
                      <TableRow key={row.currency}>
                        <TableCell>{row.currency}</TableCell>
                        <TableCell align="right">{row.journalCount}</TableCell>
                        <TableCell align="right">{formatAmount(row.debits)}</TableCell>
                        <TableCell align="right">{formatAmount(row.credits)}</TableCell>
                        <TableCell align="right">
                          <Label color={row.balanced ? 'success' : 'error'}>
                            {formatAmount(row.delta)}
                          </Label>
                        </TableCell>
                      </TableRow>
                    ))}
                    {!snapshot.ledgerChecks.length && (
                      <EmptyRow colSpan={5} text="所选日期暂无账本凭证" />
                    )}
                  </TableBody>
                </Table>
              </TableContainer>
            </Card>
          </Box>

          <Card variant="outlined" sx={{ boxShadow: 'none' }}>
            <Stack
              direction={{ xs: 'column', sm: 'row' }}
              justifyContent="space-between"
              spacing={2}
              sx={{ p: 3 }}
            >
              <Box>
                <Typography variant="h6">业务流水核对</Typography>
                <Typography variant="body2" color="text.secondary">
                  对照客户、业务金额、状态与最终入账时间；审批状态不等同最终结算。
                </Typography>
              </Box>
              <TextField
                select
                size="small"
                label="状态"
                value={status}
                onChange={(event) => setStatus(event.target.value as typeof status)}
                sx={{ minWidth: 150 }}
              >
                <MenuItem value="all">全部</MenuItem>
                {Object.entries(STATUS_LABELS).map(([value, label]) => (
                  <MenuItem key={value} value={value}>
                    {label}
                  </MenuItem>
                ))}
              </TextField>
            </Stack>
            <TableContainer>
              <Table>
                <TableHead>
                  <TableRow>
                    <TableCell>业务编号</TableCell>
                    <TableCell>客户</TableCell>
                    <TableCell>类型</TableCell>
                    <TableCell>金额</TableCell>
                    <TableCell>状态</TableCell>
                    <TableCell>业务时间</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {visibleMovements.map((operation) => (
                    <TableRow key={operation.id}>
                      <TableCell>
                        <Typography variant="subtitle2">{operation.reference}</Typography>
                        <Typography variant="caption" color="text.secondary">
                          {operation.id}
                        </Typography>
                      </TableCell>
                      <TableCell>{operation.customer.displayName}</TableCell>
                      <TableCell>{OPERATION_LABELS[operation.type]}</TableCell>
                      <TableCell>
                        {formatAmount(Number(operation.amount))} {operation.currency}
                        {operation.quoteCurrency && operation.quoteAmount
                          ? ` → ${formatAmount(Number(operation.quoteAmount))} ${
                              operation.quoteCurrency
                            }`
                          : ''}
                      </TableCell>
                      <TableCell>
                        <Label color={STATUS_COLORS[operation.status]}>
                          {STATUS_LABELS[operation.status]}
                        </Label>
                      </TableCell>
                      <TableCell>
                        {new Date(operationTime(operation)).toLocaleString('zh-CN')}
                      </TableCell>
                    </TableRow>
                  ))}
                  {!visibleMovements.length && <EmptyRow colSpan={6} text="所选日期暂无业务流水" />}
                </TableBody>
              </Table>
            </TableContainer>
            <TablePagination
              component="div"
              count={filteredMovements.length}
              page={page}
              rowsPerPage={25}
              rowsPerPageOptions={[25]}
              onPageChange={(_, value) => setPage(value)}
            />
          </Card>
        </Stack>
      </Container>
    </>
  );
}

function vaFeeIssueReason(reason: VaOpeningFeeIssue['reason']) {
  const labels: Record<VaOpeningFeeIssue['reason'], string> = {
    fee_operation_missing: '非零手续费申请缺少费用流水',
    operation_status_mismatch: '申请状态与费用流水状态不一致',
    completed_journal_missing: '已扣除手续费但缺少账本凭证',
    terminal_journal_unexpected: '已拒绝或取消的手续费出现了账本凭证',
    duplicate_journals: '同一手续费流水存在重复账本凭证',
    submitted_source_wallet_missing: '待处理手续费缺少来源 USD 钱包',
    submitted_reservation_undercovered: '来源 USD 钱包冻结余额不足以覆盖待处理手续费',
    fee_revenue_total_mismatch: '已完成手续费与 USD 手续费收入贷方合计不一致',
  };
  return labels[reason];
}

function MetricCard({
  title,
  value,
  helper,
  icon,
  tone,
  action,
}: {
  title: string;
  value: string;
  helper: string;
  icon: string;
  tone: UiIconBadgeTone;
  action?: ReactNode;
}) {
  return (
    <Card variant="outlined" sx={{ p: 2.5, boxShadow: 'none' }}>
      <Stack direction="row" justifyContent="space-between" alignItems="flex-start">
        <Box>
          <Typography variant="subtitle2" color="text.secondary">
            {title}
          </Typography>
          <Typography variant="h5" sx={{ mt: 1, wordBreak: 'break-word' }}>
            {value}
          </Typography>
        </Box>
        <UiIconBadge icon={icon} tone={tone} />
      </Stack>
      <Typography variant="caption" color="text.secondary" sx={{ mt: 1.5, display: 'block' }}>
        {helper}
      </Typography>
      {action}
    </Card>
  );
}

function EmptyRow({ colSpan, text }: { colSpan: number; text: string }) {
  return (
    <TableRow>
      <TableCell colSpan={colSpan} align="center" sx={{ py: 6, color: 'text.secondary' }}>
        {text}
      </TableCell>
    </TableRow>
  );
}
