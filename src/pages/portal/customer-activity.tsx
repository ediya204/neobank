import { useEffect, useMemo, useState } from 'react';
import { Helmet } from 'react-helmet-async';
import {
  Alert,
  Box,
  Card,
  CardContent,
  Container,
  Divider,
  Drawer,
  FormControl,
  IconButton,
  InputAdornment,
  InputLabel,
  MenuItem,
  Select,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableRow,
  TextField,
  Typography,
} from '@mui/material';
import CustomBreadcrumbs from 'src/components/custom-breadcrumbs';
import Iconify from 'src/components/iconify';
import { TableHeadCustom } from 'src/components/table';
import { APP_DISPLAY_NAME } from 'src/config-global';
import { usePortalCustomer } from 'src/features/finance/portal-customer-context';
import {
  coreApi,
  CryptoTransfer,
  Currency,
  demoOrganizationId,
  Operation,
} from 'src/features/finance/core-api';
import { portalLocale, portalText } from 'src/locales/portal-text';
import { USDT_ASSET_ICON } from 'src/utils/asset-icons';
import { money, OperationStatus } from './customer-shared';

type ActivityType = 'all' | 'FIAT_IN' | 'FIAT_OUT' | 'CRYPTO_IN' | 'CRYPTO_OUT' | 'EXCHANGE';

type ActivityRow = {
  id: string;
  reference: string;
  title: string;
  type: ActivityType;
  status: Operation['status'];
  currency: Currency;
  amount: string;
  direction: 'in' | 'out' | 'exchange';
  createdAt: string;
  detail: string;
  record: { kind: 'operation'; value: Operation } | { kind: 'crypto'; value: CryptoTransfer };
};

type DetailItem = {
  label: string;
  value?: string | null;
  mono?: boolean;
};

const tableHead = [
  { id: 'transaction', label: '交易' },
  { id: 'createdAt', label: '时间', minWidth: 170 },
  { id: 'status', label: '状态', minWidth: 110 },
  { id: 'amount', label: '金额', align: 'right', minWidth: 160 },
];

const operationNames: Record<Operation['type'], string> = {
  DEPOSIT: '法币转入',
  PAYOUT: '法币转出',
  ADJUSTMENT: '账户调整',
  INTERNAL_TRANSFER: '账户划转',
  FX: 'USD / HKD 换汇',
  OTC: 'OTC 兑换',
  VA_OPENING_FEE: portalText('VA 开户手续费'),
};

