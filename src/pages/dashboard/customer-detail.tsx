import { Fragment, useCallback, useEffect, useMemo, useState } from 'react';
import { Helmet } from 'react-helmet-async';
import { useNavigate, useParams } from 'react-router-dom';
import {
  Alert,
  Avatar,
  Box,
  Button,
  CircularProgress,
  Container,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  Menu,
  MenuItem,
  Paper,
  Snackbar,
  Stack,
  Tab,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Tabs,
  TextField,
  Typography,
} from '@mui/material';
import { alpha } from '@mui/material/styles';
import Iconify from 'src/components/iconify';
import AssetIcon from 'src/components/asset-icon';
import Label from 'src/components/label';
import { IS_NEOBANK_DEPLOYMENT } from 'src/config/deployment-mode';
import {
  coreApi,
  CryptoTransfer,
  CryptoWallet,
  Currency,
  Customer,
  FundingChannel,
  MoneyAccount,
  neobankApi,
  Operation,
  supportedFiatCurrencies,
  SYSTEM_WALLET_PRODUCT_NAME,
  VirtualAccountRequest,
  WithdrawalFeeRule,
} from 'src/features/finance/core-api';
import { paths } from 'src/routes/paths';
import { ACTION_ICONS } from 'src/theme/iconography';

type DetailTab = 'overview' | 'profile' | 'accounts' | 'transactions' | 'fees' | 'audit';
type ReviewAction = 'ACTIVATE' | 'REJECT_ACCOUNT';

type LoadResult<T> = {
  label: string;
  value: T;
  error?: string;
};

type AuditEvent = {
  id: string;
  title: string;
  detail: string;
  time: string;
  icon: string;
  color: string;
};

type WithdrawalFeeScope = Pick<
  WithdrawalFeeRule,
  'assetClass' | 'currency' | 'method' | 'channelCode' | 'network'
>;

type CustomerFeeRow = WithdrawalFeeScope & {
  key: string;
  channelName: string;
  channelActive: boolean;
  defaultRule?: WithdrawalFeeRule;
};

const panelSx = {
  border: '1px solid',
  borderColor: 'divider',
  borderRadius: 1.5,
  boxShadow: 'none',
  backgroundImage: 'none',
};

const balanceTones: Record<Currency, string> = {
  USD: '#2F6B4F',
  HKD: '#9C6A2C',
  USDT: '#277D70',
  SGD: '#315F8C',
  EUR: '#7A5C8E',
  GBP: '#8A553D',
};

const tabLabels: Array<{ value: DetailTab; label: string }> = [
  { value: 'overview', label: '概览' },
  { value: 'profile', label: '资料与 KYC' },
  { value: 'accounts', label: '账户与 VA' },
  { value: 'transactions', label: '交易与操作' },
  { value: 'fees', label: '手续费与规则' },
  { value: 'audit', label: '审计记录' },
];

async function safeLoad<T>(
  label: string,
  request: Promise<T>,
  fallback: T
): Promise<LoadResult<T>> {
  try {
    return { label, value: await request };
  } catch (caught) {
    return {
      label,
      value: fallback,
      error: caught instanceof Error ? caught.message : `${label}加载失败`,
    };
  }
}

function currencyDecimals(currency: Currency) {
  return currency === 'USDT' ? 6 : 2;
}

function toScaledDigits(value: string, decimals: number) {
  const normalized = String(value || '0').trim();
  const match = normalized.match(/^(\d+)(?:\.(\d+))?$/);
  if (!match) return '0';
  const fraction = (match[2] || '').padEnd(decimals, '0').slice(0, decimals);
  return `${match[1]}${fraction}`.replace(/^0+(?=\d)/, '');
}

function addDigitStrings(left: string, right: string) {
  const width = Math.max(left.length, right.length);
  const leftDigits = left.padStart(width, '0');
  const rightDigits = right.padStart(width, '0');
  let carry = 0;
  let result = '';
  for (let index = width - 1; index >= 0; index -= 1) {
    const sum = Number(leftDigits[index]) + Number(rightDigits[index]) + carry;
    result = `${sum % 10}${result}`;
    carry = Math.floor(sum / 10);
  }
  return `${carry || ''}${result}`.replace(/^0+(?=\d)/, '');
}

function formatScaledDigits(value: string, decimals: number) {
  const padded = value.padStart(decimals + 1, '0');
  const whole = padded.slice(0, -decimals).replace(/^0+(?=\d)/, '');
  const fraction = padded.slice(-decimals).replace(/0+$/, '');
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return fraction ? `${grouped}.${fraction}` : `${grouped}.00`;
}

function sumAccounts(
  customer: Customer,
  currency: Currency,
  field: 'availableBalance' | 'frozenBalance'
) {
  const decimals = currencyDecimals(currency);
  const total = customer.accounts
    .filter((account) => account.status === 'ACTIVE' && account.currency === currency)
    .reduce((sum, account) => addDigitStrings(sum, toScaledDigits(account[field], decimals)), '0');
  return formatScaledDigits(total, decimals);
}

function customerStatus(status: string) {
  const labels: Record<string, string> = {
    ACTIVE: '正常',
    PENDING_REVIEW: '待审核',
    REJECTED: '已拒绝',
    SUSPENDED: '已暂停',
  };
  let color: 'success' | 'warning' | 'error' | 'default' = 'default';
  if (status === 'ACTIVE') color = 'success';
  if (status === 'PENDING_REVIEW') color = 'warning';
  if (status === 'REJECTED' || status === 'SUSPENDED') color = 'error';
  return <Label color={color}>{labels[status] || status}</Label>;
}

function customerStatusText(status: string) {
  const labels: Record<string, string> = {
    ACTIVE: '正常',
    PENDING_REVIEW: '待审核',
    REJECTED: '已拒绝',
    SUSPENDED: '已暂停',
  };
  return labels[status] || status;
}

function kycStatusText(status: string) {
  const labels: Record<string, string> = {
    APPROVED: '已通过',
    PENDING: '待处理',
    REJECTED: '已拒绝',
  };
  return labels[status] || status;
}

function kycStatusColor(status: string): 'info' | 'warning' | 'error' {
  if (status === 'APPROVED') return 'info';
  if (status === 'REJECTED') return 'error';
  return 'warning';
}

function operationStatus(status: string) {
  const labels: Record<string, string> = {
    ACTIVE: '正常',
    PENDING: '待处理',
    FROZEN: '已冻结',
    CLOSED: '已关闭',
    DISABLED: '已停用',
    DRAFT: '草稿',
    SUBMITTED: '待审批',
    APPROVED: '已批准',
    PROCESSING: '处理中',
    COMPLETED: '已完成',
    REJECTED: '已拒绝',
    FAILED: '失败',
    CANCELLED: '已取消',
  };
  let color: 'success' | 'warning' | 'error' | 'info' | 'default' = 'default';
  if (status === 'ACTIVE' || status === 'COMPLETED') color = 'success';
  if (status === 'PENDING' || status === 'SUBMITTED' || status === 'PROCESSING') color = 'warning';
  if (status === 'APPROVED') color = 'info';
  if (
    status === 'FROZEN' ||
    status === 'DISABLED' ||
    status === 'REJECTED' ||
    status === 'FAILED' ||
    status === 'CANCELLED'
  ) {
    color = 'error';
  }
  return <Label color={color}>{labels[status] || status}</Label>;
}

function customerInitials(name: string) {
  const segments = name.trim().split(/\s+/).filter(Boolean);
  if (segments.length >= 2) {
    return `${segments[0][0]}${segments[1][0]}`.toUpperCase();
  }
  return segments[0]?.slice(0, 2).toUpperCase() || 'CU';
}

function operationType(type: string) {
  const labels: Record<string, string> = {
    DEPOSIT: '入账',
    PAYOUT: '出款',
    ADJUSTMENT: '调账',
    INTERNAL_TRANSFER: '内部转账',
    FX: '法币换汇',
    OTC: '自动兑换',
  };
  return labels[type] || type;
}

