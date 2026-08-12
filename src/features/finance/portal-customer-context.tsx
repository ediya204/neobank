import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { coreApi, Customer, demoOrganizationId, Operation } from './core-api';

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
const STORAGE_KEY = 'moventra.portal.demo-customer';

export function PortalCustomerProvider({ children }: { children: React.ReactNode }) {
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
      const rows = await coreApi<Customer[]>(`/customers?organizationId=${demoOrganizationId}`);
      const active = rows.filter((row) => row.status === 'ACTIVE');
      setCustomers(active);
      const resolvedId = active.some((row) => row.id === customerId)
        ? customerId
        : active.find((row) => row.id === 'cus_demo_business')?.id || active[0]?.id || '';
      if (resolvedId !== customerId) setCustomerId(resolvedId);
      const operationRows = await coreApi<Operation[]>(
        `/operations?organizationId=${demoOrganizationId}`
      );
      setOperations(operationRows.filter((row) => row.customerId === resolvedId));
    } catch (value) {
      setError(value instanceof Error ? value.message : '账户数据加载失败');
    } finally {
      setLoading(false);
    }
  }, [customerId]);

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
