import {
  FormEvent,
  lazy,
  ReactNode,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { Helmet } from 'react-helmet-async';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import {
  Alert,
  Autocomplete,
  Box,
  Button,
  Card,
  Container,
  Divider,
  Drawer,
  IconButton,
  InputAdornment,
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
import { DataGrid, GridColDef } from '@mui/x-data-grid';
import { DatePicker } from '@mui/x-date-pickers/DatePicker';
import { useTranslation } from 'react-i18next';
import Iconify from 'src/components/iconify';
import Label from 'src/components/label';
import { ConfirmDialog } from 'src/components/custom-dialog';
import PrototypeVariantSwitcher from 'src/components/prototype-variant-switcher';
import { useSettingsContext } from 'src/components/settings';
import { useAuthContext } from 'src/auth/hooks';
import { hasPortalPermission } from 'src/auth/permissions';
import CountryCallingCodeAutocomplete from 'src/components/country-calling-code-autocomplete';
import i18nInstance from 'src/locales/i18n';
import { getLocalizedApiError } from 'src/locales/api-error';
import PortalMessages from 'src/pages/portal-messages';
import PortalSettings from 'src/pages/portal-settings';
import portalEn from 'src/locales/langs/portal.en.json';
import portalCn from 'src/locales/langs/portal.cn.json';
import { browserApiFetch } from 'src/utils/browser-api';
import {
  CRYPTO_NETWORK_OPTIONS,
  USD_ASSET_ICON,
  USDT_ASSET_ICON,
} from 'src/utils/asset-icons';
import { truncateIdentifier } from 'src/utils/identifier';
import { SUPPORTED_CALLING_CODE_VALUES } from 'src/data/supported-country-calling-codes';

i18nInstance.addResourceBundle('en', 'portal', portalEn, true, true);
i18nInstance.addResourceBundle('cn', 'portal', portalCn, true, true);

type PortalTranslationValues = Record<string, string | number | boolean | undefined>;

function portalText(key: string, values?: PortalTranslationValues) {
  return i18nInstance.t(key, {
    ns: 'portal',
    keySeparator: false,
    defaultValue: key,
    ...values,
  });
}

function portalLocale() {
  return i18nInstance.resolvedLanguage === 'cn' || i18nInstance.language === 'cn'
    ? 'zh-CN'
    : 'en-US';
}

const BASE = '/api/browser/v1/portal';
const PartnerHomeVisualizationPrototype = lazy(
  () => import('src/pages/partner-home-visualization-prototype')
);
const PORTAL_API_ERROR_PREFIX = '__portal_api_error__:';
type WithdrawalFeeType = 'fiat_withdrawal' | 'usdt_withdrawal';
type WithdrawalFeeSetting = {
  type: WithdrawalFeeType;
  asset: 'USD' | 'USDT';
  amount: string;
  updated_at?: string;
};
type PortalApiError = Error & { code?: string };
type StableIdempotencyRequests = Map<string, string>;
const DEFAULT_WITHDRAWAL_FEES: WithdrawalFeeSetting[] = [
  { type: 'fiat_withdrawal', asset: 'USD', amount: '30' },
  { type: 'usdt_withdrawal', asset: 'USDT', amount: '5' },
];
const CHAIN_OPTIONS = CRYPTO_NETWORK_OPTIONS;

const ASSET_OPTIONS = [
  {
    value: 'USD',
    label: 'US Dollar',
    icon: USD_ASSET_ICON,
  },
  {
    value: 'USDT',
    label: 'Tether',
    icon: USDT_ASSET_ICON,
  },
] as const;

const VIEWS = [
  'home',
  'customers',
  'applications',
  'balances',
  'fiat-wallet',
  'crypto-wallet',
  'transactions',
  'messages',
  'settings',
];

const VIEW_COPY: Record<string, { title: string; description: string }> = {
  home: {
    title: '首页',
    description: '汇总客户、钱包余额、待处理事项和最近交易。',
  },
  customers: {
    title: '客户总览',
    description: '集中查看客户基本资料、开户进度、VA 账户和可用资金。',
  },
  applications: {
    title: '发起开户',
    description: '提交客户基本资料并跟踪 KYC 与 VA 账户开通进度。',
  },
  balances: {
    title: '客户余额',
    description: '仅显示已完成开户的客户；其他客户请前往客户总览查看。',
  },
  'fiat-wallet': {
    title: '法币钱包',
    description: '查看人工入账、自动兑换和历史记录。',
  },
  'crypto-wallet': {
    title: '数字钱包',
    description: '查看自动兑换产生的 USDT/TRON 余额和历史记录。',
  },
  transactions: {
    title: '交易历史',
    description: '统一查询所有客户的转入、转出和 OTC 交易。',
  },
  messages: {
    title: '消息',
    description: '集中查看交易、开户和接入状态更新。',
  },
  settings: {
    title: '设置',
    description: '调整界面显示和导航偏好。',
  },
};

function portalApiErrorToken(code: string, requestId: string) {
  return `${PORTAL_API_ERROR_PREFIX}${JSON.stringify({ code, requestId })}`;
}

function portalDisplayText(value: string) {
  if (!value.startsWith(PORTAL_API_ERROR_PREFIX)) return portalText(value);
  try {
    const parsed = JSON.parse(value.slice(PORTAL_API_ERROR_PREFIX.length)) as {
      code?: unknown;
      requestId?: unknown;
    };
    const code = typeof parsed.code === 'string' ? parsed.code : '';
    const requestId = typeof parsed.requestId === 'string' ? parsed.requestId : '';
    const localizedMessage = getLocalizedApiError(
      code ? { error: { code } } : undefined,
      portalText('请求失败')
    );
    return requestId
      ? portalText('{{message}}（请求编号：{{requestId}}）', {
          message: localizedMessage,
          requestId,
        })
      : localizedMessage;
  } catch {
    return portalText('请求失败');
  }
}

async function api(path: string, init?: RequestInit) {
  let response: Response;
  try {
    response = await browserApiFetch(`${BASE}${path}`, {
      ...init,
      credentials: 'same-origin',
      headers: { 'content-type': 'application/json', ...init?.headers },
    });
  } catch {
    throw new Error('API 会话不可用，请刷新页面后重新登录');
  }
  let body: any;
  try {
    body = await response.json();
  } catch {
    throw new Error('API 会话不可用，请刷新页面后重新登录');
  }
  if (!response.ok) {
    const requestId =
      response.headers.get('x-request-id') ||
      (typeof body?.error?.details?.request_id === 'string' ? body.error.details.request_id : '');
    const code = typeof body?.error?.code === 'string' ? body.error.code : '';
    const error = new Error(portalApiErrorToken(code, requestId)) as PortalApiError;
    error.code = code;
    throw error;
  }
  return body;
}

function requestErrorMessage(caught: unknown, fallback: string) {
  return caught instanceof Error && caught.message ? caught.message : fallback;
}

export default function PartnerPortalPage() {
  const { t, i18n } = useTranslation('portal');
  const { user } = useAuthContext();
  const portalSettings = useSettingsContext();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const homePrototypeEnabled = searchParams.get('prototype') === 'charts';
  const homePrototypeVariant = ['A', 'B', 'C'].includes(searchParams.get('variant') || '')
    ? searchParams.get('variant') || 'A'
    : 'A';
  const { view = 'customers', customerId, action } = useParams();
  const tab = VIEWS.includes(view) ? view : 'customers';
  let copy = VIEW_COPY[tab];
  if (tab === 'customers' && customerId) {
    copy = {
      title: '客户详情',
      description: '查看单一客户的开户资料、VA 账户、余额和资金记录。',
    };
  }
  if (tab === 'balances' && customerId) {
    copy = {
      title: '余额详情',
      description: '查看客户各资产的账本余额、待处理占用、可用余额和最近资金记录。',
    };
  }
  const translate = useCallback(
    (key: string, values?: PortalTranslationValues) =>
      t(key, { keySeparator: false, defaultValue: key, ...values }),
    [t]
  );
  const [applications, setApplications] = useState<any[]>([]);
  const [applicationsLoading, setApplicationsLoading] = useState(false);
  const [applicationsLoadError, setApplicationsLoadError] = useState('');
  const [customers, setCustomers] = useState<any[]>([]);
  const [balanceCustomers, setBalanceCustomers] = useState<any[]>([]);
  const [balanceCustomerSearch, setBalanceCustomerSearch] = useState('');
  const [balanceCustomerQuery, setBalanceCustomerQuery] = useState('');
  const [balanceCustomerState, setBalanceCustomerState] = useState('all');
  const [balanceCustomerPage, setBalanceCustomerPage] = useState(0);
  const [balanceCustomerPageSize, setBalanceCustomerPageSize] = useState(25);
  const [balanceCustomerTotal, setBalanceCustomerTotal] = useState(0);
  const [balanceSnapshotAt, setBalanceSnapshotAt] = useState('');
  const [balanceExporting, setBalanceExporting] = useState(false);
  const [customer, setCustomer] = useState<any | null>(null);
  const [records, setRecords] = useState<any[]>([]);
  const [balances, setBalances] = useState<any[]>([]);
  const [customersLoading, setCustomersLoading] = useState(false);
  const [customersLoadError, setCustomersLoadError] = useState('');
  const [customerLoading, setCustomerLoading] = useState(false);
  const [customerLoadError, setCustomerLoadError] = useState('');
  const [recordsLoading, setRecordsLoading] = useState(false);
  const [recordsLoadError, setRecordsLoadError] = useState('');
  const [balancesLoading, setBalancesLoading] = useState(false);
  const [balancesLoadError, setBalancesLoadError] = useState('');
  const [withdrawalFees, setWithdrawalFees] =
    useState<WithdrawalFeeSetting[]>(DEFAULT_WITHDRAWAL_FEES);
  const [withdrawalFeesLoading, setWithdrawalFeesLoading] = useState(true);
  const [withdrawalFeesError, setWithdrawalFeesError] = useState('');
  const [message, setMessage] = useState('');
  const [applicationCountryCodeError, setApplicationCountryCodeError] = useState('');
  const [applicationId, setApplicationId] = useState('');
  const [historyApplicationId, setHistoryApplicationId] = useState('');
  const [historyCategory, setHistoryCategory] = useState('all');
  const [historyStatus, setHistoryStatus] = useState('all');
  const [historyPage, setHistoryPage] = useState(0);
  const [historyPageSize, setHistoryPageSize] = useState(25);
  const [historyTotal, setHistoryTotal] = useState(0);
  const [historyStartDate, setHistoryStartDate] = useState<Date | null>(null);
  const [historyEndDate, setHistoryEndDate] = useState<Date | null>(null);
  const [selectedTransaction, setSelectedTransaction] = useState<any | null>(null);
  const [otcConfirmOpen, setOtcConfirmOpen] = useState(false);
  const [otcSubmitting, setOtcSubmitting] = useState(false);
  const [fiatSubmitting, setFiatSubmitting] = useState(false);
  const [cryptoSubmitting, setCryptoSubmitting] = useState(false);
  const [otcErrors, setOtcErrors] = useState<Record<string, string>>({});
  const fiatRequestRef = useRef<StableIdempotencyRequests>(new Map());
  const cryptoRequestRef = useRef<StableIdempotencyRequests>(new Map());
  const otcRequestRef = useRef<StableIdempotencyRequests>(new Map());
  const applicationResubmissionRequestRef = useRef<StableIdempotencyRequests>(new Map());
  const customerRequestRef = useRef(0);
  const applicationsRequestRef = useRef(0);
  const customersRequestRef = useRef(0);
  const balanceRequestRef = useRef(0);
  const recordsRequestRef = useRef(0);
  const [applicationForm, setApplicationForm] = useState({
    partner_customer_id: '',
    phone_country_code: '+65',
    phone_number: '',
    email: '',
    customer_name: '',
  });
  const [resubmittingApplication, setResubmittingApplication] = useState<any | null>(null);
  const [fiatWithdrawal, setFiatWithdrawal] = useState({
    asset: 'USD',
    amount: '',
    beneficiary_name: '',
    beneficiary_address: '',
    bank_name: '',
    bank_account_number: '',
    swift_bic: '',
    bank_address: '',
    note: '',
  });
  const [cryptoWithdrawal, setCryptoWithdrawal] = useState({
    asset: 'USDT',
    amount: '',
    destination: '',
    network: 'TRON',
    note: '',
  });
  const [otc, setOtc] = useState({
    sell_asset: 'USD',
    sell_network: '',
    sell_amount: '',
    buy_asset: 'USDT',
    buy_network: 'TRON',
    buy_amount: '',
    exchange_rate: '',
    note: '',
  });
  const walletApplicationId =
    customerId && (tab === 'fiat-wallet' || tab === 'crypto-wallet') ? customerId : applicationId;
  const transactionApplicationId = customerId || historyApplicationId;
  const walletApplicationIdRef = useRef(walletApplicationId);
  const otcApplicationIdRef = useRef(applicationId);
  const portalTabRef = useRef(tab);
  walletApplicationIdRef.current = walletApplicationId;
  otcApplicationIdRef.current = applicationId;
  portalTabRef.current = tab;

  useEffect(() => {
    setMessage('');
    setApplicationCountryCodeError('');
    setOtcErrors({});
    setOtcConfirmOpen(false);
  }, [i18n.language]);

  const loadApps = useCallback(async () => {
    applicationsRequestRef.current += 1;
    const requestNumber = applicationsRequestRef.current;
    setApplicationsLoading(true);
    setApplicationsLoadError('');
    try {
      const value = await api('/va-applications');
      if (requestNumber === applicationsRequestRef.current) {
        const list = value.data || [];
        setApplications(list);
        const firstActive = list.find((item: any) => item.status === 'active');
        if (firstActive) setApplicationId((current) => current || firstActive.application_id);
      }
    } catch (caught) {
      if (requestNumber === applicationsRequestRef.current) {
        setApplicationsLoadError(
          requestErrorMessage(caught, portalText('开户与账户状态读取失败，请重试'))
        );
      }
    } finally {
      if (requestNumber === applicationsRequestRef.current) {
        setApplicationsLoading(false);
      }
    }
  }, []);

  const loadCustomers = useCallback(async () => {
    customersRequestRef.current += 1;
    const requestNumber = customersRequestRef.current;
    setCustomersLoading(true);
    setCustomersLoadError('');
    try {
      const value = await api('/customers');
      if (requestNumber === customersRequestRef.current) {
        setCustomers(value.data || []);
      }
    } catch (caught) {
      if (requestNumber === customersRequestRef.current) {
        setCustomersLoadError(requestErrorMessage(caught, portalText('客户资料读取失败，请重试')));
      }
    } finally {
      if (requestNumber === customersRequestRef.current) {
        setCustomersLoading(false);
      }
    }
  }, []);

  const loadBalanceCustomers = useCallback(async () => {
    customersRequestRef.current += 1;
    const requestNumber = customersRequestRef.current;
    setCustomersLoading(true);
    setCustomersLoadError('');
    const params = new URLSearchParams({
      page: String(balanceCustomerPage + 1),
      limit: String(balanceCustomerPageSize),
      status: 'active',
      balance_state: balanceCustomerState,
    });
    if (balanceCustomerQuery) params.set('q', balanceCustomerQuery);
    try {
      const value = await api(`/customers?${params.toString()}`);
      if (requestNumber === customersRequestRef.current) {
        setBalanceCustomers(value.data || []);
        setBalanceCustomerTotal(Number(value.meta?.total || 0));
        setBalanceSnapshotAt(value.meta?.snapshot_at || '');
      }
    } catch (caught) {
      if (requestNumber === customersRequestRef.current) {
        setCustomersLoadError(
          requestErrorMessage(caught, portalText('客户余额总览读取失败，请重试'))
        );
      }
    } finally {
      if (requestNumber === customersRequestRef.current) setCustomersLoading(false);
    }
  }, [balanceCustomerPage, balanceCustomerPageSize, balanceCustomerQuery, balanceCustomerState]);

  const exportBalanceCustomers = useCallback(async () => {
    setBalanceExporting(true);
    try {
      const fetchExportPage = (exportPage: number) => {
        const params = new URLSearchParams({
          page: String(exportPage),
          limit: '100',
          status: 'active',
          balance_state: balanceCustomerState,
        });
        if (balanceCustomerQuery) params.set('q', balanceCustomerQuery);
        return api(`/customers?${params.toString()}`);
      };
      const firstPage = await fetchExportPage(1);
      const exportTotal = Number(firstPage.meta?.total || 0);
      const remainingPageNumbers = Array.from(
        { length: Math.max(0, Math.ceil(exportTotal / 100) - 1) },
        (_value, index) => index + 2
      );
      const remainingPages = await Promise.all(remainingPageNumbers.map(fetchExportPage));
      const exported = [firstPage, ...remainingPages].flatMap((value) => value.data || []);
      downloadBalanceCustomers(exported);
    } catch (caught) {
      setCustomersLoadError(requestErrorMessage(caught, portalText('余额导出失败，请重试')));
    } finally {
      setBalanceExporting(false);
    }
  }, [balanceCustomerQuery, balanceCustomerState]);

  const loadWithdrawalFees = useCallback(async () => {
    setWithdrawalFeesLoading(true);
    setWithdrawalFeesError('');
    try {
      const value = await api('/withdrawal-fees');
      const settings: WithdrawalFeeSetting[] = Array.isArray(value.data) ? value.data : [];
      const hasFiat = settings.some((item) => item.type === 'fiat_withdrawal');
      const hasCrypto = settings.some((item) => item.type === 'usdt_withdrawal');
      if (!hasFiat || !hasCrypto) {
        throw new Error('手续费配置不完整，请联系管理员');
      }
      setWithdrawalFees(settings);
    } catch (caught) {
      setWithdrawalFeesError(
        caught instanceof Error ? caught.message : '手续费配置读取失败，请重试'
      );
    } finally {
      setWithdrawalFeesLoading(false);
    }
  }, []);

  const loadCustomer = useCallback(async () => {
    customerRequestRef.current += 1;
    const requestNumber = customerRequestRef.current;
    if (!customerId) {
      setCustomer(null);
      setCustomerLoading(false);
      setCustomerLoadError('');
      return;
    }
    setCustomerLoading(true);
    setCustomerLoadError('');
    try {
      const value = await api(`/customers/${encodeURIComponent(customerId)}`);
      if (requestNumber === customerRequestRef.current) setCustomer(value);
    } catch (caught) {
      if (requestNumber === customerRequestRef.current) {
        setCustomerLoadError(requestErrorMessage(caught, portalText('客户详情读取失败，请重试')));
      }
    } finally {
      if (requestNumber === customerRequestRef.current) {
        setCustomerLoading(false);
      }
    }
  }, [customerId]);

  const loadBalances = useCallback(async () => {
    balanceRequestRef.current += 1;
    const requestNumber = balanceRequestRef.current;
    const targetApplicationId = walletApplicationId;
    const targetTab = tab;
    if (!targetApplicationId) {
      setBalances([]);
      setBalancesLoading(false);
      setBalancesLoadError('');
      return;
    }
    setBalancesLoading(true);
    setBalancesLoadError('');
    try {
      const value = await api(
        `/balances?application_id=${encodeURIComponent(targetApplicationId)}`
      );
      if (
        requestNumber === balanceRequestRef.current &&
        targetApplicationId === walletApplicationIdRef.current &&
        targetTab === portalTabRef.current
      ) {
        setBalances(value.data || []);
      }
    } catch (caught) {
      if (
        requestNumber === balanceRequestRef.current &&
        targetApplicationId === walletApplicationIdRef.current &&
        targetTab === portalTabRef.current
      ) {
        setBalancesLoadError(requestErrorMessage(caught, portalText('钱包余额读取失败，请重试')));
      }
    } finally {
      if (
        requestNumber === balanceRequestRef.current &&
        targetApplicationId === walletApplicationIdRef.current &&
        targetTab === portalTabRef.current
      ) {
        setBalancesLoading(false);
      }
    }
  }, [tab, walletApplicationId]);

  const loadWalletTransactions = useCallback(
    async (wallet: 'fiat' | 'crypto') => {
      recordsRequestRef.current += 1;
      const requestNumber = recordsRequestRef.current;
      const targetApplicationId = walletApplicationId;
      const targetTab = tab;
      if (!targetApplicationId) {
        setRecords([]);
        setRecordsLoading(false);
        setRecordsLoadError('');
        return;
      }
      setRecordsLoading(true);
      setRecordsLoadError('');
      try {
        const params = new URLSearchParams({
          application_id: targetApplicationId,
          category: 'all',
          status: 'all',
          wallet,
        });
        const value = await api(`/transactions?${params.toString()}`);
        if (
          requestNumber === recordsRequestRef.current &&
          targetApplicationId === walletApplicationIdRef.current &&
          targetTab === portalTabRef.current
        ) {
          setRecords(value.data || []);
        }
      } catch (caught) {
        if (
          requestNumber === recordsRequestRef.current &&
          targetApplicationId === walletApplicationIdRef.current &&
          targetTab === portalTabRef.current
        ) {
          setRecordsLoadError(requestErrorMessage(caught, portalText('钱包交易读取失败，请重试')));
        }
      } finally {
        if (
          requestNumber === recordsRequestRef.current &&
          targetApplicationId === walletApplicationIdRef.current &&
          targetTab === portalTabRef.current
        ) {
          setRecordsLoading(false);
        }
      }
    },
    [tab, walletApplicationId]
  );

  const loadOtc = useCallback(async () => {
    recordsRequestRef.current += 1;
    const requestNumber = recordsRequestRef.current;
    const targetApplicationId = applicationId;
    const targetTab = tab;
    setRecordsLoading(true);
    setRecordsLoadError('');
    try {
      const query = targetApplicationId
        ? `?application_id=${encodeURIComponent(targetApplicationId)}`
        : '';
      const value = await api(`/otc-orders${query}`);
      if (
        requestNumber === recordsRequestRef.current &&
        targetApplicationId === otcApplicationIdRef.current &&
        targetTab === portalTabRef.current
      ) {
        setRecords(value.data || []);
      }
    } catch (caught) {
      if (
        requestNumber === recordsRequestRef.current &&
        targetApplicationId === otcApplicationIdRef.current &&
        targetTab === portalTabRef.current
      ) {
        setRecordsLoadError(requestErrorMessage(caught, portalText('OTC 记录读取失败，请重试')));
      }
    } finally {
      if (
        requestNumber === recordsRequestRef.current &&
        targetApplicationId === otcApplicationIdRef.current &&
        targetTab === portalTabRef.current
      ) {
        setRecordsLoading(false);
      }
    }
  }, [applicationId, tab]);

  const loadTransactions = useCallback(async () => {
    recordsRequestRef.current += 1;
    const requestNumber = recordsRequestRef.current;
    const params = new URLSearchParams({
      category: 'all',
      type: historyCategory,
      status: historyStatus,
      page: String(historyPage + 1),
      limit: String(historyPageSize),
    });
    if (transactionApplicationId) {
      params.set('application_id', transactionApplicationId);
    }
    if (historyStartDate) params.set('date_from', dateParam(historyStartDate));
    if (historyEndDate) params.set('date_to', dateParam(historyEndDate));
    setRecordsLoading(true);
    setRecordsLoadError('');
    try {
      const value = await api(`/transactions?${params.toString()}`);
      if (requestNumber === recordsRequestRef.current) {
        setRecords(value.data || []);
        setHistoryTotal(Number(value.meta?.total || 0));
      }
    } catch (caught) {
      if (requestNumber === recordsRequestRef.current) {
        setRecordsLoadError(requestErrorMessage(caught, portalText('交易历史读取失败，请重试')));
      }
    } finally {
      if (requestNumber === recordsRequestRef.current) {
        setRecordsLoading(false);
      }
    }
  }, [
    historyCategory,
    historyEndDate,
    historyPage,
    historyPageSize,
    historyStartDate,
    historyStatus,
    transactionApplicationId,
  ]);

  const loadDashboard = useCallback(async () => {
    recordsRequestRef.current += 1;
    const requestNumber = recordsRequestRef.current;
    setRecordsLoading(true);
    setRecordsLoadError('');
    try {
      const transactionValue = await api('/transactions?category=all&status=all');
      if (requestNumber === recordsRequestRef.current) {
        setRecords(transactionValue.data || []);
      }
    } catch (caught) {
      if (requestNumber === recordsRequestRef.current) {
        setRecordsLoadError(
          requestErrorMessage(caught, portalText('首页交易数据读取失败，请重试'))
        );
      }
    } finally {
      if (requestNumber === recordsRequestRef.current) {
        setRecordsLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setBalanceCustomerPage(0);
      setBalanceCustomerQuery(balanceCustomerSearch.trim());
    }, 300);
    return () => window.clearTimeout(timer);
  }, [balanceCustomerSearch]);

  useEffect(() => {
    if (
      ['applications', 'balances', 'fiat-wallet', 'crypto-wallet', 'transactions', 'otc'].includes(
        tab
      )
    ) {
      loadApps();
    }
  }, [loadApps, tab]);

  useEffect(() => {
    if (tab === 'fiat-wallet' || tab === 'crypto-wallet') {
      loadWithdrawalFees();
    }
  }, [loadWithdrawalFees, tab]);

  useEffect(() => {
    if (tab === 'customers' && customerId) {
      setCustomer(null);
      loadCustomer();
    } else if (tab === 'customers') {
      loadCustomers();
    }
    if (tab === 'home') {
      loadCustomers();
      loadDashboard();
    }
    if ((tab === 'fiat-wallet' || tab === 'crypto-wallet') && !customerId) {
      loadCustomers();
    }
    if (tab === 'balances' && customerId) {
      setCustomer(null);
      loadCustomer();
    } else if (tab === 'balances') {
      loadBalanceCustomers();
    }
    if (tab === 'fiat-wallet' && customerId) {
      setBalances([]);
      setRecords([]);
      loadBalances();
      loadWalletTransactions('fiat');
    }
    if (tab === 'crypto-wallet' && customerId) {
      setBalances([]);
      setRecords([]);
      loadBalances();
      loadWalletTransactions('crypto');
    }
    if (tab === 'transactions') {
      setRecords([]);
      setHistoryTotal(0);
      loadTransactions();
    }
    if (tab === 'otc') {
      setRecords([]);
      setBalances([]);
      loadOtc();
      loadBalances();
    }
  }, [
    customerId,
    loadBalances,
    loadCustomer,
    loadCustomers,
    loadBalanceCustomers,
    loadDashboard,
    loadWalletTransactions,
    loadOtc,
    loadTransactions,
    tab,
  ]);

  useEffect(() => {
    if (tab === 'transactions' && customerId) {
      setHistoryApplicationId(customerId);
      setHistoryPage(0);
    }
    if ((tab === 'fiat-wallet' || tab === 'crypto-wallet') && customerId) {
      setApplicationId(customerId);
      setFiatWithdrawal((value) => ({
        ...value,
        amount: '',
        beneficiary_name: '',
        beneficiary_address: '',
        bank_name: '',
        bank_account_number: '',
        swift_bic: '',
        bank_address: '',
        note: '',
      }));
      setCryptoWithdrawal((value) => ({
        ...value,
        amount: '',
        destination: '',
        note: '',
      }));
    }
  }, [customerId, tab]);

  const activeApplications = useMemo(
    () => applications.filter((item: any) => item.status === 'active'),
    [applications]
  );
  const fiatWithdrawalFee =
    withdrawalFees.find((item) => item.type === 'fiat_withdrawal') || DEFAULT_WITHDRAWAL_FEES[0];
  const cryptoWithdrawalFee =
    withdrawalFees.find((item) => item.type === 'usdt_withdrawal') || DEFAULT_WITHDRAWAL_FEES[1];
  const otcSellBalance = balances.find(
    (balance) =>
      balance.asset === otc.sell_asset &&
      (otc.sell_asset !== 'USDT' || balance.network === otc.sell_network)
  );

  const submitApplication = async (event: FormEvent) => {
    event.preventDefault();
    if (
      !resubmittingApplication &&
      !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(
        applicationForm.partner_customer_id
      )
    ) {
      setMessage(translate('客户方客户 ID 必须是小写 UUID v4 字符串'));
      return;
    }
    if (!SUPPORTED_CALLING_CODE_VALUES.includes(applicationForm.phone_country_code)) {
      setApplicationCountryCodeError('请选择支持列表中的有效国家区号');
      return;
    }
    const resubmissionPayload = resubmittingApplication
      ? {
          phone_country_code: applicationForm.phone_country_code,
          phone_number: applicationForm.phone_number,
          email: applicationForm.email,
          customer_name: applicationForm.customer_name,
          expected_version: resubmittingApplication.application_version,
        }
      : null;
    try {
      if (resubmittingApplication && resubmissionPayload) {
        const idempotencyKey = stableIdempotencyKey(
          applicationResubmissionRequestRef,
          resubmissionPayload
        );
        await api(`/va-applications/${resubmittingApplication.application_id}/resubmit`, {
          method: 'POST',
          headers: { 'Idempotency-Key': idempotencyKey },
          body: JSON.stringify(resubmissionPayload),
        });
        clearStableIdempotencyKey(applicationResubmissionRequestRef, resubmissionPayload);
      } else {
        await api('/va-applications', {
          method: 'POST',
          body: JSON.stringify(applicationForm),
        });
      }
    } catch (caught) {
      setMessage(caught instanceof Error ? caught.message : portalText('提交失败'));
      return;
    }
    setApplicationForm((value) => ({
      ...value,
      partner_customer_id: '',
      phone_number: '',
      email: '',
      customer_name: '',
    }));
    setMessage(resubmittingApplication ? '开户资料已重新提交，等待运营重新审核' : '开户申请已提交');
    setResubmittingApplication(null);
    setApplicationCountryCodeError('');
    try {
      await Promise.all([loadApps(), loadCustomers()]);
    } catch {
      setMessage('开户申请已提交，但列表刷新失败，请使用刷新按钮重新读取');
    }
  };

  const submitFiatWithdrawal = async () => {
    if (fiatSubmitting) return;
    const submittedApplicationId = walletApplicationId;
    const submittedTab = tab;
    const payload = {
      application_id: submittedApplicationId,
      type: 'fiat_withdrawal',
      expected_fee_amount: fiatWithdrawalFee.amount,
      ...fiatWithdrawal,
    };
    const idempotencyKey = stableIdempotencyKey(fiatRequestRef, payload);
    setFiatSubmitting(true);
    try {
      await api('/fund-transactions', {
        method: 'POST',
        headers: { 'Idempotency-Key': idempotencyKey },
        body: JSON.stringify(payload),
      });
      clearStableIdempotencyKey(fiatRequestRef, payload);
      if (
        submittedApplicationId === walletApplicationIdRef.current &&
        submittedTab === portalTabRef.current
      ) {
        setFiatWithdrawal((value) => ({
          ...value,
          amount: '',
          beneficiary_name: '',
          beneficiary_address: '',
          bank_account_number: '',
          note: '',
        }));
        setMessage('法币转出已提交，对应金额已占用，等待管理员处理');
        await Promise.all([loadWalletTransactions('fiat'), loadBalances()]);
      } else {
        setMessage(
          portalText('客户 {{applicationId}} 的法币转出已提交；当前客户页面保持不变。', {
            applicationId: submittedApplicationId,
          })
        );
      }
    } catch (caught) {
      if ((caught as PortalApiError)?.code === 'withdrawal_fee_changed') {
        await loadWithdrawalFees();
        setMessage('手续费已更新，请核对新的实际到账金额后重新确认');
      } else {
        setMessage(caught instanceof Error ? caught.message : portalText('提交失败'));
      }
    } finally {
      setFiatSubmitting(false);
    }
  };

  const submitCryptoWithdrawal = async () => {
    if (cryptoSubmitting) return;
    const submittedApplicationId = walletApplicationId;
    const submittedTab = tab;
    const payload = {
      application_id: submittedApplicationId,
      type: 'usdt_withdrawal',
      expected_fee_amount: cryptoWithdrawalFee.amount,
      ...cryptoWithdrawal,
    };
    const idempotencyKey = stableIdempotencyKey(cryptoRequestRef, payload);
    setCryptoSubmitting(true);
    try {
      await api('/fund-transactions', {
        method: 'POST',
        headers: { 'Idempotency-Key': idempotencyKey },
        body: JSON.stringify(payload),
      });
      clearStableIdempotencyKey(cryptoRequestRef, payload);
      if (
        submittedApplicationId === walletApplicationIdRef.current &&
        submittedTab === portalTabRef.current
      ) {
        setCryptoWithdrawal((value) => ({ ...value, amount: '', destination: '', note: '' }));
        setMessage('数字货币转出已提交，对应金额已占用，等待管理员处理');
        await Promise.all([loadWalletTransactions('crypto'), loadBalances()]);
      } else {
        setMessage(
          portalText('客户 {{applicationId}} 的数字货币转出已提交；当前客户页面保持不变。', {
            applicationId: submittedApplicationId,
          })
        );
      }
    } catch (caught) {
      if ((caught as PortalApiError)?.code === 'withdrawal_fee_changed') {
        await loadWithdrawalFees();
        setMessage('手续费已更新，请核对新的实际到账金额后重新确认');
      } else {
        setMessage(caught instanceof Error ? caught.message : portalText('提交失败'));
      }
    } finally {
      setCryptoSubmitting(false);
    }
  };

  const reviewOtc = (event: FormEvent) => {
    event.preventDefault();
    if (balancesLoading || balancesLoadError) {
      setMessage('余额尚未成功读取，暂不能发起 OTC');
      return;
    }
    const errors = validateOtcForm(otc, Number(otcSellBalance?.available_balance || 0));
    setOtcErrors(errors);
    if (!Object.keys(errors).length) setOtcConfirmOpen(true);
  };

  const submitOtc = async () => {
    if (balancesLoading || balancesLoadError) {
      setOtcConfirmOpen(false);
      setMessage('余额尚未成功读取，暂不能提交 OTC');
      return;
    }
    const errors = validateOtcForm(otc, Number(otcSellBalance?.available_balance || 0));
    if (Object.keys(errors).length) {
      setOtcErrors(errors);
      setOtcConfirmOpen(false);
      setMessage('OTC 报价或余额已变化，请检查表单后重新确认');
      return;
    }
    setOtcSubmitting(true);
    const submittedApplicationId = applicationId;
    const submittedTab = tab;
    const payload = { application_id: submittedApplicationId, ...otc };
    const idempotencyKey = stableIdempotencyKey(otcRequestRef, payload);
    try {
      await api('/otc-orders', {
        method: 'POST',
        headers: { 'Idempotency-Key': idempotencyKey },
        body: JSON.stringify(payload),
      });
      clearStableIdempotencyKey(otcRequestRef, payload);
      if (
        submittedApplicationId === otcApplicationIdRef.current &&
        submittedTab === portalTabRef.current
      ) {
        setOtc((value) => ({
          ...value,
          sell_amount: '',
          buy_amount: '',
          exchange_rate: '',
          note: '',
        }));
        setOtcErrors({});
        setOtcConfirmOpen(false);
        setMessage('OTC 已完成：卖出金额已扣除，0.5% 手续费已计算，净买入金额已记账');
        await Promise.all([loadOtc(), loadBalances()]);
      } else {
        setOtcConfirmOpen(false);
        setMessage(
          portalText('客户 {{applicationId}} 的 OTC 已自动完成；当前客户页面保持不变。', {
            applicationId: submittedApplicationId,
          })
        );
      }
    } catch (caught) {
      setMessage(caught instanceof Error ? caught.message : portalText('提交失败'));
    } finally {
      setOtcSubmitting(false);
    }
  };

  return (
    <>
      <Helmet>
        <title>
          {translate(copy.title)} | {translate('合作方 Portal')} | SCC Digital Bank
        </title>
      </Helmet>
      <Container maxWidth={portalSettings.themeStretch ? false : 'xl'} sx={{ minWidth: 0 }}>
        <Stack
          direction={{ xs: 'column', sm: 'row' }}
          alignItems={{ sm: 'center' }}
          justifyContent="space-between"
          spacing={2}
          sx={{ mb: 3 }}
        >
          <Box sx={{ minWidth: 0 }}>
            <Typography
              variant="h4"
              sx={{ typography: { xs: 'h5', sm: 'h4' }, overflowWrap: 'anywhere' }}
            >
              {translate(copy.title)}
            </Typography>
            <Typography
              variant="body2"
              color="text.secondary"
              sx={{ mt: 0.5, overflowWrap: 'anywhere' }}
            >
              {translate(copy.description)}
            </Typography>
          </Box>
          {tab === 'customers' && !customerId && hasPortalPermission(user, 'customers.create') && (
            <Button
              variant="contained"
              onClick={() => navigate('/portal/applications')}
              sx={{ width: { xs: 1, sm: 'auto' }, minHeight: 44 }}
            >
              {translate('发起开户')}
            </Button>
          )}
        </Stack>

        {message && (
          <Card sx={{ p: 2, mb: 2, bgcolor: 'info.lighter', overflowWrap: 'anywhere' }}>
            {portalDisplayText(message)}
          </Card>
        )}

        {['applications', 'fiat-wallet', 'crypto-wallet', 'transactions', 'otc'].includes(tab) && (
          <DataLoadAlert
            loading={applicationsLoading && !applications.length}
            error={applicationsLoadError}
            loadingMessage={translate('正在读取开户与账户状态…')}
            onRetry={loadApps}
          />
        )}

        {(tab === 'home' ||
          (tab === 'customers' && !customerId) ||
          (tab === 'balances' && !customerId) ||
          ((tab === 'fiat-wallet' || tab === 'crypto-wallet') && !customerId)) && (
          <DataLoadAlert
            loading={
              customersLoading && !(tab === 'balances' ? balanceCustomers.length : customers.length)
            }
            error={customersLoadError}
            loadingMessage={translate('正在读取客户资料…')}
            onRetry={tab === 'balances' ? loadBalanceCustomers : loadCustomers}
          />
        )}

        {(tab === 'otc' ||
          ((tab === 'fiat-wallet' || tab === 'crypto-wallet') && Boolean(customerId))) && (
          <DataLoadAlert
            loading={balancesLoading && !balances.length}
            error={balancesLoadError}
            loadingMessage={translate('正在读取账本余额…')}
            onRetry={loadBalances}
          />
        )}

        {(tab === 'home' ||
          tab === 'transactions' ||
          tab === 'otc' ||
          ((tab === 'fiat-wallet' || tab === 'crypto-wallet') && Boolean(customerId))) && (
          <DataLoadAlert
            loading={recordsLoading && !records.length}
            error={recordsLoadError}
            loadingMessage={translate('正在读取交易数据…')}
            onRetry={() => {
              if (tab === 'home') return loadDashboard();
              if (tab === 'transactions') return loadTransactions();
              if (tab === 'otc') return loadOtc();
              return loadWalletTransactions(tab === 'fiat-wallet' ? 'fiat' : 'crypto');
            }}
          />
        )}

        {tab === 'home' &&
          (homePrototypeEnabled ? (
            <Suspense
              fallback={
                <Typography color="text.secondary" sx={{ py: 8, textAlign: 'center' }}>
                  {translate('正在读取交易数据…')}
                </Typography>
              }
            >
              <PartnerHomeVisualizationPrototype
                customers={customers}
                transactions={records}
                variant={homePrototypeVariant}
                onNavigate={navigate}
              />
            </Suspense>
          ) : (
            <PortalDashboard
              customers={customers}
              transactions={records}
              canCreateCustomers={hasPortalPermission(user, 'customers.create')}
              onOpenCustomer={(id) => navigate(`/portal/customers/${id}`)}
              onNavigate={navigate}
            />
          ))}

        {tab === 'home' && homePrototypeEnabled && (
          <PrototypeVariantSwitcher
            variants={[
              { key: 'A', label: '资产全景' },
              { key: 'B', label: '客户旅程' },
              { key: 'C', label: '资金流向' },
            ]}
            current={homePrototypeVariant}
            onChange={(variant) => {
              const next = new URLSearchParams(searchParams);
              next.set('prototype', 'charts');
              next.set('variant', variant);
              setSearchParams(next, { replace: true });
            }}
          />
        )}

        {tab === 'messages' && <PortalMessages selectedId={customerId} />}

        {tab === 'settings' && <PortalSettings />}

        {tab === 'customers' &&
          (customerId ? (
            <CustomerDetails
              value={customer}
              loading={customerLoading}
              error={customerLoadError}
              onRetry={loadCustomer}
              onBack={() => navigate('/portal/customers')}
              onOpenFiatWallet={(id) => navigate(`/portal/fiat-wallet/${id}`)}
              onOpenCryptoWallet={(id) => navigate(`/portal/crypto-wallet/${id}`)}
              onHistory={(id) => navigate(`/portal/transactions/${id}`)}
            />
          ) : (
            (!customersLoadError || customers.length > 0) && (
              <CustomerOverviewTable
                rows={customers}
                onOpen={(id) => navigate(`/portal/customers/${id}`)}
              />
            )
          ))}

        {tab === 'applications' && (
          <Card sx={{ p: { xs: 2, sm: 3 } }}>
            <Box
              id="application-form"
              component="form"
              onSubmit={submitApplication}
              sx={{
                mb: 3,
                display: 'grid',
                gridTemplateColumns: {
                  xs: '1fr',
                  sm: 'repeat(2, minmax(0, 1fr))',
                  xl: 'minmax(260px, 1.2fr) repeat(3, minmax(0, 1fr)) auto',
                },
                gap: 2,
                alignItems: 'start',
              }}
            >
              {resubmittingApplication && (
                <Alert
                  severity="error"
                  sx={{ gridColumn: '1 / -1' }}
                  action={
                    <Button
                      color="inherit"
                      size="small"
                      onClick={() => {
                        setResubmittingApplication(null);
                        setApplicationForm({
                          partner_customer_id: '',
                          phone_country_code: '+65',
                          phone_number: '',
                          email: '',
                          customer_name: '',
                        });
                      }}
                    >
                      {translate('取消补正')}
                    </Button>
                  }
                >
                  <Typography variant="subtitle2">{translate('修改资料并重新提交')}</Typography>
                  <Typography variant="body2">
                    {resubmittingApplication.action_required?.reason_message}
                  </Typography>
                  {resubmittingApplication.kyc_url &&
                    resubmittingApplication.action_required?.required_fields?.includes(
                      'kyc_documents'
                    ) && (
                      <Button
                        size="small"
                        variant="outlined"
                        href={resubmittingApplication.kyc_url}
                        target="_blank"
                        rel="noreferrer"
                        sx={{ mt: 1 }}
                      >
                        {translate('打开 KYC 补正链接')}
                      </Button>
                    )}
                </Alert>
              )}
              <TextField
                required
                fullWidth
                label={translate('客户方客户 ID')}
                placeholder="eb9c7fa8-eb8c-45f8-a838-e82033a5b1f4"
                value={applicationForm.partner_customer_id}
                disabled={Boolean(resubmittingApplication)}
                inputProps={{ maxLength: 36, autoCapitalize: 'none', spellCheck: false }}
                helperText={translate('标准小写 UUID v4，按字符串保存')}
                onChange={(event) =>
                  setApplicationForm({
                    ...applicationForm,
                    partner_customer_id: event.target.value
                      .toLowerCase()
                      .replace(/[^0-9a-f-]/g, '')
                      .slice(0, 36),
                  })
                }
              />
              <CountryCallingCodeAutocomplete
                required
                value={applicationForm.phone_country_code}
                initialIso2="SG"
                label={translate('支持的国家/地区（国家区号）')}
                noOptionsText={translate('没有匹配的国家或地区')}
                error={Boolean(applicationCountryCodeError)}
                helperText={
                  applicationCountryCodeError
                    ? translate(applicationCountryCodeError)
                    : translate('提交前仍需完成制裁名单和客户筛查')
                }
                onChange={(callingCode) => {
                  setApplicationCountryCodeError('');
                  setApplicationForm((current) => ({
                    ...current,
                    phone_country_code: callingCode,
                  }));
                }}
                sx={{ minWidth: 0 }}
              />
              <TextField
                required
                fullWidth
                label={translate('电话号码')}
                value={applicationForm.phone_number}
                onChange={(event) =>
                  setApplicationForm({ ...applicationForm, phone_number: event.target.value })
                }
              />
              <TextField
                required
                fullWidth
                label={translate('电子邮箱')}
                value={applicationForm.email}
                onChange={(event) =>
                  setApplicationForm({ ...applicationForm, email: event.target.value })
                }
              />
              <TextField
                required
                fullWidth
                label={translate('客户名称')}
                value={applicationForm.customer_name}
                onChange={(event) =>
                  setApplicationForm({ ...applicationForm, customer_name: event.target.value })
                }
              />
              <Button
                type="submit"
                variant="soft"
                color="primary"
                sx={{
                  alignSelf: 'stretch',
                  gridColumn: { xs: '1', sm: '1 / -1', xl: 'auto' },
                  minWidth: { xl: 112 },
                  minHeight: 48,
                  px: 2.5,
                  mt: { xl: 0.5 },
                  whiteSpace: 'nowrap',
                  fontWeight: 600,
                  boxShadow: 'none',
                }}
              >
                {translate(resubmittingApplication ? '重新提交审核' : '提交开户')}
              </Button>
            </Box>
            <Typography variant="h6" sx={{ mb: 2 }}>
              {translate('待完成开户')}
            </Typography>
            <ApplicationTable
              rows={applications.filter((application) => application.status !== 'active')}
              onResubmit={(application) => {
                setResubmittingApplication(application);
                setApplicationForm({
                  partner_customer_id: application.partner_customer_id || '',
                  phone_country_code: application.phone_country_code,
                  phone_number: application.phone_number,
                  email: application.email,
                  customer_name: application.customer_name,
                });
                setMessage('');
                requestAnimationFrame(() => {
                  document.getElementById('application-form')?.scrollIntoView({
                    behavior: 'smooth',
                    block: 'start',
                  });
                });
              }}
            />
          </Card>
        )}

        {tab === 'balances' &&
          (customerId ? (
            <BalanceCustomerDetails
              value={customer}
              loading={customerLoading}
              error={customerLoadError}
              onRetry={loadCustomer}
              onBack={() => navigate('/portal/balances')}
              onFiatWallet={(id: string) => navigate(`/portal/fiat-wallet/${id}`)}
              onCryptoWallet={(id: string) => navigate(`/portal/crypto-wallet/${id}`)}
              onHistory={(id: string) => navigate(`/portal/transactions/${id}`)}
            />
          ) : (
            <BalanceCustomerOverview
              rows={balanceCustomers}
              loading={customersLoading}
              error={customersLoadError}
              search={balanceCustomerSearch}
              balanceState={balanceCustomerState}
              total={balanceCustomerTotal}
              page={balanceCustomerPage}
              pageSize={balanceCustomerPageSize}
              snapshotAt={balanceSnapshotAt}
              exporting={balanceExporting}
              onSearch={setBalanceCustomerSearch}
              onBalanceState={(next: string) => {
                setBalanceCustomerPage(0);
                setBalanceCustomerState(next);
              }}
              onPage={setBalanceCustomerPage}
              onPageSize={(next: number) => {
                setBalanceCustomerPage(0);
                setBalanceCustomerPageSize(next);
              }}
              onRefresh={loadBalanceCustomers}
              onExport={exportBalanceCustomers}
              onOpen={(id: string) => navigate(`/portal/balances/${id}`)}
            />
          ))}

        {tab === 'fiat-wallet' &&
          (customerId ? (
            <WalletWorkspace
              kind="fiat"
              applications={applications}
              applicationId={walletApplicationId}
              balances={balances}
              balancesReady={!balancesLoading && !balancesLoadError}
              records={records}
              form={fiatWithdrawal}
              feeSetting={fiatWithdrawalFee}
              feeReady={!withdrawalFeesLoading && !withdrawalFeesError}
              feeLoading={withdrawalFeesLoading}
              feeError={withdrawalFeesError}
              onRetryFee={loadWithdrawalFees}
              onFormChange={setFiatWithdrawal}
              onSubmit={submitFiatWithdrawal}
              submitting={fiatSubmitting}
              showWithdrawal={false}
              onBack={() =>
                navigate(
                  action === 'withdraw'
                    ? `/portal/fiat-wallet/${walletApplicationId}`
                    : '/portal/fiat-wallet'
                )
              }
              onStartWithdrawal={() =>
                navigate(`/portal/fiat-wallet/${walletApplicationId}/withdraw`)
              }
              onViewAll={() => navigate(`/portal/transactions/${walletApplicationId}`)}
            />
          ) : (
            <WalletCustomerList
              kind="fiat"
              rows={customers}
              onOpen={(id) => navigate(`/portal/fiat-wallet/${id}`)}
              onViewCustomers={() => navigate('/portal/customers')}
            />
          ))}

        {tab === 'crypto-wallet' &&
          (customerId ? (
            <WalletWorkspace
              kind="crypto"
              applications={applications}
              applicationId={walletApplicationId}
              balances={balances}
              balancesReady={!balancesLoading && !balancesLoadError}
              records={records}
              form={cryptoWithdrawal}
              feeSetting={cryptoWithdrawalFee}
              feeReady={!withdrawalFeesLoading && !withdrawalFeesError}
              feeLoading={withdrawalFeesLoading}
              feeError={withdrawalFeesError}
              onRetryFee={loadWithdrawalFees}
              onFormChange={setCryptoWithdrawal}
              onSubmit={submitCryptoWithdrawal}
              submitting={cryptoSubmitting}
              showWithdrawal={false}
              onBack={() =>
                navigate(
                  action === 'withdraw'
                    ? `/portal/crypto-wallet/${walletApplicationId}`
                    : '/portal/crypto-wallet'
                )
              }
              onStartWithdrawal={() =>
                navigate(`/portal/crypto-wallet/${walletApplicationId}/withdraw`)
              }
              onViewAll={() => navigate(`/portal/transactions/${walletApplicationId}`)}
            />
          ) : (
            <WalletCustomerList
              kind="crypto"
              rows={customers}
              onOpen={(id) => navigate(`/portal/crypto-wallet/${id}`)}
              onViewCustomers={() => navigate('/portal/customers')}
            />
          ))}

        {tab === 'transactions' && (
          <Card sx={{ p: { xs: 2, sm: 3 } }}>
            <Box
              sx={{
                mb: 3,
                display: 'grid',
                gridTemplateColumns: {
                  xs: '1fr',
                  sm: 'repeat(2, minmax(0, 1fr))',
                  lg: 'repeat(3, minmax(0, 1fr))',
                  xl: 'minmax(220px, 1.35fr) repeat(4, minmax(150px, 1fr))',
                },
                gap: 2,
              }}
            >
              <TextField
                select
                fullWidth
                label={translate('客户')}
                value={historyApplicationId}
                onChange={(event) => {
                  setHistoryPage(0);
                  setHistoryApplicationId(event.target.value);
                }}
              >
                <MenuItem value="">{translate('全部客户')}</MenuItem>
                {applications.map((item: any) => (
                  <MenuItem key={item.application_id} value={item.application_id}>
                    {item.customer_name}
                  </MenuItem>
                ))}
              </TextField>
              <TextField
                select
                fullWidth
                label={translate('交易类型')}
                value={historyCategory}
                onChange={(event) => {
                  setHistoryPage(0);
                  setHistoryCategory(event.target.value);
                }}
              >
                <MenuItem value="all">{translate('全部交易')}</MenuItem>
                <MenuItem value="fiat_deposit">{translate('法币转入')}</MenuItem>
                <MenuItem value="otc">OTC</MenuItem>
                <MenuItem value="fiat_conversion_debit">{translate('法币扣款')}</MenuItem>
                <MenuItem value="crypto_conversion_credit">{translate('数字货币转入')}</MenuItem>
                <MenuItem value="usdt_sweep">{translate('USDT 汇集转出')}</MenuItem>
                <MenuItem value="usdt_withdrawal">{translate('数字货币转出')}</MenuItem>
              </TextField>
              <TextField
                select
                fullWidth
                label={translate('状态')}
                value={historyStatus}
                onChange={(event) => {
                  setHistoryPage(0);
                  setHistoryStatus(event.target.value);
                }}
              >
                <MenuItem value="all">{translate('全部状态')}</MenuItem>
                <MenuItem value="submitted">{translate('已提交')}</MenuItem>
                <MenuItem value="processing">{translate('处理中')}</MenuItem>
                <MenuItem value="completed">{translate('已完成')}</MenuItem>
                <MenuItem value="rejected">{translate('已拒绝')}</MenuItem>
                <MenuItem value="cancelled">{translate('已取消')}</MenuItem>
              </TextField>
              <DatePicker
                label={translate('开始日期')}
                value={historyStartDate}
                onChange={(value) => {
                  setHistoryPage(0);
                  setHistoryStartDate(value);
                }}
                slotProps={{ textField: { fullWidth: true } }}
              />
              <DatePicker
                label={translate('结束日期')}
                value={historyEndDate}
                onChange={(value) => {
                  setHistoryPage(0);
                  setHistoryEndDate(value);
                }}
                minDate={historyStartDate || undefined}
                slotProps={{ textField: { fullWidth: true } }}
              />
              <Stack
                direction="row"
                spacing={1}
                justifyContent={{ xs: 'stretch', sm: 'flex-end' }}
                sx={{
                  gridColumn: {
                    xs: '1',
                    sm: '1 / -1',
                    xl: '1 / -1',
                  },
                }}
              >
                {(historyStartDate || historyEndDate) && (
                  <Button
                    color="inherit"
                    onClick={() => {
                      setHistoryStartDate(null);
                      setHistoryEndDate(null);
                      setHistoryPage(0);
                    }}
                  >
                    {translate('清除日期')}
                  </Button>
                )}
                <Button variant="outlined" onClick={loadTransactions} sx={{ minWidth: 96 }}>
                  {translate('刷新')}
                </Button>
              </Stack>
            </Box>
            <TransactionHistoryGrid
              rows={records}
              loading={recordsLoading}
              rowCount={historyTotal}
              page={historyPage}
              pageSize={historyPageSize}
              onPaginationChange={(page, pageSize) => {
                setHistoryPage(pageSize === historyPageSize ? page : 0);
                setHistoryPageSize(pageSize);
              }}
              onOpen={setSelectedTransaction}
            />
          </Card>
        )}

        {tab === 'otc' && (
          <Stack direction={{ xs: 'column', lg: 'row' }} spacing={3} alignItems="stretch">
            <Card sx={{ p: 3, flex: '1 1 62%' }}>
              <ApplicationSelect
                values={activeApplications}
                value={applicationId}
                onChange={setApplicationId}
              />
              <Box
                sx={{
                  p: 2,
                  mb: 3,
                  borderRadius: 1.5,
                  display: 'flex',
                  alignItems: 'flex-start',
                  gap: 1.5,
                  bgcolor: 'info.lighter',
                  color: 'info.darker',
                }}
              >
                <Iconify icon="solar:info-circle-bold-duotone" width={24} sx={{ flexShrink: 0 }} />
                <Box>
                  <Typography variant="subtitle2">{translate('OTC 是账本内兑换')}</Typography>
                  <Typography variant="body2" sx={{ mt: 0.25 }}>
                    {translate(
                      'USDT 按网络独立记账。卖出或买入 USDT 时必须选择 TRON、Ethereum、Solana 或 BNB Smart Chain，余额占用与入账只影响所选网络。'
                    )}
                  </Typography>
                </Box>
              </Box>
              <Stack component="form" onSubmit={reviewOtc} spacing={2.5} noValidate>
                <Box
                  sx={{
                    p: 2,
                    borderRadius: 2,
                    border: '1px solid',
                    borderColor: 'divider',
                  }}
                >
                  <Typography variant="overline" color="text.secondary">
                    {translate('兑换方向')}
                  </Typography>
                  <Box
                    sx={{
                      display: 'grid',
                      gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, 1fr)' },
                      gap: 1.5,
                      mt: 1,
                    }}
                  >
                    {[
                      { sell: 'USD', buy: 'USDT', label: 'USD → USDT' },
                      { sell: 'USDT', buy: 'USD', label: 'USDT → USD' },
                    ].map((direction) => {
                      const selected =
                        otc.sell_asset === direction.sell && otc.buy_asset === direction.buy;
                      return (
                        <Button
                          key={direction.label}
                          size="large"
                          variant={selected ? 'contained' : 'outlined'}
                          color={selected ? 'primary' : 'inherit'}
                          onClick={() => {
                            setOtcErrors({});
                            setOtc({
                              ...otc,
                              sell_asset: direction.sell,
                              sell_network:
                                direction.sell === 'USDT' ? otc.sell_network || 'TRON' : '',
                              sell_amount: '',
                              buy_asset: direction.buy,
                              buy_network:
                                direction.buy === 'USDT' ? otc.buy_network || 'TRON' : '',
                              buy_amount: '',
                              exchange_rate: '',
                            });
                          }}
                          startIcon={<AssetValue asset={direction.sell} iconOnly />}
                          endIcon={<AssetValue asset={direction.buy} iconOnly />}
                          sx={{ justifyContent: 'space-between', px: 2 }}
                        >
                          {direction.label}
                        </Button>
                      );
                    })}
                  </Box>
                </Box>

                <Box
                  sx={{
                    p: 2.5,
                    borderRadius: 2,
                    bgcolor: 'background.neutral',
                    border: (theme) => `1px solid ${theme.palette.divider}`,
                  }}
                >
                  <Typography variant="overline" color="text.secondary">
                    {translate('卖出')}
                  </Typography>
                  <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} sx={{ mt: 1 }}>
                    <TextField
                      required
                      fullWidth
                      label={translate('卖出金额')}
                      placeholder="0.00"
                      type="number"
                      value={otc.sell_amount}
                      error={Boolean(otcErrors.sell_amount)}
                      helperText={
                        otcErrors.sell_amount ||
                        translate('最多可卖出 {{amount}} {{asset}}', {
                          amount: formatBalance(Number(otcSellBalance?.available_balance || 0)),
                          asset: otc.sell_asset,
                        })
                      }
                      inputProps={{
                        min: 0,
                        step: otc.sell_asset === 'USD' ? 0.01 : 0.000001,
                      }}
                      onChange={(event) => {
                        const sellAmount = event.target.value;
                        setOtcErrors((current) => ({
                          ...current,
                          sell_amount: '',
                          buy_amount: '',
                        }));
                        setOtc({
                          ...otc,
                          sell_amount: sellAmount,
                          buy_amount: calculateOtcBuyAmount(
                            sellAmount,
                            otc.exchange_rate,
                            otc.buy_asset
                          ),
                        });
                      }}
                    />
                    <Box
                      sx={{
                        minWidth: { sm: 180 },
                        px: 2,
                        py: 1.25,
                        borderRadius: 1.25,
                        border: '1px solid',
                        borderColor: 'divider',
                        bgcolor: 'background.paper',
                      }}
                    >
                      <Typography variant="caption" color="text.secondary">
                        {translate('卖出资产')}
                      </Typography>
                      <Box sx={{ mt: 0.5 }}>
                        <AssetValue asset={otc.sell_asset} />
                      </Box>
                    </Box>
                  </Stack>
                  {otc.sell_asset === 'USDT' && (
                    <TextField
                      select
                      required
                      fullWidth
                      label={translate('卖出网络')}
                      value={otc.sell_network}
                      error={Boolean(otcErrors.sell_network)}
                      helperText={otcErrors.sell_network}
                      onChange={(event) => {
                        setOtcErrors((current) => ({
                          ...current,
                          sell_network: '',
                          sell_amount: '',
                        }));
                        setOtc({ ...otc, sell_network: event.target.value });
                      }}
                      SelectProps={{
                        renderValue: (selected) => <ChainValue network={String(selected)} />,
                      }}
                      sx={{ mt: 2 }}
                    >
                      {CHAIN_OPTIONS.map((chain) => (
                        <MenuItem key={chain.value} value={chain.value}>
                          <ChainValue network={chain.value} />
                        </MenuItem>
                      ))}
                    </TextField>
                  )}
                  <Typography
                    variant="caption"
                    color="text.secondary"
                    sx={{ mt: 1.5, display: 'block' }}
                  >
                    {translate('当前可用 {{amount}} {{asset}}', {
                      amount: formatBalance(Number(otcSellBalance?.available_balance || 0)),
                      asset: otc.sell_asset,
                    })}
                    {otc.sell_asset === 'USDT' ? ` · ${chainDisplayName(otc.sell_network)}` : ''}
                  </Typography>
                </Box>

                <Stack direction="row" alignItems="center" spacing={2}>
                  <Divider sx={{ flexGrow: 1 }} />
                  <IconButton
                    aria-label={translate('交换买卖资产')}
                    onClick={() => {
                      setOtcErrors({});
                      setOtc({
                        ...otc,
                        sell_asset: otc.buy_asset,
                        sell_network: otc.buy_network,
                        buy_asset: otc.sell_asset,
                        buy_network: otc.sell_network,
                        sell_amount: '',
                        buy_amount: '',
                        exchange_rate: '',
                      });
                    }}
                    sx={{ border: (theme) => `1px solid ${theme.palette.divider}` }}
                  >
                    <Iconify icon="solar:transfer-vertical-bold-duotone" />
                  </IconButton>
                  <Divider sx={{ flexGrow: 1 }} />
                </Stack>

                <Card variant="outlined" sx={{ p: 2.5 }}>
                  <Typography variant="overline" color="text.secondary">
                    {translate('报价')}
                  </Typography>
                  <Stack
                    direction={{ xs: 'column', sm: 'row' }}
                    spacing={2}
                    alignItems={{ sm: 'center' }}
                    sx={{ mt: 1 }}
                  >
                    <TextField
                      required
                      fullWidth
                      label={translate('1 {{asset}} 可兑换', { asset: otc.sell_asset })}
                      placeholder="0.00"
                      type="number"
                      value={otc.exchange_rate}
                      error={Boolean(otcErrors.exchange_rate)}
                      helperText={
                        otcErrors.exchange_rate
                          ? translate(otcErrors.exchange_rate)
                          : translate('最多支持 8 位小数')
                      }
                      inputProps={{ min: 0, step: 0.00000001 }}
                      onChange={(event) => {
                        const exchangeRate = event.target.value;
                        setOtcErrors((current) => ({
                          ...current,
                          exchange_rate: '',
                          buy_amount: '',
                        }));
                        setOtc({
                          ...otc,
                          exchange_rate: exchangeRate,
                          buy_amount: calculateOtcBuyAmount(
                            otc.sell_amount,
                            exchangeRate,
                            otc.buy_asset
                          ),
                        });
                      }}
                    />
                    <Typography variant="subtitle2" sx={{ minWidth: 100 }}>
                      {otc.buy_asset}
                    </Typography>
                  </Stack>
                  <Stack
                    direction={{ xs: 'column', sm: 'row' }}
                    justifyContent="space-between"
                    spacing={1}
                    sx={{ mt: 2 }}
                  >
                    <Typography variant="body2" color="text.secondary">
                      {translate('固定手续费 0.5%')}
                    </Typography>
                    <Typography variant="body2" color="text.secondary">
                      {translate('预计手续费 {{amount}} {{asset}}', {
                        amount: otcFeeAmount(otc.buy_amount, otc.buy_asset),
                        asset: otc.buy_asset,
                      })}
                    </Typography>
                  </Stack>
                </Card>

                <Box
                  sx={{
                    p: 2.5,
                    borderRadius: 2,
                    bgcolor: 'primary.lighter',
                    border: (theme) => `1px solid ${theme.palette.primary.light}`,
                  }}
                >
                  <Typography variant="overline" color="text.secondary">
                    {translate('买入')}
                  </Typography>
                  <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} sx={{ mt: 1 }}>
                    <TextField
                      required
                      fullWidth
                      label={translate('买入总额')}
                      placeholder="0.00"
                      type="number"
                      value={otc.buy_amount}
                      error={Boolean(otcErrors.buy_amount)}
                      helperText={
                        otcErrors.buy_amount ||
                        translate('根据卖出金额 × 成交汇率自动计算；手续费按此金额的 0.5% 计算')
                      }
                      inputProps={{
                        min: 0,
                        step: otc.buy_asset === 'USD' ? 0.01 : 0.000001,
                      }}
                      InputProps={{ readOnly: true }}
                    />
                    <Box
                      sx={{
                        minWidth: { sm: 180 },
                        px: 2,
                        py: 1.25,
                        borderRadius: 1.25,
                        border: '1px solid',
                        borderColor: 'primary.light',
                        bgcolor: 'background.paper',
                      }}
                    >
                      <Typography variant="caption" color="text.secondary">
                        {translate('买入资产')}
                      </Typography>
                      <Box sx={{ mt: 0.5 }}>
                        <AssetValue asset={otc.buy_asset} />
                      </Box>
                    </Box>
                  </Stack>
                  {otc.buy_asset === 'USDT' && (
                    <TextField
                      select
                      required
                      fullWidth
                      label={translate('买入网络')}
                      value={otc.buy_network}
                      error={Boolean(otcErrors.buy_network)}
                      helperText={otcErrors.buy_network}
                      onChange={(event) => {
                        setOtcErrors((current) => ({ ...current, buy_network: '' }));
                        setOtc({ ...otc, buy_network: event.target.value });
                      }}
                      SelectProps={{
                        renderValue: (selected) => <ChainValue network={String(selected)} />,
                      }}
                      sx={{ mt: 2 }}
                    >
                      {CHAIN_OPTIONS.map((chain) => (
                        <MenuItem key={chain.value} value={chain.value}>
                          <ChainValue network={chain.value} />
                        </MenuItem>
                      ))}
                    </TextField>
                  )}
                  <Typography variant="body2" sx={{ mt: 2 }}>
                    {translate('预计到账')}{' '}
                    <Typography component="span" variant="subtitle1">
                      {otcNetAmount(otc.buy_amount, otc.buy_asset)} {otc.buy_asset}
                    </Typography>
                  </Typography>
                </Box>

                <Button
                  type="submit"
                  size="large"
                  variant="contained"
                  disabled={
                    !applicationId || balancesLoading || Boolean(balancesLoadError) || otcSubmitting
                  }
                  fullWidth
                >
                  {otcSubmitting ? translate('提交中…') : translate('预览并确认 OTC')}
                </Button>
                <Typography variant="caption" color="text.secondary" textAlign="center">
                  {translate(
                    '确认后系统立即校验余额、汇率和 0.5% 手续费，并按所选 USDT 网络原子写入账本。'
                  )}
                </Typography>
              </Stack>
            </Card>

            <Card sx={{ p: 3, flex: '1 1 38%', minWidth: { lg: 360 } }}>
              <Stack
                direction="row"
                alignItems="center"
                justifyContent="space-between"
                sx={{ mb: 2 }}
              >
                <Box>
                  <Typography variant="h6">{translate('最近交易')}</Typography>
                  <Typography variant="body2" color="text.secondary">
                    {translate('当前客户最近的 OTC 兑换')}
                  </Typography>
                </Box>
                <Button
                  size="small"
                  onClick={() => navigate(`/portal/transactions/${applicationId}`)}
                >
                  {translate('查看全部')}
                </Button>
              </Stack>
              <RecentOtcHistory rows={records.slice(0, 6)} />
            </Card>
          </Stack>
        )}

      </Container>
      <ConfirmDialog
        open={otcConfirmOpen}
        onClose={() => {
          if (!otcSubmitting) setOtcConfirmOpen(false);
        }}
        title={translate('确认并立即完成 OTC？')}
        content={
          <Stack spacing={2.5}>
            <Box
              sx={{
                display: 'grid',
                gridTemplateColumns: { xs: '1fr', sm: '1fr auto 1fr' },
                alignItems: 'center',
                gap: 2,
                p: 2.5,
                borderRadius: 1.5,
                border: '1px solid',
                borderColor: 'divider',
              }}
            >
              <Box>
                <Typography variant="caption" color="text.secondary">
                  {translate('卖出')}
                </Typography>
                <Typography variant="h6" sx={{ mt: 0.5 }}>
                  {formatAmount(otc.sell_amount || '0', otc.sell_asset)} {otc.sell_asset}
                </Typography>
                <Box sx={{ mt: 1 }}>
                  {otc.sell_network ? (
                    <ChainValue network={otc.sell_network} />
                  ) : (
                    <AssetValue asset={otc.sell_asset} compact />
                  )}
                </Box>
              </Box>
              <Iconify
                icon="solar:alt-arrow-right-linear"
                width={22}
                sx={{ color: 'text.disabled', transform: { xs: 'rotate(90deg)', sm: 'none' } }}
              />
              <Box>
                <Typography variant="caption" color="text.secondary">
                  {translate('买入总额')}
                </Typography>
                <Typography variant="h6" sx={{ mt: 0.5 }}>
                  {formatAmount(otc.buy_amount || '0', otc.buy_asset)} {otc.buy_asset}
                </Typography>
                <Box sx={{ mt: 1 }}>
                  {otc.buy_network ? (
                    <ChainValue network={otc.buy_network} />
                  ) : (
                    <AssetValue asset={otc.buy_asset} compact />
                  )}
                </Box>
              </Box>
            </Box>
            <Box
              sx={{
                display: 'grid',
                gridTemplateColumns: { xs: '1fr', sm: 'repeat(3, 1fr)' },
                gap: 2,
              }}
            >
              <Info label={translate('成交汇率')} value={otc.exchange_rate || '-'} />
              <Info
                label={translate('预计手续费')}
                value={`${otcFeeAmount(otc.buy_amount, otc.buy_asset)} ${otc.buy_asset}`}
              />
              <Info
                label={translate('预计净到账')}
                value={`${otcNetAmount(otc.buy_amount, otc.buy_asset)} ${otc.buy_asset}`}
              />
            </Box>
            <Alert severity="warning">
              {translate(
                '确认后将立即扣除卖出金额并记入净买入金额；手续费按买入总额 0.5% 计算。完成后不可撤销。'
              )}
            </Alert>
          </Stack>
        }
        action={
          <Button variant="contained" disabled={otcSubmitting} onClick={submitOtc}>
            {otcSubmitting ? translate('处理中…') : translate('确认并完成')}
          </Button>
        }
      />
      <TransactionDetailDrawer
        value={selectedTransaction}
        onClose={() => setSelectedTransaction(null)}
      />
    </>
  );
}