function formatDate(value?: string) {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '-';
  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

function feeKey(rule: WithdrawalFeeScope) {
  return [rule.assetClass, rule.currency, rule.method, rule.channelCode, rule.network || ''].join(
    '|'
  );
}

function feeServiceName(rule: WithdrawalFeeScope) {
  if (rule.assetClass === 'CRYPTO') return `${rule.currency}-${rule.network || ''} 链上提币`;
  const methods: Record<string, string> = {
    VA: 'VA 出款',
    POBO: 'POBO 代付',
    PLATFORM: '平台代付',
  };
  return `${rule.currency} ${methods[rule.method] || rule.method}`;
}

function validFeeAmount(value: string, currency: Currency) {
  const match = value.trim().match(/^\d+(?:\.(\d+))?$/);
  return Boolean(match && (match[1]?.length || 0) <= currencyDecimals(currency));
}

function CustomerIdentity({ customer }: { customer: Customer }) {
  const initials = customerInitials(customer.displayName);
  return (
    <Stack direction="row" alignItems="center" spacing={2} sx={{ minWidth: 0 }}>
      <Avatar
        sx={{
          width: 58,
          height: 58,
          bgcolor: '#1E3A34',
          color: '#F3F8F5',
          fontSize: 17,
          fontWeight: 800,
        }}
      >
        {initials}
      </Avatar>
      <Box sx={{ minWidth: 0 }}>
        <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
          <Typography
            sx={{
              fontSize: { xs: 22, md: 27 },
              lineHeight: 1.15,
              fontWeight: 750,
              letterSpacing: '-0.035em',
            }}
          >
            {customer.displayName}
          </Typography>
          {customerStatus(customer.status)}
          <Label color={kycStatusColor(customer.kycStatus)}>
            KYC {kycStatusText(customer.kycStatus)}
          </Label>
        </Stack>
        <Typography variant="body2" color="text.secondary" sx={{ mt: 0.6 }}>
          {customer.type === 'BUSINESS' ? '企业客户' : '个人客户'} ·{' '}
          {customer.externalId || customer.id} · {customer.countryCode}
        </Typography>
      </Box>
    </Stack>
  );
}

function BalanceStrip({ customer }: { customer: Customer }) {
  const currencies: Currency[] = ['USD', 'HKD', 'USDT'];
  return (
    <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: 'repeat(3, 1fr)' } }}>
      {currencies.map((currency, index) => (
        <Box
          key={currency}
          sx={{
            p: 2.25,
            borderLeft: { xs: 0, sm: index === 0 ? 0 : '1px solid' },
            borderTop: { xs: index === 0 ? 0 : '1px solid', sm: 0 },
            borderColor: 'divider',
          }}
        >
          <Stack direction="row" alignItems="center" spacing={1}>
            <Box
              sx={{
                width: 9,
                height: 9,
                borderRadius: '50%',
                bgcolor: balanceTones[currency],
                boxShadow: `0 0 0 4px ${alpha(balanceTones[currency], 0.1)}`,
              }}
            />
            <Typography variant="overline" color="text.secondary">
              {currency} 可用余额
            </Typography>
          </Stack>
          <Typography sx={{ mt: 1, fontSize: 22, fontWeight: 750, letterSpacing: '-0.03em' }}>
            {sumAccounts(customer, currency, 'availableBalance')}
          </Typography>
          <Typography variant="caption" color="text.secondary">
            冻结 {sumAccounts(customer, currency, 'frozenBalance')}
          </Typography>
        </Box>
      ))}
    </Box>
  );
}

function OperationsTable({ rows }: { rows: Operation[] }) {
  return (
    <TableContainer>
      <Table size="small">
        <TableHead>
          <TableRow>
            <TableCell>时间 / 编号</TableCell>
            <TableCell>业务类型</TableCell>
            <TableCell>资产</TableCell>
            <TableCell align="right">金额</TableCell>
            <TableCell align="right">手续费</TableCell>
            <TableCell align="right">状态</TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {rows.map((row) => (
            <TableRow key={row.id} hover>
              <TableCell>
                <Typography variant="body2" fontWeight={650}>
                  {formatDate(row.createdAt)}
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  {row.reference}
                </Typography>
              </TableCell>
              <TableCell>{operationType(row.type)}</TableCell>
              <TableCell>{row.currency}</TableCell>
              <TableCell align="right" sx={{ fontWeight: 700, whiteSpace: 'nowrap' }}>
                {row.amount}
              </TableCell>
              <TableCell align="right">{row.feeAmount || '0'}</TableCell>
              <TableCell align="right">{operationStatus(row.status)}</TableCell>
            </TableRow>
          ))}
          {!rows.length && (
            <TableRow>
              <TableCell colSpan={6} align="center" sx={{ py: 7, color: 'text.secondary' }}>
                暂无交易或运营操作
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
    </TableContainer>
  );
}

function InfoGrid({ customer }: { customer: Customer }) {
  const fields = [
    ['客户编号', customer.externalId || customer.id],
    ['法定名称', customer.legalName],
    ['客户类型', customer.type === 'BUSINESS' ? '企业' : '个人'],
    ['注册/常住地', customer.countryCode],
    ['联系邮箱', customer.email],
    ['联系电话', `${customer.phoneCountryCode || ''} ${customer.phone || ''}`.trim() || '-'],
    ['企业注册号', customer.registrationNo || '-'],
    ['授权联系人', customer.contactName || '-'],
    ['联系人职务', customer.contactRole || '-'],
    ['最终受益人', customer.beneficialOwnerName || '-'],
    [
      '持股或控制比例',
      customer.beneficialOwnerOwnership ? `${customer.beneficialOwnerOwnership}%` : '-',
    ],
    ['创建时间', formatDate(customer.createdAt)],
  ];
  if (customer.type === 'INDIVIDUAL') {
    fields[6] = ['出生日期', customer.dateOfBirth?.slice(0, 10) || '-'];
    fields[7] = ['国籍', customer.nationality || '-'];
  }
  return (
    <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: 'repeat(2, 1fr)' } }}>
      {fields.map(([label, value], index) => (
        <Box
          key={label}
          sx={{
            px: 2.25,
            py: 1.65,
            borderTop: index < 2 ? 0 : '1px solid',
            borderLeft: { xs: 0, md: index % 2 === 1 ? '1px solid' : 0 },
            borderColor: 'divider',
          }}
        >
          <Typography variant="caption" color="text.disabled">
            {label}
          </Typography>
          <Typography variant="body2" fontWeight={650} sx={{ mt: 0.35, wordBreak: 'break-word' }}>
            {value}
          </Typography>
        </Box>
      ))}
    </Box>
  );
}

