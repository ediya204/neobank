import { useCallback, useEffect, useMemo, useState } from 'react';
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
} from 'src/features/finance/core-api';
import { buildCoreReconciliationSnapshot } from 'src/features/finance/core-reconciliation';
import { ACTION_ICONS } from 'src/theme/iconography';

const OPERATION_LABELS: Record<Operation['type'], string> = {
  DEPOSIT: '法币入账',
  PAYOUT: '法币转出',
  ADJUSTMENT: '调账',
  INTERNAL_TRANSFER: '内部划转',
  FX: '法币换汇',
  OTC: 'OTC 兑换',
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

export default function CoreReconciliationPage() {
  const [date, setDate] = useState(hongKongToday);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [operations, setOperations] = useState<Operation[]>([]);
  const [journals, setJournals] = useState<JournalEntry[]>([]);
  const [status, setStatus] = useState<'all' | Operation['status']>('all');
  const [page, setPage] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [snapshotAt, setSnapshotAt] = useState<Date | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [customerRows, operationRows, journalRows] = await Promise.all([
        coreApi<Customer[]>(`/customers?organizationId=${demoOrganizationId}`, {
          userId: 'usr_admin',
        }),
        coreApi<Operation[]>(`/operations?organizationId=${demoOrganizationId}`, {
          userId: 'usr_admin',
        }),
        coreApi<JournalEntry[]>(`/ledger?organizationId=${demoOrganizationId}`, {
          userId: 'usr_admin',
        }),
      ]);
      setCustomers(customerRows);
      setOperations(operationRows);
      setJournals(journalRows);
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
    () => buildCoreReconciliationSnapshot({ date, customers, operations, journals }),
    [customers, date, journals, operations]
  );
  const filteredMovements = snapshot.movements.filter(
    (operation) => status === 'all' || operation.status === status
  );
  const visibleMovements = filteredMovements.slice(page * 25, page * 25 + 25);
  const checksPass =
    snapshot.unbalancedJournalCount === 0 && snapshot.completedWithoutJournal.length === 0;

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
            <Alert severity={checksPass ? 'success' : 'error'}>
              {checksPass
                ? `账本一致性检查通过：${snapshot.journalCount} 张凭证借贷平衡，已完成业务均有账本凭证。`
                : `发现 ${snapshot.unbalancedJournalCount} 张借贷不平衡凭证、${snapshot.completedWithoutJournal.length} 笔已完成但缺少凭证的业务，请立即核对。`}
            </Alert>
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
              helper="仅统计已完成业务"
              icon="solar:upload-minimalistic-bold-duotone"
              tone="warning"
            />
            <MetricCard
              title="一致性异常"
              value={`${snapshot.unbalancedJournalCount + snapshot.completedWithoutJournal.length}`}
              helper="借贷差额或缺失凭证"
              icon="solar:shield-warning-bold-duotone"
              tone={checksPass ? 'success' : 'error'}
            />
          </Box>

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
                <Label color={checksPass ? 'success' : 'error'}>
                  {checksPass ? '检查通过' : '发现异常'}
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

function MetricCard({
  title,
  value,
  helper,
  icon,
  tone,
}: {
  title: string;
  value: string;
  helper: string;
  icon: string;
  tone: UiIconBadgeTone;
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