function DataLoadAlert({
  loading,
  error,
  loadingMessage,
  onRetry,
}: {
  loading: boolean;
  error: string;
  loadingMessage: string;
  onRetry: () => void | Promise<void>;
}) {
  if (!loading && !error) return null;
  return (
    <Alert
      severity={error ? 'error' : 'info'}
      sx={{ mb: 2 }}
      action={
        error ? (
          <Button color="inherit" size="small" onClick={() => onRetry()}>
            {portalText('重新读取')}
          </Button>
        ) : undefined
      }
    >
      {error
        ? portalText('{{error}}。请检查连接后重新读取。', {
            error: portalDisplayText(error),
          })
        : loadingMessage}
    </Alert>
  );
}

function PortalDashboard({
  customers,
  transactions,
  canCreateCustomers,
  onOpenCustomer,
  onNavigate,
}: {
  customers: any[];
  transactions: any[];
  canCreateCustomers: boolean;
  onOpenCustomer: (id: string) => void;
  onNavigate: (path: string) => void;
}) {
  const activeCustomers = customers.filter((item) => item.status === 'active');
  const kycPending = customers.filter((item) =>
    ['kyc_link_ready', 'kyc_approved', 'va_processing'].includes(item.status)
  );
  const automaticConversions = transactions.filter(
    (item) => item.category === 'otc' && item.source_fund_transaction_id
  );
  const balanceTotals = new Map<string, number>();
  customers.forEach((customer) => {
    (customer.balances || []).forEach((balance: any) => {
      const bucket =
        balance.asset === 'USDT' ? `${balance.asset}:${balance.network || 'TRON'}` : balance.asset;
      balanceTotals.set(
        bucket,
        (balanceTotals.get(bucket) || 0) + Number(balance.available_balance || 0)
      );
    });
  });
  const fiatBalances = Array.from(balanceTotals.entries()).filter(
    ([asset]) => !asset.startsWith('USDT:')
  );
  const digitalBalances = CHAIN_OPTIONS.map((chain) => ({
    ...chain,
    amount: balanceTotals.get(`USDT:${chain.value}`) || 0,
  }));

  return (
    <Stack spacing={3}>
      <Box
        sx={{
          display: 'grid',
          gridTemplateColumns: {
            xs: '1fr',
            sm: 'repeat(2, 1fr)',
            lg: 'repeat(4, 1fr)',
          },
          gap: 2.5,
        }}
      >
        <DashboardMetric
          label={portalText('全部客户')}
          value={String(customers.length)}
          helper={portalText('moventra 管理的客户')}
          icon="solar:users-group-rounded-bold-duotone"
          color="primary"
        />
        <DashboardMetric
          label={portalText('已开通 VA')}
          value={String(activeCustomers.length)}
          helper={portalText('{{count}} 个客户正在 KYC / 开户', {
            count: kycPending.length,
          })}
          icon="solar:verified-check-bold-duotone"
          color="success"
        />
        <DashboardMetric
          label={portalText('自动兑换记录')}
          value={String(automaticConversions.length)}
          helper={portalText('法币清算后由系统生成')}
          icon="solar:transfer-horizontal-bold-duotone"
          color="warning"
        />
        <DashboardMetric
          label={portalText('最近交易')}
          value={String(transactions.length)}
          helper={portalText('当前查询范围内')}
          icon="solar:history-bold-duotone"
          color="info"
        />
      </Box>

      <Box
        sx={{
          display: 'grid',
          gridTemplateColumns: { xs: '1fr', md: 'repeat(2, 1fr)' },
          gap: 2.5,
        }}
      >
        <Card sx={{ p: { xs: 2, sm: 3 } }}>
          <Stack direction="row" alignItems="center" justifyContent="space-between">
            <Box>
              <Typography variant="overline" color="text.secondary">
                {portalText('法币可用余额')}
              </Typography>
              <Stack direction="row" spacing={2} useFlexGap flexWrap="wrap" sx={{ mt: 1 }}>
                {fiatBalances.length ? (
                  fiatBalances.map(([asset, amount]) => (
                    <Typography key={asset} variant="h4">
                      {formatDashboardAmount(amount)}{' '}
                      <Typography component="span" variant="body2" color="text.secondary">
                        {asset}
                      </Typography>
                    </Typography>
                  ))
                ) : (
                  <Typography variant="h4">0</Typography>
                )}
              </Stack>
            </Box>
            <Iconify icon={USD_ASSET_ICON} width={48} />
          </Stack>
          <Button sx={{ mt: 2 }} onClick={() => onNavigate('/portal/fiat-wallet')}>
            {portalText('查看法币钱包')}
          </Button>
        </Card>
        <Card sx={{ p: { xs: 2, sm: 3 } }}>
          <Stack direction="row" alignItems="center" justifyContent="space-between">
            <Box>
              <Typography variant="overline" color="text.secondary">
                {portalText('数字资产可用余额')}
              </Typography>
              <Typography variant="h4" sx={{ mt: 1 }}>
                USDT
              </Typography>
            </Box>
            <AssetValue asset="USDT" iconOnly size={48} />
          </Stack>
          <Box
            sx={{
              display: 'grid',
              gridTemplateColumns: { xs: 'repeat(2, 1fr)', sm: 'repeat(4, 1fr)' },
              gap: 1,
              mt: 2,
            }}
          >
            {digitalBalances.map((balance) => (
              <Box
                key={balance.value}
                sx={{ p: 1.25, borderRadius: 1.25, bgcolor: 'background.neutral' }}
              >
                <ChainValue network={balance.value} />
                <Typography variant="subtitle2" sx={{ mt: 1 }}>
                  {formatDashboardAmount(balance.amount)}
                </Typography>
              </Box>
            ))}
          </Box>
          <Button sx={{ mt: 2 }} onClick={() => onNavigate('/portal/crypto-wallet')}>
            {portalText('查看数字钱包')}
          </Button>
        </Card>
      </Box>

      <Stack direction={{ xs: 'column', xl: 'row' }} spacing={3} alignItems="stretch">
        <Card sx={{ flex: '1 1 65%' }}>
          <Stack
            direction={{ xs: 'column', sm: 'row' }}
            alignItems={{ xs: 'stretch', sm: 'center' }}
            justifyContent="space-between"
            spacing={1.5}
            sx={{ p: { xs: 2, sm: 3 } }}
          >
            <Box sx={{ minWidth: 0 }}>
              <Typography variant="h6">{portalText('最近交易')}</Typography>
              <Typography variant="body2" color="text.secondary">
                {portalText('最近的转入、转出和 OTC')}
              </Typography>
            </Box>
            <Button
              onClick={() => onNavigate('/portal/transactions')}
              sx={{ alignSelf: { sm: 'center' }, minHeight: 44 }}
            >
              {portalText('查看全部')}
            </Button>
          </Stack>
          <RecentDashboardTransactions rows={transactions.slice(0, 6)} />
        </Card>

        <Stack spacing={3} sx={{ flex: '1 1 35%', minWidth: { xl: 340 } }}>
          <Card sx={{ p: { xs: 2, sm: 3 } }}>
            <Typography variant="h6" sx={{ mb: 2 }}>
              {portalText('客户状态')}
            </Typography>
            <Stack spacing={2}>
              <StatusSummary
                label={portalText('已开通')}
                value={activeCustomers.length}
                total={customers.length}
                color="success"
              />
              <StatusSummary
                label={portalText('KYC / 开户中')}
                value={kycPending.length}
                total={customers.length}
                color="warning"
              />
              <StatusSummary
                label={portalText('已提交')}
                value={customers.filter((item) => item.status === 'submitted').length}
                total={customers.length}
                color="info"
              />
            </Stack>
          </Card>
          <Card sx={{ p: { xs: 2, sm: 3 } }}>
            <Stack
              direction="row"
              alignItems="center"
              justifyContent="space-between"
              sx={{ mb: 1 }}
            >
              <Typography variant="h6">{portalText('客户快捷查看')}</Typography>
              <Button size="small" onClick={() => onNavigate('/portal/customers')}>
                {portalText('全部客户')}
              </Button>
            </Stack>
            <Stack divider={<Divider flexItem />}>
              {customers.slice(0, 4).map((customer) => (
                <Button
                  key={customer.application_id}
                  color="inherit"
                  onClick={() => onOpenCustomer(customer.application_id)}
                  sx={{ py: 1.5, justifyContent: 'space-between' }}
                >
                  <Typography
                    variant="body2"
                    noWrap
                    title={customer.customer_name}
                    sx={{ minWidth: 0, textAlign: 'left' }}
                  >
                    {customer.customer_name}
                  </Typography>
                  <Box sx={{ ml: 1, flexShrink: 0 }}>
                    <Status value={customer.status} />
                  </Box>
                </Button>
              ))}
            </Stack>
          </Card>
        </Stack>
      </Stack>

      <Card sx={{ p: 2.5 }}>
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} alignItems={{ sm: 'center' }}>
          <Typography variant="subtitle2">{portalText('快捷操作')}</Typography>
          {canCreateCustomers && (
            <Button variant="contained" onClick={() => onNavigate('/portal/applications')}>
              {portalText('发起开户')}
            </Button>
          )}
        </Stack>
      </Card>
    </Stack>
  );
}