export default function CustomerDetailPage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const userId = 'usr_admin';
  const [tab, setTab] = useState<DetailTab>('overview');
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [operations, setOperations] = useState<Operation[]>([]);
  const [vaRequests, setVaRequests] = useState<VirtualAccountRequest[]>([]);
  const [wallets, setWallets] = useState<CryptoWallet[]>([]);
  const [cryptoTransfers, setCryptoTransfers] = useState<CryptoTransfer[]>([]);
  const [feeRules, setFeeRules] = useState<WithdrawalFeeRule[]>([]);
  const [fundingChannels, setFundingChannels] = useState<FundingChannel[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [partialErrors, setPartialErrors] = useState<string[]>([]);
  const [success, setSuccess] = useState('');
  const [actionAnchor, setActionAnchor] = useState<HTMLElement | null>(null);
  const [reviewAction, setReviewAction] = useState<ReviewAction | null>(null);
  const [reviewNote, setReviewNote] = useState('');
  const [reviewing, setReviewing] = useState(false);
  const [editingFee, setEditingFee] = useState<{
    feeScope: CustomerFeeRow;
    override?: WithdrawalFeeRule;
    amount: string;
  } | null>(null);
  const [feeSaving, setFeeSaving] = useState(false);
  const [vaRequestOpen, setVaRequestOpen] = useState(false);
  const [vaChannelId, setVaChannelId] = useState('');
  const [vaCurrency, setVaCurrency] = useState<Currency>('USD');
  const [vaPurpose, setVaPurpose] = useState('跨境贸易收款');
  const [vaSubmitting, setVaSubmitting] = useState(false);

  const load = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    setLoadError('');
    try {
      const customerRow = await coreApi<Customer>(`/customers/${id}`, { userId });
      setCustomer(customerRow);
      const [operationResult, vaResult, walletResult, transferResult, feeResult, channelResult] =
        await Promise.all([
          safeLoad(
            '交易与操作',
            coreApi<Operation[]>(
              `/operations?organizationId=${encodeURIComponent(
                customerRow.organizationId
              )}&customerId=${encodeURIComponent(id)}`,
              { userId }
            ),
            []
          ),
          safeLoad(
            'VA 申请',
            coreApi<VirtualAccountRequest[]>(`/customers/${id}/virtual-account-requests`, {
              userId,
            }),
            []
          ),
          safeLoad(
            '数字钱包',
            coreApi<CryptoWallet[]>(`/crypto-wallets?customerId=${encodeURIComponent(id)}`, {
              userId,
            }),
            []
          ),
          safeLoad(
            '数字资产流水',
            coreApi<CryptoTransfer[]>(
              `/crypto-wallets/transfers?customerId=${encodeURIComponent(id)}`,
              { userId }
            ),
            []
          ),
          safeLoad(
            '手续费规则',
            coreApi<WithdrawalFeeRule[]>(
              `/withdrawal-fees?organizationId=${encodeURIComponent(
                customerRow.organizationId
              )}&customerId=${encodeURIComponent(id)}`,
              { userId }
            ),
            []
          ),
          safeLoad(
            '资金通道',
            coreApi<FundingChannel[]>(
              `/funding-channels?organizationId=${encodeURIComponent(customerRow.organizationId)}`,
              { userId }
            ),
            []
          ),
        ]);
      setOperations(operationResult.value);
      setVaRequests(vaResult.value);
      setWallets(walletResult.value);
      setCryptoTransfers(transferResult.value);
      setFeeRules(feeResult.value);
      setFundingChannels(channelResult.value);
      const firstActiveChannel = channelResult.value.find(
        (channel) => channel.active && channel.type === 'VIRTUAL_ACCOUNT'
      );
      setVaChannelId((current) =>
        channelResult.value.some(
          (channel) =>
            channel.active && channel.type === 'VIRTUAL_ACCOUNT' && channel.id === current
        )
          ? current
          : firstActiveChannel?.id || ''
      );
      setVaCurrency((current) =>
        firstActiveChannel?.supportedCurrencies.includes(current)
          ? current
          : firstActiveChannel?.supportedCurrencies[0] || 'USD'
      );
      setPartialErrors(
        [operationResult, vaResult, walletResult, transferResult, feeResult, channelResult]
          .filter((result) => result.error)
          .map((result) => `${result.label}：${result.error}`)
      );
    } catch (caught) {
      setLoadError(caught instanceof Error ? caught.message : '客户详情加载失败');
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    load().catch(() => undefined);
  }, [load]);

  const organizationFeesByKey = useMemo(
    () =>
      new Map(
        feeRules
          .filter((rule) => rule.scope === 'ORGANIZATION')
          .map((rule) => [feeKey(rule), rule] as const)
      ),
    [feeRules]
  );
  const overridesByKey = useMemo(
    () =>
      new Map(
        feeRules
          .filter((rule) => rule.scope === 'CUSTOMER')
          .map((rule) => [feeKey(rule), rule] as const)
      ),
    [feeRules]
  );
  const customerFeeRows = useMemo<CustomerFeeRow[]>(() => {
    const scopes: CustomerFeeRow[] = fundingChannels
      .filter((channel) =>
        ['VIRTUAL_ACCOUNT', 'POBO_PAYOUT', 'PLATFORM_PAYOUT'].includes(channel.type)
      )
      .flatMap((channel) => {
        const method =
          channel.type === 'VIRTUAL_ACCOUNT'
            ? 'VA'
            : (channel.type.replace('_PAYOUT', '') as 'POBO' | 'PLATFORM');
        return channel.supportedCurrencies
          .filter((currency) => supportedFiatCurrencies.includes(currency))
          .map((currency) => {
            const scope: WithdrawalFeeScope = {
              assetClass: 'FIAT',
              currency,
              method,
              channelCode: channel.code,
            };
            const key = feeKey(scope);
            return {
              ...scope,
              key,
              channelName: channel.name,
              channelActive: channel.active,
              defaultRule: organizationFeesByKey.get(key),
            };
          });
      });
    const cryptoScope: WithdrawalFeeScope = {
      assetClass: 'CRYPTO',
      currency: 'USDT',
      method: 'ON_CHAIN',
      channelCode: 'CREGIS',
      network: 'TRON',
    };
    const cryptoKey = feeKey(cryptoScope);
    scopes.push({
      ...cryptoScope,
      key: cryptoKey,
      channelName: 'Cregis',
      channelActive: true,
      defaultRule: organizationFeesByKey.get(cryptoKey),
    });
    return Array.from(new Map(scopes.map((scope) => [scope.key, scope])).values());
  }, [fundingChannels, organizationFeesByKey]);

  const auditEvents = useMemo<AuditEvent[]>(() => {
    if (!customer) return [];
    const events: AuditEvent[] = operations.map((operation) => ({
      id: `operation-${operation.id}`,
      title: `${operationType(operation.type)} · ${operationStatusText(operation.status)}`,
      detail: `${operation.currency} ${operation.amount} · ${operation.reference}`,
      time: operation.createdAt,
      icon: 'solar:document-text-bold',
      color: '#315F8C',
    }));
    vaRequests.forEach((request) => {
      events.push({
        id: `va-${request.id}`,
        title: `VA 申请 · ${operationStatusText(request.status)}`,
        detail: `${request.currency} · ${
          request.channel?.settlementBankName || request.channel?.name || '银行渠道'
        }`,
        time: request.createdAt,
        icon: 'solar:card-2-bold',
        color: '#277D70',
      });
    });
    feeRules
      .filter((rule) => rule.scope === 'CUSTOMER')
      .forEach((rule) => {
        events.push({
          id: `fee-${rule.id}`,
          title: rule.active ? '客户专属手续费已更新' : '客户专属手续费已停用',
          detail: `${feeServiceName(rule)} · ${rule.amount} ${rule.currency} · v${
            rule.version
          } · 操作人 ${rule.updatedBy || '-'}`,
          time: rule.updatedAt,
          icon: 'solar:settings-bold',
          color: '#9C6A2C',
        });
      });
    if (customer.kycReviewedAt) {
      events.push({
        id: 'kyc-review',
        title: `KYC ${customer.kycStatus === 'APPROVED' ? '审核通过' : '审核完成'}`,
        detail: customer.kycReviewNote || '未填写审核备注',
        time: customer.kycReviewedAt,
        icon: 'solar:verified-check-bold',
        color: '#2F6B4F',
      });
    }
    return events.sort((left, right) => Date.parse(right.time) - Date.parse(left.time));
  }, [customer, feeRules, operations, vaRequests]);

  const submitReview = async () => {
    if (!customer || !reviewAction) return;
    if (reviewAction === 'REJECT_ACCOUNT' && !reviewNote.trim()) {
      setLoadError('拒绝操作必须填写原因');
      return;
    }
    setReviewing(true);
    setLoadError('');
    try {
      if (reviewAction === 'ACTIVATE') {
        const endpoint = IS_NEOBANK_DEPLOYMENT
          ? `/admin/customers/${customer.id}/activate`
          : `/customers/${customer.id}/approve`;
        const api = IS_NEOBANK_DEPLOYMENT ? neobankApi : coreApi;
        await api(endpoint, {
          method: 'PATCH',
          userId,
          body: JSON.stringify({ note: reviewNote.trim() || '运营批准开户' }),
        });
        setSuccess('客户开户状态已更新');
      }
      if (reviewAction === 'REJECT_ACCOUNT') {
        if (IS_NEOBANK_DEPLOYMENT) {
          throw new Error('生产客户开户拒绝必须通过 KYC 拒绝流程处理');
        }
        await coreApi(`/customers/${customer.id}/reject`, {
          method: 'PATCH',
          userId,
          body: JSON.stringify({ reason: reviewNote.trim() }),
        });
        setSuccess('运营开户审核已拒绝');
      }
      setReviewAction(null);
      setReviewNote('');
      await load();
    } catch (caught) {
      setLoadError(caught instanceof Error ? caught.message : '审核操作失败');
    } finally {
      setReviewing(false);
    }
  };

  const saveFee = async () => {
    if (!customer || !editingFee) return;
    setFeeSaving(true);
    setLoadError('');
    try {
      if (editingFee.override) {
        await coreApi(`/withdrawal-fees/${editingFee.override.id}`, {
          method: 'PATCH',
          userId,
          body: JSON.stringify({
            amount: editingFee.amount,
            active: true,
            version: editingFee.override.version,
          }),
        });
      } else {
        await coreApi('/withdrawal-fees', {
          method: 'POST',
          userId,
          body: JSON.stringify({
            organizationId: customer.organizationId,
            customerId: customer.id,
            assetClass: editingFee.feeScope.assetClass,
            currency: editingFee.feeScope.currency,
            method: editingFee.feeScope.method,
            channelCode: editingFee.feeScope.channelCode,
            network: editingFee.feeScope.network,
            amount: editingFee.amount,
            active: true,
          }),
        });
      }
      setEditingFee(null);
      setSuccess('客户专属手续费已保存；仅影响之后的新提交');
      await load();
    } catch (caught) {
      setLoadError(caught instanceof Error ? caught.message : '手续费保存失败');
    } finally {
      setFeeSaving(false);
    }
  };

  const disableFee = async (rule: WithdrawalFeeRule) => {
    setFeeSaving(true);
    setLoadError('');
    try {
      await coreApi(`/withdrawal-fees/${rule.id}`, {
        method: 'PATCH',
        userId,
        body: JSON.stringify({ active: false, version: rule.version }),
      });
      setSuccess('客户专属手续费已停用，后续提交恢复机构默认值');
      await load();
    } catch (caught) {
      setLoadError(caught instanceof Error ? caught.message : '手续费停用失败');
    } finally {
      setFeeSaving(false);
    }
  };

  const submitVaRequest = async () => {
    if (!customer || !vaChannelId || !vaPurpose.trim()) return;
    setVaSubmitting(true);
    setLoadError('');
    try {
      await coreApi(`/customers/${customer.id}/virtual-account-requests`, {
        method: 'POST',
        userId,
        body: JSON.stringify({
          channelId: vaChannelId,
          currency: vaCurrency,
          purpose: vaPurpose.trim(),
        }),
      });
      setVaRequestOpen(false);
      setSuccess('VA 申请已提交，等待管理员审批并录入银行账号');
      await load();
      setTab('accounts');
    } catch (caught) {
      setLoadError(caught instanceof Error ? caught.message : 'VA 申请提交失败');
    } finally {
      setVaSubmitting(false);
    }
  };

  if (loading && !customer) {
    return (
      <Box sx={{ minHeight: 520, display: 'grid', placeItems: 'center' }}>
        <Stack alignItems="center" spacing={1.5}>
          <CircularProgress size={30} />
          <Typography color="text.secondary">正在加载客户全景…</Typography>
        </Stack>
      </Box>
    );
  }

  if (!customer) {
    return (
      <Container maxWidth="lg">
        <Alert
          severity="error"
          action={
            <Button onClick={() => navigate(paths.dashboard.customers.root)}>返回客户管理</Button>
          }
        >
          {loadError || '未找到客户'}
        </Alert>
      </Container>
    );
  }

  const activeOverrides = feeRules.filter(
    (rule) => rule.scope === 'CUSTOMER' && rule.active
  ).length;
  const activeVaChannels = fundingChannels.filter(
    (channel) => channel.active && channel.type === 'VIRTUAL_ACCOUNT'
  );
  const selectedVaChannel = activeVaChannels.find((channel) => channel.id === vaChannelId);

  return (
    <>
      <Helmet>
        <title>{customer.displayName} | 客户详情 | SSC Digital Bank</title>
      </Helmet>
      <Container maxWidth="xl">
        <Stack spacing={2.25}>
          <Stack direction={{ xs: 'column', md: 'row' }} justifyContent="space-between" gap={1.5}>
            <Box>
              <Button
                color="inherit"
                startIcon={<Iconify icon="solar:arrow-left-linear" />}
                onClick={() => navigate(paths.dashboard.customers.root)}
                sx={{ ml: -1, mb: 0.75 }}
              >
                返回客户管理
              </Button>
              <Typography
                sx={{
                  fontSize: 12,
                  fontWeight: 800,
                  letterSpacing: '0.14em',
                  color: 'primary.main',
                }}
              >
                CUSTOMER COMMAND CENTER
              </Typography>
              <Typography
                sx={{
                  mt: 0.35,
                  fontSize: { xs: 27, md: 34 },
                  fontWeight: 760,
                  letterSpacing: '-0.045em',
                }}
              >
                客户详情
              </Typography>
            </Box>
            <Stack direction="row" spacing={1} alignItems="flex-end">
              <Button
                variant="outlined"
                color="inherit"
                startIcon={<Iconify icon="solar:document-text-bold" />}
                onClick={() => window.print()}
              >
                客户报告
              </Button>
              <Button
                variant="contained"
                startIcon={<Iconify icon="solar:bolt-bold" />}
                onClick={(event) => setActionAnchor(event.currentTarget)}
              >
                发起操作
              </Button>
            </Stack>
          </Stack>

          {loadError && (
            <Alert severity="error" onClose={() => setLoadError('')}>
              {loadError}
            </Alert>
          )}
          {partialErrors.length > 0 && (
            <Alert severity="warning">部分数据未能加载：{partialErrors.join('；')}</Alert>
          )}

          <Paper sx={{ ...panelSx, overflow: 'hidden' }}>
            <Box sx={{ p: { xs: 2, md: 2.75 } }}>
              <CustomerIdentity customer={customer} />
            </Box>
            <Divider />
            <Tabs
              value={tab}
              onChange={(_, value: DetailTab) => setTab(value)}
              variant="scrollable"
              scrollButtons="auto"
              sx={{ px: 2 }}
            >
              {tabLabels.map((item) => (
                <Tab key={item.value} value={item.value} label={item.label} />
              ))}
            </Tabs>
          </Paper>

          {tab === 'overview' && (
            <Box
              sx={{
                display: 'grid',
                gridTemplateColumns: { xs: '1fr', lg: 'minmax(0, 1.7fr) 320px' },
                gap: 2.25,
                alignItems: 'start',
              }}
            >
              <Stack spacing={2.25}>
                <Paper sx={{ ...panelSx, overflow: 'hidden' }}>
                  <Box sx={{ px: 2.25, pt: 2, pb: 1 }}>
                    <Typography variant="overline" color="text.secondary">
                      资金全景
                    </Typography>
                    <Typography variant="h6">账户余额</Typography>
                  </Box>
                  <BalanceStrip customer={customer} />
                </Paper>
                <Paper sx={{ ...panelSx, overflow: 'hidden' }}>
                  <Stack
                    direction="row"
                    justifyContent="space-between"
                    alignItems="center"
                    sx={{ p: 2.25 }}
                  >
                    <Box>
                      <Typography variant="overline" color="text.secondary">
                        最近记录
                      </Typography>
                      <Typography variant="h6">交易与操作</Typography>
                    </Box>
                    <Button
                      size="small"
                      onClick={() => setTab('transactions')}
                      endIcon={<Iconify icon="solar:arrow-right-linear" />}
                    >
                      查看全部
                    </Button>
                  </Stack>
                  <OperationsTable rows={operations.slice(0, 5)} />
                </Paper>
              </Stack>
              <Stack spacing={2.25}>
                <Paper sx={{ ...panelSx, p: 2.25 }}>
                  <Typography variant="overline" color="text.secondary">
                    当前状态
                  </Typography>
                  <Typography variant="h6" sx={{ mb: 2 }}>
                    风险与合规
                  </Typography>
                  <Stack spacing={1.6}>
                    <StatusLine label="KYC 状态" value={kycStatusText(customer.kycStatus)} />
                    <StatusLine label="客户状态" value={customerStatusText(customer.status)} />
                    <StatusLine label="账户数量" value={`${customer.accounts.length} 个`} />
                    <StatusLine
                      label="收款人"
                      value={`${customer.beneficiaries?.length || 0} 个`}
                    />
                  </Stack>
                  {customer.status === 'PENDING_REVIEW' && customer.kycStatus === 'PENDING' && (
                    <Button
                      fullWidth
                      variant="contained"
                      sx={{ mt: 2 }}
                      endIcon={<Iconify icon="solar:arrow-right-linear" />}
                      onClick={() => navigate(paths.dashboard.onboardingReview(customer.id))}
                    >
                      进入 KYC 审核
                    </Button>
                  )}
                  {customer.status === 'PENDING_REVIEW' && customer.kycStatus === 'APPROVED' && (
                    <Stack spacing={1} sx={{ mt: 2 }}>
                      {IS_NEOBANK_DEPLOYMENT ? (
                        <Alert severity="warning">
                          KYC 已通过但开户仍在同步。请刷新状态；若持续不变，检查自动开户与 Core
                          同步日志。
                        </Alert>
                      ) : (
                        <Button variant="contained" onClick={() => setReviewAction('ACTIVATE')}>
                          运营批准开户
                        </Button>
                      )}
                      {!IS_NEOBANK_DEPLOYMENT && (
                        <Button
                          color="error"
                          variant="outlined"
                          onClick={() => setReviewAction('REJECT_ACCOUNT')}
                        >
                          拒绝开户
                        </Button>
                      )}
                    </Stack>
                  )}
                </Paper>
                <Paper sx={{ ...panelSx, p: 2.25 }}>
                  <Typography variant="overline" color="text.secondary">
                    专属配置
                  </Typography>
                  <Typography variant="h6">手续费覆盖</Typography>
                  <Divider sx={{ my: 1.75 }} />
                  <Typography sx={{ fontSize: 27, fontWeight: 750 }}>{activeOverrides}</Typography>
                  <Typography variant="body2" color="text.secondary">
                    条客户专属规则正在生效
                  </Typography>
                  <Button
                    fullWidth
                    variant="outlined"
                    color="inherit"
                    sx={{ mt: 2 }}
                    onClick={() => setTab('fees')}
                  >
                    管理客户规则
                  </Button>
                </Paper>
              </Stack>
            </Box>
          )}

          {tab === 'profile' && (
            <Stack spacing={2.25}>
              <Paper sx={{ ...panelSx, overflow: 'hidden' }}>
                <Box sx={{ px: 2.25, py: 1.8, bgcolor: 'action.hover' }}>
                  <Typography variant="h6">客户主档</Typography>
                </Box>
                <InfoGrid customer={customer} />
              </Paper>
              <Paper sx={{ ...panelSx, p: 2.25 }}>
                <Typography variant="h6">KYC 审核</Typography>
                <Stack direction={{ xs: 'column', md: 'row' }} spacing={4} sx={{ mt: 2 }}>
                  <StatusLine label="审核状态" value={kycStatusText(customer.kycStatus)} />
                  <StatusLine label="审核时间" value={formatDate(customer.kycReviewedAt)} />
                  <StatusLine label="审核人" value={customer.kycReviewerId || '-'} />
                </Stack>
                <Typography variant="body2" color="text.secondary" sx={{ mt: 2 }}>
                  {customer.kycReviewNote || '暂无审核备注'}
                </Typography>
                <Button
                  variant="outlined"
                  sx={{ mt: 2 }}
                  endIcon={<Iconify icon="solar:arrow-right-linear" />}
                  onClick={() => navigate(paths.dashboard.onboardingReview(customer.id))}
                >
                  查看 KYC 审核记录
                </Button>
              </Paper>
            </Stack>
          )}

          {tab === 'accounts' && (
            <Stack spacing={2.25}>
              <Paper data-testid="account-asset-overview" sx={{ ...panelSx, overflow: 'hidden' }}>
                <Box sx={{ px: 2.25, py: 1.8 }}>
                  <Stack
                    direction={{ xs: 'column', sm: 'row' }}
                    justifyContent="space-between"
                    alignItems={{ sm: 'flex-start' }}
                    gap={1}
                  >
                    <Box>
                      <Typography variant="h6">账户与钱包</Typography>
                      <Typography variant="body2" color="text.secondary" sx={{ mt: 0.4 }}>
                        先看分币种资产全貌，再按三类账户核对资金来源和账户资料。
                      </Typography>
                    </Box>
                    <Typography variant="caption" color="text.secondary" sx={{ flexShrink: 0 }}>
                      账本快照更新于 {formatDate(customer.updatedAt)}
                    </Typography>
                  </Stack>
                </Box>
                <AccountAssetOverview
                  customer={customer}
                  wallets={wallets}
                  vaRequests={vaRequests}
                />
              </Paper>
              <Paper sx={{ ...panelSx, overflow: 'hidden' }}>
                <Box sx={{ px: 2.25, py: 1.8 }}>
                  <Typography variant="h6">VA 申请记录</Typography>
                </Box>
                <VaTable rows={vaRequests} />
              </Paper>
            </Stack>
          )}

          {tab === 'transactions' && (
            <Stack spacing={2.25}>
              <Paper sx={{ ...panelSx, overflow: 'hidden' }}>
                <Box sx={{ px: 2.25, py: 1.8 }}>
                  <Typography variant="h6">全部法币与运营操作</Typography>
                  <Typography variant="caption" color="text.secondary">
                    共 {operations.length} 条
                  </Typography>
                </Box>
                <OperationsTable rows={operations} />
              </Paper>
              <Paper sx={{ ...panelSx, overflow: 'hidden' }}>
                <Box sx={{ px: 2.25, py: 1.8 }}>
                  <Typography variant="h6">数字资产流水</Typography>
                  <Typography variant="caption" color="text.secondary">
                    共 {cryptoTransfers.length} 条
                  </Typography>
                </Box>
                <CryptoTransferTable rows={cryptoTransfers} />
              </Paper>
            </Stack>
          )}

          {tab === 'fees' && (
            <Paper sx={{ ...panelSx, overflow: 'hidden' }}>
              <Box sx={{ p: 2.25 }}>
                <Stack
                  direction={{ xs: 'column', sm: 'row' }}
                  justifyContent="space-between"
                  alignItems={{ sm: 'flex-start' }}
                  gap={1.5}
                >
                  <Box>
                    <Typography variant="h6">客户专属手续费</Typography>
                    <Typography variant="body2" color="text.secondary" sx={{ mt: 0.6 }}>
                      法币与数字货币转出均按“机构默认 →
                      客户专属”生效。变更只影响之后的新提交，历史交易保留原费用和规则版本快照。
                    </Typography>
                  </Box>
                  <Button
                    variant="outlined"
                    size="small"
                    startIcon={<Iconify icon={ACTION_ICONS.settings} />}
                    onClick={() => navigate(paths.dashboard.fundingChannels)}
                    sx={{ flex: '0 0 auto' }}
                  >
                    管理机构默认
                  </Button>
                </Stack>
              </Box>
              <FeeTable
                rows={customerFeeRows}
                overrides={overridesByKey}
                saving={feeSaving}
                onEdit={(feeScope, override) =>
                  setEditingFee({
                    feeScope,
                    override,
                    amount: override?.amount || feeScope.defaultRule?.amount || '',
                  })
                }
                onDisable={(rule) => disableFee(rule).catch(() => undefined)}
                onManageDefaults={() => navigate(paths.dashboard.fundingChannels)}
              />
            </Paper>
          )}

          {tab === 'audit' && (
            <Paper sx={{ ...panelSx, p: { xs: 2, md: 3 } }}>
              <Typography variant="h6" sx={{ mb: 3 }}>
                客户审计时间线
              </Typography>
              <AuditTimeline events={auditEvents} />
            </Paper>
          )}
        </Stack>
      </Container>

      <Menu
        anchorEl={actionAnchor}
        open={Boolean(actionAnchor)}
        onClose={() => setActionAnchor(null)}
      >
        <MenuItem
          onClick={() => {
            setActionAnchor(null);
            setVaRequestOpen(true);
          }}
        >
          <Iconify icon="solar:card-2-bold-duotone" width={19} sx={{ mr: 1.2 }} />
          申请客户 VA
        </MenuItem>
        <MenuItem
          onClick={() =>
            navigate(`${paths.dashboard.fundOperations.deposits}?customerId=${customer.id}`)
          }
        >
          <Iconify icon="solar:download-minimalistic-bold-duotone" width={19} sx={{ mr: 1.2 }} />
          录入客户入账
        </MenuItem>
        <MenuItem
          onClick={() =>
            navigate(`${paths.dashboard.fundOperations.withdrawals}?customerId=${customer.id}`)
          }
        >
          <Iconify icon="solar:upload-minimalistic-bold-duotone" width={19} sx={{ mr: 1.2 }} />
          发起客户出款
        </MenuItem>
        <MenuItem
          onClick={() => navigate(`${paths.dashboard.fundOperations.fx}?customerId=${customer.id}`)}
        >
          <Iconify icon="solar:refresh-circle-bold-duotone" width={19} sx={{ mr: 1.2 }} />
          发起法币换汇
        </MenuItem>
      </Menu>

      <ReviewDialog
        action={reviewAction}
        note={reviewNote}
        reviewing={reviewing}
        onNoteChange={setReviewNote}
        onClose={() => setReviewAction(null)}
        onSubmit={() => submitReview().catch(() => undefined)}
      />

      <Dialog
        open={vaRequestOpen}
        onClose={() => !vaSubmitting && setVaRequestOpen(false)}
        fullWidth
        maxWidth="sm"
      >
        <DialogTitle>申请客户 VA</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ mt: 1 }}>
            <Alert severity="info">
              此操作只创建 VA 申请，不会生成银行账号或改变客户余额。银行账号仍需审批后录入。
            </Alert>
            {!activeVaChannels.length && (
              <Alert severity="warning">当前没有可用的 VA 银行渠道，无法提交申请。</Alert>
            )}
            <TextField
              select
              fullWidth
              required
              label="银行渠道"
              value={vaChannelId}
              disabled={!activeVaChannels.length}
              onChange={(event) => {
                const nextChannelId = event.target.value;
                const nextChannel = activeVaChannels.find(
                  (channel) => channel.id === nextChannelId
                );
                setVaChannelId(nextChannelId);
                if (
                  nextChannel?.supportedCurrencies[0] &&
                  !nextChannel.supportedCurrencies.includes(vaCurrency)
                ) {
                  setVaCurrency(nextChannel.supportedCurrencies[0]);
                }
              }}
            >
              {activeVaChannels.map((channel) => (
                <MenuItem key={channel.id} value={channel.id}>
                  {channel.settlementBankName || channel.name}
                </MenuItem>
              ))}
            </TextField>
            <TextField
              select
              fullWidth
              required
              label="币种"
              value={vaCurrency}
              disabled={!selectedVaChannel}
              onChange={(event) => setVaCurrency(event.target.value as Currency)}
            >
              {(selectedVaChannel?.supportedCurrencies || []).map((currency) => (
                <MenuItem key={currency} value={currency}>
                  {currency}
                </MenuItem>
              ))}
            </TextField>
            <TextField
              fullWidth
              required
              label="申请用途"
              value={vaPurpose}
              onChange={(event) => setVaPurpose(event.target.value)}
              inputProps={{ maxLength: 240 }}
            />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setVaRequestOpen(false)} disabled={vaSubmitting}>
            取消
          </Button>
          <Button
            variant="contained"
            disabled={vaSubmitting || !vaChannelId || !vaPurpose.trim()}
            onClick={() => submitVaRequest().catch(() => undefined)}
          >
            {vaSubmitting ? '提交中…' : '提交申请'}
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog
        open={Boolean(editingFee)}
        onClose={() => !feeSaving && setEditingFee(null)}
        fullWidth
        maxWidth="xs"
      >
        <DialogTitle>设置客户专属手续费</DialogTitle>
        <DialogContent>
          {editingFee && (
            <Stack spacing={2} sx={{ mt: 1 }}>
              <Alert severity="info">
                {feeServiceName(editingFee.feeScope)} ·{' '}
                {editingFee.feeScope.defaultRule?.active
                  ? `机构默认 ${editingFee.feeScope.defaultRule.amount} ${editingFee.feeScope.currency}`
                  : '机构默认尚未启用；保存客户专属规则后，仅该客户可以使用此费率'}
              </Alert>
              <TextField
                autoFocus
                fullWidth
                label={`客户手续费（${editingFee.feeScope.currency}）`}
                value={editingFee.amount}
                onChange={(event) => setEditingFee({ ...editingFee, amount: event.target.value })}
                error={
                  Boolean(editingFee.amount) &&
                  !validFeeAmount(editingFee.amount, editingFee.feeScope.currency)
                }
                helperText={`固定金额，不得为负；最多 ${currencyDecimals(
                  editingFee.feeScope.currency
                )} 位小数。`}
                inputProps={{ inputMode: 'decimal' }}
              />
              <Typography variant="caption" color="text.secondary">
                保存时使用当前版本进行并发校验；如其他管理员已更新，系统会要求重新加载后再确认。
              </Typography>
            </Stack>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setEditingFee(null)} disabled={feeSaving}>
            取消
          </Button>
          <Button
            variant="contained"
            onClick={() => saveFee().catch(() => undefined)}
            disabled={
              feeSaving ||
              !editingFee ||
              !validFeeAmount(editingFee.amount, editingFee.feeScope.currency)
            }
          >
            {feeSaving ? '保存中…' : '保存规则'}
          </Button>
        </DialogActions>
      </Dialog>

      <Snackbar
        open={Boolean(success)}
        autoHideDuration={3200}
        onClose={() => setSuccess('')}
        message={success}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      />
    </>
  );
}

