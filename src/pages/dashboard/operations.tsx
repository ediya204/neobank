import { FormEvent, useCallback, useEffect, useRef, useState } from 'react';
import { Helmet } from 'react-helmet-async';
import { useSearchParams } from 'react-router-dom';
import type { TFunction } from 'i18next';
import { useTranslation } from 'react-i18next';
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
  Divider,
  InputAdornment,
  MenuItem,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TextField,
  Typography,
} from '@mui/material';
import Label from 'src/components/label';
import Iconify from 'src/components/iconify';
import { useSnackbar } from 'src/components/snackbar';
import { ConfirmDialog } from 'src/components/custom-dialog';
import { getLocalizedApiError } from 'src/locales/api-error';
import { browserApiFetch } from 'src/utils/browser-api';
import { CRYPTO_NETWORK_OPTIONS, USD_ASSET_ICON, USDT_ASSET_ICON } from 'src/utils/asset-icons';

type Row = Record<string, any>;
type Application = { application_id: string; customer_name: string; status: string };
type StableIdempotencyRequests = Map<string, string>;
type WithdrawalFeeType = 'fiat_withdrawal' | 'usdt_withdrawal';
export type OperationSection =
  | 'deposits'
  | 'withdrawals'
  | 'otc'
  | 'balances'
  | 'transactions'
  | 'ledger'
  | 'fees'
  | 'api-security'
  | 'audit';
type OperationAction = {
  row: Row;
  status: 'processing' | 'completed' | 'rejected' | 'cancelled';
  settlementStatus?: 'pending' | 'cleared' | 'exception';
};
type WithdrawalFeeDefinition = {
  type: WithdrawalFeeType;
  labelKey: string;
  asset: 'USD' | 'USDT';
  icon: string;
  descriptionKey: string;
  defaultAmount: string;
};
type IpAllowlistEntry = {
  id: string;
  label: string;
  cidr: string;
  enabled: boolean;
  created_at?: string;
  updated_at?: string;
};
type ApiSecurityConfig = {
  access_service_token_required: boolean;
  ip_allowlist_enabled: boolean;
  ip_allowlist: IpAllowlistEntry[];
  rate_limit: {
    enabled: boolean;
    limit: number;
    period_seconds: number;
  };
};
const BASE = '/api/browser/v1/admin';
const WITHDRAWAL_FEE_DEFINITIONS: WithdrawalFeeDefinition[] = [
  {
    type: 'fiat_withdrawal',
    labelKey: 'types.fiatWithdrawal',
    asset: 'USD',
    icon: USD_ASSET_ICON,
    descriptionKey: 'fees.fiatDescription',
    defaultAmount: '30',
  },
  {
    type: 'usdt_withdrawal',
    labelKey: 'types.cryptoWithdrawal',
    asset: 'USDT',
    icon: USDT_ASSET_ICON,
    descriptionKey: 'fees.cryptoDescription',
    defaultAmount: '5',
  },
];
const CRYPTO_NETWORKS = CRYPTO_NETWORK_OPTIONS;
const OPERATION_STATUSES = [
  { value: 'all', labelKey: 'status.all' },
  { value: 'submitted', labelKey: 'status.submitted' },
  { value: 'processing', labelKey: 'status.processing' },
  { value: 'completed', labelKey: 'status.completed' },
  { value: 'rejected', labelKey: 'status.rejected' },
  { value: 'cancelled', labelKey: 'status.cancelled' },
] as const;
const AUDIT_ACTIONS = [
  { value: 'all', labelKey: 'audit.actions.all' },
  { value: 'application.created', labelKey: 'audit.actions.applicationCreated' },
  { value: 'application.profile_updated', labelKey: 'audit.actions.applicationProfileUpdated' },
  { value: 'kyc.link_added', labelKey: 'audit.actions.kycLinkAdded' },
  { value: 'kyc.link_updated', labelKey: 'audit.actions.kycLinkUpdated' },
  { value: 'va_account.activated', labelKey: 'audit.actions.vaAccountActivated' },
  { value: 'va_account.updated', labelKey: 'audit.actions.vaAccountUpdated' },
  { value: 'fund_transaction.created', labelKey: 'audit.actions.fundCreated' },
  { value: 'fund_transaction.processing', labelKey: 'audit.actions.fundProcessing' },
  { value: 'fund_transaction.completed', labelKey: 'audit.actions.fundCompleted' },
  { value: 'fund_transaction.rejected', labelKey: 'audit.actions.fundRejected' },
  { value: 'fund_transaction.cancelled', labelKey: 'audit.actions.fundCancelled' },
  { value: 'otc_order.created', labelKey: 'audit.actions.otcCreated' },
  { value: 'otc_order.processing', labelKey: 'audit.actions.otcProcessing' },
  { value: 'otc_order.completed', labelKey: 'audit.actions.otcCompleted' },
  { value: 'otc_order.rejected', labelKey: 'audit.actions.otcRejected' },
  { value: 'otc_order.cancelled', labelKey: 'audit.actions.otcCancelled' },
  { value: 'withdrawal_fee.updated', labelKey: 'audit.actions.feeUpdated' },
  { value: 'api_security.ip_allowlist_toggled', labelKey: 'audit.actions.allowlistToggled' },
  { value: 'api_security.ip_allowlist_created', labelKey: 'audit.actions.allowlistCreated' },
  { value: 'api_security.ip_allowlist_updated', labelKey: 'audit.actions.allowlistUpdated' },
  { value: 'api_security.ip_allowlist_deleted', labelKey: 'audit.actions.allowlistDeleted' },
] as const;
const SECTION_META: Record<
  OperationSection,
  { titleKey: string; descriptionKey: string; icon: string }
> = {
  deposits: {
    titleKey: 'sections.deposits.title',
    descriptionKey: 'sections.deposits.description',
    icon: 'solar:download-minimalistic-bold-duotone',
  },
  withdrawals: {
    titleKey: 'sections.withdrawals.title',
    descriptionKey: 'sections.withdrawals.description',
    icon: 'solar:upload-minimalistic-bold-duotone',
  },
  otc: {
    titleKey: 'sections.otc.title',
    descriptionKey: 'sections.otc.description',
    icon: 'solar:hand-money-bold-duotone',
  },
  balances: {
    titleKey: 'sections.balances.title',
    descriptionKey: 'sections.balances.description',
    icon: 'solar:wallet-money-bold-duotone',
  },
  transactions: {
    titleKey: 'sections.transactions.title',
    descriptionKey: 'sections.transactions.description',
    icon: 'solar:history-bold-duotone',
  },
  ledger: {
    titleKey: 'sections.ledger.title',
    descriptionKey: 'sections.ledger.description',
    icon: 'solar:notebook-bookmark-bold-duotone',
  },
  fees: {
    titleKey: 'sections.fees.title',
    descriptionKey: 'sections.fees.description',
    icon: 'solar:tag-price-bold-duotone',
  },
  'api-security': {
    titleKey: 'sections.apiSecurity.title',
    descriptionKey: 'sections.apiSecurity.description',
    icon: 'solar:shield-keyhole-bold-duotone',
  },
  audit: {
    titleKey: 'sections.audit.title',
    descriptionKey: 'sections.audit.description',
    icon: 'solar:clipboard-check-bold-duotone',
  },
};

class ApiRequestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ApiRequestError';
  }
}

function apiSessionError() {
  return new ApiRequestError(getLocalizedApiError({ error: { code: 'session_unavailable' } }));
}

async function api(path: string, init?: RequestInit) {
  let response: Response;
  try {
    response = await browserApiFetch(`${BASE}${path}`, {
      ...init,
      credentials: 'same-origin',
      headers: { 'content-type': 'application/json', ...init?.headers },
    });
  } catch (caught) {
    if (caught instanceof DOMException && caught.name === 'AbortError') {
      throw caught;
    }
    throw apiSessionError();
  }

  if (response.status === 204) return null;

  const contentType = response.headers.get('content-type') || '';
  if (!contentType.includes('application/json')) {
    throw apiSessionError();
  }

  let body: any;
  try {
    body = await response.json();
  } catch {
    throw apiSessionError();
  }

  if (!response.ok) {
    throw new ApiRequestError(getLocalizedApiError(body));
  }
  return body;
}

function localizedRequestError(caught: unknown, t: TFunction<'operations'>, fallbackKey: string) {
  if (caught instanceof ApiRequestError) {
    return caught.message;
  }
  return t(fallbackKey);
}