function DashboardMetric({
  label,
  value,
  helper,
  icon,
  color,
}: {
  label: string;
  value: string;
  helper: string;
  icon: string;
  color: 'primary' | 'success' | 'warning' | 'info';
}) {
  return (
    <Card sx={{ p: { xs: 2, sm: 3 } }}>
      <Stack direction="row" alignItems="flex-start" justifyContent="space-between">
        <Box sx={{ minWidth: 0 }}>
          <Typography variant="body2" color="text.secondary">
            {label}
          </Typography>
          <Typography variant="h3" sx={{ my: 1, overflowWrap: 'anywhere' }}>
            {value}
          </Typography>
          <Typography variant="caption" color="text.secondary">
            {helper}
          </Typography>
        </Box>
        <Box sx={{ p: 1.5, borderRadius: 2, bgcolor: `${color}.lighter`, color: `${color}.main` }}>
          <Iconify icon={icon} width={28} />
        </Box>
      </Stack>
    </Card>
  );
}

function RecentDashboardTransactions({ rows }: { rows: any[] }) {
  return (
    <>
      <Box sx={{ display: { xs: 'block', lg: 'none' } }}>
        <RecentWalletTransactions rows={rows} showCustomer />
      </Box>
      <TableContainer sx={{ display: { xs: 'none', lg: 'block' }, overflowX: 'auto' }}>
        <Table sx={{ minWidth: 780, '& .MuiTableCell-root': { whiteSpace: 'nowrap' } }}>
          <TableHead>
            <TableRow>
              <TableCell>{portalText('时间')}</TableCell>
              <TableCell>{portalText('客户')}</TableCell>
              <TableCell>{portalText('交易')}</TableCell>
              <TableCell>{portalText('通道')}</TableCell>
              <TableCell>{portalText('金额')}</TableCell>
              <TableCell>{portalText('状态')}</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {rows.map((row) => (
              <TableRow key={row.id}>
                <TableCell>{formatDate(row.created_at)}</TableCell>
                <TableCell>{row.customer_name}</TableCell>
                <TableCell>{transactionTypeLabel(row.type)}</TableCell>
                <TableCell>
                  <TransactionChannel value={row} compact />
                </TableCell>
                <TableCell>
                  <Typography variant="body2" color={transactionAmountColor(row.direction)}>
                    {transactionSign(row.direction)}
                    {formatAmount(row.amount, row.asset)} {row.asset}
                  </Typography>
                  {isWithdrawalTransaction(row) && (
                    <Typography variant="caption" color="text.secondary">
                      {portalText('手续费 {{fee}} {{asset}} · 实际到账 {{amount}} {{asset}}', {
                        fee: formatAmount(withdrawalFeeValue(row), row.asset),
                        amount: formatAmount(withdrawalNetValue(row), row.asset),
                        asset: row.asset,
                      })}
                    </Typography>
                  )}
                </TableCell>
                <TableCell>
                  <Status value={row.status} />
                </TableCell>
              </TableRow>
            ))}
            {!rows.length && (
              <TableRow>
                <TableCell colSpan={6} align="center" sx={{ py: 6, color: 'text.secondary' }}>
                  {portalText('暂无交易')}
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </TableContainer>
    </>
  );
}

function StatusSummary({
  label,
  value,
  total,
  color,
}: {
  label: string;
  value: number;
  total: number;
  color: 'success' | 'warning' | 'info';
}) {
  const percentage = total ? Math.round((value / total) * 100) : 0;
  return (
    <Box>
      <Stack direction="row" justifyContent="space-between" sx={{ mb: 0.75 }}>
        <Typography variant="body2">{label}</Typography>
        <Typography variant="body2" color="text.secondary">
          {value}
        </Typography>
      </Stack>
      <Box sx={{ height: 8, borderRadius: 1, bgcolor: 'background.neutral', overflow: 'hidden' }}>
        <Box sx={{ width: `${percentage}%`, height: 1, bgcolor: `${color}.main` }} />
      </Box>
    </Box>
  );
}

function formatDashboardAmount(value: number) {
  return value.toLocaleString(portalLocale(), { maximumFractionDigits: 6 });
}

function WalletCustomerList({
  kind,
  rows,
  onOpen,
  onViewCustomers,
}: {
  kind: 'fiat' | 'crypto';
  rows: any[];
  onOpen: (id: string) => void;
  onViewCustomers: () => void;
}) {
  const isFiat = kind === 'fiat';
  const [search, setSearch] = useState('');
  const [balanceFilter, setBalanceFilter] = useState('all');
  const normalizedSearch = search.trim().toLocaleLowerCase();
  const activeRows = rows.filter((row) => row.status === 'active');
  const filteredRows = activeRows.filter((row) => {
    const matchesSearch =
      !normalizedSearch ||
      [
        row.customer_name,
        row.application_id,
        row.email,
        row.phone_country_code,
        row.phone_number,
        `${row.phone_country_code || ''} ${row.phone_number || ''}`,
      ].some((value) =>
        String(value || '')
          .toLocaleLowerCase()
          .includes(normalizedSearch)
      );
    const relevantBalances = (row.balances || []).filter((balance: any) =>
      isFiat ? balance.asset !== 'USDT' : balance.asset === 'USDT'
    );
    const hasAvailableBalance = relevantBalances.some(
      (balance: any) => Number(balance.available_balance || 0) > 0
    );
    const matchesBalance =
      balanceFilter === 'all' ||
      (balanceFilter === 'available' ? hasAvailableBalance : !hasAvailableBalance);
    return matchesSearch && matchesBalance;
  });
  const hasActiveFilters = Boolean(normalizedSearch) || balanceFilter !== 'all';

  useEffect(() => {
    setSearch('');
    setBalanceFilter('all');
  }, [kind]);

  const clearFilters = () => {
    setSearch('');
    setBalanceFilter('all');
  };

  return (
    <Stack spacing={3}>
      <WalletFundsSummary kind={kind} rows={filteredRows} />
      <Card>
        {!isFiat && (
          <>
            <Stack
              direction={{ xs: 'column', md: 'row' }}
              alignItems={{ md: 'center' }}
              justifyContent="space-between"
              spacing={2}
              sx={{ p: 3 }}
            >
              <Box>
                <Typography variant="h6">{portalText('客户数字资产钱包')}</Typography>
                <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
                  {portalText('USDT 按 TRON、Ethereum、Solana 与 BNB Smart Chain 独立显示和占用。')}
                </Typography>
              </Box>
              <SupportedChainList compact />
            </Stack>
            <Divider />
          </>
        )}
        <Box sx={{ p: { xs: 2, md: 3 }, pb: { xs: 2, md: 2.5 } }}>
          <Alert severity="info" sx={{ mb: 2.5 }}>
            {portalText('仅显示已完成开户的客户；其他客户请前往客户总览查看。')}
          </Alert>
          <Box
            sx={{
              display: 'grid',
              gridTemplateColumns: {
                xs: '1fr',
                md: 'minmax(280px, 1fr) 190px auto',
              },
              gap: 1.5,
              alignItems: 'center',
            }}
          >
            <TextField
              fullWidth
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder={portalText('搜索客户名称、申请编号、邮箱或电话')}
              InputProps={{
                startAdornment: (
                  <InputAdornment position="start">
                    <Iconify icon="solar:magnifier-linear" width={20} />
                  </InputAdornment>
                ),
              }}
            />
            <TextField
              select
              label={portalText('余额状态')}
              value={balanceFilter}
              onChange={(event) => setBalanceFilter(event.target.value)}
            >
              <MenuItem value="all">{portalText('全部余额')}</MenuItem>
              <MenuItem value="available">{portalText('有可用余额')}</MenuItem>
              <MenuItem value="empty">{portalText('无可用余额')}</MenuItem>
            </TextField>
            <Button
              color="inherit"
              startIcon={<Iconify icon="solar:restart-bold" />}
              disabled={!hasActiveFilters}
              onClick={clearFilters}
              sx={{ minHeight: 44, whiteSpace: 'nowrap', justifySelf: { md: 'end' } }}
            >
              {portalText('清除筛选')}
            </Button>
          </Box>
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1.25 }}>
            {portalText('显示 {{shown}} / {{total}} 个客户', {
              shown: filteredRows.length,
              total: activeRows.length,
            })}
          </Typography>
        </Box>
        <Divider />
        <TableContainer sx={{ display: { xs: 'none', lg: 'block' }, overflowX: 'auto' }}>
          <Table sx={{ minWidth: 980, tableLayout: 'fixed' }}>
            <TableHead>
              <TableRow>
                <TableCell sx={{ width: 220 }}>{portalText('客户')}</TableCell>
                <TableCell sx={{ width: 220 }}>{portalText('联系方式')}</TableCell>
                <TableCell sx={{ width: 130 }}>{portalText('开户状态')}</TableCell>
                <TableCell sx={{ width: 190 }}>
                  {portalText(isFiat ? '法币可用余额' : '数字资产可用总余额')}
                </TableCell>
                <TableCell sx={{ width: 140 }}>{portalText('最近更新')}</TableCell>
                <TableCell align="right" sx={{ width: 120 }}>
                  {portalText('操作')}
                </TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {filteredRows.map((row) => {
                const walletBalances = (row.balances || []).filter((balance: any) =>
                  isFiat ? balance.asset !== 'USDT' : balance.asset === 'USDT'
                );
                const totalAvailableBalance = walletBalances.reduce(
                  (total: number, balance: any) => total + Number(balance.available_balance || 0),
                  0
                );
                let balanceContent: ReactNode;
                if (!walletBalances.length) {
                  balanceContent = (
                    <Typography variant="body2" color="text.secondary">
                      {portalText('暂无余额')}
                    </Typography>
                  );
                } else if (isFiat) {
                  balanceContent = (
                    <Stack spacing={0.75}>
                      {walletBalances.map((balance: any) => (
                        <Label
                          key={`${balance.asset}:${balance.network || ''}`}
                          color="info"
                          sx={{ width: 'fit-content' }}
                        >
                          {formatAmount(balance.available_balance, balance.asset)} {balance.asset}
                        </Label>
                      ))}
                    </Stack>
                  );
                } else {
                  balanceContent = (
                    <Typography variant="subtitle2">
                      {formatAmount(totalAvailableBalance, 'USDT')} USDT
                    </Typography>
                  );
                }
                return (
                  <TableRow hover key={row.application_id}>
                    <TableCell>
                      <Typography variant="subtitle2" noWrap title={row.customer_name}>
                        {row.customer_name}
                      </Typography>
                      <Typography
                        variant="caption"
                        color="text.secondary"
                        noWrap
                        title={row.application_id}
                        sx={{ display: 'block' }}
                      >
                        {row.application_id}
                      </Typography>
                    </TableCell>
                    <TableCell>
                      <Typography variant="body2" noWrap title={row.email}>
                        {row.email}
                      </Typography>
                      <Typography
                        variant="caption"
                        color="text.secondary"
                        noWrap
                        title={`${row.phone_country_code} ${row.phone_number}`}
                        sx={{ display: 'block' }}
                      >
                        {row.phone_country_code} {row.phone_number}
                      </Typography>
                    </TableCell>
                    <TableCell>
                      <Status value={row.status} />
                    </TableCell>
                    <TableCell>{balanceContent}</TableCell>
                    <TableCell>{formatDate(row.updated_at)}</TableCell>
                    <TableCell align="right">
                      <Button size="small" onClick={() => onOpen(row.application_id)}>
                        {portalText('查看钱包')}
                      </Button>
                    </TableCell>
                  </TableRow>
                );
              })}
              {!filteredRows.length && (
                <TableRow>
                  <TableCell colSpan={6} align="center" sx={{ py: 8 }}>
                    <Stack alignItems="center" spacing={1.5}>
                      <Typography color="text.secondary">
                        {portalText(
                          hasActiveFilters ? '没有符合筛选条件的客户' : '暂无已完成开户的客户'
                        )}
                      </Typography>
                      {!hasActiveFilters && (
                        <Button size="small" variant="outlined" onClick={onViewCustomers}>
                          {portalText('前往客户总览')}
                        </Button>
                      )}
                    </Stack>
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </TableContainer>
        <Stack divider={<Divider flexItem />} sx={{ display: { xs: 'flex', lg: 'none' } }}>
          {filteredRows.map((row) => {
            const walletBalances = (row.balances || []).filter((balance: any) =>
              isFiat ? balance.asset !== 'USDT' : balance.asset === 'USDT'
            );
            const totalAvailableBalance = walletBalances.reduce(
              (total: number, balance: any) => total + Number(balance.available_balance || 0),
              0
            );
            let mobileBalanceContent: ReactNode;
            if (!walletBalances.length) {
              mobileBalanceContent = (
                <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
                  {portalText('暂无余额')}
                </Typography>
              );
            } else if (isFiat) {
              mobileBalanceContent = (
                <Stack direction="row" spacing={0.75} useFlexGap flexWrap="wrap" sx={{ mt: 0.75 }}>
                  {walletBalances.map((balance: any) => (
                    <Label key={`${balance.asset}:${balance.network || ''}`} color="info">
                      {formatAmount(balance.available_balance, balance.asset)} {balance.asset}
                    </Label>
                  ))}
                </Stack>
              );
            } else {
              mobileBalanceContent = (
                <Typography variant="subtitle2" sx={{ mt: 0.5 }}>
                  {formatAmount(totalAvailableBalance, 'USDT')} USDT
                </Typography>
              );
            }
            return (
              <Button
                key={row.application_id}
                color="inherit"
                onClick={() => onOpen(row.application_id)}
                sx={{
                  p: { xs: 2, sm: 2.5 },
                  minHeight: 44,
                  display: 'block',
                  textAlign: 'left',
                  borderRadius: 0,
                }}
              >
                <Stack
                  direction="row"
                  alignItems="flex-start"
                  justifyContent="space-between"
                  spacing={2}
                >
                  <Box sx={{ minWidth: 0 }}>
                    <Typography variant="subtitle1" noWrap title={row.customer_name}>
                      {row.customer_name}
                    </Typography>
                    <Typography
                      variant="caption"
                      color="text.secondary"
                      noWrap
                      title={row.application_id}
                      sx={{ display: 'block' }}
                    >
                      {row.application_id}
                    </Typography>
                  </Box>
                  <Box sx={{ flexShrink: 0 }}>
                    <Status value={row.status} />
                  </Box>
                </Stack>

                <Box
                  sx={{
                    mt: 2,
                    display: 'grid',
                    gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, minmax(0, 1fr))' },
                    gap: 2,
                  }}
                >
                  <Box sx={{ minWidth: 0 }}>
                    <Typography variant="caption" color="text.secondary">
                      {portalText('联系方式')}
                    </Typography>
                    <Typography variant="body2" noWrap title={row.email}>
                      {row.email || '-'}
                    </Typography>
                    <Typography variant="caption" color="text.secondary">
                      {row.phone_country_code} {row.phone_number}
                    </Typography>
                  </Box>
                  <Box sx={{ minWidth: 0 }}>
                    <Typography variant="caption" color="text.secondary">
                      {portalText(isFiat ? '法币可用余额' : '数字资产可用总余额')}
                    </Typography>
                    {mobileBalanceContent}
                  </Box>
                </Box>

                <Stack
                  direction="row"
                  justifyContent="space-between"
                  alignItems="center"
                  sx={{ mt: 2 }}
                >
                  <Typography variant="caption" color="text.secondary">
                    {portalText('更新于 {{time}}', { time: formatDate(row.updated_at) })}
                  </Typography>
                  <Iconify icon="solar:alt-arrow-right-linear" width={18} />
                </Stack>
              </Button>
            );
          })}
          {!filteredRows.length && (
            <Stack alignItems="center" spacing={1.5} sx={{ px: 2, py: 7, textAlign: 'center' }}>
              <Typography color="text.secondary">
                {portalText(hasActiveFilters ? '没有符合筛选条件的客户' : '暂无已完成开户的客户')}
              </Typography>
              {!hasActiveFilters && (
                <Button variant="outlined" onClick={onViewCustomers} sx={{ minHeight: 44 }}>
                  {portalText('前往客户总览')}
                </Button>
              )}
            </Stack>
          )}
        </Stack>
      </Card>
    </Stack>
  );
}

function WalletFundsSummary({ kind, rows }: { kind: 'fiat' | 'crypto'; rows: any[] }) {
  const isFiat = kind === 'fiat';
  const walletBalances = rows.flatMap((row) =>
    (row.balances || []).filter((balance: any) =>
      isFiat ? balance.asset !== 'USDT' : balance.asset === 'USDT'
    )
  );
  const assets = Array.from(
    walletBalances.reduce((totals: Map<string, Record<string, number>>, balance: any) => {
      const asset = String(balance.asset || (isFiat ? 'USD' : 'USDT'));
      const current = totals.get(asset) || { ledger: 0, reserved: 0, available: 0 };
      current.ledger += Number(balance.ledger_balance || 0);
      current.reserved += Number(balance.reserved || 0);
      current.available += Number(balance.available_balance || 0);
      totals.set(asset, current);
      return totals;
    }, new Map<string, Record<string, number>>())
  );
  const fundedCustomers = rows.filter((row) =>
    (row.balances || []).some((balance: any) =>
      isFiat ? balance.asset !== 'USDT' : balance.asset === 'USDT'
    )
  ).length;

  const formatTotals = (field: 'ledger' | 'reserved' | 'available') =>
    assets.length
      ? assets.map(([asset, totals]) => `${formatBalance(totals[field])} ${asset}`).join(' · ')
      : `0 ${isFiat ? 'USD' : 'USDT'}`;

  return (
    <Card
      sx={{
        position: 'relative',
        overflow: 'hidden',
        p: { xs: 2.5, md: 3 },
        border: '1px solid',
        borderColor: 'divider',
        boxShadow: 'none',
        '&::after': {
          content: '""',
          position: 'absolute',
          top: 0,
          right: 0,
          width: { xs: 96, md: 180 },
          height: '100%',
          bgcolor: isFiat ? 'info.lighter' : 'success.lighter',
          opacity: 0.45,
          clipPath: 'polygon(55% 0, 100% 0, 100% 100%, 0 100%)',
          pointerEvents: 'none',
        },
      }}
    >
      <Stack spacing={2.5} sx={{ position: 'relative', zIndex: 1 }}>
        <Stack
          direction={{ xs: 'column', sm: 'row' }}
          alignItems={{ sm: 'center' }}
          justifyContent="space-between"
          spacing={1}
        >
          <Box>
            <Typography variant="h6">{portalText('资金汇总')}</Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
              {portalText('汇总当前列表中全部客户的钱包账本，不包含不同资产间的折算。')}
            </Typography>
          </Box>
          <Typography variant="caption" color="text.secondary">
            {portalText('{{funded}} / {{total}} 个客户有{{wallet}}余额', {
              funded: fundedCustomers,
              total: rows.length,
              wallet: portalText(isFiat ? '法币' : '数字资产'),
            })}
          </Typography>
        </Stack>

        <Box
          sx={{
            display: 'grid',
            gridTemplateColumns: { xs: '1fr', sm: 'repeat(3, minmax(0, 1fr))' },
            gap: { xs: 1.5, sm: 0 },
          }}
        >
          {[
            [portalText('账本总余额'), formatTotals('ledger')],
            [portalText('待处理总占用'), formatTotals('reserved')],
            [portalText('可用总余额'), formatTotals('available')],
          ].map(([label, value], index) => (
            <Box
              key={label}
              sx={{
                minWidth: 0,
                px: { sm: 2.5 },
                pl: { sm: index === 0 ? 0 : 2.5 },
                borderLeft: { sm: index === 0 ? 0 : '1px solid' },
                borderColor: 'divider',
              }}
            >
              <Typography variant="caption" color="text.secondary">
                {label}
              </Typography>
              <Typography
                variant="h5"
                sx={{ mt: 0.75, overflowWrap: 'anywhere', letterSpacing: -0.35 }}
              >
                {value}
              </Typography>
            </Box>
          ))}
        </Box>
      </Stack>
    </Card>
  );
}

function WalletWorkspace({
  kind,
  applications,
  applicationId,
  balances,
  balancesReady,
  records,
  form,
  feeSetting,
  feeReady,
  feeLoading,
  feeError,
  onRetryFee,
  onFormChange,
  onSubmit,
  submitting,
  showWithdrawal,
  onBack,
  onStartWithdrawal,
  onViewAll,
}: {
  kind: 'fiat' | 'crypto';
  applications: any[];
  applicationId: string;
  balances: any[];
  balancesReady: boolean;
  records: any[];
  form: any;
  feeSetting: WithdrawalFeeSetting;
  feeReady: boolean;
  feeLoading: boolean;
  feeError: string;
  onRetryFee: () => void | Promise<void>;
  onFormChange: (value: any) => void;
  onSubmit: () => void | Promise<void>;
  submitting: boolean;
  showWithdrawal: boolean;
  onBack: () => void;
  onStartWithdrawal: () => void;
  onViewAll: () => void;
}) {
  const { i18n } = useTranslation('portal');
  const isFiat = kind === 'fiat';
  const selectedApplication = applications.find((item) => item.application_id === applicationId);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const walletBalances = balances.filter((row) =>
    isFiat ? row.asset !== 'USDT' : row.asset === 'USDT'
  );
  const selectedBalance =
    walletBalances.find(
      (row) => row.asset === form.asset && (isFiat || row.network === form.network)
    ) || (isFiat ? walletBalances[0] : undefined);
  const availableBalance = Number(selectedBalance?.available_balance || 0);
  const ledgerBalance = Number(selectedBalance?.ledger_balance || 0);
  const reservedBalance = Number(selectedBalance?.reserved || 0);
  const displayAsset = selectedBalance?.asset || form.asset || (isFiat ? 'USD' : 'USDT');
  const feeAmount = Number(feeSetting.amount || 0);
  const enteredAmount = Number(form.amount || 0);
  const netAmount =
    Number.isFinite(enteredAmount) && enteredAmount > feeAmount ? enteredAmount - feeAmount : 0;
  const canWithdraw = selectedApplication?.status === 'active';

  useEffect(() => {
    setFieldErrors({});
    setConfirmOpen(false);
  }, [i18n.language]);

  const handleReview = (event: FormEvent) => {
    event.preventDefault();
    if (!balancesReady || !feeReady || submitting) return;
    const errors = validateWithdrawalForm(kind, form, availableBalance, displayAsset, feeAmount);
    setFieldErrors(errors);
    if (!Object.keys(errors).length) setConfirmOpen(true);
  };
  const handleConfirm = async () => {
    if (!balancesReady || !feeReady || submitting) return;
    setConfirmOpen(false);
    await onSubmit();
  };
  const setAmountPreset = (ratio: number) => {
    const decimals = isFiat ? 2 : 6;
    const amount =
      availableBalance > 0 ? Number((availableBalance * ratio).toFixed(decimals)).toString() : '';
    setFieldErrors({ ...fieldErrors, amount: '' });
    onFormChange({ ...form, amount });
  };

  if (showWithdrawal && !canWithdraw) {
    return (
      <Card sx={{ maxWidth: 760, mx: 'auto', p: { xs: 2.5, sm: 4 } }}>
        <Stack spacing={3}>
          <Button
            variant="outlined"
            color="inherit"
            startIcon={<Iconify icon="solar:alt-arrow-left-linear" />}
            onClick={onBack}
            sx={{ alignSelf: 'flex-start' }}
          >
            {portalText('返回钱包')}
          </Button>
          <Alert severity={selectedApplication ? 'warning' : 'info'}>
            {selectedApplication
              ? portalText('客户当前状态为“{{status}}”，仅已开户成功的客户可以发起转出。', {
                  status: applicationStatusLabel(selectedApplication.status),
                })
              : portalText('正在读取客户开户状态；确认客户已开户成功前不能发起转出。')}
          </Alert>
        </Stack>
      </Card>
    );
  }

  return (
    <>
      {showWithdrawal ? (
        <Box sx={{ maxWidth: 1280, mx: 'auto' }}>
          <Card
            sx={{
              p: { xs: 2, sm: 2.5 },
              mb: 3,
              border: '1px solid',
              borderColor: 'divider',
              boxShadow: 'none',
            }}
          >
            <Stack
              direction={{ xs: 'column', sm: 'row' }}
              alignItems={{ sm: 'center' }}
              justifyContent="space-between"
              spacing={2}
            >
              <Stack direction="row" alignItems="center" spacing={2}>
                <Button
                  variant="outlined"
                  color="inherit"
                  startIcon={<Iconify icon="solar:alt-arrow-left-linear" />}
                  onClick={onBack}
                >
                  {portalText('返回钱包')}
                </Button>
                <Box
                  sx={{
                    width: 44,
                    height: 44,
                    borderRadius: 1.5,
                    display: { xs: 'none', sm: 'grid' },
                    placeItems: 'center',
                    bgcolor: isFiat ? 'info.lighter' : 'success.lighter',
                    color: isFiat ? 'info.dark' : 'success.dark',
                  }}
                >
                  <Iconify
                    icon={isFiat ? USD_ASSET_ICON : USDT_ASSET_ICON}
                    width={24}
                  />
                </Box>
                <Box>
                  <Typography variant="subtitle1">
                    {selectedApplication?.customer_name || applicationId}
                  </Typography>
                  <Typography variant="caption" color="text.secondary">
                    {applicationId}
                  </Typography>
                </Box>
              </Stack>
              <Label color={isFiat ? 'info' : 'success'}>
                {portalText(isFiat ? '银行转账' : '链上转账')}
              </Label>
            </Stack>
          </Card>

          {!feeReady && (
            <Alert
              severity={feeError ? 'error' : 'info'}
              sx={{ mb: 3 }}
              action={
                feeError ? (
                  <Button
                    color="inherit"
                    size="small"
                    disabled={feeLoading}
                    onClick={() => onRetryFee()}
                  >
                    {portalText(feeLoading ? '读取中…' : '重新读取')}
                  </Button>
                ) : undefined
              }
            >
              {feeError
                ? portalDisplayText(feeError)
                : portalText('正在读取最新手续费配置，读取完成前暂不能提交转出。')}
            </Alert>
          )}

          <Box
            sx={{
              display: 'grid',
              gridTemplateColumns: { xs: '1fr', lg: 'minmax(0, 1fr) 380px' },
              gap: 3,
              alignItems: 'start',
            }}
          >
            <Stack spacing={3}>
              <Box
                sx={{
                  display: 'grid',
                  gridTemplateColumns: { xs: '1fr', md: 'repeat(2, minmax(0, 1fr))' },
                  gap: 3,
                }}
              >
                <Card sx={{ p: 3 }}>
                  <Stack direction="row" alignItems="center" justifyContent="space-between">
                    <Box>
                      <Typography variant="overline" color="text.secondary">
                        {portalText('本次可转出')}
                      </Typography>
                      <Typography variant="h3" sx={{ mt: 0.5, letterSpacing: -0.8 }}>
                        {formatBalance(availableBalance)}
                      </Typography>
                      <Typography variant="subtitle2" color="text.secondary">
                        {displayAsset}
                      </Typography>
                    </Box>
                    <Box
                      sx={{
                        width: 52,
                        height: 52,
                        borderRadius: '50%',
                        display: 'grid',
                        placeItems: 'center',
                        bgcolor: isFiat ? 'info.lighter' : 'success.lighter',
                        color: isFiat ? 'info.dark' : 'success.dark',
                      }}
                    >
                      <Iconify
                        icon={
                          isFiat ? USD_ASSET_ICON : USDT_ASSET_ICON
                        }
                        width={28}
                      />
                    </Box>
                  </Stack>

                  <Divider sx={{ my: 3 }} />

                  <Stack spacing={2}>
                    <Stack direction="row" justifyContent="space-between">
                      <Typography variant="body2" color="text.secondary">
                        {portalText('账本余额')}
                      </Typography>
                      <Typography variant="subtitle2">
                        {formatBalance(ledgerBalance)} {displayAsset}
                      </Typography>
                    </Stack>
                    <Stack direction="row" justifyContent="space-between">
                      <Typography variant="body2" color="text.secondary">
                        {portalText('待处理占用')}
                      </Typography>
                      <Typography variant="subtitle2" color="warning.dark">
                        {formatBalance(reservedBalance)} {displayAsset}
                      </Typography>
                    </Stack>
                  </Stack>

                  {!walletBalances.length && (
                    <Box
                      sx={{
                        mt: 3,
                        p: 2,
                        borderRadius: 1.5,
                        bgcolor: 'warning.lighter',
                        color: 'warning.darker',
                      }}
                    >
                      <Typography variant="body2">
                        {portalText('当前客户暂无可用{{wallet}}余额。', {
                          wallet: portalText(isFiat ? '法币' : '数字资产'),
                        })}
                      </Typography>
                    </Box>
                  )}
                </Card>

                <Card sx={{ p: 3 }}>
                  <Typography variant="subtitle1" sx={{ mb: 2.5 }}>
                    {portalText('提交后如何处理')}
                  </Typography>
                  <TransferStep
                    icon="solar:document-add-bold-duotone"
                    title={portalText('提交申请')}
                    description={portalText('核对金额与收款资料后提交')}
                  />
                  <TransferStep
                    icon="solar:lock-keyhole-bold-duotone"
                    title={portalText('占用余额')}
                    description={portalText('系统立即从可用余额中预留')}
                  />
                  <TransferStep
                    icon="solar:check-circle-bold-duotone"
                    title={portalText('运营处理')}
                    description={portalText('完成后写入正式资金流水')}
                    last
                  />
                </Card>
              </Box>

              <Card sx={{ p: { xs: 2.5, sm: 4 } }}>
                <Stack
                  direction={{ xs: 'column', sm: 'row' }}
                  alignItems={{ sm: 'flex-start' }}
                  justifyContent="space-between"
                  spacing={2}
                  sx={{ mb: 4, minWidth: 0 }}
                >
                  <Box sx={{ minWidth: 0, flex: 1 }}>
                    <Typography variant="h5">
                      {portalText(isFiat ? '填写银行转出资料' : '填写链上转出资料')}
                    </Typography>
                    <Typography variant="body2" color="text.secondary" sx={{ mt: 0.75 }}>
                      {portalText(
                        isFiat
                          ? '请确保收款人名称、账号和 SWIFT/BIC 与银行资料完全一致。'
                          : '请仔细确认网络与钱包地址，链上交易完成后无法撤回。'
                      )}
                    </Typography>
                  </Box>
                  <Label color="warning" sx={{ flexShrink: 0 }}>
                    {portalText('待确认')}
                  </Label>
                </Stack>

                <Stack component="form" spacing={4} onSubmit={handleReview} noValidate>
                  <Box>
                    <Stack
                      direction={{ xs: 'column', sm: 'row' }}
                      alignItems={{ sm: 'center' }}
                      justifyContent="space-between"
                      spacing={1}
                      sx={{ mb: 2 }}
                    >
                      <Box>
                        <Typography variant="subtitle1">{portalText('转出金额')}</Typography>
                        <Typography variant="caption" color="text.secondary">
                          {portalText('最多可转出 {{amount}} {{asset}}', {
                            amount: formatBalance(availableBalance),
                            asset: displayAsset,
                          })}
                        </Typography>
                      </Box>
                      <Stack direction="row" spacing={1}>
                        <Button
                          size="small"
                          color="inherit"
                          variant="outlined"
                          disabled={availableBalance <= feeAmount}
                          onClick={() => setAmountPreset(0.25)}
                        >
                          25%
                        </Button>
                        <Button
                          size="small"
                          color="inherit"
                          variant="outlined"
                          disabled={availableBalance <= feeAmount}
                          onClick={() => setAmountPreset(0.5)}
                        >
                          50%
                        </Button>
                        <Button
                          size="small"
                          variant="outlined"
                          disabled={availableBalance <= feeAmount}
                          onClick={() => setAmountPreset(1)}
                        >
                          {portalText('全部')}
                        </Button>
                      </Stack>
                    </Stack>

                    <Box
                      sx={{
                        display: 'grid',
                        gridTemplateColumns: { xs: '1fr', sm: 'minmax(0, 1fr) 160px' },
                        gap: 2,
                      }}
                    >
                      <TextField
                        required
                        fullWidth
                        label={portalText('转出金额')}
                        placeholder="0.00"
                        value={form.amount}
                        error={Boolean(fieldErrors.amount)}
                        helperText={
                          fieldErrors.amount
                            ? portalText(fieldErrors.amount)
                            : portalText('提交后该金额将进入待处理占用')
                        }
                        onChange={(event) => {
                          setFieldErrors({ ...fieldErrors, amount: '' });
                          onFormChange({ ...form, amount: event.target.value });
                        }}
                        InputProps={{
                          endAdornment: (
                            <InputAdornment position="end">{displayAsset}</InputAdornment>
                          ),
                        }}
                      />
                      {isFiat && walletBalances.length > 1 ? (
                        <TextField
                          select
                          required
                          label={portalText('资产')}
                          value={form.asset}
                          onChange={(event) => {
                            setFieldErrors({ ...fieldErrors, amount: '' });
                            onFormChange({ ...form, asset: event.target.value });
                          }}
                        >
                          {walletBalances.map((balance) => (
                            <MenuItem key={balance.asset} value={balance.asset}>
                              {balance.asset}
                            </MenuItem>
                          ))}
                        </TextField>
                      ) : (
                        <TextField
                          label={portalText('资产')}
                          value={displayAsset}
                          InputProps={{ readOnly: true }}
                        />
                      )}
                    </Box>

                    <Box
                      sx={{
                        mt: 2,
                        display: 'grid',
                        gridTemplateColumns: { xs: '1fr', sm: 'repeat(3, minmax(0, 1fr))' },
                        borderRadius: 1.5,
                        border: '1px solid',
                        borderColor: 'divider',
                        overflow: 'hidden',
                      }}
                    >
                      <WithdrawalAmountMetric
                        label={portalText('转出金额')}
                        value={Number.isFinite(enteredAmount) ? enteredAmount : 0}
                        asset={displayAsset}
                      />
                      <WithdrawalAmountMetric
                        label={portalText('固定手续费')}
                        value={feeReady ? feeAmount : null}
                        asset={feeSetting.asset}
                        bordered
                      />
                      <WithdrawalAmountMetric
                        label={portalText('实际到账')}
                        value={feeReady ? netAmount : null}
                        asset={displayAsset}
                        highlighted
                        bordered
                      />
                    </Box>
                    <Typography
                      variant="caption"
                      color="text.secondary"
                      sx={{ display: 'block', mt: 1 }}
                    >
                      {portalText('转出金额为账户总扣账金额；实际到账 = 转出金额 − 固定手续费。')}
                    </Typography>
                  </Box>

                  <Divider />

                  <Box>
                    <Typography variant="subtitle1">
                      {portalText(isFiat ? '收款银行资料' : '链上收款资料')}
                    </Typography>
                    <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5, mb: 2.5 }}>
                      {portalText(
                        isFiat
                          ? '必填资料用于运营审核与银行汇款。'
                          : '网络必须与收款地址支持的网络保持一致。'
                      )}
                    </Typography>

                    {isFiat ? (
                      <Box
                        sx={{
                          display: 'grid',
                          gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, minmax(0, 1fr))' },
                          gap: 2.5,
                        }}
                      >
                        <TextField
                          required
                          label={portalText('收款人名称')}
                          placeholder={portalText('与银行账户名称一致')}
                          value={form.beneficiary_name}
                          error={Boolean(fieldErrors.beneficiary_name)}
                          helperText={fieldErrors.beneficiary_name}
                          onChange={(event) => {
                            setFieldErrors({ ...fieldErrors, beneficiary_name: '' });
                            onFormChange({ ...form, beneficiary_name: event.target.value });
                          }}
                        />
                        <TextField
                          required
                          label={portalText('银行名称')}
                          placeholder={portalText('填写银行全称')}
                          value={form.bank_name}
                          error={Boolean(fieldErrors.bank_name)}
                          helperText={fieldErrors.bank_name}
                          onChange={(event) => {
                            setFieldErrors({ ...fieldErrors, bank_name: '' });
                            onFormChange({ ...form, bank_name: event.target.value });
                          }}
                        />
                        <TextField
                          required
                          label={portalText('收款人地址')}
                          placeholder={portalText('街道、城市、邮编及国家/地区')}
                          value={form.beneficiary_address}
                          error={Boolean(fieldErrors.beneficiary_address)}
                          helperText={fieldErrors.beneficiary_address}
                          onChange={(event) => {
                            setFieldErrors({ ...fieldErrors, beneficiary_address: '' });
                            onFormChange({ ...form, beneficiary_address: event.target.value });
                          }}
                          sx={{ gridColumn: { sm: '1 / -1' } }}
                        />
                        <TextField
                          required
                          label={portalText('银行账号 / IBAN')}
                          placeholder={portalText('输入完整收款账号')}
                          value={form.bank_account_number}
                          error={Boolean(fieldErrors.bank_account_number)}
                          helperText={fieldErrors.bank_account_number}
                          onChange={(event) => {
                            setFieldErrors({ ...fieldErrors, bank_account_number: '' });
                            onFormChange({ ...form, bank_account_number: event.target.value });
                          }}
                          sx={{ gridColumn: { sm: '1 / -1' } }}
                        />
                        <TextField
                          required
                          label="SWIFT / BIC"
                          placeholder={portalText('8 或 11 位')}
                          value={form.swift_bic}
                          error={Boolean(fieldErrors.swift_bic)}
                          helperText={fieldErrors.swift_bic}
                          onChange={(event) => {
                            setFieldErrors({ ...fieldErrors, swift_bic: '' });
                            onFormChange({ ...form, swift_bic: event.target.value.toUpperCase() });
                          }}
                        />
                        <TextField
                          label={portalText('银行地址（可选）')}
                          placeholder={portalText('城市、国家或完整地址')}
                          value={form.bank_address}
                          onChange={(event) =>
                            onFormChange({ ...form, bank_address: event.target.value })
                          }
                        />
                      </Box>
                    ) : (
                      <Box
                        sx={{
                          display: 'grid',
                          gridTemplateColumns: { xs: '1fr', sm: '210px minmax(0, 1fr)' },
                          gap: 2.5,
                        }}
                      >
                        <TextField
                          select
                          required
                          label={portalText('转账网络')}
                          value={form.network}
                          error={Boolean(fieldErrors.network)}
                          helperText={
                            fieldErrors.network
                              ? portalText(fieldErrors.network)
                              : portalText('请选择收款地址对应网络')
                          }
                          onChange={(event) => {
                            setFieldErrors({ ...fieldErrors, network: '' });
                            onFormChange({ ...form, network: event.target.value });
                          }}
                          SelectProps={{
                            renderValue: (selected) => <ChainValue network={String(selected)} />,
                          }}
                        >
                          {CHAIN_OPTIONS.map((chain) => (
                            <MenuItem key={chain.value} value={chain.value}>
                              <Stack
                                direction="row"
                                alignItems="center"
                                justifyContent="space-between"
                                spacing={3}
                                sx={{ width: '100%' }}
                              >
                                <ChainValue network={chain.value} />
                                <Typography variant="caption" color="text.secondary">
                                  {formatBalance(
                                    Number(
                                      walletBalances.find(
                                        (balance) => balance.network === chain.value
                                      )?.available_balance || 0
                                    )
                                  )}{' '}
                                  USDT
                                </Typography>
                              </Stack>
                            </MenuItem>
                          ))}
                        </TextField>
                        <TextField
                          required
                          label={portalText('收款钱包地址')}
                          placeholder={portalText('输入 {{network}} 钱包地址', {
                            network: chainDisplayName(form.network),
                          })}
                          value={form.destination}
                          error={Boolean(fieldErrors.destination)}
                          helperText={
                            fieldErrors.destination
                              ? portalText(fieldErrors.destination)
                              : portalText('请逐位核对，链上转账无法撤回')
                          }
                          onChange={(event) => {
                            setFieldErrors({ ...fieldErrors, destination: '' });
                            onFormChange({ ...form, destination: event.target.value.trim() });
                          }}
                        />
                      </Box>
                    )}
                  </Box>

                  <Divider />

                  <Box>
                    <Typography variant="subtitle1" sx={{ mb: 2 }}>
                      {portalText('附加信息')}
                    </Typography>
                    <TextField
                      fullWidth
                      multiline
                      minRows={3}
                      label={portalText('备注（可选）')}
                      placeholder={portalText('可填写付款用途或供运营参考的说明')}
                      value={form.note}
                      onChange={(event) => onFormChange({ ...form, note: event.target.value })}
                    />
                  </Box>

                  <Box
                    sx={{
                      p: 2,
                      borderRadius: 1.5,
                      display: 'flex',
                      alignItems: 'flex-start',
                      gap: 1.5,
                      bgcolor: 'background.neutral',
                    }}
                  >
                    <Iconify
                      icon="solar:shield-check-bold-duotone"
                      width={24}
                      sx={{ color: 'primary.main', mt: 0.25, flexShrink: 0 }}
                    />
                    <Typography variant="body2" color="text.secondary">
                      {portalText(
                        '下一步会展示完整转出摘要。确认提交后，系统将立即占用对应可用余额，等待运营方处理。'
                      )}
                    </Typography>
                  </Box>

                  <Stack
                    direction={{ xs: 'column-reverse', sm: 'row' }}
                    justifyContent="flex-end"
                    spacing={1.5}
                  >
                    <Button color="inherit" size="large" onClick={onBack}>
                      {portalText('取消')}
                    </Button>
                    <Button
                      type="submit"
                      size="large"
                      variant="contained"
                      disabled={
                        !applicationId ||
                        availableBalance <= feeAmount ||
                        !balancesReady ||
                        !feeReady ||
                        submitting
                      }
                      endIcon={<Iconify icon="solar:alt-arrow-right-linear" />}
                      sx={{ minWidth: 220 }}
                    >
                      {portalText(submitting ? '提交中…' : '预览并确认转出')}
                    </Button>
                  </Stack>
                </Stack>
              </Card>
            </Stack>

            <Card
              sx={{
                position: { lg: 'sticky' },
                top: { lg: 96 },
                overflow: 'hidden',
              }}
            >
              <Stack
                direction="row"
                alignItems="center"
                justifyContent="space-between"
                sx={{ p: 3 }}
              >
                <Box>
                  <Typography variant="h6">{portalText('最近交易')}</Typography>
                  <Typography variant="body2" color="text.secondary">
                    {portalText('当前客户的{{wallet}}记录', {
                      wallet: portalText(isFiat ? '法币' : '数字资产'),
                    })}
                  </Typography>
                </Box>
                <Button size="small" onClick={onViewAll}>
                  {portalText('查看全部')}
                </Button>
              </Stack>
              <Divider />
              <RecentWalletTransactions rows={records.slice(0, 8)} />
            </Card>
          </Box>
        </Box>
      ) : (
        <Stack spacing={3}>
          <Card sx={{ p: { xs: 2, sm: 3 } }}>
            <Stack
              direction={{ xs: 'column', sm: 'row' }}
              alignItems={{ sm: 'center' }}
              justifyContent="space-between"
              spacing={2}
              sx={{ mb: 3 }}
            >
              <Stack
                direction={{ xs: 'column', sm: 'row' }}
                alignItems={{ xs: 'stretch', sm: 'center' }}
                spacing={1.5}
                sx={{ minWidth: 0 }}
              >
                <Button variant="outlined" onClick={onBack} sx={{ minHeight: 44 }}>
                  {portalText('返回客户列表')}
                </Button>
                <Box sx={{ minWidth: 0 }}>
                  <Typography variant="subtitle1">
                    {selectedApplication?.customer_name || applicationId}
                  </Typography>
                  <Typography
                    variant="caption"
                    color="text.secondary"
                    sx={{ display: 'block', overflowWrap: 'anywhere' }}
                  >
                    {applicationId}
                  </Typography>
                </Box>
              </Stack>
              <Stack direction="row" spacing={1.5} alignItems="center" useFlexGap flexWrap="wrap">
                <Label color={isFiat ? 'info' : 'success'}>
                  {portalText(isFiat ? '银行转账' : '链上转账')}
                </Label>
                <Label color="info">{portalText('只读')}</Label>
              </Stack>
            </Stack>
            <Typography variant="h6" sx={{ mb: 2 }}>
              {portalText(isFiat ? '钱包余额' : '多链 USDT 余额')}
            </Typography>
            {isFiat ? (
              <Box
                sx={{
                  display: 'grid',
                  gridTemplateColumns: { xs: '1fr', sm: 'repeat(3, 1fr)' },
                  gap: 2,
                }}
              >
                <WalletMetric
                  label={portalText('账本余额')}
                  value={walletBalanceTotal(walletBalances, 'ledger_balance')}
                  asset={walletBalances[0]?.asset}
                />
                <WalletMetric
                  label={portalText('待处理占用')}
                  value={walletBalanceTotal(walletBalances, 'reserved')}
                  asset={walletBalances[0]?.asset}
                />
                <WalletMetric
                  label={portalText('可用余额')}
                  value={walletBalanceTotal(walletBalances, 'available_balance')}
                  asset={walletBalances[0]?.asset}
                  highlight
                />
              </Box>
            ) : (
              <Stack spacing={3}>
                <Box
                  sx={{
                    display: 'grid',
                    gridTemplateColumns: { xs: '1fr', sm: 'repeat(3, 1fr)' },
                    gap: 2,
                  }}
                >
                  <WalletMetric
                    label={portalText('全部网络账本余额')}
                    value={walletBalanceTotal(walletBalances, 'ledger_balance')}
                    asset="USDT"
                  />
                  <WalletMetric
                    label={portalText('全部网络待处理占用')}
                    value={walletBalanceTotal(walletBalances, 'reserved')}
                    asset="USDT"
                  />
                  <WalletMetric
                    label={portalText('全部网络可用余额')}
                    value={walletBalanceTotal(walletBalances, 'available_balance')}
                    asset="USDT"
                    highlight
                  />
                </Box>

                <Box>
                  <Typography variant="subtitle1" sx={{ mb: 1.5 }}>
                    {portalText('按网络明细')}
                  </Typography>
                  <Box
                    sx={{
                      display: 'grid',
                      gridTemplateColumns: {
                        xs: '1fr',
                        sm: 'repeat(2, minmax(0, 1fr))',
                        xl: 'repeat(4, minmax(0, 1fr))',
                      },
                      gap: 2,
                    }}
                  >
                    {CHAIN_OPTIONS.map((chain) => (
                      <ChainBalanceCard
                        key={chain.value}
                        chain={chain}
                        balance={walletBalances.find((item) => item.network === chain.value)}
                      />
                    ))}
                  </Box>
                </Box>
              </Stack>
            )}
            {!walletBalances.length && (
              <Typography color="text.secondary" sx={{ mt: 2 }}>
                {portalText('当前客户暂无{{wallet}}账本余额。', {
                  wallet: portalText(isFiat ? '法币' : '数字资产'),
                })}
              </Typography>
            )}
          </Card>

          <Card>
            <Stack
              direction={{ xs: 'column', sm: 'row' }}
              alignItems={{ xs: 'stretch', sm: 'center' }}
              justifyContent="space-between"
              spacing={1}
              sx={{ p: { xs: 2, sm: 3 } }}
            >
              <Box sx={{ minWidth: 0 }}>
                <Typography variant="h6">
                  {portalText('{{wallet}}交易历史', {
                    wallet: portalText(isFiat ? '法币' : '数字资产'),
                  })}
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  {portalText('到账由运营方录入，转出由此钱包发起。')}
                </Typography>
              </Box>
              <Button onClick={onViewAll} sx={{ minHeight: 44 }}>
                {portalText('查看全部')}
              </Button>
            </Stack>
            <WalletHistoryTable rows={records} />
          </Card>
        </Stack>
      )}

      <ConfirmDialog
        open={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        title={portalText('确认提交{{channel}}转出？', {
          channel: portalText(isFiat ? '银行' : '数字货币'),
        })}
        content={
          <Stack spacing={2}>
            <Box
              sx={{
                display: 'grid',
                gridTemplateColumns: { xs: '1fr', sm: 'repeat(3, minmax(0, 1fr))' },
                borderRadius: 1.5,
                border: '1px solid',
                borderColor: 'divider',
                overflow: 'hidden',
              }}
            >
              <WithdrawalAmountMetric
                label={portalText('转出金额')}
                value={Number.isFinite(enteredAmount) ? enteredAmount : 0}
                asset={displayAsset}
                compact
              />
              <WithdrawalAmountMetric
                label={portalText('手续费')}
                value={feeAmount}
                asset={feeSetting.asset}
                bordered
                compact
              />
              <WithdrawalAmountMetric
                label={portalText('实际到账')}
                value={netAmount}
                asset={displayAsset}
                highlighted
                bordered
                compact
              />
            </Box>
            <Box>
              <Typography variant="caption" color="text.secondary">
                {portalText(isFiat ? '收款银行资料' : '链上收款资料')}
              </Typography>
              {isFiat ? (
                <Stack spacing={0.5} sx={{ mt: 0.5 }}>
                  <Typography variant="body2">
                    {form.beneficiary_name || '-'} · {form.bank_name || '-'}
                  </Typography>
                  <Typography variant="body2" color="text.secondary">
                    {form.beneficiary_address || '-'}
                  </Typography>
                  <Typography variant="body2" sx={{ wordBreak: 'break-all' }}>
                    {form.bank_account_number || '-'} · {form.swift_bic || '-'}
                  </Typography>
                </Stack>
              ) : (
                <Typography variant="body2" sx={{ mt: 0.5, wordBreak: 'break-all' }}>
                  {form.network || '-'} · {form.destination || '-'}
                </Typography>
              )}
            </Box>
            <Box sx={{ p: 2, borderRadius: 1.5, bgcolor: 'warning.lighter' }}>
              <Typography variant="body2" color="warning.darker">
                {portalText('确认后将立即占用对应可用余额，等待运营方处理。')}
              </Typography>
            </Box>
          </Stack>
        }
        action={
          <Button
            variant="contained"
            disabled={!balancesReady || !feeReady || submitting}
            onClick={handleConfirm}
          >
            {portalText(submitting ? '提交中…' : '确认提交')}
          </Button>
        }
      />
    </>
  );
}

