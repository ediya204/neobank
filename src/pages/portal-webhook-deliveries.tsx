import { useCallback, useEffect, useState } from 'react';
import { Helmet } from 'react-helmet-async';
import { Link as RouterLink } from 'react-router-dom';
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
  MenuItem,
  Stack,
  TablePagination,
  TextField,
  Typography,
} from '@mui/material';
import { useTranslation } from 'react-i18next';
import Iconify from 'src/components/iconify';
import {
  formatJson,
  normalizeDelivery,
  portalApi,
  WEBHOOK_EVENTS,
  WebhookDelivery,
  WebhookDeliveryStatus,
  WebhookDeliveryTable,
  webhookEventLabel,
} from 'src/pages/partner-api-integration';

const PAGE_SIZE = 50;
const DELIVERY_STATUSES = [
  { value: 'pending', label: '待投递' },
  { value: 'delivering', label: '投递中' },
  { value: 'retry_scheduled', label: '等待重试' },
  { value: 'delivered', label: '投递成功' },
  { value: 'dead_letter', label: '投递失败' },
  { value: 'suppressed', label: '已抑制' },
] as const;

type TranslationValues = Record<string, string | number | boolean | undefined>;

export default function PortalWebhookDeliveriesPage() {
  const { t, i18n } = useTranslation('portal');
  const translate = useCallback(
    (key: string, values?: TranslationValues) =>
      t(key, { keySeparator: false, defaultValue: key, ...values }),
    [t]
  );
  const locale = i18n.language === 'cn' ? 'zh-CN' : 'en-US';
  const [rows, setRows] = useState<WebhookDelivery[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [status, setStatus] = useState('all');
  const [eventType, setEventType] = useState('all');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [selected, setSelected] = useState<WebhookDelivery | null>(null);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError('');
    const params = new URLSearchParams({
      page: String(page + 1),
      limit: String(PAGE_SIZE),
      status,
      event_type: eventType,
    });

    portalApi(`/api-integration/deliveries?${params.toString()}`)
      .then((body) => {
        if (!active) return;
        const root = body?.data || body || {};
        setRows(Array.isArray(root.items) ? root.items.map(normalizeDelivery) : []);
        setTotal(Number(root.pagination?.total || 0));
      })
      .catch(() => {
        if (active) setError(translate('请求失败，请重试'));
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [eventType, page, status, translate]);

  const changeStatus = (value: string) => {
    setStatus(value);
    setPage(0);
  };
  const changeEventType = (value: string) => {
    setEventType(value);
    setPage(0);
  };

  return (
    <>
      <Helmet>
        <title>{translate('全部 Webhook 投递')} | SCC Digital Bank</title>
      </Helmet>
      <Container maxWidth="xl" sx={{ py: { xs: 3, md: 5 } }}>
        <Stack spacing={3}>
          <Stack
            direction={{ xs: 'column', sm: 'row' }}
            justifyContent="space-between"
            alignItems={{ sm: 'center' }}
            spacing={2}
          >
            <Box>
              <Typography variant="h4">{translate('全部 Webhook 投递')}</Typography>
              <Typography variant="body2" color="text.secondary" sx={{ mt: 0.75 }}>
                {translate('筛选 Webhook 投递记录并查看事件详情。')}
              </Typography>
            </Box>
            <Button
              component={RouterLink}
              to="/portal/api"
              variant="outlined"
              startIcon={<Iconify icon="solar:alt-arrow-left-linear" width={18} />}
            >
              {translate('返回 Webhook 配置')}
            </Button>
          </Stack>

          <Card sx={{ p: { xs: 2.5, md: 3 } }}>
            <Stack
              direction={{ xs: 'column', md: 'row' }}
              alignItems={{ md: 'center' }}
              justifyContent="space-between"
              spacing={2}
              sx={{ mb: 2.5 }}
            >
              <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5} sx={{ flex: 1 }}>
                <TextField
                  select
                  size="small"
                  label={translate('事件类型')}
                  value={eventType}
                  onChange={(event) => changeEventType(event.target.value)}
                  sx={{ minWidth: { sm: 260 } }}
                >
                  <MenuItem value="all">{translate('全部事件')}</MenuItem>
                  {WEBHOOK_EVENTS.map((event) => (
                    <MenuItem key={event.value} value={event.value}>
                      {translate(event.label)}
                    </MenuItem>
                  ))}
                  <MenuItem value="webhook.test">{translate('Webhook 测试')}</MenuItem>
                </TextField>
                <TextField
                  select
                  size="small"
                  label={translate('投递状态')}
                  value={status}
                  onChange={(event) => changeStatus(event.target.value)}
                  sx={{ minWidth: { sm: 200 } }}
                >
                  <MenuItem value="all">{translate('全部投递状态')}</MenuItem>
                  {DELIVERY_STATUSES.map((item) => (
                    <MenuItem key={item.value} value={item.value}>
                      {translate(item.label)}
                    </MenuItem>
                  ))}
                </TextField>
              </Stack>
              <Typography variant="body2" color="text.secondary">
                {translate('共 {{count}} 条记录', { count: total })}
              </Typography>
            </Stack>

            {error && <Alert severity="error">{error}</Alert>}
            {!error && loading && !rows.length && (
              <Typography color="text.secondary" sx={{ py: 5, textAlign: 'center' }}>
                {translate('加载中…')}
              </Typography>
            )}
            {!error && (!loading || rows.length > 0) && (
              <WebhookDeliveryTable
                rows={rows}
                locale={locale}
                translate={translate}
                onSelect={setSelected}
                limit={PAGE_SIZE}
              />
            )}
            {!error && total > 0 && (
              <TablePagination
                component="div"
                count={total}
                page={page}
                onPageChange={(_, nextPage) => setPage(nextPage)}
                rowsPerPage={PAGE_SIZE}
                rowsPerPageOptions={[PAGE_SIZE]}
                labelRowsPerPage={translate('每页行数')}
              />
            )}
          </Card>
        </Stack>
      </Container>

      <Dialog open={Boolean(selected)} onClose={() => setSelected(null)} fullWidth maxWidth="md">
        <DialogTitle>{translate('Webhook 投递详情')}</DialogTitle>
        <DialogContent dividers>
          {selected && (
            <Stack spacing={2.5}>
              <Stack
                direction={{ xs: 'column', sm: 'row' }}
                justifyContent="space-between"
                spacing={1}
              >
                <Box>
                  <Typography variant="subtitle1">
                    {webhookEventLabel(selected.eventType, translate)}
                  </Typography>
                  <Typography variant="caption" color="text.secondary">
                    {selected.eventType}
                  </Typography>
                  <Typography variant="caption" color="text.secondary" display="block">
                    {selected.id}
                  </Typography>
                </Box>
                <WebhookDeliveryStatus value={selected.status} translate={translate} />
              </Stack>
              <Divider />
              <Box
                sx={{
                  display: 'grid',
                  gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, minmax(0, 1fr))' },
                  gap: 2,
                }}
              >
                <Detail
                  label={translate('HTTP 结果')}
                  value={selected.httpStatus ? `HTTP ${selected.httpStatus}` : '—'}
                />
                <Detail label={translate('尝试次数')} value={String(selected.attemptCount)} />
                <Detail
                  label={translate('事件时间')}
                  value={formatDate(selected.createdAt, locale)}
                />
                <Detail
                  label={translate('投递时间')}
                  value={formatDate(selected.deliveredAt, locale)}
                />
                <Detail label={translate('资源 ID')} value={selected.resourceId} />
                <Detail label={translate('Webhook 地址')} value={selected.endpointUrl} />
              </Box>
              <Box>
                <Typography variant="subtitle2" sx={{ mb: 1 }}>
                  Payload
                </Typography>
                <Box
                  component="pre"
                  sx={{
                    m: 0,
                    p: 2,
                    borderRadius: 1.5,
                    bgcolor: 'background.neutral',
                    border: '1px solid',
                    borderColor: 'divider',
                    overflowX: 'auto',
                    whiteSpace: 'pre-wrap',
                    overflowWrap: 'anywhere',
                    typography: 'body2',
                    fontFamily: 'monospace',
                  }}
                >
                  {formatJson(selected.payload)}
                </Box>
              </Box>
            </Stack>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setSelected(null)}>{translate('关闭')}</Button>
        </DialogActions>
      </Dialog>
    </>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <Box sx={{ minWidth: 0 }}>
      <Typography variant="caption" color="text.secondary">
        {label}
      </Typography>
      <Typography variant="body2" sx={{ mt: 0.5, overflowWrap: 'anywhere' }}>
        {value || '—'}
      </Typography>
    </Box>
  );
}

function formatDate(value: string, locale: string) {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString(locale, { hour12: false });
}