export default function OperationsPage({ section = 'deposits' }: { section?: OperationSection }) {
  const { t, i18n } = useTranslation('operations');
  const locale = i18n.language === 'cn' ? 'zh-CN' : 'en-US';
  const { enqueueSnackbar } = useSnackbar();
  const [searchParams] = useSearchParams();
  const tab = section;
  const needsApplications = !['fees', 'api-security'].includes(tab);
  const [rows, setRows] = useState<Row[]>([]);
  const [rowsLoading, setRowsLoading] = useState(false);
  const [rowsLoadError, setRowsLoadError] = useState('');
  const [applications, setApplications] = useState<Application[]>([]);
  const [applicationsLoading, setApplicationsLoading] = useState(false);
  const [applicationsLoadError, setApplicationsLoadError] = useState('');
  const [applicationId, setApplicationId] = useState(
    () => searchParams.get('application_id')?.trim() || ''
  );
  const [statusFilter, setStatusFilter] = useState('all');
  const [typeFilter, setTypeFilter] = useState('all');
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [pendingOnly, setPendingOnly] = useState(false);
  const [walletFilter, setWalletFilter] = useState(() => {
    const requested = searchParams.get('wallet');
    return requested === 'fiat' || requested === 'crypto' ? requested : 'all';
  });
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [auditActorFilter, setAuditActorFilter] = useState('all');
  const [auditActionFilter, setAuditActionFilter] = useState('all');
  const [fundSubmitting, setFundSubmitting] = useState(false);
  const fundRequestRef = useRef<StableIdempotencyRequests>(new Map());
  const loadRequestRef = useRef(0);
  const applicationIdRef = useRef(applicationId);
  const tabRef = useRef(tab);
  applicationIdRef.current = applicationId;
  tabRef.current = tab;
  const [feeDrafts, setFeeDrafts] = useState<Record<WithdrawalFeeType, string>>({
    fiat_withdrawal: '30',
    usdt_withdrawal: '5',
  });
  const [savingFee, setSavingFee] = useState<WithdrawalFeeType | ''>('');
  const [feeLoading, setFeeLoading] = useState(false);
  const [feeLoadError, setFeeLoadError] = useState('');
  const [apiSecurity, setApiSecurity] = useState<ApiSecurityConfig>({
    access_service_token_required: true,
    ip_allowlist_enabled: false,
    ip_allowlist: [],
    rate_limit: { enabled: true, limit: 120, period_seconds: 60 },
  });
  const [securityLoading, setSecurityLoading] = useState(false);
  const [securityLoadError, setSecurityLoadError] = useState('');
  const [securityMutation, setSecurityMutation] = useState('');
  const [allowlistConfirmOpen, setAllowlistConfirmOpen] = useState(false);
  const [deleteAllowlistEntry, setDeleteAllowlistEntry] = useState<IpAllowlistEntry | null>(null);
  const [allowlistForm, setAllowlistForm] = useState({ label: '', cidr: '' });
  const [allowlistFormError, setAllowlistFormError] = useState('');
  const [operationAction, setOperationAction] = useState<OperationAction | null>(null);
  const [detailRow, setDetailRow] = useState<Row | null>(null);
  const [operatorNote, setOperatorNote] = useState('');
  const [settlementReference, setSettlementReference] = useState('');
  const [operationSubmitting, setOperationSubmitting] = useState(false);
  const [fund, setFund] = useState({
    type: 'fiat_deposit',
    asset: 'USD',
    amount: '',
    external_reference: '',
    network: 'TRON',
    destination: '',
    beneficiary_name: '',
    beneficiary_address: '',
    bank_name: '',
    bank_account_number: '',
    swift_bic: '',
    bank_address: '',
    note: '',
  });

  const pathForTab = useCallback(() => {
    if (tab === 'deposits' || tab === 'withdrawals') return '/fund-transactions';
    if (tab === 'otc') return '/otc-orders';
    if (tab === 'balances') return '/balances';
    if (tab === 'transactions') return '/transactions';
    if (tab === 'fees') return '/withdrawal-fees';
    if (tab === 'api-security') return '/api-security';
    if (tab === 'audit') return '/audit-logs';
    return '/ledger';
  }, [tab]);

  const load = useCallback(async () => {
    const targetApplicationId = applicationId;
    const targetTab = tab;
    if (targetApplicationId !== applicationIdRef.current || targetTab !== tabRef.current) {
      return;
    }
    loadRequestRef.current += 1;
    const requestNumber = loadRequestRef.current;
    const isCurrentRequest = () =>
      requestNumber === loadRequestRef.current &&
      targetApplicationId === applicationIdRef.current &&
      targetTab === tabRef.current;
    const path = pathForTab();
    if (targetTab === 'balances' && !targetApplicationId) {
      setRows([]);
      setRowsLoading(false);
      setRowsLoadError('');
      return;
    }
    if (targetTab === 'fees') {
      setRows([]);
      setFeeLoading(true);
      setFeeLoadError('');
    }
    if (targetTab === 'api-security') {
      setSecurityLoading(true);
      setSecurityLoadError('');
    }
    if (targetTab !== 'fees' && targetTab !== 'api-security') {
      setRows([]);
      setRowsLoading(true);
      setRowsLoadError('');
    }
    try {
      const params = new URLSearchParams();
      if (targetApplicationId && targetTab !== 'fees' && targetTab !== 'api-security') {
        params.set('application_id', targetApplicationId);
      }
      if (targetTab === 'deposits') params.set('direction', 'deposit');
      if (targetTab === 'withdrawals') params.set('direction', 'withdrawal');
      if (
        ['deposits', 'withdrawals', 'otc', 'transactions'].includes(targetTab) &&
        statusFilter !== 'all'
      ) {
        params.set('status', statusFilter);
      }
      const validFundTypes =
        targetTab === 'deposits'
          ? ['fiat_deposit', 'usdt_deposit']
          : ['fiat_withdrawal', 'usdt_withdrawal'];
      if (
        ['deposits', 'withdrawals'].includes(targetTab) &&
        typeFilter !== 'all' &&
        validFundTypes.includes(typeFilter)
      ) {
        params.set('type', typeFilter);
      }
      if (targetTab === 'transactions') {
        if (categoryFilter !== 'all') params.set('category', categoryFilter);
        if (walletFilter !== 'all') params.set('wallet', walletFilter);
        if (dateFrom) params.set('date_from', dateFrom);
        if (dateTo) params.set('date_to', dateTo);
      }
      if (targetTab === 'audit') {
        if (auditActorFilter !== 'all') {
          params.set('actor_type', auditActorFilter);
        }
        if (auditActionFilter !== 'all') {
          params.set('action', auditActionFilter);
        }
      }
      if (targetTab === 'transactions' || targetTab === 'audit') {
        params.set('limit', '100');
      }
      const query = params.toString() ? `?${params.toString()}` : '';
      const value = await api(`${path}${query}`);
      if (!isCurrentRequest()) return;
      if (targetTab === 'api-security') {
        setApiSecurity(normalizeApiSecurity(value));
        return;
      }
      const nextRows = value.data || [];
      setRows(nextRows);
      if (targetTab === 'fees') {
        const missing = WITHDRAWAL_FEE_DEFINITIONS.filter(
          (definition) => !nextRows.some((item: Row) => item.type === definition.type)
        );
        if (missing.length) {
          setFeeLoadError(t('errors.feeConfigIncomplete'));
        }
        setFeeDrafts((current) => {
          const next = { ...current };
          WITHDRAWAL_FEE_DEFINITIONS.forEach((definition) => {
            const setting = nextRows.find((item: Row) => item.type === definition.type);
            if (setting) next[definition.type] = String(setting.amount);
          });
          return next;
        });
      }
    } catch (caught) {
      if (!isCurrentRequest()) return;
      if (targetTab === 'fees') {
        setRows([]);
        setFeeLoadError(localizedRequestError(caught, t, 'errors.feeLoadFailed'));
        return;
      }
      if (targetTab === 'api-security') {
        setSecurityLoadError(localizedRequestError(caught, t, 'errors.securityLoadFailed'));
        return;
      }
      setRowsLoadError(localizedRequestError(caught, t, 'errors.operationsLoadFailed'));
    } finally {
      if (isCurrentRequest()) {
        if (targetTab === 'fees') setFeeLoading(false);
        if (targetTab === 'api-security') setSecurityLoading(false);
        if (targetTab !== 'fees' && targetTab !== 'api-security') {
          setRowsLoading(false);
        }
      }
    }
  }, [
    applicationId,
    auditActionFilter,
    auditActorFilter,
    categoryFilter,
    dateFrom,
    dateTo,
    pathForTab,
    statusFilter,
    tab,
    typeFilter,
    walletFilter,
    t,
  ]);

  useEffect(() => {
    const controller = new AbortController();

    if (!needsApplications) {
      setApplicationsLoading(false);
      setApplicationsLoadError('');
      return () => controller.abort();
    }

    setApplicationsLoading(true);
    setApplicationsLoadError('');
    api('/va-applications?status=active', { signal: controller.signal })
      .then((value) => {
        if (controller.signal.aborted) return;
        const active = value.data || [];
        setApplications(active);
        if (active[0] && ['deposits', 'balances'].includes(tab)) {
          setApplicationId((current) => current || active[0].application_id);
        }
      })
      .catch((caught) => {
        if (caught instanceof DOMException && caught.name === 'AbortError') return;
        setApplicationsLoadError(localizedRequestError(caught, t, 'errors.customersLoadFailed'));
      })
      .finally(() => {
        if (!controller.signal.aborted) setApplicationsLoading(false);
      });

    return () => controller.abort();
  }, [needsApplications, tab, t]);

  useEffect(() => {
    load();
  }, [load]);

  const createFund = async (event: FormEvent) => {
    event.preventDefault();
    if (fundSubmitting) return;
    const submittedApplicationId = applicationId;
    const submittedTab = tab;
    const payload: Row = {
      application_id: submittedApplicationId,
      type: fund.type,
      asset: fund.type.startsWith('usdt_') ? 'USDT' : 'USD',
      amount: fund.amount,
      external_reference: fund.external_reference,
      note: fund.note,
    };
    if (fund.type.startsWith('usdt_')) {
      payload.network = fund.network;
      if (fund.destination) payload.destination = fund.destination;
    }
    if (fund.type === 'fiat_withdrawal') {
      Object.assign(payload, {
        beneficiary_name: fund.beneficiary_name,
        beneficiary_address: fund.beneficiary_address,
        bank_name: fund.bank_name,
        bank_account_number: fund.bank_account_number,
        swift_bic: fund.swift_bic,
        bank_address: fund.bank_address,
      });
    }
    const idempotencyKey = stableIdempotencyKey(fundRequestRef, payload);
    setFundSubmitting(true);
    try {
      await api('/fund-transactions', {
        method: 'POST',
        headers: { 'Idempotency-Key': idempotencyKey },
        body: JSON.stringify(payload),
      });
      clearStableIdempotencyKey(fundRequestRef, payload);
      enqueueSnackbar(t('messages.fundCreated'));
      if (submittedApplicationId === applicationIdRef.current && submittedTab === tabRef.current) {
        setFund((value) => ({
          ...value,
          amount: '',
          external_reference: '',
          destination: '',
          beneficiary_name: '',
          beneficiary_address: '',
          bank_name: '',
          bank_account_number: '',
          swift_bic: '',
          bank_address: '',
          note: '',
        }));
        await load();
      }
    } catch (caught) {
      enqueueSnackbar(localizedRequestError(caught, t, 'errors.createFailed'), {
        variant: 'error',
      });
    } finally {
      setFundSubmitting(false);
    }
  };

  const openOperationAction = (row: Row, status: OperationAction['status']) => {
    setOperationAction({ row, status });
    setOperatorNote(String(row.operator_note || ''));
    setSettlementReference(
      String(row.transaction_reference || row.settlement_reference || row.external_reference || '')
    );
  };

  const openSettlementAction = (row: Row) => {
    setOperationAction({
      row,
      status: 'completed',
      settlementStatus: row.settlement_status === 'exception' ? 'pending' : 'cleared',
    });
    setOperatorNote(String(row.operator_note || ''));
    setSettlementReference(String(row.external_reference || ''));
  };

  const submitOperationAction = async () => {
    if (!operationAction || operationSubmitting) return;
    const { row, status, settlementStatus } = operationAction;
    const otcRow = row.category === 'otc' || Boolean(row.sell_asset);
    if (otcRow) {
      enqueueSnackbar(t('errors.otcAutoSettled'), { variant: 'error' });
      setOperationAction(null);
      return;
    }
    if (
      !settlementStatus &&
      status === 'completed' &&
      requiresSettlementReference(row) &&
      !settlementReference.trim()
    ) {
      enqueueSnackbar(missingReferenceMessage(row, t), { variant: 'error' });
      return;
    }
    const operationApplicationId = applicationId;
    const operationTab = tab;
    setOperationSubmitting(true);
    try {
      await api(`${otcRow ? '/otc-orders' : '/fund-transactions'}/${encodeURIComponent(row.id)}`, {
        method: 'PATCH',
        body: JSON.stringify({
          ...(settlementStatus ? { settlement_status: settlementStatus } : { status }),
          ...(operatorNote.trim() ? { operator_note: operatorNote.trim() } : {}),
          ...(!settlementStatus ? operationReferencePatch(otcRow, settlementReference) : {}),
        }),
      });
      const settlementMessages = {
        cleared: t('settlement.messages.cleared'),
        exception: t('settlement.messages.exception'),
        pending: t('settlement.messages.pending'),
      };
      enqueueSnackbar(
        settlementStatus ? settlementMessages[settlementStatus] : operationActionMessage(status, t)
      );
      setOperationAction(null);
      if (operationApplicationId === applicationIdRef.current && operationTab === tabRef.current) {
        await load();
      }
    } catch (caught) {
      enqueueSnackbar(localizedRequestError(caught, t, 'errors.processFailed'), {
        variant: 'error',
      });
    } finally {
      setOperationSubmitting(false);
    }
  };

  const saveFee = async (type: WithdrawalFeeType) => {
    if (feeLoadError || !rows.some((row) => row.type === type)) {
      enqueueSnackbar(t('errors.feeReadFirst'), { variant: 'error' });
      return;
    }
    const amount = feeDrafts[type]?.trim();
    if (!/^\d+(\.\d+)?$/.test(amount) || Number(amount) < 0) {
      enqueueSnackbar(t('errors.invalidFee'), { variant: 'error' });
      return;
    }
    setSavingFee(type);
    try {
      await api(`/withdrawal-fees/${type}`, {
        method: 'PATCH',
        body: JSON.stringify({ amount }),
      });
      enqueueSnackbar(t('messages.feeUpdated'));
      await load();
    } catch (caught) {
      enqueueSnackbar(localizedRequestError(caught, t, 'errors.saveFailed'), {
        variant: 'error',
      });
    } finally {
      setSavingFee('');
    }
  };

  const updateIpAllowlistEnabled = async (enabled: boolean) => {
    const activeCount = apiSecurity.ip_allowlist.filter((entry) => entry.enabled).length;
    if (enabled && activeCount < 1) {
      enqueueSnackbar(t('errors.allowlistRequiresEntry'), {
        variant: 'error',
      });
      return;
    }
    setSecurityMutation('global');
    try {
      await api('/api-security', {
        method: 'PATCH',
        body: JSON.stringify({ ip_allowlist_enabled: enabled }),
      });
      setAllowlistConfirmOpen(false);
      enqueueSnackbar(enabled ? t('messages.allowlistEnabled') : t('messages.allowlistDisabled'));
      await load();
    } catch (caught) {
      enqueueSnackbar(localizedRequestError(caught, t, 'errors.updateFailed'), {
        variant: 'error',
      });
    } finally {
      setSecurityMutation('');
    }
  };

  const createIpAllowlistEntry = async (event: FormEvent) => {
    event.preventDefault();
    const cidr = allowlistForm.cidr.trim();
    if (!isValidCidr(cidr)) {
      setAllowlistFormError(t('errors.invalidCidr'));
      return;
    }
    setAllowlistFormError('');
    setSecurityMutation('create');
    try {
      await api('/api-security/ip-allowlist', {
        method: 'POST',
        body: JSON.stringify({
          cidr,
          ...(allowlistForm.label.trim() ? { label: allowlistForm.label.trim() } : {}),
        }),
      });
      setAllowlistForm({ label: '', cidr: '' });
      enqueueSnackbar(t('messages.cidrAdded'));
      await load();
    } catch (caught) {
      enqueueSnackbar(localizedRequestError(caught, t, 'errors.addFailed'), {
        variant: 'error',
      });
    } finally {
      setSecurityMutation('');
    }
  };

  const toggleIpAllowlistEntry = async (entry: IpAllowlistEntry) => {
    const activeCount = apiSecurity.ip_allowlist.filter((item) => item.enabled).length;
    if (entry.enabled && apiSecurity.ip_allowlist_enabled && activeCount === 1) {
      enqueueSnackbar(t('errors.disableLastCidr'), {
        variant: 'error',
      });
      return;
    }
    setSecurityMutation(entry.id);
    try {
      await api(`/api-security/ip-allowlist/${encodeURIComponent(entry.id)}`, {
        method: 'PATCH',
        body: JSON.stringify({ enabled: !entry.enabled }),
      });
      enqueueSnackbar(entry.enabled ? t('messages.cidrDisabled') : t('messages.cidrEnabled'));
      await load();
    } catch (caught) {
      enqueueSnackbar(localizedRequestError(caught, t, 'errors.updateFailed'), {
        variant: 'error',
      });
    } finally {
      setSecurityMutation('');
    }
  };

  const removeIpAllowlistEntry = async () => {
    if (!deleteAllowlistEntry) return;
    const activeCount = apiSecurity.ip_allowlist.filter((item) => item.enabled).length;
    if (deleteAllowlistEntry.enabled && apiSecurity.ip_allowlist_enabled && activeCount === 1) {
      enqueueSnackbar(t('errors.deleteLastCidr'), {
        variant: 'error',
      });
      setDeleteAllowlistEntry(null);
      return;
    }
    setSecurityMutation(deleteAllowlistEntry.id);
    try {
      await api(`/api-security/ip-allowlist/${encodeURIComponent(deleteAllowlistEntry.id)}`, {
        method: 'DELETE',
      });
      enqueueSnackbar(t('messages.cidrDeleted'));
      setDeleteAllowlistEntry(null);
      await load();
    } catch (caught) {
      enqueueSnackbar(localizedRequestError(caught, t, 'errors.deleteFailed'), {
        variant: 'error',
      });
    } finally {
      setSecurityMutation('');
    }
  };

  const sectionMeta = SECTION_META[tab];
  const customerFilterVisible = needsApplications;
  const allowAllCustomers = !['deposits', 'balances'].includes(tab);
  let displayedRows = rows;
  if (tab === 'transactions' && pendingOnly) {
    displayedRows = rows.filter(canProcessTransaction);
  } else if (tab === 'balances' && walletFilter !== 'all') {
    displayedRows = rows.filter((row) =>
      walletFilter === 'fiat' ? row.asset === 'USD' : row.asset === 'USDT'
    );
  }

  return (
    <>
      <Helmet>
        <title>
          {t(sectionMeta.titleKey)} | {t('page.admin')} | SSC Digital Bank
        </title>
      </Helmet>
      <Container maxWidth="xl">
        <Stack direction="row" spacing={1.5} alignItems="center" sx={{ mb: 1, minWidth: 0 }}>
          <Box
            sx={{
              width: 44,
              height: 44,
              borderRadius: 1.5,
              display: 'grid',
              placeItems: 'center',
              bgcolor: 'primary.lighter',
              color: 'primary.main',
            }}
          >
            <Iconify icon={sectionMeta.icon} width={25} />
          </Box>
          <Typography
            sx={{ typography: { xs: 'h5', sm: 'h4' }, overflowWrap: 'anywhere', minWidth: 0 }}
          >
            {t(sectionMeta.titleKey)}
          </Typography>
        </Stack>
        <Typography color="text.secondary" sx={{ mb: 4, ml: { sm: 7.5 } }}>
          {t(sectionMeta.descriptionKey)}
        </Typography>
        <Card>
          {needsApplications && (applicationsLoading || applicationsLoadError) && (
            <Alert
              severity={applicationsLoadError ? 'error' : 'info'}
              sx={{ m: 2, mb: 0 }}
              action={
                applicationsLoadError ? (
                  <Button color="inherit" size="small" onClick={() => window.location.reload()}>
                    {t('actions.reload')}
                  </Button>
                ) : undefined
              }
            >
              {applicationsLoadError || t('loading.customers')}
            </Alert>
          )}
          {customerFilterVisible && (
            <Stack
              direction={{ xs: 'column', md: 'row' }}
              alignItems={{ md: 'center' }}
              useFlexGap
              flexWrap="wrap"
              sx={{ p: 2 }}
              spacing={2}
            >
              <TextField
                select
                size="small"
                label={allowAllCustomers ? t('filters.customerScope') : t('fields.customer')}
                value={applicationId}
                onChange={(event) => setApplicationId(event.target.value)}
                sx={{ minWidth: 280 }}
              >
                {allowAllCustomers && <MenuItem value="">{t('filters.allCustomers')}</MenuItem>}
                {applications.map((item) => (
                  <MenuItem key={item.application_id} value={item.application_id}>
                    {item.customer_name}
                  </MenuItem>
                ))}
              </TextField>
              {['deposits', 'withdrawals', 'otc', 'transactions'].includes(tab) && (
                <TextField
                  select
                  size="small"
                  label={t('fields.status')}
                  value={statusFilter}
                  onChange={(event) => setStatusFilter(event.target.value)}
                  sx={{ minWidth: 150 }}
                >
                  {OPERATION_STATUSES.map((item) => (
                    <MenuItem key={item.value} value={item.value}>
                      {t(item.labelKey)}
                    </MenuItem>
                  ))}
                </TextField>
              )}
              {['deposits', 'withdrawals'].includes(tab) && (
                <TextField
                  select
                  size="small"
                  label={t('filters.businessType')}
                  value={typeFilter}
                  onChange={(event) => setTypeFilter(event.target.value)}
                  sx={{ minWidth: 170 }}
                >
                  <MenuItem value="all">{t('filters.allTypes')}</MenuItem>
                  {tab === 'deposits' ? (
                    <MenuItem value="fiat_deposit">{t('types.fiatDeposit')}</MenuItem>
                  ) : (
                    [
                      <MenuItem key="fiat_withdrawal" value="fiat_withdrawal">
                        {t('types.fiatWithdrawal')}
                      </MenuItem>,
                      <MenuItem key="usdt_withdrawal" value="usdt_withdrawal">
                        {t('types.usdtWithdrawal')}
                      </MenuItem>,
                    ]
                  )}
                </TextField>
              )}
              {tab === 'balances' && (
                <TextField
                  select
                  size="small"
                  label={t('fields.wallet')}
                  value={walletFilter}
                  onChange={(event) => setWalletFilter(event.target.value)}
                  sx={{ minWidth: 150 }}
                >
                  <MenuItem value="all">{t('filters.allWallets')}</MenuItem>
                  <MenuItem value="fiat">{t('wallets.fiat')}</MenuItem>
                  <MenuItem value="crypto">{t('wallets.crypto')}</MenuItem>
                </TextField>
              )}
              {tab === 'transactions' && (
                <>
                  <Button
                    variant={pendingOnly ? 'contained' : 'outlined'}
                    color={pendingOnly ? 'warning' : 'inherit'}
                    startIcon={<Iconify icon="solar:download-minimalistic-bold-duotone" />}
                    onClick={() => setPendingOnly((current) => !current)}
                  >
                    {pendingOnly
                      ? t('filters.showAllTransactions')
                      : t('filters.pendingOnly', {
                          count: rows.filter(canProcessTransaction).length,
                        })}
                  </Button>
                  <TextField
                    select
                    size="small"
                    label={t('fields.category')}
                    value={categoryFilter}
                    onChange={(event) => setCategoryFilter(event.target.value)}
                    sx={{ minWidth: 140 }}
                  >
                    <MenuItem value="all">{t('filters.allCategories')}</MenuItem>
                    <MenuItem value="fund">{t('filters.fundCategory')}</MenuItem>
                    <MenuItem value="otc">OTC</MenuItem>
                  </TextField>
                  <TextField
                    select
                    size="small"
                    label={t('fields.wallet')}
                    value={walletFilter}
                    onChange={(event) => setWalletFilter(event.target.value)}
                    sx={{ minWidth: 140 }}
                  >
                    <MenuItem value="all">{t('filters.allWallets')}</MenuItem>
                    <MenuItem value="fiat">{t('wallets.fiat')}</MenuItem>
                    <MenuItem value="crypto">{t('wallets.crypto')}</MenuItem>
                  </TextField>
                  <TextField
                    size="small"
                    type="date"
                    label={t('filters.startDate')}
                    value={dateFrom}
                    onChange={(event) => setDateFrom(event.target.value)}
                    InputLabelProps={{ shrink: true }}
                  />
                  <TextField
                    size="small"
                    type="date"
                    label={t('filters.endDate')}
                    value={dateTo}
                    onChange={(event) => setDateTo(event.target.value)}
                    InputLabelProps={{ shrink: true }}
                  />
                </>
              )}
              {tab === 'audit' && (
                <>
                  <TextField
                    select
                    size="small"
                    label={t('audit.actor')}
                    value={auditActorFilter}
                    onChange={(event) => setAuditActorFilter(event.target.value)}
                    sx={{ minWidth: 150 }}
                  >
                    <MenuItem value="all">{t('audit.allActors')}</MenuItem>
                    <MenuItem value="operator">{t('audit.admin')}</MenuItem>
                    <MenuItem value="partner">{t('audit.partner')}</MenuItem>
                  </TextField>
                  <TextField
                    select
                    size="small"
                    label={t('audit.actionType')}
                    value={auditActionFilter}
                    onChange={(event) => setAuditActionFilter(event.target.value)}
                    sx={{ minWidth: 220 }}
                  >
                    {AUDIT_ACTIONS.map((item) => (
                      <MenuItem key={item.value} value={item.value}>
                        {t(item.labelKey)}
                      </MenuItem>
                    ))}
                  </TextField>
                </>
              )}
              <Button startIcon={<Iconify icon="solar:refresh-linear" />} onClick={() => load()}>
                {t('actions.refresh')}
              </Button>
              {allowAllCustomers && !applicationId && (
                <Alert severity="info" sx={{ py: 0, alignItems: 'center' }}>
                  {t('messages.allCustomersVisible')}
                </Alert>
              )}
            </Stack>
          )}

          {tab !== 'fees' && tab !== 'api-security' && (rowsLoading || rowsLoadError) && (
            <Alert
              severity={rowsLoadError ? 'error' : 'info'}
              sx={{ mx: 2, mb: 2 }}
              action={
                rowsLoadError ? (
                  <Button color="inherit" size="small" onClick={() => load()}>
                    {t('actions.reload')}
                  </Button>
                ) : undefined
              }
            >
              {rowsLoadError
                ? t('errors.loadNotTreatedAsEmpty', { message: rowsLoadError })
                : t('loading.operations')}
            </Alert>
          )}

          {tab === 'fees' && (
            <WithdrawalFeeSettings
              rows={rows}
              drafts={feeDrafts}
              saving={savingFee}
              loading={feeLoading}
              loadError={feeLoadError}
              onDraftChange={(type, amount) =>
                setFeeDrafts((current) => ({ ...current, [type]: amount }))
              }
              onSave={saveFee}
              onRefresh={load}
            />
          )}

          {tab === 'api-security' && (
            <ApiSecuritySettings
              value={apiSecurity}
              loading={securityLoading}
              loadError={securityLoadError}
              mutation={securityMutation}
              form={allowlistForm}
              formError={allowlistFormError}
              onFormChange={(next) => {
                setAllowlistForm(next);
                setAllowlistFormError('');
              }}
              onCreate={createIpAllowlistEntry}
              onRefresh={load}
              onRequestEnable={() => setAllowlistConfirmOpen(true)}
              onDisable={() => updateIpAllowlistEnabled(false)}
              onToggleEntry={toggleIpAllowlistEntry}
              onDeleteEntry={setDeleteAllowlistEntry}
            />
          )}

          {tab === 'deposits' && (
            <Box component="form" onSubmit={createFund} sx={{ px: 2, pb: 3 }}>
              <Alert severity="info" sx={{ mb: 2.5 }}>
                {t('deposits.confirmedOnly')}
              </Alert>
              <Box
                sx={{
                  display: 'grid',
                  gridTemplateColumns: {
                    xs: '1fr',
                    sm: 'repeat(2, minmax(0, 1fr))',
                    lg: 'repeat(4, minmax(0, 1fr))',
                  },
                  gap: 2,
                }}
              >
                <TextField
                  required
                  size="small"
                  label={t('fields.type')}
                  value={t('types.fiatDeposit')}
                  InputProps={{ readOnly: true }}
                  helperText={t('deposits.manualFiatOnly')}
                />
                <TextField
                  required
                  size="small"
                  label={t('fields.asset')}
                  value={fund.type.startsWith('usdt_') ? 'USDT' : 'USD'}
                  InputProps={{ readOnly: true }}
                  helperText={t('deposits.assetFixed')}
                />
                <TextField
                  required
                  size="small"
                  type="number"
                  label={t('fields.amount')}
                  value={fund.amount}
                  inputProps={{
                    min: 0,
                    step: fund.type.startsWith('usdt_') ? 0.000001 : 0.01,
                  }}
                  onChange={(event) => setFund({ ...fund, amount: event.target.value })}
                />
                <TextField
                  required
                  size="small"
                  label={
                    fund.type === 'fiat_deposit'
                      ? t('fields.bankDepositReference')
                      : t('fields.txHash')
                  }
                  value={fund.external_reference}
                  onChange={(event) => setFund({ ...fund, external_reference: event.target.value })}
                  helperText={t('deposits.referenceHelper')}
                />
              </Box>

              {fund.type.startsWith('usdt_') && (
                <>
                  <Divider sx={{ my: 2.5 }} />
                  <Typography variant="subtitle2" sx={{ mb: 2 }}>
                    {fund.type === 'usdt_withdrawal'
                      ? t('sectionsContent.cryptoRecipient')
                      : t('sectionsContent.cryptoDeposit')}
                  </Typography>
                  <Box
                    sx={{
                      display: 'grid',
                      gridTemplateColumns: { xs: '1fr', sm: '220px minmax(0, 1fr)' },
                      gap: 2,
                    }}
                  >
                    <NetworkSelect
                      label={t('fields.network')}
                      value={fund.network}
                      onChange={(network) => setFund({ ...fund, network })}
                    />
                    <TextField
                      required={fund.type === 'usdt_withdrawal'}
                      size="small"
                      label={
                        fund.type === 'usdt_withdrawal'
                          ? t('fields.recipientWalletAddress')
                          : t('fields.depositWalletAddressOptional')
                      }
                      value={fund.destination}
                      onChange={(event) =>
                        setFund({ ...fund, destination: event.target.value.trim() })
                      }
                    />
                  </Box>
                </>
              )}

              {fund.type === 'fiat_withdrawal' && (
                <>
                  <Divider sx={{ my: 2.5 }} />
                  <Typography variant="subtitle2" sx={{ mb: 2 }}>
                    {t('sectionsContent.bankRecipient')}
                  </Typography>
                  <Box
                    sx={{
                      display: 'grid',
                      gridTemplateColumns: {
                        xs: '1fr',
                        sm: 'repeat(2, minmax(0, 1fr))',
                      },
                      gap: 2,
                    }}
                  >
                    <TextField
                      required
                      size="small"
                      label={t('fields.beneficiaryName')}
                      value={fund.beneficiary_name}
                      onChange={(event) =>
                        setFund({ ...fund, beneficiary_name: event.target.value })
                      }
                    />
                    <TextField
                      required
                      size="small"
                      label={t('fields.bankName')}
                      value={fund.bank_name}
                      onChange={(event) => setFund({ ...fund, bank_name: event.target.value })}
                    />
                    <TextField
                      required
                      size="small"
                      label={t('fields.beneficiaryAddress')}
                      value={fund.beneficiary_address}
                      onChange={(event) =>
                        setFund({ ...fund, beneficiary_address: event.target.value })
                      }
                      sx={{ gridColumn: { sm: '1 / -1' } }}
                    />
                    <TextField
                      required
                      size="small"
                      label={t('fields.bankAccount')}
                      value={fund.bank_account_number}
                      onChange={(event) =>
                        setFund({ ...fund, bank_account_number: event.target.value })
                      }
                    />
                    <TextField
                      required
                      size="small"
                      label="SWIFT / BIC"
                      value={fund.swift_bic}
                      inputProps={{ pattern: '[A-Z0-9]{8}([A-Z0-9]{3})?' }}
                      helperText={t('validation.swift')}
                      onChange={(event) =>
                        setFund({ ...fund, swift_bic: event.target.value.toUpperCase() })
                      }
                    />
                    <TextField
                      size="small"
                      label={t('fields.bankAddressOptional')}
                      value={fund.bank_address}
                      onChange={(event) => setFund({ ...fund, bank_address: event.target.value })}
                      sx={{ gridColumn: { sm: '1 / -1' } }}
                    />
                  </Box>
                </>
              )}

              <TextField
                fullWidth
                multiline
                minRows={2}
                size="small"
                label={t('fields.noteOptional')}
                value={fund.note}
                onChange={(event) => setFund({ ...fund, note: event.target.value })}
                sx={{ mt: 2.5 }}
              />
              <Stack direction="row" justifyContent="flex-end" sx={{ mt: 2.5 }}>
                <Button
                  type="submit"
                  variant="contained"
                  disabled={!applicationId || fundSubmitting}
                >
                  {fundSubmitting ? t('actions.submitting') : t('actions.addDeposit')}
                </Button>
              </Stack>
            </Box>
          )}

          {tab === 'otc' && (
            <Alert severity="info" sx={{ mx: 2, mb: 2 }}>
              {t('otc.adminNotice')}
            </Alert>
          )}

          {tab === 'transactions' && (
            <TransactionHistoryTable
              rows={displayedRows}
              locale={locale}
              onOpen={setDetailRow}
              onProcess={(row) =>
                openOperationAction(row, row.status === 'submitted' ? 'processing' : 'completed')
              }
              onSettlement={openSettlementAction}
            />
          )}

          {tab !== 'fees' &&
            tab !== 'api-security' &&
            tab !== 'audit' &&
            tab !== 'transactions' && (
              <Box sx={{ overflowX: 'auto' }}>
                <Table sx={{ minWidth: 920, tableLayout: 'fixed' }}>
                  <TableHead>
                    <TableRow>
                      <TableCell>{t('table.idAsset')}</TableCell>
                      <TableCell>{t('fields.customer')}</TableCell>
                      <TableCell>{t('fields.type')}</TableCell>
                      <TableCell>{t('table.amountBalanceRecipient')}</TableCell>
                      <TableCell>{t('fields.status')}</TableCell>
                      <TableCell align="right">{t('table.actions')}</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {displayedRows.map((row) => (
                      <TableRow key={row.id || `${row.asset}:${row.network || ''}`}>
                        <TableCell>
                          <Typography
                            variant="caption"
                            noWrap
                            title={row.id || row.asset}
                            sx={{ display: 'block' }}
                          >
                            {row.id || row.asset}
                          </Typography>
                          {row.network && <NetworkValue network={row.network} compact />}
                        </TableCell>
                        <TableCell>
                          <Typography
                            variant="subtitle2"
                            noWrap
                            title={row.customer_name || t('fields.unknownCustomer')}
                          >
                            {row.customer_name || t('fields.unknownCustomer')}
                          </Typography>
                          {row.application_id && (
                            <Typography
                              variant="caption"
                              color="text.secondary"
                              noWrap
                              title={row.application_id}
                              sx={{ display: 'block' }}
                            >
                              {row.application_id}
                            </Typography>
                          )}
                        </TableCell>
                        <TableCell>{renderOperationType(row, t)}</TableCell>
                        <TableCell>
                          <OperationTableAmount
                            row={row}
                            locale={locale}
                            showOtcFlow={tab === 'otc'}
                          />
                          {isWithdrawal(row) && (
                            <Typography
                              variant="caption"
                              color="text.secondary"
                              sx={{ display: 'block' }}
                            >
                              {t('table.feeAndNet', {
                                fee: formatOperationNumber(row.fee_amount ?? '0', locale),
                                net: formatOperationNumber(
                                  row.net_amount ?? calculateNetAmount(row),
                                  locale
                                ),
                                asset: row.asset,
                              })}
                            </Typography>
                          )}
                          {withdrawalDestination(row) &&
                            (row.network ? (
                              <NetworkValue network={row.network} compact />
                            ) : (
                              <Typography variant="caption" color="text.secondary">
                                {withdrawalDestination(row)}
                              </Typography>
                            ))}
                        </TableCell>
                        <TableCell>
                          <Label color={operationStatusColor(row.status)}>
                            {operationStatusLabel(row.status || 'posted', t)}
                          </Label>
                        </TableCell>
                        <TableCell align="right">
                          <Stack direction="row" spacing={1} justifyContent="flex-end">
                            <Button size="small" color="inherit" onClick={() => setDetailRow(row)}>
                              {t('actions.view')}
                            </Button>
                            {tab !== 'otc' &&
                              !(row.category === 'otc' || row.sell_asset) &&
                              row.status &&
                              ['submitted', 'processing'].includes(row.status) && (
                                <Button
                                  size="small"
                                  variant="contained"
                                  onClick={() =>
                                    openOperationAction(
                                      row,
                                      row.status === 'submitted' ? 'processing' : 'completed'
                                    )
                                  }
                                >
                                  {t('actions.process')}
                                </Button>
                              )}
                            {row.type === 'fiat_deposit' &&
                              row.settlement_status !== 'cleared' &&
                              ['submitted', 'processing'].includes(row.status) && (
                                <Button
                                  size="small"
                                  color="warning"
                                  variant="outlined"
                                  onClick={() => openSettlementAction(row)}
                                >
                                  {t('actions.settle')}
                                </Button>
                              )}
                          </Stack>
                        </TableCell>
                      </TableRow>
                    ))}
                    {!displayedRows.length && (
                      <TableRow>
                        <TableCell colSpan={6} align="center" sx={{ py: 6 }}>
                          {t('empty.records')}
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </Box>
            )}
          {tab === 'audit' && <AuditLogTable rows={rows} onOpen={(row) => setDetailRow(row)} />}
        </Card>
      </Container>
      <Dialog fullWidth maxWidth="md" open={Boolean(detailRow)} onClose={() => setDetailRow(null)}>
        <DialogTitle>{t('dialogs.businessDetails')}</DialogTitle>
        <DialogContent dividers>{detailRow && <OperationDetail row={detailRow} />}</DialogContent>
        <DialogActions>
          <Button color="inherit" onClick={() => setDetailRow(null)}>
            {t('actions.close')}
          </Button>
          {detailRow && canProcessTransaction(detailRow) && (
            <Button
              variant="contained"
              onClick={() => {
                const row = detailRow;
                setDetailRow(null);
                openOperationAction(row, row.status === 'submitted' ? 'processing' : 'completed');
              }}
            >
              {t('actions.openProcessing')}
            </Button>
          )}
        </DialogActions>
      </Dialog>
      <Dialog
        fullWidth
        maxWidth="sm"
        open={Boolean(operationAction)}
        onClose={() => !operationSubmitting && setOperationAction(null)}
      >
        <DialogTitle>{t('dialogs.processRequest')}</DialogTitle>
        <DialogContent dividers>
          {operationAction && (
            <Stack spacing={2.5}>
              <OperationDetail row={operationAction.row} compact />
              {operationAction.settlementStatus ? (
                <>
                  <TextField
                    select
                    fullWidth
                    label={t('settlement.statusLabel')}
                    value={operationAction.settlementStatus}
                    onChange={(event) =>
                      setOperationAction({
                        ...operationAction,
                        settlementStatus: event.target.value as 'pending' | 'cleared' | 'exception',
                      })
                    }
                  >
                    <MenuItem value="pending">{t('settlement.status.pending')}</MenuItem>
                    <MenuItem value="cleared">{t('settlement.status.cleared')}</MenuItem>
                    <MenuItem value="exception">{t('settlement.status.exception')}</MenuItem>
                  </TextField>
                  {operationAction.settlementStatus === 'cleared' && (
                    <Alert severity="warning">{t('settlement.clearedWarning')}</Alert>
                  )}
                </>
              ) : (
                <TextField
                  select
                  fullWidth
                  label={t('dialogs.processingResult')}
                  value={operationAction.status}
                  onChange={(event) =>
                    setOperationAction({
                      ...operationAction,
                      status: event.target.value as OperationAction['status'],
                    })
                  }
                >
                  {operationAction.row.status === 'submitted' && (
                    <MenuItem value="processing">{t('actions.startProcessing')}</MenuItem>
                  )}
                  <MenuItem value="completed">{t('actions.completeAndPost')}</MenuItem>
                  <MenuItem value="rejected">{t('actions.rejectRequest')}</MenuItem>
                  <MenuItem value="cancelled">{t('actions.cancelRequest')}</MenuItem>
                </TextField>
              )}
              {!operationAction.settlementStatus && operationAction.status === 'completed' && (
                <TextField
                  fullWidth
                  required={requiresSettlementReference(operationAction.row)}
                  label={operationReferenceLabel(operationAction.row, t)}
                  value={settlementReference}
                  onChange={(event) => setSettlementReference(event.target.value)}
                  helperText={
                    operationAction.row.category === 'otc' || operationAction.row.sell_asset
                      ? t('dialogs.internalReferenceHelper')
                      : t('dialogs.referenceRequiredHelper')
                  }
                />
              )}
              <TextField
                fullWidth
                multiline
                minRows={3}
                label={
                  ['rejected', 'cancelled'].includes(operationAction.status)
                    ? t('fields.reasonOrOperatorNote')
                    : t('fields.operatorNoteOptional')
                }
                value={operatorNote}
                onChange={(event) => setOperatorNote(event.target.value)}
              />
              {!operationAction.settlementStatus && operationAction.status === 'completed' && (
                <Alert severity="warning">{t('dialogs.terminalWarning')}</Alert>
              )}
            </Stack>
          )}
        </DialogContent>
        <DialogActions>
          <Button
            color="inherit"
            disabled={operationSubmitting}
            onClick={() => setOperationAction(null)}
          >
            {t('actions.cancel')}
          </Button>
          <Button
            variant="contained"
            color={
              operationAction?.status === 'rejected' || operationAction?.status === 'cancelled'
                ? 'error'
                : 'primary'
            }
            disabled={operationSubmitting}
            onClick={submitOperationAction}
          >
            {operationSubmitting ? t('actions.submitting') : t('actions.confirmProcessing')}
          </Button>
        </DialogActions>
      </Dialog>
      <ConfirmDialog
        open={allowlistConfirmOpen}
        onClose={() => setAllowlistConfirmOpen(false)}
        title={t('security.enableConfirmTitle')}
        content={
          <Stack spacing={2}>
            <Alert severity="warning">{t('security.enableConfirmWarning')}</Alert>
            <Box>
              <Typography variant="subtitle2">{t('security.beforeEnable')}</Typography>
              <Typography variant="body2" color="text.secondary" sx={{ mt: 0.75 }}>
                {t('security.enabledRulesConfirm', {
                  rules: formatOperationNumber(
                    apiSecurity.ip_allowlist.filter((entry) => entry.enabled).length,
                    locale,
                    0
                  ),
                })}
              </Typography>
            </Box>
          </Stack>
        }
        action={
          <Button
            variant="contained"
            color="warning"
            disabled={
              securityMutation === 'global' ||
              !apiSecurity.ip_allowlist.some((entry) => entry.enabled)
            }
            onClick={() => updateIpAllowlistEnabled(true)}
          >
            {securityMutation === 'global' ? t('actions.enabling') : t('actions.confirmEnable')}
          </Button>
        }
      />
      <ConfirmDialog
        open={Boolean(deleteAllowlistEntry)}
        onClose={() => setDeleteAllowlistEntry(null)}
        title={t('security.deleteCidrTitle')}
        content={
          <Typography color="text.secondary">
            {t('security.deleteCidrDescription', {
              label: deleteAllowlistEntry?.label || t('security.unnamedRule'),
              cidr: deleteAllowlistEntry?.cidr,
            })}
          </Typography>
        }
        action={
          <Button
            variant="contained"
            color="error"
            disabled={Boolean(deleteAllowlistEntry && securityMutation === deleteAllowlistEntry.id)}
            onClick={removeIpAllowlistEntry}
          >
            {t('actions.delete')}
          </Button>
        }
      />
    </>
  );
}

function OperationDetail({ row, compact = false }: { row: Row; compact?: boolean }) {
  const { t, i18n } = useTranslation('operations');
  const locale = i18n.language === 'cn' ? 'zh-CN' : 'en-US';
  const isAudit = Boolean(row.action);
  const isOtc = row.category === 'otc' || Boolean(row.sell_asset);
  const typeValue = isOtc
    ? `${row.sell_asset || row.asset} → ${row.buy_asset || row.counter_asset}`
    : operationTypeLabel(row.type || row.entry_type, t);
  const amountLabel = isOtc ? t('details.sellAmount') : t('details.totalAmount');
  const amountValue = operationAmountValue(row, isOtc, locale);
  const netLabel = isOtc ? t('details.netBuyAmount') : t('details.feeAndNet');
  const netValue = operationNetValue(row, isOtc, locale);
  const networkValue = operationNetworkValue(row);
  const details: Array<[string, string | number | null | undefined]> = isAudit
    ? [
        [t('fields.customer'), row.customer_name || row.application_id],
        [t('audit.action'), auditActionLabel(row.action, t)],
        [t('audit.actor'), actorTypeLabel(row.actor_type, t)],
        [t('audit.time'), formatOperationDate(row.created_at, locale)],
      ]
    : [
        [t('fields.customer'), row.customer_name || row.application_id],
        [t('details.businessId'), row.id],
        [t('fields.type'), typeValue],
        [t('fields.status'), operationStatusLabel(row.status, t)],
        [amountLabel, amountValue],
        [netLabel, netValue],
        [t('fields.network'), networkValue],
        [t('details.createdAt'), formatOperationDate(row.created_at, locale)],
      ];

  return (
    <Stack spacing={compact ? 1.5 : 2.5}>
      <Box
        sx={{
          display: 'grid',
          gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, minmax(0, 1fr))' },
          gap: compact ? 1.25 : 2,
        }}
      >
        {details.map(([label, value]) => (
          <Box
            key={label}
            sx={{
              p: compact ? 1.25 : 1.75,
              borderRadius: 1.5,
              bgcolor: 'background.neutral',
              minWidth: 0,
            }}
          >
            <Typography variant="caption" color="text.secondary">
              {label}
            </Typography>
            <Typography variant="body2" sx={{ mt: 0.5, wordBreak: 'break-word' }}>
              {value === null || value === undefined || value === '' ? '-' : value}
            </Typography>
          </Box>
        ))}
      </Box>

      {!isAudit && (
        <>
          {(row.beneficiary_name || row.bank_name || row.bank_account_number) && (
            <Box>
              <Typography variant="subtitle2" sx={{ mb: 1 }}>
                {t('sectionsContent.bankRecipient')}
              </Typography>
              <Typography variant="body2" color="text.secondary" sx={{ whiteSpace: 'pre-line' }}>
                {[
                  row.beneficiary_name,
                  row.beneficiary_address,
                  row.bank_name,
                  row.bank_account_number,
                  row.swift_bic,
                  row.bank_address,
                ]
                  .filter(Boolean)
                  .join('\n')}
              </Typography>
            </Box>
          )}
          {(row.destination || row.transaction_reference || row.settlement_reference) && (
            <Box>
              <Typography variant="subtitle2" sx={{ mb: 1 }}>
                {t('details.settlementInformation')}
              </Typography>
              {row.destination && (
                <Typography variant="body2" color="text.secondary" sx={{ wordBreak: 'break-all' }}>
                  {t('details.recipientAddress', { value: row.destination })}
                </Typography>
              )}
              {(row.transaction_reference ||
                row.settlement_reference ||
                row.external_reference) && (
                <Typography variant="body2" color="text.secondary" sx={{ wordBreak: 'break-all' }}>
                  {t('details.reference', {
                    value:
                      row.transaction_reference ||
                      row.settlement_reference ||
                      row.external_reference,
                  })}
                </Typography>
              )}
            </Box>
          )}
          {(row.note || row.operator_note) && (
            <Box>
              <Typography variant="subtitle2" sx={{ mb: 1 }}>
                {t('details.notes')}
              </Typography>
              {row.note && (
                <Typography variant="body2" color="text.secondary">
                  {t('details.customerNote', {
                    value: localizedOperationNote(row.note, t),
                  })}
                </Typography>
              )}
              {row.operator_note && (
                <Typography variant="body2" color="text.secondary">
                  {t('details.operatorNote', { value: row.operator_note })}
                </Typography>
              )}
            </Box>
          )}
        </>
      )}

      {isAudit && row.metadata && (
        <Box>
          <Typography variant="subtitle2" sx={{ mb: 1 }}>
            {t('audit.operationContent')}
          </Typography>
          <Box
            component="pre"
            sx={{
              m: 0,
              p: 1.5,
              borderRadius: 1.5,
              bgcolor: 'background.neutral',
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
              typography: 'body2',
              fontFamily: 'monospace',
            }}
          >
            {JSON.stringify(row.metadata, null, 2)}
          </Box>
        </Box>
      )}
    </Stack>
  );
}

function AuditLogTable({ rows, onOpen }: { rows: Row[]; onOpen: (row: Row) => void }) {
  const { t, i18n } = useTranslation('operations');
  const locale = i18n.language === 'cn' ? 'zh-CN' : 'en-US';
  return (
    <Table>
      <TableHead>
        <TableRow>
          <TableCell>{t('audit.time')}</TableCell>
          <TableCell>{t('fields.customer')}</TableCell>
          <TableCell>{t('audit.action')}</TableCell>
          <TableCell>{t('audit.actor')}</TableCell>
          <TableCell align="right">{t('table.details')}</TableCell>
        </TableRow>
      </TableHead>
      <TableBody>
        {rows.map((row) => (
          <TableRow key={row.id} hover>
            <TableCell>{formatOperationDate(row.created_at, locale)}</TableCell>
            <TableCell>
              <Typography variant="body2">
                {row.customer_name ||
                  (row.application_id
                    ? t('fields.unknownCustomer')
                    : t('audit.systemConfiguration'))}
              </Typography>
              {row.application_id && (
                <Typography variant="caption" color="text.secondary">
                  {row.application_id}
                </Typography>
              )}
            </TableCell>
            <TableCell>
              <Typography variant="body2">{auditActionLabel(row.action, t)}</Typography>
              <Typography variant="caption" color="text.secondary">
                {row.action}
              </Typography>
            </TableCell>
            <TableCell>{actorTypeLabel(row.actor_type, t)}</TableCell>
            <TableCell align="right">
              <Button color="inherit" size="small" onClick={() => onOpen(row)}>
                {t('actions.view')}
              </Button>
            </TableCell>
          </TableRow>
        ))}
        {!rows.length && (
          <TableRow>
            <TableCell colSpan={5} align="center" sx={{ py: 6 }}>
              {t('empty.audit')}
            </TableCell>
          </TableRow>
        )}
      </TableBody>
    </Table>
  );
}

function ApiSecuritySettings({
  value,
  loading,
  loadError,
  mutation,
  form,
  formError,
  onFormChange,
  onCreate,
  onRefresh,
  onRequestEnable,
  onDisable,
  onToggleEntry,
  onDeleteEntry,
}: {
  value: ApiSecurityConfig;
  loading: boolean;
  loadError: string;
  mutation: string;
  form: { label: string; cidr: string };
  formError: string;
  onFormChange: (value: { label: string; cidr: string }) => void;
  onCreate: (event: FormEvent) => void | Promise<void>;
  onRefresh: () => void | Promise<void>;
  onRequestEnable: () => void;
  onDisable: () => void | Promise<void>;
  onToggleEntry: (entry: IpAllowlistEntry) => void | Promise<void>;
  onDeleteEntry: (entry: IpAllowlistEntry) => void;
}) {
  const { t, i18n } = useTranslation('operations');
  const locale = i18n.language === 'cn' ? 'zh-CN' : 'en-US';
  const activeCount = value.ip_allowlist.filter((entry) => entry.enabled).length;
  const controlsDisabled = loading || Boolean(loadError) || Boolean(mutation);

  return (
    <Box sx={{ p: { xs: 2, sm: 3 }, borderTop: '1px solid', borderColor: 'divider' }}>
      <Stack
        direction={{ xs: 'column', sm: 'row' }}
        alignItems={{ sm: 'flex-start' }}
        justifyContent="space-between"
        spacing={2}
      >
        <Box>
          <Typography variant="h5">{t('security.machineApiTitle')}</Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 0.75 }}>
            {t('security.machineApiDescription')}
          </Typography>
        </Box>
        <Button
          color="inherit"
          startIcon={<Iconify icon="solar:refresh-linear" />}
          disabled={loading || Boolean(mutation)}
          onClick={() => onRefresh()}
        >
          {loading ? t('actions.loading') : t('actions.refreshStatus')}
        </Button>
      </Stack>

      {(loading || loadError) && (
        <Alert
          severity={loadError ? 'error' : 'info'}
          sx={{ mt: 2.5 }}
          action={
            loadError ? (
              <Button color="inherit" size="small" disabled={loading} onClick={() => onRefresh()}>
                {t('actions.reload')}
              </Button>
            ) : undefined
          }
        >
          {loadError || t('loading.security')}
        </Alert>
      )}

      <Box
        sx={{
          mt: 3,
          display: 'grid',
          gridTemplateColumns: { xs: '1fr', md: 'minmax(0, 1fr) 48px minmax(0, 1fr)' },
          alignItems: 'stretch',
          gap: { xs: 1.5, md: 0 },
        }}
      >
        <Box
          sx={{
            p: { xs: 2, sm: 2.5 },
            border: '1px solid',
            borderColor: 'divider',
            borderRadius: 2,
          }}
        >
          <Stack direction="row" justifyContent="space-between" alignItems="flex-start" spacing={2}>
            <Stack direction="row" spacing={1.5}>
              <Box
                sx={{
                  width: 42,
                  height: 42,
                  display: 'grid',
                  placeItems: 'center',
                  borderRadius: 1.5,
                  bgcolor: 'success.lighter',
                  color: 'success.dark',
                  flexShrink: 0,
                }}
              >
                <Iconify icon="solar:key-minimalistic-square-bold-duotone" width={24} />
              </Box>
              <Box>
                <Typography variant="overline" color="text.secondary">
                  {t('security.firstLayer')}
                </Typography>
                <Typography variant="subtitle1">{t('security.accessToken')}</Typography>
              </Box>
            </Stack>
            <Label color={value.access_service_token_required ? 'success' : 'error'}>
              {value.access_service_token_required ? t('status.enforced') : t('status.abnormal')}
            </Label>
          </Stack>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 2 }}>
            {t('security.accessTokenDescription')}
          </Typography>
        </Box>

        <Box
          sx={{
            display: 'grid',
            placeItems: 'center',
            color: 'text.disabled',
            transform: { xs: 'rotate(90deg)', md: 'none' },
          }}
        >
          <Iconify icon="solar:alt-arrow-right-linear" width={24} />
        </Box>

        <Box
          sx={{
            p: { xs: 2, sm: 2.5 },
            border: '1px solid',
            borderColor: value.ip_allowlist_enabled ? 'success.main' : 'divider',
            borderRadius: 2,
          }}
        >
          <Stack direction="row" justifyContent="space-between" alignItems="flex-start" spacing={2}>
            <Stack direction="row" spacing={1.5}>
              <Box
                sx={{
                  width: 42,
                  height: 42,
                  display: 'grid',
                  placeItems: 'center',
                  borderRadius: 1.5,
                  bgcolor: value.ip_allowlist_enabled ? 'success.lighter' : 'background.neutral',
                  color: value.ip_allowlist_enabled ? 'success.dark' : 'text.secondary',
                  flexShrink: 0,
                }}
              >
                <Iconify icon="solar:shield-network-bold-duotone" width={24} />
              </Box>
              <Box>
                <Typography variant="overline" color="text.secondary">
                  {t('security.secondLayer')}
                </Typography>
                <Typography variant="subtitle1">{t('security.ipAllowlist')}</Typography>
              </Box>
            </Stack>
            <Label color={value.ip_allowlist_enabled ? 'success' : 'default'}>
              {value.ip_allowlist_enabled ? t('status.enabled') : t('status.offByDefault')}
            </Label>
          </Stack>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 2 }}>
            {t('security.activeCidrSummary', {
              cidrs: formatOperationNumber(activeCount, locale, 0),
            })}
          </Typography>
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} sx={{ mt: 2.5 }}>
            {value.ip_allowlist_enabled ? (
              <Button
                variant="outlined"
                color="inherit"
                disabled={controlsDisabled}
                onClick={onDisable}
              >
                {mutation === 'global' ? t('actions.disabling') : t('security.disableAllowlist')}
              </Button>
            ) : (
              <Button
                variant="contained"
                disabled={controlsDisabled || activeCount < 1}
                onClick={onRequestEnable}
              >
                {t('security.enableAllowlist')}
              </Button>
            )}
            {!value.ip_allowlist_enabled && activeCount < 1 && (
              <Typography variant="caption" color="text.secondary" sx={{ alignSelf: 'center' }}>
                {t('security.enableRequirement')}
              </Typography>
            )}
          </Stack>
        </Box>
      </Box>

      <Box
        sx={{
          mt: 2.5,
          p: 2,
          display: 'flex',
          alignItems: { xs: 'flex-start', sm: 'center' },
          justifyContent: 'space-between',
          flexDirection: { xs: 'column', sm: 'row' },
          gap: 1.5,
          border: '1px solid',
          borderColor: 'divider',
          borderRadius: 1.5,
          bgcolor: 'background.neutral',
        }}
      >
        <Stack direction="row" spacing={1.25} alignItems="flex-start">
          <Iconify
            icon="solar:clock-circle-bold-duotone"
            width={24}
            sx={{ color: 'primary.main', flexShrink: 0 }}
          />
          <Box>
            <Typography variant="subtitle1">{t('security.trafficProtection')}</Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mt: 0.25 }}>
              {t('security.rateLimitDescription', {
                seconds: formatOperationNumber(value.rate_limit.period_seconds, locale, 0),
                limit: formatOperationNumber(value.rate_limit.limit, locale, 0),
              })}
            </Typography>
          </Box>
        </Stack>
        <Label color={value.rate_limit.enabled ? 'success' : 'warning'}>
          {value.rate_limit.enabled ? t('status.enabled') : t('status.abnormal')}
        </Label>
      </Box>

      <Alert severity={value.ip_allowlist_enabled ? 'success' : 'info'} sx={{ mt: 3 }}>
        {value.ip_allowlist_enabled
          ? t('security.allowlistActiveNotice')
          : t('security.allowlistInactiveNotice')}
      </Alert>

      <Divider sx={{ my: 3 }} />

      <Box>
        <Typography variant="h6">{t('security.cidrRules')}</Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
          {t('security.cidrRecommendation')}
        </Typography>

        <Box
          component="form"
          onSubmit={onCreate}
          sx={{
            mt: 2.5,
            display: 'grid',
            gridTemplateColumns: {
              xs: '1fr',
              md: 'minmax(180px, 0.7fr) minmax(280px, 1fr) auto',
            },
            gap: 1.5,
            alignItems: 'start',
          }}
        >
          <TextField
            label={t('fields.nameOptional')}
            placeholder={t('security.namePlaceholder')}
            value={form.label}
            disabled={controlsDisabled}
            onChange={(event) => onFormChange({ ...form, label: event.target.value })}
          />
          <TextField
            required
            label="CIDR"
            placeholder="203.0.113.10/32"
            value={form.cidr}
            disabled={controlsDisabled}
            error={Boolean(formError)}
            helperText={formError || t('security.cidrHelper')}
            onChange={(event) => onFormChange({ ...form, cidr: event.target.value })}
          />
          <Button
            type="submit"
            variant="contained"
            size="large"
            disabled={controlsDisabled || !form.cidr.trim()}
            sx={{ minHeight: 54, px: 3 }}
          >
            {mutation === 'create' ? t('actions.adding') : t('security.addCidr')}
          </Button>
        </Box>
      </Box>

      <Box sx={{ mt: 3, overflowX: 'auto' }}>
        <Table sx={{ minWidth: 780 }}>
          <TableHead>
            <TableRow>
              <TableCell>{t('fields.name')}</TableCell>
              <TableCell>CIDR</TableCell>
              <TableCell>{t('fields.status')}</TableCell>
              <TableCell>{t('security.updatedAt')}</TableCell>
              <TableCell align="right">{t('table.actions')}</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {value.ip_allowlist.map((entry) => {
              const protectsLastActive =
                value.ip_allowlist_enabled && entry.enabled && activeCount === 1;
              const entryBusy = mutation === entry.id;
              let actionLabel = entry.enabled ? t('actions.disable') : t('actions.enable');
              if (entryBusy) actionLabel = t('actions.processing');
              return (
                <TableRow key={entry.id} hover>
                  <TableCell>
                    <Typography variant="subtitle2">
                      {entry.label || t('security.unnamedRule')}
                    </Typography>
                    <Typography variant="caption" color="text.secondary">
                      {entry.id}
                    </Typography>
                  </TableCell>
                  <TableCell>
                    <Typography variant="body2" sx={{ fontWeight: 600 }}>
                      {entry.cidr}
                    </Typography>
                  </TableCell>
                  <TableCell>
                    <Label color={entry.enabled ? 'success' : 'default'}>
                      {entry.enabled ? t('status.enabled') : t('status.disabled')}
                    </Label>
                  </TableCell>
                  <TableCell>
                    <Typography variant="body2">
                      {formatFeeDate(entry.updated_at || entry.created_at, locale)}
                    </Typography>
                    {entry.created_at && (
                      <Typography variant="caption" color="text.secondary">
                        {t('security.createdAt', {
                          date: formatFeeDate(entry.created_at, locale),
                        })}
                      </Typography>
                    )}
                  </TableCell>
                  <TableCell align="right">
                    <Stack direction="row" spacing={0.75} justifyContent="flex-end">
                      <Button
                        size="small"
                        color={entry.enabled ? 'inherit' : 'primary'}
                        disabled={controlsDisabled || entryBusy || protectsLastActive}
                        onClick={() => onToggleEntry(entry)}
                      >
                        {actionLabel}
                      </Button>
                      <Button
                        size="small"
                        color="error"
                        disabled={controlsDisabled || entryBusy || protectsLastActive}
                        onClick={() => onDeleteEntry(entry)}
                      >
                        {t('actions.delete')}
                      </Button>
                    </Stack>
                    {protectsLastActive && (
                      <Typography variant="caption" color="warning.dark">
                        {t('security.disableBeforeEditing')}
                      </Typography>
                    )}
                  </TableCell>
                </TableRow>
              );
            })}
            {!value.ip_allowlist.length && (
              <TableRow>
                <TableCell colSpan={5} align="center" sx={{ py: 7 }}>
                  <Iconify
                    icon="solar:shield-network-bold-duotone"
                    width={38}
                    sx={{ color: 'text.disabled', mb: 1 }}
                  />
                  <Typography variant="subtitle2">{t('empty.cidrTitle')}</Typography>
                  <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
                    {t('empty.cidrDescription')}
                  </Typography>
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </Box>
    </Box>
  );
}

