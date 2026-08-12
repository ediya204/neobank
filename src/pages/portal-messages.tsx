import { useCallback, useEffect, useMemo, useState } from 'react';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Card from '@mui/material/Card';
import CircularProgress from '@mui/material/CircularProgress';
import Divider from '@mui/material/Divider';
import IconButton from '@mui/material/IconButton';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import { enUS, zhCN } from 'date-fns/locale';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import Iconify from 'src/components/iconify';
import { browserApiFetch } from 'src/utils/browser-api';
import { fToNow } from 'src/utils/format-time';
import type { PortalNotification } from 'src/layouts/_common/notifications-popover/notification-item';

const NOTIFICATIONS_API = '/api/browser/v1/portal/notifications';

const PRESENTATION: Record<string, { icon: string; color: string; title: string }> = {
  'application.created': {
    icon: 'solar:user-plus-bold-duotone',
    color: 'info.main',
    title: 'header.notification_application_created',
  },
  'application.status_changed': {
    icon: 'solar:verified-check-bold-duotone',
    color: 'success.main',
    title: 'header.notification_application_status',
  },
  'application.changes_requested': {
    icon: 'solar:danger-triangle-bold-duotone',
    color: 'error.main',
    title: 'header.notification_application_changes_requested',
  },
  'application.resubmitted': {
    icon: 'solar:restart-bold-duotone',
    color: 'info.main',
    title: 'header.notification_application_resubmitted',
  },
  'fund_transaction.created': {
    icon: 'solar:wallet-money-bold-duotone',
    color: 'warning.main',
    title: 'header.notification_transaction_created',
  },
  'fund_transaction.status_changed': {
    icon: 'solar:card-transfer-bold-duotone',
    color: 'primary.main',
    title: 'header.notification_transaction_status',
  },
  'fiat_deposit.cleared_and_converted': {
    icon: 'solar:refresh-circle-bold-duotone',
    color: 'success.main',
    title: 'header.notification_conversion_completed',
  },
};

function presentationFor(action: string) {
  return (
    PRESENTATION[action] || {
      icon: 'solar:bell-bing-bold-duotone',
      color: 'text.secondary',
      title: 'header.notification_account_update',
    }
  );
}