function WithdrawalAmountMetric({
  label,
  value,
  asset,
  highlighted = false,
  bordered = false,
  compact = false,
}: {
  label: string;
  value: number | null;
  asset: string;
  highlighted?: boolean;
  bordered?: boolean;
  compact?: boolean;
}) {
  return (
    <Box
      sx={{
        p: compact ? 1.5 : 2,
        minWidth: 0,
        bgcolor: highlighted ? 'info.lighter' : 'background.neutral',
        borderLeft: { xs: 0, sm: bordered ? '1px solid' : 0 },
        borderTop: { xs: bordered ? '1px solid' : 0, sm: 0 },
        borderColor: 'divider',
      }}
    >
      <Typography variant="caption" color="text.secondary">
        {label}
      </Typography>
      <Stack direction="row" alignItems="baseline" spacing={0.75} sx={{ mt: 0.5 }}>
        <Typography variant={compact ? 'subtitle1' : 'h6'} sx={{ letterSpacing: -0.2 }}>
          {value === null ? '—' : formatBalance(value)}
        </Typography>
        <Typography variant="caption" color="text.secondary">
          {asset}
        </Typography>
      </Stack>
    </Box>
  );
}

function TransferStep({
  icon,
  title,
  description,
  last = false,
}: {
  icon: string;
  title: string;
  description: string;
  last?: boolean;
}) {
  return (
    <Stack direction="row" spacing={1.5} sx={{ position: 'relative', pb: last ? 0 : 2.5 }}>
      <Box
        sx={{
          width: 34,
          height: 34,
          borderRadius: '50%',
          display: 'grid',
          placeItems: 'center',
          flexShrink: 0,
          bgcolor: 'primary.lighter',
          color: 'primary.main',
          '&::after': last
            ? undefined
            : {
                content: '""',
                position: 'absolute',
                top: 36,
                left: 16,
                width: 2,
                height: 24,
                bgcolor: 'divider',
              },
        }}
      >
        <Iconify icon={icon} width={18} />
      </Box>
      <Box>
        <Typography variant="subtitle2">{title}</Typography>
        <Typography variant="caption" color="text.secondary">
          {description}
        </Typography>
      </Box>
    </Stack>
  );
}

