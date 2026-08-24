import { useCallback, useEffect, useMemo, useState } from 'react';
import { Helmet } from 'react-helmet-async';
import {
  Alert,
  Box,
  Button,
  Card,
  Chip,
  Container,
  Divider,
  Drawer,
  FormControl,
  IconButton,
  InputLabel,
  MenuItem,
  Select,
  Skeleton,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TablePagination,
  TableRow,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import AssetIcon from 'src/components/asset-icon';
import Iconify from 'src/components/iconify';
import Label from 'src/components/label';
import {
  coreApi,
  Customer,
  demoOrganizationId,
  UsdtInboundRecord,
  UsdtInboundResponse,
} from 'src/features/finance/core-api';
import { ACTION_ICONS, UI_ICONS } from 'src/theme/iconography';

type SourceFilter = 'all' | UsdtInboundRecord['source'];
type StatusFilter = 'all' | UsdtInboundRecord['status'];

const emptyResponse: UsdtInboundResponse = {
  data: [],
  pagination: { total: 0, limit: 50, offset: 0 },
  summary: { chain: 0, localOtc: 0, completed: 0, processing: 0, attention: 0 },
};

const sourceCopy: Record<
  UsdtInboundRecord['source'],
  { label: string; color: 'info' | 'warning' }
> = {
  ON_CHAIN: { label: '链上转入', color: 'info' },
  LOCAL_OTC: { label: '本地 OTC', color: 'warning' },
};

const statusCopy: Record<
  UsdtInboundRecord['status'],
  { label: string; color: 'default' | 'info' | 'success' | 'error' | 'warning' }
> = {
  PENDING: { label: '待记账', color: 'default' },
  PROCESSING: { label: '处理中', color: 'info' },
  COMPLETED: { label: '已入账', color: 'success' },
  FAILED: { label: '失败', color: 'error' },
  EXCEPTION: { label: '异常待核对', color: 'warning' },
};

export default function UsdtInboundAdmin() {
  const userId = 'usr_admin';
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [payload, setPayload] = useState<UsdtInboundResponse>(emptyResponse);
  const [source, setSource] = useState<SourceFilter>('all');
  const [status, setStatus] = useState<StatusFilter>('all');
  const [customerId, setCustomerId] = useState('all');
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(0);
  const [rowsPerPage, setRowsPerPage] = useState(50);
  const [selected, setSelected] = useState<UsdtInboundRecord | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const params = new URLSearchParams({
        organizationId: demoOrganizationId,
        limit: String(rowsPerPage),
        offset: String(page * rowsPerPage),
      });
      if (source !== 'all') params.set('source', source);
      if (status !== 'all') params.set('status', status);
      if (customerId !== 'all') params.set('customerId', customerId);
      if (search) params.set('search', search);
      const [inbound, customerRows] = await Promise.all([
        coreApi<UsdtInboundResponse>(`/usdt-inbound?${params.toString()}`, { userId }),
        customers.length
          ? Promise.resolve(customers)
          : coreApi<Customer[]>(`/customers?organizationId=${demoOrganizationId}`, { userId }),
      ]);
      setPayload(inbound);
      setCustomers(customerRows);
    } catch (value) {
      setError(value instanceof Error ? value.message : 'USDT 入账记录加载失败');
    } finally {
      setLoading(false);
    }
  }, [customerId, customers, page, rowsPerPage, search, source, status, userId]);

  useEffect(() => {
    load().catch(() => undefined);
  }, [load]);

  const resetPage = () => setPage(0);
  const applySearch = () => {
    resetPage();
    setSearch(searchInput.trim());
  };
  const hasFilters =
    source !== 'all' || status !== 'all' || customerId !== 'all' || Boolean(search);

  return (
    <>
      <Helmet>
        <title>USDT 入账 | SSC Digital Bank</title>
      </Helmet>
      <Container maxWidth="xl">
        <Stack spacing={3}>
          <Stack direction={{ xs: 'column', md: 'row' }} justifyContent="space-between" gap={2}>
            <Box>
              <Stack direction="row" spacing={1.5} alignItems="center">
                <AssetIcon asset="USDT" network="TRON" size={32} />
                <Typography variant="h4">USDT 入账</Typography>
              </Stack>
              <Typography color="text.secondary" sx={{ mt: 0.75 }}>
                统一核对 Cregis 链上转入与账本内 OTC 买入 USDT 的入账记录。
              </Typography>
            </Box>
            <Button
              variant="outlined"
              startIcon={<Iconify icon={ACTION_ICONS.refresh} />}
              disabled={loading}
              onClick={() => load().catch(() => undefined)}
            >
              刷新记录
            </Button>
          </Stack>

          <Alert severity="info" icon={<Iconify icon={UI_ICONS.info} />}>
            链上记录以 Cregis 签名回调和交易核验为托管依据，OTC 记录以 Core
            复式账本为依据；本页只读， 不提供手工补录或余额修改。
          </Alert>

          {error && (
            <Alert severity="error" action={<Button onClick={() => load()}>重试</Button>}>
              {error}
            </Alert>
          )}

          <InboundSummary response={payload} loading={loading} />

          <Card variant="outlined">
            <Stack spacing={2} sx={{ p: { xs: 2, md: 2.5 } }}>
              <Stack
                direction={{ xs: 'column', lg: 'row' }}
                spacing={1.5}
                alignItems={{ lg: 'center' }}
              >
                <TextField
                  size="small"
                  label="搜索"
                  placeholder="客户、业务号或 TxID"
                  value={searchInput}
                  onChange={(event) => setSearchInput(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') applySearch();
                  }}
                  InputProps={{
                    startAdornment: (
                      <Iconify icon={UI_ICONS.search} sx={{ mr: 1, color: 'text.disabled' }} />
                    ),
                  }}
                  sx={{ minWidth: { lg: 280 } }}
                />
                <FormControl size="small" sx={{ minWidth: 150 }}>
                  <InputLabel>来源</InputLabel>
                  <Select
                    label="来源"
                    value={source}
                    onChange={(event) => {
                      resetPage();
                      setSource(event.target.value as SourceFilter);
                    }}
                  >
                    <MenuItem value="all">全部来源</MenuItem>
                    <MenuItem value="ON_CHAIN">链上转入</MenuItem>
                    <MenuItem value="LOCAL_OTC">本地 OTC</MenuItem>
                  </Select>
                </FormControl>
                <FormControl size="small" sx={{ minWidth: 150 }}>
                  <InputLabel>入账状态</InputLabel>
                  <Select
                    label="入账状态"
                    value={status}
                    onChange={(event) => {
                      resetPage();
                      setStatus(event.target.value as StatusFilter);
                    }}
                  >
                    <MenuItem value="all">全部状态</MenuItem>
                    {Object.entries(statusCopy).map(([value, copy]) => (
                      <MenuItem key={value} value={value}>
                        {copy.label}
                      </MenuItem>
                    ))}
                  </Select>
                </FormControl>
                <FormControl size="small" sx={{ minWidth: 190 }}>
                  <InputLabel>客户</InputLabel>
                  <Select
                    label="客户"
                    value={customerId}
                    onChange={(event) => {
                      resetPage();
                      setCustomerId(event.target.value);
                    }}
                  >
                    <MenuItem value="all">全部客户</MenuItem>
                    {customers.map((customer) => (
                      <MenuItem key={customer.id} value={customer.id}>
                        {customer.displayName}
                      </MenuItem>
                    ))}
                  </Select>
                </FormControl>
                <Button
                  variant="contained"
                  onClick={applySearch}
                  sx={{ alignSelf: { lg: 'stretch' } }}
                >
                  查询
                </Button>
                {hasFilters && (
                  <Button
                    variant="text"
                    onClick={() => {
                      setSource('all');
                      setStatus('all');
                      setCustomerId('all');
                      setSearchInput('');
                      setSearch('');
                      resetPage();
                    }}
                  >
                    清除筛选
                  </Button>
                )}
              </Stack>
            </Stack>
            <Divider />
            <InboundTable rows={payload.data} loading={loading} onOpen={setSelected} />
            <TablePagination
              component="div"
              count={payload.pagination.total}
              page={page}
              rowsPerPage={rowsPerPage}
              rowsPerPageOptions={[25, 50, 100]}
              labelRowsPerPage="每页"
              labelDisplayedRows={({ from, to, count }) => `${from}–${to} / ${count}`}
              onPageChange={(_event, nextPage) => setPage(nextPage)}
              onRowsPerPageChange={(event) => {
                setRowsPerPage(Number(event.target.value));
                setPage(0);
              }}
            />
          </Card>
        </Stack>
      </Container>
      <InboundDrawer record={selected} onClose={() => setSelected(null)} />
    </>
  );
}