function WithdrawalFeeSettings({
  rows,
  drafts,
  saving,
  loading,
  loadError,
  onDraftChange,
  onSave,
  onRefresh,
}: {
  rows: Row[];
  drafts: Record<WithdrawalFeeType, string>;
  saving: WithdrawalFeeType | '';
  loading: boolean;
  loadError: string;
  onDraftChange: (type: WithdrawalFeeType, amount: string) => void;
  onSave: (type: WithdrawalFeeType) => void | Promise<void>;
  onRefresh: () => void | Promise<void>;
}) {
  const { t, i18n } = useTranslation('operations');
  const locale = i18n.language === 'cn' ? 'zh-CN' : 'en-US';
  return (
    <Box sx={{ p: { xs: 2, sm: 3 }, borderTop: '1px solid', borderColor: 'divider' }}>
      <Stack
        direction={{ xs: 'column', sm: 'row' }}
        alignItems={{ sm: 'flex-start' }}
        justifyContent="space-between"
        spacing={2}
      >
        <Box>
          <Typography variant="h5">{t('fees.title')}</Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 0.75 }}>
            {t('fees.description')}
          </Typography>
        </Box>
        <Button
          color="inherit"
          startIcon={<Iconify icon="solar:refresh-linear" />}
          disabled={Boolean(saving) || loading}
          onClick={() => onRefresh()}
        >
          {loading ? t('actions.loading') : t('actions.refreshConfiguration')}
        </Button>
      </Stack>

      <Box
        sx={{
          mt: 3,
          p: 2,
          display: 'flex',
          alignItems: 'flex-start',
          gap: 1.5,
          borderRadius: 1.5,
          bgcolor: 'info.lighter',
          color: 'info.darker',
        }}
      >
        <Iconify icon="solar:info-circle-bold-duotone" width={22} sx={{ flexShrink: 0 }} />
        <Typography variant="body2">{t('fees.deductionExplanation')}</Typography>
      </Box>

      {(loading || loadError) && (
        <Alert
          severity={loadError ? 'error' : 'info'}
          sx={{ mt: 2.5 }}
          action={
            loadError ? (
              <Button color="inherit" size="small" disabled={loading} onClick={() => onRefresh()}>
                {t('actions.reload')}
              </Button>
            ) : undefined
          }
        >
          {loadError || t('loading.fees')}
        </Alert>
      )}

      <Box
        sx={{
          mt: 3,
          display: 'grid',
          gridTemplateColumns: { xs: '1fr', md: 'repeat(2, minmax(0, 1fr))' },
          gap: 2.5,
        }}
      >
        {WITHDRAWAL_FEE_DEFINITIONS.map((definition) => {
          const current = rows.find((row) => row.type === definition.type);
          const currentAmount = current?.amount === undefined ? '' : String(current.amount);
          const changed = drafts[definition.type] !== currentAmount;
          const isSaving = saving === definition.type;
          return (
            <Box
              key={definition.type}
              sx={{
                p: { xs: 2, sm: 2.5 },
                border: '1px solid',
                borderColor: 'divider',
                borderRadius: 2,
              }}
            >
              <Stack direction="row" alignItems="center" spacing={1.5}>
                <Box
                  sx={{
                    width: 44,
                    height: 44,
                    display: 'grid',
                    placeItems: 'center',
                    borderRadius: 1.5,
                    bgcolor:
                      definition.type === 'fiat_withdrawal' ? 'info.lighter' : 'success.lighter',
                    color: definition.type === 'fiat_withdrawal' ? 'info.dark' : 'success.dark',
                  }}
                >
                  <Iconify icon={definition.icon} width={24} />
                </Box>
                <Box>
                  <Typography variant="subtitle1">{t(definition.labelKey)}</Typography>
                  <Typography variant="caption" color="text.secondary">
                    {t('fees.fixedCharge', { asset: definition.asset })}
                  </Typography>
                </Box>
              </Stack>

              <Typography variant="body2" color="text.secondary" sx={{ mt: 2 }}>
                {t(definition.descriptionKey)}
              </Typography>
              <Divider sx={{ my: 2.5 }} />

              <TextField
                fullWidth
                type="number"
                label={t('fees.perTransaction')}
                value={drafts[definition.type]}
                onChange={(event) => onDraftChange(definition.type, event.target.value)}
                inputProps={{ min: 0, step: definition.asset === 'USD' ? 0.01 : 0.000001 }}
                InputProps={{
                  endAdornment: <InputAdornment position="end">{definition.asset}</InputAdornment>,
                }}
                helperText={
                  current
                    ? t('fees.currentSetting', {
                        amount: formatOperationNumber(current.amount, locale),
                        asset: current.asset,
                        date: formatFeeDate(current.updated_at, locale),
                      })
                    : t('fees.cloudConfigMissing')
                }
              />

              <Stack
                direction={{ xs: 'column-reverse', sm: 'row' }}
                justifyContent="flex-end"
                spacing={1}
                sx={{ mt: 2.5 }}
              >
                {changed && current && (
                  <Button
                    color="inherit"
                    disabled={Boolean(saving)}
                    onClick={() => onDraftChange(definition.type, currentAmount)}
                  >
                    {t('actions.undoChanges')}
                  </Button>
                )}
                <Button
                  variant="contained"
                  disabled={
                    !current || !changed || Boolean(saving) || loading || Boolean(loadError)
                  }
                  onClick={() => onSave(definition.type)}
                >
                  {isSaving ? t('actions.saving') : t('actions.saveAndApply')}
                </Button>
              </Stack>
            </Box>
          );
        })}
      </Box>
    </Box>
  );
}