export default function CustomerActivity() {
  const { customer, operations: recentOperations } = usePortalCustomer();
  const [operations, setOperations] = useState<Operation[]>(recentOperations);
  const [cryptoTransfers, setCryptoTransfers] = useState<CryptoTransfer[]>([]);
  const [type, setType] = useState<ActivityType>('all');
  const [status, setStatus] = useState('all');
  const [query, setQuery] = useState('');
  const [error, setError] = useState('');
  const [selectedRow, setSelectedRow] = useState<ActivityRow | null>(null);

  useEffect(() => {
    setOperations(recentOperations);
  }, [recentOperations]);

  useEffect(() => {
    let active = true;
    if (!customer) {
      setOperations([]);
      setCryptoTransfers([]);
      return () => {
        active = false;
      };
    }
    setError('');
    Promise.allSettled([
      coreApi<Operation[]>(
        `/operations?organizationId=${encodeURIComponent(
          demoOrganizationId
        )}&customerId=${encodeURIComponent(customer.id)}`
      ),
      coreApi<CryptoTransfer[]>(
        `/crypto-wallets/transfers?customerId=${encodeURIComponent(customer.id)}`
      ),
    ]).then(([operationResult, cryptoResult]) => {
      if (!active) return;
      if (operationResult.status === 'fulfilled') {
        setOperations(
          operationResult.value.filter((row) => !(row.type === 'PAYOUT' && row.currency === 'USDT'))
        );
      }
      if (cryptoResult.status === 'fulfilled') {
        setCryptoTransfers(cryptoResult.value.filter((row) => row.network === 'TRON'));
      } else {
        setCryptoTransfers([]);
      }
      if (operationResult.status === 'rejected' || cryptoResult.status === 'rejected') {
        setError(portalText('部分交易记录暂时不可用，请稍后刷新。'));
      }
    });
    return () => {
      active = false;
    };
  }, [customer]);

  const allRows = useMemo<ActivityRow[]>(() => {
    const operationRows = operations.map((row): ActivityRow => {
      let rowType: ActivityType = 'FIAT_OUT';
      let direction: ActivityRow['direction'] = 'out';
      if (row.type === 'DEPOSIT') {
        rowType = 'FIAT_IN';
        direction = 'in';
      }
      if (row.type === 'FX' || row.type === 'OTC') {
        rowType = 'EXCHANGE';
        direction = 'exchange';
      }
      let detail = row.beneficiary?.name || row.sourceAccount?.name || portalText('SSC 余额账户');
      if (row.type === 'FX' || row.type === 'OTC') {
        detail = `${row.currency} → ${row.quoteCurrency || '—'}`;
      }
      if (row.type === 'VA_OPENING_FEE') {
        detail = row.metadata?.vaOpeningFee?.bankName || portalText('VA 账户申请');
      }
      return {
        id: `operation-${row.id}`,
        reference: row.reference,
        title: operationNames[row.type],
        type: rowType,
        status: row.status,
        currency: row.currency,
        amount: row.amount,
        direction,
        createdAt: row.createdAt,
        detail,
        record: { kind: 'operation', value: row },
      };
    });
    const cryptoRows = cryptoTransfers.map(
      (row): ActivityRow => ({
        id: `crypto-${row.id}`,
        reference: row.reference,
        title: row.direction === 'DEPOSIT' ? portalText('USDT 转入') : portalText('USDT 转出'),
        type: row.direction === 'DEPOSIT' ? 'CRYPTO_IN' : 'CRYPTO_OUT',
        status: row.status,
        currency: 'USDT',
        amount: row.amount,
        direction: row.direction === 'DEPOSIT' ? 'in' : 'out',
        createdAt: row.createdAt,
        detail: `TRON（TRC20）${row.txHash ? ` · ${shortHash(row.txHash)}` : ''}`,
        record: { kind: 'crypto', value: row },
      })
    );
    return [...operationRows, ...cryptoRows].sort(
      (left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime()
    );
  }, [cryptoTransfers, operations]);

  const rows = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return allRows.filter((row) => {
      if (type !== 'all' && row.type !== type) return false;
      if (status !== 'all' && row.status !== status) return false;
      if (!normalizedQuery) return true;
      return `${row.reference} ${row.title} ${row.currency} ${row.detail}`
        .toLowerCase()
        .includes(normalizedQuery);
    });
  }, [allRows, query, status, type]);

  return (
    <>
      <Helmet>
        <title>
          {portalText('交易明细 |')}
          {APP_DISPLAY_NAME}
        </title>
      </Helmet>
      <Container maxWidth="lg">
        <Stack spacing={3}>
          <CustomBreadcrumbs
            heading={portalText('交易明细')}
            links={[
              { name: portalText('账户概览'), href: '/portal/home' },
              { name: portalText('交易明细') },
            ]}
          />

          <Typography color="text.secondary" sx={{ mt: -2 }}>
            {portalText(
              '集中查询银行转入转出、USDT 链上交易及兑换记录，并查看每笔交易的处理状态。'
            )}
          </Typography>
          {error && <Alert severity="warning">{error}</Alert>}
          <Card>
            <Stack
              direction={{ xs: 'column', md: 'row' }}
              gap={1.5}
              sx={{ p: 2.5, borderBottom: '1px solid', borderColor: 'divider' }}
            >
              <TextField
                size="small"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder={portalText('搜索交易参考号、币种或交易类型')}
                sx={{ flex: 1, minWidth: { md: 280 } }}
                InputProps={{
                  startAdornment: (
                    <InputAdornment position="start">
                      <Iconify icon="solar:magnifier-linear" />
                    </InputAdornment>
                  ),
                }}
              />

              <FormControl size="small" sx={{ minWidth: 170 }}>
                <InputLabel>{portalText('交易类型')}</InputLabel>
                <Select
                  label={portalText('交易类型')}
                  value={type}
                  onChange={(event) => setType(event.target.value as ActivityType)}
                >
                  <MenuItem value="all">{portalText('全部类型')}</MenuItem>
                  <MenuItem value="FIAT_IN">{portalText('法币转入')}</MenuItem>
                  <MenuItem value="FIAT_OUT">{portalText('法币转出')}</MenuItem>
                  <MenuItem value="CRYPTO_IN">{portalText('USDT 转入')}</MenuItem>
                  <MenuItem value="CRYPTO_OUT">{portalText('USDT 转出')}</MenuItem>
                  <MenuItem value="EXCHANGE">{portalText('法币兑换 / OTC')}</MenuItem>
                </Select>
              </FormControl>
              <FormControl size="small" sx={{ minWidth: 150 }}>
                <InputLabel>{portalText('状态')}</InputLabel>
                <Select
                  label={portalText('状态')}
                  value={status}
                  onChange={(event) => setStatus(event.target.value)}
                >
                  <MenuItem value="all">{portalText('全部状态')}</MenuItem>
                  <MenuItem value="SUBMITTED">{portalText('审核中')}</MenuItem>
                  <MenuItem value="PROCESSING">{portalText('处理中')}</MenuItem>
                  <MenuItem value="COMPLETED">{portalText('已完成')}</MenuItem>
                  <MenuItem value="REJECTED">{portalText('未通过')}</MenuItem>
                  <MenuItem value="FAILED">{portalText('失败')}</MenuItem>
                </Select>
              </FormControl>
            </Stack>

            <TableContainer sx={{ display: { xs: 'none', md: 'block' } }}>
              <Table>
                <TableHeadCustom headLabel={tableHead} />
                <TableBody>
                  {rows.map((row) => (
                    <TableRow
                      key={row.id}
                      hover
                      role="button"
                      tabIndex={0}
                      aria-label={portalText('查看 {{value0}} {{value1}} 详情', {
                        value0: row.title,
                        value1: row.reference,
                      })}
                      onClick={() => setSelectedRow(row)}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter' || event.key === ' ') {
                          event.preventDefault();
                          setSelectedRow(row);
                        }
                      }}
                      sx={{
                        cursor: 'pointer',
                        '&:focus-visible': {
                          outline: '2px solid',
                          outlineColor: 'primary.main',
                          outlineOffset: -2,
                        },
                      }}
                    >
                      <TableCell>
                        <ActivityTitle row={row} />
                      </TableCell>
                      <TableCell>
                        <Typography variant="body2">
                          {new Date(row.createdAt).toLocaleString(portalLocale())}
                        </Typography>
                      </TableCell>
                      <TableCell>
                        <OperationStatus status={row.status} />
                      </TableCell>
                      <TableCell align="right">
                        <ActivityAmount row={row} />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>

            <Stack sx={{ display: { xs: 'flex', md: 'none' } }}>
              {rows.map((row) => (
                <Stack
                  key={row.id}
                  direction="row"
                  alignItems="center"
                  spacing={1.5}
                  role="button"
                  tabIndex={0}
                  aria-label={portalText('查看 {{value0}} {{value1}} 详情', {
                    value0: row.title,
                    value1: row.reference,
                  })}
                  onClick={() => setSelectedRow(row)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault();
                      setSelectedRow(row);
                    }
                  }}
                  sx={{
                    px: 2,
                    py: 2,
                    cursor: 'pointer',
                    borderBottom: '1px solid',
                    borderColor: 'divider',
                    '&:hover': { bgcolor: 'action.hover' },
                    '&:focus-visible': {
                      outline: '2px solid',
                      outlineColor: 'primary.main',
                      outlineOffset: -2,
                    },
                  }}
                >
                  <ActivityIcon row={row} />
                  <Box sx={{ flex: 1, minWidth: 0 }}>
                    <Typography variant="subtitle2">{row.title}</Typography>
                    <Typography variant="caption" color="text.secondary" noWrap>
                      {row.detail} · {new Date(row.createdAt).toLocaleDateString(portalLocale())}
                    </Typography>
                  </Box>
                  <Box sx={{ textAlign: 'right' }}>
                    <ActivityAmount row={row} />
                    <OperationStatus status={row.status} />
                  </Box>
                </Stack>
              ))}
            </Stack>

            {!rows.length && (
              <Typography color="text.secondary" align="center" sx={{ py: 8 }}>
                {portalText('暂无符合当前条件的交易记录')}
              </Typography>
            )}
          </Card>
        </Stack>
      </Container>
      <ActivityDetailDrawer row={selectedRow} onClose={() => setSelectedRow(null)} />
    </>
  );
}