function InboundSummary({
  response,
  loading,
}: {
  response: UsdtInboundResponse;
  loading: boolean;
}) {
  const cells = [
    ['全部记录', response.pagination.total, 'text.primary'],
    ['链上转入', response.summary.chain, 'info.main'],
    ['本地 OTC', response.summary.localOtc, 'warning.dark'],
    ['已入账', response.summary.completed, 'success.main'],
    ['处理中', response.summary.processing, 'info.dark'],
    ['异常待核对', response.summary.attention, 'error.main'],
  ] as const;
  return (
    <Box
      sx={{
        display: 'grid',
        gridTemplateColumns: {
          xs: 'repeat(2, minmax(0, 1fr))',
          md: 'repeat(3, minmax(0, 1fr))',
          lg: 'repeat(6, minmax(0, 1fr))',
        },
        border: 1,
        borderColor: 'divider',
        borderRadius: 2,
        overflow: 'hidden',
        bgcolor: 'background.paper',
      }}
    >
      {cells.map(([label, value, color], index) => (
        <Box
          key={label}
          sx={{
            px: 2.25,
            py: 2,
            borderRight: { lg: index < cells.length - 1 ? 1 : 0 },
            borderBottom: { xs: index < 4 ? 1 : 0, md: index < 3 ? 1 : 0, lg: 0 },
            borderColor: 'divider',
          }}
        >
          <Typography variant="caption" color="text.secondary">
            {label}
          </Typography>
          {loading ? (
            <Skeleton width={44} height={38} />
          ) : (
            <Typography variant="h5" sx={{ mt: 0.35, color }}>
              {value}
            </Typography>
          )}
        </Box>
      ))}
    </Box>
  );
}