function WalletMetric({
  label,
  value,
  asset,
  highlight = false,
}: {
  label: string;
  value: string;
  asset?: string;
  highlight?: boolean;
}) {
  return (
    <Box
      sx={{
        p: 2.5,
        borderRadius: 2,
        bgcolor: highlight ? 'primary.lighter' : 'background.neutral',
      }}
    >
      <Typography variant="body2" color="text.secondary">
        {label}
      </Typography>
      <Typography variant="h5" sx={{ mt: 1 }}>
        {value}{' '}
        <Typography component="span" variant="body2" color="text.secondary">
          {asset || ''}
        </Typography>
      </Typography>
    </Box>
  );
}

function ChainBalanceCard({
  chain,
  balance,
}: {
  chain: (typeof CHAIN_OPTIONS)[number];
  balance?: any;
}) {
  return (
    <Box
      sx={{
        p: 2.5,
        borderRadius: 2,
        border: '1px solid',
        borderColor: 'divider',
        bgcolor: 'background.paper',
        minWidth: 0,
      }}
    >
      <Stack direction="row" alignItems="center" spacing={1.5}>
        <Box
          sx={{
            width: 42,
            height: 42,
            borderRadius: 1.5,
            display: 'grid',
            placeItems: 'center',
            flexShrink: 0,
            bgcolor: 'background.neutral',
          }}
        >
          <Iconify icon={chain.icon} width={26} />
        </Box>
        <Box sx={{ minWidth: 0 }}>
          <Typography variant="subtitle2" noWrap>
            {chain.label}
          </Typography>
          <Typography variant="caption" color="text.secondary">
            {chain.standard}
          </Typography>
        </Box>
      </Stack>

      <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 2.5 }}>
        {portalText('可用余额')}
      </Typography>
      <Stack direction="row" alignItems="baseline" spacing={0.75} sx={{ mt: 0.5 }}>
        <Typography variant="h5" sx={{ letterSpacing: -0.4 }}>
          {formatBalance(Number(balance?.available_balance || 0))}
        </Typography>
        <Typography variant="caption" color="text.secondary">
          USDT
        </Typography>
      </Stack>

      <Divider sx={{ my: 2 }} />
      <Stack direction="row" justifyContent="space-between" spacing={2}>
        <Box>
          <Typography variant="caption" color="text.secondary">
            {portalText('账本')}
          </Typography>
          <Typography variant="body2" sx={{ mt: 0.25 }}>
            {formatBalance(Number(balance?.ledger_balance || 0))}
          </Typography>
        </Box>
        <Box sx={{ textAlign: 'right' }}>
          <Typography variant="caption" color="text.secondary">
            {portalText('占用')}
          </Typography>
          <Typography
            variant="body2"
            sx={{ mt: 0.25 }}
            color={Number(balance?.reserved || 0) > 0 ? 'warning.dark' : 'text.primary'}
          >
            {formatBalance(Number(balance?.reserved || 0))}
          </Typography>
        </Box>
      </Stack>
    </Box>
  );
}

