import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { TFunction } from 'i18next';
import { useTranslation } from 'react-i18next';
import { Helmet } from 'react-helmet-async';
import {
  Alert,
  Box,
  Button,
  Card,
  Checkbox,
  Chip,
  Container,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  Grid,
  IconButton,
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
import Iconify from 'src/components/iconify';
import { useSettingsContext } from 'src/components/settings';
import { getLocalizedApiError } from 'src/locales/api-error';
import { browserApiFetch } from 'src/utils/browser-api';

const BASE = '/api/browser/v1/admin';

type Candidate = {
  application_id: string;
  customer_name: string;
  ledger_balance: string;
  locked_amount: string;
  available_amount: string;
};

type SweepItem = {
  id: string;
  application_id: string;
  customer_name: string;
  amount: string;
  ledger_entry_id: string | null;
};

type SweepBatch = {
  id: string;
  status: 'locked' | 'submitted' | 'completed' | 'cancelled';
  destination_address: string;
  total_amount: string;
  tx_hash: string | null;
  operator_note: string | null;
  created_at: string;
  submitted_at: string | null;
  completed_at: string | null;
  items: SweepItem[];
};

type SweepPayload = {
  data: SweepBatch[];
  candidates: Candidate[];
  summary: {
    available_amount: string;
    locked_amount: string;
    pending_batches: number;
    completed_today_amount: string;
  };
};

type SettingPayload = {
  data: {
    exchange_rate?: string;
    tron_address?: string | null;
    version: number;
    updated_by: string;
    updated_at: string;
  };
  versions: Array<Record<string, string | number>>;
};

const EMPTY: SweepPayload = {
  data: [],
  candidates: [],
  summary: {
    available_amount: '0',
    locked_amount: '0',
    pending_batches: 0,
    completed_today_amount: '0',
  },
};

async function api<T>(path: string, fallback: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await browserApiFetch(`${BASE}${path}`, {
      ...init,
      headers: {
        'content-type': 'application/json',
        ...init?.headers,
      },
    });
  } catch {
    throw new Error(fallback);
  }

  let payload: T & { error?: { code?: string; message?: string } };
  try {
    payload = (await response.json()) as T & {
      error?: { code?: string; message?: string };
    };
  } catch {
    throw new Error(fallback);
  }
  if (!response.ok) {
    throw new Error(getLocalizedApiError(payload, fallback));
  }
  return payload;
}

function localeForLanguage(language: string) {
  return language === 'cn' || language.startsWith('zh') ? 'zh-CN' : 'en-US';
}

function amount(value: string | number, locale: string, maximumFractionDigits = 6) {
  return Number(value || 0).toLocaleString(locale, {
    minimumFractionDigits: 0,
    maximumFractionDigits,
  });
}