function operationStatusText(status: string) {
  const labels: Record<string, string> = {
    SUBMITTED: '待审批',
    APPROVED: '已批准',
    REJECTED: '已拒绝',
    COMPLETED: '已完成',
    FAILED: '失败',
    CANCELLED: '已取消',
    PROCESSING: '处理中',
  };
  return labels[status] || status;
}

function StatusLine({ label, value }: { label: string; value: string }) {
  return (
    <Stack direction="row" justifyContent="space-between" spacing={2} sx={{ minWidth: 0 }}>
      <Typography variant="body2" color="text.secondary">
        {label}
      </Typography>
      <Typography
        variant="body2"
        fontWeight={700}
        sx={{ textAlign: 'right', wordBreak: 'break-word' }}
      >
        {value}
      </Typography>
    </Stack>
  );
}

function formattedAssetBalance(value: string, currency: Currency) {
  const decimals = currencyDecimals(currency);
  return formatScaledDigits(toScaledDigits(value, decimals), decimals);
}

function totalAssetBalance(available: string, frozen: string, currency: Currency) {
  const decimals = currencyDecimals(currency);
  return formatScaledDigits(
    addDigitStrings(toScaledDigits(available, decimals), toScaledDigits(frozen, decimals)),
    decimals
  );
}

type BalanceSource = {
  currency: Currency;
  availableBalance: string;
  frozenBalance: string;
  status: string;
};

