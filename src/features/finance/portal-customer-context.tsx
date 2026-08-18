import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { useAuthContext } from 'src/auth/hooks';
import {
  coreApi,
  Customer,
  demoOrganizationId,
  isSupportedPortalAccount,
  neobankApi,
  Operation,
} from './core-api';

type PortalCustomerContextValue = {
  customers: Customer[];
  customer: Customer | null;
  operations: Operation[];
  loading: boolean;
  error: string;
  selectCustomer: (id: string) => void;
  refresh: () => Promise<void>;
};

const PortalCustomerContext = createContext<PortalCustomerContextValue | null>(null);
const STORAGE_KEY = 'ssc-digital-bank.portal.demo-customer';

export function PortalCustomerProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuthContext();
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [customerId, setCustomerId] = useState(
    () => localStorage.getItem(STORAGE_KEY) || 'cus_demo_business'
  );
  const [operations, setOperations] = useState<Operation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const refresh = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      if (user?.role === 'customer') {
        const profile = await neobankApi<{
          id: string;
          email: string;
          display_name: string;
          status: string;
        }>('/customer/profile');
        const self: Customer = {
          id: profile.id,
          organizationId: 'self',
          type: 'INDIVIDUAL',
          status: profile.status.toUpperCase(),
          kycStatus: 'APPROVED',
          displayName: profile.display_name,
          legalName: profile.display_name,
          email: profile.email,
          countryCode: '',
          accounts: [],
        };
        setCustomers([self]);
        setCustomerId(self.id);
        setOperations([]);
        return;
      }
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
      setError(value instanceof Error ? value.message : '账户数据加载失败');
    } finally {
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
      loading,
      error,
      selectCustomer,
      refresh,
    }),
    [customerId, customers, error, loading, operations, refresh, selectCustomer]
  );

  return <PortalCustomerContext.Provider value={value}>{children}</PortalCustomerContext.Provider>;
}

export function usePortalCustomer() {
  const value = useContext(PortalCustomerContext);
  if (!value) throw new Error('usePortalCustomer must be used inside PortalCustomerProvider');
  return value;
}
