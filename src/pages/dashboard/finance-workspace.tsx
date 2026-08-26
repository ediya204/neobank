import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import { Helmet } from 'react-helmet-async';
import { useSearchParams } from 'react-router-dom';
import {
  Alert,
  Box,
  Button,
  Card,
  CardActionArea,
  CardContent,
  Checkbox,
  Chip,
  Container,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  Drawer,
  FormControl,
  FormControlLabel,
  FormHelperText,
  InputAdornment,
  InputLabel,
  MenuItem,
  Select,
  Skeleton,
  Stack,
  Switch,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  Typography,
} from '@mui/material';
import AssetIcon from 'src/components/asset-icon';
import Iconify from 'src/components/iconify';
import Label from 'src/components/label';
import { IS_NEOBANK_DEPLOYMENT } from 'src/config/deployment-mode';
import BeneficiaryDialog from 'src/features/finance/beneficiary-dialog';
import { completedAccountCustomers } from 'src/features/finance/account-customer-list';
import { digitalWalletPresentation } from 'src/features/finance/digital-wallet-status';
import { ACTION_ICONS, UI_ICONS } from 'src/theme/iconography';
import {
  accountBalanceLabel,
  Beneficiary,
  coreApi,
  Currency,
  CryptoWallet,
  Customer,
  demoOrganizationId,
  FundingChannel,
  JournalEntry,
  MarketQuote,
  MoneyAccount,
  neobankApi,
  Operation,
  OperationType,
  RateVersion,
  supportedFiatCurrencies,
  SYSTEM_WALLET_PRODUCT_NAME,
  WithdrawalFeeRule,
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
  | 'adjustments';

const sectionCopy: Record<
  FinanceSection,
  { title: string; description: string; type?: OperationType }
> = {
  accounts: {
    title: '客户账户',
    description: `查看客户的 VA 账户、${SYSTEM_WALLET_PRODUCT_NAME}和数字钱包状态。`,
  },
  channels: { title: '资金通道', description: '查看法币入账、VA 银行、POBO 和平台代付通道。' },
  beneficiaries: {
    title: '收款人',
    description: '维护客户银行账户和 USDT-TRON 地址，并在付款时复用已核对资料。',
  },
  rates: {
    title: '汇率与报价',
    description: '维护 FX 与 OTC 的版本化费率策略；报价始终跟随 FastForex 实时行情。',
  },
  ledger: { title: '账本分录', description: '查询不可修改的借贷流水；更正必须通过补偿调账完成。' },
  transactions: {
    title: '交易记录',
    description: '统一查询所有入账、转账、换汇、OTC、出款和调账。',
  },
  deposits: {
    title: '入账处理',
    description: '录入银行到账，经授权管理员审批后记入指定钱包或 VA。',
    type: 'DEPOSIT',
  },
  payouts: {
    title: '法币出款',
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
    description: '在 USD 与 HKD 之间按版本化汇率兑换。',
    type: 'FX',
  },
  otc: {
    title: '自动兑换',
    description: '法币与 USDT 的内部 OTC 订单；链上操作等待 Cregis。',
    type: 'OTC',
  },
  adjustments: {
    title: '调账处理',
    description: '所有余额增减都通过补偿流水和管理员审批完成。',
    type: 'ADJUSTMENT',
  },
};

const operationStatusFilters = [
  'SUBMITTED',
  'APPROVED',
  'PROCESSING',
  'COMPLETED',
  'REJECTED',
  'FAILED',
  'CANCELLED',
] as const;

const currencies: Currency[] = [...supportedFiatCurrencies];

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

type ChannelForm = {
  code: string;
  name: string;
  type: FundingChannel['type'];
  supportedCurrencies: Currency[];
  active: boolean;
  settlementBankName: string;
  swiftBic: string;
  bankCountry: string;
  bankAddress: string;
};

const initialForm: OperationForm = {
  customerId: '',
  currency: 'USD',
  quoteCurrency: 'HKD',
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

const initialChannelForm: ChannelForm = {
  code: '',
  name: '',
  type: 'FIAT_INBOUND',
  supportedCurrencies: ['USD', 'HKD'],
  active: false,
  settlementBankName: '',
  swiftBic: '',
  bankCountry: '',
  bankAddress: '',
};

function payoutAccountKindAllowed(
  kind: MoneyAccount['kind'],
  payoutMethod: OperationForm['payoutMethod']
) {
  if (payoutMethod === 'VA') return kind === 'VIRTUAL_ACCOUNT';
  if (payoutMethod === 'POBO') return kind === 'SYSTEM_WALLET' || kind === 'VIRTUAL_ACCOUNT';
  return kind === 'SYSTEM_WALLET';
}

function payoutAccountScopeLabel(payoutMethod: OperationForm['payoutMethod']) {
  if (payoutMethod === 'VA') return 'VA 钱包';
  if (payoutMethod === 'POBO') return `${SYSTEM_WALLET_PRODUCT_NAME}或 VA 钱包`;
  return SYSTEM_WALLET_PRODUCT_NAME;
}

const channelTypeCopy: Record<
  FundingChannel['type'],
  { label: string; description: string; icon: string }
> = {
  FIAT_INBOUND: {
    label: '法币入账',
    description: '接收银行汇款，匹配客户与目标 VA/钱包，审批后才记账。',
    icon: ACTION_ICONS.fundsIn,
  },
  VIRTUAL_ACCOUNT: {
    label: 'VA 银行',
    description: '同一银行通道负责 VA 开户，并绑定该 VA 后续转出所使用的银行。',
    icon: ACTION_ICONS.accounts,
  },
  VA_PAYOUT: {
    label: '历史 VA 出款',
    description: '旧版兼容类型；不再用于新配置或新业务，历史记录继续保留。',
    icon: ACTION_ICONS.accounts,
  },
  POBO_PAYOUT: {
    label: 'POBO 出款',
    description: `从${SYSTEM_WALLET_PRODUCT_NAME}扣款，由外部通道以客户名义执行付款。`,
    icon: ACTION_ICONS.fundsOut,
  },
  PLATFORM_PAYOUT: {
    label: '平台代付',
    description: `从${SYSTEM_WALLET_PRODUCT_NAME}扣款，以平台母账户作为银行付款人。`,
    icon: ACTION_ICONS.internalTransfer,
  },
};

const configurableChannelTypes: FundingChannel['type'][] = [
  'FIAT_INBOUND',
  'VIRTUAL_ACCOUNT',
  'POBO_PAYOUT',
  'PLATFORM_PAYOUT',
];

export default function FinanceWorkspace({ section }: { section: FinanceSection }) {
  const copy = sectionCopy[section];
  const userId = 'usr_admin';
  const [searchParams, setSearchParams] = useSearchParams();
  const requestedCustomerId = searchParams.get('customerId') || '';
  const requestedStatus = searchParams.get('status');
  const status = operationStatusFilters.includes(
    requestedStatus as (typeof operationStatusFilters)[number]
  )
    ? requestedStatus!
    : 'all';
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [channels, setChannels] = useState<FundingChannel[]>([]);
  const [withdrawalFees, setWithdrawalFees] = useState<WithdrawalFeeRule[]>([]);
  const [operationWithdrawalFees, setOperationWithdrawalFees] = useState<WithdrawalFeeRule[]>([]);
  const [operationFeeCustomerId, setOperationFeeCustomerId] = useState('');
  const [operationFeesLoading, setOperationFeesLoading] = useState(false);
  const [operationFeesError, setOperationFeesError] = useState('');
  const [operations, setOperations] = useState<Operation[]>([]);
  const [rates, setRates] = useState<RateVersion[]>([]);
  const [marketQuotes, setMarketQuotes] = useState<MarketQuote[]>([]);
  const [marketLoading, setMarketLoading] = useState(false);
  const [marketError, setMarketError] = useState('');
  const [journals, setJournals] = useState<JournalEntry[]>([]);
  const [selectedCustomerId, setSelectedCustomerId] = useState(requestedCustomerId);
  const [selected, setSelected] = useState<Operation | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [createOpen, setCreateOpen] = useState(false);
  const [operationFormError, setOperationFormError] = useState('');
  const [operationSubmitting, setOperationSubmitting] = useState(false);
  const [rejectOpen, setRejectOpen] = useState(false);
  const [rejectReason, setRejectReason] = useState('');
  const [executeOpen, setExecuteOpen] = useState(false);
  const [externalReference, setExternalReference] = useState('');
  const [actionError, setActionError] = useState('');
  const [form, setForm] = useState<OperationForm>({
    ...initialForm,
    customerId: requestedCustomerId,
  });
  const [customerDetail, setCustomerDetail] = useState<Customer | null>(null);
  const [beneficiaryOpen, setBeneficiaryOpen] = useState(false);
  const [rateOpen, setRateOpen] = useState(false);
  const [rateDeactivateTarget, setRateDeactivateTarget] = useState<RateVersion | null>(null);
  const [rateDeactivating, setRateDeactivating] = useState(false);
  const [channelEditorOpen, setChannelEditorOpen] = useState(false);
  const [editingChannel, setEditingChannel] = useState<FundingChannel | null>(null);
  const [channelForm, setChannelForm] = useState<ChannelForm>(initialChannelForm);
  const [channelSaving, setChannelSaving] = useState(false);
  const [channelFormError, setChannelFormError] = useState('');
  const [cryptoWallets, setCryptoWallets] = useState<CryptoWallet[]>([]);
  const [cryptoWalletsLoading, setCryptoWalletsLoading] = useState(false);
  const [cryptoWalletsError, setCryptoWalletsError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const customerParams = new URLSearchParams({ organizationId: demoOrganizationId });
      if (section === 'accounts') customerParams.set('status', 'ACTIVE');
      const [customerRows, channelRows, feeRows] = await Promise.all([
        coreApi<Customer[]>(`/customers?${customerParams.toString()}`, { userId }),
        coreApi<FundingChannel[]>(`/funding-channels?organizationId=${demoOrganizationId}`, {
          userId,
        }),
        coreApi<WithdrawalFeeRule[]>(`/withdrawal-fees?organizationId=${demoOrganizationId}`, {
          userId,
        }),
      ]);
      const visibleCustomerRows =
        section === 'accounts' ? completedAccountCustomers(customerRows) : customerRows;
      setCustomers(visibleCustomerRows);
      setChannels(channelRows);
      setWithdrawalFees(feeRows);
      if (!selectedCustomerId && visibleCustomerRows[0]) {
        setSelectedCustomerId(visibleCustomerRows[0].id);
      }
      const params = new URLSearchParams({ organizationId: demoOrganizationId });
      if (copy.type) params.set('type', copy.type);
      if (status !== 'all') params.set('status', status);
      if (requestedCustomerId) params.set('customerId', requestedCustomerId);
      const operationRows = await coreApi<Operation[]>(`/operations?${params.toString()}`, {
        userId,
      });
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
  }, [copy.type, requestedCustomerId, section, selectedCustomerId, status, userId]);

  useEffect(() => {
    load().catch(() => undefined);
  }, [load]);

  const loadMarketQuotes = useCallback(async () => {
    if (section !== 'rates' && section !== 'accounts') return;
    setMarketLoading(true);
    setMarketError('');
    setMarketQuotes([]);
    try {
      const pairs: ReadonlyArray<readonly [Currency, Currency]> =
        section === 'accounts'
          ? supportedFiatCurrencies
              .filter((currency) => currency !== 'USD')
              .map((currency) => [currency, 'USD'] as const)
          : [
              ['USD', 'HKD'],
              ['HKD', 'USD'],
              ['USD', 'USDT'],
              ['USDT', 'USD'],
              ['HKD', 'USDT'],
              ['USDT', 'HKD'],
            ];
      const quotes = await Promise.all(
        pairs.map(([base, quote]) =>
          (IS_NEOBANK_DEPLOYMENT ? neobankApi : coreApi)<MarketQuote>(
            `/admin/market-rate?base=${base}&quote=${quote}`,
            { userId }
          )
        )
      );
      setMarketQuotes(quotes);
    } catch (value) {
      let message = '参考行情暂时不可用';
      if (section === 'accounts') message = 'USD 折算行情暂不可用，请稍后重试';
      else if (value instanceof Error) {
        const { message: errorMessage } = value;
        if (errorMessage === 'market_data_not_configured') {
          message = 'FastForex 行情尚未配置，暂时不能创建汇率版本。';
        } else if (errorMessage === 'market_data_unavailable') {
          message = 'FastForex 参考行情暂时不可用，请稍后重试。';
        } else {
          message = errorMessage;
        }
      }
      setMarketError(message);
    } finally {
      setMarketLoading(false);
    }
  }, [section, userId]);

  useEffect(() => {
    loadMarketQuotes().catch(() => undefined);
  }, [loadMarketQuotes]);

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

  useEffect(() => {
    if (copy.type !== 'PAYOUT' || !form.customerId || !createOpen) {
      setOperationWithdrawalFees([]);
      setOperationFeeCustomerId('');
      setOperationFeesError('');
      setOperationFeesLoading(false);
      return undefined;
    }
    let active = true;
    setOperationWithdrawalFees([]);
    setOperationFeeCustomerId('');
    setOperationFeesError('');
    setOperationFeesLoading(true);
    coreApi<WithdrawalFeeRule[]>(
      `/withdrawal-fees?organizationId=${demoOrganizationId}&customerId=${form.customerId}&active=true`,
      { userId }
    )
      .then((rows) => {
        if (!active) return;
        setOperationWithdrawalFees(rows);
        setOperationFeeCustomerId(form.customerId);
      })
      .catch((value) => {
        if (!active) return;
        setOperationFeesError(value instanceof Error ? value.message : '转出手续费加载失败');
      })
      .finally(() => {
        if (active) setOperationFeesLoading(false);
      });
    return () => {
      active = false;
    };
  }, [copy.type, createOpen, form.customerId, userId]);

  const selectedCustomer =
    customers.find((customer) => customer.id === selectedCustomerId) || customers[0];

  useEffect(() => {
    if (section !== 'accounts' || !selectedCustomer?.id) {
      setCryptoWallets([]);
      setCryptoWalletsLoading(false);
      setCryptoWalletsError('');
      return undefined;
    }
    let active = true;
    setCryptoWallets([]);
    setCryptoWalletsLoading(true);
    setCryptoWalletsError('');
    coreApi<CryptoWallet[]>(
      `/crypto-wallets?customerId=${encodeURIComponent(selectedCustomer.id)}`,
      { userId }
    )
      .then((rows) => {
        if (active) setCryptoWallets(rows);
      })
      .catch((value) => {
        if (active) {
          setCryptoWalletsError(value instanceof Error ? value.message : 'Cregis 状态读取失败');
        }
      })
      .finally(() => {
        if (active) setCryptoWalletsLoading(false);
      });
    return () => {
      active = false;
    };
  }, [section, selectedCustomer?.id, userId]);

  const displayAccounts = selectedCustomer?.accounts || [];
  const availableAccounts = customerDetail?.accounts || [];
  const beneficiaries = customerDetail?.beneficiaries || [];

  const visibleOperations = useMemo(
    () =>
      section === 'deposits'
        ? operations.filter((operation) => supportedFiatCurrencies.includes(operation.currency))
        : operations,
    [operations, section]
  );

  const summary = useMemo(
    () => ({
      submitted: visibleOperations.filter((item) => item.status === 'SUBMITTED').length,
      processing: visibleOperations.filter((item) => item.status === 'PROCESSING').length,
      completed: visibleOperations.filter((item) => item.status === 'COMPLETED').length,
    }),
    [visibleOperations]
  );

  const setOperationStatus = (nextStatus: string) => {
    const next = new URLSearchParams(searchParams);
    if (nextStatus === 'all') next.delete('status');
    else next.set('status', nextStatus);
    setSearchParams(next, { replace: true });
  };

  const openCreate = () => {
    setOperationFormError('');
    setForm({
      ...initialForm,
      customerId: requestedCustomerId || selectedCustomerId || customers[0]?.id || '',
      quoteCurrency: copy.type === 'OTC' ? 'USDT' : initialForm.quoteCurrency,
    });
    setCreateOpen(true);
  };

  const updateOperationForm = useCallback((nextForm: OperationForm) => {
    setOperationFormError('');
    setForm(nextForm);
  }, []);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!copy.type) return;
    const sourceRequired =
      ['PAYOUT', 'INTERNAL_TRANSFER', 'FX', 'OTC'].includes(copy.type) ||
      (copy.type === 'ADJUSTMENT' && form.adjustmentDirection === 'DEBIT');
    const targetRequired =
      ['DEPOSIT', 'INTERNAL_TRANSFER', 'FX', 'OTC'].includes(copy.type) ||
      (copy.type === 'ADJUSTMENT' && form.adjustmentDirection === 'CREDIT');
    const amount = Number(form.amount);
    if (!form.customerId) {
      setOperationFormError('请选择客户。');
      return;
    }
    if (customerDetail?.id !== form.customerId) {
      setOperationFormError('客户账户仍在加载，请稍后再提交。');
      return;
    }
    if (!Number.isFinite(amount) || amount <= 0) {
      setOperationFormError('请输入大于 0 的有效金额。');
      return;
    }
    if (sourceRequired && !form.sourceAccountId) {
      setOperationFormError('请选择扣款账户。');
      return;
    }
    if (targetRequired && !form.targetAccountId) {
      setOperationFormError('请选择入账账户。');
      return;
    }
    if ((copy.type === 'FX' || copy.type === 'OTC') && form.currency === form.quoteCurrency) {
      setOperationFormError('基础币种与目标币种不能相同。');
      return;
    }
    if (copy.type === 'DEPOSIT') {
      if (!form.channelId || !form.remitterName.trim() || !form.remittanceReference.trim()) {
        setOperationFormError('请选择资金通道，并填写汇款人和银行流水号。');
        return;
      }
      if (!form.receivedAt || Number.isNaN(new Date(form.receivedAt).getTime())) {
        setOperationFormError('请输入有效的到账时间。');
        return;
      }
    }
    if (copy.type === 'PAYOUT') {
      if (form.payoutMethod === 'VA' && !form.channelId) {
        setOperationFormError('所选 VA 账户未绑定开户银行通道，不能提交 VA 出款。');
        return;
      }
      if (!form.channelId || !form.beneficiaryId) {
        setOperationFormError('请选择资金通道和收款人。');
        return;
      }
      if (operationFeesLoading || operationFeeCustomerId !== form.customerId) {
        setOperationFormError('客户转出手续费仍在加载，请稍后再提交。');
        return;
      }
      if (operationFeesError) {
        setOperationFormError(`客户转出手续费加载失败：${operationFeesError}`);
        return;
      }
    }
    setOperationFormError('');
    setOperationSubmitting(true);
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
        const selectedChannel = channels.find((channel) => channel.id === form.channelId);
        const matchingFeeRules = selectedChannel
          ? operationWithdrawalFees.filter(
              (rule) =>
                rule.assetClass === 'FIAT' &&
                rule.currency === form.currency &&
                rule.method === form.payoutMethod &&
                rule.channelCode === selectedChannel.code &&
                rule.active
            )
          : [];
        const feeRule =
          matchingFeeRules.find(
            (rule) => rule.scope === 'CUSTOMER' && rule.customerId === form.customerId
          ) || matchingFeeRules.find((rule) => rule.scope === 'ORGANIZATION');
        if (!feeRule) throw new Error('当前渠道尚未配置生效的转出手续费');
        Object.assign(payload, {
          channelId: form.channelId,
          beneficiaryId: form.beneficiaryId,
          payoutMethod: form.payoutMethod,
          expectedFeeAmount: feeRule.amount,
          expectedFeeRuleVersion: feeRule.version,
        });
      }
      if (copy.type === 'FX' || copy.type === 'OTC') payload.quoteCurrency = form.quoteCurrency;
      if (copy.type === 'ADJUSTMENT') payload.adjustmentDirection = form.adjustmentDirection;
      await coreApi('/operations', { method: 'POST', body: JSON.stringify(payload), userId });
      setCreateOpen(false);
      setSuccess('已提交，授权管理员可直接审批');
      await load();
    } catch (value) {
      setOperationFormError(value instanceof Error ? value.message : '提交失败');
    } finally {
      setOperationSubmitting(false);
    }
  };

  const perform = async (action: 'approve' | 'reject' | 'execute') => {
    if (!selected) return;
    setError('');
    setActionError('');
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
        approve: '审批通过',
        reject: '已拒绝并释放冻结资金',
        execute: '出款执行完成',
      };
      setSuccess(messages[action]);
      await load();
    } catch (value) {
      setActionError(value instanceof Error ? value.message : '操作失败');
    }
  };

  const openChannelEditor = (channel?: FundingChannel) => {
    setEditingChannel(channel || null);
    setChannelForm(
      channel
        ? {
            code: channel.code,
            name: channel.name,
            type: channel.type,
            supportedCurrencies: channel.supportedCurrencies,
            active: channel.active,
            settlementBankName: channel.settlementBankName || '',
            swiftBic: channel.swiftBic || '',
            bankCountry: channel.bankCountry || '',
            bankAddress: channel.bankAddress || '',
          }
        : initialChannelForm
    );
    setChannelFormError('');
    setChannelEditorOpen(true);
  };

  const saveChannel = async (event: FormEvent) => {
    event.preventDefault();
    const name = channelForm.name.trim();
    const code = channelForm.code.trim().toUpperCase();
    if (!name) {
      setChannelFormError('请输入通道名称。');
      return;
    }
    if (!editingChannel && !/^[A-Z0-9]+(?:-[A-Z0-9]+)*$/.test(code)) {
      setChannelFormError('通道代码只能使用大写字母、数字和连字符，例如 BANK-IN-01。');
      return;
    }
    if (!channelForm.supportedCurrencies.length) {
      setChannelFormError('请至少选择一种支持币种。');
      return;
    }
    if (
      channelForm.type === 'VIRTUAL_ACCOUNT' &&
      channelForm.active &&
      (!channelForm.settlementBankName.trim() ||
        !channelForm.swiftBic.trim() ||
        !channelForm.bankCountry.trim() ||
        !channelForm.bankAddress.trim())
    ) {
      setChannelFormError('启用 VA 开户通道前，请完整填写银行名称、国家、地址和 SWIFT / BIC。');
      return;
    }
    setChannelSaving(true);
    setChannelFormError('');
    try {
      const isVirtualAccountChannel = channelForm.type === 'VIRTUAL_ACCOUNT';
      const body = {
        ...(!editingChannel
          ? {
              organizationId: demoOrganizationId,
              code,
              type: channelForm.type,
            }
          : {}),
        name,
        supportedCurrencies: channelForm.supportedCurrencies,
        ...(editingChannel ? { active: channelForm.active } : {}),
        ...(isVirtualAccountChannel
          ? {
              settlementBankName: channelForm.settlementBankName.trim(),
              swiftBic: channelForm.swiftBic.trim().toUpperCase(),
              bankCountry: channelForm.bankCountry.trim().toUpperCase(),
              bankAddress: channelForm.bankAddress.trim(),
            }
          : {}),
      };
      await coreApi(
        editingChannel ? `/funding-channels/${editingChannel.id}` : '/funding-channels',
        {
          method: editingChannel ? 'PATCH' : 'POST',
          body: JSON.stringify(body),
          userId,
        }
      );
      setChannelEditorOpen(false);
      let successMessage = '资金通道配置已保存。';
      if (!editingChannel && channelForm.type === 'VIRTUAL_ACCOUNT') {
        successMessage = 'VA 银行通道已创建并保持停用；核对银行固定资料后可编辑启用。';
      } else if (!editingChannel) {
        successMessage = '资金通道已创建并保持停用；确认通道与支持币种后可编辑启用。';
      }
      setSuccess(successMessage);
      await load();
    } catch (value) {
      setChannelFormError(channelErrorMessage(value));
    } finally {
      setChannelSaving(false);
    }
  };

  const saveWithdrawalFee = async (
    scope: WithdrawalFeeScope,
    amount: string,
    current?: WithdrawalFeeRule
  ) => {
    setError('');
    try {
      await coreApi(current ? `/withdrawal-fees/${current.id}` : '/withdrawal-fees', {
        method: current ? 'PATCH' : 'POST',
        userId,
        body: JSON.stringify(
          current
            ? { amount, active: true, version: current.version }
            : { ...scope, organizationId: demoOrganizationId, amount, active: true }
        ),
      });
      setSuccess('转出手续费配置已保存；已提交交易的费用快照不会改变。');
      await load();
    } catch (value) {
      setError(value instanceof Error ? value.message : '手续费保存失败');
      throw value;
    }
  };

  const deactivateRate = async () => {
    if (!rateDeactivateTarget) return;
    setRateDeactivating(true);
    setError('');
    try {
      await coreApi(`/rates/${rateDeactivateTarget.id}/deactivate`, {
        method: 'PATCH',
        userId,
        body: JSON.stringify({}),
      });
      setRateDeactivateTarget(null);
      setSuccess('汇率版本已停用；历史交易快照保持不变。');
      await load();
    } catch (value) {
      setError(value instanceof Error ? value.message : '汇率版本停用失败');
    } finally {
      setRateDeactivating(false);
    }
  };

  let workspaceContent = (
    <>
      <Stack direction={{ xs: 'column', md: 'row' }} spacing={2}>
        <Metric
          title="待审批"
          value={summary.submitted}
          color="warning"
          icon="solar:clipboard-check-bold-duotone"
          onClick={() => setOperationStatus('SUBMITTED')}
        />
        <Metric
          title="执行中"
          value={summary.processing}
          color="info"
          icon="solar:hourglass-line-bold-duotone"
          onClick={() => setOperationStatus('PROCESSING')}
        />
        <Metric
          title="已完成"
          value={summary.completed}
          color="success"
          icon="solar:check-circle-bold-duotone"
          onClick={() => setOperationStatus('COMPLETED')}
        />
      </Stack>
      <Card>
        <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ p: 2.5 }}>
          <Typography variant="h6">业务记录</Typography>
          <FormControl size="small" sx={{ minWidth: 140 }}>
            <InputLabel>状态</InputLabel>
            <Select
              label="状态"
              value={status}
              onChange={(event) => setOperationStatus(event.target.value)}
            >
              <MenuItem value="all">全部</MenuItem>
              <MenuItem value="SUBMITTED">待审批</MenuItem>
              <MenuItem value="APPROVED">已批准</MenuItem>
              <MenuItem value="PROCESSING">执行中</MenuItem>
              <MenuItem value="COMPLETED">已完成</MenuItem>
              <MenuItem value="REJECTED">已拒绝</MenuItem>
              <MenuItem value="FAILED">失败</MenuItem>
              <MenuItem value="CANCELLED">已取消</MenuItem>
            </Select>
          </FormControl>
        </Stack>
        <OperationTable
          rows={visibleOperations}
          loading={loading}
          onOpen={(operation) => {
            setActionError('');
            setSelected(operation);
          }}
        />
      </Card>
    </>
  );
  if (section === 'channels') {
    workspaceContent = (
      <ChannelWorkspace
        channels={channels}
        withdrawalFees={withdrawalFees}
        loading={loading}
        onCreate={() => openChannelEditor()}
        onEdit={openChannelEditor}
        onRefresh={() => load().catch(() => undefined)}
        onSaveFee={saveWithdrawalFee}
      />
    );
  }
  if (section === 'accounts') {
    workspaceContent = (
      <AccountWorkspace
        customers={customers}
        selectedCustomer={selectedCustomer}
        requestedCustomerId={requestedCustomerId}
        onCustomerChange={setSelectedCustomerId}
        accounts={displayAccounts}
        cryptoWallets={cryptoWallets}
        cryptoWalletsLoading={cryptoWalletsLoading}
        cryptoWalletsError={cryptoWalletsError}
        loading={loading}
        marketQuotes={marketQuotes}
        marketLoading={marketLoading}
        marketError={marketError}
        onRefresh={() => load().catch(() => undefined)}
        onRefreshMarket={loadMarketQuotes}
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
    workspaceContent = (
      <RateWorkspace
        rows={rates}
        marketQuotes={marketQuotes}
        marketLoading={marketLoading}
        marketError={marketError}
        onRefreshMarket={loadMarketQuotes}
        onCreate={() => setRateOpen(true)}
        onDeactivate={setRateDeactivateTarget}
      />
    );
  }
  if (section === 'ledger')
    workspaceContent = <LedgerWorkspace rows={journals} loading={loading} />;

  return (
    <>
      <Helmet>
        <title>{copy.title} | SSC Digital Bank</title>
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
              {copy.type && (
                <Button
                  variant="contained"
                  startIcon={<Iconify icon="solar:add-circle-linear" />}
                  onClick={openCreate}
                >
                  新建{copy.title}
                </Button>
              )}
              {section === 'channels' && (
                <Button
                  variant="contained"
                  startIcon={<Iconify icon={UI_ICONS.add} />}
                  onClick={() => openChannelEditor()}
                >
                  新增资金通道
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
          {section === 'channels' ? (
            <Alert severity="info">
              通道配置只决定后续业务可选择的资金路径；不会自动记账、结算或发起银行转账。
            </Alert>
          ) : (
            <Alert severity="info">
              当前为单人审批模式：一名授权管理员可以提交并审批；银行流水号或链上 Tx Hash
              仍需在实际执行后人工回填。
            </Alert>
          )}

          {workspaceContent}
        </Stack>
      </Container>

      {copy.type && (
        <OperationDialog
          open={createOpen}
          type={copy.type}
          form={form}
          setForm={updateOperationForm}
          customers={customers}
          accounts={availableAccounts}
          accountsCustomerId={customerDetail?.id}
          beneficiaries={beneficiaries}
          channels={channels}
          withdrawalFees={operationWithdrawalFees}
          withdrawalFeesCustomerId={operationFeeCustomerId}
          withdrawalFeesLoading={operationFeesLoading}
          withdrawalFeesError={operationFeesError}
          error={operationFormError}
          submitting={operationSubmitting}
          onClose={() => {
            if (!operationSubmitting) {
              setCreateOpen(false);
              setOperationFormError('');
            }
          }}
          onSubmit={submit}
        />
      )}
      <OperationDrawer
        operation={selected}
        currentUserId={userId}
        actionError={actionError}
        onClose={() => setSelected(null)}
        onApprove={() => perform('approve').catch(() => undefined)}
        onReject={() => {
          setRejectReason('');
          setActionError('');
          setRejectOpen(true);
        }}
        onExecute={() => {
          setExternalReference('');
          setActionError('');
          setExecuteOpen(true);
        }}
      />
      <Dialog open={rejectOpen} onClose={() => setRejectOpen(false)} fullWidth maxWidth="sm">
        <DialogTitle>拒绝业务指令</DialogTitle>
        <DialogContent>
          {actionError && (
            <Alert severity="error" sx={{ mt: 1 }}>
              {actionError}
            </Alert>
          )}
          <TextField
            required
            fullWidth
            multiline
            minRows={3}
            label="拒绝原因"
            value={rejectReason}
            onChange={(e) => {
              setRejectReason(e.target.value);
              setActionError('');
            }}
            sx={{ mt: 1 }}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setRejectOpen(false)}>取消</Button>
          <Button
            color="error"
            variant="contained"
            disabled={!rejectReason.trim()}
            onClick={() => perform('reject').catch(() => undefined)}
          >
            确认拒绝
          </Button>
        </DialogActions>
      </Dialog>
      <Dialog open={executeOpen} onClose={() => setExecuteOpen(false)} fullWidth maxWidth="sm">
        <DialogTitle>完成银行出款</DialogTitle>
        <DialogContent>
          {actionError && (
            <Alert severity="error" sx={{ mt: 1 }}>
              {actionError}
            </Alert>
          )}
          <TextField
            required
            fullWidth
            label="银行/渠道流水号"
            value={externalReference}
            onChange={(e) => {
              setExternalReference(e.target.value);
              setActionError('');
            }}
            sx={{ mt: 1 }}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setExecuteOpen(false)}>取消</Button>
          <Button
            variant="contained"
            disabled={!externalReference.trim()}
            onClick={() => perform('execute').catch(() => undefined)}
          >
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
      <ChannelEditorDrawer
        open={channelEditorOpen}
        channel={editingChannel}
        form={channelForm}
        saving={channelSaving}
        error={channelFormError}
        onChange={setChannelForm}
        onClose={() => {
          if (!channelSaving) setChannelEditorOpen(false);
        }}
        onSubmit={saveChannel}
      />
      <RateDialog
        open={rateOpen}
        marketQuotes={marketQuotes}
        marketLoading={marketLoading}
        marketError={marketError}
        onRefreshMarket={loadMarketQuotes}
        onClose={() => setRateOpen(false)}
        onCreated={() => {
          setRateOpen(false);
          setSuccess('FastForex 实时中间价与配置费率已生成新版本，历史版本已保留');
          load().catch(() => undefined);
        }}
        userId={userId}
      />
      <Dialog
        open={Boolean(rateDeactivateTarget)}
        onClose={() => !rateDeactivating && setRateDeactivateTarget(null)}
        fullWidth
        maxWidth="sm"
      >
        <DialogTitle>停用汇率版本</DialogTitle>
        <DialogContent>
          <Alert severity="warning" sx={{ mt: 1 }}>
            停用后该版本不再用于新业务；历史交易保存的汇率快照不会改变。
          </Alert>
          {rateDeactivateTarget && (
            <Typography sx={{ mt: 2 }}>
              {rateDeactivateTarget.type} · {rateDeactivateTarget.baseCurrency}/
              {rateDeactivateTarget.quoteCurrency} · 基准 {rateDeactivateTarget.sellRate} · 费率{' '}
              {rateDeactivateTarget.feeBps} bps
            </Typography>
          )}
        </DialogContent>
        <DialogActions>
          <Button disabled={rateDeactivating} onClick={() => setRateDeactivateTarget(null)}>
            取消
          </Button>
          <Button
            color="error"
            variant="contained"
            disabled={rateDeactivating}
            onClick={() => deactivateRate().catch(() => undefined)}
          >
            {rateDeactivating ? '停用中…' : '确认停用'}
          </Button>
        </DialogActions>
      </Dialog>
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
                <TableCell>类型</TableCell>
                <TableCell>币种</TableCell>
                <TableCell>机构 / 网络</TableCell>
                <TableCell>收款信息</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {rows.map((row) => (
                <TableRow key={row.id}>
                  <TableCell>{row.name}</TableCell>
                  <TableCell>
                    <Label color={row.type === 'CRYPTO' ? 'success' : 'info'}>
                      {row.type === 'CRYPTO' ? '数字货币' : '银行账户'}
                    </Label>
                  </TableCell>
                  <TableCell>{row.currency}</TableCell>
                  <TableCell>
                    {row.type === 'CRYPTO' ? `${row.network} (TRC20)` : row.bankName}
                  </TableCell>
                  <TableCell>
                    {row.type === 'CRYPTO'
                      ? `${row.walletAddress?.slice(0, 7)}…${row.walletAddress?.slice(-6)}`
                      : `${row.accountNumber}${row.swiftBic ? ` · ${row.swiftBic}` : ''}`}
                  </TableCell>
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

function RateWorkspace({
  rows,
  marketQuotes,
  marketLoading,
  marketError,
  onRefreshMarket,
  onCreate,
  onDeactivate,
}: {
  rows: RateVersion[];
  marketQuotes: MarketQuote[];
  marketLoading: boolean;
  marketError: string;
  onRefreshMarket: () => Promise<void>;
  onCreate: () => void;
  onDeactivate: (row: RateVersion) => void;
}) {
  return (
    <Stack spacing={2}>
      <Card sx={{ p: 2.5 }}>
        <Stack
          direction={{ xs: 'column', sm: 'row' }}
          justifyContent="space-between"
          alignItems={{ xs: 'flex-start', sm: 'center' }}
          gap={2}
        >
          <Box>
            <Stack direction="row" alignItems="center" gap={1} flexWrap="wrap">
              <Typography variant="h6">FastForex 实时行情</Typography>
              <Chip size="small" label="实时中间价" color="info" variant="outlined" />
            </Stack>
            <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
              版本只配置费率策略。页面展示和指令提交都会由服务端获取 FastForex
              实时中间价，再动态计算含费率报价。
            </Typography>
          </Box>
          <Button
            variant="outlined"
            disabled={marketLoading}
            onClick={() => onRefreshMarket().catch(() => undefined)}
            startIcon={<Iconify icon={ACTION_ICONS.refresh} />}
          >
            {marketLoading ? '刷新中…' : '刷新行情'}
          </Button>
        </Stack>
        {marketError && (
          <Alert severity="warning" sx={{ mt: 2 }}>
            {marketError}
          </Alert>
        )}
        <Box
          sx={{
            display: 'grid',
            gridTemplateColumns: {
              xs: '1fr',
              sm: 'repeat(2, minmax(0, 1fr))',
              lg: 'repeat(3, minmax(0, 1fr))',
            },
            gap: 2,
            mt: 2,
          }}
        >
          {marketQuotes.map((quote) => (
            <Box key={`${quote.baseCurrency}/${quote.quoteCurrency}`}>
              <Typography variant="caption" color="text.secondary">
                1 {quote.baseCurrency} =
              </Typography>
              <Typography variant="h4">
                {quote.rate} {quote.quoteCurrency}
              </Typography>
              <Typography variant="caption" color="text.secondary">
                数据时间：{new Date(quote.updatedAt).toLocaleString('zh-CN')}
              </Typography>
            </Box>
          ))}
        </Box>
      </Card>

      <Card>
        <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ p: 2.5 }}>
          <Box>
            <Typography variant="h6">当前与历史汇率</Typography>
            <Typography variant="body2" color="text.secondary">
              生效版本按实时行情动态报价；创建时行情仅作为审计快照。每笔交易在提交时重新取价并保存成交快照。
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
                <TableCell>版本性质</TableCell>
                <TableCell>实时 / 审计中间价</TableCell>
                <TableCell>费率</TableCell>
                <TableCell>含费率报价</TableCell>
                <TableCell>行情 / 版本时间</TableCell>
                <TableCell>状态</TableCell>
                <TableCell align="right">操作</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {rows.map((row) => {
                const isMarketSnapshot = row.buyRate === row.sellRate;
                const displayedRate = row.active ? row.marketRate : row.sellRate;
                const displayedCustomerRate = row.active ? row.customerRate : undefined;
                let versionNature = '旧版手工双边价';
                if (row.active) versionNature = 'FastForex 实时 + 费率策略';
                else if (isMarketSnapshot) versionNature = '历史审计快照';
                return (
                  <TableRow key={row.id}>
                    <TableCell>{row.type}</TableCell>
                    <TableCell>
                      {row.baseCurrency}/{row.quoteCurrency}
                    </TableCell>
                    <TableCell>{versionNature}</TableCell>
                    <TableCell>
                      {row.active && row.marketUnavailable
                        ? '实时行情暂不可用'
                        : displayedRate || '—'}
                    </TableCell>
                    <TableCell>
                      {row.feeBps} bps ({(row.feeBps / 100).toFixed(2)}%)
                    </TableCell>
                    <TableCell>
                      {displayedCustomerRate || (row.active ? '—' : '历史交易各自留存')}
                    </TableCell>
                    <TableCell>
                      {row.active && row.marketUpdatedAt
                        ? new Date(row.marketUpdatedAt).toLocaleString('zh-CN')
                        : new Date(row.effectiveFrom).toLocaleString('zh-CN')}
                    </TableCell>
                    <TableCell>
                      <Label color={row.active ? 'success' : 'default'}>
                        {row.active ? '生效中' : '历史'}
                      </Label>
                    </TableCell>
                    <TableCell align="right">
                      {row.active && (
                        <Button size="small" color="error" onClick={() => onDeactivate(row)}>
                          停用
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </TableContainer>
      </Card>
    </Stack>
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

function RateDialog({
  open,
  userId,
  marketQuotes,
  marketLoading,
  marketError,
  onRefreshMarket,
  onClose,
  onCreated,
}: {
  open: boolean;
  userId: string;
  marketQuotes: MarketQuote[];
  marketLoading: boolean;
  marketError: string;
  onRefreshMarket: () => Promise<void>;
  onClose: () => void;
  onCreated: () => void;
}) {
  const [type, setType] = useState<'FX' | 'OTC'>('FX');
  const [baseCurrency, setBaseCurrency] = useState<Currency>('USD');
  const [quoteCurrency, setQuoteCurrency] = useState<Currency>('HKD');
  const [feeBps, setFeeBps] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const availableQuotes = useMemo(
    () =>
      marketQuotes.filter((quote) =>
        type === 'FX'
          ? quote.baseCurrency !== 'USDT' && quote.quoteCurrency !== 'USDT'
          : quote.baseCurrency === 'USDT' || quote.quoteCurrency === 'USDT'
      ),
    [marketQuotes, type]
  );
  const selectedQuote = availableQuotes.find(
    (quote) => quote.baseCurrency === baseCurrency && quote.quoteCurrency === quoteCurrency
  );
  useEffect(() => {
    if (!open) return;
    setType('FX');
    setBaseCurrency('USD');
    setQuoteCurrency('HKD');
    setFeeBps('');
    setError('');
    setSubmitting(false);
  }, [open]);
  useEffect(() => {
    if (!open || selectedQuote || !availableQuotes[0]) return;
    setBaseCurrency(availableQuotes[0].baseCurrency);
    setQuoteCurrency(availableQuotes[0].quoteCurrency);
  }, [availableQuotes, open, selectedQuote]);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const fee = Number(feeBps);
    if (!selectedQuote) {
      setError('所选币对没有可用的 FastForex 实时行情，请刷新后重试。');
      return;
    }
    if (!Number.isInteger(fee) || fee < 0 || fee > 9999) {
      setError('费率必须是 0 至 9999 之间的整数 bps。');
      return;
    }
    setError('');
    setSubmitting(true);
    try {
      await coreApi('/rates/from-market', {
        method: 'POST',
        userId,
        body: JSON.stringify({
          type,
          baseCurrency,
          quoteCurrency,
          feeBps: fee,
          provider: selectedQuote.provider,
          priceType: selectedQuote.priceType,
          referenceOnly: selectedQuote.referenceOnly,
          referenceRate: selectedQuote.rate,
          sourceUpdatedAt: selectedQuote.updatedAt,
          sourceFetchedAt: selectedQuote.fetchedAt,
        }),
      });
      onCreated();
    } catch (value) {
      setError(value instanceof Error ? value.message : '保存失败');
    } finally {
      setSubmitting(false);
    }
  };
  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="sm">
      <Box component="form" onSubmit={submit} noValidate>
        <DialogTitle>新建费率策略版本</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ mt: 1 }}>
            {error && <Alert severity="error">{error}</Alert>}
            {marketError && <Alert severity="warning">{marketError}</Alert>}
            <FormControl fullWidth>
              <InputLabel>类型</InputLabel>
              <Select
                label="类型"
                value={type}
                onChange={(event) => {
                  const nextType = event.target.value as 'FX' | 'OTC';
                  setType(nextType);
                  setError('');
                  const nextQuote = marketQuotes.find((quote) =>
                    nextType === 'FX'
                      ? quote.baseCurrency !== 'USDT' && quote.quoteCurrency !== 'USDT'
                      : quote.baseCurrency === 'USDT' || quote.quoteCurrency === 'USDT'
                  );
                  setBaseCurrency(nextQuote?.baseCurrency || 'USD');
                  setQuoteCurrency(
                    nextQuote?.quoteCurrency || (nextType === 'OTC' ? 'USDT' : 'HKD')
                  );
                }}
              >
                <MenuItem value="FX">法币换汇</MenuItem>
                <MenuItem value="OTC">OTC</MenuItem>
              </Select>
            </FormControl>
            <FormControl fullWidth disabled={marketLoading || !availableQuotes.length}>
              <InputLabel>FastForex 币对</InputLabel>
              <Select
                label="FastForex 币对"
                value={`${baseCurrency}/${quoteCurrency}`}
                onChange={(event) => {
                  const quote = availableQuotes.find(
                    (item) => `${item.baseCurrency}/${item.quoteCurrency}` === event.target.value
                  );
                  if (quote) {
                    setBaseCurrency(quote.baseCurrency);
                    setQuoteCurrency(quote.quoteCurrency);
                  }
                  setError('');
                }}
              >
                {availableQuotes.map((quote) => (
                  <MenuItem
                    key={`${quote.baseCurrency}/${quote.quoteCurrency}`}
                    value={`${quote.baseCurrency}/${quote.quoteCurrency}`}
                  >
                    {quote.baseCurrency}/{quote.quoteCurrency}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
            {selectedQuote && (
              <Alert severity="info">
                FastForex 中间价：1 {selectedQuote.baseCurrency} = {selectedQuote.rate}{' '}
                {selectedQuote.quoteCurrency}
                <br />
                行情时间：{new Date(selectedQuote.updatedAt).toLocaleString('zh-CN')}
              </Alert>
            )}
            <TextField
              required
              type="number"
              label="费率 (bps)"
              value={feeBps}
              helperText="动态报价 = 提交时 FastForex 实时中间价 × (1 − 费率 / 10000)"
              inputProps={{ min: 0, max: 9999, step: 1 }}
              onChange={(event) => {
                setFeeBps(event.target.value);
                setError('');
              }}
            />
            {selectedQuote && feeBps !== '' && Number.isFinite(Number(feeBps)) && (
              <Typography variant="body2" color="text.secondary">
                当前预览（提交时会重新取价）：
                {(Number(selectedQuote.rate) * (1 - Number(feeBps) / 10000))
                  .toFixed(12)
                  .replace(/\.?0+$/, '')}{' '}
                {selectedQuote.quoteCurrency}
              </Typography>
            )}
            <Button
              variant="text"
              disabled={marketLoading}
              onClick={() => onRefreshMarket().catch(() => undefined)}
            >
              {marketLoading ? '正在刷新 FastForex…' : '刷新 FastForex 行情'}
            </Button>
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button disabled={submitting} onClick={onClose}>
            取消
          </Button>
          <Button
            type="submit"
            variant="contained"
            disabled={submitting || marketLoading || !selectedQuote}
          >
            {submitting ? '创建中…' : '创建版本'}
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
  onClick,
}: {
  title: string;
  value: number;
  color: 'warning' | 'info' | 'success';
  icon: string;
  onClick: () => void;
}) {
  return (
    <Card sx={{ flex: 1 }}>
      <CardActionArea onClick={onClick} aria-label={`筛选${title}业务`}>
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
      </CardActionArea>
    </Card>
  );
}

function ChannelWorkspace({
  channels,
  withdrawalFees,
  loading,
  onCreate,
  onEdit,
  onRefresh,
  onSaveFee,
}: {
  channels: FundingChannel[];
  withdrawalFees: WithdrawalFeeRule[];
  loading: boolean;
  onCreate: () => void;
  onEdit: (channel: FundingChannel) => void;
  onRefresh: () => void;
  onSaveFee: (
    scope: WithdrawalFeeScope,
    amount: string,
    current?: WithdrawalFeeRule
  ) => Promise<void>;
}) {
  if (loading) {
    return (
      <Stack spacing={1.5} aria-label="正在加载资金通道">
        {[0, 1, 2].map((item) => (
          <Skeleton key={item} variant="rounded" height={124} />
        ))}
      </Stack>
    );
  }

  const legacyVaPayoutCount = channels.filter((channel) => channel.type === 'VA_PAYOUT').length;
  const configuredChannels = channels.filter((channel) => channel.type !== 'VA_PAYOUT');

  if (!configuredChannels.length) {
    return (
      <Stack spacing={2}>
        <Card variant="outlined">
          <Stack alignItems="center" spacing={2} sx={{ px: 3, py: { xs: 6, md: 9 } }}>
            <Box
              sx={{
                width: 56,
                height: 56,
                borderRadius: '50%',
                bgcolor: 'background.neutral',
                color: 'text.secondary',
                display: 'grid',
                placeItems: 'center',
              }}
            >
              <Iconify icon="solar:buildings-2-bold-duotone" width={30} />
            </Box>
            <Box sx={{ textAlign: 'center', maxWidth: 520 }}>
              <Typography variant="h6">还没有资金通道</Typography>
              <Typography variant="body2" color="text.secondary" sx={{ mt: 0.75 }}>
                创建通道后，入账和出款表单才能选择对应路径。每个 VA 银行通道同时绑定开户和该 VA
                的后续转出。
              </Typography>
            </Box>
            <Button
              variant="contained"
              startIcon={<Iconify icon={UI_ICONS.add} />}
              onClick={onCreate}
            >
              创建第一个通道
            </Button>
          </Stack>
        </Card>
        <WithdrawalFeeWorkspace channels={[]} rules={withdrawalFees} onSave={onSaveFee} />
      </Stack>
    );
  }

  const activeCount = configuredChannels.filter((channel) => channel.active).length;
  const inboundCount = configuredChannels.filter(
    (channel) => channel.type === 'FIAT_INBOUND'
  ).length;
  const vaCount = configuredChannels.filter((channel) => channel.type === 'VIRTUAL_ACCOUNT').length;
  const payoutCount = configuredChannels.length - inboundCount - vaCount;

  return (
    <Stack spacing={2}>
      <Box
        sx={{
          display: 'grid',
          gridTemplateColumns: {
            xs: '1fr',
            sm: 'repeat(2, minmax(0, 1fr))',
            lg: 'repeat(4, minmax(0, 1fr))',
          },
          border: 1,
          borderColor: 'divider',
          borderRadius: 2,
          overflow: 'hidden',
          bgcolor: 'background.paper',
        }}
      >
        {[
          ['可用通道', `${activeCount} / ${configuredChannels.length}`],
          ['入账路径', inboundCount],
          ['VA 银行', vaCount],
          ['出款路径', payoutCount],
        ].map(([label, value], index) => (
          <Box
            key={label}
            sx={{
              px: 2.5,
              py: 2,
              borderLeft: {
                xs: 0,
                sm: index % 2 ? 1 : 0,
                lg: index ? 1 : 0,
              },
              borderTop: {
                xs: index ? 1 : 0,
                sm: index > 1 ? 1 : 0,
                lg: 0,
              },
              borderColor: 'divider',
            }}
          >
            <Typography variant="caption" color="text.secondary">
              {label}
            </Typography>
            <Typography variant="h5" sx={{ mt: 0.25 }}>
              {value}
            </Typography>
          </Box>
        ))}
      </Box>

      {legacyVaPayoutCount > 0 && (
        <Alert severity="info">
          已保留 {legacyVaPayoutCount} 条旧版 VA 出款通道供历史记录读取；新开户和新出款均改用对应的
          VA 银行通道。
        </Alert>
      )}

      <Card variant="outlined">
        <Stack
          direction={{ xs: 'column', sm: 'row' }}
          alignItems={{ xs: 'flex-start', sm: 'center' }}
          justifyContent="space-between"
          gap={1.5}
          sx={{ px: 2.5, py: 2 }}
        >
          <Box>
            <Typography variant="h6">通道配置</Typography>
            <Typography variant="body2" color="text.secondary">
              停用只阻止新业务选择，历史记录和账本仍会保留。
            </Typography>
          </Box>
          <Button
            variant="text"
            startIcon={<Iconify icon={ACTION_ICONS.refresh} />}
            onClick={onRefresh}
          >
            刷新状态
          </Button>
        </Stack>
        <Divider />
        <Stack divider={<Divider flexItem />}>
          {configuredChannels.map((channel) => {
            const copy = channelTypeCopy[channel.type];
            return (
              <Box
                key={channel.id}
                sx={{
                  display: 'grid',
                  gridTemplateColumns: {
                    xs: '1fr',
                    md: 'minmax(300px, 1.4fr) minmax(170px, .7fr) minmax(220px, 1fr) auto',
                  },
                  alignItems: 'center',
                  gap: { xs: 1.5, md: 2.5 },
                  px: 2.5,
                  py: 2.25,
                }}
              >
                <Stack direction="row" spacing={1.5} alignItems="flex-start">
                  <Box
                    sx={{
                      width: 42,
                      height: 42,
                      flex: '0 0 auto',
                      borderRadius: 1.5,
                      bgcolor: 'background.neutral',
                      color: 'primary.main',
                      display: 'grid',
                      placeItems: 'center',
                    }}
                  >
                    <Iconify icon={copy.icon} width={23} />
                  </Box>
                  <Box sx={{ minWidth: 0 }}>
                    <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap">
                      <Typography variant="subtitle1">{channel.name}</Typography>
                      <Chip
                        color={channel.active ? 'success' : 'default'}
                        label={channel.active ? '启用' : '停用'}
                        size="small"
                      />
                    </Stack>
                    <Typography variant="caption" color="text.secondary">
                      {channel.code} · {copy.label}
                    </Typography>
                    <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
                      {copy.description}
                    </Typography>
                  </Box>
                </Stack>
                <Box>
                  <Typography variant="caption" color="text.secondary">
                    支持币种
                  </Typography>
                  <Stack direction="row" flexWrap="wrap" gap={0.75} sx={{ mt: 0.5 }}>
                    {channel.supportedCurrencies.map((currency) => (
                      <Chip key={currency} label={currency} size="small" variant="outlined" />
                    ))}
                  </Stack>
                </Box>
                {channel.type !== 'VIRTUAL_ACCOUNT' ? (
                  <Box>
                    <Typography variant="caption" color="text.secondary">
                      配置要求
                    </Typography>
                    <Typography variant="body2" sx={{ mt: 0.5 }}>
                      无需银行与结算资料
                    </Typography>
                  </Box>
                ) : (
                  <Box>
                    <Typography variant="caption" color="text.secondary">
                      银行资料
                    </Typography>
                    <Typography variant="body2" sx={{ mt: 0.5 }}>
                      {channel.settlementBankName || '未配置银行'}
                    </Typography>
                    <Typography variant="caption" color="text.secondary">
                      {[channel.swiftBic, channel.bankCountry].filter(Boolean).join(' · ') ||
                        '未配置银行资料'}
                    </Typography>
                  </Box>
                )}
                <Button
                  variant="outlined"
                  startIcon={<Iconify icon={ACTION_ICONS.edit} />}
                  onClick={() => onEdit(channel)}
                  sx={{ justifySelf: { xs: 'stretch', md: 'end' } }}
                >
                  编辑配置
                </Button>
              </Box>
            );
          })}
        </Stack>
      </Card>
      <WithdrawalFeeWorkspace
        channels={configuredChannels}
        rules={withdrawalFees}
        onSave={onSaveFee}
      />
    </Stack>
  );
}

type WithdrawalFeeScope = Pick<
  WithdrawalFeeRule,
  'assetClass' | 'currency' | 'method' | 'channelCode' | 'network'
> & { organizationId: string };

function WithdrawalFeeWorkspace({
  channels,
  rules,
  onSave,
}: {
  channels: FundingChannel[];
  rules: WithdrawalFeeRule[];
  onSave: (scope: WithdrawalFeeScope, amount: string, current?: WithdrawalFeeRule) => Promise<void>;
}) {
  const fiatScopes: Array<{ key: string; label: string; scope: WithdrawalFeeScope }> = channels
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
        .map((currency) => ({
          key: `FIAT:${currency}:${method}:${channel.code}`,
          label: `${channel.name} · ${method} · ${currency}`,
          scope: {
            organizationId: demoOrganizationId,
            assetClass: 'FIAT' as const,
            currency,
            method,
            channelCode: channel.code,
          },
        }));
    });
  const scopes = [
    ...fiatScopes,
    {
      key: 'CRYPTO:USDT:ON_CHAIN:CREGIS:TRON',
      label: 'Cregis · 链上转出 · USDT / TRON',
      scope: {
        organizationId: demoOrganizationId,
        assetClass: 'CRYPTO' as const,
        currency: 'USDT' as const,
        method: 'ON_CHAIN' as const,
        channelCode: 'CREGIS',
        network: 'TRON' as const,
      },
    },
  ];

  return (
    <Card variant="outlined">
      <Stack sx={{ px: 2.5, py: 2 }} spacing={0.5}>
        <Typography variant="h6">转出手续费</Typography>
        <Typography variant="body2" color="text.secondary">
          按渠道、转出方式、币种和网络分别配置。保存新金额只影响之后提交的交易。
        </Typography>
      </Stack>
      <Divider />
      <Stack divider={<Divider flexItem />}>
        {scopes.map(({ key, label, scope }) => {
          const current = rules.find(
            (rule) =>
              rule.assetClass === scope.assetClass &&
              rule.currency === scope.currency &&
              rule.method === scope.method &&
              rule.channelCode === scope.channelCode &&
              (rule.network || '') === (scope.network || '')
          );
          return (
            <WithdrawalFeeEditor
              key={key}
              label={label}
              scope={scope}
              current={current}
              onSave={onSave}
            />
          );
        })}
      </Stack>
    </Card>
  );
}

function WithdrawalFeeEditor({
  label,
  scope,
  current,
  onSave,
}: {
  label: string;
  scope: WithdrawalFeeScope;
  current?: WithdrawalFeeRule;
  onSave: (scope: WithdrawalFeeScope, amount: string, current?: WithdrawalFeeRule) => Promise<void>;
}) {
  const [amount, setAmount] = useState(current?.amount || '');
  const [saving, setSaving] = useState(false);

  useEffect(() => setAmount(current?.amount || ''), [current?.amount, current?.version]);

  const save = async () => {
    if (!/^\d+(?:\.\d+)?$/.test(amount) || Number(amount) < 0) return;
    setSaving(true);
    try {
      await onSave(scope, amount, current);
    } finally {
      setSaving(false);
    }
  };

  let saveButtonLabel = '启用费用';
  if (current) saveButtonLabel = '更新费用';
  if (saving) saveButtonLabel = '保存中…';

  return (
    <Stack
      direction={{ xs: 'column', md: 'row' }}
      alignItems={{ md: 'center' }}
      gap={2}
      sx={{ px: 2.5, py: 2 }}
    >
      <Box sx={{ flex: 1, minWidth: 0 }}>
        <Typography variant="subtitle2">{label}</Typography>
        <Typography variant="caption" color="text.secondary">
          {current
            ? `当前版本 ${current.version} · ${current.active ? '生效中' : '已停用'}`
            : '尚未配置；配置前该路径不能提交转出'}
        </Typography>
      </Box>
      <TextField
        size="small"
        type="number"
        label="每笔固定手续费"
        value={amount}
        onChange={(event) => setAmount(event.target.value)}
        inputProps={{ min: 0, step: scope.assetClass === 'CRYPTO' ? 0.000001 : 0.01 }}
        InputProps={{
          endAdornment: <InputAdornment position="end">{scope.currency}</InputAdornment>,
        }}
        sx={{ width: { xs: 1, md: 230 } }}
      />
      <Button
        variant="contained"
        disabled={saving || !/^\d+(?:\.\d+)?$/.test(amount)}
        onClick={() => save().catch(() => undefined)}
      >
        {saveButtonLabel}
      </Button>
    </Stack>
  );
}

function ChannelEditorDrawer({
  open,
  channel,
  form,
  saving,
  error,
  onChange,
  onClose,
  onSubmit,
}: {
  open: boolean;
  channel: FundingChannel | null;
  form: ChannelForm;
  saving: boolean;
  error: string;
  onChange: (form: ChannelForm) => void;
  onClose: () => void;
  onSubmit: (event: FormEvent) => void;
}) {
  const set = <K extends keyof ChannelForm>(key: K, value: ChannelForm[K]) =>
    onChange({ ...form, [key]: value });
  const activeVa = form.active && form.type === 'VIRTUAL_ACCOUNT';
  const isVa = form.type === 'VIRTUAL_ACCOUNT';
  let submitLabel = channel ? '保存配置' : '创建停用通道';
  if (saving) submitLabel = '正在保存…';

  return (
    <Drawer
      anchor="right"
      open={open}
      onClose={onClose}
      PaperProps={{ sx: { width: { xs: 1, sm: 540 } } }}
    >
      <Box
        component="form"
        onSubmit={onSubmit}
        sx={{ minHeight: 1, display: 'flex', flexDirection: 'column' }}
      >
        <Stack direction="row" alignItems="flex-start" justifyContent="space-between" sx={{ p: 3 }}>
          <Box>
            <Typography variant="h5">{channel ? '编辑资金通道' : '新增资金通道'}</Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
              {channel ? '保存后只影响后续新业务。' : '新通道创建后默认停用。'}
            </Typography>
          </Box>
          <Button color="inherit" onClick={onClose} disabled={saving}>
            关闭
          </Button>
        </Stack>
        <Divider />
        <Stack spacing={2.5} sx={{ p: 3, flex: 1 }}>
          {error && <Alert severity="error">{error}</Alert>}
          {!channel && (
            <Alert severity="info">
              创建通道不会发起银行或钱包操作；完成资料核对后，需要再次编辑并明确启用。
            </Alert>
          )}
          <TextField
            required
            label="通道代码"
            value={form.code}
            disabled={Boolean(channel)}
            inputProps={{ maxLength: 40 }}
            helperText={channel ? '已创建通道的代码不可修改。' : '例如 BANK-IN-01'}
            onChange={(event) => set('code', event.target.value.toUpperCase())}
          />
          <TextField
            required
            label="通道名称"
            value={form.name}
            inputProps={{ maxLength: 80 }}
            onChange={(event) => set('name', event.target.value)}
          />
          <FormControl required>
            <InputLabel>通道类型</InputLabel>
            <Select
              label="通道类型"
              value={form.type}
              disabled={Boolean(channel)}
              onChange={(event) => set('type', event.target.value as FundingChannel['type'])}
            >
              {configurableChannelTypes.map((type) => (
                <MenuItem key={type} value={type}>
                  {channelTypeCopy[type].label}
                </MenuItem>
              ))}
            </Select>
            {channel && <FormHelperText>类型关联入账/出款校验，创建后不可修改。</FormHelperText>}
          </FormControl>
          <FormControl required>
            <InputLabel>支持币种</InputLabel>
            <Select
              multiple
              label="支持币种"
              value={form.supportedCurrencies}
              renderValue={(selected) => (selected as Currency[]).join(' / ')}
              onChange={(event) => set('supportedCurrencies', event.target.value as Currency[])}
            >
              {supportedFiatCurrencies.map((currency) => (
                <MenuItem key={currency} value={currency}>
                  <Checkbox checked={form.supportedCurrencies.includes(currency)} />
                  {currency}
                </MenuItem>
              ))}
            </Select>
          </FormControl>

          {!isVa ? (
            <Alert severity="info">
              {channelTypeCopy[form.type].label}通道无需配置银行名称、结算账号、SWIFT /
              BIC、国家、分行或银行地址。
            </Alert>
          ) : (
            <>
              <Divider>
                <Typography variant="caption" color="text.secondary">
                  银行资料
                </Typography>
              </Divider>
              <Alert severity="info">
                此处只配置银行通道固定资料。账户名称、账号和 IBAN 会在每位客户的 VA
                开通审批中按银行实际分配结果单独录入。
              </Alert>
              <TextField
                label="银行名称"
                required={activeVa}
                value={form.settlementBankName}
                onChange={(event) => set('settlementBankName', event.target.value)}
              />
              <TextField
                label="SWIFT / BIC"
                required={activeVa}
                value={form.swiftBic}
                onChange={(event) => set('swiftBic', event.target.value.toUpperCase())}
              />
              <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
                <TextField
                  fullWidth
                  label="银行国家 / 地区代码"
                  required={activeVa}
                  value={form.bankCountry}
                  inputProps={{ maxLength: 2 }}
                  helperText="ISO 两位代码，例如 HK、SG"
                  onChange={(event) => set('bankCountry', event.target.value.toUpperCase())}
                />
              </Stack>
              <TextField
                multiline
                minRows={2}
                label="银行地址"
                required={activeVa}
                value={form.bankAddress}
                onChange={(event) => set('bankAddress', event.target.value)}
              />
            </>
          )}

          {channel && (
            <FormControlLabel
              control={
                <Switch
                  checked={form.active}
                  onChange={(event) => set('active', event.target.checked)}
                />
              }
              label={form.active ? '允许新业务选择此通道' : '保持停用，不接受新业务'}
            />
          )}
        </Stack>
        <Divider />
        <Stack direction="row" justifyContent="flex-end" spacing={1.5} sx={{ p: 3 }}>
          <Button color="inherit" onClick={onClose} disabled={saving}>
            放弃更改
          </Button>
          <Button type="submit" variant="contained" disabled={saving}>
            {submitLabel}
          </Button>
        </Stack>
      </Box>
    </Drawer>
  );
}

function channelErrorMessage(value: unknown) {
  const message = value instanceof Error ? value.message : '';
  const messages: Record<string, string> = {
    funding_channel_code_exists: '这个通道代码已经存在，请使用新的唯一代码。',
    virtual_account_channel_bank_details_required:
      '启用 VA 开户通道前，请完整填写银行名称、国家、地址和 SWIFT / BIC。',
    virtual_account_channel_customer_details_not_allowed:
      'VA 银行通道不配置分行或客户账号；请在具体客户的 VA 开通审批中录入账户资料。',
    va_payout_channel_merged: 'VA 出款已与 VA 银行通道合并，请直接配置对应的 VA 银行。',
    unsupported_funding_channel_currency: '资金通道目前只支持 USD 和 HKD。',
    admin_role_required: '只有平台管理员可以修改资金通道。',
    organization_access_denied: '当前管理员无权修改这个机构的资金通道。',
  };
  return messages[message] || message || '资金通道保存失败，请稍后重试。';
}

function AccountWorkspace({
  customers,
  selectedCustomer,
  requestedCustomerId,
  onCustomerChange,
  accounts,
  cryptoWallets,
  cryptoWalletsLoading,
  cryptoWalletsError,
  loading,
  marketQuotes,
  marketLoading,
  marketError,
  onRefresh,
  onRefreshMarket,
}: {
  customers: Customer[];
  selectedCustomer?: Customer;
  requestedCustomerId: string;
  onCustomerChange: (id: string) => void;
  accounts: MoneyAccount[];
  cryptoWallets: CryptoWallet[];
  cryptoWalletsLoading: boolean;
  cryptoWalletsError: string;
  loading: boolean;
  marketQuotes: MarketQuote[];
  marketLoading: boolean;
  marketError: string;
  onRefresh: () => void;
  onRefreshMarket: () => Promise<void>;
}) {
  const [query, setQuery] = useState('');
  const [detailsOpen, setDetailsOpen] = useState(false);
  const visibleCustomers = useMemo(() => {
    const keyword = query.trim().toLowerCase();
    if (!keyword) return customers;
    return customers.filter((customer) =>
      [customer.displayName, customer.legalName, customer.email, customer.id].some((value) =>
        String(value || '')
          .toLowerCase()
          .includes(keyword)
      )
    );
  }, [customers, query]);

  useEffect(() => {
    if (!requestedCustomerId) return;
    if (!customers.some((customer) => customer.id === requestedCustomerId)) return;
    onCustomerChange(requestedCustomerId);
    setDetailsOpen(true);
  }, [customers, onCustomerChange, requestedCustomerId]);

  const openCustomer = (customerId: string) => {
    onCustomerChange(customerId);
    setDetailsOpen(true);
  };

  return (
    <Stack spacing={2}>
      <Card variant="outlined" sx={{ boxShadow: 'none', overflow: 'hidden' }}>
        <Stack
          direction={{ xs: 'column', md: 'row' }}
          alignItems={{ md: 'center' }}
          justifyContent="space-between"
          gap={2}
          sx={{ p: 2.25, borderBottom: '1px solid', borderColor: 'divider' }}
        >
          <Box>
            <Stack direction="row" alignItems="center" spacing={1}>
              <Typography variant="subtitle1">已开户客户</Typography>
              <Label color="success">{customers.length}</Label>
            </Stack>
            <Typography variant="body2" color="text.secondary" sx={{ mt: 0.35 }}>
              仅列出客户状态为 ACTIVE 且 KYC 已通过的账户。
            </Typography>
          </Box>
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.25}>
            <TextField
              size="small"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="搜索客户名称、邮箱或编号"
              inputProps={{ 'aria-label': '搜索已开户客户' }}
              InputProps={{
                startAdornment: (
                  <InputAdornment position="start">
                    <Iconify icon="solar:magnifier-linear" width={18} />
                  </InputAdornment>
                ),
              }}
              sx={{ minWidth: { sm: 300 } }}
            />
            <Button
              color="inherit"
              variant="outlined"
              startIcon={<Iconify icon={ACTION_ICONS.refresh} />}
              disabled={loading}
              onClick={onRefresh}
            >
              刷新
            </Button>
          </Stack>
        </Stack>

        <TableContainer>
          <Table sx={{ minWidth: 1120, tableLayout: 'fixed' }} aria-label="已开户客户账户列表">
            <TableHead>
              <TableRow>
                <TableCell sx={{ width: 230 }}>客户</TableCell>
                <TableCell sx={{ width: 245 }}>{SYSTEM_WALLET_PRODUCT_NAME}</TableCell>
                <TableCell sx={{ width: 205 }}>VA 账户</TableCell>
                <TableCell sx={{ width: 225 }}>数字钱包</TableCell>
                <TableCell sx={{ width: 120 }}>开户状态</TableCell>
                <TableCell align="right" sx={{ width: 110 }}>
                  操作
                </TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {loading &&
                [0, 1, 2].map((item) => (
                  <TableRow key={item} aria-label="正在读取客户账户与钱包">
                    <TableCell colSpan={6}>
                      <Skeleton height={52} />
                    </TableCell>
                  </TableRow>
                ))}
              {!loading &&
                visibleCustomers.map((customer) => {
                  const systemWallets = customer.accounts.filter(
                    (account) => account.kind === 'SYSTEM_WALLET'
                  );
                  const virtualAccounts = customer.accounts.filter(
                    (account) => account.kind === 'VIRTUAL_ACCOUNT'
                  );
                  const digitalWallets = customer.accounts.filter(
                    (account) => account.kind === 'CRYPTO_WALLET'
                  );
                  return (
                    <TableRow key={customer.id} hover>
                      <TableCell>
                        <Typography variant="subtitle2" noWrap title={customer.displayName}>
                          {customer.displayName}
                        </Typography>
                        <Typography variant="caption" color="text.secondary" noWrap>
                          {customer.type === 'BUSINESS' ? '企业' : '个人'} · {customer.countryCode}
                        </Typography>
                        <Typography
                          variant="caption"
                          color="text.disabled"
                          noWrap
                          title={customer.email}
                          sx={{ display: 'block' }}
                        >
                          {customer.email}
                        </Typography>
                      </TableCell>
                      <TableCell>
                        <CompactAccountBalances accounts={systemWallets} emptyText="账户同步中" />
                      </TableCell>
                      <TableCell>
                        <CompactAccountBalances
                          accounts={virtualAccounts}
                          emptyText="尚未开通 VA"
                          showAccountCount
                        />
                      </TableCell>
                      <TableCell>
                        <CompactAccountBalances accounts={digitalWallets} emptyText="钱包同步中" />
                      </TableCell>
                      <TableCell>
                        <Label color="success">已开户</Label>
                      </TableCell>
                      <TableCell align="right">
                        <Button
                          size="small"
                          endIcon={<Iconify icon="solar:alt-arrow-right-linear" width={16} />}
                          onClick={() => openCustomer(customer.id)}
                        >
                          查看
                        </Button>
                      </TableCell>
                    </TableRow>
                  );
                })}
              {!loading && visibleCustomers.length === 0 && (
                <TableRow>
                  <TableCell colSpan={6}>
                    <Stack
                      alignItems="center"
                      spacing={1}
                      role="status"
                      sx={{ py: 7, textAlign: 'center' }}
                    >
                      <Iconify icon="solar:users-group-rounded-linear" width={34} />
                      <Typography variant="subtitle1">
                        {query ? '没有符合搜索条件的客户' : '暂无已开户客户'}
                      </Typography>
                      <Typography variant="body2" color="text.secondary">
                        {query
                          ? '请尝试客户名称、邮箱或客户编号。'
                          : '客户完成 KYC 并激活账户后会显示在这里。'}
                      </Typography>
                    </Stack>
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </TableContainer>
      </Card>

      <AccountCustomerDrawer
        open={detailsOpen}
        customer={selectedCustomer}
        accounts={accounts}
        cryptoWallets={cryptoWallets}
        cryptoWalletsLoading={cryptoWalletsLoading}
        cryptoWalletsError={cryptoWalletsError}
        marketQuotes={marketQuotes}
        marketLoading={marketLoading}
        marketError={marketError}
        onRefresh={onRefresh}
        onRefreshMarket={onRefreshMarket}
        onClose={() => setDetailsOpen(false)}
      />
    </Stack>
  );
}

function CompactAccountBalances({
  accounts,
  emptyText,
  showAccountCount = false,
}: {
  accounts: MoneyAccount[];
  emptyText: string;
  showAccountCount?: boolean;
}) {
  if (!accounts.length) {
    return (
      <Typography variant="body2" color="text.disabled">
        {emptyText}
      </Typography>
    );
  }
  const grouped = accounts.reduce((result, account) => {
    result.set(account.currency, [...(result.get(account.currency) || []), account]);
    return result;
  }, new Map<Currency, MoneyAccount[]>());
  return (
    <Stack spacing={0.75}>
      {Array.from(grouped.entries()).map(([currency, rows]) => {
        const available = rows.reduce(
          (total, account) => total + Number(account.availableBalance),
          0
        );
        const frozen = rows.reduce((total, account) => total + Number(account.frozenBalance), 0);
        return (
          <Stack key={currency} direction="row" alignItems="center" spacing={1}>
            <AssetIcon
              asset={currency}
              network={currency === 'USDT' ? 'TRON' : undefined}
              size={19}
            />
            <Box sx={{ minWidth: 0 }}>
              <Typography variant="body2" fontWeight={700} noWrap>
                {formatMoney(String(available), currency)}
              </Typography>
              <Typography variant="caption" color="text.secondary" noWrap>
                {showAccountCount && `${rows.length} 个账户 · `}冻结{' '}
                {formatMoney(String(frozen), currency)}
              </Typography>
            </Box>
          </Stack>
        );
      })}
    </Stack>
  );
}

function AccountCustomerDrawer({
  open,
  customer,
  accounts,
  cryptoWallets,
  cryptoWalletsLoading,
  cryptoWalletsError,
  marketQuotes,
  marketLoading,
  marketError,
  onRefresh,
  onRefreshMarket,
  onClose,
}: {
  open: boolean;
  customer?: Customer;
  accounts: MoneyAccount[];
  cryptoWallets: CryptoWallet[];
  cryptoWalletsLoading: boolean;
  cryptoWalletsError: string;
  marketQuotes: MarketQuote[];
  marketLoading: boolean;
  marketError: string;
  onRefresh: () => void;
  onRefreshMarket: () => Promise<void>;
  onClose: () => void;
}) {
  const fiatAccounts = accounts.filter((account) => account.kind !== 'CRYPTO_WALLET');
  const valuation = fiatUsdValuation(fiatAccounts, marketQuotes);
  const groups = [
    {
      kind: 'SYSTEM_WALLET' as const,
      title: SYSTEM_WALLET_PRODUCT_NAME,
      description: 'USD / HKD 系统法币账户',
    },
    {
      kind: 'VIRTUAL_ACCOUNT' as const,
      title: 'VA 账户',
      description: '银行分配的独立虚拟账户',
    },
    {
      kind: 'CRYPTO_WALLET' as const,
      title: '数字钱包',
      description: 'USDT · TRON (TRC20)',
    },
  ];
  return (
    <Drawer
      anchor="right"
      open={open}
      onClose={onClose}
      PaperProps={{ sx: { width: { xs: 1, sm: 680 }, p: { xs: 2.5, sm: 3 } } }}
    >
      <Stack spacing={2.5}>
        <Stack direction="row" justifyContent="space-between" alignItems="flex-start" gap={2}>
          <Box>
            <Typography variant="overline" color="primary.main" fontWeight={800}>
              CUSTOMER ACCOUNT
            </Typography>
            <Typography variant="h5">{customer?.displayName || '客户账户'}</Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
              {customer
                ? `${customer.type === 'BUSINESS' ? '企业' : '个人'} · ${customer.email}`
                : '账户明细'}
            </Typography>
          </Box>
          <Button color="inherit" onClick={onClose} sx={{ minWidth: 44 }} aria-label="关闭账户详情">
            <Iconify icon={UI_ICONS.close} />
          </Button>
        </Stack>

        <Box sx={{ py: 2.25, borderY: '1px solid', borderColor: 'divider' }}>
          <Typography variant="overline" color="text.secondary">
            法币可用余额 · USD 参考折算
          </Typography>
          {marketLoading || !customer ? (
            <Skeleton width="72%" height={58} />
          ) : (
            <Typography variant="h3" sx={{ mt: 0.5 }}>
              {valuation.complete ? formatUsdValue(valuation.availableUsd) : '暂不可用'}
            </Typography>
          )}
          <Typography variant="body2" color="text.secondary" sx={{ mt: 0.75 }}>
            {valuation.complete
              ? `冻结折算：${formatUsdValue(valuation.frozenUsd)}`
              : marketError || `缺少 ${valuation.missingCurrencies.join(' / ')} 对 USD 参考行情`}
          </Typography>
        </Box>

        {!marketLoading && fiatAccounts.length > 0 && !valuation.complete && (
          <Alert
            severity="warning"
            action={
              <Button
                color="inherit"
                size="small"
                disabled={marketLoading}
                onClick={() => onRefreshMarket().catch(() => undefined)}
              >
                重试
              </Button>
            }
          >
            {marketError || `缺少 ${valuation.missingCurrencies.join(' / ')} 对 USD 参考行情`}
          </Alert>
        )}

        <Stack spacing={2.25}>
          {groups.map((group) => {
            const groupAccounts = accounts.filter((account) => account.kind === group.kind);
            return (
              <Box key={group.kind}>
                <Stack direction="row" justifyContent="space-between" alignItems="baseline" gap={2}>
                  <Box>
                    <Typography variant="subtitle1">{group.title}</Typography>
                    <Typography variant="caption" color="text.secondary">
                      {group.description}
                    </Typography>
                  </Box>
                  <Typography variant="caption" color="text.secondary">
                    {groupAccounts.length} 个账户
                  </Typography>
                </Stack>
                <Box sx={{ mt: 1, borderTop: '1px solid', borderColor: 'divider' }}>
                  {groupAccounts.map((account) => {
                    const wallet = cryptoWallets.find(
                      (item) =>
                        item.customerId === account.customerId &&
                        item.asset === account.currency &&
                        item.network === (account.network || 'TRON')
                    );
                    const walletPresentation =
                      account.kind === 'CRYPTO_WALLET'
                        ? digitalWalletPresentation(account, wallet, {
                            loading: cryptoWalletsLoading,
                            error: Boolean(cryptoWalletsError),
                          })
                        : null;
                    return (
                      <Stack
                        key={account.id}
                        direction="row"
                        alignItems="center"
                        justifyContent="space-between"
                        gap={2}
                        sx={{ py: 1.5, borderBottom: '1px solid', borderColor: 'divider' }}
                      >
                        <Stack
                          direction="row"
                          alignItems="center"
                          spacing={1.25}
                          sx={{ minWidth: 0 }}
                        >
                          <AssetIcon
                            asset={account.currency}
                            network={account.network || undefined}
                            size={28}
                          />
                          <Box sx={{ minWidth: 0 }}>
                            <Typography variant="body2" fontWeight={700} noWrap>
                              {account.currency}
                              {account.network ? ` · ${account.network}` : ''}
                            </Typography>
                            <Typography
                              variant="caption"
                              color="text.secondary"
                              noWrap
                              title={account.accountNumber || account.name}
                              sx={{ display: 'block', maxWidth: 300 }}
                            >
                              {account.accountNumber || account.name}
                            </Typography>
                            {walletPresentation && (
                              <Typography variant="caption" color="text.disabled">
                                {walletPresentation.description}
                              </Typography>
                            )}
                          </Box>
                        </Stack>
                        <Box sx={{ textAlign: 'right', flexShrink: 0 }}>
                          <Typography variant="body2" fontWeight={750}>
                            {formatMoney(account.availableBalance, account.currency)}
                          </Typography>
                          <Typography variant="caption" color="text.secondary">
                            冻结 {formatMoney(account.frozenBalance, account.currency)}
                          </Typography>
                          <Box sx={{ mt: 0.5 }}>
                            <Label
                              color={
                                walletPresentation?.color ||
                                (account.status === 'ACTIVE' ? 'success' : 'default')
                              }
                            >
                              {walletPresentation?.label ||
                                (account.status === 'ACTIVE' ? '可用' : account.status)}
                            </Label>
                          </Box>
                        </Box>
                      </Stack>
                    );
                  })}
                  {!groupAccounts.length && (
                    <Typography variant="body2" color="text.disabled" sx={{ py: 1.75 }}>
                      {group.kind === 'VIRTUAL_ACCOUNT' ? '尚未开通 VA 账户' : '账户同步中'}
                    </Typography>
                  )}
                </Box>
              </Box>
            );
          })}
        </Stack>

        {cryptoWalletsError && <Alert severity="warning">{cryptoWalletsError}</Alert>}
        <Stack direction="row" justifyContent="flex-end" spacing={1}>
          <Button
            color="inherit"
            startIcon={<Iconify icon={ACTION_ICONS.refresh} />}
            onClick={onRefresh}
          >
            刷新账户
          </Button>
          <Button variant="outlined" onClick={onClose}>
            关闭
          </Button>
        </Stack>
      </Stack>
    </Drawer>
  );
}

type FiatUsdValuationLine = {
  currency: Currency;
  available: number;
  frozen: number;
  rate: number | null;
  availableUsd: number | null;
  frozenUsd: number | null;
  updatedAt: string | null;
  accounts: MoneyAccount[];
};

function fiatUsdValuation(balances: MoneyAccount[], marketQuotes: MarketQuote[]) {
  const groupedBalances = balances.reduce((groups, account) => {
    groups.set(account.currency, [...(groups.get(account.currency) || []), account]);
    return groups;
  }, new Map<Currency, MoneyAccount[]>());
  const lines: FiatUsdValuationLine[] = Array.from(groupedBalances.entries()).map(
    ([currency, accounts]) => {
      const quote = marketQuotes.find(
        (item) => item.baseCurrency === currency && item.quoteCurrency === 'USD'
      );
      const parsedRate = currency === 'USD' ? 1 : Number(quote?.rate);
      const rate = Number.isFinite(parsedRate) && parsedRate > 0 ? parsedRate : null;
      const available = accounts.reduce(
        (total, account) => total + Number(account.availableBalance),
        0
      );
      const frozen = accounts.reduce((total, account) => total + Number(account.frozenBalance), 0);
      return {
        currency,
        available,
        frozen,
        rate,
        availableUsd: rate === null ? null : available * rate,
        frozenUsd: rate === null ? null : frozen * rate,
        updatedAt: currency === 'USD' ? null : quote?.updatedAt || null,
        accounts,
      };
    }
  );
  const missingCurrencies = lines.filter((line) => line.rate === null).map((line) => line.currency);
  return {
    lines,
    missingCurrencies,
    complete: missingCurrencies.length === 0,
    availableUsd: lines.reduce((total, line) => total + (line.availableUsd || 0), 0),
    frozenUsd: lines.reduce((total, line) => total + (line.frozenUsd || 0), 0),
  };
}

function formatUsdValue(value: number) {
  return formatMoney(String(value), 'USD');
}

function operationActionText(status: Operation['status']) {
  if (status === 'SUBMITTED') return '审批';
  if (status === 'PROCESSING') return '执行';
  return '查看';
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
            <TableCell align="right">操作</TableCell>
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
              <TableCell align="right">
                <Button
                  size="small"
                  variant={['SUBMITTED', 'PROCESSING'].includes(row.status) ? 'outlined' : 'text'}
                  onClick={(event) => {
                    event.stopPropagation();
                    onOpen(row);
                  }}
                >
                  {operationActionText(row.status)}
                </Button>
              </TableCell>
            </TableRow>
          ))}
          {!rows.length && (
            <TableRow>
              <TableCell colSpan={9} align="center" sx={{ py: 8, color: 'text.secondary' }}>
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
  accountsCustomerId,
  beneficiaries,
  channels,
  withdrawalFees,
  withdrawalFeesCustomerId,
  withdrawalFeesLoading,
  withdrawalFeesError,
  error,
  submitting,
  onClose,
  onSubmit,
}: {
  open: boolean;
  type: OperationType;
  form: OperationForm;
  setForm: (form: OperationForm) => void;
  customers: Customer[];
  accounts: MoneyAccount[];
  accountsCustomerId?: string;
  beneficiaries: Beneficiary[];
  channels: FundingChannel[];
  withdrawalFees: WithdrawalFeeRule[];
  withdrawalFeesCustomerId: string;
  withdrawalFeesLoading: boolean;
  withdrawalFeesError: string;
  error: string;
  submitting: boolean;
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
  if (form.payoutMethod === 'VA') payoutChannelType = 'VIRTUAL_ACCOUNT';
  if (form.payoutMethod === 'POBO') payoutChannelType = 'POBO_PAYOUT';
  const selectedSourceForChannel = accounts.find((account) => account.id === form.sourceAccountId);
  let validChannels: FundingChannel[] = [];
  if (type === 'DEPOSIT') {
    validChannels = channels.filter(
      (channel) =>
        channel.type === 'FIAT_INBOUND' &&
        channel.active &&
        channel.supportedCurrencies.includes(form.currency)
    );
  }
  if (type === 'PAYOUT') {
    validChannels = channels.filter(
      (channel) =>
        channel.type === payoutChannelType &&
        channel.active &&
        channel.supportedCurrencies.includes(form.currency) &&
        (form.payoutMethod !== 'VA' || channel.id === selectedSourceForChannel?.fundingChannelId)
    );
  }
  const selectedPayoutChannel = channels.find((channel) => channel.id === form.channelId);
  const matchingPayoutFees = selectedPayoutChannel
    ? withdrawalFees.filter(
        (rule) =>
          rule.assetClass === 'FIAT' &&
          rule.currency === form.currency &&
          rule.method === form.payoutMethod &&
          rule.channelCode === selectedPayoutChannel.code &&
          rule.active
      )
    : [];
  const selectedPayoutFee =
    matchingPayoutFees.find(
      (rule) => rule.scope === 'CUSTOMER' && rule.customerId === form.customerId
    ) || matchingPayoutFees.find((rule) => rule.scope === 'ORGANIZATION');
  const validSources = useMemo(
    () =>
      accounts.filter(
        (account) =>
          account.customerId === form.customerId &&
          account.currency === form.currency &&
          account.status === 'ACTIVE' &&
          (type !== 'PAYOUT' || payoutAccountKindAllowed(account.kind, form.payoutMethod))
      ),
    [accounts, form.currency, form.customerId, form.payoutMethod, type]
  );
  const validTargets = accounts.filter(
    (account) =>
      account.customerId === form.customerId &&
      account.status === 'ACTIVE' &&
      account.currency === (type === 'FX' || type === 'OTC' ? form.quoteCurrency : form.currency)
  );
  const payoutSourceLabel = payoutAccountScopeLabel(form.payoutMethod);
  const payoutAccountsLoading = type === 'PAYOUT' && accountsCustomerId !== form.customerId;
  const payoutFeesLoading =
    type === 'PAYOUT' && (withdrawalFeesLoading || withdrawalFeesCustomerId !== form.customerId);
  useEffect(() => {
    if (type !== 'PAYOUT') return;
    const {
      sourceAccountId: currentSourceAccountId,
      channelId: currentChannelId,
      payoutMethod,
    } = form;
    const currentSource = validSources.find((account) => account.id === currentSourceAccountId);
    const nextSource = currentSource || (validSources.length === 1 ? validSources[0] : undefined);
    const sourceAccountId = nextSource?.id || '';
    let channelId = '';
    if (payoutMethod === 'VA') {
      if (nextSource) {
        const { fundingChannelId } = nextSource;
        channelId = fundingChannelId || '';
      }
    } else if (sourceAccountId === currentSourceAccountId) {
      channelId = currentChannelId;
    }
    if (currentSourceAccountId !== sourceAccountId || currentChannelId !== channelId) {
      setForm({ ...form, sourceAccountId, channelId });
    }
  }, [form, setForm, type, validSources]);
  let payoutSourceHelperText: string | undefined;
  if (type === 'PAYOUT') {
    if (payoutAccountsLoading) {
      payoutSourceHelperText = `正在加载${payoutSourceLabel}…`;
    } else if (
      form.payoutMethod === 'VA' &&
      selectedSourceForChannel &&
      !selectedSourceForChannel.fundingChannelId
    ) {
      payoutSourceHelperText = '该 VA 是历史账户，未绑定开户银行通道，暂不能发起 VA 出款。';
    } else {
      payoutSourceHelperText = validSources.length
        ? `${payoutSourceLabel}仅显示当前客户的可用 ${form.currency} 余额。`
        : `当前客户没有可用的 ${form.currency} ${payoutSourceLabel}。`;
    }
  }
  const dialogNotice =
    type === 'DEPOSIT'
      ? `法币账户只有 VA 账户和${SYSTEM_WALLET_PRODUCT_NAME}；提交后进入待审批，确认到账后记入对应币种余额。`
      : '提交后将冻结相关余额并进入待审批；授权管理员可直接完成审批。';
  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="md">
      <Box component="form" onSubmit={onSubmit} noValidate>
        <DialogTitle>新建{operationTypeText(type)}</DialogTitle>
        <DialogContent>
          <Stack spacing={2.5} sx={{ mt: 1 }}>
            <Alert severity="info">{dialogNotice}</Alert>
            {error && <Alert severity="error">{error}</Alert>}
            <FormControl fullWidth required>
              <InputLabel>客户</InputLabel>
              <Select
                label="客户"
                value={form.customerId}
                onChange={(e) =>
                  setForm({
                    ...form,
                    customerId: e.target.value,
                    sourceAccountId: '',
                    targetAccountId: '',
                    beneficiaryId: '',
                    channelId: '',
                  })
                }
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
                  onChange={(e) => {
                    const nextCurrency = e.target.value as Currency;
                    let nextQuoteCurrency = form.quoteCurrency;
                    if (type === 'OTC') nextQuoteCurrency = 'USDT';
                    else if (form.quoteCurrency === nextCurrency) {
                      nextQuoteCurrency =
                        supportedFiatCurrencies.find((item) => item !== nextCurrency) || 'USD';
                    }
                    setForm({
                      ...form,
                      currency: nextCurrency,
                      quoteCurrency: nextQuoteCurrency,
                      sourceAccountId: '',
                      targetAccountId: '',
                      channelId: '',
                      beneficiaryId: '',
                    });
                  }}
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
                onChange={(value) => {
                  const account = validSources.find((row) => row.id === value);
                  setForm({
                    ...form,
                    sourceAccountId: value,
                    channelId:
                      form.payoutMethod === 'VA' ? account?.fundingChannelId || '' : form.channelId,
                  });
                }}
                showAccountKind={type === 'PAYOUT'}
                helperText={payoutSourceHelperText}
                error={
                  type === 'PAYOUT' &&
                  !payoutAccountsLoading &&
                  (!validSources.length ||
                    (form.payoutMethod === 'VA' &&
                      Boolean(selectedSourceForChannel) &&
                      !selectedSourceForChannel?.fundingChannelId))
                }
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
              <FormControl
                fullWidth
                required
                error={
                  type === 'PAYOUT' &&
                  form.payoutMethod === 'VA' &&
                  Boolean(selectedSourceForChannel) &&
                  !validChannels.length
                }
              >
                <InputLabel>
                  {type === 'PAYOUT' && form.payoutMethod === 'VA' ? '开户银行通道' : '资金通道'}
                </InputLabel>
                <Select
                  label={
                    type === 'PAYOUT' && form.payoutMethod === 'VA' ? '开户银行通道' : '资金通道'
                  }
                  value={form.channelId}
                  disabled={type === 'PAYOUT' && form.payoutMethod === 'VA'}
                  onChange={(e) => set('channelId', e.target.value)}
                >
                  {validChannels.map((channel) => (
                    <MenuItem key={channel.id} value={channel.id}>
                      {channel.name}
                    </MenuItem>
                  ))}
                </Select>
                {type === 'PAYOUT' && form.payoutMethod === 'VA' && (
                  <FormHelperText>
                    {validChannels.length
                      ? '由开户时绑定的 VA 银行自动确定，不可另选。'
                      : '所选 VA 尚未绑定可用的开户银行通道。'}
                  </FormHelperText>
                )}
              </FormControl>
            )}
            {type === 'PAYOUT' && (
              <Card variant="outlined" sx={{ bgcolor: 'background.neutral' }}>
                <CardContent sx={{ p: 2.5 }}>
                  {payoutFeesLoading && (
                    <Alert severity="info">正在加载当前客户的转出手续费…</Alert>
                  )}
                  {!payoutFeesLoading && withdrawalFeesError && (
                    <Alert severity="error">转出手续费加载失败：{withdrawalFeesError}</Alert>
                  )}
                  {!payoutFeesLoading &&
                    !withdrawalFeesError &&
                    selectedPayoutChannel &&
                    selectedPayoutFee && (
                      <Stack spacing={1}>
                        <Detail label="转出渠道" value={selectedPayoutChannel.name} />
                        <Detail
                          label="固定手续费"
                          value={formatMoney(selectedPayoutFee.amount, form.currency)}
                        />
                        <Detail
                          label="费率范围"
                          value={
                            selectedPayoutFee.scope === 'CUSTOMER' ? '当前客户专属' : '机构默认'
                          }
                        />
                        <Divider />
                        <Detail
                          label="账户总冻结"
                          value={formatMoney(
                            String(Number(form.amount || 0) + Number(selectedPayoutFee.amount)),
                            form.currency
                          )}
                        />
                      </Stack>
                    )}
                  {!payoutFeesLoading &&
                    !withdrawalFeesError &&
                    (!selectedPayoutChannel || !selectedPayoutFee) && (
                      <Alert severity="warning">当前渠道尚未配置生效的转出手续费。</Alert>
                    )}
                </CardContent>
              </Card>
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
          <Button disabled={submitting} onClick={onClose}>
            取消
          </Button>
          <Button type="submit" variant="contained" disabled={submitting || payoutFeesLoading}>
            {submitting ? '提交中…' : '提交审批'}
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
  showAccountKind = false,
  helperText,
  error = false,
}: {
  label: string;
  value: string;
  accounts: MoneyAccount[];
  onChange: (value: string) => void;
  showAccountKind?: boolean;
  helperText?: string;
  error?: boolean;
}) {
  return (
    <FormControl fullWidth required error={error}>
      <InputLabel>{label}</InputLabel>
      <Select label={label} value={value} onChange={(e) => onChange(e.target.value)}>
        {accounts.map((account) => (
          <MenuItem key={account.id} value={account.id}>
            {showAccountKind
              ? `${account.kind === 'VIRTUAL_ACCOUNT' ? 'VA 钱包' : SYSTEM_WALLET_PRODUCT_NAME} · ${
                  account.currency
                }`
              : accountBalanceLabel(account)}
            {showAccountKind && account.accountNumber ? ` · ${account.accountNumber}` : ''} · 可用{' '}
            {account.availableBalance}
          </MenuItem>
        ))}
      </Select>
      {helperText && <FormHelperText>{helperText}</FormHelperText>}
    </FormControl>
  );
}

function OperationDrawer({
  operation,
  currentUserId,
  actionError,
  onClose,
  onApprove,
  onReject,
  onExecute,
}: {
  operation: Operation | null;
  currentUserId: string;
  actionError: string;
  onClose: () => void;
  onApprove: () => void;
  onReject: () => void;
  onExecute: () => void;
}) {
  if (!operation) return null;
  const isOwn = operation.maker.id === currentUserId;
  const isAdmin = currentUserId === 'usr_admin';
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
        {isOwn && operation.status === 'SUBMITTED' && isAdmin && (
          <Alert severity="info">单人审批模式下，管理员可以审批自己提交的指令。</Alert>
        )}
        {isOwn && operation.status === 'SUBMITTED' && !isAdmin && (
          <Alert severity="warning">该身份没有自审批权限，请切换为平台管理员。</Alert>
        )}
        {actionError && <Alert severity="error">{actionError}</Alert>}
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
        <Detail label="审批人" value={operation.checker?.displayName || '待审批'} />
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
            <Button fullWidth variant="contained" disabled={isOwn && !isAdmin} onClick={onApprove}>
              审批通过
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
    SUBMITTED: '待审批',
    APPROVED: '已批准',
    REJECTED: '已拒绝',
    PROCESSING: '执行中',
    COMPLETED: '已完成',
    FAILED: '失败',
    CANCELLED: '已取消',
  };
  return <Label color={color}>{labels[status]}</Label>;
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