function InboundTable({
  rows,
  loading,
  onOpen,
}: {
  rows: UsdtInboundRecord[];
  loading: boolean;
  onOpen: (record: UsdtInboundRecord) => void;
}) {
  return (
    <TableContainer>
      <Table sx={{ minWidth: 1060 }}>
        <TableHead>
          <TableRow>
            <TableCell>来源 / 业务号</TableCell>
            <TableCell>客户</TableCell>
            <TableCell align="right">USDT 入账</TableCell>
            <TableCell>来源金额</TableCell>
            <TableCell>状态</TableCell>
            <TableCell>链上 / 账本凭证</TableCell>
            <TableCell>发生时间</TableCell>
            <TableCell align="right">操作</TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {rows.map((row) => (
            <TableRow
              key={`${row.source}:${row.id}`}
              hover
              sx={{ cursor: 'pointer' }}
              onClick={() => onOpen(row)}
            >
              <TableCell>
                <Stack spacing={0.6} alignItems="flex-start">
                  <Chip
                    size="small"
                    variant="outlined"
                    color={sourceCopy[row.source].color}
                    label={sourceCopy[row.source].label}
                  />
                  <Typography
                    variant="caption"
                    color="text.secondary"
                    sx={{ maxWidth: 210 }}
                    noWrap
                  >
                    {row.reference}
                  </Typography>
                </Stack>
              </TableCell>
              <TableCell>
                <Typography variant="subtitle2">{row.customerName}</Typography>
              </TableCell>
              <TableCell align="right">
                <Stack direction="row" spacing={1} justifyContent="flex-end" alignItems="center">
                  <AssetIcon asset="USDT" network="TRON" size={22} />
                  <Typography variant="subtitle2">{formatUsdt(row.amount)}</Typography>
                </Stack>
              </TableCell>
              <TableCell>
                {row.source === 'LOCAL_OTC' && row.sourceCurrency && row.sourceAmount
                  ? `${formatNumber(row.sourceAmount)} ${row.sourceCurrency}`
                  : '链上 USDT'}
              </TableCell>
              <TableCell>
                <StatusLabel status={row.status} />
              </TableCell>
              <TableCell>
                <Typography variant="body2" sx={{ maxWidth: 190 }} noWrap>
                  {recordEvidence(row)}
                </Typography>
              </TableCell>
              <TableCell>{formatDate(row.occurredAt)}</TableCell>
              <TableCell align="right">
                <Button
                  size="small"
                  onClick={(event) => {
                    event.stopPropagation();
                    onOpen(row);
                  }}
                >
                  查看
                </Button>
              </TableCell>
            </TableRow>
          ))}
          {!rows.length && (
            <TableRow>
              <TableCell colSpan={8} align="center" sx={{ py: 9 }}>
                <Stack alignItems="center" spacing={1}>
                  <Iconify icon={ACTION_ICONS.history} width={36} sx={{ color: 'text.disabled' }} />
                  <Typography color="text.secondary">
                    {loading ? '正在加载入账记录…' : '当前筛选条件下没有 USDT 入账记录'}
                  </Typography>
                </Stack>
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
    </TableContainer>
  );
}

function InboundDrawer({
  record,
  onClose,
}: {
  record: UsdtInboundRecord | null;
  onClose: () => void;
}) {
  const details = useMemo(
    () =>
      record
        ? [
            ['客户', record.customerName],
            ['入账金额', `${formatUsdt(record.amount)} USDT`],
            ['网络', 'TRON · TRC20'],
            ['业务号', record.reference],
            ['发生时间', formatDate(record.occurredAt)],
            ['完成时间', record.completedAt ? formatDate(record.completedAt) : '—'],
            ...(record.source === 'ON_CHAIN'
              ? [
                  ['TxID', record.txHash || '—'],
                  ['转出地址', record.fromAddress || '—'],
                  ['入账地址', record.toAddress || '—'],
                  ['托管状态', record.custodyStatus || '—'],
                  ['会计状态', record.accountingStatus || '—'],
                ]
              : [
                  [
                    '卖出金额',
                    `${formatNumber(record.sourceAmount || '0')} ${
                      record.sourceCurrency || ''
                    }`.trim(),
                  ],
                  ['成交汇率', record.rate || '—'],
                  ['Core Operation', record.coreOperationId || '—'],
                  ['目标钱包', record.toAddress || '—'],
                ]),
          ]
        : [],
    [record]
  );
  return (
    <Drawer
      anchor="right"
      open={Boolean(record)}
      onClose={onClose}
      PaperProps={{ sx: { width: { xs: '100%', sm: 480 } } }}
    >
      {record && (
        <Stack sx={{ height: 1 }}>
          <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ p: 2.5 }}>
            <Box>
              <Typography variant="h6">USDT 入账详情</Typography>
              <Typography variant="caption" color="text.secondary">
                {sourceCopy[record.source].label}
              </Typography>
            </Box>
            <IconButton onClick={onClose} aria-label="关闭详情">
              <Iconify icon={UI_ICONS.close} />
            </IconButton>
          </Stack>
          <Divider />
          <Stack spacing={2.5} sx={{ p: 2.5, overflowY: 'auto' }}>
            <Stack direction="row" justifyContent="space-between" alignItems="center">
              <Stack direction="row" spacing={1.25} alignItems="center">
                <AssetIcon asset="USDT" network="TRON" size={32} />
                <Typography variant="h5">{formatUsdt(record.amount)} USDT</Typography>
              </Stack>
              <StatusLabel status={record.status} />
            </Stack>
            {record.exceptionReason && (
              <Alert severity="warning">核对原因：{record.exceptionReason}</Alert>
            )}
            <Divider />
            <Stack spacing={1.8}>
              {details.map(([label, value]) => (
                <Stack
                  key={label}
                  direction="row"
                  justifyContent="space-between"
                  gap={3}
                  alignItems="flex-start"
                >
                  <Typography variant="body2" color="text.secondary" sx={{ flexShrink: 0 }}>
                    {label}
                  </Typography>
                  <Stack direction="row" spacing={0.5} alignItems="flex-start" sx={{ minWidth: 0 }}>
                    <Typography
                      variant="body2"
                      sx={{ textAlign: 'right', overflowWrap: 'anywhere' }}
                    >
                      {value}
                    </Typography>
                    {value !== '—' &&
                      [
                        'TxID',
                        '业务号',
                        'Core Operation',
                        '转出地址',
                        '入账地址',
                        '目标钱包',
                      ].includes(label) && (
                        <Tooltip title="复制">
                          <IconButton
                            size="small"
                            onClick={() => navigator.clipboard.writeText(value)}
                            aria-label={`复制${label}`}
                          >
                            <Iconify icon={ACTION_ICONS.copy} width={16} />
                          </IconButton>
                        </Tooltip>
                      )}
                  </Stack>
                </Stack>
              ))}
            </Stack>
          </Stack>
        </Stack>
      )}
    </Drawer>
  );
}

function StatusLabel({ status }: { status: UsdtInboundRecord['status'] }) {
  const copy = statusCopy[status];
  return <Label color={copy.color}>{copy.label}</Label>;
}

function formatUsdt(value: string) {
  return new Intl.NumberFormat('zh-CN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 8,
  }).format(Number(value));
}

function formatNumber(value: string) {
  return new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 8 }).format(Number(value));
}

function formatDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString('zh-CN');
}

function compactValue(value: string) {
  if (value.length <= 18) return value;
  return `${value.slice(0, 9)}…${value.slice(-7)}`;
}

function recordEvidence(record: UsdtInboundRecord) {
  const value = record.txHash || record.coreOperationId;
  return value ? compactValue(value) : '—';
}