type AssetBalanceSnapshot = {
  currency: Currency;
  available: string;
  frozen: string;
  count: number;
  unavailableCount: number;
};

const assetCurrencyOrder: Currency[] = ['USD', 'HKD', 'USDT', 'SGD', 'EUR', 'GBP'];

function balanceSnapshots(items: BalanceSource[]): AssetBalanceSnapshot[] {
  const sumValues = (currency: Currency, values: string[]) => {
    const decimals = currencyDecimals(currency);
    let total = '0';
    values.forEach((value) => {
      total = addDigitStrings(total, toScaledDigits(value, decimals));
    });
    return formatScaledDigits(total, decimals).replace(/,/g, '');
  };

  const snapshots = assetCurrencyOrder
    .map((currency) => {
      const matching = items.filter((item) => item.currency === currency);
      return {
        currency,
        available: sumValues(
          currency,
          matching.map((item) => item.availableBalance)
        ),
        frozen: sumValues(
          currency,
          matching.map((item) => item.frozenBalance)
        ),
        count: matching.length,
        unavailableCount: matching.filter((item) => item.status !== 'ACTIVE').length,
      };
    })
    .filter((snapshot) => snapshot.count > 0);
  return snapshots;
}

function hasBalance(value: string, currency: Currency) {
  return toScaledDigits(value, currencyDecimals(currency)) !== '0';
}