function operationReferencePatch(otcRow: boolean, reference: string) {
  const value = reference.trim();
  if (!value) return {};
  return otcRow ? { settlement_reference: value } : { transaction_reference: value };
}

function operationActionMessage(status: OperationAction['status'], t: TFunction<'operations'>) {
  const messages: Record<OperationAction['status'], string> = {
    processing: t('messages.markedProcessing'),
    completed: t('messages.completedAndPosted'),
    rejected: t('messages.rejectedAndReleased'),
    cancelled: t('messages.cancelledAndReleased'),
  };
  return messages[status];
}

function operationReferenceLabel(row: Row, t: TFunction<'operations'>) {
  if (row.category === 'otc' || row.sell_asset) return t('fields.internalReferenceOptional');
  if (row.type === 'fiat_withdrawal') return t('fields.bankTransactionReference');
  if (row.type === 'usdt_withdrawal') return t('fields.txHash');
  if (row.type === 'fiat_deposit') return t('fields.bankDepositReference');
  if (row.type === 'usdt_deposit') return t('fields.txHash');
  return t('fields.settlementReference');
}

function missingReferenceMessage(row: Row, t: TFunction<'operations'>) {
  if (row.type === 'fiat_withdrawal') return t('errors.bankReferenceRequired');
  if (row.type === 'usdt_withdrawal') return t('errors.txHashRequired');
  return t('errors.depositReferenceRequired');
}