function WalletHistoryTable({ rows }: { rows: any[] }) {
  return (
    <>
      <Box sx={{ display: { xs: 'block', md: 'none' } }}>
        <RecentWalletTransactions rows={rows.slice(0, 8)} />
      </Box>
      <TableContainer sx={{ display: { xs: 'none', md: 'block' }, overflowX: 'auto' }}>
        <Table sx={{ minWidth: 820 }}>
          <TableHead>
            <TableRow>
              <TableCell>{portalText('时间')}</TableCell>
              <TableCell>{portalText('类型')}</TableCell>
              <TableCell>{portalText('金额')}</TableCell>
              <TableCell>{portalText('收款信息')}</TableCell>
              <TableCell>{portalText('状态')}</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {rows.slice(0, 8).map((row) => (
              <TableRow key={row.id}>
                <TableCell>{formatDate(row.created_at)}</TableCell>
                <TableCell>{transactionTypeLabel(row.type)}</TableCell>
                <TableCell>
                  <Typography variant="body2" color={transactionAmountColor(row.direction)}>
                    {transactionSign(row.direction)}
                    {formatAmount(row.amount, row.asset)} {row.asset}
                  </Typography>
                  {isWithdrawalTransaction(row) && (
                    <Typography variant="caption" color="text.secondary">
                      {portalText('手续费 {{fee}} {{asset}} · 到账 {{amount}} {{asset}}', {
                        fee: formatAmount(withdrawalFeeValue(row), row.asset),
                        amount: formatAmount(withdrawalNetValue(row), row.asset),
                        asset: row.asset,
                      })}
                    </Typography>
                  )}
                </TableCell>
                <TableCell>
                  {row.network ? (
                    <ChainValue network={row.network} />
                  ) : (
                    <Typography variant="body2">{row.beneficiary_name || '-'}</Typography>
                  )}
                  <Typography variant="caption" color="text.secondary">
                    {row.bank_account_number || row.destination || row.reference || ''}
                  </Typography>
                </TableCell>
                <TableCell>
                  <Status value={row.status} />
                </TableCell>
              </TableRow>
            ))}
            {!rows.length && (
              <TableRow>
                <TableCell colSpan={5} align="center" sx={{ py: 7, color: 'text.secondary' }}>
                  {portalText('暂无交易记录')}
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </TableContainer>
    </>
  );
}

function RecentWalletTransactions({
  rows,
  showCustomer = false,
}: {
  rows: any[];
  showCustomer?: boolean;
}) {
  if (!rows.length) {
    return (
      <Box sx={{ px: { xs: 2, sm: 3 }, py: 8, textAlign: 'center' }}>
        <Iconify
          icon="solar:history-bold-duotone"
          width={40}
          sx={{ color: 'text.disabled', mb: 1.5 }}
        />
        <Typography variant="subtitle2">{portalText('暂无最近交易')}</Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
          {portalText('提交或完成交易后将在这里显示')}
        </Typography>
      </Box>
    );
  }

  return (
    <Stack divider={<Divider flexItem />} spacing={0}>
      {rows.map((row) => (
        <Box key={row.id} sx={{ px: { xs: 2, sm: 3 }, py: 2.25 }}>
          <Stack direction="row" alignItems="flex-start" justifyContent="space-between" spacing={2}>
            <Box sx={{ minWidth: 0 }}>
              <Typography variant="subtitle2" noWrap title={transactionTypeLabel(row.type)}>
                {transactionTypeLabel(row.type)}
              </Typography>
              {showCustomer && (
                <Typography variant="body2" color="text.secondary" noWrap title={row.customer_name}>
                  {row.customer_name || portalText('未知客户')}
                </Typography>
              )}
              <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
                {formatDate(row.created_at)}
              </Typography>
            </Box>
            <Box sx={{ flexShrink: 0 }}>
              <Status value={row.status} />
            </Box>
          </Stack>
          <Typography
            variant="h6"
            sx={{ mt: 1.5, overflowWrap: 'anywhere' }}
            color={transactionAmountColor(row.direction)}
          >
            {transactionSign(row.direction)}
            {formatAmount(row.amount, row.asset)} {row.asset}
          </Typography>
          {isWithdrawalTransaction(row) && (
            <Typography variant="caption" color="text.secondary">
              {portalText('手续费 {{fee}} {{asset}} · 实际到账 {{amount}} {{asset}}', {
                fee: formatAmount(withdrawalFeeValue(row), row.asset),
                amount: formatAmount(withdrawalNetValue(row), row.asset),
                asset: row.asset,
              })}
            </Typography>
          )}
          <Box sx={{ mt: 1 }}>
            <TransactionChannel value={row} compact />
          </Box>
        </Box>
      ))}
    </Stack>
  );
}

function walletBalanceTotal(rows: any[], field: string) {
  if (!rows.length) return '0';
  if (rows.length === 1) return formatAmount(rows[0][field] || '0', rows[0].asset);
  if (rows.every((row) => row.asset === rows[0].asset)) {
    return formatBalance(rows.reduce((total, row) => total + Number(row[field] || 0), 0));
  }
  return rows.map((row) => `${row.asset} ${formatAmount(row[field], row.asset)}`).join(' · ');
}

function CustomerOverviewTable({ rows, onOpen }: { rows: any[]; onOpen: (id: string) => void }) {
  return (
    <Card>
      <TableContainer sx={{ display: { xs: 'none', lg: 'block' }, overflowX: 'auto' }}>
        <Table sx={{ minWidth: 1040, tableLayout: 'fixed' }}>
          <TableHead>
            <TableRow>
              <TableCell sx={{ width: 230 }}>{portalText('客户')}</TableCell>
              <TableCell sx={{ width: 230 }}>{portalText('联系方式')}</TableCell>
              <TableCell sx={{ width: 140 }}>{portalText('开户状态')}</TableCell>
              <TableCell sx={{ width: 190 }}>{portalText('VA 账户')}</TableCell>
              <TableCell sx={{ width: 170 }}>{portalText('可用资金')}</TableCell>
              <TableCell align="right" sx={{ width: 120 }}>
                {portalText('操作')}
              </TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {rows.map((row) => (
              <TableRow hover key={row.application_id}>
                <TableCell>
                  <Typography variant="subtitle2" noWrap title={row.customer_name}>
                    {row.customer_name}
                  </Typography>
                  <Typography
                    variant="caption"
                    color="text.secondary"
                    noWrap
                    title={row.application_id}
                    sx={{ display: 'block' }}
                  >
                    {row.application_id}
                  </Typography>
                </TableCell>
                <TableCell>
                  <Typography variant="body2" noWrap title={row.email}>
                    {row.email}
                  </Typography>
                  <Typography
                    variant="caption"
                    color="text.secondary"
                    noWrap
                    title={`${row.phone_country_code} ${row.phone_number}`}
                    sx={{ display: 'block' }}
                  >
                    {row.phone_country_code} {row.phone_number}
                  </Typography>
                </TableCell>
                <TableCell sx={{ whiteSpace: 'nowrap', overflow: 'hidden' }}>
                  <Status value={row.status} />
                </TableCell>
                <TableCell>
                  {row.va_account ? (
                    <>
                      <Typography variant="body2" noWrap title={row.va_account.account_number}>
                        {row.va_account.account_number}
                      </Typography>
                      <Typography
                        variant="caption"
                        color="text.secondary"
                        noWrap
                        title={`${row.va_account.currency} · ${row.va_account.bank_name}`}
                        sx={{ display: 'block' }}
                      >
                        {row.va_account.currency} · {row.va_account.bank_name}
                      </Typography>
                    </>
                  ) : (
                    <Typography variant="body2" color="text.secondary">
                      {portalText('尚未开通')}
                    </Typography>
                  )}
                </TableCell>
                <TableCell>
                  <Stack direction="row" spacing={1} useFlexGap flexWrap="wrap">
                    {row.balances?.length ? (
                      row.balances.map((balance: any) => (
                        <Stack
                          key={`${balance.asset}:${balance.network || ''}`}
                          direction="row"
                          spacing={0.75}
                          alignItems="center"
                        >
                          {balance.network ? (
                            <ChainValue network={balance.network} compact />
                          ) : (
                            <AssetValue asset={balance.asset} compact />
                          )}
                          <Label color="info">
                            {formatAmount(balance.available_balance, balance.asset)} {balance.asset}
                          </Label>
                        </Stack>
                      ))
                    ) : (
                      <Typography variant="body2" color="text.secondary">
                        {portalText('暂无余额')}
                      </Typography>
                    )}
                  </Stack>
                </TableCell>
                <TableCell align="right">
                  <Button size="small" onClick={() => onOpen(row.application_id)}>
                    {portalText('查看详情')}
                  </Button>
                </TableCell>
              </TableRow>
            ))}
            {!rows.length && (
              <TableRow>
                <TableCell colSpan={6} align="center" sx={{ py: 8, color: 'text.secondary' }}>
                  {portalText('暂无客户，先发起一笔开户申请。')}
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </TableContainer>
      <Stack divider={<Divider flexItem />} sx={{ display: { xs: 'flex', lg: 'none' } }}>
        {rows.map((row) => (
          <Box key={row.application_id} sx={{ p: { xs: 2, sm: 2.5 }, minWidth: 0 }}>
            <Stack
              direction="row"
              alignItems="flex-start"
              justifyContent="space-between"
              spacing={2}
            >
              <Box sx={{ minWidth: 0 }}>
                <Typography variant="subtitle1" noWrap title={row.customer_name}>
                  {row.customer_name}
                </Typography>
                <Typography
                  variant="caption"
                  color="text.secondary"
                  noWrap
                  title={row.application_id}
                  sx={{ display: 'block' }}
                >
                  {row.application_id}
                </Typography>
              </Box>
              <Box sx={{ flexShrink: 0 }}>
                <Status value={row.status} />
              </Box>
            </Stack>

            <Box
              sx={{
                mt: 2,
                display: 'grid',
                gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, minmax(0, 1fr))' },
                gap: 2,
              }}
            >
              <Info label={portalText('电子邮箱')} value={row.email} />
              <Info
                label={portalText('电话号码')}
                value={`${row.phone_country_code || ''} ${row.phone_number || ''}`.trim()}
              />
              <Info
                label={portalText('VA 账户')}
                value={
                  row.va_account
                    ? `${row.va_account.account_number} · ${row.va_account.currency} · ${row.va_account.bank_name}`
                    : portalText('尚未开通')
                }
              />
              <Box sx={{ minWidth: 0 }}>
                <Typography variant="caption" color="text.secondary">
                  {portalText('可用资金')}
                </Typography>
                <Stack spacing={1} sx={{ mt: 0.75, alignItems: 'flex-start' }}>
                  {row.balances?.length ? (
                    row.balances.map((balance: any) => (
                      <Stack
                        key={`${balance.asset}:${balance.network || ''}`}
                        direction="row"
                        spacing={0.75}
                        alignItems="center"
                        useFlexGap
                        flexWrap="wrap"
                      >
                        {balance.network ? (
                          <ChainValue network={balance.network} compact />
                        ) : (
                          <AssetValue asset={balance.asset} compact />
                        )}
                        <Label color="info">
                          {formatAmount(balance.available_balance, balance.asset)} {balance.asset}
                        </Label>
                      </Stack>
                    ))
                  ) : (
                    <Typography variant="body2" color="text.secondary">
                      {portalText('暂无余额')}
                    </Typography>
                  )}
                </Stack>
              </Box>
            </Box>

            <Button
              fullWidth
              variant="soft"
              onClick={() => onOpen(row.application_id)}
              endIcon={<Iconify icon="solar:alt-arrow-right-linear" />}
              sx={{ mt: 2, minHeight: 44 }}
            >
              {portalText('查看详情')}
            </Button>
          </Box>
        ))}
        {!rows.length && (
          <Box sx={{ px: 2, py: 7, textAlign: 'center' }}>
            <Typography color="text.secondary">
              {portalText('暂无客户，先发起一笔开户申请。')}
            </Typography>
          </Box>
        )}
      </Stack>
    </Card>
  );
}

function CustomerDetails({
  value,
  loading,
  error,
  onRetry,
  onBack,
  onOpenFiatWallet,
  onOpenCryptoWallet,
  onHistory,
}: {
  value: any;
  loading: boolean;
  error: string;
  onRetry: () => void | Promise<void>;
  onBack: () => void;
  onOpenFiatWallet: (id: string) => void;
  onOpenCryptoWallet: (id: string) => void;
  onHistory: (id: string) => void;
}) {
  if (error) {
    return (
      <Card sx={{ p: 4 }}>
        <Alert
          severity="error"
          action={
            <Button color="inherit" size="small" onClick={() => onRetry()}>
              {portalText('重新读取')}
            </Button>
          }
        >
          {portalText('{{error}}。当前没有把读取失败显示为客户无账户或无余额。', {
            error: portalDisplayText(error),
          })}
        </Alert>
      </Card>
    );
  }
  if (!value) {
    return (
      <Card sx={{ p: 4 }}>
        <Typography color="text.secondary">
          {portalText(loading ? '正在读取客户资料…' : '客户资料尚未加载，请重新读取。')}
        </Typography>
      </Card>
    );
  }

  const { customer: item } = value;
  let kycLinkDisplay = portalText('KYC 已完成，链接已失效');
  if (item.status === 'submitted') {
    kycLinkDisplay = portalText('等待运营方提供');
  } else if (item.status === 'kyc_link_ready' && item.kyc_url) {
    kycLinkDisplay = item.kyc_url;
  }
  return (
    <Stack spacing={3}>
      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5} useFlexGap flexWrap="wrap">
        <Button variant="outlined" onClick={onBack} sx={{ minHeight: 44 }}>
          {portalText('返回客户总览')}
        </Button>
        <Button
          variant="contained"
          startIcon={<Iconify icon={USD_ASSET_ICON} />}
          onClick={() => onOpenFiatWallet(item.application_id)}
          sx={{ minHeight: 44 }}
        >
          {portalText('法币钱包')}
        </Button>
        <Button
          variant="outlined"
          startIcon={<Iconify icon="solar:wallet-2-bold-duotone" />}
          onClick={() => onOpenCryptoWallet(item.application_id)}
          sx={{ minHeight: 44 }}
        >
          {portalText('数字钱包')}
        </Button>
        <Button onClick={() => onHistory(item.application_id)} sx={{ minHeight: 44 }}>
          {portalText('查看交易历史')}
        </Button>
      </Stack>
      {item.status !== 'active' && (
        <Alert severity="info">
          {portalText('可进入法币钱包或数字钱包查看只读余额与历史记录。')}
        </Alert>
      )}

      <Card sx={{ p: { xs: 2, sm: 3 } }}>
        <Stack direction={{ xs: 'column', md: 'row' }} justifyContent="space-between" spacing={2}>
          <Box sx={{ minWidth: 0 }}>
            <Typography variant="h5" sx={{ overflowWrap: 'anywhere' }}>
              {item.customer_name}
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ overflowWrap: 'anywhere' }}>
              {item.application_id}
            </Typography>
          </Box>
          <Status value={item.status} />
        </Stack>
        <Divider sx={{ my: 3 }} />
        <Box
          sx={{
            display: 'grid',
            gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, 1fr)', lg: 'repeat(4, 1fr)' },
            gap: 3,
          }}
        >
          <Info label={portalText('电子邮箱')} value={item.email} />
          <Info
            label={portalText('电话号码')}
            value={`${item.phone_country_code} ${item.phone_number}`}
          />
          <Info label={portalText('KYC 链接')} value={kycLinkDisplay} />
          <Info label={portalText('创建时间')} value={formatDate(item.created_at)} />
        </Box>
      </Card>

      <Card sx={{ p: { xs: 2, sm: 3 } }}>
        <Typography variant="h6" sx={{ mb: 2 }}>
          {portalText('VA 账户')}
        </Typography>
        {item.va_account ? (
          <Box
            sx={{
              display: 'grid',
              gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, 1fr)', lg: 'repeat(3, 1fr)' },
              gap: 3,
            }}
          >
            <Info label={portalText('账户名称')} value={item.va_account.account_name} />
            <Info label={portalText('客户方客户 ID')} value={item.partner_customer_id || '-'} />
            <Info label={portalText('账户号码')} value={item.va_account.account_number} />
            <Info label="IBAN" value={item.va_account.iban || '-'} />
            <Info label={portalText('币种')} value={item.va_account.currency} />
            <Info label="SWIFT / BIC" value={item.va_account.swift_bic} />
            <Info label={portalText('银行名称')} value={item.va_account.bank_name} />
            <Info label={portalText('银行地址')} value={item.va_account.bank_address} />
          </Box>
        ) : (
          <Typography color="text.secondary">{portalText('VA 账户尚未开通。')}</Typography>
        )}
      </Card>

      <Card sx={{ p: { xs: 2, sm: 3 } }}>
        <Typography variant="h6" sx={{ mb: 2 }}>
          {portalText('资金情况')}
        </Typography>
        <BalanceTable rows={value.balances || []} onRefresh={() => window.location.reload()} />
      </Card>

      <Card sx={{ p: { xs: 2, sm: 3 } }}>
        <Typography variant="h6" sx={{ mb: 2 }}>
          {portalText('最近资金流水')}
        </Typography>
        <RecordTable rows={value.fund_transactions || []} />
      </Card>

      <Card sx={{ p: { xs: 2, sm: 3 } }}>
        <Typography variant="h6" sx={{ mb: 2 }}>
          {portalText('OTC 记录')}
        </Typography>
        <RecordTable rows={value.otc_orders || []} />
      </Card>
    </Stack>
  );
}

function TransactionHistoryGrid({
  rows,
  loading,
  rowCount,
  page,
  pageSize,
  onPaginationChange,
  onOpen,
}: {
  rows: any[];
  loading: boolean;
  rowCount: number;
  page: number;
  pageSize: number;
  onPaginationChange: (page: number, pageSize: number) => void;
  onOpen: (row: any) => void;
}) {
  const columns: GridColDef[] = [
    {
      field: 'created_at',
      headerName: portalText('时间'),
      width: 145,
      renderCell: (params) => formatDate(params.row.created_at),
    },
    {
      field: 'customer_name',
      headerName: portalText('客户'),
      minWidth: 190,
      flex: 1,
      renderCell: (params) => (
        <Box sx={{ py: 1, minWidth: 0, width: '100%', overflow: 'hidden' }}>
          <Typography variant="subtitle2" noWrap title={params.row.customer_name}>
            {params.row.customer_name}
          </Typography>
          <Typography
            variant="caption"
            color="text.secondary"
            noWrap
            title={params.row.application_id}
            sx={{ display: 'block' }}
          >
            {params.row.application_id}
          </Typography>
        </Box>
      ),
    },
    {
      field: 'type',
      headerName: portalText('交易类型'),
      width: 110,
      renderCell: (params) => transactionTypeLabel(params.row.type),
    },
    {
      field: 'channel',
      headerName: portalText('通道 / 网络'),
      minWidth: 160,
      flex: 1,
      sortable: false,
      renderCell: (params) => <TransactionChannel value={params.row} compact />,
    },
    {
      field: 'amount',
      headerName: portalText('金额'),
      minWidth: 180,
      flex: 1,
      renderCell: (params) => (
        <Box sx={{ py: 1 }}>
          <Typography variant="body2" color={transactionAmountColor(params.row.direction)}>
            {transactionSign(params.row.direction)}
            {formatAmount(params.row.amount, params.row.asset)} {params.row.asset}
          </Typography>
          {params.row.category === 'otc' && (
            <Typography variant="caption" color="text.secondary">
              → {formatAmount(params.row.counter_amount, params.row.counter_asset)}{' '}
              {params.row.counter_asset}
              {params.row.fee_amount
                ? portalText('（手续费 {{fee}} {{asset}}）', {
                    fee: formatAmount(params.row.fee_amount, params.row.counter_asset),
                    asset: params.row.counter_asset,
                  })
                : ''}
            </Typography>
          )}
          {isWithdrawalTransaction(params.row) && (
            <Typography variant="caption" color="text.secondary">
              {portalText('手续费 {{fee}} {{asset}} · 实际到账 {{amount}} {{asset}}', {
                fee: formatAmount(withdrawalFeeValue(params.row), params.row.asset),
                amount: formatAmount(withdrawalNetValue(params.row), params.row.asset),
                asset: params.row.asset,
              })}
            </Typography>
          )}
        </Box>
      ),
    },
    {
      field: 'status',
      headerName: portalText('状态'),
      width: 90,
      renderCell: (params) => <Status value={params.row.status} />,
    },
    {
      field: 'id',
      headerName: portalText('交易编号'),
      minWidth: 180,
      flex: 1,
      renderCell: (params) => (
        <Typography variant="body2" noWrap title={params.row.id} sx={{ width: '100%' }}>
          {params.row.id}
        </Typography>
      ),
    },
    {
      field: 'actions',
      headerName: portalText('操作'),
      width: 80,
      sortable: false,
      filterable: false,
      renderCell: (params) => (
        <Button size="small" onClick={() => onOpen(params.row)}>
          {portalText('查看')}
        </Button>
      ),
    },
  ];

  return (
    <>
      <Box sx={{ display: { xs: 'block', lg: 'none' } }}>
        {loading && (
          <Typography variant="body2" color="text.secondary" sx={{ px: 2, py: 1.5 }}>
            {portalText('正在读取交易记录…')}
          </Typography>
        )}
        <Stack divider={<Divider flexItem />}>
          {rows.map((row) => (
            <Button
              key={row.id}
              color="inherit"
              onClick={() => onOpen(row)}
              sx={{
                px: 2,
                py: 2.25,
                minHeight: 44,
                display: 'block',
                textAlign: 'left',
                borderRadius: 0,
              }}
            >
              <Stack
                direction="row"
                alignItems="flex-start"
                justifyContent="space-between"
                spacing={2}
              >
                <Box sx={{ minWidth: 0 }}>
                  <Typography variant="subtitle1" noWrap title={row.customer_name}>
                    {row.customer_name || portalText('未知客户')}
                  </Typography>
                  <Typography variant="body2" color="text.secondary">
                    {transactionTypeLabel(row.type)}
                  </Typography>
                  <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
                    {formatDate(row.created_at)}
                  </Typography>
                </Box>
                <Box sx={{ flexShrink: 0 }}>
                  <Status value={row.status} />
                </Box>
              </Stack>

              <Typography
                variant="h6"
                color={transactionAmountColor(row.direction)}
                sx={{ mt: 1.5, overflowWrap: 'anywhere' }}
              >
                {transactionSign(row.direction)}
                {formatAmount(row.amount, row.asset)} {row.asset}
              </Typography>
              {row.category === 'otc' && (
                <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
                  → {formatAmount(row.counter_amount, row.counter_asset)} {row.counter_asset}
                  {row.fee_amount
                    ? portalText('（手续费 {{fee}} {{asset}}）', {
                        fee: formatAmount(row.fee_amount, row.counter_asset),
                        asset: row.counter_asset,
                      })
                    : ''}
                </Typography>
              )}
              {isWithdrawalTransaction(row) && (
                <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
                  {portalText('手续费 {{fee}} {{asset}} · 实际到账 {{amount}} {{asset}}', {
                    fee: formatAmount(withdrawalFeeValue(row), row.asset),
                    amount: formatAmount(withdrawalNetValue(row), row.asset),
                    asset: row.asset,
                  })}
                </Typography>
              )}

              <Stack
                direction="row"
                justifyContent="space-between"
                alignItems="flex-end"
                spacing={2}
                sx={{ mt: 1.5 }}
              >
                <Box sx={{ minWidth: 0 }}>
                  <TransactionChannel value={row} compact />
                  <Typography
                    variant="caption"
                    color="text.disabled"
                    noWrap
                    title={row.id}
                    sx={{ display: 'block', mt: 0.75 }}
                  >
                    {row.id}
                  </Typography>
                </Box>
                <Iconify icon="solar:alt-arrow-right-linear" width={18} sx={{ flexShrink: 0 }} />
              </Stack>
            </Button>
          ))}
        </Stack>
        {!loading && !rows.length && (
          <Box sx={{ px: 2, py: 7, textAlign: 'center' }}>
            <Typography color="text.secondary">{portalText('暂无交易')}</Typography>
          </Box>
        )}
        <TablePagination
          component="div"
          count={rowCount}
          page={page}
          rowsPerPage={pageSize}
          rowsPerPageOptions={[10, 25, 50]}
          onPageChange={(_event, nextPage) => onPaginationChange(nextPage, pageSize)}
          onRowsPerPageChange={(event) => onPaginationChange(0, Number(event.target.value))}
          labelRowsPerPage={portalText('每页行数')}
          labelDisplayedRows={({ from, to, count }) => `${from}–${to} / ${count}`}
          sx={{
            borderTop: '1px solid',
            borderColor: 'divider',
            '& .MuiTablePagination-toolbar': {
              minHeight: 64,
              px: 1,
              flexWrap: 'wrap',
              justifyContent: 'flex-end',
            },
            '& .MuiTablePagination-spacer': { display: 'none' },
            '& .MuiTablePagination-selectLabel': { display: { xs: 'none', sm: 'block' } },
          }}
        />
      </Box>
      <DataGrid
        rows={rows}
        loading={loading}
        columns={columns}
        autoHeight
        disableRowSelectionOnClick
        onRowClick={(params) => onOpen(params.row)}
        paginationMode="server"
        rowCount={rowCount}
        paginationModel={{ page, pageSize }}
        onPaginationModelChange={(model) => onPaginationChange(model.page, model.pageSize)}
        pageSizeOptions={[10, 25, 50]}
        getRowHeight={() => 'auto'}
        sx={{
          display: { xs: 'none', lg: 'block' },
          border: 0,
          '& .MuiDataGrid-cell': {
            py: 1,
            alignItems: 'center',
          },
        }}
      />
    </>
  );
}