function AssetSnapshotCard({ snapshot }: { snapshot: AssetBalanceSnapshot }) {
  const frozen = hasBalance(snapshot.frozen, snapshot.currency);
  let status = <Label color="success">状态正常</Label>;
  if (frozen) status = <Label color="warning">含冻结</Label>;
  if (snapshot.unavailableCount) {
    status = <Label color="error">{snapshot.unavailableCount} 个状态异常</Label>;
  }

  return (
    <Box
      sx={{
        p: 1.75,
        minWidth: 0,
        border: '1px solid',
        borderColor: 'divider',
        borderRadius: 1.25,
        bgcolor: 'background.paper',
      }}
    >
      <Stack direction="row" alignItems="center" justifyContent="space-between" spacing={1.5}>
        <Stack direction="row" alignItems="center" spacing={1}>
          <AssetIcon asset={snapshot.currency} size={28} />
          <Box>
            <Typography variant="subtitle2">{snapshot.currency} 资产</Typography>
            <Typography variant="caption" color="text.secondary">
              {snapshot.count} 个资金账户
            </Typography>
          </Box>
        </Stack>
        {status}
      </Stack>

      <Typography
        sx={{ mt: 1.5, fontSize: { xs: 22, md: 25 }, fontWeight: 780, letterSpacing: '-0.035em' }}
      >
        {totalAssetBalance(snapshot.available, snapshot.frozen, snapshot.currency)}
        <Typography component="span" variant="caption" color="text.secondary" fontWeight={750}>
          {' '}
          {snapshot.currency}
        </Typography>
      </Typography>

      <Stack
        direction="row"
        divider={<Divider orientation="vertical" flexItem />}
        spacing={1.5}
        sx={{ mt: 1.25 }}
      >
        <Box sx={{ minWidth: 0, flex: 1 }}>
          <Typography variant="caption" color="text.secondary">
            可用
          </Typography>
          <Typography variant="body2" fontWeight={750} noWrap>
            {formattedAssetBalance(snapshot.available, snapshot.currency)}
          </Typography>
        </Box>
        <Box sx={{ minWidth: 0, flex: 1 }}>
          <Typography variant="caption" color="text.secondary">
            冻结
          </Typography>
          <Typography
            variant="body2"
            fontWeight={750}
            color={frozen ? 'warning.dark' : 'text.primary'}
            noWrap
          >
            {formattedAssetBalance(snapshot.frozen, snapshot.currency)}
          </Typography>
        </Box>
      </Stack>
    </Box>
  );
}

function CustomerAssetSnapshot({ snapshots }: { snapshots: AssetBalanceSnapshot[] }) {
  return (
    <Box
      data-testid="customer-asset-snapshot"
      sx={{ px: { xs: 1.5, md: 2.25 }, py: 2, bgcolor: 'background.neutral' }}
    >
      <Stack
        direction={{ xs: 'column', sm: 'row' }}
        justifyContent="space-between"
        alignItems={{ sm: 'center' }}
        gap={0.75}
        sx={{ mb: 1.5 }}
      >
        <Box>
          <Typography variant="subtitle1" fontWeight={750}>
            分币种资产快照
          </Typography>
          <Typography variant="caption" color="text.secondary">
            汇总系统余额、VA 与数字货币钱包；不同币种不合并估值。
          </Typography>
        </Box>
        <Label color="default">账面资产 = 可用 + 冻结</Label>
      </Stack>
      <Box
        sx={{
          display: 'grid',
          gridTemplateColumns: {
            xs: '1fr',
            sm: 'repeat(2, minmax(0, 1fr))',
            lg: 'repeat(3, minmax(0, 1fr))',
          },
          gap: 1.25,
        }}
      >
        {snapshots.map((snapshot) => (
          <AssetSnapshotCard key={snapshot.currency} snapshot={snapshot} />
        ))}
      </Box>
    </Box>
  );
}

function AssetColumn({
  title,
  description,
  icon,
  count,
  snapshots,
  children,
}: {
  title: string;
  description: string;
  icon: string;
  count: number;
  snapshots: AssetBalanceSnapshot[];
  children: React.ReactNode;
}) {
  return (
    <Box sx={{ minWidth: 0 }}>
      <Stack
        direction="row"
        alignItems="center"
        justifyContent="space-between"
        spacing={1.5}
        sx={{
          px: 2.25,
          py: 2,
          bgcolor: 'action.hover',
          borderBottom: '1px solid',
          borderColor: 'divider',
        }}
      >
        <Stack direction="row" spacing={1.25} alignItems="center" sx={{ minWidth: 0 }}>
          <Box
            sx={{
              width: 40,
              height: 40,
              flexShrink: 0,
              borderRadius: '50%',
              bgcolor: 'background.paper',
              display: 'grid',
              placeItems: 'center',
              border: '1px solid',
              borderColor: 'divider',
            }}
          >
            <Iconify icon={icon} width={23} />
          </Box>
          <Box sx={{ minWidth: 0 }}>
            <Typography variant="subtitle1" fontWeight={750}>
              {title}
            </Typography>
            <Typography variant="caption" color="text.secondary">
              {description}
            </Typography>
          </Box>
        </Stack>
        <Stack
          direction="row"
          alignItems="center"
          justifyContent="flex-end"
          flexWrap="wrap"
          useFlexGap
          gap={1}
        >
          {snapshots.map((snapshot) => (
            <Typography key={snapshot.currency} variant="body2" fontWeight={750} noWrap>
              {snapshot.currency}{' '}
              {totalAssetBalance(snapshot.available, snapshot.frozen, snapshot.currency)}
            </Typography>
          ))}
          <Label color={count ? 'info' : 'default'}>{count} 个账户</Label>
        </Stack>
      </Stack>
      <Box
        sx={{
          display: 'grid',
          gridTemplateColumns: { xs: '1fr', md: 'repeat(auto-fit, minmax(280px, 1fr))' },
          gap: 1.5,
          p: { xs: 1.5, md: 2 },
          bgcolor: 'background.paper',
        }}
      >
        {children}
      </Box>
    </Box>
  );
}

function BalanceSummary({
  currency,
  available,
  frozen,
}: {
  currency: Currency;
  available: string;
  frozen: string;
}) {
  return (
    <Box sx={{ mt: 1.75 }}>
      <Typography variant="caption" color="text.secondary">
        账面资产
      </Typography>
      <Typography sx={{ mt: 0.15, fontSize: 22, fontWeight: 780, letterSpacing: '-0.03em' }}>
        {totalAssetBalance(available, frozen, currency)}{' '}
        <Typography component="span" variant="caption" color="text.secondary" fontWeight={750}>
          {currency}
        </Typography>
      </Typography>
      <Box
        sx={{
          display: 'grid',
          gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
          mt: 1.25,
          py: 1.1,
          borderTop: '1px solid',
          borderBottom: '1px solid',
          borderColor: 'divider',
        }}
      >
        <Box sx={{ pr: 1.25 }}>
          <Typography variant="caption" color="text.secondary">
            可用
          </Typography>
          <Typography variant="body2" fontWeight={750} noWrap>
            {formattedAssetBalance(available, currency)}
          </Typography>
        </Box>
        <Box sx={{ pl: 1.25, borderLeft: '1px solid', borderColor: 'divider' }}>
          <Typography variant="caption" color="text.secondary">
            冻结
          </Typography>
          <Typography
            variant="body2"
            fontWeight={750}
            color={hasBalance(frozen, currency) ? 'warning.dark' : 'text.primary'}
            noWrap
          >
            {formattedAssetBalance(frozen, currency)}
          </Typography>
        </Box>
      </Box>
    </Box>
  );
}