function renderOperationType(row: Row, t: TFunction<'operations'>) {
  if (row.type || row.entry_type) return operationTypeLabel(row.type || row.entry_type, t);
  if (!row.sell_asset) return t('types.balance');
  return (
    <Stack spacing={0.5}>
      <Typography variant="body2">
        {row.sell_asset} → {row.buy_asset}
      </Typography>
      <Stack direction="row" spacing={0.75} alignItems="center">
        <OtcLegValue asset={row.sell_asset} network={row.sell_network} />
        <Iconify icon="solar:alt-arrow-right-linear" width={15} color="text.disabled" />
        <OtcLegValue asset={row.buy_asset} network={row.buy_network} />
      </Stack>
    </Stack>
  );
}

function operationAmountValue(row: Row, otc: boolean, locale: string) {
  if (otc) {
    return `${formatOperationNumber(row.sell_amount ?? row.amount ?? '-', locale)} ${
      row.sell_asset || row.asset || ''
    }`;
  }
  if (row.amount !== undefined) {
    return `${formatOperationNumber(row.amount, locale)} ${row.asset || ''}`;
  }
  if (row.balance !== undefined) {
    return `${formatOperationNumber(row.balance, locale)} ${row.asset || ''}`;
  }
  return '-';
}

function operationNetValue(row: Row, otc: boolean, locale: string) {
  if (otc) {
    return `${formatOperationNumber(row.net_buy_amount ?? row.counter_amount ?? '-', locale)} ${
      row.buy_asset || row.counter_asset || ''
    }`;
  }
  if (!isWithdrawal(row)) return '-';
  return `${formatOperationNumber(row.fee_amount ?? 0, locale)} / ${formatOperationNumber(
    row.net_amount ?? calculateNetAmount(row),
    locale
  )} ${row.asset}`;
}