function formatDate(value: string, locale: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat(locale, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(date);
}

function formatCustomerNames(names: string[], locale: string) {
  return new Intl.ListFormat(locale, { style: 'short', type: 'conjunction' }).format(names);
}

function short(value: string | null | undefined) {
  if (!value) return '—';
  return value.length > 22 ? `${value.slice(0, 10)}…${value.slice(-8)}` : value;
}

function statusMeta(status: SweepBatch['status'], t: TFunction<'admin'>) {
  if (status === 'locked') {
    return { label: t('usdtSweeps.status.locked'), color: 'warning' as const };
  }
  if (status === 'submitted') {
    return { label: t('usdtSweeps.status.submitted'), color: 'info' as const };
  }
  if (status === 'completed') {
    return { label: t('usdtSweeps.status.completed'), color: 'success' as const };
  }
  if (status === 'cancelled') {
    return { label: t('usdtSweeps.status.cancelled'), color: 'default' as const };
  }
  return { label: t('usdtSweeps.status.unknown'), color: 'default' as const };
}

function actionCopy(action: 'submit' | 'complete' | 'cancel', t: TFunction<'admin'>) {
  return {
    success: t(`usdtSweeps.actionCopy.${action}.success`),
    title: t(`usdtSweeps.actionCopy.${action}.title`),
    button: t(`usdtSweeps.actionCopy.${action}.button`),
  };
}

export default function UsdtSweepsPage() {
  const { t, i18n } = useTranslation('admin');
  const locale = localeForLanguage(i18n.resolvedLanguage || i18n.language);
  const settings = useSettingsContext();
  const [tab, setTab] = useState('workbench');
  const [payload, setPayload] = useState<SweepPayload>(EMPTY);
  const [rate, setRate] = useState<SettingPayload | null>(null);
  const [address, setAddress] = useState<SettingPayload | null>(null);
  const [rateInput, setRateInput] = useState('0.995');
  const [addressInput, setAddressInput] = useState('');
  const [selected, setSelected] = useState<Record<string, string>>({});
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [mutating, setMutating] = useState(false);
  const mutationInFlightRef = useRef(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [activeBatch, setActiveBatch] = useState<SweepBatch | null>(null);
  const [action, setAction] = useState<'submit' | 'complete' | 'cancel' | null>(null);
  const [txHash, setTxHash] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [sweeps, rateSetting, addressSetting] = await Promise.all([
        api<SweepPayload>('/sweep-batches', t('usdtSweeps.errors.loadFailed')),
        api<SettingPayload>(
          '/conversion-settings/usd-usdt-tron',
          t('usdtSweeps.errors.loadFailed')
        ),
        api<SettingPayload>(
          '/sweep-settings/ethan-tron-address',
          t('usdtSweeps.errors.loadFailed')
        ),
      ]);
      setPayload(sweeps);
      setRate(rateSetting);
      setAddress(addressSetting);
      setRateInput(rateSetting.data.exchange_rate || '0.995');
      setAddressInput(addressSetting.data.tron_address || '');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : t('usdtSweeps.errors.loadFailed'));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    load();
  }, [load]);

  const selectedItems = useMemo(
    () =>
      payload.candidates
        .filter((candidate) => selected[candidate.application_id] !== undefined)
        .map((candidate) => ({
          application_id: candidate.application_id,
          customer_name: candidate.customer_name,
          amount: selected[candidate.application_id],
        })),
    [payload.candidates, selected]
  );

  const selectableCandidates = useMemo(
    () =>
      payload.candidates.filter((candidate) => {
        const availableAmount = Number(candidate.available_amount);
        return Number.isFinite(availableAmount) && availableAmount > 0;
      }),
    [payload.candidates]
  );
  const selectedCandidateCount = selectableCandidates.filter(
    (candidate) => selected[candidate.application_id] !== undefined
  ).length;
  const allCandidatesSelected =
    selectableCandidates.length > 0 && selectedCandidateCount === selectableCandidates.length;
  const someCandidatesSelected = selectedCandidateCount > 0 && !allCandidatesSelected;

  const selectAllCandidates = (checked: boolean) => {
    setSelected((current) => {
      const next = { ...current };
      selectableCandidates.forEach((candidate) => {
        if (checked) {
          if (next[candidate.application_id] === undefined) {
            next[candidate.application_id] = candidate.available_amount;
          }
        } else {
          delete next[candidate.application_id];
        }
      });
      return next;
    });
  };

  const selectedTotal = selectedItems.reduce((sum, item) => sum + Number(item.amount || 0), 0);
  const selectedAmountsValid =
    selectedItems.length > 0 &&
    selectedItems.every((item) => {
      const candidate = payload.candidates.find(
        (entry) => entry.application_id === item.application_id
      );
      const selectedAmount = Number(item.amount);
      const availableAmount = Number(candidate?.available_amount || 0);
      return (
        Number.isFinite(selectedAmount) && selectedAmount > 0 && selectedAmount <= availableAmount
      );
    });

  const filteredBatches = useMemo(() => {
    const term = query.trim().toLowerCase();
    return payload.data.filter((batch) => {
      if (!term) return true;
      return [
        batch.id,
        batch.tx_hash || '',
        ...batch.items.flatMap((item) => [item.customer_name, item.application_id]),
      ].some((value) => value.toLowerCase().includes(term));
    });
  }, [payload.data, query]);

  const visibleBatches = useMemo(
    () =>
      filteredBatches.filter(
        (batch) => tab === 'history' || ['locked', 'submitted'].includes(batch.status)
      ),
    [filteredBatches, tab]
  );

  const run = async (work: () => Promise<unknown>, success: string) => {
    if (mutationInFlightRef.current) return;
    mutationInFlightRef.current = true;
    setError('');
    setNotice('');
    setMutating(true);
    try {
      await work();
      setNotice(success);
      setConfirmOpen(false);
      setSelected({});
      setTxHash('');
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : t('usdtSweeps.errors.requestFailed'));
    } finally {
      mutationInFlightRef.current = false;
      setMutating(false);
    }
  };

  const createBatch = () =>
    run(
      () =>
        api('/sweep-batches', t('usdtSweeps.errors.requestFailed'), {
          method: 'POST',
          body: JSON.stringify({
            items: selectedItems.map(({ application_id, amount: value }) => ({
              application_id,
              amount: value,
            })),
          }),
        }),
      t('usdtSweeps.messages.batchCreated')
    );

  const batchAction = () => {
    if (!activeBatch || !action) return;
    const body = action === 'submit' ? { tx_hash: txHash } : {};
    run(
      () =>
        api(`/sweep-batches/${activeBatch.id}/${action}`, t('usdtSweeps.errors.requestFailed'), {
          method: 'POST',
          body: JSON.stringify(body),
        }),
      actionCopy(action, t).success
    );
  };

  const saveRate = () =>
    run(
      () =>
        api('/conversion-settings/usd-usdt-tron', t('usdtSweeps.errors.requestFailed'), {
          method: 'PATCH',
          body: JSON.stringify({ exchange_rate: rateInput }),
        }),
      t('usdtSweeps.messages.rateUpdated')
    );

  const saveAddress = () =>
    run(
      () =>
        api('/sweep-settings/ethan-tron-address', t('usdtSweeps.errors.requestFailed'), {
          method: 'PATCH',
          body: JSON.stringify({ tron_address: addressInput }),
        }),
      t('usdtSweeps.messages.addressUpdated')
    );

  const openAction = (batch: SweepBatch, nextAction: 'submit' | 'complete' | 'cancel') => {
    setActiveBatch(batch);
    setAction(nextAction);
    setTxHash('');
    setConfirmOpen(true);
  };

  const confirmButtonLabel = () => {
    if (mutating) return t('usdtSweeps.actions.processing');
    if (action) return actionCopy(action, t).button;
    return t('usdtSweeps.actions.lockAndCreate');
  };

  return (
    <>
      <Helmet>
        <title>{t('usdtSweeps.pageTitle')} | SCC Digital Bank</title>
      </Helmet>

      <Container maxWidth={settings.themeStretch ? false : 'xl'}>
        <Stack
          direction={{ xs: 'column', md: 'row' }}
          alignItems={{ md: 'flex-end' }}
          justifyContent="space-between"
          spacing={2}
          sx={{ mb: 4 }}
        >
          <Box>
            <Typography variant="overline" sx={{ color: 'warning.dark', letterSpacing: 1.4 }}>
              {t('usdtSweeps.eyebrow')}
            </Typography>
            <Typography variant="h3" sx={{ mt: 0.5 }}>
              {t('usdtSweeps.title')}
            </Typography>
            <Typography color="text.secondary" sx={{ mt: 1, maxWidth: 720 }}>
              {t('usdtSweeps.description')}
            </Typography>
          </Box>
          <Button
            color="inherit"
            startIcon={<Iconify icon="solar:refresh-linear" />}
            onClick={load}
            disabled={loading}
            sx={{ minHeight: 44, width: { xs: 1, sm: 'auto' } }}
          >
            {loading ? t('usdtSweeps.actions.refreshing') : t('common.refresh')}
          </Button>
        </Stack>

        {error && (
          <Alert severity="error" sx={{ mb: 3 }}>
            {error}
          </Alert>
        )}
        {notice && (
          <Alert severity="success" sx={{ mb: 3 }}>
            {notice}
          </Alert>
        )}
        {loading && !error && (
          <Alert severity="info" icon={<CircularProgress size={20} />} sx={{ mb: 3 }}>
            {t('usdtSweeps.loading')}
          </Alert>
        )}

        <Grid container spacing={2.5} sx={{ mb: 4 }}>
          {[
            [
              t('usdtSweeps.summary.available'),
              payload.summary.available_amount,
              'solar:wallet-money-bold-duotone',
            ],
            [
              t('usdtSweeps.summary.locked'),
              payload.summary.locked_amount,
              'solar:lock-keyhole-bold-duotone',
            ],
            [
              t('usdtSweeps.summary.pending'),
              payload.summary.pending_batches,
              'solar:clock-circle-bold-duotone',
            ],
            [
              t('usdtSweeps.summary.completedToday'),
              payload.summary.completed_today_amount,
              'solar:plain-2-bold-duotone',
            ],
          ].map(([label, value, icon]) => (
            <Grid item xs={12} sm={6} lg={3} key={String(label)}>
              <Card sx={{ p: 2.5, height: '100%' }}>
                <Stack direction="row" justifyContent="space-between" alignItems="flex-start">
                  <Box>
                    <Typography variant="caption" color="text.secondary">
                      {label}
                    </Typography>
                    <Typography variant="h4" sx={{ mt: 1 }}>
                      {amount(value, locale)}
                    </Typography>
                  </Box>
                  <Iconify icon={String(icon)} width={28} sx={{ color: 'warning.dark' }} />
                </Stack>
              </Card>
            </Grid>
          ))}
        </Grid>

        <Card>
          <Tabs
            value={tab}
            onChange={(_, value) => setTab(value)}
            variant="scrollable"
            scrollButtons="auto"
            allowScrollButtonsMobile
            aria-label={t('usdtSweeps.tabs.label')}
            sx={{
              px: { xs: 1, sm: 2.5 },
              borderBottom: 1,
              borderColor: 'divider',
              '& .MuiTab-root': { minWidth: 'max-content', minHeight: 48 },
            }}
          >
            <Tab value="workbench" label={t('usdtSweeps.tabs.workbench')} />
            <Tab
              value="pending"
              label={t('usdtSweeps.tabs.pendingBatches', {
                count: payload.summary.pending_batches,
              })}
            />
            <Tab value="history" label={t('usdtSweeps.tabs.history')} />
            <Tab value="settings" label={t('usdtSweeps.tabs.settings')} />
          </Tabs>

          {tab === 'workbench' && (
            <Box sx={{ p: { xs: 2, sm: 3 } }}>
              <Stack
                direction={{ xs: 'column', md: 'row' }}
                justifyContent="space-between"
                alignItems={{ md: 'center' }}
                spacing={2}
                sx={{ mb: 2 }}
              >
                <Box>
                  <Typography variant="h6">{t('usdtSweeps.workbench.title')}</Typography>
                  <Typography variant="body2" color="text.secondary">
                    {t('usdtSweeps.workbench.description')}
                  </Typography>
                </Box>
                <Button
                  variant="contained"
                  color="warning"
                  disabled={mutating || !selectedAmountsValid}
                  onClick={() => {
                    setAction(null);
                    setActiveBatch(null);
                    setConfirmOpen(true);
                  }}
                  sx={{ minHeight: 44, width: { xs: 1, md: 'auto' } }}
                >
                  {t('usdtSweeps.actions.createBatch', {
                    amount: amount(selectedTotal, locale),
                  })}
                </Button>
              </Stack>
              <TableContainer sx={{ overflowX: 'auto' }}>
                <Table sx={{ minWidth: 860 }}>
                  <TableHead>
                    <TableRow>
                      <TableCell padding="checkbox" width={56}>
                        <Checkbox
                          checked={allCandidatesSelected}
                          indeterminate={someCandidatesSelected}
                          disabled={!selectableCandidates.length}
                          inputProps={{
                            'aria-label': allCandidatesSelected
                              ? t('usdtSweeps.workbench.clearAllCustomers')
                              : t('usdtSweeps.workbench.selectAllCustomers'),
                          }}
                          onChange={(_, checked) => selectAllCandidates(checked)}
                        />
                      </TableCell>
                      <TableCell>{t('common.customer')}</TableCell>
                      <TableCell align="right">{t('common.ledgerBalance')}</TableCell>
                      <TableCell align="right">{t('usdtSweeps.workbench.locked')}</TableCell>
                      <TableCell align="right">{t('common.availableBalance')}</TableCell>
                      <TableCell width={200}>{t('usdtSweeps.workbench.sweepAmount')}</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {payload.candidates.map((candidate) => {
                      const checked = selected[candidate.application_id] !== undefined;
                      const selectedAmount = Number(selected[candidate.application_id]);
                      const selectedAmountInvalid =
                        checked &&
                        (!Number.isFinite(selectedAmount) ||
                          selectedAmount <= 0 ||
                          selectedAmount > Number(candidate.available_amount));
                      return (
                        <TableRow key={candidate.application_id} hover>
                          <TableCell padding="checkbox">
                            <Checkbox
                              checked={checked}
                              disabled={Number(candidate.available_amount) <= 0}
                              inputProps={{
                                'aria-label': t('usdtSweeps.workbench.selectCustomer', {
                                  customer: candidate.customer_name,
                                }),
                              }}
                              onChange={(_, value) =>
                                setSelected((current) => {
                                  const next = { ...current };
                                  if (value)
                                    next[candidate.application_id] = candidate.available_amount;
                                  else delete next[candidate.application_id];
                                  return next;
                                })
                              }
                            />
                          </TableCell>
                          <TableCell>
                            <Typography variant="subtitle2">{candidate.customer_name}</Typography>
                            <Typography variant="caption" color="text.secondary">
                              {candidate.application_id}
                            </Typography>
                          </TableCell>
                          <TableCell align="right">
                            {amount(candidate.ledger_balance, locale)}
                          </TableCell>
                          <TableCell align="right">
                            {amount(candidate.locked_amount, locale)}
                          </TableCell>
                          <TableCell align="right">
                            {amount(candidate.available_amount, locale)}
                          </TableCell>
                          <TableCell>
                            <TextField
                              size="small"
                              value={checked ? selected[candidate.application_id] : ''}
                              disabled={!checked}
                              error={selectedAmountInvalid}
                              helperText={
                                selectedAmountInvalid
                                  ? t('usdtSweeps.workbench.invalidAmount')
                                  : undefined
                              }
                              inputProps={{ inputMode: 'decimal' }}
                              onChange={(event) =>
                                setSelected((current) => ({
                                  ...current,
                                  [candidate.application_id]: event.target.value,
                                }))
                              }
                            />
                          </TableCell>
                        </TableRow>
                      );
                    })}
                    {!loading && !payload.candidates.length && (
                      <TableRow>
                        <TableCell colSpan={6}>
                          <Box sx={{ py: 6, textAlign: 'center' }}>
                            <Typography variant="h6">
                              {t('usdtSweeps.workbench.emptyTitle')}
                            </Typography>
                            <Typography variant="body2" color="text.secondary">
                              {t('usdtSweeps.workbench.emptyDescription')}
                            </Typography>
                          </Box>
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </TableContainer>
            </Box>
          )}

          {(tab === 'pending' || tab === 'history') && (
            <Box sx={{ p: { xs: 2, sm: 3 } }}>
              <TextField
                fullWidth
                size="small"
                placeholder={t('usdtSweeps.batches.searchPlaceholder')}
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                InputProps={{
                  startAdornment: (
                    <Iconify icon="solar:magnifier-linear" sx={{ mr: 1, color: 'text.disabled' }} />
                  ),
                }}
                sx={{ mb: 2.5, maxWidth: 560 }}
              />
              <Stack spacing={2}>
                {visibleBatches.map((batch) => {
                  const meta = statusMeta(batch.status, t);
                  return (
                    <Box key={batch.id} sx={{ borderBottom: 1, borderColor: 'divider', pb: 2 }}>
                      <Stack
                        direction={{ xs: 'column', lg: 'row' }}
                        justifyContent="space-between"
                        spacing={2}
                      >
                        <Box sx={{ minWidth: 0 }}>
                          <Stack
                            direction="row"
                            alignItems="center"
                            spacing={1}
                            useFlexGap
                            flexWrap="wrap"
                          >
                            <Typography variant="subtitle1" sx={{ overflowWrap: 'anywhere' }}>
                              {batch.id}
                            </Typography>
                            <Chip size="small" label={meta.label} color={meta.color} />
                          </Stack>
                          <Typography
                            variant="body2"
                            color="text.secondary"
                            sx={{ mt: 0.75, overflowWrap: 'anywhere' }}
                          >
                            {formatCustomerNames(
                              batch.items.map((item) => item.customer_name),
                              locale
                            )}
                          </Typography>
                          <Typography
                            variant="caption"
                            color="text.secondary"
                            sx={{ display: 'block', overflowWrap: 'anywhere' }}
                          >
                            {t('usdtSweeps.batches.destinationAndTransaction', {
                              address: short(batch.destination_address),
                              transaction: short(batch.tx_hash),
                            })}
                          </Typography>
                          <Typography variant="caption" color="text.secondary">
                            {t('usdtSweeps.batches.createdAt', {
                              date: formatDate(batch.created_at, locale),
                            })}
                          </Typography>
                        </Box>
                        <Stack
                          direction={{ xs: 'column', sm: 'row' }}
                          alignItems={{ xs: 'stretch', sm: 'center' }}
                          spacing={1.5}
                          sx={{ minWidth: { sm: 'fit-content' } }}
                        >
                          <Box sx={{ textAlign: { sm: 'right' }, mr: { sm: 1 } }}>
                            <Typography variant="h6">
                              {amount(batch.total_amount, locale)} USDT
                            </Typography>
                            <Typography variant="caption" color="text.secondary">
                              {t('usdtSweeps.batches.customerCount', {
                                count: batch.items.length,
                              })}
                            </Typography>
                          </Box>
                          {batch.status === 'locked' && (
                            <Button
                              size="small"
                              variant="contained"
                              disabled={mutating}
                              onClick={() => openAction(batch, 'submit')}
                              sx={{ minHeight: 44 }}
                            >
                              {t('usdtSweeps.actions.enterTxHash')}
                            </Button>
                          )}
                          {batch.status === 'submitted' && (
                            <Button
                              size="small"
                              color="success"
                              variant="contained"
                              disabled={mutating}
                              onClick={() => openAction(batch, 'complete')}
                              sx={{ minHeight: 44 }}
                            >
                              {t('usdtSweeps.actions.confirmCompletion')}
                            </Button>
                          )}
                          {batch.status === 'locked' && (
                            <IconButton
                              color="error"
                              disabled={mutating}
                              aria-label={t('usdtSweeps.actions.cancelBatch')}
                              onClick={() => openAction(batch, 'cancel')}
                              sx={{
                                width: 44,
                                height: 44,
                                alignSelf: { xs: 'flex-end', sm: 'center' },
                              }}
                            >
                              <Iconify icon="solar:close-circle-bold" />
                            </IconButton>
                          )}
                        </Stack>
                      </Stack>
                    </Box>
                  );
                })}
                {!loading && !visibleBatches.length && (
                  <Box sx={{ py: 6, textAlign: 'center' }}>
                    <Typography variant="h6">
                      {query.trim()
                        ? t('usdtSweeps.batches.noSearchResults')
                        : t(
                            tab === 'pending'
                              ? 'usdtSweeps.batches.emptyPending'
                              : 'usdtSweeps.batches.emptyHistory'
                          )}
                    </Typography>
                    <Typography variant="body2" color="text.secondary" sx={{ mt: 0.75 }}>
                      {query.trim()
                        ? t('usdtSweeps.batches.noSearchResultsDescription')
                        : t('usdtSweeps.batches.emptyDescription')}
                    </Typography>
                  </Box>
                )}
              </Stack>
            </Box>
          )}

          {tab === 'settings' && (
            <Box sx={{ p: { xs: 2, sm: 3 } }}>
              <Grid container spacing={4}>
                <Grid item xs={12} md={5}>
                  <Typography variant="overline" color="text.secondary">
                    {t('usdtSweeps.settings.conversionEyebrow')}
                  </Typography>
                  <Typography variant="h6" sx={{ mt: 0.5 }}>
                    {t('usdtSweeps.settings.conversionTitle')}
                  </Typography>
                  <Typography variant="body2" color="text.secondary" sx={{ mt: 1, mb: 2.5 }}>
                    {t('usdtSweeps.settings.conversionDescription')}
                  </Typography>
                  <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5}>
                    <TextField
                      fullWidth
                      label={t('usdtSweeps.settings.rateLabel')}
                      value={rateInput}
                      disabled={loading || mutating}
                      inputProps={{ inputMode: 'decimal' }}
                      onChange={(event) => setRateInput(event.target.value)}
                    />
                    <Button
                      variant="contained"
                      disabled={
                        loading ||
                        mutating ||
                        !/^\d+(\.\d+)?$/.test(rateInput) ||
                        Number(rateInput) <= 0
                      }
                      onClick={saveRate}
                      sx={{ minHeight: 44, minWidth: { sm: 104 } }}
                    >
                      {mutating ? t('usdtSweeps.actions.saving') : t('usdtSweeps.actions.save')}
                    </Button>
                  </Stack>
                  <Typography
                    variant="caption"
                    color="text.secondary"
                    sx={{ display: 'block', mt: 1, overflowWrap: 'anywhere' }}
                  >
                    {t('usdtSweeps.settings.currentVersion', {
                      version: rate?.data.version || 1,
                      operator: rate?.data.updated_by || t('usdtSweeps.settings.systemOperator'),
                    })}
                  </Typography>
                </Grid>
                <Grid item xs={12} md={1} sx={{ display: { xs: 'none', md: 'flex' } }}>
                  <Divider orientation="vertical" flexItem sx={{ mx: 'auto' }} />
                </Grid>
                <Grid item xs={12} md={6}>
                  <Typography variant="overline" color="text.secondary">
                    {t('usdtSweeps.settings.addressEyebrow')}
                  </Typography>
                  <Typography variant="h6" sx={{ mt: 0.5 }}>
                    {t('usdtSweeps.settings.addressTitle')}
                  </Typography>
                  <Typography variant="body2" color="text.secondary" sx={{ mt: 1, mb: 2.5 }}>
                    {t('usdtSweeps.settings.addressDescription')}
                  </Typography>
                  <Stack spacing={1.5}>
                    <TextField
                      fullWidth
                      label={t('usdtSweeps.settings.addressLabel')}
                      value={addressInput}
                      disabled={loading || mutating}
                      onChange={(event) => setAddressInput(event.target.value.trim())}
                    />
                    <Button
                      variant="contained"
                      color="warning"
                      disabled={loading || mutating || !addressInput}
                      onClick={saveAddress}
                      sx={{ minHeight: 44 }}
                    >
                      {mutating
                        ? t('usdtSweeps.actions.saving')
                        : t('usdtSweeps.actions.updateAllowlistedAddress')}
                    </Button>
                  </Stack>
                  <Typography
                    variant="caption"
                    color="text.secondary"
                    sx={{ display: 'block', mt: 1, overflowWrap: 'anywhere' }}
                  >
                    {t('usdtSweeps.settings.currentVersion', {
                      version: address?.data.version || 0,
                      operator: address?.data.updated_by || t('usdtSweeps.settings.systemOperator'),
                    })}
                  </Typography>
                </Grid>
              </Grid>
            </Box>
          )}
        </Card>
      </Container>

      <Dialog
        open={confirmOpen}
        onClose={() => {
          if (!mutating) setConfirmOpen(false);
        }}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle>
          {action ? actionCopy(action, t).title : t('usdtSweeps.dialog.createTitle')}
        </DialogTitle>
        <DialogContent>
          {!action ? (
            <Stack spacing={1.5}>
              <Alert severity="warning">
                {t('usdtSweeps.dialog.createWarning', {
                  count: selectedItems.length,
                  amount: amount(selectedTotal, locale),
                })}
              </Alert>
              {selectedItems.map((item) => (
                <Stack
                  key={item.application_id}
                  direction={{ xs: 'column', sm: 'row' }}
                  justifyContent="space-between"
                  spacing={0.5}
                >
                  <Typography variant="body2" sx={{ overflowWrap: 'anywhere' }}>
                    {item.customer_name}
                  </Typography>
                  <Typography variant="subtitle2" sx={{ flexShrink: 0 }}>
                    {amount(item.amount, locale)} USDT
                  </Typography>
                </Stack>
              ))}
            </Stack>
          ) : (
            <Stack spacing={2}>
              <Alert severity={action === 'cancel' ? 'warning' : 'info'}>
                {t('usdtSweeps.dialog.batchSummary', {
                  id: activeBatch?.id,
                  amount: amount(activeBatch?.total_amount || 0, locale),
                  count: activeBatch?.items.length || 0,
                })}
              </Alert>
              {action === 'submit' && (
                <TextField
                  autoFocus
                  fullWidth
                  label={t('usdtSweeps.dialog.txHashLabel')}
                  value={txHash}
                  error={Boolean(txHash) && !/^[0-9a-fA-F]{64}$/.test(txHash)}
                  onChange={(event) => setTxHash(event.target.value.trim())}
                  helperText={t('usdtSweeps.dialog.txHashHelp')}
                />
              )}
              {action === 'complete' && (
                <Typography variant="body2">{t('usdtSweeps.dialog.completionWarning')}</Typography>
              )}
            </Stack>
          )}
        </DialogContent>
        <DialogActions
          sx={{
            p: 3,
            flexDirection: { xs: 'column-reverse', sm: 'row' },
            alignItems: 'stretch',
            '& > :not(style) ~ :not(style)': { ml: { xs: 0, sm: 1 }, mb: { xs: 1, sm: 0 } },
          }}
        >
          <Button
            color="inherit"
            disabled={mutating}
            onClick={() => setConfirmOpen(false)}
            sx={{ minHeight: 44 }}
          >
            {t('usdtSweeps.actions.backToReview')}
          </Button>
          <Button
            variant="contained"
            color={action === 'cancel' ? 'error' : 'warning'}
            disabled={mutating || (action === 'submit' && !/^[0-9a-fA-F]{64}$/.test(txHash))}
            onClick={!action ? createBatch : batchAction}
            sx={{ minHeight: 44 }}
          >
            {confirmButtonLabel()}
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
}