function ActivityDetailDrawer({ row, onClose }: { row: ActivityRow | null; onClose: () => void }) {
  const items = row ? activityDetailItems(row).filter((item) => item.value) : [];
  const rejectionReason = row ? activityRejectionReason(row) : '';

  return (
    <Drawer
      anchor="right"
      open={Boolean(row)}
      onClose={onClose}
      PaperProps={{
        role: 'dialog',
        'aria-modal': true,
        'aria-labelledby': 'activity-detail-title',
        sx: { width: { xs: 1, sm: 480 } },
      }}
    >
      {row && (
        <>
          <Stack
            direction="row"
            alignItems="center"
            justifyContent="space-between"
            sx={{ px: 3, py: 2.5, borderBottom: '1px solid', borderColor: 'divider' }}
          >
            <Box sx={{ minWidth: 0 }}>
              <Typography id="activity-detail-title" variant="h5">
                {portalText('交易明细')}
              </Typography>
              <Typography variant="body2" color="text.secondary" noWrap>
                {row.reference}
              </Typography>
            </Box>
            <IconButton aria-label={portalText('关闭交易明细')} onClick={onClose}>
              <Iconify icon="solar:close-circle-linear" />
            </IconButton>
          </Stack>

          <Stack spacing={3} sx={{ p: 3 }}>
            <Stack alignItems="center" spacing={1.25} sx={{ py: 1 }}>
              <ActivityIcon row={row} />
              <ActivityAmount row={row} emphasized />
              <Stack direction="row" alignItems="center" spacing={1}>
                <Typography variant="subtitle2">{row.title}</Typography>
                <OperationStatus status={row.status} />
              </Stack>
            </Stack>

            <Card variant="outlined">
              <CardContent sx={{ p: 0, '&:last-child': { pb: 0 } }}>
                <Stack divider={<Divider flexItem />}>
                  {items.map((item) => (
                    <ActivityDetailItem key={item.label} item={item} />
                  ))}
                </Stack>
              </CardContent>
            </Card>

            {rejectionReason && (
              <Alert severity="error">
                <Typography variant="subtitle2">{portalText('未通过说明')}</Typography>
                {rejectionReason}
              </Alert>
            )}
          </Stack>
        </>
      )}
    </Drawer>
  );
}