function operationNetworkValue(row: Row) {
  if (row.network) return networkDisplayName(row.network);
  if (row.buy_network) return networkDisplayName(row.buy_network);
  if (row.counter_network) return networkDisplayName(row.counter_network);
  return '-';
}

function isOtcRow(row: Row) {
  return row.category === 'otc' || Boolean(row.sell_asset);
}

function isCompletedOtc(row: Row) {
  return isOtcRow(row) && row.status === 'completed';
}

type OperationAmountDirection = 'credit' | 'debit' | 'neutral';

function operationAmountDirection(row: Row): OperationAmountDirection {
  if (row.balance !== undefined) return 'neutral';
  if (row.direction === 'credit' || row.direction === 'debit') return row.direction;
  if (isCompletedOtc(row)) return 'credit';
  if (['fiat_deposit', 'usdt_deposit', 'crypto_conversion_credit'].includes(row.type || '')) {
    return 'credit';
  }
  if (
    ['fiat_withdrawal', 'usdt_withdrawal', 'fiat_conversion_debit', 'usdt_sweep'].includes(
      row.type || ''
    )
  ) {
    return 'debit';
  }
  return 'neutral';
}

function operationAmountPresentation(direction: OperationAmountDirection) {
  if (direction === 'credit') {
    return { prefix: '+', color: 'success.dark', fontWeight: 600 } as const;
  }
  if (direction === 'debit') {
    return { prefix: '−', color: 'error.dark', fontWeight: 600 } as const;
  }
  return { prefix: '', color: 'text.primary', fontWeight: 400 } as const;
}

