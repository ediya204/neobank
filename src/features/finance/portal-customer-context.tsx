import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useAuthContext } from 'src/auth/hooks';
import {
  AssetSummary,
  coreApi,
  Currency,
  Customer,
  demoOrganizationId,
  isSupportedPortalAccount,
  Operation,
} from './core-api';
import {
  buildAssetSummaryFromLastKnownRates,
  resolveAssetSummaryRates,
} from './asset-summary-rates';
import { activeCustomerWalletAccounts, CustomerWalletRow } from './customer-wallet';

type PortalCustomerContextValue = {
  customers: Customer[];
  customer: Customer | null;
  operations: Operation[];
  assetSummary: AssetSummary | null;
  assetSummaryUsesCachedRates: boolean;
  assetSummaryRateCurrencies: Currency[];
  backendStarting: boolean;
  loading: boolean;
  error: string;
  selectCustomer: (id: string) => void;
  refresh: () => Promise<void>;
};

const PortalCustomerContext = createContext<PortalCustomerContextValue | null>(null);
const STORAGE_KEY = 'ssc-digital-bank.portal.demo-customer';

type CustomerHomeBootstrap = {
  profile: {
    id: string;
    email: string;
    display_name: string;
    status: string;
  };
  customer: Customer;
  operations: Operation[];
  wallets: CustomerWalletRow[];
  assetSummary: AssetSummary;
};

export function PortalCustomerProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuthContext();
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [customerId, setCustomerId] = useState(
    () => localStorage.getItem(STORAGE_KEY) || 'cus_demo_business'
  );
  const [operations, setOperations] = useState<Operation[]>([]);
  const [assetSummary, setAssetSummary] = useState<AssetSummary | null>(null);
  const [assetSummaryUsesCachedRates, setAssetSummaryUsesCachedRates] = useState(false);
  const [assetSummaryRateCurrencies, setAssetSummaryRateCurrencies] = useState<Currency[]>([]);
  const latestCustomerRef = useRef<Customer | null>(null);
  const [backendStarting, setBackendStarting] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const refresh = useCallback(async () => {
    let startupNoticeTimer: number | undefined;
    setLoading(true);
    setError('');
    setBackendStarting(false);
    try {
      if (user?.role === 'customer') {
        startupNoticeTimer = window.setTimeout(() => setBackendStarting(true), 1_500);
        const home = await coreApi<CustomerHomeBootstrap>('/customer/home', {
          onTransientRetry: () => setBackendStarting(true),
        });
        if (!Number.isFinite(Number(home.assetSummary.totalBalance))) {
          throw new Error('资产估值数据格式无效');
        }
        const { profile } = home;
        const self: Customer = {
          id: profile.id,
          organizationId: demoOrganizationId,
          type: 'INDIVIDUAL',
          status: profile.status.toUpperCase(),
          kycStatus: 'APPROVED',
          displayName: profile.display_name,
          legalName: profile.display_name,
          email: profile.email,
          countryCode: '',
          accounts: [],
        };
        const customerWalletAccounts = activeCustomerWalletAccounts(home.wallets);
        const resolvedCustomer = home.customer
          ? {
              ...home.customer,
              accounts: [
                ...home.customer.accounts.filter(
                  (row) => row.kind !== 'CRYPTO_WALLET' && isSupportedPortalAccount(row)
                ),
                ...customerWalletAccounts,
              ],
            }
          : { ...self, accounts: customerWalletAccounts };
        const resolvedOperations = home.operations
          .filter((row) => !(row.type === 'PAYOUT' && row.currency === 'USDT'))
          .slice(0, 5);
        setCustomers([resolvedCustomer]);
        latestCustomerRef.current = resolvedCustomer;
        setCustomerId(self.id);
        setOperations(resolvedOperations);
        const resolvedSummary = resolveAssetSummaryRates(home.assetSummary);
        setAssetSummary(resolvedSummary.summary);
        setAssetSummaryUsesCachedRates(resolvedSummary.lastKnownCurrencies.length > 0);
        setAssetSummaryRateCurrencies(resolvedSummary.lastKnownCurrencies);
        return;
      }
      setAssetSummary(null);
      setAssetSummaryUsesCachedRates(false);
      setAssetSummaryRateCurrencies([]);
      const rows = await coreApi<Customer[]>(`/customers?organizationId=${demoOrganizationId}`);
      const active = rows
        .filter((row) => row.status === 'ACTIVE')
        .map((row) => ({
          ...row,
          accounts: row.accounts.filter(isSupportedPortalAccount),
        }));
      setCustomers(active);
      const resolvedId = active.some((row) => row.id === customerId)
        ? customerId
        : active.find((row) => row.id === 'cus_demo_business')?.id || active[0]?.id || '';
      if (resolvedId !== customerId) setCustomerId(resolvedId);
      latestCustomerRef.current = active.find((row) => row.id === resolvedId) || active[0] || null;
      const operationRows = await coreApi<Operation[]>(
        `/operations?organizationId=${demoOrganizationId}`
      );
      setOperations(
        operationRows.filter(
          (row) =>
            row.customerId === resolvedId && !(row.type === 'PAYOUT' && row.currency === 'USDT')
        )
      );
    } catch {
      const fallback =
        user?.role === 'customer' && latestCustomerRef.current
          ? buildAssetSummaryFromLastKnownRates(
              latestCustomerRef.current.id,
              latestCustomerRef.current.accounts
            )
          : null;
      setAssetSummary(fallback?.summary || null);
      setAssetSummaryUsesCachedRates(Boolean(fallback));
      setAssetSummaryRateCurrencies(fallback?.lastKnownCurrencies || []);
      // Core and edge error codes are operational details. Keep them out of
      // customer-facing alerts while preserving a clear recovery action.
      setError('账户资料暂时不可用，请稍后刷新。');
    } finally {
      if (startupNoticeTimer !== undefined) window.clearTimeout(startupNoticeTimer);
      setBackendStarting(false);
      setLoading(false);
    }
  }, [customerId, user?.role]);

  useEffect(() => {
    refresh().catch(() => undefined);
  }, [refresh]);

  const selectCustomer = useCallback((id: string) => {
    localStorage.setItem(STORAGE_KEY, id);
    setCustomerId(id);
  }, []);

  const value = useMemo(
    () => ({
      customers,
      customer: customers.find((row) => row.id === customerId) || customers[0] || null,
      operations,
      assetSummary,
      assetSummaryUsesCachedRates,
      assetSummaryRateCurrencies,
      backendStarting,
      loading,
      error,
      selectCustomer,
      refresh,
    }),
    [
      assetSummary,
      assetSummaryRateCurrencies,
      assetSummaryUsesCachedRates,
      backendStarting,
      customerId,
      customers,
      error,
      loading,
      operations,
      refresh,
      selectCustomer,
    ]
  );

  return <PortalCustomerContext.Provider value={value}>{children}</PortalCustomerContext.Provider>;
}

export function usePortalCustomer() {
  const value = useContext(PortalCustomerContext);
  if (!value) throw new Error('usePortalCustomer must be used inside PortalCustomerProvider');
  return value;
}
