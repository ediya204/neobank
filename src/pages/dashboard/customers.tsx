import { useCallback, useEffect, useMemo, useState } from 'react';
import { Helmet } from 'react-helmet-async';
import { useNavigate, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  Alert,
  Box,
  Button,
  Card,
  CircularProgress,
  Container,
  Divider,
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
import { DataGrid, GridColDef } from '@mui/x-data-grid';
import Iconify from 'src/components/iconify';
import Label from 'src/components/label';
import { useSettingsContext } from 'src/components/settings';
import { getLocalizedApiError } from 'src/locales/api-error';
import { browserApiFetch } from 'src/utils/browser-api';
import { CRYPTO_NETWORK_OPTIONS, USD_ASSET_ICON } from 'src/utils/asset-icons';

type VaAccount = {
  account_name: string;
  account_number: string;
  iban: string | null;
  currency: string;
  swift_bic: string;
  bank_name: string;
  bank_address: string;
};

type Balance = {
  asset: string;
  network: string | null;
  ledger_balance: string;
  reserved: string;
  available_balance: string;
  balance?: string;
  asset_decimals: number;
};

type Customer = {
  application_id: string;
  partner_customer_id: string | null;
  customer_name: string;
  phone_country_code: string;
  phone_number: string;
  email: string;
  status: string;
  kyc_url: string | null;
  va_account: VaAccount | null;
  balances: Balance[];
  created_at: string;
  updated_at: string;
};

type FundTransaction = {
  id: string;
  application_id: string;
  type: string;
  asset: string;
  amount: string;
  fee_amount: string;
  net_amount: string;
  network: string | null;
  destination: string | null;
  transaction_reference: string | null;
  external_reference: string | null;
  beneficiary_name: string | null;
  bank_name: string | null;
  status: string;
  note: string | null;
  created_at: string;
};

type OtcOrder = {
  id: string;
  application_id: string;
  sell_asset: string;
  sell_network: string | null;
  sell_amount: string;
  buy_asset: string;
  buy_network: string | null;
  buy_amount: string;
  fee_amount: string;
  net_buy_amount: string;
  exchange_rate: string;
  status: string;
  note: string | null;
  created_at: string;
};

type CustomerDetails = {
  customer: Customer;
  balances: Balance[];
  fund_transactions: FundTransaction[];
  otc_orders: OtcOrder[];
};

type ApiEnvelope<T> = {
  data: T;
  meta?: {
    count?: number;
    total?: number;
  };
};

const CHAINS = CRYPTO_NETWORK_OPTIONS;

async function apiGet<T>(path: string, errorMessage: string, signal?: AbortSignal): Promise<T> {
  let response: Response;
  try {
    response = await browserApiFetch(`/api/browser/v1/admin${path}`, {
      credentials: 'same-origin',
      headers: { 'content-type': 'application/json' },
      signal,
    });
  } catch (caught) {
    if (caught instanceof DOMException && caught.name === 'AbortError') throw caught;
    throw new Error(errorMessage);
  }
  let body: T & { error?: { code?: string; message?: string } };
  try {
    body = (await response.json()) as T & {
      error?: { code?: string; message?: string };
    };
  } catch {
    throw new Error(errorMessage);
  }
  if (!response.ok) throw new Error(getLocalizedApiError(body, errorMessage));
  return body;
}

function unwrap<T>(value: T | ApiEnvelope<T>): T {
  if (typeof value === 'object' && value !== null && 'data' in value) {
    return (value as ApiEnvelope<T>).data;
  }
  return value;
}

function localeForLanguage(language: string) {
  return language === 'cn' || language.startsWith('zh') ? 'zh-CN' : 'en-US';
}

function formatAmount(
  value: string | number | null | undefined,
  locale: string,
  maximumFractionDigits = 6
) {
  const amount = Number(value || 0);
  if (!Number.isFinite(amount)) return '0';
  return amount.toLocaleString(locale, { maximumFractionDigits });
}

function formatDate(value: string, locale: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '-';
  return new Intl.DateTimeFormat(locale, {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

function applicationStatusColor(status: string): 'success' | 'warning' | 'info' | 'default' {
  if (status === 'active') return 'success';
  if (status === 'kyc_link_ready' || status === 'kyc_approved') return 'info';
  if (status === 'submitted' || status === 'va_processing') return 'warning';
  return 'default';
}

function transactionStatusColor(status: string): 'success' | 'warning' | 'error' | 'default' {
  if (status === 'completed') return 'success';
  if (status === 'submitted' || status === 'processing') return 'warning';
  if (status === 'rejected') return 'error';
  return 'default';
}

function availableBalance(balances: Balance[], asset: string, network: string | null = null) {
  return (
    balances.find(
      (balance) =>
        balance.asset === asset && (network ? balance.network === network : !balance.network)
    )?.available_balance || '0'
  );
}

export default function AdminCustomersPage() {
  const { id = '' } = useParams();
  return id ? <CustomerDetailsPage customerId={id} /> : <CustomerListPage />;
}

function CustomerListPage() {
  const { t, i18n } = useTranslation('admin');
  const locale = localeForLanguage(i18n.resolvedLanguage || i18n.language);
  const settings = useSettingsContext();
  const navigate = useNavigate();
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState('all');
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');

  const load = useCallback(
    async (signal?: AbortSignal) => {
      setLoading(true);
      setLoadError('');
      try {
        const response = await apiGet<ApiEnvelope<Customer[]>>(
          '/customers',
          t('customers.errors.listRead'),
          signal
        );
        setCustomers(response.data || []);
      } catch (caught) {
        if (caught instanceof DOMException && caught.name === 'AbortError') return;
        setLoadError(caught instanceof Error ? caught.message : t('customers.errors.listRead'));
      } finally {
        if (!signal?.aborted) setLoading(false);
      }
    },
    [t]
  );

  useEffect(() => {
    const controller = new AbortController();
    load(controller.signal);
    return () => controller.abort();
  }, [load]);

  const filteredCustomers = useMemo(() => {
    const keyword = query.trim().toLowerCase();
    return customers.filter((customer) => {
      const matchesStatus = status === 'all' || customer.status === status;
      const matchesQuery =
        !keyword ||
        [
          customer.customer_name,
          customer.application_id,
          customer.email,
          `${customer.phone_country_code}${customer.phone_number}`,
          customer.va_account?.account_number || '',
        ].some((value) => value.toLowerCase().includes(keyword));
      return matchesStatus && matchesQuery;
    });
  }, [customers, query, status]);

  const columns = useMemo<GridColDef<Customer>[]>(
    () => [
      {
        field: 'customer_name',
        headerName: t('common.customer'),
        minWidth: 210,
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
        field: 'contact',
        headerName: t('common.contact'),
        minWidth: 230,
        flex: 1,
        sortable: false,
        renderCell: (params) => (
          <Box sx={{ py: 1, minWidth: 0, width: '100%', overflow: 'hidden' }}>
            <Typography variant="body2" noWrap title={params.row.email}>
              {params.row.email}
            </Typography>
            <Typography
              variant="caption"
              color="text.secondary"
              noWrap
              title={`${params.row.phone_country_code} ${params.row.phone_number}`}
              sx={{ display: 'block' }}
            >
              {params.row.phone_country_code} {params.row.phone_number}
            </Typography>
          </Box>
        ),
      },
      {
        field: 'status',
        headerName: t('customers.columns.onboardingStatus'),
        minWidth: 130,
        renderCell: (params) => (
          <Label color={applicationStatusColor(params.row.status)}>
            {t(`status.application.${params.row.status}`, {
              defaultValue: params.row.status,
            })}
          </Label>
        ),
      },
      {
        field: 'va_account',
        headerName: t('common.vaAccount'),
        minWidth: 210,
        flex: 1,
        sortable: false,
        renderCell: (params) =>
          params.row.va_account ? (
            <Box sx={{ py: 1, minWidth: 0, width: '100%', overflow: 'hidden' }}>
              <Typography variant="body2" noWrap title={params.row.va_account.account_number}>
                {params.row.va_account.account_number}
              </Typography>
              <Typography
                variant="caption"
                color="text.secondary"
                noWrap
                title={params.row.va_account.bank_name}
                sx={{ display: 'block' }}
              >
                {params.row.va_account.bank_name}
              </Typography>
            </Box>
          ) : (
            <Typography variant="body2" color="text.secondary">
              {t('customers.notOpened')}
            </Typography>
          ),
      },
      {
        field: 'usd_balance',
        headerName: t('customers.columns.usdAvailable'),
        minWidth: 125,
        sortable: false,
        renderCell: (params) => (
          <Typography variant="subtitle2">
            {formatAmount(availableBalance(params.row.balances || [], 'USD'), locale, 2)}
          </Typography>
        ),
      },
      {
        field: 'usdt_balance',
        headerName: t('customers.columns.usdtByNetwork'),
        minWidth: 250,
        flex: 1.2,
        sortable: false,
        renderCell: (params) => (
          <Stack direction="row" spacing={0.75} useFlexGap flexWrap="wrap" sx={{ py: 1 }}>
            {CHAINS.map((chain) => {
              const amount = availableBalance(params.row.balances || [], 'USDT', chain.value);
              return (
                <Stack
                  key={chain.value}
                  direction="row"
                  alignItems="center"
                  spacing={0.5}
                  sx={{
                    px: 0.75,
                    py: 0.5,
                    borderRadius: 1,
                    bgcolor: 'background.neutral',
                  }}
                >
                  <Iconify icon={chain.icon} width={16} />
                  <Typography variant="caption">{formatAmount(amount, locale)}</Typography>
                </Stack>
              );
            })}
          </Stack>
        ),
      },
      {
        field: 'updated_at',
        headerName: t('common.lastUpdated'),
        width: 155,
        renderCell: (params) => formatDate(params.row.updated_at, locale),
      },
      {
        field: 'actions',
        headerName: t('common.actions'),
        width: 90,
        sortable: false,
        filterable: false,
        renderCell: (params) => (
          <Button
            size="small"
            onClick={(event) => {
              event.stopPropagation();
              navigate(`/dashboard/customers/${params.row.application_id}`);
            }}
          >
            {t('common.view')}
          </Button>
        ),
      },
    ],
    [locale, navigate, t]
  );

  return (
    <>
      <Helmet>
        <title>{t('customers.pageTitle')} | SCC Digital Bank</title>
      </Helmet>
      <Container maxWidth={settings.themeStretch ? false : 'xl'}>
        <Stack
          direction={{ xs: 'column', sm: 'row' }}
          alignItems={{ sm: 'center' }}
          justifyContent="space-between"
          spacing={2}
          sx={{ mb: 4 }}
        >
          <Box>
            <Typography variant="h4">{t('customers.title')}</Typography>
            <Typography color="text.secondary" sx={{ mt: 0.5 }}>
              {t('customers.description')}
            </Typography>
          </Box>
          <Stack direction="row" spacing={1}>
            <Button
              color="inherit"
              startIcon={<Iconify icon="solar:refresh-linear" />}
              disabled={loading}
              onClick={() => load()}
            >
              {t('common.refresh')}
            </Button>
            <Button
              variant="contained"
              startIcon={<Iconify icon="solar:user-plus-bold-duotone" />}
              onClick={() => navigate('/dashboard/va-applications/new')}
            >
              {t('customers.newApplication')}
            </Button>
          </Stack>
        </Stack>

        {loadError && (
          <Alert
            severity="error"
            sx={{ mb: 3 }}
            action={
              <Button color="inherit" size="small" onClick={() => load()}>
                {t('common.retry')}
              </Button>
            }
          >
            {t('customers.errors.listReadDetail', { error: loadError })}
          </Alert>
        )}

        <Card>
          <Stack direction={{ xs: 'column', md: 'row' }} spacing={2} sx={{ p: 2.5 }}>
            <TextField
              fullWidth
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={t('customers.searchPlaceholder')}
              InputProps={{
                startAdornment: (
                  <InputAdornment position="start">
                    <Iconify icon="solar:magnifier-linear" sx={{ color: 'text.disabled' }} />
                  </InputAdornment>
                ),
              }}
            />
            <TextField
              select
              label={t('customers.filters.onboardingStatus')}
              value={status}
              onChange={(event) => setStatus(event.target.value)}
              sx={{ minWidth: 190 }}
            >
              <MenuItem value="all">{t('common.allStatuses')}</MenuItem>
              {['submitted', 'kyc_link_ready', 'kyc_approved', 'va_processing', 'active'].map(
                (value) => (
                  <MenuItem key={value} value={value}>
                    {t(`status.application.${value}`)}
                  </MenuItem>
                )
              )}
            </TextField>
          </Stack>
          <Divider />

          <DataGrid
            autoHeight
            rows={filteredCustomers}
            columns={columns}
            loading={loading}
            getRowId={(row) => row.application_id}
            getRowHeight={() => 'auto'}
            disableRowSelectionOnClick
            onRowClick={(params) => navigate(`/dashboard/customers/${params.row.application_id}`)}
            pageSizeOptions={[10, 25, 50]}
            initialState={{
              pagination: { paginationModel: { page: 0, pageSize: 25 } },
            }}
            localeText={{
              noRowsLabel: loadError ? t('customers.errors.listRead') : t('customers.empty'),
            }}
            sx={{
              border: 0,
              minHeight: 360,
              '& .MuiDataGrid-cell': {
                py: 1,
                minWidth: 0,
                overflow: 'hidden',
                alignItems: 'center',
              },
              '& .MuiDataGrid-row': { cursor: 'pointer' },
            }}
          />
        </Card>
      </Container>
    </>
  );
}

function CustomerDetailsPage({ customerId }: { customerId: string }) {
  const { t, i18n } = useTranslation('admin');
  const locale = localeForLanguage(i18n.resolvedLanguage || i18n.language);
  const settings = useSettingsContext();
  const navigate = useNavigate();
  const [details, setDetails] = useState<CustomerDetails | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');

  const load = useCallback(
    async (signal?: AbortSignal) => {
      setLoading(true);
      setLoadError('');
      try {
        const response = await apiGet<CustomerDetails | ApiEnvelope<CustomerDetails>>(
          `/customers/${encodeURIComponent(customerId)}`,
          t('customers.errors.detailsRead'),
          signal
        );
        setDetails(unwrap(response));
      } catch (caught) {
        if (caught instanceof DOMException && caught.name === 'AbortError') return;
        setDetails(null);
        setLoadError(caught instanceof Error ? caught.message : t('customers.errors.detailsRead'));
      } finally {
        if (!signal?.aborted) setLoading(false);
      }
    },
    [customerId, t]
  );

  useEffect(() => {
    const controller = new AbortController();
    load(controller.signal);
    return () => controller.abort();
  }, [load]);

  if (loading && !details) {
    return (
      <Container maxWidth={settings.themeStretch ? false : 'xl'}>
        <Stack alignItems="center" spacing={2} sx={{ py: 14 }}>
          <CircularProgress />
          <Typography color="text.secondary">{t('customers.details.loading')}</Typography>
        </Stack>
      </Container>
    );
  }

  if (loadError || !details) {
    return (
      <Container maxWidth={settings.themeStretch ? false : 'xl'}>
        <Button
          color="inherit"
          startIcon={<Iconify icon="solar:alt-arrow-left-linear" />}
          onClick={() => navigate('/dashboard/customers')}
          sx={{ mb: 3 }}
        >
          {t('customers.details.back')}
        </Button>
        <Alert
          severity="error"
          action={
            <Button color="inherit" size="small" onClick={() => load()}>
              {t('common.retry')}
            </Button>
          }
        >
          {t('customers.errors.detailsReadDetail', {
            error: loadError || t('customers.errors.notFound'),
          })}
        </Alert>
      </Container>
    );
  }

  const { customer } = details;
  const balances = details.balances || customer.balances || [];
  const isActive = customer.status === 'active';
  const operationQuery = `?application_id=${encodeURIComponent(customer.application_id)}`;

  return (
    <>
      <Helmet>
        <title>
          {t('customers.details.documentTitle', { name: customer.customer_name })} | SCC Digital Bank
        </title>
      </Helmet>
      <Container maxWidth={settings.themeStretch ? false : 'xl'}>
        <Stack
          direction={{ xs: 'column', md: 'row' }}
          alignItems={{ md: 'center' }}
          justifyContent="space-between"
          spacing={2}
          sx={{ mb: 4 }}
        >
          <Box>
            <Button
              color="inherit"
              startIcon={<Iconify icon="solar:alt-arrow-left-linear" />}
              onClick={() => navigate('/dashboard/customers')}
              sx={{ mb: 1 }}
            >
              {t('customers.details.back')}
            </Button>
            <Stack direction="row" alignItems="center" spacing={1.25}>
              <Typography variant="h4">{customer.customer_name}</Typography>
              <Label color={applicationStatusColor(customer.status)}>
                {t(`status.application.${customer.status}`, {
                  defaultValue: customer.status,
                })}
              </Label>
            </Stack>
            <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
              {customer.application_id}
            </Typography>
          </Box>
          <Stack direction="row" spacing={1} useFlexGap flexWrap="wrap">
            <Button
              color="inherit"
              startIcon={<Iconify icon="solar:pen-bold" />}
              onClick={() => navigate(`/dashboard/va-applications/${customer.application_id}`)}
            >
              {t('customers.details.manageOnboarding')}
            </Button>
            <Button
              variant="contained"
              disabled={!isActive}
              startIcon={<Iconify icon="solar:download-minimalistic-bold-duotone" />}
              onClick={() => navigate(`/dashboard/operations/deposits${operationQuery}`)}
            >
              {t('customers.details.recordDeposit')}
            </Button>
            <Button
              variant="outlined"
              disabled={!isActive}
              startIcon={<Iconify icon="solar:history-bold-duotone" />}
              onClick={() => navigate(`/dashboard/operations/transactions${operationQuery}`)}
            >
              {t('customers.details.reviewTransactions')}
            </Button>
            <Button
              variant="outlined"
              disabled={!isActive}
              startIcon={<Iconify icon="solar:transfer-horizontal-bold-duotone" />}
              onClick={() => navigate(`/dashboard/operations/otc${operationQuery}`)}
            >
              OTC
            </Button>
          </Stack>
        </Stack>

        {!isActive && (
          <Alert severity="info" sx={{ mb: 3 }}>
            {t('customers.details.inactiveNotice')}
          </Alert>
        )}

        <Box
          sx={{
            display: 'grid',
            gridTemplateColumns: { xs: '1fr', lg: 'minmax(0, 1fr) minmax(360px, 0.72fr)' },
            gap: 3,
            mb: 3,
          }}
        >
          <Card sx={{ p: 3 }}>
            <Typography variant="h6">{t('customers.details.profile.title')}</Typography>
            <Divider sx={{ my: 2.5 }} />
            <Box
              sx={{
                display: 'grid',
                gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, minmax(0, 1fr))' },
                gap: 2.5,
              }}
            >
              <Info label={t('common.customerName')} value={customer.customer_name} />
              <Info label={t('common.email')} value={customer.email} />
              <Info
                label={t('common.phoneNumber')}
                value={`${customer.phone_country_code} ${customer.phone_number}`}
              />
              <Info label={t('common.createdAt')} value={formatDate(customer.created_at, locale)} />
              <Info
                label={t('common.partnerCustomerId')}
                value={customer.partner_customer_id || '—'}
                fullWidth
              />
              <Info
                label={t('common.kycLink')}
                value={customer.kyc_url || t('customers.details.profile.awaitingKycLink')}
                fullWidth
              />
            </Box>
          </Card>

          <Card sx={{ p: 3 }}>
            <Typography variant="h6">{t('common.vaAccount')}</Typography>
            <Divider sx={{ my: 2.5 }} />
            {customer.va_account ? (
              <Box
                sx={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
                  gap: 2.25,
                }}
              >
                <Info label={t('common.accountName')} value={customer.va_account.account_name} />
                <Info
                  label={t('common.accountNumber')}
                  value={customer.va_account.account_number}
                />
                <Info label={t('common.iban')} value={customer.va_account.iban || '-'} />
                <Info label={t('common.currency')} value={customer.va_account.currency} />
                <Info label="SWIFT / BIC" value={customer.va_account.swift_bic} />
                <Info
                  label={t('common.bankName')}
                  value={customer.va_account.bank_name}
                  fullWidth
                />
                <Info
                  label={t('common.bankAddress')}
                  value={customer.va_account.bank_address}
                  fullWidth
                />
              </Box>
            ) : (
              <Box sx={{ py: 5, textAlign: 'center' }}>
                <Iconify
                  icon="solar:card-2-bold-duotone"
                  width={42}
                  sx={{ color: 'text.disabled', mb: 1 }}
                />
                <Typography color="text.secondary">
                  {t('customers.details.vaAccount.empty')}
                </Typography>
                <Button
                  sx={{ mt: 1.5 }}
                  onClick={() => navigate(`/dashboard/va-applications/${customer.application_id}`)}
                >
                  {t('customers.details.vaAccount.process')}
                </Button>
              </Box>
            )}
          </Card>
        </Box>

        <Card sx={{ p: 3, mb: 3 }}>
          <Stack
            direction={{ xs: 'column', sm: 'row' }}
            alignItems={{ sm: 'center' }}
            justifyContent="space-between"
            spacing={1}
            sx={{ mb: 2.5 }}
          >
            <Box>
              <Typography variant="h6">{t('customers.details.wallet.title')}</Typography>
              <Typography variant="body2" color="text.secondary">
                {t('customers.details.wallet.description')}
              </Typography>
            </Box>
            <Button
              color="inherit"
              startIcon={<Iconify icon="solar:refresh-linear" />}
              disabled={loading}
              onClick={() => load()}
            >
              {t('common.refresh')}
            </Button>
          </Stack>
          <BalanceCards balances={balances} />
        </Card>

        <Box
          sx={{
            display: 'grid',
            gridTemplateColumns: { xs: '1fr', xl: 'repeat(2, minmax(0, 1fr))' },
            gap: 3,
          }}
        >
          <Card>
            <Stack
              direction="row"
              justifyContent="space-between"
              alignItems="center"
              spacing={2}
              sx={{ p: 3 }}
            >
              <Box>
                <Typography variant="h6">{t('customers.details.recentFunds.title')}</Typography>
                <Typography variant="body2" color="text.secondary">
                  {t('customers.details.recentFunds.description')}
                </Typography>
              </Box>
              <Button
                onClick={() => navigate(`/dashboard/operations/transactions${operationQuery}`)}
              >
                {t('common.viewAll')}
              </Button>
            </Stack>
            <FundTable rows={details.fund_transactions.slice(0, 6)} />
          </Card>

          <Card>
            <Stack
              direction="row"
              justifyContent="space-between"
              alignItems="center"
              spacing={2}
              sx={{ p: 3 }}
            >
              <Box>
                <Typography variant="h6">{t('customers.details.recentOtc.title')}</Typography>
                <Typography variant="body2" color="text.secondary">
                  {t('customers.details.recentOtc.description')}
                </Typography>
              </Box>
              <Button onClick={() => navigate(`/dashboard/operations/otc${operationQuery}`)}>
                {t('common.viewAll')}
              </Button>
            </Stack>
            <OtcTable rows={details.otc_orders.slice(0, 6)} />
          </Card>
        </Box>
      </Container>
    </>
  );
}

function Info({
  label,
  value,
  fullWidth = false,
}: {
  label: string;
  value: string;
  fullWidth?: boolean;
}) {
  return (
    <Box sx={{ minWidth: 0, gridColumn: fullWidth ? '1 / -1' : undefined }}>
      <Typography variant="caption" color="text.secondary">
        {label}
      </Typography>
      <Typography
        variant="body2"
        sx={{ mt: 0.5, overflowWrap: 'anywhere', whiteSpace: 'pre-line' }}
      >
        {value}
      </Typography>
    </Box>
  );
}

function BalanceCards({ balances }: { balances: Balance[] }) {
  const { t, i18n } = useTranslation('admin');
  const locale = localeForLanguage(i18n.resolvedLanguage || i18n.language);
  const usd = balances.find((balance) => balance.asset === 'USD' && !balance.network);
  const cards = [
    {
      key: 'USD',
      title: 'USD',
      subtitle: t('navigation.fiatWallet'),
      icon: USD_ASSET_ICON,
      balance: usd,
      decimals: 2,
      color: 'info',
    },
    ...CHAINS.map((chain) => ({
      key: chain.value,
      title: chain.name,
      subtitle: `USDT · ${chain.standard}`,
      icon: chain.icon,
      balance: balances.find(
        (balance) => balance.asset === 'USDT' && balance.network === chain.value
      ),
      decimals: 6,
      color: 'success',
    })),
  ];

  return (
    <Box
      sx={{
        display: 'grid',
        gridTemplateColumns: {
          xs: '1fr',
          sm: 'repeat(2, minmax(0, 1fr))',
          lg: 'repeat(5, minmax(0, 1fr))',
        },
        gap: 1.5,
      }}
    >
      {cards.map((card) => (
        <Box
          key={card.key}
          sx={{
            p: 2,
            borderRadius: 2,
            border: '1px solid',
            borderColor: 'divider',
            bgcolor: 'background.neutral',
          }}
        >
          <Stack direction="row" alignItems="center" spacing={1}>
            <Box
              sx={{
                width: 36,
                height: 36,
                display: 'grid',
                placeItems: 'center',
                borderRadius: 1.25,
                bgcolor: `${card.color}.lighter`,
                color: `${card.color}.dark`,
              }}
            >
              <Iconify icon={card.icon} width={22} />
            </Box>
            <Box sx={{ minWidth: 0 }}>
              <Typography variant="subtitle2" noWrap>
                {card.title}
              </Typography>
              <Typography variant="caption" color="text.secondary" noWrap>
                {card.subtitle}
              </Typography>
            </Box>
          </Stack>
          <Typography variant="h5" sx={{ mt: 1.75 }}>
            {formatAmount(card.balance?.available_balance, locale, card.decimals)}
          </Typography>
          <Typography variant="caption" color="text.secondary">
            {t('common.availableBalance')}
          </Typography>
          <Divider sx={{ my: 1.5 }} />
          <Stack direction="row" justifyContent="space-between" spacing={1}>
            <Box>
              <Typography variant="caption" color="text.secondary">
                {t('common.ledger')}
              </Typography>
              <Typography variant="body2">
                {formatAmount(card.balance?.ledger_balance, locale, card.decimals)}
              </Typography>
            </Box>
            <Box sx={{ textAlign: 'right' }}>
              <Typography variant="caption" color="text.secondary">
                {t('common.reserved')}
              </Typography>
              <Typography variant="body2">
                {formatAmount(card.balance?.reserved, locale, card.decimals)}
              </Typography>
            </Box>
          </Stack>
        </Box>
      ))}
    </Box>
  );
}

function FundTable({ rows }: { rows: FundTransaction[] }) {
  const { t, i18n } = useTranslation('admin');
  const locale = localeForLanguage(i18n.resolvedLanguage || i18n.language);

  return (
    <TableContainer sx={{ overflowX: 'auto' }}>
      <Table sx={{ minWidth: 730 }}>
        <TableHead>
          <TableRow>
            <TableCell>{t('common.time')}</TableCell>
            <TableCell>{t('common.type')}</TableCell>
            <TableCell>{t('common.amount')}</TableCell>
            <TableCell>{t('customers.tables.networkOrDestination')}</TableCell>
            <TableCell>{t('common.status')}</TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {rows.map((row) => (
            <TableRow key={row.id} hover>
              <TableCell>{formatDate(row.created_at, locale)}</TableCell>
              <TableCell>
                <Typography variant="body2">
                  {t(`transaction.types.${row.type}`, { defaultValue: row.type })}
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  {row.id}
                </Typography>
              </TableCell>
              <TableCell>
                <Typography variant="subtitle2">
                  {formatAmount(row.amount, locale)} {row.asset}
                </Typography>
                {row.type.endsWith('_withdrawal') && (
                  <Typography variant="caption" color="text.secondary">
                    {t('customers.tables.feeAndNet', {
                      fee: formatAmount(row.fee_amount, locale),
                      net: formatAmount(row.net_amount, locale),
                    })}
                  </Typography>
                )}
              </TableCell>
              <TableCell>
                {row.network ? (
                  <ChainValue network={row.network} />
                ) : (
                  <Typography variant="body2">
                    {row.beneficiary_name || row.bank_name || t('customers.tables.fiatLedger')}
                  </Typography>
                )}
              </TableCell>
              <TableCell>
                <Label color={transactionStatusColor(row.status)}>
                  {t(`status.transaction.${row.status}`, { defaultValue: row.status })}
                </Label>
              </TableCell>
            </TableRow>
          ))}
          {!rows.length && (
            <TableRow>
              <TableCell colSpan={5} align="center" sx={{ py: 7 }}>
                <Typography color="text.secondary">{t('customers.tables.noFunds')}</Typography>
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
    </TableContainer>
  );
}

function OtcTable({ rows }: { rows: OtcOrder[] }) {
  const { t, i18n } = useTranslation('admin');
  const locale = localeForLanguage(i18n.resolvedLanguage || i18n.language);

  return (
    <TableContainer sx={{ overflowX: 'auto' }}>
      <Table sx={{ minWidth: 730 }}>
        <TableHead>
          <TableRow>
            <TableCell>{t('common.time')}</TableCell>
            <TableCell>{t('customers.tables.exchangeDirection')}</TableCell>
            <TableCell>{t('customers.tables.sell')}</TableCell>
            <TableCell>{t('customers.tables.netBuyAndFee')}</TableCell>
            <TableCell>{t('common.status')}</TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {rows.map((row) => (
            <TableRow key={row.id} hover>
              <TableCell>{formatDate(row.created_at, locale)}</TableCell>
              <TableCell>
                <Typography variant="body2">
                  {row.sell_asset} → {row.buy_asset}
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  {t('customers.tables.exchangeRate', {
                    rate: formatAmount(row.exchange_rate, locale),
                  })}
                </Typography>
              </TableCell>
              <TableCell>
                <Typography variant="subtitle2">
                  {formatAmount(row.sell_amount, locale)} {row.sell_asset}
                </Typography>
                {row.sell_network && <ChainValue network={row.sell_network} compact />}
              </TableCell>
              <TableCell>
                <Typography variant="subtitle2">
                  {formatAmount(row.net_buy_amount, locale)} {row.buy_asset}
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  {t('customers.tables.fee', {
                    fee: formatAmount(row.fee_amount, locale),
                  })}
                </Typography>
                {row.buy_network && <ChainValue network={row.buy_network} compact />}
              </TableCell>
              <TableCell>
                <Label color={transactionStatusColor(row.status)}>
                  {t(`status.transaction.${row.status}`, { defaultValue: row.status })}
                </Label>
              </TableCell>
            </TableRow>
          ))}
          {!rows.length && (
            <TableRow>
              <TableCell colSpan={5} align="center" sx={{ py: 7 }}>
                <Typography color="text.secondary">{t('customers.tables.noOtc')}</Typography>
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
    </TableContainer>
  );
}

function ChainValue({ network, compact = false }: { network: string; compact?: boolean }) {
  const chain = CHAINS.find((item) => item.value === network);
  if (!chain) return <Typography variant="body2">{network}</Typography>;
  return (
    <Stack direction="row" alignItems="center" spacing={0.75} sx={{ mt: compact ? 0.5 : 0 }}>
      <Iconify icon={chain.icon} width={compact ? 16 : 20} />
      <Box>
        <Typography variant={compact ? 'caption' : 'body2'}>{chain.name}</Typography>
        {!compact && (
          <Typography variant="caption" color="text.secondary">
            {chain.standard}
          </Typography>
        )}
      </Box>
    </Stack>
  );
}