function displayValue(value: unknown): string {
  if (value === null || value === undefined || value === '') return '—';
  if (Array.isArray(value)) return value.map(displayValue).join(', ');
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

const METADATA_LABEL_KEYS = new Set([
  'actor',
  'transaction_id',
  'type',
  'request_id',
  'review_note',
  'reviewed_by',
  'action',
  'allowlist_id',
  'cidr',
  'environment',
  'credential_id',
  'secret_version',
  'previous_secret_expires_at',
  'endpoint_url',
  'events',
  'resource_type',
  'resource_id',
  'external_reference',
  'settlement_status',
  'cleared_at',
  'fiat_asset',
  'fiat_amount',
  'exchange_rate',
  'exchange_rate_version',
  'usdt_amount',
  'usdt_network',
  'otc_order_id',
  'fee_rate',
  'fee_amount',
  'application_id',
  'previous_status',
  'previous_stage',
  'submission_round',
  'application_version',
  'reason_code',
  'reason_message',
  'required_fields',
  'fields',
  'status',
]);

function fallbackMetadataLabel(key: string) {
  return key
    .split('_')
    .filter(Boolean)
    .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
    .join(' ');
}

export default function PortalMessages({ selectedId }: { selectedId?: string }) {
  const { t, i18n } = useTranslation(['common', 'portal']);
  const navigate = useNavigate();
  const language = (i18n.resolvedLanguage || i18n.language || 'en').toLowerCase();
  const isCn = language === 'cn' || language.startsWith('zh');
  const locale = isCn ? 'zh-CN' : 'en-US';
  const dateFnsLocale = isCn ? zhCN : enUS;
  const [notifications, setNotifications] = useState<PortalNotification[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const response = await browserApiFetch(`${NOTIFICATIONS_API}?limit=100`, {
        credentials: 'same-origin',
      });
      if (!response.ok) throw new Error('request_failed');
      const value = await response.json();
      setNotifications(Array.isArray(value.data) ? value.data : []);
    } catch {
      setError(t('header.notifications_load_failed'));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    load();
  }, [load]);

  const selectedById = useMemo(
    () => notifications.find((item) => item.id === selectedId) || null,
    [notifications, selectedId]
  );
  const selected = selectedById || notifications[0] || null;
  const showMobileDetail = Boolean(selectedId && selectedById);

  useEffect(() => {
    if (!selected || selected.is_read) return;
    setNotifications((current) =>
      current.map((item) => (item.id === selected.id ? { ...item, is_read: true } : item))
    );
    browserApiFetch(`${NOTIFICATIONS_API}/${encodeURIComponent(selected.id)}/read`, {
      method: 'POST',
      credentials: 'same-origin',
    }).catch(() => load());
  }, [load, selected]);

  const select = (notification: PortalNotification) => {
    navigate(`/portal/messages/${encodeURIComponent(notification.id)}`);
  };

  if (loading && !notifications.length) {
    return (
      <Stack alignItems="center" sx={{ py: 10 }}>
        <CircularProgress size={32} />
      </Stack>
    );
  }

  if (error && !notifications.length) {
    return (
      <Alert severity="error" action={<Button onClick={load}>{t('header.retry')}</Button>}>
        {error}
      </Alert>
    );
  }

  if (!notifications.length) {
    return (
      <Card sx={{ py: 10, px: 3, textAlign: 'center' }}>
        <Iconify
          icon="solar:chat-round-dots-bold-duotone"
          width={44}
          sx={{ color: 'text.disabled', mb: 2 }}
        />
        <Typography variant="h6">{t('header.no_notifications')}</Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mt: 0.75 }}>
          {t('header.notifications_empty_detail')}
        </Typography>
      </Card>
    );
  }

  const selectedPresentation = selected ? presentationFor(selected.action) : null;
  const detailRows = selected
    ? Object.entries(selected.metadata || {}).filter(([, value]) => value !== '' && value !== null)
    : [];

  return (
    <Card sx={{ overflow: 'hidden' }}>
      {error && (
        <Alert severity="warning" sx={{ borderRadius: 0 }}>
          {error}
        </Alert>
      )}
      <Box
        sx={{
          display: 'grid',
          gridTemplateColumns: { xs: '1fr', md: 'minmax(280px, 36%) 1fr' },
          minHeight: { md: 560 },
        }}
      >
        <Box
          sx={{
            display: { xs: showMobileDetail ? 'none' : 'block', md: 'block' },
            minWidth: 0,
            borderRight: { md: (theme) => `1px solid ${theme.palette.divider}` },
          }}
        >
          <Stack
            direction="row"
            alignItems="center"
            justifyContent="space-between"
            sx={{ px: 2.5, py: 2 }}
          >
            <Typography variant="subtitle1">
              {t('messages_page.list_title', { ns: 'portal' })}
            </Typography>
            <IconButton
              aria-label={t('messages_page.refresh', { ns: 'portal' })}
              onClick={load}
              sx={{ width: 44, height: 44 }}
            >
              <Iconify icon="solar:refresh-linear" width={20} />
            </IconButton>
          </Stack>
          <Divider />
          <Stack divider={<Divider />} sx={{ maxHeight: { md: 620 }, overflowY: 'auto' }}>
            {notifications.map((notification) => {
              const itemPresentation = presentationFor(notification.action);
              const active = selected?.id === notification.id;
              return (
                <Box
                  component="button"
                  type="button"
                  key={notification.id}
                  onClick={() => select(notification)}
                  sx={{
                    width: 1,
                    border: 0,
                    p: 2.25,
                    display: 'flex',
                    gap: 1.5,
                    textAlign: 'left',
                    cursor: 'pointer',
                    color: 'text.primary',
                    bgcolor: active ? 'action.selected' : 'background.paper',
                    '&:hover': { bgcolor: 'action.hover' },
                  }}
                >
                  <Box
                    sx={{
                      width: 38,
                      height: 38,
                      borderRadius: '50%',
                      bgcolor: 'background.neutral',
                      display: 'grid',
                      placeItems: 'center',
                      flexShrink: 0,
                    }}
                  >
                    <Iconify
                      icon={itemPresentation.icon}
                      width={21}
                      sx={{ color: itemPresentation.color }}
                    />
                  </Box>
                  <Box sx={{ minWidth: 0, flex: 1 }}>
                    <Stack direction="row" alignItems="center" spacing={1}>
                      <Typography variant="subtitle2" noWrap sx={{ flex: 1 }}>
                        {t(itemPresentation.title)}
                      </Typography>
                      {!notification.is_read && (
                        <Box
                          sx={{
                            width: 7,
                            height: 7,
                            borderRadius: '50%',
                            bgcolor: 'info.main',
                            flexShrink: 0,
                          }}
                        />
                      )}
                    </Stack>
                    <Typography variant="body2" color="text.secondary" noWrap>
                      {notification.customer_name || notification.application_id || '—'}
                    </Typography>
                    <Typography variant="caption" color="text.disabled">
                      {fToNow(notification.created_at, dateFnsLocale)}
                    </Typography>
                  </Box>
                </Box>
              );
            })}
          </Stack>
        </Box>

        {selected && selectedPresentation && (
          <Box
            sx={{
              display: { xs: showMobileDetail ? 'block' : 'none', md: 'block' },
              minWidth: 0,
              p: { xs: 2, sm: 3, md: 4 },
            }}
          >
            <Button
              color="inherit"
              startIcon={<Iconify icon="solar:alt-arrow-left-linear" />}
              onClick={() => navigate('/portal/messages')}
              sx={{ display: { xs: 'inline-flex', md: 'none' }, minHeight: 44, mb: 2 }}
            >
              {t('messages_page.back', { ns: 'portal' })}
            </Button>
            <Stack direction="row" spacing={2} alignItems="flex-start">
              <Box
                sx={{
                  width: 48,
                  height: 48,
                  borderRadius: '50%',
                  bgcolor: 'background.neutral',
                  display: 'grid',
                  placeItems: 'center',
                  flexShrink: 0,
                }}
              >
                <Iconify
                  icon={selectedPresentation.icon}
                  width={26}
                  sx={{ color: selectedPresentation.color }}
                />
              </Box>
              <Box sx={{ minWidth: 0 }}>
                <Typography variant="h5" sx={{ overflowWrap: 'anywhere' }}>
                  {t(selectedPresentation.title)}
                </Typography>
                <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
                  {new Intl.DateTimeFormat(locale, {
                    dateStyle: 'medium',
                    timeStyle: 'short',
                  }).format(new Date(selected.created_at))}
                </Typography>
              </Box>
            </Stack>
            <Divider sx={{ my: 3 }} />
            <Stack spacing={2.25}>
              <Box>
                <Typography variant="caption" color="text.disabled">
                  {t('messages_page.customer', { ns: 'portal' })}
                </Typography>
                <Typography variant="body1">{selected.customer_name || '—'}</Typography>
              </Box>
              <Box>
                <Typography variant="caption" color="text.disabled">
                  {t('messages_page.application_id', { ns: 'portal' })}
                </Typography>
                <Typography variant="body1" sx={{ overflowWrap: 'anywhere' }}>
                  {selected.application_id || '—'}
                </Typography>
              </Box>
              {detailRows.length > 0 && (
                <Box>
                  <Typography variant="caption" color="text.disabled">
                    {t('messages_page.details', { ns: 'portal' })}
                  </Typography>
                  <Box
                    sx={{
                      mt: 1.25,
                      display: 'grid',
                      gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, minmax(0, 1fr))' },
                      gap: 1.5,
                    }}
                  >
                    {detailRows.map(([key, value]) => (
                      <Box
                        key={key}
                        sx={{ p: 1.5, borderRadius: 1.5, bgcolor: 'background.neutral' }}
                      >
                        <Typography
                          variant="caption"
                          color="text.disabled"
                          sx={{ display: 'block', mb: 0.25 }}
                        >
                          {METADATA_LABEL_KEYS.has(key)
                            ? t(`messages_page.metadata.${key}`, { ns: 'portal' })
                            : fallbackMetadataLabel(key)}
                        </Typography>
                        <Typography variant="body2" sx={{ overflowWrap: 'anywhere' }}>
                          {displayValue(value)}
                        </Typography>
                      </Box>
                    ))}
                  </Box>
                </Box>
              )}
            </Stack>
          </Box>
        )}
      </Box>
    </Card>
  );
}
