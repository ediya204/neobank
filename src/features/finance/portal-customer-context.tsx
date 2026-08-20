import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { useAuthContext } from 'src/auth/hooks';
import {
  AssetSummary,
  coreApi,
  Customer,
  demoOrganizationId,
  isSupportedPortalAccount,
  Operation,
} from './core-api';
import { activeCustomerWalletAccounts, CustomerWalletRow } from './customer-wallet';

type PortalCustomerContextValue = {
  customers: Customer[];
  customer: Customer | null;
  operations: Operation[];
  assetSummary: AssetSummary | null;
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
        setCustomerId(self.id);
        setOperations(resolvedOperations);
        setAssetSummary(home.assetSummary);
        return;
      }
      setAssetSummary(null);
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
      const operationRows = await coreApi<Operation[]>(
        `/operations?organizationId=${demoOrganizationId}`
      );
      setOperations(
        operationRows.filter(
          (row) =>
            row.customerId === resolvedId && !(row.type === 'PAYOUT' && row.currency === 'USDT')
        )
      );
    } catch (value) {
      setAssetSummary(null);
      setError(value instanceof Error ? value.message : '账户数据加载失败');
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
      backendStarting,
      loading,
      error,
      selectCustomer,
      refresh,
    }),
    [
      assetSummary,
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