function TransactionDetailDrawer({ value, onClose }: { value: any | null; onClose: () => void }) {
  if (!value) return null;
  const isOtc = value.type === 'otc';
  const isFiatConversionDebit = value.type === 'fiat_conversion_debit';
  const isCryptoConversionCredit = value.type === 'crypto_conversion_credit';
  const isUsdtSweep = value.type === 'usdt_sweep';
  const isFiat = value.type?.startsWith('fiat_');
  const isDeposit = value.type?.endsWith('_deposit');
  const isWithdrawal = value.type?.endsWith('_withdrawal');
  let transactionIcon = 'solar:upload-minimalistic-bold-duotone';
  let summaryBackground = 'warning.lighter';
  let summaryIconColor = 'warning.dark';
  let amountLabel = portalText('转出金额');
  if (isOtc) {
    transactionIcon = 'solar:transfer-horizontal-bold-duotone';
    summaryBackground = 'secondary.lighter';
    summaryIconColor = 'secondary.dark';
    amountLabel = portalText('卖出金额');
  } else if (isFiatConversionDebit) {
    transactionIcon = 'solar:transfer-horizontal-bold-duotone';
    summaryBackground = 'warning.lighter';
    summaryIconColor = 'warning.dark';
    amountLabel = portalText('法币扣款金额');
  } else if (isCryptoConversionCredit) {
    transactionIcon = 'solar:download-minimalistic-bold-duotone';
    summaryBackground = 'success.lighter';
    summaryIconColor = 'success.dark';
    amountLabel = portalText('数字货币转入金额');
  } else if (isUsdtSweep) {
    transactionIcon = 'solar:upload-minimalistic-bold-duotone';
    summaryBackground = 'error.lighter';
    summaryIconColor = 'error.dark';
    amountLabel = portalText('USDT 汇集转出金额');
  } else if (isDeposit) {
    transactionIcon = 'solar:download-minimalistic-bold-duotone';
    summaryBackground = 'success.lighter';
    summaryIconColor = 'success.dark';
    amountLabel = portalText('入账金额');
  }

  return (
    <Drawer
      anchor="right"
      open={Boolean(value)}
      onClose={onClose}
      PaperProps={{ sx: { width: { xs: 1, sm: 520 } } }}
    >
      <Stack
        direction="row"
        alignItems="center"
        justifyContent="space-between"
        sx={{ px: 3, py: 2.5, borderBottom: '1px solid', borderColor: 'divider' }}
      >
        <Box>
          <Typography variant="h6">{transactionTypeLabel(value.type)}</Typography>
          <Typography variant="caption" color="text.secondary">
            {portalText('交易详情')}
          </Typography>
        </Box>
        <IconButton aria-label={portalText('关闭交易详情')} onClick={onClose}>
          <Iconify icon="solar:close-circle-linear" />
        </IconButton>
      </Stack>

      <Box sx={{ p: 3, overflowY: 'auto' }}>
        <Card
          sx={{
            p: 3,
            mb: 3,
            boxShadow: 'none',
            bgcolor: summaryBackground,
          }}
        >
          <Stack direction="row" alignItems="flex-start" justifyContent="space-between" spacing={2}>
            <Box
              sx={{
                width: 48,
                height: 48,
                borderRadius: 1.5,
                display: 'grid',
                placeItems: 'center',
                color: summaryIconColor,
                bgcolor: 'background.paper',
              }}
            >
              <Iconify icon={transactionIcon} width={26} />
            </Box>
            <Status value={value.status} />
          </Stack>
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 3 }}>
            {amountLabel}
          </Typography>
          <Typography
            variant="h4"
            sx={{
              mt: 0.5,
              color: transactionAmountColor(
                isFiatConversionDebit ? value.direction || 'debit' : value.direction
              ),
              letterSpacing: -0.4,
            }}
          >
            {isOtc
              ? ''
              : transactionSign(
                  isFiatConversionDebit ? value.direction || 'debit' : value.direction
                )}
            {formatAmount(value.amount, value.asset)} {value.asset}
          </Typography>
          {isOtc && (
            <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
              {portalText('兑换到账 {{amount}} {{asset}}', {
                amount: formatAmount(value.counter_amount, value.counter_asset),
                asset: value.counter_asset,
              })}
            </Typography>
          )}
          {!isOtc && isWithdrawal && (
            <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
              {portalText('实际到账 {{amount}} {{asset}}', {
                amount: formatAmount(withdrawalNetValue(value), value.asset),
                asset: value.asset,
              })}
            </Typography>
          )}
        </Card>

        <Stack spacing={3}>
          <TransactionDetailSection title={portalText('交易信息')}>
            <Info label={portalText('客户')} value={value.customer_name} />
            <Info label={portalText('客户编号')} value={value.application_id} />
            <Info label={portalText('交易编号')} value={value.id} />
            <Info label={portalText('交易类型')} value={transactionTypeLabel(value.type)} />
          </TransactionDetailSection>

          {isOtc && (
            <TransactionDetailSection title={portalText('兑换明细')}>
              <TransactionAssetInfo
                label={portalText('卖出资产')}
                amount={formatAmount(value.amount, value.asset)}
                asset={value.asset}
                network={value.network}
              />
              <TransactionAssetInfo
                label={portalText('买入总额')}
                amount={formatAmount(
                  value.buy_amount || addAmounts(value.counter_amount, value.fee_amount),
                  value.counter_asset
                )}
                asset={value.counter_asset}
                network={value.counter_network}
              />
              <Info
                label={portalText('手续费')}
                value={portalText('{{amount}} {{asset}}（{{rate}}）', {
                  amount: formatAmount(value.fee_amount || '0', value.counter_asset),
                  asset: value.counter_asset,
                  rate: value.fee_rate || '0.5%',
                })}
              />
              <Info
                label={portalText('净买入金额')}
                value={`${formatAmount(
                  value.net_buy_amount || value.counter_amount,
                  value.counter_asset
                )} ${value.counter_asset}`}
              />
              <Info label={portalText('成交汇率')} value={value.exchange_rate || '-'} />
            </TransactionDetailSection>
          )}

          {isFiatConversionDebit && (
            <TransactionDetailSection title={portalText('法币扣款资料')}>
              <Info
                label={portalText('法币扣款金额')}
                value={`-${formatAmount(value.amount, value.asset)} ${value.asset || 'USD'}`}
              />
              <Info
                label={portalText('原始法币入金记录 ID')}
                value={value.source_fund_transaction_id || '-'}
              />
              <Info
                label={portalText('关联 OTC 记录 ID')}
                value={value.otc_order_id || value.conversion_otc_id || '-'}
              />
              <Info
                label={portalText('银行参考号')}
                value={
                  value.transaction_reference || value.external_reference || value.reference || '-'
                }
              />
            </TransactionDetailSection>
          )}

          {isCryptoConversionCredit && (
            <TransactionDetailSection title={portalText('数字货币转入资料')}>
              <Info
                label={portalText('数字货币转入金额')}
                value={`+${formatAmount(value.amount, value.asset)} ${value.asset}`}
              />
              <Box>
                <Typography variant="caption" color="text.secondary">
                  {portalText('网络')}
                </Typography>
                <Box sx={{ mt: 0.75 }}>
                  {value.network ? <ChainValue network={value.network} /> : '-'}
                </Box>
              </Box>
              <Info
                label={portalText('原始法币入金记录 ID')}
                value={value.source_fund_transaction_id || '-'}
              />
              <Info
                label={portalText('关联 OTC 记录 ID')}
                value={value.otc_order_id || value.conversion_otc_id || '-'}
              />
              <Info
                label={portalText('银行参考号')}
                value={
                  value.transaction_reference || value.external_reference || value.reference || '-'
                }
              />
            </TransactionDetailSection>
          )}

          {isUsdtSweep && (
            <TransactionDetailSection title={portalText('USDT 汇集转出资料')}>
              <Info
                label={portalText('USDT 汇集转出金额')}
                value={`-${formatAmount(value.amount, value.asset)} ${value.asset || 'USDT'}`}
              />
              <Box>
                <Typography variant="caption" color="text.secondary">
                  {portalText('网络')}
                </Typography>
                <Box sx={{ mt: 0.75 }}>
                  {value.network ? <ChainValue network={value.network} /> : '-'}
                </Box>
              </Box>
              <Info label={portalText('汇集批次 ID')} value={value.sweep_batch_id || '-'} />
              <Info
                label={portalText('链上 Tx Hash')}
                value={value.transaction_reference || value.reference || '-'}
              />
            </TransactionDetailSection>
          )}

          {!isOtc && isWithdrawal && (
            <TransactionDetailSection title={portalText('金额明细')}>
              <Info
                label={portalText('转出金额（总扣账）')}
                value={`${formatAmount(value.amount, value.asset)} ${value.asset}`}
              />
              <Info
                label={portalText('固定手续费')}
                value={`${formatAmount(withdrawalFeeValue(value), value.asset)} ${value.asset}`}
              />
              <Info
                label={portalText('实际到账')}
                value={`${formatAmount(withdrawalNetValue(value), value.asset)} ${value.asset}`}
              />
            </TransactionDetailSection>
          )}

          {!isOtc && isFiat && isWithdrawal && (
            <TransactionDetailSection title={portalText('收款银行资料')}>
              <Info label={portalText('收款人名称')} value={value.beneficiary_name || '-'} />
              <Info label={portalText('收款人地址')} value={value.beneficiary_address || '-'} />
              <Info label={portalText('银行名称')} value={value.bank_name || '-'} />
              <Info
                label={portalText('银行账号 / IBAN')}
                value={value.bank_account_number || '-'}
              />
              <Info label="SWIFT / BIC" value={value.swift_bic || '-'} />
              <Info label={portalText('银行地址')} value={value.bank_address || '-'} />
            </TransactionDetailSection>
          )}

          {!isOtc && !isFiat && !isCryptoConversionCredit && (
            <TransactionDetailSection
              title={portalText(isDeposit ? '链上入账资料' : '链上收款资料')}
            >
              <Box>
                <Typography variant="caption" color="text.secondary">
                  {portalText('网络')}
                </Typography>
                <Box sx={{ mt: 0.75 }}>
                  {value.network ? <ChainValue network={value.network} /> : '-'}
                </Box>
              </Box>
              <Info
                label={portalText(isDeposit ? '入账地址' : '收款钱包地址')}
                value={value.destination || '-'}
              />
              <Info
                label={portalText('链上交易哈希 / 参考')}
                value={value.transaction_reference || value.reference || '-'}
              />
            </TransactionDetailSection>
          )}

          {!isOtc && isFiat && isDeposit && (
            <TransactionDetailSection title={portalText('入账资料')}>
              <Info
                label={portalText('外部参考')}
                value={value.external_reference || value.reference || '-'}
              />
              <Info label={portalText('入账确认参考')} value={value.transaction_reference || '-'} />
              {value.settlement_status && (
                <Info
                  label={portalText('清算状态')}
                  value={fiatSettlementStatusLabel(value.settlement_status)}
                />
              )}
              {value.conversion_otc_id && (
                <Info label={portalText('关联 OTC 记录 ID')} value={value.conversion_otc_id} />
              )}
            </TransactionDetailSection>
          )}

          <TransactionDetailSection title={portalText('处理记录')}>
            <Info label={portalText('创建时间')} value={formatDate(value.created_at)} />
            <Info
              label={portalText('最后更新')}
              value={formatDate(value.updated_at || value.created_at)}
            />
            <Info
              label={portalText('完成时间')}
              value={value.completed_at ? formatDate(value.completed_at) : portalText('尚未完成')}
            />
            {!isOtc && isWithdrawal && (
              <Info
                label={portalText('处理参考')}
                value={value.transaction_reference || value.reference || '-'}
              />
            )}
            <Info label={portalText('备注')} value={value.note ? portalText(value.note) : '-'} />
          </TransactionDetailSection>
        </Stack>
      </Box>
    </Drawer>
  );
}

function TransactionDetailSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Box>
      <Typography variant="subtitle1" sx={{ mb: 2 }}>
        {title}
      </Typography>
      <Box
        sx={{
          display: 'grid',
          gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, minmax(0, 1fr))' },
          gap: 2.5,
          p: 2.5,
          borderRadius: 1.5,
          border: '1px solid',
          borderColor: 'divider',
        }}
      >
        {children}
      </Box>
    </Box>
  );
}

function RecentOtcHistory({ rows }: { rows: any[] }) {
  if (!rows.length) {
    return (
      <Box sx={{ py: 8, textAlign: 'center' }}>
        <Typography color="text.secondary">{portalText('该客户暂无 OTC 交易')}</Typography>
      </Box>
    );
  }
  return (
    <Stack divider={<Divider flexItem />} spacing={0}>
      {rows.map((row) => (
        <Stack key={row.id} spacing={1} sx={{ py: 2 }}>
          <Stack direction="row" alignItems="center" justifyContent="space-between">
            <Stack direction="row" spacing={1} alignItems="center">
              {row.sell_network ? (
                <ChainValue network={row.sell_network} />
              ) : (
                <AssetValue asset={row.sell_asset} compact />
              )}
              <Iconify icon="solar:alt-arrow-right-linear" width={16} color="text.disabled" />
              {row.buy_network ? (
                <ChainValue network={row.buy_network} />
              ) : (
                <AssetValue asset={row.buy_asset} compact />
              )}
            </Stack>
            <Status value={row.status} />
          </Stack>
          <Stack direction="row" justifyContent="space-between">
            <Typography variant="body2">
              {formatAmount(row.sell_amount, row.sell_asset)} {row.sell_asset}
            </Typography>
            <Typography variant="body2" color="text.secondary">
              {portalText('预计 {{amount}} {{asset}}', {
                amount: formatAmount(row.net_buy_amount, row.buy_asset),
                asset: row.buy_asset,
              })}
            </Typography>
          </Stack>
          <Typography variant="caption" color="text.secondary">
            {portalText('{{date}} · 分网络账本兑换 · 手续费 {{fee}}', {
              date: formatDate(row.created_at),
              fee: row.fee_rate,
            })}
          </Typography>
        </Stack>
      ))}
    </Stack>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <Box>
      <Typography variant="caption" color="text.secondary">
        {label}
      </Typography>
      <Typography variant="body2" sx={{ mt: 0.5, overflowWrap: 'anywhere' }}>
        {value || '-'}
      </Typography>
    </Box>
  );
}

function TransactionAssetInfo({
  label,
  amount,
  asset,
  network,
}: {
  label: string;
  amount: string;
  asset: string;
  network?: string;
}) {
  return (
    <Box>
      <Typography variant="caption" color="text.secondary">
        {label}
      </Typography>
      <Typography variant="body2" sx={{ mt: 0.5 }}>
        {amount || '0'} {asset}
      </Typography>
      <Box sx={{ mt: 0.75 }}>
        {network ? <ChainValue network={network} compact /> : <AssetValue asset={asset} compact />}
      </Box>
    </Box>
  );
}

function ChainValue({ network, compact = false }: { network: string; compact?: boolean }) {
  const chain = CHAIN_OPTIONS.find((item) => item.value === network);
  if (!chain) {
    return <Typography variant={compact ? 'caption' : 'body2'}>{network || '-'}</Typography>;
  }
  return (
    <Stack direction="row" spacing={1} alignItems="center">
      <Iconify icon={chain.icon} width={compact ? 18 : 22} sx={{ flexShrink: 0 }} />
      <Box>
        <Typography variant={compact ? 'caption' : 'body2'} sx={{ lineHeight: 1.25 }}>
          {compact ? chain.standard : chain.label}
        </Typography>
        {!compact && (
          <Typography variant="caption" color="text.secondary" sx={{ lineHeight: 1.2 }}>
            {chain.standard}
          </Typography>
        )}
      </Box>
    </Stack>
  );
}

function AssetValue({
  asset,
  compact = false,
  iconOnly = false,
  size,
}: {
  asset: string;
  compact?: boolean;
  iconOnly?: boolean;
  size?: number;
}) {
  const value = ASSET_OPTIONS.find((item) => item.value === asset);
  const iconSize = size || (compact ? 18 : 22);
  const icon = value?.icon || 'solar:wallet-money-bold-duotone';
  if (iconOnly) {
    return <Iconify icon={icon} width={iconSize} sx={{ flexShrink: 0 }} />;
  }
  return (
    <Stack direction="row" spacing={1} alignItems="center">
      <Iconify icon={icon} width={iconSize} sx={{ flexShrink: 0 }} />
      <Box>
        <Typography variant={compact ? 'caption' : 'body2'} sx={{ lineHeight: 1.25 }}>
          {asset}
        </Typography>
        {!compact && (
          <Typography variant="caption" color="text.secondary" sx={{ lineHeight: 1.2 }}>
            {value?.label ? portalText(value.label) : portalText('账本资产')}
          </Typography>
        )}
      </Box>
    </Stack>
  );
}

function SupportedChainList({ compact = false }: { compact?: boolean }) {
  return (
    <Stack direction="row" spacing={1} useFlexGap flexWrap="wrap">
      {CHAIN_OPTIONS.map((chain) => (
        <Stack
          key={chain.value}
          direction="row"
          spacing={0.75}
          alignItems="center"
          sx={{
            px: compact ? 1 : 1.25,
            py: compact ? 0.5 : 0.75,
            borderRadius: 1,
            border: '1px solid',
            borderColor: 'divider',
            bgcolor: 'background.paper',
          }}
        >
          <Iconify icon={chain.icon} width={compact ? 16 : 18} />
          <Typography variant="caption">
            {compact ? chain.standard : `${chain.label} · ${chain.standard}`}
          </Typography>
        </Stack>
      ))}
    </Stack>
  );
}

function TransactionChannel({ value, compact = false }: { value: any; compact?: boolean }) {
  if (value.type === 'otc') {
    return (
      <Stack direction="row" spacing={0.75} alignItems="center" useFlexGap flexWrap="wrap">
        {value.network ? (
          <ChainValue network={value.network} compact={compact} />
        ) : (
          <AssetValue asset={value.asset} compact />
        )}
        <Iconify icon="solar:alt-arrow-right-linear" width={compact ? 15 : 18} color="text.disabled" />
        {value.counter_network ? (
          <ChainValue network={value.counter_network} compact={compact} />
        ) : (
          <AssetValue asset={value.counter_asset} compact />
        )}
      </Stack>
    );
  }
  if (value.type === 'fiat_conversion_debit') {
    return (
      <Stack direction="row" spacing={0.75} alignItems="center" useFlexGap flexWrap="wrap">
        <AssetValue asset={value.asset || 'USD'} compact />
        <Typography variant="caption" color="text.secondary">
          {portalText('自动兑换扣款')}
        </Typography>
      </Stack>
    );
  }
  if (value.network) return <ChainValue network={value.network} compact={compact} />;

  const isDeposit = value.type?.endsWith('_deposit');
  return (
    <Stack direction="row" spacing={0.75} alignItems="center">
      <Iconify icon={USD_ASSET_ICON} width={compact ? 17 : 20} />
      <Box sx={{ minWidth: 0 }}>
        <Typography variant={compact ? 'caption' : 'body2'} color="text.secondary">
          {value.bank_name || portalText(isDeposit ? '银行入账' : '银行转账')}
        </Typography>
        {!compact && value.beneficiary_name && (
          <Typography variant="caption" color="text.secondary">
            {value.beneficiary_name}
          </Typography>
        )}
      </Box>
    </Stack>
  );
}

function customerBalance(rows: any[], asset: string, field: string, network?: string) {
  return rows
    .filter(
      (row) => row.asset === asset && (network === undefined || (row.network || '') === network)
    )
    .reduce((total, row) => total + Number(row[field] || 0), 0);
}

function balanceRisk(rows: any[]) {
  if (rows.some((row) => Number(row.available_balance || 0) < 0)) return 'negative';
  if (rows.some((row) => Number(row.reserved || 0) > 0)) return 'reserved';
  return 'normal';
}

function downloadBalanceCustomers(rows: any[]) {
  const columns = [
    portalText('客户名称'),
    portalText('客户编号'),
    portalText('开户状态'),
    portalText('USD 账本余额'),
    portalText('USD 待处理占用'),
    portalText('USD 可用余额'),
    portalText('USDT 可用余额'),
    portalText('资金状态'),
  ];
  const csvCell = (value: unknown) => `"${String(value ?? '').replace(/"/g, '""')}"`;
  const lines = rows.map((row) => {
    const balances = row.balances || [];
    const risk = balanceRisk(balances);
    let riskLabel = '正常';
    if (risk === 'negative') riskLabel = '可用余额异常';
    else if (risk === 'reserved') riskLabel = '存在待处理占用';
    return [
      row.customer_name,
      row.application_id,
      applicationStatusLabel(row.status),
      customerBalance(balances, 'USD', 'ledger_balance', ''),
      customerBalance(balances, 'USD', 'reserved', ''),
      customerBalance(balances, 'USD', 'available_balance', ''),
      customerBalance(balances, 'USDT', 'available_balance'),
      portalText(riskLabel),
    ]
      .map(csvCell)
      .join(',');
  });
  const blob = new Blob([`\uFEFF${columns.map(csvCell).join(',')}\n${lines.join('\n')}`], {
    type: 'text/csv;charset=utf-8',
  });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `customer-balances-${new Date().toISOString().slice(0, 10)}.csv`;
  anchor.click();
  URL.revokeObjectURL(url);
}

function BalanceStatus({ rows }: { rows: any[] }) {
  const risk = balanceRisk(rows);
  if (risk === 'negative') return <Label color="error">{portalText('可用余额异常')}</Label>;
  if (risk === 'reserved') return <Label color="warning">{portalText('存在待处理占用')}</Label>;
  if (!rows.length) return <Label color="default">{portalText('暂无余额')}</Label>;
  return <Label color="success">{portalText('正常')}</Label>;
}