function OperationTableAmount({
  row,
  locale,
  showOtcFlow,
}: {
  row: Row;
  locale: string;
  showOtcFlow: boolean;
}) {
  if (showOtcFlow && isOtcRow(row)) {
    const completed = isCompletedOtc(row);
    const sellAmount = row.sell_amount ?? row.amount ?? '';
    const sellAsset = row.sell_asset || row.asset || '';
    const buyAmount = row.net_buy_amount ?? row.counter_amount ?? row.buy_amount ?? '';
    const buyAsset = row.buy_asset || row.counter_asset || '';

    return (
      <Stack direction="row" spacing={0.75} alignItems="center" flexWrap="wrap">
        <Typography
          component="span"
          variant="body2"
          sx={{
            color: completed ? 'error.dark' : 'text.primary',
            fontWeight: completed ? 600 : 400,
          }}
        >
          {completed ? '−' : ''}
          {formatOperationNumber(sellAmount, locale)} {sellAsset}
        </Typography>
        <Iconify icon="solar:alt-arrow-right-linear" width={15} color="text.disabled" />
        <Typography
          component="span"
          variant="body2"
          sx={{
            color: completed ? 'success.dark' : 'text.primary',
            fontWeight: completed ? 600 : 400,
          }}
        >
          {completed ? '+' : ''}
          {formatOperationNumber(buyAmount, locale)} {buyAsset}
        </Typography>
      </Stack>
    );
  }

  const direction = operationAmountDirection(row);
  const presentation = operationAmountPresentation(direction);
  const amount = isOtcRow(row)
    ? row.net_buy_amount ?? row.counter_amount ?? row.buy_amount ?? ''
    : row.balance ?? row.amount ?? '';
  const asset = isOtcRow(row) ? row.buy_asset || row.counter_asset || '' : row.asset || '';

  return (
    <Typography
      variant="body2"
      sx={{ color: presentation.color, fontWeight: presentation.fontWeight }}
    >
      {presentation.prefix}
      {formatOperationNumber(amount, locale)} {asset}
    </Typography>
  );
}

function canProcessTransaction(row: Row) {
  return (
    row.category === 'fund' &&
    ['fiat_deposit', 'usdt_deposit', 'fiat_withdrawal', 'usdt_withdrawal'].includes(
      row.type || ''
    ) &&
    ['submitted', 'processing'].includes(row.status || '')
  );
}

function transactionChannel(row: Row) {
  if (row.category === 'otc' || row.type === 'otc') {
    return `${row.asset || row.sell_asset || '-'} → ${row.counter_asset || row.buy_asset || '-'}`;
  }
  if (row.network) return networkDisplayName(row.network);
  if ((row.type || '').startsWith('fiat_')) return 'Bank';
  return '-';
}