function AccountFact({
  label,
  value,
  wide = false,
}: {
  label: string;
  value: string;
  wide?: boolean;
}) {
  return (
    <Box sx={{ minWidth: 0, gridColumn: wide ? '1 / -1' : 'auto' }}>
      <Typography variant="caption" color="text.secondary">
        {label}
      </Typography>
      <Typography
        variant="body2"
        fontWeight={650}
        sx={{ mt: 0.15, wordBreak: wide ? 'break-all' : 'break-word' }}
      >
        {value}
      </Typography>
    </Box>
  );
}

function FiatAccountAsset({ account }: { account: MoneyAccount }) {
  const isVa = account.kind === 'VIRTUAL_ACCOUNT';
  return (
    <Box
      sx={{
        p: 2,
        minWidth: 0,
        border: '1px solid',
        borderColor: 'divider',
        borderRadius: 1.25,
        bgcolor: 'background.paper',
      }}
    >
      <Stack direction="row" justifyContent="space-between" spacing={1.5} alignItems="flex-start">
        <Stack direction="row" spacing={1.15} alignItems="center" sx={{ minWidth: 0 }}>
          <AssetIcon asset={account.currency} size={28} />
          <Box sx={{ minWidth: 0 }}>
            <Typography variant="subtitle2" noWrap>
              {account.name}
            </Typography>
            <Typography variant="caption" color="text.secondary">
              {account.currency} · {isVa ? '专属收款账户' : SYSTEM_WALLET_PRODUCT_NAME}
            </Typography>
          </Box>
        </Stack>
        {operationStatus(account.status)}
      </Stack>

      <BalanceSummary
        currency={account.currency}
        available={account.availableBalance}
        frozen={account.frozenBalance}
      />

      <Box
        sx={{
          display: 'grid',
          gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, minmax(0, 1fr))' },
          gap: 1.15,
          mt: 1.5,
        }}
      >
        {isVa && <AccountFact label="开户银行" value={account.bankName || '银行资料待同步'} />}
        {isVa && <AccountFact label="银行国家/地区" value={account.bankCountry || '-'} />}
        <AccountFact
          label={isVa ? '收款账号' : `${SYSTEM_WALLET_PRODUCT_NAME}编号`}
          value={account.accountNumber || '账户编号待分配'}
          wide={!isVa}
        />
        {isVa && account.iban && <AccountFact label="IBAN" value={account.iban} wide />}
        {isVa && account.swiftBic && <AccountFact label="SWIFT / BIC" value={account.swiftBic} />}
      </Box>
    </Box>
  );
}

function CryptoWalletAsset({ wallet }: { wallet: CryptoWallet }) {
  return (
    <Box
      sx={{
        p: 2,
        minWidth: 0,
        border: '1px solid',
        borderColor: 'divider',
        borderRadius: 1.25,
        bgcolor: 'background.paper',
      }}
    >
      <Stack direction="row" justifyContent="space-between" spacing={1.5} alignItems="flex-start">
        <Stack direction="row" spacing={1.15} alignItems="center" sx={{ minWidth: 0 }}>
          <AssetIcon asset={wallet.asset} network={wallet.network} size={30} />
          <Box sx={{ minWidth: 0 }}>
            <Typography variant="subtitle2">
              {wallet.asset} · {wallet.networkLabel}
            </Typography>
            <Typography variant="caption" color="text.secondary">
              {wallet.tokenStandard} 数字货币钱包
            </Typography>
          </Box>
        </Stack>
        {operationStatus(wallet.status)}
      </Stack>

      <BalanceSummary
        currency={wallet.asset}
        available={wallet.availableBalance}
        frozen={wallet.frozenBalance}
      />

      <Box
        sx={{
          display: 'grid',
          gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, minmax(0, 1fr))' },
          gap: 1.15,
          mt: 1.5,
        }}
      >
        <AccountFact label="链上地址" value={wallet.walletAddress || '链上地址待生成'} wide />
        <AccountFact label="托管渠道" value={wallet.custodyProvider || '-'} />
        <AccountFact label="网络标准" value={`${wallet.networkLabel} · ${wallet.tokenStandard}`} />
        <AccountFact
          label="最低充值"
          value={`${formattedAssetBalance(wallet.minimumDeposit, wallet.asset)} ${wallet.asset}`}
        />
        <AccountFact
          label="转出手续费"
          value={`${formattedAssetBalance(wallet.withdrawalFee, wallet.asset)} ${wallet.asset}`}
        />
      </Box>
    </Box>
  );
}

function AssetEmptyState({ icon, title, detail }: { icon: string; title: string; detail: string }) {
  return (
    <Stack alignItems="center" textAlign="center" spacing={0.8} sx={{ px: 2.5, py: 5 }}>
      <Iconify icon={icon} width={36} sx={{ color: 'text.disabled' }} />
      <Typography variant="subtitle2">{title}</Typography>
      <Typography variant="caption" color="text.secondary" sx={{ maxWidth: 260 }}>
        {detail}
      </Typography>
    </Stack>
  );
}

function AccountAssetOverview({
  customer,
  wallets,
  vaRequests,
}: {
  customer: Customer;
  wallets: CryptoWallet[];
  vaRequests: VirtualAccountRequest[];
}) {
  const systemAccounts = customer.accounts.filter((account) => account.kind === 'SYSTEM_WALLET');
  const vaAccounts = customer.accounts.filter((account) => account.kind === 'VIRTUAL_ACCOUNT');
  const pendingVaCount = vaRequests.filter((request) => request.status === 'SUBMITTED').length;
  const walletBalances: BalanceSource[] = wallets.map((wallet) => ({
    currency: wallet.asset,
    availableBalance: wallet.availableBalance,
    frozenBalance: wallet.frozenBalance,
    status: wallet.status,
  }));
  const systemSnapshots = balanceSnapshots(systemAccounts);
  const vaSnapshots = balanceSnapshots(vaAccounts);
  const cryptoSnapshots = balanceSnapshots(walletBalances);
  const customerSnapshots = balanceSnapshots([...systemAccounts, ...vaAccounts, ...walletBalances]);

  return (
    <Box sx={{ borderTop: '1px solid', borderColor: 'divider' }}>
      <CustomerAssetSnapshot snapshots={customerSnapshots} />
      <Stack data-testid="account-asset-rows" divider={<Divider flexItem />}>
        <AssetColumn
          title={SYSTEM_WALLET_PRODUCT_NAME}
          description="平台账本中的 USD / HKD 法币余额"
          icon={ACTION_ICONS.accounts}
          count={systemAccounts.length}
          snapshots={systemSnapshots}
        >
          {systemAccounts.length ? (
            systemAccounts.map((account) => <FiatAccountAsset key={account.id} account={account} />)
          ) : (
            <AssetEmptyState
              icon="solar:wallet-money-linear"
              title={`${SYSTEM_WALLET_PRODUCT_NAME}尚未同步`}
              detail={`KYC 开户完成后应自动分配 USD 与 HKD ${SYSTEM_WALLET_PRODUCT_NAME}。`}
            />
          )}
        </AssetColumn>

        <AssetColumn
          title="VA 钱包"
          description="银行分配的专属收款账户与法币资产"
          icon="solar:buildings-2-bold-duotone"
          count={vaAccounts.length}
          snapshots={vaSnapshots}
        >
          {vaAccounts.length ? (
            vaAccounts.map((account) => <FiatAccountAsset key={account.id} account={account} />)
          ) : (
            <AssetEmptyState
              icon="solar:buildings-linear"
              title={pendingVaCount ? `${pendingVaCount} 笔 VA 申请处理中` : '尚未开通 VA 钱包'}
              detail={
                pendingVaCount
                  ? '银行实际账号回执录入后，账户与对应资产会显示在这里。'
                  : '客户提交 VA 申请并由运营录入银行实际账号后显示。'
              }
            />
          )}
        </AssetColumn>

        <AssetColumn
          title="数字货币钱包"
          description="托管的 USDT-TRON 链上钱包与资产"
          icon={ACTION_ICONS.cryptoWallet}
          count={wallets.length}
          snapshots={cryptoSnapshots}
        >
          {wallets.length ? (
            wallets.map((wallet) => <CryptoWalletAsset key={wallet.id} wallet={wallet} />)
          ) : (
            <AssetEmptyState
              icon="solar:wallet-2-linear"
              title="数字货币钱包尚未就绪"
              detail="钱包创建并完成托管归属验证后，会显示网络、地址和 USDT 资产。"
            />
          )}
        </AssetColumn>
      </Stack>
    </Box>
  );
}