function BalanceCustomerOverview({
  rows,
  loading,
  error,
  search,
  balanceState,
  total,
  page,
  pageSize,
  snapshotAt,
  exporting,
  onSearch,
  onBalanceState,
  onPage,
  onPageSize,
  onRefresh,
  onExport,
  onOpen,
}: any) {
  return (
    <Stack spacing={2.5}>
      <Card sx={{ p: { xs: 2, md: 2.5 } }}>
        <Stack direction={{ xs: 'column', lg: 'row' }} spacing={1.5} alignItems={{ lg: 'center' }}>
          <TextField
            value={search}
            onChange={(event) => onSearch(event.target.value)}
            placeholder={portalText('搜索客户名称或编号')}
            InputProps={{
              startAdornment: (
                <InputAdornment position="start">
                  <Iconify icon="solar:magnifier-linear" width={20} />
                </InputAdornment>
              ),
            }}
            sx={{ width: 1, minWidth: 0, flex: { xs: '0 0 auto', lg: '1 1 320px' } }}
          />
          <TextField
            select
            label={portalText('资金状态')}
            value={balanceState}
            onChange={(event) => onBalanceState(event.target.value)}
            sx={{ width: { xs: 1, lg: 'auto' }, minWidth: { lg: 180 } }}
          >
            <MenuItem value="all">{portalText('全部资金状态')}</MenuItem>
            <MenuItem value="with_balance">{portalText('有账本余额')}</MenuItem>
            <MenuItem value="with_reserved">{portalText('存在待处理占用')}</MenuItem>
          </TextField>
          <Button variant="outlined" disabled={loading} onClick={onRefresh} sx={{ minHeight: 44 }}>
            {portalText(loading ? '读取中…' : '刷新全部')}
          </Button>
          <Button
            variant="soft"
            disabled={!rows.length || exporting}
            onClick={onExport}
            sx={{ minHeight: 44 }}
          >
            {portalText(exporting ? '导出中…' : '导出当前筛选结果')}
          </Button>
        </Stack>
        <Stack
          direction={{ xs: 'column', sm: 'row' }}
          justifyContent="space-between"
          spacing={0.5}
          sx={{ mt: 1.5 }}
        >
          <Typography variant="caption" color="text.secondary">
            {portalText('共 {{count}} 位客户', { count: total })}
          </Typography>
          {snapshotAt && (
            <Typography variant="caption" color="text.secondary">
              {portalText('数据读取时间：{{time}}', { time: formatDate(snapshotAt) })}
            </Typography>
          )}
        </Stack>
      </Card>

      {error && (
        <Alert
          severity="error"
          action={<Button onClick={onRefresh}>{portalText('重新读取')}</Button>}
        >
          {portalDisplayText(error)}
        </Alert>
      )}

      <Card>
        <TableContainer sx={{ display: { xs: 'none', lg: 'block' }, overflowX: 'auto' }}>
          <Table sx={{ minWidth: 1080, tableLayout: 'fixed' }}>
            <TableHead>
              <TableRow>
                <TableCell sx={{ width: 220 }}>{portalText('客户')}</TableCell>
                <TableCell sx={{ width: 130 }}>{portalText('开户状态')}</TableCell>
                <TableCell sx={{ width: 220 }}>{portalText('VA 账户')}</TableCell>
                <TableCell sx={{ width: 150 }}>{portalText('USD 可用余额')}</TableCell>
                <TableCell sx={{ width: 210 }}>{portalText('USDT 可用余额')}</TableCell>
                <TableCell sx={{ width: 150 }}>{portalText('资金状态')}</TableCell>
                <TableCell align="right" sx={{ width: 110 }}>
                  {portalText('操作')}
                </TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {rows.map((row: any) => {
                const balanceRows = row.balances || [];
                return (
                  <TableRow
                    hover
                    key={row.application_id}
                    onClick={() => onOpen(row.application_id)}
                    sx={{ cursor: 'pointer' }}
                  >
                    <TableCell>
                      <Typography variant="subtitle2" noWrap title={row.customer_name}>
                        {row.customer_name}
                      </Typography>
                      <Typography variant="caption" color="text.secondary" noWrap>
                        {row.application_id}
                      </Typography>
                    </TableCell>
                    <TableCell>
                      <Status value={row.status} />
                    </TableCell>
                    <TableCell>
                      {row.va_account ? (
                        <>
                          <Typography variant="body2" noWrap>
                            {row.va_account.account_number}
                          </Typography>
                          <Typography variant="caption" color="text.secondary" noWrap>
                            {row.va_account.currency} · {row.va_account.bank_name}
                          </Typography>
                        </>
                      ) : (
                        portalText('尚未开通')
                      )}
                    </TableCell>
                    <TableCell>
                      <Typography variant="subtitle2">
                        {formatAmount(
                          customerBalance(balanceRows, 'USD', 'available_balance', ''),
                          'USD'
                        )}{' '}
                        USD
                      </Typography>
                    </TableCell>
                    <TableCell>
                      <Typography variant="subtitle2">
                        {formatAmount(
                          customerBalance(balanceRows, 'USDT', 'available_balance'),
                          'USDT'
                        )}{' '}
                        USDT
                      </Typography>
                      <Typography variant="caption" color="text.secondary">
                        {balanceRows
                          .filter((item: any) => item.asset === 'USDT')
                          .map((item: any) => item.network)
                          .filter(Boolean)
                          .join(' · ') || portalText('暂无网络余额')}
                      </Typography>
                    </TableCell>
                    <TableCell>
                      <BalanceStatus rows={balanceRows} />
                    </TableCell>
                    <TableCell align="right">
                      <Button
                        size="small"
                        onClick={(event) => {
                          event.stopPropagation();
                          onOpen(row.application_id);
                        }}
                      >
                        {portalText('查看详情')}
                      </Button>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </TableContainer>

        <Stack sx={{ display: { xs: 'flex', lg: 'none' } }} divider={<Divider flexItem />}>
          {rows.map((row: any) => (
            <Button
              key={row.application_id}
              color="inherit"
              onClick={() => onOpen(row.application_id)}
              sx={{ p: 2, display: 'block', textAlign: 'left' }}
            >
              <Stack direction="row" justifyContent="space-between" spacing={2}>
                <Box sx={{ minWidth: 0 }}>
                  <Typography variant="subtitle2" noWrap>
                    {row.customer_name}
                  </Typography>
                  <Typography variant="caption" color="text.secondary" noWrap>
                    {row.application_id}
                  </Typography>
                </Box>
                <BalanceStatus rows={row.balances || []} />
              </Stack>
              <Stack direction="row" spacing={3} sx={{ mt: 1.5 }}>
                <Box>
                  <Typography variant="caption" color="text.secondary">
                    USD
                  </Typography>
                  <Typography variant="body2">
                    {formatAmount(
                      customerBalance(row.balances || [], 'USD', 'available_balance', ''),
                      'USD'
                    )}
                  </Typography>
                </Box>
                <Box>
                  <Typography variant="caption" color="text.secondary">
                    USDT
                  </Typography>
                  <Typography variant="body2">
                    {formatAmount(
                      customerBalance(row.balances || [], 'USDT', 'available_balance'),
                      'USDT'
                    )}
                  </Typography>
                </Box>
              </Stack>
            </Button>
          ))}
        </Stack>

        {!rows.length && !loading && !error && (
          <Box sx={{ py: 8, px: 2, textAlign: 'center' }}>
            <Typography variant="h6">{portalText('没有匹配的客户')}</Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
              {portalText('请调整搜索关键词或筛选条件。')}
            </Typography>
          </Box>
        )}
        <TablePagination
          component="div"
          count={total}
          page={page}
          rowsPerPage={pageSize}
          rowsPerPageOptions={[10, 25, 50, 100]}
          onPageChange={(_event, nextPage) => onPage(nextPage)}
          onRowsPerPageChange={(event) => onPageSize(Number(event.target.value))}
          labelRowsPerPage={portalText('每页行数')}
          labelDisplayedRows={({ from, to, count }) => `${from}–${to} / ${count}`}
          sx={{
            '& .MuiTablePagination-toolbar': {
              minHeight: 64,
              px: { xs: 1, sm: 2 },
              flexWrap: 'wrap',
              justifyContent: 'flex-end',
            },
            '& .MuiTablePagination-spacer': { display: { xs: 'none', sm: 'block' } },
            '& .MuiTablePagination-selectLabel': { display: { xs: 'none', sm: 'block' } },
          }}
        />
      </Card>
    </Stack>
  );
}

function BalanceCustomerDetails({
  value,
  loading,
  error,
  onRetry,
  onBack,
  onFiatWallet,
  onCryptoWallet,
  onHistory,
}: any) {
  if (error) {
    return (
      <Alert severity="error" action={<Button onClick={onRetry}>{portalText('重新读取')}</Button>}>
        {portalDisplayText(error)}
      </Alert>
    );
  }
  if (!value) {
    return (
      <Card sx={{ p: 4 }}>
        <Typography color="text.secondary">
          {portalText(loading ? '正在读取客户资料…' : '客户不存在或资料尚未加载。')}
        </Typography>
      </Card>
    );
  }
  const { customer: item } = value;
  const rows = value.balances || [];
  const hasReserved = rows.some((row: any) => Number(row.reserved || 0) > 0);
  const hasNegative = rows.some((row: any) => Number(row.available_balance || 0) < 0);
  return (
    <Stack spacing={3}>
      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5} useFlexGap flexWrap="wrap">
        <Button variant="outlined" onClick={onBack} sx={{ minHeight: 44 }}>
          {portalText('返回余额总览')}
        </Button>
        <Button onClick={() => onFiatWallet(item.application_id)} sx={{ minHeight: 44 }}>
          {portalText('法币钱包')}
        </Button>
        <Button onClick={() => onCryptoWallet(item.application_id)} sx={{ minHeight: 44 }}>
          {portalText('数字钱包')}
        </Button>
        <Button onClick={() => onHistory(item.application_id)} sx={{ minHeight: 44 }}>
          {portalText('查看全部交易')}
        </Button>
      </Stack>
      {(hasReserved || hasNegative) && (
        <Alert severity={hasNegative ? 'error' : 'warning'}>
          {portalText(
            hasNegative
              ? '发现可用余额为负数，请核对账本和待处理占用。'
              : '该客户存在待处理占用，详情已按资产和网络列出。'
          )}
        </Alert>
      )}
      <Card sx={{ p: { xs: 2, sm: 3 } }}>
        <Stack direction={{ xs: 'column', sm: 'row' }} justifyContent="space-between" spacing={2}>
          <Box>
            <Typography variant="h5">{item.customer_name}</Typography>
            <Typography variant="body2" color="text.secondary">
              {item.application_id}
            </Typography>
            {item.va_account && (
              <Typography variant="caption" color="text.secondary">
                {item.va_account.account_number} · {item.va_account.bank_name}
              </Typography>
            )}
          </Box>
          <Stack alignItems={{ sm: 'flex-end' }} spacing={1}>
            <Status value={item.status} />
            <BalanceStatus rows={rows} />
          </Stack>
        </Stack>
      </Card>
      <Box
        sx={{
          display: 'grid',
          gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr', xl: 'repeat(4, 1fr)' },
          gap: 2,
        }}
      >
        {[
          ['USD 可用余额', customerBalance(rows, 'USD', 'available_balance', ''), 'USD'],
          ['USD 待处理占用', customerBalance(rows, 'USD', 'reserved', ''), 'USD'],
          ['USDT 可用余额', customerBalance(rows, 'USDT', 'available_balance'), 'USDT'],
          ['USDT 待处理占用', customerBalance(rows, 'USDT', 'reserved'), 'USDT'],
        ].map(([label, amount, asset]) => (
          <Card key={String(label)} sx={{ p: 2.5 }}>
            <Typography variant="caption" color="text.secondary">
              {portalText(String(label))}
            </Typography>
            <Typography variant="h5" sx={{ mt: 0.75 }}>
              {formatAmount(Number(amount), String(asset))}
            </Typography>
            <Typography variant="caption" color="text.secondary">
              {asset}
            </Typography>
          </Card>
        ))}
      </Box>
      <Card sx={{ p: { xs: 2, sm: 3 } }}>
        <Typography variant="h6" sx={{ mb: 2 }}>
          {portalText('资产明细')}
        </Typography>
        <BalanceTable rows={rows} loading={loading} error={error} onRefresh={onRetry} />
      </Card>
      <Card sx={{ p: { xs: 2, sm: 3 } }}>
        <Stack
          direction={{ xs: 'column', sm: 'row' }}
          justifyContent="space-between"
          alignItems={{ xs: 'stretch', sm: 'center' }}
          spacing={1}
          sx={{ mb: 2 }}
        >
          <Typography variant="h6">{portalText('最近资金流水')}</Typography>
          <Button onClick={() => onHistory(item.application_id)}>
            {portalText('查看全部交易')}
          </Button>
        </Stack>
        <RecordTable rows={(value.fund_transactions || []).slice(0, 10)} />
      </Card>
    </Stack>
  );
}

function ApplicationSelect({ values, value, onChange }: any) {
  const selectedApplication = values.find((item: any) => item.application_id === value) || null;

  return (
    <Autocomplete
      options={values}
      value={selectedApplication}
      disableClearable={Boolean(selectedApplication)}
      autoHighlight
      openOnFocus
      getOptionLabel={(option: any) => option.customer_name || option.application_id}
      isOptionEqualToValue={(option: any, selected: any) =>
        option.application_id === selected.application_id
      }
      filterOptions={(options, state) => {
        const query = state.inputValue.trim().toLocaleLowerCase();
        if (!query) return options;

        return options.filter((option: any) =>
          `${option.customer_name || ''} ${option.application_id || ''}`
            .toLocaleLowerCase()
            .includes(query)
        );
      }}
      onChange={(_event, option: any) => {
        if (option) onChange(option.application_id);
      }}
      noOptionsText={portalText('没有匹配的客户')}
      sx={{ minWidth: 280, mb: 2 }}
      renderInput={(params) => (
        <TextField
          {...params}
          label={portalText('客户')}
          placeholder={portalText('搜索客户名称或编号')}
          InputLabelProps={{ shrink: true }}
        />
      )}
    />
  );
}

function ApplicationTable({
  rows,
  onResubmit,
}: {
  rows: any[];
  onResubmit: (application: any) => void;
}) {
  return (
    <>
      <TableContainer sx={{ display: { xs: 'none', md: 'block' }, overflowX: 'auto' }}>
        <Table sx={{ minWidth: 1040, tableLayout: 'fixed' }}>
          <TableHead>
            <TableRow>
              <TableCell sx={{ width: 190, whiteSpace: 'nowrap' }}>
                {portalText('申请编号')}
              </TableCell>
              <TableCell sx={{ width: 190, whiteSpace: 'nowrap' }}>
                {portalText('客户方客户 ID')}
              </TableCell>
              <TableCell sx={{ width: 220 }}>{portalText('客户')}</TableCell>
              <TableCell sx={{ width: 130 }}>{portalText('状态')}</TableCell>
              <TableCell sx={{ width: 310 }}>{portalText('KYC / VA 资料')}</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {rows.map((row) => (
              <TableRow key={row.application_id}>
                <TableCell>
                  <Typography
                    component="span"
                    variant="subtitle2"
                    noWrap
                    title={row.application_id}
                    sx={{ display: 'block' }}
                  >
                    {truncateIdentifier(row.application_id)}
                  </Typography>
                </TableCell>
                <TableCell>
                  <Typography
                    component="span"
                    variant="body2"
                    noWrap
                    title={row.partner_customer_id || ''}
                    sx={{ display: 'block', color: 'text.secondary' }}
                  >
                    {row.partner_customer_id ? truncateIdentifier(row.partner_customer_id) : '—'}
                  </Typography>
                </TableCell>
                <TableCell>
                  <Typography variant="body2" noWrap title={row.customer_name}>
                    {row.customer_name}
                  </Typography>
                </TableCell>
                <TableCell>
                  <Status value={row.status} />
                </TableCell>
                <TableCell>
                  {row.status === 'changes_requested' ? (
                    <Stack spacing={1} alignItems="flex-start">
                      <Typography variant="body2" color="error.main">
                        {row.action_required?.reason_message || portalText('需要补正开户资料')}
                      </Typography>
                      <Button
                        size="small"
                        variant="soft"
                        color="error"
                        onClick={() => onResubmit(row)}
                      >
                        {portalText('修改并重新提交')}
                      </Button>
                    </Stack>
                  ) : (
                    <Typography
                      variant="body2"
                      noWrap
                      title={row.va_account?.account_number || row.kyc_url || '-'}
                    >
                      {row.va_account?.account_number || row.kyc_url || '-'}
                    </Typography>
                  )}
                </TableCell>
              </TableRow>
            ))}
            {!rows.length && (
              <TableRow>
                <TableCell colSpan={5} align="center" sx={{ py: 6, color: 'text.secondary' }}>
                  {portalText('当前没有待完成的开户申请')}
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </TableContainer>
      <Stack
        divider={<Divider flexItem />}
        sx={{ display: { xs: 'flex', md: 'none' }, mx: { xs: -2, sm: -3 }, mb: -2 }}
      >
        {rows.map((row) => (
          <Box key={row.application_id} sx={{ px: { xs: 2, sm: 3 }, py: 2 }}>
            <Stack
              direction="row"
              alignItems="flex-start"
              justifyContent="space-between"
              spacing={2}
            >
              <Box sx={{ minWidth: 0 }}>
                <Typography variant="subtitle2" noWrap title={row.customer_name}>
                  {row.customer_name}
                </Typography>
                <Typography
                  variant="caption"
                  color="text.secondary"
                  noWrap
                  title={row.application_id}
                  sx={{ display: 'block' }}
                >
                  {truncateIdentifier(row.application_id)}
                </Typography>
                <Typography
                  variant="caption"
                  color="text.secondary"
                  noWrap
                  title={row.partner_customer_id || ''}
                  sx={{ display: 'block' }}
                >
                  {portalText('客户方客户 ID')}：
                  {row.partner_customer_id ? truncateIdentifier(row.partner_customer_id) : '—'}
                </Typography>
              </Box>
              <Box sx={{ flexShrink: 0 }}>
                <Status value={row.status} />
              </Box>
            </Stack>
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1.5 }}>
              {portalText('KYC / VA 资料')}
            </Typography>
            <Typography variant="body2" sx={{ mt: 0.25, overflowWrap: 'anywhere' }}>
              {row.status === 'changes_requested'
                ? row.action_required?.reason_message || portalText('需要补正开户资料')
                : row.va_account?.account_number || row.kyc_url || '-'}
            </Typography>
            {row.status === 'changes_requested' && (
              <Button
                fullWidth
                size="small"
                variant="soft"
                color="error"
                sx={{ mt: 1.5 }}
                onClick={() => onResubmit(row)}
              >
                {portalText('修改并重新提交')}
              </Button>
            )}
          </Box>
        ))}
        {!rows.length && (
          <Box sx={{ px: 2, py: 5, textAlign: 'center' }}>
            <Typography color="text.secondary">{portalText('当前没有待完成的开户申请')}</Typography>
          </Box>
        )}
      </Stack>
    </>
  );
}

function BalanceTable({
  rows,
  loading = false,
  error = '',
  onRefresh,
}: {
  rows: any[];
  loading?: boolean;
  error?: string;
  onRefresh: () => void;
}) {
  let emptyMessage = '暂无账本余额';
  if (loading) emptyMessage = '正在读取账本余额…';
  else if (error) emptyMessage = '余额读取失败，未按零余额处理';

  return (
    <>
      <Button disabled={loading} onClick={onRefresh} sx={{ mb: 2 }}>
        {portalText(loading ? '读取中…' : '刷新余额')}
      </Button>
      <TableContainer sx={{ display: { xs: 'none', md: 'block' }, overflowX: 'auto' }}>
        <Table sx={{ minWidth: 760 }}>
          <TableHead>
            <TableRow>
              <TableCell>{portalText('资产')}</TableCell>
              <TableCell>{portalText('网络')}</TableCell>
              <TableCell>{portalText('账本余额')}</TableCell>
              <TableCell>{portalText('待处理占用')}</TableCell>
              <TableCell>{portalText('可用余额')}</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {rows.map((row) => (
              <TableRow key={`${row.asset}:${row.network || ''}`}>
                <TableCell>
                  <AssetValue asset={row.asset} compact />
                </TableCell>
                <TableCell>
                  {row.network ? <ChainValue network={row.network} /> : portalText('法币账本')}
                </TableCell>
                <TableCell>{formatAmount(row.ledger_balance, row.asset)}</TableCell>
                <TableCell>{formatAmount(row.reserved, row.asset)}</TableCell>
                <TableCell>{formatAmount(row.available_balance, row.asset)}</TableCell>
              </TableRow>
            ))}
            {!rows.length && (
              <TableRow>
                <TableCell colSpan={5} align="center" sx={{ py: 5, color: 'text.secondary' }}>
                  {portalText(emptyMessage)}
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </TableContainer>
      <Stack divider={<Divider flexItem />} sx={{ display: { xs: 'flex', md: 'none' } }}>
        {rows.map((row) => (
          <Box key={`${row.asset}:${row.network || ''}`} sx={{ py: 2 }}>
            <Stack
              direction="row"
              alignItems="flex-start"
              justifyContent="space-between"
              spacing={2}
            >
              <AssetValue asset={row.asset} />
              <Box sx={{ flexShrink: 0 }}>
                {row.network ? (
                  <ChainValue network={row.network} compact />
                ) : (
                  <Typography variant="caption" color="text.secondary">
                    {portalText('法币账本')}
                  </Typography>
                )}
              </Box>
            </Stack>
            <Box
              sx={{
                mt: 2,
                display: 'grid',
                gridTemplateColumns: {
                  xs: 'repeat(2, minmax(0, 1fr))',
                  sm: 'repeat(3, minmax(0, 1fr))',
                },
                gap: 1.5,
              }}
            >
              {[
                [portalText('账本余额'), row.ledger_balance],
                [portalText('待处理占用'), row.reserved],
                [portalText('可用余额'), row.available_balance],
              ].map(([label, amount], index) => (
                <Box
                  key={String(label)}
                  sx={{
                    minWidth: 0,
                    gridColumn: { xs: index === 2 ? '1 / -1' : 'auto', sm: 'auto' },
                    p: 1.5,
                    borderRadius: 1.5,
                    bgcolor: index === 2 ? 'primary.lighter' : 'background.neutral',
                  }}
                >
                  <Typography variant="caption" color="text.secondary">
                    {label}
                  </Typography>
                  <Typography variant="subtitle2" sx={{ mt: 0.5, overflowWrap: 'anywhere' }}>
                    {formatAmount(amount, row.asset)} {row.asset}
                  </Typography>
                </Box>
              ))}
            </Box>
          </Box>
        ))}
        {!rows.length && (
          <Box sx={{ py: 5, textAlign: 'center' }}>
            <Typography color="text.secondary">{portalText(emptyMessage)}</Typography>
          </Box>
        )}
      </Stack>
    </>
  );
}

function RecordTable({ rows }: { rows: any[] }) {
  return (
    <>
      <TableContainer sx={{ display: { xs: 'none', md: 'block' }, overflowX: 'auto' }}>
        <Table sx={{ minWidth: 720 }}>
          <TableHead>
            <TableRow>
              <TableCell>{portalText('编号')}</TableCell>
              <TableCell>{portalText('类型')}</TableCell>
              <TableCell>{portalText('金额')}</TableCell>
              <TableCell>{portalText('状态')}</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {rows.map((row) => (
              <TableRow key={row.id}>
                <TableCell>{row.id}</TableCell>
                <TableCell>{row.type || `${row.sell_asset} → ${row.buy_asset}`}</TableCell>
                <TableCell>
                  <Typography variant="body2">
                    {formatAmount(row.amount || row.sell_amount, row.asset || row.sell_asset)}{' '}
                    {row.asset || row.sell_asset}
                  </Typography>
                  {isWithdrawalTransaction(row) && (
                    <Typography variant="caption" color="text.secondary">
                      {portalText('手续费 {{fee}} {{asset}} · 实际到账 {{amount}} {{asset}}', {
                        fee: formatAmount(withdrawalFeeValue(row), row.asset),
                        amount: formatAmount(withdrawalNetValue(row), row.asset),
                        asset: row.asset,
                      })}
                    </Typography>
                  )}
                </TableCell>
                <TableCell>
                  <Status value={row.status} />
                </TableCell>
              </TableRow>
            ))}
            {!rows.length && (
              <TableRow>
                <TableCell colSpan={4} align="center" sx={{ py: 5, color: 'text.secondary' }}>
                  {portalText('暂无记录')}
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </TableContainer>
      <Stack divider={<Divider flexItem />} sx={{ display: { xs: 'flex', md: 'none' } }}>
        {rows.map((row) => (
          <Box key={row.id} sx={{ py: 2, minWidth: 0 }}>
            <Stack
              direction="row"
              alignItems="flex-start"
              justifyContent="space-between"
              spacing={2}
            >
              <Box sx={{ minWidth: 0 }}>
                <Typography variant="subtitle2" sx={{ overflowWrap: 'anywhere' }}>
                  {transactionTypeLabel(row.type || `${row.sell_asset} → ${row.buy_asset}`)}
                </Typography>
                <Typography
                  variant="caption"
                  color="text.secondary"
                  noWrap
                  title={row.id}
                  sx={{ display: 'block' }}
                >
                  {row.id}
                </Typography>
              </Box>
              <Box sx={{ flexShrink: 0 }}>
                <Status value={row.status} />
              </Box>
            </Stack>
            <Typography variant="h6" sx={{ mt: 1.25, overflowWrap: 'anywhere' }}>
              {formatAmount(row.amount || row.sell_amount, row.asset || row.sell_asset)}{' '}
              {row.asset || row.sell_asset}
            </Typography>
            {isWithdrawalTransaction(row) && (
              <Typography variant="caption" color="text.secondary">
                {portalText('手续费 {{fee}} {{asset}} · 实际到账 {{amount}} {{asset}}', {
                  fee: formatAmount(withdrawalFeeValue(row), row.asset),
                  amount: formatAmount(withdrawalNetValue(row), row.asset),
                  asset: row.asset,
                })}
              </Typography>
            )}
          </Box>
        ))}
        {!rows.length && (
          <Box sx={{ py: 5, textAlign: 'center' }}>
            <Typography color="text.secondary">{portalText('暂无记录')}</Typography>
          </Box>
        )}
      </Stack>
    </>
  );
}

function formatDate(value: string) {
  if (!value) return '-';
  return new Intl.DateTimeFormat(portalLocale(), {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value));
}

function transactionTypeLabel(value: string) {
  const copy: Record<string, string> = {
    fiat_deposit: '法币转入',
    fiat_conversion_debit: '法币扣款',
    crypto_conversion_credit: '数字货币转入',
    usdt_sweep: 'USDT 汇集转出',
    usdt_deposit: 'USDT 转入',
    fiat_withdrawal: '法币转出',
    usdt_withdrawal: '数字货币转出',
    otc: 'OTC',
  };
  return copy[value] ? portalText(copy[value]) : value;
}

function fiatSettlementStatusLabel(value: string) {
  const copy: Record<string, string> = {
    pending: '待清算',
    cleared: '已清算',
    exception: '调单',
  };
  return copy[value] ? portalText(copy[value]) : value;
}

function transactionSign(direction: string) {
  if (direction === 'credit') return '+';
  if (direction === 'debit') return '-';
  return '';
}

function transactionAmountColor(direction: string) {
  if (direction === 'credit') return 'success.main';
  if (direction === 'debit') return 'error.main';
  return 'text.primary';
}

function isWithdrawalTransaction(value: any) {
  return Boolean(value?.type?.endsWith('_withdrawal'));
}

function withdrawalFeeValue(value: any) {
  return value?.fee_amount ?? '0';
}

function withdrawalNetValue(value: any) {
  if (value?.net_amount !== undefined && value?.net_amount !== null) {
    return value.net_amount;
  }
  const amount = Number(value?.amount || 0);
  const fee = Number(withdrawalFeeValue(value));
  return formatBalance(Math.max(0, amount - fee));
}

function validateOtcForm(form: any, availableBalance: number) {
  const errors: Record<string, string> = {};
  const validDirection =
    (form.sell_asset === 'USD' && form.buy_asset === 'USDT') ||
    (form.sell_asset === 'USDT' && form.buy_asset === 'USD');
  if (!validDirection) {
    errors.sell_amount = portalText('仅支持 USD → USDT 或 USDT → USD');
  }

  const sellDecimals = form.sell_asset === 'USD' ? 2 : 6;
  if (!isPositiveDecimal(form.sell_amount, sellDecimals)) {
    errors.sell_amount = portalText('请输入大于 0 的金额，最多 {{decimals}} 位小数', {
      decimals: sellDecimals,
    });
  } else if (Number(form.sell_amount) > availableBalance) {
    errors.sell_amount = portalText('超过当前可用余额 {{amount}} {{asset}}', {
      amount: formatBalance(availableBalance),
      asset: form.sell_asset,
    });
  }

  const buyDecimals = form.buy_asset === 'USD' ? 2 : 6;
  if (!isPositiveDecimal(form.buy_amount, buyDecimals)) {
    errors.buy_amount = portalText('请输入大于 0 的买入总额，最多 {{decimals}} 位小数', {
      decimals: buyDecimals,
    });
  } else {
    const expectedBuyAmount = calculateOtcBuyAmount(
      form.sell_amount,
      form.exchange_rate,
      form.buy_asset
    );
    if (
      expectedBuyAmount &&
      decimalToMinor(form.buy_amount, buyDecimals) !==
        decimalToMinor(expectedBuyAmount, buyDecimals)
    ) {
      errors.buy_amount = portalText('买入总额应为 {{amount}} {{asset}}（卖出金额 × 成交汇率）', {
        amount: expectedBuyAmount,
        asset: form.buy_asset,
      });
    }
  }
  if (!isPositiveDecimal(form.exchange_rate, 8)) {
    errors.exchange_rate = portalText('请输入大于 0 的成交汇率，最多 8 位小数');
  }

  const supportedNetworks = CHAIN_OPTIONS.map((chain) => chain.value as string);
  if (form.sell_asset === 'USDT' && !supportedNetworks.includes(form.sell_network)) {
    errors.sell_network = portalText('请选择卖出 USDT 所在网络');
  }
  if (form.buy_asset === 'USDT' && !supportedNetworks.includes(form.buy_network)) {
    errors.buy_network = portalText('请选择买入 USDT 的入账网络');
  }
  return errors;
}

function calculateOtcBuyAmount(sellAmount: string, exchangeRate: string, buyAsset: string) {
  const sellDecimals = buyAsset === 'USD' ? 6 : 2;
  const decimals = buyAsset === 'USD' ? 2 : 6;
  const sellMinor = decimalToMinor(sellAmount, sellDecimals);
  const rate = decimalParts(exchangeRate);
  if (sellMinor === null || sellMinor <= BigInt(0) || !rate || rate.numerator <= BigInt(0)) {
    return '';
  }
  const numerator = sellMinor * rate.numerator * powerOfTen(decimals);
  const denominator = powerOfTen(sellDecimals + rate.scale);
  const quotient = numerator / denominator;
  const remainder = numerator % denominator;
  const rounded = quotient + (remainder * BigInt(2) >= denominator ? BigInt(1) : BigInt(0));
  return minorToDecimal(rounded, decimals);
}

function isPositiveDecimal(value: string, decimals: number) {
  const pattern = new RegExp(`^\\d+(?:\\.\\d{1,${decimals}})?$`);
  return pattern.test(value || '') && Number(value) > 0;
}

function validateWithdrawalForm(
  kind: 'fiat' | 'crypto',
  form: any,
  availableBalance: number,
  asset: string,
  feeAmount: number
) {
  const errors: Record<string, string> = {};
  if (!/^\d+(\.\d+)?$/.test(form.amount || '') || Number(form.amount) <= 0) {
    errors.amount = portalText('请输入大于 0 的有效金额');
  } else if (Number(form.amount) <= feeAmount) {
    errors.amount = portalText('转出金额必须高于固定手续费 {{amount}} {{asset}}', {
      amount: formatBalance(feeAmount),
      asset,
    });
  } else if (Number(form.amount) > availableBalance) {
    errors.amount = portalText('超过可用余额 {{amount}} {{asset}}', {
      amount: formatBalance(availableBalance),
      asset,
    });
  }
  if (kind === 'fiat') {
    if (!form.beneficiary_name?.trim()) {
      errors.beneficiary_name = portalText('请输入收款人名称');
    }
    if (!form.beneficiary_address?.trim()) {
      errors.beneficiary_address = portalText('请输入收款人地址');
    }
    if (!form.bank_name?.trim()) errors.bank_name = portalText('请输入银行名称');
    if (!form.bank_account_number?.trim()) {
      errors.bank_account_number = portalText('请输入银行账号或 IBAN');
    }
    if (!/^[A-Z0-9]{8}([A-Z0-9]{3})?$/.test(form.swift_bic || '')) {
      errors.swift_bic = portalText('请输入 8 或 11 位有效 SWIFT/BIC');
    }
  } else {
    if (!form.network?.trim()) errors.network = portalText('请选择转账网络');
    if (!isValidChainAddress(form.network, form.destination)) {
      errors.destination = portalText('请输入有效的 {{network}} 钱包地址', {
        network: chainDisplayName(form.network),
      });
    }
  }
  return errors;
}

function formatAmount(value: unknown, asset?: string) {
  const numericValue = Number(value ?? 0);
  if (!Number.isFinite(numericValue)) return String(value ?? '0');
  return numericValue.toLocaleString(portalLocale(), {
    minimumFractionDigits: 0,
    maximumFractionDigits: asset === 'USD' ? 2 : 6,
  });
}

function formatBalance(value: number) {
  if (!Number.isFinite(value)) return '0.00';
  return value.toLocaleString(portalLocale(), {
    minimumFractionDigits: 2,
    maximumFractionDigits: 6,
  });
}

function chainDisplayName(network: string) {
  const chain = CHAIN_OPTIONS.find((item) => item.value === network);
  return chain ? `${chain.label} (${chain.standard})` : network || portalText('所选网络');
}

function isValidChainAddress(network: string, destination: string) {
  const address = destination?.trim() || '';
  if (network === 'TRON') return /^T[1-9A-HJ-NP-Za-km-z]{33}$/.test(address);
  if (network === 'ETHEREUM' || network === 'BSC') {
    return /^0x[a-fA-F0-9]{40}$/.test(address);
  }
  if (network === 'SOLANA') return /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(address);
  return address.length >= 8;
}

function addAmounts(left: string, right: string) {
  const total = Number(left || 0) + Number(right || 0);
  return Number.isFinite(total) ? Number(total.toFixed(8)).toString() : '-';
}

function dateParam(value: Date) {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, '0');
  const day = String(value.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function otcFeeAmount(value: string, asset: string) {
  const decimals = asset === 'USD' ? 2 : 6;
  const buyMinor = decimalToMinor(value, decimals);
  if (buyMinor === null || buyMinor <= BigInt(0)) return '0';
  return minorToDecimal((buyMinor * BigInt(50)) / BigInt(10000), decimals);
}

function otcNetAmount(value: string, asset: string) {
  const decimals = asset === 'USD' ? 2 : 6;
  const buyMinor = decimalToMinor(value, decimals);
  if (buyMinor === null || buyMinor <= BigInt(0)) return '0';
  const feeMinor = (buyMinor * BigInt(50)) / BigInt(10000);
  return minorToDecimal(buyMinor - feeMinor, decimals);
}

function decimalParts(value: string) {
  const input = value.trim();
  if (!/^\d+(?:\.\d+)?$/.test(input)) return null;
  const [whole, fraction = ''] = input.split('.');
  return {
    numerator: BigInt(`${whole}${fraction}`),
    scale: fraction.length,
  };
}

function decimalToMinor(value: string, decimals: number) {
  const input = value.trim();
  if (!/^\d+(?:\.\d+)?$/.test(input)) return null;
  const [whole, fraction = ''] = input.split('.');
  if (fraction.length > decimals) return null;
  return (
    BigInt(whole) * powerOfTen(decimals) + BigInt((fraction || '').padEnd(decimals, '0') || '0')
  );
}

function minorToDecimal(value: bigint, decimals: number) {
  const scale = powerOfTen(decimals);
  const whole = value / scale;
  const fraction = (value % scale).toString().padStart(decimals, '0').replace(/0+$/, '');
  return fraction ? `${whole.toString()}.${fraction}` : whole.toString();
}

function powerOfTen(exponent: number) {
  let value = BigInt(1);
  for (let index = 0; index < exponent; index += 1) value *= BigInt(10);
  return value;
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

function applicationStatusLabel(value: string) {
  const copy: Record<string, string> = {
    submitted: '已提交',
    kyc_link_ready: '待完成 KYC',
    kyc_approved: 'KYC 已通过',
    va_processing: 'VA 开通中',
    active: '已开通',
    changes_requested: '已驳回 · 待补正',
    processing: '处理中',
    completed: '已完成',
    rejected: '已拒绝',
    cancelled: '已取消',
  };
  return copy[value] ? portalText(copy[value]) : value;
}

function Status({ value }: { value: string }) {
  let color: 'success' | 'error' | 'warning' = 'warning';
  if (value === 'active' || value === 'completed') color = 'success';
  if (value === 'rejected' || value === 'cancelled') color = 'error';
  if (value === 'changes_requested') color = 'error';
  return <Label color={color}>{applicationStatusLabel(value)}</Label>;
}