function TransactionHistoryTable({
  rows,
  locale,
  onOpen,
  onProcess,
  onSettlement,
}: {
  rows: Row[];
  locale: string;
  onOpen: (row: Row) => void;
  onProcess: (row: Row) => void;
  onSettlement: (row: Row) => void;
}) {
  const { t } = useTranslation('operations');

  return (
    <Box sx={{ overflowX: 'auto' }}>
      <Table sx={{ minWidth: 1180, tableLayout: 'fixed' }}>
        <TableHead>
          <TableRow>
            <TableCell>{t('table.time')}</TableCell>
            <TableCell>{t('fields.customer')}</TableCell>
            <TableCell>{t('fields.type')}</TableCell>
            <TableCell>{t('table.channelNetwork')}</TableCell>
            <TableCell>{t('fields.amount')}</TableCell>
            <TableCell>{t('fields.status')}</TableCell>
            <TableCell>{t('table.transactionId')}</TableCell>
            <TableCell align="right">{t('table.actions')}</TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {rows.map((row) => {
            const processable = canProcessTransaction(row);
            return (
              <TableRow key={row.id} hover>
                <TableCell sx={{ whiteSpace: 'nowrap' }}>
                  {formatOperationDate(row.created_at, locale)}
                </TableCell>
                <TableCell>
                  <Typography variant="subtitle2" noWrap title={row.customer_name || '-'}>
                    {row.customer_name || '-'}
                  </Typography>
                  <Typography
                    variant="caption"
                    color="text.secondary"
                    noWrap
                    title={row.application_id || '-'}
                    sx={{ display: 'block' }}
                  >
                    {row.application_id || '-'}
                  </Typography>
                </TableCell>
                <TableCell>{operationTypeLabel(row.type, t)}</TableCell>
                <TableCell>{transactionChannel(row)}</TableCell>
                <TableCell>
                  <OperationTableAmount row={row} locale={locale} showOtcFlow />
                  {isWithdrawal(row) && (
                    <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
                      {t('table.feeAndNet', {
                        fee: formatOperationNumber(row.fee_amount ?? 0, locale),
                        net: formatOperationNumber(
                          row.net_amount ?? calculateNetAmount(row),
                          locale
                        ),
                        asset: row.asset,
                      })}
                    </Typography>
                  )}
                </TableCell>
                <TableCell>
                  <Label color={operationStatusColor(row.status)}>
                    {operationStatusLabel(row.status || 'posted', t)}
                  </Label>
                </TableCell>
                <TableCell>
                  <Typography variant="caption" noWrap title={row.id} sx={{ display: 'block' }}>
                    {row.id}
                  </Typography>
                </TableCell>
                <TableCell align="right">
                  <Stack direction="row" spacing={1} justifyContent="flex-end">
                    <Button size="small" color="inherit" onClick={() => onOpen(row)}>
                      {t('actions.view')}
                    </Button>
                    {processable && (
                      <Button size="small" variant="contained" onClick={() => onProcess(row)}>
                        {t('actions.openProcessing')}
                      </Button>
                    )}
                    {processable &&
                      row.type === 'fiat_deposit' &&
                      row.settlement_status !== 'cleared' && (
                        <Button
                          size="small"
                          color="warning"
                          variant="outlined"
                          onClick={() => onSettlement(row)}
                        >
                          {t('actions.settle')}
                        </Button>
                      )}
                  </Stack>
                </TableCell>
              </TableRow>
            );
          })}
          {!rows.length && (
            <TableRow>
              <TableCell colSpan={8} align="center" sx={{ py: 6 }}>
                {t('empty.records')}
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
    </Box>
  );
}

function operationStatusColor(status?: string) {
  if (status === 'completed') return 'success';
  if (status === 'rejected' || status === 'cancelled') return 'error';
  if (status) return 'warning';
  return 'default';
}

function operationStatusLabel(status: string | undefined, t: TFunction<'operations'>) {
  const labels: Record<string, string> = {
    submitted: t('status.submitted'),
    processing: t('status.processing'),
    completed: t('status.completed'),
    rejected: t('status.rejected'),
    cancelled: t('status.cancelled'),
    posted: t('status.posted'),
  };
  return labels[status || ''] || status || '-';
}

function operationTypeLabel(type: string | undefined, t: TFunction<'operations'>) {
  const labels: Record<string, string> = {
    fiat_deposit: t('types.fiatDeposit'),
    usdt_deposit: t('types.usdtDeposit'),
    fiat_withdrawal: t('types.fiatWithdrawal'),
    usdt_withdrawal: t('types.usdtWithdrawal'),
    otc: 'OTC',
    fiat_conversion_debit: t('types.fiatConversionDebit'),
    crypto_conversion_credit: t('types.cryptoConversionCredit'),
    usdt_sweep: t('types.usdtSweep'),
    otc_sell: t('types.otcSell'),
    otc_buy_net: t('types.otcBuyNet'),
  };
  return labels[type || ''] || type || '-';
}

function auditActionLabel(action: string | undefined, t: TFunction<'operations'>) {
  if (!action) return '-';
  const knownAction = AUDIT_ACTIONS.find((item) => item.value === action);
  if (knownAction) return t(knownAction.labelKey);
  const [resource, status] = action.split('.');
  const resources: Record<string, string> = {
    application: t('audit.resources.application'),
    kyc: t('audit.resources.kyc'),
    va_account: t('audit.resources.vaAccount'),
    status: t('audit.resources.onboardingStatus'),
    va_application: t('audit.resources.vaApplication'),
    fund_transaction: t('audit.resources.fundTransaction'),
    otc_order: t('audit.resources.otcOrder'),
    withdrawal_fee: t('audit.resources.withdrawalFee'),
    api_security: t('audit.resources.apiSecurity'),
    api_ip_allowlist: t('audit.resources.ipAllowlist'),
  };
  const statuses: Record<string, string> = {
    created: t('audit.verbs.created'),
    processing: t('audit.verbs.processing'),
    completed: t('audit.verbs.completed'),
    rejected: t('audit.verbs.rejected'),
    cancelled: t('audit.verbs.cancelled'),
    updated: t('audit.verbs.updated'),
    profile_updated: t('audit.verbs.profileUpdated'),
    link_added: t('audit.verbs.linkAdded'),
    link_updated: t('audit.verbs.linkUpdated'),
    activated: t('audit.verbs.activated'),
    enabled: t('audit.verbs.enabled'),
    disabled: t('audit.verbs.disabled'),
    deleted: t('audit.verbs.deleted'),
  };
  return t('audit.actionSummary', {
    resource: resources[resource] || resource,
    status: statuses[status] || status || t('audit.verbs.changed'),
  });
}

function actorTypeLabel(actorType: string | undefined, t: TFunction<'operations'>) {
  if (actorType === 'partner') return t('audit.partner');
  if (actorType === 'operator') return t('audit.admin');
  return actorType || '-';
}

function formatOperationDate(value: string | undefined, locale: string) {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(locale, {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

function networkDisplayName(network?: string) {
  if (!network) return '-';
  const value = CRYPTO_NETWORKS.find((item) => item.value === network);
  return value ? `${value.label} (${value.standard})` : network;
}

function normalizeApiSecurity(value: any): ApiSecurityConfig {
  const source = value?.data || value || {};
  const token = source.access_service_token || {};
  let rawEntries: any[] = [];
  if (Array.isArray(source.ip_allowlist)) rawEntries = source.ip_allowlist;
  else if (Array.isArray(source.entries)) rawEntries = source.entries;
  return {
    access_service_token_required: Boolean(
      source.access_service_token_required ?? token.required ?? token.enabled ?? true
    ),
    ip_allowlist_enabled: Boolean(source.ip_allowlist_enabled),
    rate_limit: {
      enabled: source.rate_limit?.enabled !== false,
      limit: Number(source.rate_limit?.limit || 120),
      period_seconds: Number(source.rate_limit?.period_seconds || 60),
    },
    ip_allowlist: rawEntries.map((entry: any) => ({
      id: String(entry.id || ''),
      label: String(entry.label || entry.name || ''),
      cidr: String(entry.cidr || ''),
      enabled: entry.enabled === true || entry.enabled === 1 || entry.status === 'active',
      created_at: entry.created_at ? String(entry.created_at) : undefined,
      updated_at: entry.updated_at ? String(entry.updated_at) : undefined,
    })),
  };
}

function isValidCidr(value: string) {
  const parts = value.split('/');
  if (parts.length > 2 || !parts[0]) return false;
  const address = parts[0];
  if (address.includes(':')) {
    const prefixText = parts[1] ?? '128';
    if (!/^\d+$/.test(prefixText)) return false;
    const prefix = Number(prefixText);
    if (prefix < 0 || prefix > 128 || !/^[0-9a-fA-F:]+$/.test(address)) return false;
    if (
      address.includes(':::') ||
      (address.startsWith(':') && !address.startsWith('::')) ||
      (address.endsWith(':') && !address.endsWith('::'))
    ) {
      return false;
    }
    if ((address.match(/::/g) || []).length > 1) return false;
    const segments = address.split(':').filter(Boolean);
    if (segments.some((segment) => segment.length > 4)) return false;
    return address.includes('::') ? segments.length < 8 : segments.length === 8;
  }
  const prefixText = parts[1] ?? '32';
  if (!/^\d+$/.test(prefixText)) return false;
  const prefix = Number(prefixText);
  if (prefix < 0 || prefix > 32) return false;
  const octets = address.split('.');
  return (
    octets.length === 4 &&
    octets.every(
      (octet) => /^(0|[1-9]\d{0,2})$/.test(octet) && Number(octet) >= 0 && Number(octet) <= 255
    )
  );
}

function isWithdrawal(row: Row) {
  return Boolean(row.type?.endsWith('_withdrawal'));
}

function localizedOperationNote(value: string, t: TFunction<'operations'>) {
  if (value === '法币清算自动兑换') {
    return t('details.fiatSettlementAutoConversion');
  }
  return value;
}

function requiresSettlementReference(row: Row) {
  return !(row.category === 'otc' || row.sell_asset || row.entry_type || row.balance !== undefined);
}

function calculateNetAmount(row: Row) {
  const amount = Number(row.amount || 0);
  const fee = Number(row.fee_amount || 0);
  if (!Number.isFinite(amount) || !Number.isFinite(fee)) return '-';
  return Number(Math.max(0, amount - fee).toFixed(row.asset === 'USD' ? 2 : 6)).toString();
}

function formatOperationNumber(value: string | number, locale: string, maximumFractionDigits = 6) {
  if (value === '' || value === '-') return value;
  const number = Number(value);
  if (!Number.isFinite(number)) return String(value);
  return new Intl.NumberFormat(locale, {
    minimumFractionDigits: 0,
    maximumFractionDigits,
  }).format(number);
}

function formatFeeDate(value: string | undefined, locale: string) {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(locale, {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

function withdrawalDestination(row: Row) {
  if (row.type === 'fiat_withdrawal') {
    return [
      row.beneficiary_name,
      row.beneficiary_address,
      row.bank_name,
      row.bank_account_number,
      row.swift_bic,
    ]
      .filter(Boolean)
      .join(' · ');
  }
  if (row.type?.startsWith('usdt_')) {
    return [row.network, row.destination].filter(Boolean).join(' · ');
  }
  return '';
}

function NetworkValue({ network, compact = false }: { network: string; compact?: boolean }) {
  const value = CRYPTO_NETWORKS.find((item) => item.value === network);
  if (!value) return <Typography variant="caption">{network}</Typography>;
  return (
    <Stack direction="row" spacing={0.75} alignItems="center" sx={{ mt: compact ? 0.5 : 0 }}>
      <Iconify icon={value.icon} width={compact ? 16 : 21} />
      <Typography
        variant={compact ? 'caption' : 'body2'}
        color={compact ? 'text.secondary' : 'text.primary'}
      >
        {value.label} ({value.standard})
      </Typography>
    </Stack>
  );
}

function OtcLegValue({ asset, network }: { asset: string; network?: string }) {
  if (network) return <NetworkValue network={network} compact />;
  return (
    <Stack direction="row" spacing={0.75} alignItems="center">
      <Iconify icon={asset === 'USD' ? USD_ASSET_ICON : USDT_ASSET_ICON} width={16} />
      <Typography variant="caption" color="text.secondary">
        {asset}
      </Typography>
    </Stack>
  );
}

function NetworkSelect({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (network: string) => void;
}) {
  return (
    <TextField
      select
      required
      size="small"
      label={label}
      value={value}
      onChange={(event) => onChange(event.target.value)}
      SelectProps={{
        renderValue: (selected) => <NetworkValue network={String(selected)} />,
      }}
      sx={{ minWidth: 180 }}
    >
      {CRYPTO_NETWORKS.map((network) => (
        <MenuItem key={network.value} value={network.value}>
          <NetworkValue network={network.value} />
        </MenuItem>
      ))}
    </TextField>
  );
}

function stableIdempotencyKey(
  ref: { current: StableIdempotencyRequests },
  payload: Record<string, unknown>
) {
  const signature = JSON.stringify(payload);
  if (!ref.current.has(signature)) {
    ref.current.set(signature, crypto.randomUUID());
  }
  return ref.current.get(signature) as string;
}

function clearStableIdempotencyKey(
  ref: { current: StableIdempotencyRequests },
  payload: Record<string, unknown>
) {
  ref.current.delete(JSON.stringify(payload));
}
