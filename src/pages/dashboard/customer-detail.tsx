import { useCallback, useEffect, useMemo, useState } from 'react';
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
import Label from 'src/components/label';
import { IS_NEOBANK_DEPLOYMENT } from 'src/config/deployment-mode';
import {
  coreApi,
  CryptoTransfer,
  CryptoWallet,
  Currency,
  Customer,
  FundingChannel,
  neobankApi,
  Operation,
  VirtualAccountRequest,
  WithdrawalFeeRule,
} from 'src/features/finance/core-api';
import { paths } from 'src/routes/paths';

type DetailTab = 'overview' | 'profile' | 'accounts' | 'transactions' | 'fees' | 'audit';
type ReviewAction = 'KYC_APPROVE' | 'KYC_REJECT' | 'ACTIVATE' | 'REJECT_ACCOUNT';

type NeobankKycReviewResult = {
  wallet?: { id: string };
  wallet_provisioning?: { status: 'retry_required'; error_code: string };
};

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

function feeKey(rule: WithdrawalFeeRule) {
  return [rule.assetClass, rule.currency, rule.method, rule.channelCode, rule.network || ''].join(
    '|'
  );
}

function feeServiceName(rule: WithdrawalFeeRule) {
  if (rule.assetClass === 'CRYPTO') return `${rule.currency}-${rule.network || ''} 链上提币`;
  const methods: Record<string, string> = {
    VA: 'VA 出款',
    POBO: 'POBO 代付',
    PLATFORM: '平台代付',
  };
  return `${rule.currency} ${methods[rule.method] || rule.method}`;
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
  const [vaChannels, setVaChannels] = useState<FundingChannel[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [partialErrors, setPartialErrors] = useState<string[]>([]);
  const [success, setSuccess] = useState('');
  const [actionAnchor, setActionAnchor] = useState<HTMLElement | null>(null);
  const [reviewAction, setReviewAction] = useState<ReviewAction | null>(null);
  const [reviewNote, setReviewNote] = useState('');
  const [reviewing, setReviewing] = useState(false);
  const [editingFee, setEditingFee] = useState<{
    base: WithdrawalFeeRule;
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
            'VA 银行渠道',
            coreApi<FundingChannel[]>(
              `/funding-channels?organizationId=${encodeURIComponent(
                customerRow.organizationId
              )}&type=VIRTUAL_ACCOUNT`,
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
      setVaChannels(channelResult.value);
      const firstActiveChannel = channelResult.value.find((channel) => channel.active);
      setVaChannelId((current) =>
        channelResult.value.some((channel) => channel.active && channel.id === current)
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

  const defaultFeeRules = useMemo(
    () => feeRules.filter((rule) => rule.scope === 'ORGANIZATION' && rule.active),
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
    if (
      (reviewAction === 'KYC_REJECT' || reviewAction === 'REJECT_ACCOUNT') &&
      !reviewNote.trim()
    ) {
      setLoadError('拒绝操作必须填写原因');
      return;
    }
    setReviewing(true);
    setLoadError('');
    try {
      if (reviewAction === 'KYC_APPROVE' || reviewAction === 'KYC_REJECT') {
        const approved = reviewAction === 'KYC_APPROVE';
        const note = reviewNote.trim() || 'KYC 资料人工核验通过';
        let neobankResult: NeobankKycReviewResult | null = null;
        if (IS_NEOBANK_DEPLOYMENT) {
          neobankResult = await neobankApi<NeobankKycReviewResult>(
            `/admin/customers/${customer.id}/kyc`,
            {
              method: 'PATCH',
              userId,
              body: JSON.stringify({ decision: approved ? 'approve' : 'reject', note }),
            }
          );
        } else {
          await coreApi(`/customers/${customer.id}/kyc`, {
            method: 'PATCH',
            userId,
            body: JSON.stringify({ decision: approved ? 'APPROVE' : 'REJECT', note }),
          });
        }
        if (!approved) {
          setSuccess('KYC 审核已拒绝');
        } else if (!IS_NEOBANK_DEPLOYMENT) {
          setSuccess('KYC 审核已通过，等待运营开户审核');
        } else if (neobankResult?.wallet) {
          setSuccess('KYC 已通过，客户已自动激活并创建 USDT-TRC20 钱包');
        } else {
          setSuccess('KYC 已通过，客户已自动激活；钱包生成失败并已标记为待重试');
        }
      }
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
            assetClass: editingFee.base.assetClass,
            currency: editingFee.base.currency,
            method: editingFee.base.method,
            channelCode: editingFee.base.channelCode,
            network: editingFee.base.network,
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
            <Button onClick={() => navigate(paths.dashboard.onboarding)}>返回客户管理</Button>
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
  const activeVaChannels = vaChannels.filter((channel) => channel.active);
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
                onClick={() => navigate(paths.dashboard.onboarding)}
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
                    <Stack spacing={1} sx={{ mt: 2 }}>
                      <Button variant="contained" onClick={() => setReviewAction('KYC_APPROVE')}>
                        KYC 通过
                      </Button>
                      <Button
                        color="error"
                        variant="outlined"
                        onClick={() => setReviewAction('KYC_REJECT')}
                      >
                        KYC 不通过
                      </Button>
                    </Stack>
                  )}
                  {customer.status === 'PENDING_REVIEW' && customer.kycStatus === 'APPROVED' && (
                    <Stack spacing={1} sx={{ mt: 2 }}>
                      <Button variant="contained" onClick={() => setReviewAction('ACTIVATE')}>
                        运营批准开户
                      </Button>
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
              </Paper>
            </Stack>
          )}

          {tab === 'accounts' && (
            <Stack spacing={2.25}>
              <Paper sx={{ ...panelSx, overflow: 'hidden' }}>
                <Box sx={{ px: 2.25, py: 1.8 }}>
                  <Typography variant="h6">账户与钱包</Typography>
                </Box>
                <AccountTable customer={customer} wallets={wallets} />
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
                <Typography variant="h6">客户专属手续费</Typography>
                <Typography variant="body2" color="text.secondary" sx={{ mt: 0.6 }}>
                  客户覆盖优先于机构默认。变更仅影响之后的新提交，历史交易继续保留原费用和规则版本快照。
                </Typography>
              </Box>
              <FeeTable
                defaults={defaultFeeRules}
                overrides={overridesByKey}
                saving={feeSaving}
                onEdit={(base, override) =>
                  setEditingFee({ base, override, amount: override?.amount || base.amount })
                }
                onDisable={(rule) => disableFee(rule).catch(() => undefined)}
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
                {feeServiceName(editingFee.base)} · 机构默认 {editingFee.base.amount}{' '}
                {editingFee.base.currency}
              </Alert>
              <TextField
                autoFocus
                fullWidth
                label={`客户手续费（${editingFee.base.currency}）`}
                value={editingFee.amount}
                onChange={(event) => setEditingFee({ ...editingFee, amount: event.target.value })}
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
            disabled={feeSaving || !editingFee?.amount}
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

function AccountTable({ customer, wallets }: { customer: Customer; wallets: CryptoWallet[] }) {
  const walletByCurrency = new Map(
    wallets.map((wallet) => [`${wallet.asset}-${wallet.network}`, wallet])
  );
  return (
    <TableContainer>
      <Table size="small">
        <TableHead>
          <TableRow>
            <TableCell>账户</TableCell>
            <TableCell>类型</TableCell>
            <TableCell>币种/网络</TableCell>
            <TableCell>银行/账号</TableCell>
            <TableCell align="right">可用</TableCell>
            <TableCell align="right">冻结</TableCell>
            <TableCell align="right">状态</TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {customer.accounts.map((account) => {
            const wallet =
              account.currency === 'USDT'
                ? walletByCurrency.get(`USDT-${account.network || 'TRON'}`)
                : undefined;
            return (
              <TableRow key={account.id} hover>
                <TableCell>
                  <Typography variant="body2" fontWeight={700}>
                    {account.name}
                  </Typography>
                  <Typography variant="caption" color="text.secondary">
                    {account.id}
                  </Typography>
                </TableCell>
                <TableCell>{account.kind}</TableCell>
                <TableCell>
                  {account.currency}
                  {account.network ? ` / ${account.network}` : ''}
                </TableCell>
                <TableCell>
                  <Typography variant="body2">{account.bankName || '-'}</Typography>
                  <Typography variant="caption" color="text.secondary">
                    {account.accountNumber || account.iban || '-'}
                  </Typography>
                </TableCell>
                <TableCell align="right">{account.availableBalance}</TableCell>
                <TableCell align="right">{account.frozenBalance}</TableCell>
                <TableCell align="right">
                  <Stack alignItems="flex-end" spacing={0.5}>
                    {operationStatus(account.status)}
                    {wallet?.withdrawalFee && (
                      <Typography variant="caption" color="text.secondary">
                        提币费 {wallet.withdrawalFee}
                      </Typography>
                    )}
                  </Stack>
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </TableContainer>
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
  defaults,
  overrides,
  saving,
  onEdit,
  onDisable,
}: {
  defaults: WithdrawalFeeRule[];
  overrides: Map<string, WithdrawalFeeRule>;
  saving: boolean;
  onEdit: (base: WithdrawalFeeRule, override?: WithdrawalFeeRule) => void;
  onDisable: (rule: WithdrawalFeeRule) => void;
}) {
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
          {defaults.map((base) => {
            const override = overrides.get(feeKey(base));
            const effective = override?.active ? override.amount : base.amount;
            return (
              <TableRow key={base.id} hover>
                <TableCell>
                  <Typography variant="body2" fontWeight={700}>
                    {feeServiceName(base)}
                  </Typography>
                  <Typography variant="caption" color="text.secondary">
                    固定费用
                  </Typography>
                </TableCell>
                <TableCell>{base.channelCode}</TableCell>
                <TableCell>
                  {base.amount} {base.currency}
                </TableCell>
                <TableCell>
                  <Typography variant="body2" fontWeight={750}>
                    {effective} {base.currency}
                  </Typography>
                  <Typography variant="caption" color="text.secondary">
                    {override?.active
                      ? `客户版本 v${override.version}`
                      : `默认版本 v${base.version}`}
                  </Typography>
                </TableCell>
                <TableCell>
                  {override?.active ? (
                    <Label color="info">客户覆盖</Label>
                  ) : (
                    <Label color="default">机构默认</Label>
                  )}
                </TableCell>
                <TableCell align="right">
                  <Stack direction="row" justifyContent="flex-end" spacing={0.5}>
                    <Button size="small" disabled={saving} onClick={() => onEdit(base, override)}>
                      设置
                    </Button>
                    {override?.active && (
                      <Button
                        size="small"
                        color="error"
                        disabled={saving}
                        onClick={() => onDisable(override)}
                      >
                        恢复默认
                      </Button>
                    )}
                  </Stack>
                </TableCell>
              </TableRow>
            );
          })}
          {!defaults.length && (
            <TableRow>
              <TableCell colSpan={6} align="center" sx={{ py: 7, color: 'text.secondary' }}>
                机构尚未配置可覆盖的转出手续费规则
              </TableCell>
            </TableRow>
          )}
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
    KYC_APPROVE: '确认 KYC 通过',
    KYC_REJECT: 'KYC 不通过',
    ACTIVATE: '运营批准开户',
    REJECT_ACCOUNT: '拒绝开户',
  };
  const requiresReason = action === 'KYC_REJECT' || action === 'REJECT_ACCOUNT';
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