function ActivityDetailItem({ item }: { item: DetailItem }) {
  return (
    <Stack
      direction={{ xs: 'column', sm: 'row' }}
      justifyContent="space-between"
      gap={0.75}
      sx={{ px: 2.5, py: 1.75 }}
    >
      <Typography variant="body2" color="text.secondary">
        {item.label}
      </Typography>
      <Typography
        variant="body2"
        sx={{
          textAlign: { sm: 'right' },
          wordBreak: item.mono ? 'break-all' : 'break-word',
          fontFamily: item.mono ? 'monospace' : undefined,
        }}
      >
        {item.value}
      </Typography>
    </Stack>
  );
}

function activityDetailItems(row: ActivityRow): DetailItem[] {
  if (row.record.kind === 'crypto') {
    const transfer = row.record.value;
    return [
      { label: portalText('交易类型'), value: row.title },
      { label: portalText('参考号'), value: transfer.reference, mono: true },
      { label: portalText('网络'), value: 'TRON（TRC20）' },
      { label: portalText('链上金额'), value: money(transfer.amount, 'USDT') },
      { label: portalText('手续费'), value: money(transfer.feeAmount, 'USDT') },
      { label: portalText('实际到账'), value: money(transfer.netAmount, 'USDT') },
      {
        label: portalText('发送地址'),
        value: transfer.fromAddress || portalText('暂未获取'),
        mono: true,
      },
      {
        label: portalText('接收地址'),
        value: transfer.toAddress || portalText('暂未获取'),
        mono: true,
      },
      { label: 'TXID', value: transfer.txHash || portalText('执行后生成'), mono: true },
      {
        label: portalText('网络确认'),
        value: portalText('{{value0}} 次', { value0: transfer.confirmations }),
      },
      { label: portalText('创建时间'), value: formatActivityDate(transfer.createdAt) },
      { label: portalText('提交时间'), value: formatActivityDate(transfer.submittedAt) },
      { label: portalText('审核通过时间'), value: formatActivityDate(transfer.approvedAt) },
      { label: portalText('完成时间'), value: formatActivityDate(transfer.completedAt) },
    ];
  }

  const operation = row.record.value;
  const payoutMethods: Record<NonNullable<Operation['payoutMethod']>, string> = {
    VA: portalText('VA 账户'),
    POBO: 'POBO',
    PLATFORM: portalText('平台代付'),
  };
  const vaFee = operation.metadata?.vaOpeningFee;
  let vaFeeStatus: string | null = null;
  if (operation.type === 'VA_OPENING_FEE') {
    vaFeeStatus = portalText('手续费已冻结');
    if (operation.status === 'COMPLETED') vaFeeStatus = portalText('手续费已扣除');
    if (operation.status === 'REJECTED' || operation.status === 'CANCELLED') {
      vaFeeStatus = portalText('手续费已释放');
    }
  }
  return [
    { label: portalText('交易类型'), value: row.title },
    { label: portalText('参考号'), value: operation.reference, mono: true },
    { label: portalText('交易金额'), value: money(operation.amount, operation.currency) },
    { label: portalText('手续费'), value: money(operation.feeAmount, operation.currency) },
    {
      label: portalText('到账金额'),
      value:
        operation.quoteAmount && operation.quoteCurrency
          ? money(operation.quoteAmount, operation.quoteCurrency)
          : null,
    },
    {
      label: portalText('成交汇率'),
      value:
        operation.rate && operation.quoteCurrency
          ? `1 ${operation.currency} = ${operation.rate} ${operation.quoteCurrency}`
          : null,
    },
    {
      label: portalText('付款方式'),
      value: operation.payoutMethod ? payoutMethods[operation.payoutMethod] : null,
    },
    { label: portalText('付款账户'), value: operation.sourceAccount?.name },
    { label: portalText('收款账户'), value: operation.targetAccount?.name },
    { label: portalText('收款人'), value: operation.beneficiary?.name },
    { label: portalText('资金通道'), value: operation.channel?.name },
    { label: portalText('汇款附言'), value: operation.remittanceReference },
    { label: portalText('外部参考号'), value: operation.externalReference, mono: true },
    { label: portalText('交易说明'), value: operation.narrative },
    { label: portalText('服务银行'), value: vaFee?.bankName },
    { label: portalText('VA 申请编号'), value: vaFee?.requestId, mono: true },
    { label: portalText('手续费规则版本'), value: vaFee?.version },
    { label: portalText('手续费状态'), value: vaFeeStatus },
    { label: portalText('手续费冻结时间'), value: formatActivityDate(vaFee?.reservedAt) },
    { label: portalText('创建时间'), value: formatActivityDate(operation.createdAt) },
    { label: portalText('提交时间'), value: formatActivityDate(operation.submittedAt) },
    { label: portalText('审核通过时间'), value: formatActivityDate(operation.approvedAt) },
    { label: portalText('执行时间'), value: formatActivityDate(operation.executedAt) },
  ];
}