function VaTable({ rows }: { rows: VirtualAccountRequest[] }) {
  return (
    <TableContainer>
      <Table size="small">
        <TableHead>
          <TableRow>
            <TableCell>时间</TableCell>
            <TableCell>币种</TableCell>
            <TableCell>银行渠道</TableCell>
            <TableCell>用途</TableCell>
            <TableCell>分配账号</TableCell>
            <TableCell align="right">状态</TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {rows.map((row) => (
            <TableRow key={row.id} hover>
              <TableCell>{formatDate(row.createdAt)}</TableCell>
              <TableCell>{row.currency}</TableCell>
              <TableCell>{row.channel?.settlementBankName || row.channel?.name || '-'}</TableCell>
              <TableCell>{row.purpose}</TableCell>
              <TableCell>{row.assignedAccount?.accountNumber || '-'}</TableCell>
              <TableCell align="right">{operationStatus(row.status)}</TableCell>
            </TableRow>
          ))}
          {!rows.length && (
            <TableRow>
              <TableCell colSpan={6} align="center" sx={{ py: 6, color: 'text.secondary' }}>
                暂无 VA 申请
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
    </TableContainer>
  );
}

function CryptoTransferTable({ rows }: { rows: CryptoTransfer[] }) {
  return (
    <TableContainer>
      <Table size="small">
        <TableHead>
          <TableRow>
            <TableCell>时间 / 编号</TableCell>
            <TableCell>方向</TableCell>
            <TableCell>网络</TableCell>
            <TableCell align="right">总额</TableCell>
            <TableCell align="right">手续费</TableCell>
            <TableCell align="right">状态</TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {rows.map((row) => (
            <TableRow key={row.id} hover>
              <TableCell>
                <Typography variant="body2" fontWeight={650}>
                  {formatDate(row.createdAt)}
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  {row.reference}
                </Typography>
              </TableCell>
              <TableCell>{row.direction === 'WITHDRAWAL' ? '提币' : '收币'}</TableCell>
              <TableCell>
                {row.asset} / {row.network}
              </TableCell>
              <TableCell align="right">{row.amount}</TableCell>
              <TableCell align="right">{row.feeAmount}</TableCell>
              <TableCell align="right">{operationStatus(row.status)}</TableCell>
            </TableRow>
          ))}
          {!rows.length && (
            <TableRow>
              <TableCell colSpan={6} align="center" sx={{ py: 6, color: 'text.secondary' }}>
                暂无数字资产流水
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
    </TableContainer>
  );
}

function FeeTable({
  rows,
  overrides,
  saving,
  onEdit,
  onDisable,
  onManageDefaults,
}: {
  rows: CustomerFeeRow[];
  overrides: Map<string, WithdrawalFeeRule>;
  saving: boolean;
  onEdit: (feeScope: CustomerFeeRow, override?: WithdrawalFeeRule) => void;
  onDisable: (rule: WithdrawalFeeRule) => void;
  onManageDefaults: () => void;
}) {
  const assetGroups = [
    { assetClass: 'FIAT' as const, label: '法币转出' },
    { assetClass: 'CRYPTO' as const, label: '数字货币转出' },
  ];

  return (
    <TableContainer>
      <Table size="small">
        <TableHead>
          <TableRow>
            <TableCell>服务</TableCell>
            <TableCell>渠道</TableCell>
            <TableCell>机构默认</TableCell>
            <TableCell>客户生效值</TableCell>
            <TableCell>规则状态</TableCell>
            <TableCell align="right">操作</TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {assetGroups.map(({ assetClass, label }) => {
            const groupRows = rows.filter((row) => row.assetClass === assetClass);
            return (
              <Fragment key={assetClass}>
                <TableRow>
                  <TableCell
                    colSpan={6}
                    sx={{ py: 1.1, bgcolor: 'background.neutral', borderBottomColor: 'divider' }}
                  >
                    <Typography variant="overline" color="text.secondary" fontWeight={800}>
                      {label}
                    </Typography>
                  </TableCell>
                </TableRow>
                {groupRows.map((row) => {
                  const base = row.defaultRule;
                  const override = overrides.get(row.key);
                  let effective: string | null = null;
                  let effectiveVersion = '';
                  let ruleStatus = <Label color="warning">待配置</Label>;
                  if (override?.active) {
                    effective = override.amount;
                    effectiveVersion = `客户版本 v${override.version}`;
                    ruleStatus = <Label color="info">客户专属</Label>;
                  } else if (base?.active) {
                    effective = base.amount;
                    effectiveVersion = `默认版本 v${base.version}`;
                    ruleStatus = <Label color="default">机构默认</Label>;
                  }
                  return (
                    <TableRow key={row.key} hover>
                      <TableCell>
                        <Typography variant="body2" fontWeight={700}>
                          {feeServiceName(row)}
                        </Typography>
                        <Typography variant="caption" color="text.secondary">
                          每笔固定费用
                        </Typography>
                      </TableCell>
                      <TableCell>
                        <Typography variant="body2">{row.channelName}</Typography>
                        <Typography variant="caption" color="text.secondary">
                          {row.channelCode}
                          {!row.channelActive ? ' · 通道已停用' : ''}
                        </Typography>
                      </TableCell>
                      <TableCell>
                        {base ? (
                          <>
                            <Typography
                              variant="body2"
                              color={base.active ? 'text.primary' : 'text.disabled'}
                            >
                              {base.amount} {base.currency}
                            </Typography>
                            <Typography variant="caption" color="text.secondary">
                              v{base.version} · {base.active ? '生效中' : '已停用'}
                            </Typography>
                          </>
                        ) : (
                          <Typography variant="body2" color="warning.main" fontWeight={650}>
                            未配置
                          </Typography>
                        )}
                      </TableCell>
                      <TableCell>
                        {effective ? (
                          <>
                            <Typography variant="body2" fontWeight={750}>
                              {effective} {row.currency}
                            </Typography>
                            <Typography variant="caption" color="text.secondary">
                              {effectiveVersion}
                            </Typography>
                          </>
                        ) : (
                          <Typography variant="body2" color="warning.main" fontWeight={650}>
                            暂不可转出
                          </Typography>
                        )}
                      </TableCell>
                      <TableCell>{ruleStatus}</TableCell>
                      <TableCell align="right">
                        <Stack direction="row" justifyContent="flex-end" spacing={0.5}>
                          <Button
                            size="small"
                            disabled={saving}
                            onClick={() => onEdit(row, override)}
                          >
                            设置专属
                          </Button>
                          {override?.active && (
                            <Button
                              size="small"
                              color="error"
                              disabled={saving}
                              onClick={() => onDisable(override)}
                            >
                              {base?.active ? '恢复默认' : '停用专属'}
                            </Button>
                          )}
                          {!base?.active && (
                            <Button size="small" color="inherit" onClick={onManageDefaults}>
                              配置默认
                            </Button>
                          )}
                        </Stack>
                      </TableCell>
                    </TableRow>
                  );
                })}
                {!groupRows.length && (
                  <TableRow>
                    <TableCell colSpan={6} align="center" sx={{ py: 3.5 }}>
                      <Typography variant="body2" color="text.secondary">
                        {assetClass === 'FIAT'
                          ? '尚未配置法币转出通道，需先在资金通道中创建 VA、POBO 或平台代付路径。'
                          : '尚无可管理的数字货币转出规则。'}
                      </Typography>
                      {assetClass === 'FIAT' && (
                        <Button size="small" sx={{ mt: 1 }} onClick={onManageDefaults}>
                          管理资金通道
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                )}
              </Fragment>
            );
          })}
        </TableBody>
      </Table>
    </TableContainer>
  );
}

function AuditTimeline({ events }: { events: AuditEvent[] }) {
  if (!events.length) return <Typography color="text.secondary">暂无审计记录</Typography>;
  return (
    <Box sx={{ position: 'relative' }}>
      <Box
        sx={{ position: 'absolute', left: 17, top: 18, bottom: 18, width: 1, bgcolor: 'divider' }}
      />
      {events.map((event, index) => (
        <Box
          key={event.id}
          sx={{
            position: 'relative',
            display: 'grid',
            gridTemplateColumns: '36px minmax(0, 1fr)',
            gap: 2,
            pb: index === events.length - 1 ? 0 : 3,
          }}
        >
          <Box
            sx={{
              zIndex: 1,
              width: 34,
              height: 34,
              display: 'grid',
              placeItems: 'center',
              borderRadius: '50%',
              color: event.color,
              bgcolor: alpha(event.color, 0.09),
              border: '1px solid',
              borderColor: alpha(event.color, 0.24),
            }}
          >
            <Iconify icon={event.icon} width={18} />
          </Box>
          <Box>
            <Stack direction={{ xs: 'column', sm: 'row' }} justifyContent="space-between" gap={0.5}>
              <Typography variant="subtitle2">{event.title}</Typography>
              <Typography variant="caption" color="text.disabled">
                {formatDate(event.time)}
              </Typography>
            </Stack>
            <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
              {event.detail}
            </Typography>
          </Box>
        </Box>
      ))}
    </Box>
  );
}

function ReviewDialog({
  action,
  note,
  reviewing,
  onNoteChange,
  onClose,
  onSubmit,
}: {
  action: ReviewAction | null;
  note: string;
  reviewing: boolean;
  onNoteChange: (value: string) => void;
  onClose: () => void;
  onSubmit: () => void;
}) {
  const titles: Record<ReviewAction, string> = {
    ACTIVATE: '运营批准开户',
    REJECT_ACCOUNT: '拒绝开户',
  };
  const requiresReason = action === 'REJECT_ACCOUNT';
  return (
    <Dialog open={Boolean(action)} onClose={() => !reviewing && onClose()} fullWidth maxWidth="sm">
      <DialogTitle>{action ? titles[action] : ''}</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ mt: 1 }}>
          <Alert severity={requiresReason ? 'warning' : 'info'}>
            此操作会写入客户审核状态和审计时间；它不会自动执行任何银行或链上资金转移。
          </Alert>
          <TextField
            autoFocus
            fullWidth
            multiline
            minRows={3}
            required={requiresReason}
            label={requiresReason ? '原因（必填）' : '审核备注'}
            value={note}
            onChange={(event) => onNoteChange(event.target.value)}
          />
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={reviewing}>
          取消
        </Button>
        <Button
          variant="contained"
          color={requiresReason ? 'error' : 'primary'}
          onClick={onSubmit}
          disabled={reviewing || (requiresReason && !note.trim())}
        >
          {reviewing ? '处理中…' : '确认提交'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
