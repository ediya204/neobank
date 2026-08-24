import { useCallback, useEffect, useMemo, useState } from 'react';
import { Helmet } from 'react-helmet-async';
import { useNavigate } from 'react-router-dom';
import {
  Alert,
  Box,
  Button,
  Card,
  Chip,
  CircularProgress,
  Container,
  InputAdornment,
  MenuItem,
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
import { alpha } from '@mui/material/styles';
import AssetIcon from 'src/components/asset-icon';
import Iconify from 'src/components/iconify';
import Label from 'src/components/label';
import { IS_NEOBANK_DEPLOYMENT } from 'src/config/deployment-mode';
import {
  loadNeobankCustomerRecords,
  mapNeobankCustomer,
  NeobankCustomerRecord,
} from 'src/features/customers/neobank-customer';
import {
  coreApi,
  Customer,
  demoOrganizationId,
  MoneyAccount,
  SYSTEM_WALLET_PRODUCT_NAME,
} from 'src/features/finance/core-api';
import { paths } from 'src/routes/paths';

type ManagedCustomer = Customer & { source?: NeobankCustomerRecord; coreSynced?: boolean };

function dateTime(value?: string | null) {
  if (!value) return '—';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return '—';
  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(parsed);
}

function money(account: MoneyAccount | undefined, digits = 2) {
  const value = Number(account?.availableBalance || 0);
  return Number.isFinite(value)
    ? new Intl.NumberFormat('en-US', {
        minimumFractionDigits: digits,
        maximumFractionDigits: digits,
      }).format(value)
    : '0.00';
}

function accountFor(customer: ManagedCustomer, currency: string) {
  return customer.accounts.find(
    (account) =>
      account.currency === currency &&
      (currency === 'USDT' ? account.network === 'TRON' : account.kind === 'SYSTEM_WALLET')
  );
}

function statusLabel(customer: ManagedCustomer) {
  if (customer.coreSynced === false) return <Label color="warning">Core 同步中</Label>;
  if (customer.status === 'ACTIVE') return <Label color="success">已开户</Label>;
  if (customer.status === 'SUSPENDED') return <Label color="error">已暂停</Label>;
  return <Label color="warning">开户同步中</Label>;
}

function walletLabel(customer: ManagedCustomer) {
  const count = customer.walletCount || Number(customer.source?.wallet_count) || 0;
  const status = customer.walletStatus || customer.source?.wallet_status || '';
  const enabledValue = customer.source?.wallet_deposit_enabled;
  const depositEnabled =
    enabledValue === true || enabledValue === 1 || enabledValue === '1' || enabledValue === 'true';
  if (!count) return <Label color="warning">待创建</Label>;
  if (status === 'active' && depositEnabled) return <Label color="success">TRON · 已启用</Label>;
  if (status === 'active') return <Label color="warning">TRON · 待验证</Label>;
  if (status === 'error') return <Label color="error">TRON · 待重试</Label>;
  return <Label color="warning">TRON · {status || '同步中'}</Label>;
}

export default function CustomerManagementPage() {
  const navigate = useNavigate();
  const userId = 'usr_admin';
  const [customers, setCustomers] = useState<ManagedCustomer[]>([]);
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState('all');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      if (IS_NEOBANK_DEPLOYMENT) {
        const [sourceRows, coreRows] = await Promise.all([
          loadNeobankCustomerRecords(userId),
          coreApi<Customer[]>(`/customers?organizationId=${demoOrganizationId}`, { userId }),
        ]);
        const coreById = new Map(coreRows.map((customer) => [customer.id, customer]));
        setCustomers(
          sourceRows
            .filter((row) => row.kyc_status === 'approved')
            .map((row) => ({
              ...(coreById.get(row.id) || mapNeobankCustomer(row)),
              source: row,
              coreSynced: coreById.has(row.id),
              walletCount: Number(row.wallet_count) || 0,
              walletStatus: row.wallet_status || undefined,
            }))
        );
      } else {
        const rows = await coreApi<Customer[]>(
          `/customers?organizationId=${demoOrganizationId}`,
          { userId }
        );
        setCustomers(
          rows
            .filter((customer) => customer.kycStatus === 'APPROVED')
            .map((customer) => ({ ...customer, coreSynced: true }))
        );
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '客户资料加载失败');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load().catch(() => undefined);
  }, [load]);

  const filtered = useMemo(() => {
    const keyword = query.trim().toLowerCase();
    return customers.filter((customer) => {
      const matchesStatus = status === 'all' || customer.status === status;
      const matchesKeyword =
        !keyword ||
        [
          customer.displayName,
          customer.legalName,
          customer.email,
          customer.phoneCountryCode,
          customer.phone,
          customer.id,
        ].some((value) => String(value || '').toLowerCase().includes(keyword));
      return matchesStatus && matchesKeyword;
    });
  }, [customers, query, status]);

  const activeCount = customers.filter((customer) => customer.status === 'ACTIVE').length;
  const attentionCount = customers.filter(
    (customer) =>
      customer.status !== 'ACTIVE' ||
      customer.coreSynced === false ||
      !customer.accounts.some(
        (account) => account.kind === 'SYSTEM_WALLET' && account.currency === 'USD'
      ) ||
      !customer.accounts.some(
        (account) => account.kind === 'SYSTEM_WALLET' && account.currency === 'HKD'
      )
  ).length;

  return (
    <>
      <Helmet>
        <title>客户管理 | SSC Digital Bank</title>
      </Helmet>
      <Container maxWidth="xl">
        <Stack spacing={3}>
          <Stack
            direction={{ xs: 'column', md: 'row' }}
            justifyContent="space-between"
            alignItems={{ md: 'flex-end' }}
            gap={2}
          >
            <Box>
              <Typography variant="overline" color="primary.main" fontWeight={800}>
                CUSTOMER OPERATIONS
              </Typography>
              <Typography variant="h4">客户管理</Typography>
              <Typography color="text.secondary" sx={{ mt: 0.65 }}>
                仅显示已完成 KYC 的客户；开户申请和审核过程在“开户申请”中处理。
              </Typography>
            </Box>
            <Button
              color="inherit"
              startIcon={<Iconify icon="solar:refresh-linear" />}
              disabled={loading}
              onClick={() => load()}
            >
              刷新客户状态
            </Button>
          </Stack>

          {error && (
            <Alert severity="error" action={<Button onClick={() => load()}>重试</Button>}>
              {error}
            </Alert>
          )}

          <Box
            sx={{
              display: 'grid',
              gridTemplateColumns: { xs: '1fr', sm: 'repeat(3, minmax(0, 1fr))' },
              borderTop: '1px solid',
              borderBottom: '1px solid',
              borderColor: 'divider',
            }}
          >
            {[
              ['正式客户', customers.length, '已完成 KYC'],
              ['已开户', activeCount, '账户服务可用'],
              ['需关注', attentionCount, '开户或账户同步异常'],
            ].map(([label, value, hint], index) => (
              <Box
                key={label}
                sx={{
                  py: 2.25,
                  px: { xs: 0, sm: 2.5 },
                  borderLeft: { xs: 0, sm: index ? '1px solid' : 0 },
                  borderColor: 'divider',
                }}
              >
                <Typography variant="caption" color="text.secondary">
                  {label}
                </Typography>
                <Typography sx={{ fontSize: 28, fontWeight: 760, letterSpacing: '-0.04em' }}>
                  {value}
                </Typography>
                <Typography variant="caption" color="text.disabled">
                  {hint}
                </Typography>
              </Box>
            ))}
          </Box>

          <Card variant="outlined" sx={{ boxShadow: 'none' }}>
            <Stack direction={{ xs: 'column', md: 'row' }} spacing={1.5} sx={{ p: 2 }}>
              <TextField
                fullWidth
                size="small"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="搜索客户名称、邮箱、电话或客户编号"
                InputProps={{
                  startAdornment: (
                    <InputAdornment position="start">
                      <Iconify icon="solar:magnifier-linear" />
                    </InputAdornment>
                  ),
                }}
              />
              <TextField
                select
                size="small"
                label="开户状态"
                value={status}
                onChange={(event) => setStatus(event.target.value)}
                sx={{ minWidth: 180 }}
              >
                <MenuItem value="all">全部状态</MenuItem>
                <MenuItem value="ACTIVE">已开户</MenuItem>
                <MenuItem value="PENDING_REVIEW">开户同步中</MenuItem>
                <MenuItem value="SUSPENDED">已暂停</MenuItem>
              </TextField>
            </Stack>

            <TableContainer>
              <Table sx={{ minWidth: 1160 }}>
                <TableHead>
                  <TableRow>
                    <TableCell>客户</TableCell>
                    <TableCell>联系方式</TableCell>
                    <TableCell>KYC 完成</TableCell>
                    <TableCell>{SYSTEM_WALLET_PRODUCT_NAME}</TableCell>
                    <TableCell>数字钱包</TableCell>
                    <TableCell>可用余额</TableCell>
                    <TableCell align="right">操作</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {filtered.map((customer) => {
                    const usd = accountFor(customer, 'USD');
                    const hkd = accountFor(customer, 'HKD');
                    const usdt = accountFor(customer, 'USDT');
                    const fiatAccounts: Array<[string, MoneyAccount | undefined]> = [
                      ['USD', usd],
                      ['HKD', hkd],
                    ];
                    const balances: Array<[string, MoneyAccount | undefined, number]> = [
                      ['USD', usd, 2],
                      ['HKD', hkd, 2],
                      ['USDT', usdt, 6],
                    ];
                    return (
                      <TableRow
                        key={customer.id}
                        hover
                        sx={{ cursor: customer.coreSynced === false ? 'default' : 'pointer' }}
                        onClick={() => {
                          if (customer.coreSynced !== false) {
                            navigate(paths.dashboard.customers.details(customer.id));
                          }
                        }}
                      >
                        <TableCell>
                          <Stack spacing={0.65} alignItems="flex-start">
                            <Typography variant="subtitle2">{customer.displayName}</Typography>
                            <Typography variant="caption" color="text.secondary">
                              {customer.type === 'BUSINESS' ? '企业' : '个人'} · {customer.countryCode}{' '}
                              · {customer.id}
                            </Typography>
                            {statusLabel(customer)}
                          </Stack>
                        </TableCell>
                        <TableCell>
                          <Typography variant="body2">{customer.email}</Typography>
                          <Typography variant="caption" color="text.secondary">
                            {[customer.phoneCountryCode, customer.phone].filter(Boolean).join(' ') || '未填写电话'}
                          </Typography>
                        </TableCell>
                        <TableCell>
                          <Typography variant="body2">
                            {dateTime(customer.kycReviewedAt || customer.source?.kyc_reviewed_at)}
                          </Typography>
                          <Typography variant="caption" color="text.secondary">
                            {customer.kycReviewerId || customer.source?.kyc_reviewed_by || '系统记录'}
                          </Typography>
                        </TableCell>
                        <TableCell>
                          <Stack direction="row" spacing={0.75}>
                            {fiatAccounts.map(([currency, account]) => (
                              <Chip
                                key={currency}
                                size="small"
                                variant="outlined"
                                label={`${currency} · ${account ? '已分配' : '同步中'}`}
                                sx={{
                                  borderColor: account ? 'divider' : 'warning.light',
                                  bgcolor: account
                                    ? 'transparent'
                                    : (theme) => alpha(theme.palette.warning.main, 0.07),
                                }}
                              />
                            ))}
                          </Stack>
                        </TableCell>
                        <TableCell>{walletLabel(customer)}</TableCell>
                        <TableCell>
                          <Stack spacing={0.7}>
                            {balances.map(([asset, account, digits]) => (
                              <Stack key={asset} direction="row" spacing={0.75} alignItems="center">
                                <AssetIcon asset={asset} network={asset === 'USDT' ? 'TRON' : undefined} size={18} />
                                <Typography variant="caption" fontWeight={700}>
                                  {money(account, digits)} {asset}
                                </Typography>
                              </Stack>
                            ))}
                          </Stack>
                        </TableCell>
                        <TableCell align="right">
                          <Button
                            size="small"
                            disabled={customer.coreSynced === false}
                            endIcon={<Iconify icon="solar:arrow-right-linear" />}
                            onClick={(event) => {
                              event.stopPropagation();
                              navigate(paths.dashboard.customers.details(customer.id));
                            }}
                          >
                            {customer.coreSynced === false ? '等待同步' : '查看客户'}
                          </Button>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                  {!filtered.length && (
                    <TableRow>
                      <TableCell colSpan={7} align="center" sx={{ py: 10 }}>
                        {loading ? (
                          <CircularProgress size={28} />
                        ) : (
                          <Stack alignItems="center" spacing={1}>
                            <Iconify icon="solar:users-group-rounded-linear" width={34} sx={{ color: 'text.disabled' }} />
                            <Typography color="text.secondary">没有符合条件的正式客户</Typography>
                            <Button size="small" onClick={() => navigate(paths.dashboard.onboarding)}>
                              查看开户申请
                            </Button>
                          </Stack>
                        )}
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </TableContainer>
          </Card>
        </Stack>
      </Container>
    </>
  );
}