function activityRejectionReason(row: ActivityRow) {
  return row.record.kind === 'crypto'
    ? row.record.value.rejectionReason || ''
    : row.record.value.rejectionReason || '';
}

function formatActivityDate(value?: string) {
  return value ? new Date(value).toLocaleString(portalLocale()) : null;
}

function ActivityTitle({ row }: { row: ActivityRow }) {
  return (
    <Stack direction="row" spacing={1.5} alignItems="center">
      <ActivityIcon row={row} />
      <Box>
        <Typography variant="subtitle2">{row.title}</Typography>
        <Typography variant="caption" color="text.secondary">
          {row.reference} · {row.detail}
        </Typography>
      </Box>
    </Stack>
  );
}

function ActivityIcon({ row }: { row: ActivityRow }) {
  const isCrypto = row.type === 'CRYPTO_IN' || row.type === 'CRYPTO_OUT';
  const icon = activityIcon(row, isCrypto);
  return (
    <Box
      sx={{
        width: 42,
        height: 42,
        flexShrink: 0,
        borderRadius: 1.5,
        display: 'grid',
        placeItems: 'center',
        bgcolor: isCrypto ? '#E8F6F2' : 'background.neutral',
      }}
    >
      <Iconify icon={icon} width={23} />
    </Box>
  );
}

function ActivityAmount({ row, emphasized = false }: { row: ActivityRow; emphasized?: boolean }) {
  let prefix = '';
  if (row.direction === 'in') prefix = '+';
  if (row.direction === 'out') prefix = '−';
  return (
    <Typography
      variant={emphasized ? 'h4' : 'subtitle2'}
      color={row.direction === 'in' ? 'success.main' : 'text.primary'}
    >
      {prefix}
      {money(row.amount, row.currency)}
    </Typography>
  );
}

function activityIcon(row: ActivityRow, isCrypto: boolean) {
  if (isCrypto) return USDT_ASSET_ICON;
  if (row.direction === 'in') return 'solar:download-minimalistic-bold-duotone';
  if (row.direction === 'exchange') return 'solar:refresh-square-bold-duotone';
  return 'solar:upload-minimalistic-bold-duotone';
}

function shortHash(value: string) {
  return value.length > 16 ? `${value.slice(0, 8)}…${value.slice(-6)}` : value;
}
