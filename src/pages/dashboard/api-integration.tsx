import { useCallback, useEffect, useMemo, useState } from 'react';
import { Helmet } from 'react-helmet-async';
import { useTranslation } from 'react-i18next';
import {
  Alert,
  Box,
  Button,
  Card,
  Chip,
  Container,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  Drawer,
  IconButton,
  MenuItem,
  Stack,
  Tab,
  TablePagination,
  Tabs,
  TextField,
  Typography,
} from '@mui/material';
import { DataGrid, GridColDef } from '@mui/x-data-grid';
import Iconify from 'src/components/iconify';
import Label from 'src/components/label';
import { useSnackbar } from 'src/components/snackbar';
import { useSettingsContext } from 'src/components/settings';
import { getLocalizedApiError } from 'src/locales/api-error';
import { browserApiFetch } from 'src/utils/browser-api';

type RequestKind = 'ip_allowlist' | 'webhook' | 'webhook_signing_key';
type RequestStatus = 'pending' | 'approved' | 'rejected' | 'cancelled';
type ReviewAction = 'approve' | 'reject';
type ApiManagementTab = 'requests' | 'credentials' | 'configuration' | 'deliveries';

type IntegrationRequest = {
  id: string;
  kind: RequestKind;
  action: string;
  status: RequestStatus;
  requested_by: string;
  requested_via: string;
  reason: string;
  review_note: string;
  reviewed_by: string;
  created_at: string;
  reviewed_at: string;
  target_id: string;
  cidr: string;
  label: string;
  environment: string;
  webhook_url: string;
  events: string[];
  overlap_hours: number;
  payload: Record<string, unknown>;
};

type IpRule = {
  id: string;
  cidr: string;
  label: string;
  enabled: boolean;
  environment: string;
  source_request_id: string;
  updated_at: string;
};

type WebhookEndpoint = {
  id: string;
  url: string;
  events: string[];
  enabled: boolean;
  verification_status: string;
  last_delivery_at: string;
  updated_at: string;
};

type WebhookDelivery = {
  id: string;
  endpoint_id: string;
  event_type: string;
  resource_type: string;
  resource_id: string;
  application_id: string;
  status: string;
  response_status: number | null;
  attempt_count: number;
  last_error: string;
  payload: string;
  resource_status: string;
  last_attempt_at: string;
  next_attempt_at: string;
  updated_at: string;
  created_at: string;
  delivered_at: string;
};

type IntegrationSummary = {
  pending: number;
  ip_rules: number;
  webhooks: number;
  failed_deliveries: number;
};

type ApiCredential = {
  id: string;
  client_id: string;
  expires_at: string;
  previous_secret_expires_at: string;
  status: string;
  reveal_status: string;
  secret_available: boolean;
  updated_at: string;
};

type CredentialRotationRequest = {
  id: string;
  status: RequestStatus;
  reason: string;
  migration_window_hours: number;
  requested_by: string;
  requested_via: string;
  review_note: string;
  reviewed_by: string;
  created_at: string;
  reviewed_at: string;
};

type WebhookSigningKey = {
  id: string;
  status: string;
  reveal_status: string;
  secret_version: number;
  overlap_hours: number;
  created_at: string;
  activated_at: string;
  expires_at: string;
};

type WebhookSigningKeyRequest = {
  id: string;
  status: RequestStatus;
  reason: string;
  overlap_hours: number;
  requested_by: string;
  requested_via: string;
  review_note: string;
  reviewed_by: string;
  created_at: string;
  reviewed_at: string;
};

type IntegrationData = {
  summary: IntegrationSummary;
  requests: IntegrationRequest[];
  ip_allowlist: IpRule[];
  webhooks: WebhookEndpoint[];
  deliveries: WebhookDelivery[];
  credentials: ApiCredential[];
  credential_rotation_requests: CredentialRotationRequest[];
  webhook_signing_keys: WebhookSigningKey[];
  webhook_signing_key_requests: WebhookSigningKeyRequest[];
  credential_management_configured: boolean;
  webhook_signing_key_management_configured: boolean;
};

type ApiEnvelope<T> = {
  data: T;
  error?: { code?: string; message?: string };
};

const EMPTY_DATA: IntegrationData = {
  summary: { pending: 0, ip_rules: 0, webhooks: 0, failed_deliveries: 0 },
  requests: [],
  ip_allowlist: [],
  webhooks: [],
  deliveries: [],
  credentials: [],
  credential_rotation_requests: [],
  webhook_signing_keys: [],
  webhook_signing_key_requests: [],
  credential_management_configured: false,
  webhook_signing_key_management_configured: false,
};

const BASE = '/api/browser/v1/admin/api-integration';
const WEBHOOK_REPLAY_EVENTS = [
  'application.status_changed',
  'va_account.activated',
  'fund_transaction.status_changed',
  'otc_order.status_changed',
  'fiat_deposit.cleared_and_converted',
  'usdt_sweep.locked',
  'usdt_sweep.completed',
  'usdt_sweep.cancelled',
] as const;

async function requestApi<T>(path = '', init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await browserApiFetch(`${BASE}${path}`, {
      ...init,
      credentials: 'same-origin',
      headers: {
        'content-type': 'application/json',
        ...init?.headers,
      },
    });
  } catch {
    throw new Error(getLocalizedApiError({ error: { code: 'session_unavailable' } }));
  }

  let body: ApiEnvelope<T>;
  try {
    body = (await response.json()) as ApiEnvelope<T>;
  } catch {
    throw new Error(getLocalizedApiError({ error: { code: 'session_unavailable' } }));
  }

  if (!response.ok) throw new Error(getLocalizedApiError(body));
  return body.data;
}

function toText(value: unknown) {
  return typeof value === 'string' ? value : '';
}

function toBoolean(value: unknown) {
  return value === true || value === 1;
}

function formatJson(value: string) {
  if (!value) return '—';
  try {
    return JSON.stringify(JSON.parse(value), null, 2);
  } catch {
    return value;
  }
}

function webhookEventTime(delivery: WebhookDelivery) {
  if (delivery.payload) {
    try {
      const payload = JSON.parse(delivery.payload) as Record<string, unknown>;
      const value =
        payload.eventTimestamp ||
        payload.event_timestamp ||
        payload.occurred_at ||
        payload.created_at;
      if (typeof value === 'string') return value;
    } catch {
      // The raw payload remains visible even when it is not valid JSON.
    }
  }
  return delivery.created_at;
}

function toStringArray(value: unknown) {
  if (Array.isArray(value)) return value.filter((item): item is string => typeof item === 'string');
  if (typeof value !== 'string' || !value.trim()) return [];
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === 'string')
      : [];
  } catch {
    return value
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean);
  }
}

function firstArray(...values: unknown[]) {
  return values.find(Array.isArray) || [];
}

function normalizeRequest(value: any): IntegrationRequest {
  const payload =
    value?.payload && typeof value.payload === 'object'
      ? value.payload
      : (() => {
          try {
            const parsed = JSON.parse(toText(value?.payload_json) || '{}');
            return parsed && typeof parsed === 'object' ? parsed : {};
          } catch {
            return {};
          }
        })();
  const kindValue = toText(value?.kind || value?.request_type);
  const statusValue = toText(value?.status);
  return {
    id: toText(value?.id),
    kind: kindValue === 'webhook' || kindValue === 'webhook_endpoint' ? 'webhook' : 'ip_allowlist',
    action: toText(value?.action || value?.operation || 'create'),
    status:
      statusValue === 'approved' || statusValue === 'rejected' || statusValue === 'cancelled'
        ? statusValue
        : 'pending',
    requested_by: toText(value?.requested_by || value?.requester_email),
    requested_via: toText(value?.requested_via),
    reason: toText(value?.reason || value?.request_reason),
    review_note: toText(value?.review_note),
    reviewed_by: toText(value?.reviewed_by || value?.reviewer_email),
    created_at: toText(value?.created_at),
    reviewed_at: toText(value?.reviewed_at),
    target_id: toText(value?.target_id || value?.target_entry_id),
    cidr: toText(value?.cidr || payload.cidr),
    label: toText(value?.label || payload.label),
    environment: toText(value?.environment || payload.environment),
    webhook_url: toText(
      value?.webhook_url ||
        value?.endpoint_url ||
        value?.url ||
        payload.webhook_url ||
        payload.endpoint_url ||
        payload.url
    ),
    events: toStringArray(value?.events || value?.events_json || payload.events),
    overlap_hours: Number(value?.overlap_hours || payload.overlap_hours || 0),
    payload: payload as Record<string, unknown>,
  };
}

function webhookSigningKeyRequestToIntegrationRequest(
  request: WebhookSigningKeyRequest
): IntegrationRequest {
  return {
    ...request,
    kind: 'webhook_signing_key',
    action: 'create_or_rotate',
    target_id: '',
    cidr: '',
    label: '',
    environment: '',
    webhook_url: '',
    events: [],
    payload: {},
  };
}

function integrationRequestToWebhookSigningKeyRequest(
  request: IntegrationRequest
): WebhookSigningKeyRequest {
  return {
    id: request.id,
    status: request.status,
    reason: request.reason,
    overlap_hours: request.overlap_hours,
    requested_by: request.requested_by,
    requested_via: request.requested_via,
    review_note: request.review_note,
    reviewed_by: request.reviewed_by,
    created_at: request.created_at,
    reviewed_at: request.reviewed_at,
  };
}

function normalizeIntegrationData(value: any): IntegrationData {
  const source = value?.data && typeof value.data === 'object' ? value.data : value || {};
  const requestRows = Array.isArray(source.requests) ? source.requests.map(normalizeRequest) : [];
  const ipRows = firstArray(source.ip_allowlist, source.ip_rules);
  const webhookRows = firstArray(source.webhooks, source.webhook_endpoints);
  const deliveryRows = firstArray(source.deliveries, source.recent_deliveries);
  const credentialRows = firstArray(source.credentials);
  const rotationRows = firstArray(source.credential_rotation_requests);
  const webhookSigningKeyRows = firstArray(source.webhook_signing_keys);
  const webhookSigningKeyRequestRows = firstArray(source.webhook_signing_key_requests);

  const ip_allowlist: IpRule[] = ipRows.map((row: any) => ({
    id: toText(row?.id),
    cidr: toText(row?.cidr),
    label: toText(row?.label),
    enabled: toBoolean(row?.enabled),
    environment: toText(row?.environment),
    source_request_id: toText(row?.source_request_id),
    updated_at: toText(row?.updated_at || row?.created_at),
  }));
  const webhooks: WebhookEndpoint[] = webhookRows.map((row: any) => ({
    id: toText(row?.id || row?.partner_key || 'partner-webhook'),
    url: toText(row?.url || row?.webhook_url || row?.endpoint_url),
    events: toStringArray(row?.events || row?.events_json),
    enabled: toBoolean(row?.enabled) || row?.status === 'active',
    verification_status: toText(row?.verification_status || row?.status),
    last_delivery_at: toText(row?.last_delivery_at || row?.last_success_at),
    updated_at: toText(row?.updated_at || row?.created_at),
  }));
  const deliveries: WebhookDelivery[] = deliveryRows.map((row: any) => ({
    id: toText(row?.id),
    endpoint_id: toText(row?.endpoint_id || row?.webhook_id || row?.endpoint_url),
    event_type: toText(row?.event_type || row?.event),
    resource_type: toText(row?.resource_type),
    resource_id: toText(row?.resource_id),
    application_id: toText(row?.application_id),
    status: toText(row?.status),
    response_status: Number.isFinite(Number(row?.response_status))
      ? Number(row.response_status)
      : null,
    attempt_count: Number.isFinite(Number(row?.attempt_count)) ? Number(row.attempt_count) : 0,
    last_error: toText(row?.last_error || row?.error),
    payload: toText(row?.payload_json || row?.payload),
    resource_status: toText(row?.resource_status),
    last_attempt_at: toText(row?.last_attempt_at),
    next_attempt_at: toText(row?.next_attempt_at),
    updated_at: toText(row?.updated_at),
    created_at: toText(row?.created_at),
    delivered_at: toText(row?.delivered_at),
  }));
  const credentials: ApiCredential[] = credentialRows.map((row: any) => ({
    id: toText(row?.id),
    client_id: toText(row?.client_id),
    expires_at: toText(row?.expires_at),
    previous_secret_expires_at: toText(row?.previous_secret_expires_at),
    status: toText(row?.status),
    reveal_status: toText(row?.reveal_status),
    secret_available: toBoolean(row?.secret_available),
    updated_at: toText(row?.updated_at),
  }));
  const credential_rotation_requests: CredentialRotationRequest[] = rotationRows.map((row: any) => {
    const status = toText(row?.status);
    return {
      id: toText(row?.id),
      status:
        status === 'approved' || status === 'rejected' || status === 'cancelled'
          ? status
          : 'pending',
      reason: toText(row?.reason),
      migration_window_hours: Number(row?.migration_window_hours || 48),
      requested_by: toText(row?.requested_by),
      requested_via: toText(row?.requested_via),
      review_note: toText(row?.review_note),
      reviewed_by: toText(row?.reviewed_by),
      created_at: toText(row?.created_at),
      reviewed_at: toText(row?.reviewed_at),
    };
  });
  const webhook_signing_keys: WebhookSigningKey[] = webhookSigningKeyRows.map((row: any) => ({
    id: toText(row?.key_id || row?.id),
    status: toText(row?.status),
    reveal_status: toText(row?.reveal_status),
    secret_version: Number(row?.secret_version || 1),
    overlap_hours: Number(row?.overlap_hours || 48),
    created_at: toText(row?.created_at),
    activated_at: toText(row?.activated_at),
    expires_at: toText(row?.expires_at),
  }));
  const webhook_signing_key_requests: WebhookSigningKeyRequest[] = webhookSigningKeyRequestRows.map(
    (row: any) => {
      const status = toText(row?.status);
      return {
        id: toText(row?.id),
        status:
          status === 'approved' || status === 'rejected' || status === 'cancelled'
            ? status
            : 'pending',
        reason: toText(row?.reason),
        overlap_hours: Number(row?.overlap_hours || 48),
        requested_by: toText(row?.requested_by),
        requested_via: toText(row?.requested_via),
        review_note: toText(row?.review_note),
        reviewed_by: toText(row?.reviewed_by),
        created_at: toText(row?.created_at),
        reviewed_at: toText(row?.reviewed_at),
      };
    }
  );
  const rawSummary = source.summary || source.metrics || {};

  return {
    requests: requestRows,
    ip_allowlist,
    webhooks,
    deliveries,
    credentials,
    credential_rotation_requests,
    webhook_signing_keys,
    webhook_signing_key_requests,
    credential_management_configured: toBoolean(
      source?.security?.credential_management?.configured
    ),
    webhook_signing_key_management_configured: toBoolean(
      source?.security?.webhook_signing_key_management?.configured
    ),
    summary: {
      pending: Number(
        rawSummary.pending ??
          requestRows.filter((row: IntegrationRequest) => row.status === 'pending').length
      ),
      ip_rules: Number(
        rawSummary.ip_rules ??
          rawSummary.approved_ip_rules ??
          ip_allowlist.filter((row) => row.enabled).length
      ),
      webhooks: Number(
        rawSummary.webhooks ??
          rawSummary.webhook_endpoints ??
          webhooks.filter((row) => row.enabled).length
      ),
      failed_deliveries: Number(
        rawSummary.failed_deliveries ??
          deliveries.filter((row) =>
            ['retry_scheduled', 'failed', 'dead_letter'].includes(row.status)
          ).length
      ),
    },
  };
}

function localeForLanguage(language: string) {
  return language === 'cn' || language.startsWith('zh') ? 'zh-CN' : 'en-US';
}

function formatDate(value: string, locale: string) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat(locale, {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

function requestStatusColor(status: RequestStatus): 'warning' | 'success' | 'error' | 'default' {
  if (status === 'approved') return 'success';
  if (status === 'rejected') return 'error';
  if (status === 'cancelled') return 'default';
  return 'warning';
}

function deliveryStatusColor(status: string): 'success' | 'warning' | 'error' | 'default' {
  if (status === 'delivered' || status === 'success') return 'success';
  if (
    status === 'pending' ||
    status === 'delivering' ||
    status === 'retrying' ||
    status === 'retry_scheduled'
  )
    return 'warning';
  if (status === 'failed' || status === 'dead_letter') return 'error';
  return 'default';
}

function webhookKeyStatusColor(status: string): 'success' | 'warning' | 'default' {
  if (status === 'active') return 'success';
  if (status === 'available') return 'warning';
  return 'default';
}

function deliveryStatusIcon(status: string, retryable: boolean) {
  if (retryable) return 'solar:danger-triangle-bold-duotone';
  if (status === 'suppressed') return 'solar:minus-circle-bold-duotone';
  if (status === 'delivering') return 'solar:clock-circle-bold-duotone';
  return 'solar:check-circle-bold-duotone';
}

function requestPrimaryValue(row: IntegrationRequest) {
  if (row.kind === 'ip_allowlist') return row.cidr;
  if (row.kind === 'webhook') return row.webhook_url;
  return row.reason;
}

function requestKindIcon(kind: RequestKind) {
  if (kind === 'ip_allowlist') return 'solar:shield-network-bold-duotone';
  if (kind === 'webhook_signing_key') return 'solar:key-minimalistic-square-3-bold-duotone';
  return 'solar:link-circle-bold-duotone';
}

function requestKindColor(kind: RequestKind) {
  if (kind === 'ip_allowlist') return 'info.main';
  if (kind === 'webhook_signing_key') return 'warning.main';
  return 'secondary.main';
}

export default function ApiIntegrationApprovalPage() {
  const { t, i18n } = useTranslation('admin');
  const locale = localeForLanguage(i18n.resolvedLanguage || i18n.language);
  const settings = useSettingsContext();
  const { enqueueSnackbar } = useSnackbar();
  const [data, setData] = useState<IntegrationData>(EMPTY_DATA);
  const [hasLoaded, setHasLoaded] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [activeTab, setActiveTab] = useState<ApiManagementTab>('requests');
  const [kindFilter, setKindFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const [detailRequest, setDetailRequest] = useState<IntegrationRequest | null>(null);
  const [reviewAction, setReviewAction] = useState<ReviewAction | null>(null);
  const [reviewNote, setReviewNote] = useState('');
  const [reviewError, setReviewError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [selectedDelivery, setSelectedDelivery] = useState<WebhookDelivery | null>(null);
  const [deliveryPage, setDeliveryPage] = useState(0);
  const [retryDelivery, setRetryDelivery] = useState<WebhookDelivery | null>(null);
  const [replayOpen, setReplayOpen] = useState(false);
  const [replaySource, setReplaySource] = useState<WebhookDelivery | null>(null);
  const [replayEventType, setReplayEventType] = useState('');
  const [replayResourceId, setReplayResourceId] = useState('');
  const [replayReason, setReplayReason] = useState('');
  const [replayError, setReplayError] = useState('');
  const [credentialReview, setCredentialReview] = useState<{
    request: CredentialRotationRequest;
    action: ReviewAction;
  } | null>(null);
  const [credentialReviewNote, setCredentialReviewNote] = useState('');
  const [webhookKeyReview, setWebhookKeyReview] = useState<{
    request: WebhookSigningKeyRequest;
    action: ReviewAction;
  } | null>(null);
  const [webhookKeyReviewNote, setWebhookKeyReviewNote] = useState('');

  const load = useCallback(
    async (signal?: AbortSignal) => {
      setLoading(true);
      setLoadError('');
      try {
        const value = await requestApi<any>('', { signal });
        if (!signal?.aborted) {
          setData(normalizeIntegrationData(value));
          setHasLoaded(true);
        }
      } catch (caught) {
        if (caught instanceof DOMException && caught.name === 'AbortError') return;
        if (!signal?.aborted) {
          setLoadError(
            caught instanceof Error ? caught.message : t('apiIntegrationApproval.errors.load')
          );
        }
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

  const webhookSigningKeyRequests = useMemo(
    () =>
      [...data.webhook_signing_key_requests].sort(
        (left, right) =>
          new Date(right.created_at || 0).getTime() - new Date(left.created_at || 0).getTime()
      ),
    [data.webhook_signing_key_requests]
  );
  const unifiedRequests = useMemo(
    () =>
      [
        ...data.requests,
        ...webhookSigningKeyRequests.map(webhookSigningKeyRequestToIntegrationRequest),
      ].sort(
        (left, right) =>
          new Date(right.created_at || 0).getTime() - new Date(left.created_at || 0).getTime()
      ),
    [data.requests, webhookSigningKeyRequests]
  );
  const filteredRequests = useMemo(
    () =>
      unifiedRequests.filter(
        (row) =>
          (kindFilter === 'all' || row.kind === kindFilter) &&
          (statusFilter === 'all' || row.status === statusFilter)
      ),
    [kindFilter, statusFilter, unifiedRequests]
  );
  const deliveryRowsPerPage = 50;
  const visibleDeliveries = useMemo(
    () =>
      data.deliveries.slice(
        deliveryPage * deliveryRowsPerPage,
        (deliveryPage + 1) * deliveryRowsPerPage
      ),
    [data.deliveries, deliveryPage]
  );

  useEffect(() => {
    const lastPage = Math.max(0, Math.ceil(data.deliveries.length / deliveryRowsPerPage) - 1);
    if (deliveryPage > lastPage) setDeliveryPage(lastPage);
  }, [data.deliveries.length, deliveryPage]);
  const activeCredential =
    data.credentials.find((item) => item.status === 'active') || data.credentials[0];
  const credentialRotationRequests = useMemo(
    () =>
      [...data.credential_rotation_requests].sort(
        (left, right) =>
          new Date(right.created_at || 0).getTime() - new Date(left.created_at || 0).getTime()
      ),
    [data.credential_rotation_requests]
  );
  const openReview = (request: IntegrationRequest, action: ReviewAction) => {
    if (request.kind === 'webhook_signing_key') {
      setDetailRequest(null);
      setWebhookKeyReview({
        request: integrationRequestToWebhookSigningKeyRequest(request),
        action,
      });
      setWebhookKeyReviewNote('');
      setReviewError('');
      return;
    }
    setDetailRequest(request);
    setReviewAction(action);
    setReviewNote('');
    setReviewError('');
  };

  const submitReview = async () => {
    if (!detailRequest || !reviewAction) return;
    const note = reviewNote.trim();
    if (reviewAction === 'reject' && !note) {
      setReviewError(t('apiIntegrationApproval.errors.rejectionReasonRequired'));
      return;
    }
    setSubmitting(true);
    setReviewError('');
    try {
      const reviewed = await requestApi<any>(
        `/requests/${encodeURIComponent(detailRequest.id)}/${reviewAction}`,
        {
          method: 'POST',
          body: JSON.stringify(note ? { review_note: note } : {}),
        }
      );
      const normalized = normalizeRequest(reviewed);
      setData((current) => ({
        ...current,
        requests: current.requests.map((row) => (row.id === normalized.id ? normalized : row)),
        summary: {
          ...current.summary,
          pending: Math.max(0, current.summary.pending - 1),
        },
      }));
      enqueueSnackbar(
        t(
          reviewAction === 'approve'
            ? 'apiIntegrationApproval.messages.approved'
            : 'apiIntegrationApproval.messages.rejected'
        )
      );
      setReviewAction(null);
      setDetailRequest(null);
      setReviewNote('');
      await load();
    } catch (caught) {
      setReviewError(
        caught instanceof Error ? caught.message : t('apiIntegrationApproval.errors.review')
      );
    } finally {
      setSubmitting(false);
    }
  };

  const submitRetry = async () => {
    if (!retryDelivery) return;
    setSubmitting(true);
    try {
      await requestApi(`/deliveries/${encodeURIComponent(retryDelivery.id)}/retry`, {
        method: 'POST',
        body: JSON.stringify({}),
      });
      setData((current) => ({
        ...current,
        deliveries: current.deliveries.map((delivery) =>
          delivery.id === retryDelivery.id
            ? {
                ...delivery,
                status: 'pending',
                attempt_count: 0,
                response_status: null,
                last_error: '',
                delivered_at: '',
              }
            : delivery
        ),
        summary: {
          ...current.summary,
          failed_deliveries: Math.max(0, current.summary.failed_deliveries - 1),
        },
      }));
      enqueueSnackbar(t('apiIntegrationApproval.messages.retryQueued'));
      setRetryDelivery(null);
      await load();
    } catch (caught) {
      enqueueSnackbar(
        caught instanceof Error ? caught.message : t('apiIntegrationApproval.errors.retry'),
        { variant: 'error' }
      );
    } finally {
      setSubmitting(false);
    }
  };

  const openReplay = (delivery: WebhookDelivery | null = null) => {
    setReplaySource(delivery);
    setReplayEventType(delivery?.event_type || '');
    setReplayResourceId(delivery?.resource_id || '');
    setReplayReason('');
    setReplayError('');
    setReplayOpen(true);
  };

  const closeReplay = () => {
    if (submitting) return;
    setReplayOpen(false);
    setReplaySource(null);
    setReplayError('');
  };

  const submitReplay = async () => {
    const reason = replayReason.trim();
    if (!reason) {
      setReplayError(t('apiIntegrationApproval.replay.reasonRequired'));
      return;
    }
    if (!replaySource && (!replayEventType || !replayResourceId.trim())) {
      setReplayError(t('apiIntegrationApproval.replay.resourceRequired'));
      return;
    }
    setSubmitting(true);
    setReplayError('');
    try {
      const replayBody = replaySource
        ? { source_delivery_id: replaySource.id, reason }
        : {
            event_type: replayEventType,
            resource_id: replayResourceId.trim(),
            reason,
          };
      await requestApi('/webhook-replays', {
        method: 'POST',
        body: JSON.stringify(replayBody),
      });
      enqueueSnackbar(t('apiIntegrationApproval.messages.replayQueued'));
      setReplayOpen(false);
      setReplaySource(null);
      await load();
    } catch (caught) {
      setReplayError(
        caught instanceof Error ? caught.message : t('apiIntegrationApproval.errors.replay')
      );
    } finally {
      setSubmitting(false);
    }
  };

  const submitCredentialReview = async () => {
    if (!credentialReview) return;
    const note = credentialReviewNote.trim();
    if (credentialReview.action === 'reject' && !note) {
      setReviewError(t('apiIntegrationApproval.errors.rejectionReasonRequired'));
      return;
    }
    setSubmitting(true);
    setReviewError('');
    try {
      await requestApi(
        `/credential-rotation-requests/${encodeURIComponent(credentialReview.request.id)}/${
          credentialReview.action
        }`,
        {
          method: 'POST',
          body: JSON.stringify(note ? { review_note: note } : {}),
        }
      );
      enqueueSnackbar(
        t(
          credentialReview.action === 'approve'
            ? 'apiIntegrationApproval.credentials.approved'
            : 'apiIntegrationApproval.credentials.rejected'
        )
      );
      setCredentialReview(null);
      setCredentialReviewNote('');
      await load();
    } catch (caught) {
      setReviewError(
        caught instanceof Error
          ? caught.message
          : t('apiIntegrationApproval.credentials.reviewFailed')
      );
    } finally {
      setSubmitting(false);
    }
  };

  const submitWebhookKeyReview = async () => {
    if (!webhookKeyReview) return;
    const note = webhookKeyReviewNote.trim();
    if (webhookKeyReview.action === 'reject' && !note) {
      setReviewError(t('apiIntegrationApproval.errors.rejectionReasonRequired'));
      return;
    }
    setSubmitting(true);
    setReviewError('');
    try {
      await requestApi(
        `/webhook-signing-key-requests/${encodeURIComponent(webhookKeyReview.request.id)}/${
          webhookKeyReview.action
        }`,
        {
          method: 'POST',
          body: JSON.stringify(note ? { review_note: note } : {}),
        }
      );
      enqueueSnackbar(
        t(
          webhookKeyReview.action === 'approve'
            ? 'apiIntegrationApproval.webhookKeys.approved'
            : 'apiIntegrationApproval.webhookKeys.rejected'
        )
      );
      setWebhookKeyReview(null);
      setWebhookKeyReviewNote('');
      await load();
    } catch (caught) {
      setReviewError(
        caught instanceof Error
          ? caught.message
          : t('apiIntegrationApproval.webhookKeys.reviewFailed')
      );
    } finally {
      setSubmitting(false);
    }
  };

  const columns = useMemo<GridColDef<IntegrationRequest>[]>(
    () => [
      {
        field: 'kind',
        headerName: t('apiIntegrationApproval.table.type'),
        width: 152,
        renderCell: ({ row }) => (
          <Stack direction="row" spacing={1} alignItems="center">
            <Iconify
              icon={requestKindIcon(row.kind)}
              width={21}
              sx={{ color: requestKindColor(row.kind) }}
            />
            <Typography variant="body2" sx={{ fontWeight: 600 }}>
              {t(`apiIntegrationApproval.types.${row.kind}`)}
            </Typography>
          </Stack>
        ),
      },
      {
        field: 'request',
        headerName: t('apiIntegrationApproval.table.request'),
        flex: 1,
        minWidth: 240,
        sortable: false,
        renderCell: ({ row }) => (
          <Box sx={{ minWidth: 0 }}>
            <Typography variant="body2" noWrap sx={{ fontWeight: 600 }}>
              {row.kind === 'webhook_signing_key'
                ? t('apiIntegrationApproval.webhookKeys.requestSummary')
                : requestPrimaryValue(row) || '—'}
            </Typography>
            <Typography variant="caption" color="text.secondary" noWrap>
              {t(`apiIntegrationApproval.actions.${row.action}`, { defaultValue: row.action })}
              {row.kind === 'webhook_signing_key'
                ? ` · ${t('apiIntegrationApproval.webhookKeys.windowHours', {
                    hours: row.overlap_hours,
                  })}`
                : ''}
              {row.label ? ` · ${row.label}` : ''}
              {row.environment
                ? ` · ${t(`apiIntegrationApproval.environments.${row.environment}`, {
                    defaultValue: row.environment,
                  })}`
                : ''}
            </Typography>
          </Box>
        ),
      },
      {
        field: 'requested_by',
        headerName: t('apiIntegrationApproval.table.requestedBy'),
        width: 210,
        renderCell: ({ row }) => (
          <Box sx={{ minWidth: 0 }}>
            <Typography variant="body2" noWrap>
              {row.requested_by || '—'}
            </Typography>
            <Typography variant="caption" color="text.secondary">
              {row.requested_via
                ? t(`apiIntegrationApproval.channels.${row.requested_via}`, {
                    defaultValue: row.requested_via,
                  })
                : '—'}
            </Typography>
          </Box>
        ),
      },
      {
        field: 'created_at',
        headerName: t('apiIntegrationApproval.table.submittedAt'),
        width: 170,
        valueFormatter: ({ value }) => formatDate(String(value || ''), locale),
      },
      {
        field: 'status',
        headerName: t('apiIntegrationApproval.table.status'),
        width: 122,
        renderCell: ({ row }) => (
          <Label color={requestStatusColor(row.status)}>
            {t(`apiIntegrationApproval.status.${row.status}`)}
          </Label>
        ),
      },
      {
        field: 'review',
        headerName: t('apiIntegrationApproval.table.actions'),
        width: 218,
        sortable: false,
        align: 'right',
        headerAlign: 'right',
        renderCell: ({ row }) => (
          <Stack direction="row" spacing={0.5} justifyContent="flex-end">
            <Button size="small" color="inherit" onClick={() => setDetailRequest(row)}>
              {t('common.view')}
            </Button>
            {row.status === 'pending' && (
              <>
                <Button
                  size="small"
                  color="success"
                  disabled={
                    Boolean(loadError) ||
                    (row.kind === 'webhook_signing_key' &&
                      !data.webhook_signing_key_management_configured)
                  }
                  onClick={() => openReview(row, 'approve')}
                >
                  {t('apiIntegrationApproval.buttons.approve')}
                </Button>
                <Button
                  size="small"
                  color="error"
                  disabled={Boolean(loadError)}
                  onClick={() => openReview(row, 'reject')}
                >
                  {t('apiIntegrationApproval.buttons.reject')}
                </Button>
              </>
            )}
          </Stack>
        ),
      },
    ],
    [data.webhook_signing_key_management_configured, loadError, locale, t]
  );

  if (!hasLoaded && !loading && loadError) {
    return (
      <>
        <Helmet>
          <title>{t('apiIntegrationApproval.pageTitle')} | SCC Digital Bank</title>
        </Helmet>
        <Container maxWidth={settings.themeStretch ? false : 'xl'}>
          <Box sx={{ mb: 4 }}>
            <Typography variant="h4">{t('apiIntegrationApproval.title')}</Typography>
            <Typography color="text.secondary" sx={{ mt: 0.5 }}>
              {t('apiIntegrationApproval.description')}
            </Typography>
          </Box>
          <Alert
            severity="error"
            action={
              <Button color="inherit" size="small" onClick={() => load()}>
                {t('common.retry')}
              </Button>
            }
          >
            {t('apiIntegrationApproval.errors.loadDetail', { error: loadError })}
          </Alert>
        </Container>
      </>
    );
  }

  return (
    <>
      <Helmet>
        <title>{t('apiIntegrationApproval.pageTitle')} | SCC Digital Bank</title>
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
            <Typography variant="h4">{t('apiIntegrationApproval.title')}</Typography>
            <Typography color="text.secondary" sx={{ mt: 0.5 }}>
              {t('apiIntegrationApproval.description')}
            </Typography>
          </Box>
          <Button
            color="inherit"
            startIcon={<Iconify icon="solar:refresh-linear" />}
            disabled={loading}
            onClick={() => load()}
          >
            {loading ? t('common.loading') : t('common.refreshData')}
          </Button>
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
            {t('apiIntegrationApproval.errors.staleDetail', { error: loadError })}
          </Alert>
        )}

        <Card sx={{ mb: 3, overflow: 'hidden' }}>
          <Box
            sx={{
              display: 'grid',
              gridTemplateColumns: {
                xs: 'repeat(2, minmax(0, 1fr))',
                md: 'repeat(4, minmax(0, 1fr))',
              },
            }}
          >
            <SummaryMetric
              label={t('apiIntegrationApproval.metrics.pending')}
              value={data.summary.pending}
              helper={t('apiIntegrationApproval.metrics.pendingHelper')}
              icon="solar:inbox-line-bold-duotone"
              color="warning.main"
            />
            <SummaryMetric
              label={t('apiIntegrationApproval.metrics.ipRules')}
              value={data.summary.ip_rules}
              helper={t('apiIntegrationApproval.metrics.ipRulesHelper')}
              icon="solar:shield-network-bold-duotone"
              color="info.main"
            />
            <SummaryMetric
              label={t('apiIntegrationApproval.metrics.webhooks')}
              value={data.summary.webhooks}
              helper={t('apiIntegrationApproval.metrics.webhooksHelper')}
              icon="solar:link-circle-bold-duotone"
              color="secondary.main"
            />
            <SummaryMetric
              label={t('apiIntegrationApproval.metrics.failedDeliveries')}
              value={data.summary.failed_deliveries}
              helper={t('apiIntegrationApproval.metrics.failedDeliveriesHelper')}
              icon="solar:danger-triangle-bold-duotone"
              color={data.summary.failed_deliveries ? 'error.main' : 'success.main'}
              last
            />
          </Box>
        </Card>

        <Card sx={{ mb: 3 }}>
          <Tabs
            value={activeTab}
            onChange={(_, value: ApiManagementTab) => setActiveTab(value)}
            variant="scrollable"
            scrollButtons="auto"
            allowScrollButtonsMobile
            aria-label={t('apiIntegrationApproval.title')}
            sx={{ px: { xs: 1, sm: 2 } }}
          >
            <Tab
              value="requests"
              label={t('apiIntegrationApproval.tabs.requests')}
              icon={<Iconify icon="solar:inbox-line-bold-duotone" width={20} />}
              iconPosition="start"
            />
            <Tab
              value="credentials"
              label={t('apiIntegrationApproval.tabs.credentials')}
              icon={<Iconify icon="solar:key-minimalistic-square-3-bold-duotone" width={20} />}
              iconPosition="start"
            />
            <Tab
              value="configuration"
              label={t('apiIntegrationApproval.tabs.configuration')}
              icon={<Iconify icon="solar:settings-bold-duotone" width={20} />}
              iconPosition="start"
            />
            <Tab
              value="deliveries"
              label={t('apiIntegrationApproval.tabs.deliveries')}
              icon={<Iconify icon="solar:history-bold-duotone" width={20} />}
              iconPosition="start"
            />
          </Tabs>
        </Card>

        {activeTab === 'credentials' && (
          <>
            <Card sx={{ mb: 3, p: 2.5 }}>
              <Stack
                direction={{ xs: 'column', md: 'row' }}
                justifyContent="space-between"
                spacing={2}
              >
                <Box>
                  <Typography variant="h6">
                    {t('apiIntegrationApproval.credentials.title')}
                  </Typography>
                  <Typography variant="body2" color="text.secondary" sx={{ mt: 0.25 }}>
                    {t('apiIntegrationApproval.credentials.description')}
                  </Typography>
                </Box>
                <Label color={data.credential_management_configured ? 'success' : 'error'}>
                  {t(
                    data.credential_management_configured
                      ? 'apiIntegrationApproval.credentials.configured'
                      : 'apiIntegrationApproval.credentials.notConfigured'
                  )}
                </Label>
              </Stack>

              {!data.credential_management_configured && (
                <Alert severity="error" sx={{ mt: 2 }}>
                  {t('apiIntegrationApproval.credentials.configurationRequired')}
                </Alert>
              )}

              <Box
                sx={{
                  mt: 2.5,
                  display: 'grid',
                  gridTemplateColumns: { xs: '1fr', lg: 'minmax(300px, 0.8fr) minmax(0, 1.2fr)' },
                  gap: 2.5,
                  alignItems: 'start',
                }}
              >
                <Box
                  sx={{
                    p: 2,
                    border: '1px solid',
                    borderColor: 'divider',
                    borderRadius: 1.5,
                    bgcolor: 'background.neutral',
                  }}
                >
                  <Typography variant="subtitle1">
                    {t('apiIntegrationApproval.credentials.current')}
                  </Typography>
                  <Stack spacing={1.25} sx={{ mt: 1.5 }}>
                    <AdminCredentialInfo
                      label="CF-Access-Client-Id"
                      value={activeCredential ? maskAdminClientId(activeCredential.client_id) : '—'}
                    />
                    <AdminCredentialInfo
                      label={t('apiIntegrationApproval.credentials.expiresAt')}
                      value={
                        activeCredential ? formatDate(activeCredential.expires_at, locale) : '—'
                      }
                    />
                    <AdminCredentialInfo
                      label={t('apiIntegrationApproval.credentials.secretStatus')}
                      value={
                        activeCredential
                          ? t(
                              activeCredential.secret_available
                                ? 'apiIntegrationApproval.credentials.awaitingPickup'
                                : 'apiIntegrationApproval.credentials.pickedUp'
                            )
                          : '—'
                      }
                    />
                  </Stack>
                </Box>

                <Box>
                  <Typography variant="subtitle1">
                    {t('apiIntegrationApproval.credentials.rotationQueue')}
                  </Typography>
                  <Stack spacing={1.25} sx={{ mt: 1.5 }}>
                    {credentialRotationRequests.length ? (
                      credentialRotationRequests.slice(0, 5).map((request) => (
                        <Box
                          key={request.id}
                          sx={{
                            p: 1.75,
                            border: '1px solid',
                            borderColor: 'divider',
                            borderRadius: 1.5,
                          }}
                        >
                          <Stack
                            direction={{ xs: 'column', sm: 'row' }}
                            justifyContent="space-between"
                            spacing={1.5}
                          >
                            <Box sx={{ minWidth: 0 }}>
                              <Stack direction="row" spacing={1} alignItems="center">
                                <Label color={requestStatusColor(request.status)}>
                                  {t(`apiIntegrationApproval.status.${request.status}`)}
                                </Label>
                                <Typography variant="subtitle2">
                                  {t('apiIntegrationApproval.credentials.windowHours', {
                                    hours: request.migration_window_hours,
                                  })}
                                </Typography>
                              </Stack>
                              <Typography variant="body2" sx={{ mt: 1 }}>
                                {request.reason}
                              </Typography>
                              <Typography variant="caption" color="text.secondary">
                                {formatDate(request.created_at, locale)}
                              </Typography>
                            </Box>
                            {request.status === 'pending' && (
                              <Stack direction="row" spacing={1} alignItems="center">
                                <Button
                                  color="error"
                                  size="small"
                                  onClick={() => {
                                    setCredentialReview({ request, action: 'reject' });
                                    setCredentialReviewNote('');
                                    setReviewError('');
                                  }}
                                >
                                  {t('apiIntegrationApproval.buttons.reject')}
                                </Button>
                                <Button
                                  variant="contained"
                                  size="small"
                                  disabled={!data.credential_management_configured}
                                  onClick={() => {
                                    setCredentialReview({ request, action: 'approve' });
                                    setCredentialReviewNote('');
                                    setReviewError('');
                                  }}
                                >
                                  {t('apiIntegrationApproval.buttons.approve')}
                                </Button>
                              </Stack>
                            )}
                          </Stack>
                        </Box>
                      ))
                    ) : (
                      <Typography variant="body2" color="text.secondary">
                        {t('apiIntegrationApproval.credentials.noRequests')}
                      </Typography>
                    )}
                  </Stack>
                </Box>
              </Box>
            </Card>

            <Card sx={{ mb: 3, p: 2.5 }}>
              <Stack
                direction={{ xs: 'column', md: 'row' }}
                justifyContent="space-between"
                spacing={2}
              >
                <Box>
                  <Typography variant="h6">
                    {t('apiIntegrationApproval.webhookKeys.title')}
                  </Typography>
                  <Typography variant="body2" color="text.secondary" sx={{ mt: 0.25 }}>
                    {t('apiIntegrationApproval.webhookKeys.description')}
                  </Typography>
                </Box>
                <Label color={data.webhook_signing_key_management_configured ? 'success' : 'error'}>
                  {t(
                    data.webhook_signing_key_management_configured
                      ? 'apiIntegrationApproval.credentials.configured'
                      : 'apiIntegrationApproval.credentials.notConfigured'
                  )}
                </Label>
              </Stack>
              <Box
                sx={{
                  mt: 2.5,
                  display: 'grid',
                  gridTemplateColumns: { xs: '1fr', lg: 'minmax(300px, 0.8fr) minmax(0, 1.2fr)' },
                  gap: 2.5,
                }}
              >
                <Box sx={{ p: 2, bgcolor: 'background.neutral', borderRadius: 1.5 }}>
                  <Typography variant="subtitle1">
                    {t('apiIntegrationApproval.webhookKeys.current')}
                  </Typography>
                  <Stack spacing={1.25} sx={{ mt: 1.5 }}>
                    {data.webhook_signing_keys.slice(0, 5).map((key) => (
                      <Stack
                        key={key.id}
                        direction="row"
                        justifyContent="space-between"
                        spacing={1}
                      >
                        <Box sx={{ minWidth: 0 }}>
                          <Typography variant="body2" sx={{ overflowWrap: 'anywhere' }}>
                            {key.id}
                          </Typography>
                          <Typography variant="caption" color="text.secondary">
                            {formatDate(key.created_at, locale)}
                          </Typography>
                        </Box>
                        <Label color={webhookKeyStatusColor(key.status)}>{key.status}</Label>
                      </Stack>
                    ))}
                    {!data.webhook_signing_keys.length && (
                      <Typography variant="body2" color="text.secondary">
                        {t('apiIntegrationApproval.webhookKeys.legacyFallback')}
                      </Typography>
                    )}
                  </Stack>
                </Box>
                <Box>
                  <Typography variant="subtitle1">
                    {t('apiIntegrationApproval.webhookKeys.queue')}
                  </Typography>
                  <Stack spacing={1.25} sx={{ mt: 1.5 }}>
                    {webhookSigningKeyRequests.length ? (
                      webhookSigningKeyRequests.slice(0, 5).map((request) => (
                        <Box
                          key={request.id}
                          sx={{
                            p: 1.75,
                            border: '1px solid',
                            borderColor: 'divider',
                            borderRadius: 1.5,
                          }}
                        >
                          <Stack
                            direction={{ xs: 'column', sm: 'row' }}
                            justifyContent="space-between"
                            spacing={1.5}
                          >
                            <Box>
                              <Stack direction="row" spacing={1} alignItems="center">
                                <Label color={requestStatusColor(request.status)}>
                                  {t(`apiIntegrationApproval.status.${request.status}`)}
                                </Label>
                                <Typography variant="subtitle2">
                                  {t('apiIntegrationApproval.webhookKeys.windowHours', {
                                    hours: request.overlap_hours,
                                  })}
                                </Typography>
                              </Stack>
                              <Typography variant="body2" sx={{ mt: 1 }}>
                                {request.reason}
                              </Typography>
                            </Box>
                            {request.status === 'pending' && (
                              <Stack direction="row" spacing={1}>
                                <Button
                                  color="error"
                                  size="small"
                                  onClick={() => {
                                    setWebhookKeyReview({ request, action: 'reject' });
                                    setWebhookKeyReviewNote('');
                                    setReviewError('');
                                  }}
                                >
                                  {t('apiIntegrationApproval.buttons.reject')}
                                </Button>
                                <Button
                                  variant="contained"
                                  size="small"
                                  disabled={!data.webhook_signing_key_management_configured}
                                  onClick={() => {
                                    setWebhookKeyReview({ request, action: 'approve' });
                                    setWebhookKeyReviewNote('');
                                    setReviewError('');
                                  }}
                                >
                                  {t('apiIntegrationApproval.buttons.approve')}
                                </Button>
                              </Stack>
                            )}
                          </Stack>
                        </Box>
                      ))
                    ) : (
                      <Typography variant="body2" color="text.secondary">
                        {t('apiIntegrationApproval.webhookKeys.noRequests')}
                      </Typography>
                    )}
                  </Stack>
                </Box>
              </Box>
            </Card>
          </>
        )}

        {activeTab === 'requests' && (
          <Card sx={{ mb: 3 }}>
            <Stack
              direction={{ xs: 'column', md: 'row' }}
              alignItems={{ md: 'center' }}
              justifyContent="space-between"
              spacing={2}
              sx={{ p: 2.5 }}
            >
              <Box>
                <Typography variant="h6">{t('apiIntegrationApproval.queue.title')}</Typography>
                <Typography variant="body2" color="text.secondary" sx={{ mt: 0.25 }}>
                  {t('apiIntegrationApproval.queue.description')}
                </Typography>
              </Box>
              <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.25}>
                <TextField
                  select
                  size="small"
                  label={t('apiIntegrationApproval.filters.type')}
                  value={kindFilter}
                  onChange={(event) => setKindFilter(event.target.value)}
                  sx={{ minWidth: 170 }}
                >
                  <MenuItem value="all">{t('apiIntegrationApproval.filters.allTypes')}</MenuItem>
                  <MenuItem value="ip_allowlist">
                    {t('apiIntegrationApproval.types.ip_allowlist')}
                  </MenuItem>
                  <MenuItem value="webhook">{t('apiIntegrationApproval.types.webhook')}</MenuItem>
                  <MenuItem value="webhook_signing_key">
                    {t('apiIntegrationApproval.types.webhook_signing_key')}
                  </MenuItem>
                </TextField>
                <TextField
                  select
                  size="small"
                  label={t('apiIntegrationApproval.filters.status')}
                  value={statusFilter}
                  onChange={(event) => setStatusFilter(event.target.value)}
                  sx={{ minWidth: 160 }}
                >
                  <MenuItem value="all">{t('apiIntegrationApproval.filters.allStatuses')}</MenuItem>
                  {(['pending', 'approved', 'rejected', 'cancelled'] as const).map((status) => (
                    <MenuItem key={status} value={status}>
                      {t(`apiIntegrationApproval.status.${status}`)}
                    </MenuItem>
                  ))}
                </TextField>
              </Stack>
            </Stack>
            <Divider />
            <DataGrid
              autoHeight
              rows={filteredRequests}
              columns={columns}
              getRowId={(row) => row.id}
              loading={loading}
              disableRowSelectionOnClick
              pageSizeOptions={[10, 25, 50]}
              initialState={{
                pagination: { paginationModel: { pageSize: 10, page: 0 } },
              }}
              sx={{
                border: 0,
                minHeight: 330,
                '& .MuiDataGrid-columnHeaders': { bgcolor: 'background.neutral' },
                '& .MuiDataGrid-cell': { py: 1 },
              }}
              localeText={{
                noRowsLabel: t('apiIntegrationApproval.empty.requests'),
              }}
            />
          </Card>
        )}

        {activeTab === 'configuration' && (
          <Box
            sx={{
              display: 'grid',
              gridTemplateColumns: { xs: '1fr', lg: 'minmax(0, 0.92fr) minmax(0, 1.08fr)' },
              gap: 3,
              alignItems: 'start',
            }}
          >
            <Card sx={{ p: 3 }}>
              <SectionHeading
                icon="solar:shield-network-bold-duotone"
                title={t('apiIntegrationApproval.ipRules.title')}
                description={t('apiIntegrationApproval.ipRules.description')}
              />
              <Stack spacing={0} sx={{ mt: 2.5 }}>
                {data.ip_allowlist.map((rule, index) => (
                  <Box key={rule.id}>
                    {index > 0 && <Divider />}
                    <Stack
                      direction={{ xs: 'column', sm: 'row' }}
                      alignItems={{ sm: 'center' }}
                      justifyContent="space-between"
                      spacing={1.5}
                      sx={{ py: 1.75 }}
                    >
                      <Box sx={{ minWidth: 0 }}>
                        <Typography variant="subtitle2">{rule.label || rule.cidr}</Typography>
                        <Typography variant="body2" color="text.secondary" noWrap>
                          {rule.cidr}
                        </Typography>
                        {rule.environment && (
                          <Typography variant="caption" color="text.secondary">
                            {t('apiIntegrationApproval.ipRules.egressPurpose', {
                              purpose: t(
                                `apiIntegrationApproval.environments.${rule.environment}`,
                                {
                                  defaultValue: rule.environment,
                                }
                              ),
                            })}
                          </Typography>
                        )}
                      </Box>
                      <Stack alignItems={{ sm: 'flex-end' }} spacing={0.5}>
                        <Label color={rule.enabled ? 'success' : 'default'}>
                          {rule.enabled
                            ? t('apiIntegrationApproval.status.enabled')
                            : t('apiIntegrationApproval.status.disabled')}
                        </Label>
                        <Typography variant="caption" color="text.secondary">
                          {formatDate(rule.updated_at, locale)}
                        </Typography>
                      </Stack>
                    </Stack>
                  </Box>
                ))}
                {!data.ip_allowlist.length && (
                  <InlineEmpty text={t('apiIntegrationApproval.empty.ipRules')} />
                )}
              </Stack>
            </Card>

            <Card sx={{ p: 3 }}>
              <SectionHeading
                icon="solar:link-circle-bold-duotone"
                title={t('apiIntegrationApproval.webhooks.title')}
                description={t('apiIntegrationApproval.webhooks.description')}
              />
              <Stack spacing={0} sx={{ mt: 2.5 }}>
                {data.webhooks.map((endpoint, index) => (
                  <Box key={endpoint.id}>
                    {index > 0 && <Divider />}
                    <Box sx={{ py: 1.75 }}>
                      <Stack
                        direction={{ xs: 'column', sm: 'row' }}
                        justifyContent="space-between"
                        spacing={1.5}
                      >
                        <Box sx={{ minWidth: 0 }}>
                          <Typography variant="subtitle2" noWrap>
                            {endpoint.url}
                          </Typography>
                          <Stack
                            direction="row"
                            spacing={0.75}
                            useFlexGap
                            flexWrap="wrap"
                            sx={{ mt: 1 }}
                          >
                            {endpoint.events.map((event) => (
                              <Chip key={event} label={event} size="small" variant="outlined" />
                            ))}
                            {!endpoint.events.length && (
                              <Typography variant="caption" color="text.secondary">
                                {t('apiIntegrationApproval.webhooks.noEvents')}
                              </Typography>
                            )}
                          </Stack>
                        </Box>
                        <Stack alignItems={{ sm: 'flex-end' }} spacing={0.5}>
                          <Label color={endpoint.enabled ? 'success' : 'default'}>
                            {endpoint.enabled
                              ? t('apiIntegrationApproval.status.enabled')
                              : t('apiIntegrationApproval.status.disabled')}
                          </Label>
                          <Typography variant="caption" color="text.secondary">
                            {t('apiIntegrationApproval.webhooks.lastDelivery', {
                              date: formatDate(endpoint.last_delivery_at, locale),
                            })}
                          </Typography>
                        </Stack>
                      </Stack>
                    </Box>
                  </Box>
                ))}
                {!data.webhooks.length && (
                  <InlineEmpty text={t('apiIntegrationApproval.empty.webhooks')} />
                )}
              </Stack>
            </Card>
          </Box>
        )}

        {activeTab === 'deliveries' && (
          <Card sx={{ p: 3 }}>
            <Stack
              direction={{ xs: 'column', sm: 'row' }}
              justifyContent="space-between"
              alignItems={{ sm: 'center' }}
              spacing={2}
            >
              <SectionHeading
                icon="solar:history-bold-duotone"
                title={t('apiIntegrationApproval.deliveries.title')}
                description={t('apiIntegrationApproval.deliveries.description')}
              />
              <Button
                variant="contained"
                startIcon={<Iconify icon="solar:restart-bold" />}
                disabled={Boolean(loadError) || !data.webhooks.some((item) => item.enabled)}
                onClick={() => openReplay()}
              >
                {t('apiIntegrationApproval.buttons.replay')}
              </Button>
            </Stack>
            <Stack spacing={0} sx={{ mt: 2.5 }}>
              {visibleDeliveries.map((delivery, index) => {
                const retryable = ['retry_scheduled', 'failed', 'dead_letter'].includes(
                  delivery.status
                );
                return (
                  <Box key={delivery.id}>
                    {index > 0 && <Divider />}
                    <Stack
                      role="button"
                      tabIndex={0}
                      direction={{ xs: 'column', md: 'row' }}
                      alignItems={{ md: 'center' }}
                      justifyContent="space-between"
                      spacing={2}
                      onClick={() => setSelectedDelivery(delivery)}
                      onKeyDown={(event) => {
                        if (event.target !== event.currentTarget) return;
                        if (event.key === 'Enter' || event.key === ' ') {
                          event.preventDefault();
                          setSelectedDelivery(delivery);
                        }
                      }}
                      sx={{
                        py: 1.75,
                        px: 1,
                        mx: -1,
                        borderRadius: 1,
                        cursor: 'pointer',
                        transition: (theme) => theme.transitions.create('background-color'),
                        '&:hover': { bgcolor: 'action.hover' },
                        '&:focus-visible': {
                          outline: '2px solid',
                          outlineColor: 'primary.main',
                          outlineOffset: 2,
                        },
                      }}
                    >
                      <Stack
                        direction="row"
                        spacing={1.5}
                        alignItems="flex-start"
                        sx={{ minWidth: 0 }}
                      >
                        <Box
                          sx={{
                            width: 38,
                            height: 38,
                            borderRadius: '50%',
                            display: 'grid',
                            placeItems: 'center',
                            bgcolor: retryable ? 'error.lighter' : 'background.neutral',
                            color: retryable ? 'error.main' : 'text.secondary',
                            flexShrink: 0,
                          }}
                        >
                          <Iconify
                            icon={deliveryStatusIcon(delivery.status, retryable)}
                            width={21}
                          />
                        </Box>
                        <Box sx={{ minWidth: 0 }}>
                          <Typography variant="subtitle2" noWrap>
                            {t(`apiIntegrationApproval.eventTitles.${delivery.event_type}`, {
                              defaultValue: delivery.event_type || delivery.id,
                            })}
                          </Typography>
                          <Typography variant="body2" color="text.secondary" noWrap>
                            {formatDate(webhookEventTime(delivery), locale)}
                          </Typography>
                        </Box>
                      </Stack>
                      <Stack direction="row" spacing={1.5} alignItems="center">
                        <Label color={deliveryStatusColor(delivery.status)}>
                          {t(`apiIntegrationApproval.deliveryStatus.${delivery.status}`, {
                            defaultValue: delivery.status || '—',
                          })}
                        </Label>
                        <Stack direction="row" spacing={0.75}>
                          {delivery.event_type !== 'webhook.test' && (
                            <Button
                              size="small"
                              variant="outlined"
                              color="inherit"
                              disabled={Boolean(loadError)}
                              onClick={(event) => {
                                event.stopPropagation();
                                openReplay(delivery);
                              }}
                            >
                              {t('apiIntegrationApproval.buttons.replay')}
                            </Button>
                          )}
                          {retryable && (
                            <Button
                              size="small"
                              variant="outlined"
                              color="inherit"
                              disabled={Boolean(loadError)}
                              onClick={(event) => {
                                event.stopPropagation();
                                setRetryDelivery(delivery);
                              }}
                            >
                              {t('apiIntegrationApproval.buttons.retry')}
                            </Button>
                          )}
                        </Stack>
                        <Iconify
                          icon="solar:alt-arrow-right-linear"
                          width={18}
                          sx={{ color: 'text.disabled', flexShrink: 0 }}
                        />
                      </Stack>
                    </Stack>
                  </Box>
                );
              })}
              {!data.deliveries.length && (
                <InlineEmpty text={t('apiIntegrationApproval.empty.deliveries')} />
              )}
            </Stack>
            {!!data.deliveries.length && (
              <TablePagination
                component="div"
                count={data.deliveries.length}
                page={deliveryPage}
                onPageChange={(_, page) => setDeliveryPage(page)}
                rowsPerPage={deliveryRowsPerPage}
                rowsPerPageOptions={[deliveryRowsPerPage]}
                labelRowsPerPage={t('apiIntegrationApproval.deliveries.rowsPerPage')}
                labelDisplayedRows={({ from, to, count }) =>
                  t('apiIntegrationApproval.deliveries.displayedRows', { from, to, count })
                }
                sx={{ mt: 1 }}
              />
            )}
          </Card>
        )}
      </Container>

      <RequestDetailDrawer
        request={detailRequest}
        locale={locale}
        reviewDisabled={Boolean(loadError)}
        approveDisabled={
          detailRequest?.kind === 'webhook_signing_key' &&
          !data.webhook_signing_key_management_configured
        }
        onClose={() => {
          if (!reviewAction) setDetailRequest(null);
        }}
        onApprove={(request) => openReview(request, 'approve')}
        onReject={(request) => openReview(request, 'reject')}
      />

      <WebhookDeliveryDetailDialog
        delivery={selectedDelivery}
        locale={locale}
        onClose={() => setSelectedDelivery(null)}
      />

      <Dialog
        open={Boolean(reviewAction)}
        onClose={() => {
          if (!submitting) {
            setReviewAction(null);
            setReviewError('');
          }
        }}
        fullWidth
        maxWidth="sm"
      >
        <DialogTitle>
          {t(
            reviewAction === 'approve'
              ? 'apiIntegrationApproval.review.approveTitle'
              : 'apiIntegrationApproval.review.rejectTitle'
          )}
        </DialogTitle>
        <DialogContent>
          <Typography color="text.secondary">
            {t(
              reviewAction === 'approve'
                ? 'apiIntegrationApproval.review.approveDescription'
                : 'apiIntegrationApproval.review.rejectDescription',
              { value: detailRequest ? requestPrimaryValue(detailRequest) : '' }
            )}
          </Typography>
          <TextField
            fullWidth
            multiline
            minRows={3}
            required={reviewAction === 'reject'}
            label={t(
              reviewAction === 'reject'
                ? 'apiIntegrationApproval.review.rejectionReason'
                : 'apiIntegrationApproval.review.approvalNote'
            )}
            value={reviewNote}
            error={Boolean(reviewError)}
            helperText={reviewError || t('apiIntegrationApproval.review.noteHelper')}
            onChange={(event) => {
              setReviewNote(event.target.value);
              setReviewError('');
            }}
            sx={{ mt: 3 }}
          />
        </DialogContent>
        <DialogActions>
          <Button color="inherit" disabled={submitting} onClick={() => setReviewAction(null)}>
            {t('common.cancel')}
          </Button>
          <Button
            variant="contained"
            color={reviewAction === 'reject' ? 'error' : 'success'}
            disabled={submitting}
            onClick={submitReview}
          >
            {submitting
              ? t('apiIntegrationApproval.buttons.processing')
              : t(
                  reviewAction === 'approve'
                    ? 'apiIntegrationApproval.buttons.confirmApprove'
                    : 'apiIntegrationApproval.buttons.confirmReject'
                )}
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog
        open={Boolean(credentialReview)}
        onClose={() => {
          if (!submitting) {
            setCredentialReview(null);
            setCredentialReviewNote('');
            setReviewError('');
          }
        }}
        fullWidth
        maxWidth="sm"
      >
        <DialogTitle>
          {t(
            credentialReview?.action === 'approve'
              ? 'apiIntegrationApproval.credentials.approveTitle'
              : 'apiIntegrationApproval.credentials.rejectTitle'
          )}
        </DialogTitle>
        <DialogContent>
          {credentialReview?.action === 'approve' && (
            <Alert severity="warning" sx={{ mb: 2.5 }}>
              {t('apiIntegrationApproval.credentials.approveWarning', {
                hours: credentialReview.request.migration_window_hours,
              })}
            </Alert>
          )}
          <Typography color="text.secondary">{credentialReview?.request.reason}</Typography>
          <TextField
            fullWidth
            multiline
            minRows={3}
            required={credentialReview?.action === 'reject'}
            label={t(
              credentialReview?.action === 'reject'
                ? 'apiIntegrationApproval.review.rejectionReason'
                : 'apiIntegrationApproval.review.approvalNote'
            )}
            value={credentialReviewNote}
            error={Boolean(reviewError)}
            helperText={reviewError || t('apiIntegrationApproval.review.noteHelper')}
            onChange={(event) => {
              setCredentialReviewNote(event.target.value);
              setReviewError('');
            }}
            sx={{ mt: 2.5 }}
          />
        </DialogContent>
        <DialogActions>
          <Button color="inherit" disabled={submitting} onClick={() => setCredentialReview(null)}>
            {t('common.cancel')}
          </Button>
          <Button
            variant="contained"
            color={credentialReview?.action === 'reject' ? 'error' : 'success'}
            disabled={submitting}
            onClick={submitCredentialReview}
          >
            {submitting
              ? t('apiIntegrationApproval.buttons.processing')
              : t(
                  credentialReview?.action === 'approve'
                    ? 'apiIntegrationApproval.buttons.confirmApprove'
                    : 'apiIntegrationApproval.buttons.confirmReject'
                )}
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog
        open={Boolean(webhookKeyReview)}
        onClose={() => {
          if (!submitting) {
            setWebhookKeyReview(null);
            setWebhookKeyReviewNote('');
            setReviewError('');
          }
        }}
        fullWidth
        maxWidth="sm"
      >
        <DialogTitle>
          {t(
            webhookKeyReview?.action === 'approve'
              ? 'apiIntegrationApproval.webhookKeys.approveTitle'
              : 'apiIntegrationApproval.webhookKeys.rejectTitle'
          )}
        </DialogTitle>
        <DialogContent>
          {webhookKeyReview?.action === 'approve' && (
            <Alert severity="warning" sx={{ mb: 2.5 }}>
              {t('apiIntegrationApproval.webhookKeys.approveWarning')}
            </Alert>
          )}
          <Typography color="text.secondary">{webhookKeyReview?.request.reason}</Typography>
          <TextField
            fullWidth
            multiline
            minRows={3}
            required={webhookKeyReview?.action === 'reject'}
            label={t(
              webhookKeyReview?.action === 'reject'
                ? 'apiIntegrationApproval.review.rejectionReason'
                : 'apiIntegrationApproval.review.approvalNote'
            )}
            value={webhookKeyReviewNote}
            error={Boolean(reviewError)}
            helperText={reviewError || t('apiIntegrationApproval.review.noteHelper')}
            onChange={(event) => {
              setWebhookKeyReviewNote(event.target.value);
              setReviewError('');
            }}
            sx={{ mt: 2.5 }}
          />
        </DialogContent>
        <DialogActions>
          <Button color="inherit" disabled={submitting} onClick={() => setWebhookKeyReview(null)}>
            {t('common.cancel')}
          </Button>
          <Button
            variant="contained"
            color={webhookKeyReview?.action === 'reject' ? 'error' : 'success'}
            disabled={submitting}
            onClick={submitWebhookKeyReview}
          >
            {submitting
              ? t('apiIntegrationApproval.buttons.processing')
              : t(
                  webhookKeyReview?.action === 'approve'
                    ? 'apiIntegrationApproval.buttons.confirmApprove'
                    : 'apiIntegrationApproval.buttons.confirmReject'
                )}
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog open={replayOpen} onClose={closeReplay} fullWidth maxWidth="sm">
        <DialogTitle>{t('apiIntegrationApproval.replay.title')}</DialogTitle>
        <DialogContent>
          <Alert severity="warning" sx={{ mb: 2.5 }}>
            {t('apiIntegrationApproval.replay.warning')}
          </Alert>
          {replaySource ? (
            <Stack spacing={0.75} sx={{ mb: 2.5 }}>
              <Typography variant="subtitle2">
                {t('apiIntegrationApproval.replay.sourceDelivery')}
              </Typography>
              <Typography variant="body2" color="text.secondary">
                {replaySource.id}
              </Typography>
              <Typography variant="body2">
                {replaySource.event_type} · {replaySource.resource_id}
              </Typography>
            </Stack>
          ) : (
            <Stack spacing={2.5} sx={{ mb: 2.5 }}>
              <TextField
                select
                fullWidth
                required
                label={t('apiIntegrationApproval.replay.eventType')}
                value={replayEventType}
                onChange={(event) => {
                  setReplayEventType(event.target.value);
                  setReplayError('');
                }}
              >
                {WEBHOOK_REPLAY_EVENTS.map((eventType) => (
                  <MenuItem key={eventType} value={eventType}>
                    {t(`apiIntegrationApproval.replay.events.${eventType}`, {
                      defaultValue: eventType,
                    })}
                  </MenuItem>
                ))}
              </TextField>
              <TextField
                fullWidth
                required
                label={t('apiIntegrationApproval.replay.resourceId')}
                value={replayResourceId}
                onChange={(event) => {
                  setReplayResourceId(event.target.value);
                  setReplayError('');
                }}
              />
            </Stack>
          )}
          <TextField
            fullWidth
            required
            multiline
            minRows={3}
            label={t('apiIntegrationApproval.replay.reason')}
            value={replayReason}
            error={Boolean(replayError)}
            helperText={replayError || t('apiIntegrationApproval.replay.reasonHelper')}
            inputProps={{ maxLength: 500 }}
            onChange={(event) => {
              setReplayReason(event.target.value);
              setReplayError('');
            }}
          />
        </DialogContent>
        <DialogActions>
          <Button color="inherit" disabled={submitting} onClick={closeReplay}>
            {t('common.cancel')}
          </Button>
          <Button variant="contained" disabled={submitting} onClick={submitReplay}>
            {submitting
              ? t('apiIntegrationApproval.buttons.processing')
              : t('apiIntegrationApproval.buttons.confirmReplay')}
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog
        open={Boolean(retryDelivery)}
        onClose={() => {
          if (!submitting) setRetryDelivery(null);
        }}
        fullWidth
        maxWidth="xs"
      >
        <DialogTitle>{t('apiIntegrationApproval.retry.title')}</DialogTitle>
        <DialogContent>
          <Typography color="text.secondary">
            {t('apiIntegrationApproval.retry.description', {
              event: retryDelivery?.event_type || retryDelivery?.id || '',
            })}
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button color="inherit" disabled={submitting} onClick={() => setRetryDelivery(null)}>
            {t('common.cancel')}
          </Button>
          <Button variant="contained" disabled={submitting} onClick={submitRetry}>
            {submitting
              ? t('apiIntegrationApproval.buttons.processing')
              : t('apiIntegrationApproval.buttons.confirmRetry')}
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
}

function WebhookDeliveryDetailDialog({
  delivery,
  locale,
  onClose,
}: {
  delivery: WebhookDelivery | null;
  locale: string;
  onClose: () => void;
}) {
  const { t } = useTranslation('admin');
  const attemptTime = delivery?.last_attempt_at || delivery?.delivered_at || delivery?.updated_at;
  const responseText = delivery?.last_error
    ? delivery.last_error
    : t('apiIntegrationApproval.deliveryDetails.responseNotRecorded');

  return (
    <Dialog open={Boolean(delivery)} onClose={onClose} fullWidth maxWidth="lg">
      <DialogTitle sx={{ py: 2, pr: 7 }}>
        <Stack direction="row" spacing={1.25} alignItems="center">
          <Box
            sx={{
              width: 36,
              height: 36,
              borderRadius: 1,
              display: 'grid',
              placeItems: 'center',
              bgcolor: 'background.neutral',
            }}
          >
            <Iconify icon="solar:link-circle-bold-duotone" width={22} />
          </Box>
          <Typography variant="h6">{t('apiIntegrationApproval.deliveryDetails.title')}</Typography>
        </Stack>
        <IconButton
          aria-label={t('apiIntegrationApproval.buttons.close')}
          onClick={onClose}
          sx={{ position: 'absolute', top: 14, right: 14 }}
        >
          <Iconify icon="solar:close-circle-linear" />
        </IconButton>
      </DialogTitle>

      <DialogContent dividers sx={{ p: 0 }}>
        {delivery && (
          <Box
            sx={{
              display: 'grid',
              gridTemplateColumns: { xs: '1fr', md: 'minmax(0, 1fr) minmax(320px, 0.82fr)' },
              minHeight: { md: 560 },
            }}
          >
            <Stack spacing={2.5} sx={{ p: { xs: 2.5, md: 3 } }}>
              <Stack direction="row" justifyContent="space-between" spacing={2}>
                <Box sx={{ minWidth: 0 }}>
                  <Typography variant="h6" sx={{ overflowWrap: 'anywhere' }}>
                    {t(`apiIntegrationApproval.eventTitles.${delivery.event_type}`, {
                      defaultValue: delivery.event_type || delivery.id,
                    })}
                  </Typography>
                  <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
                    {delivery.event_type || '—'}
                  </Typography>
                  <Typography variant="caption" color="text.secondary">
                    {delivery.endpoint_id || '—'}
                  </Typography>
                </Box>
                <Label color={deliveryStatusColor(delivery.status)} sx={{ flexShrink: 0 }}>
                  {t(`apiIntegrationApproval.deliveryStatus.${delivery.status}`, {
                    defaultValue: delivery.status || '—',
                  })}
                </Label>
              </Stack>

              <Divider />

              <Box
                sx={{
                  display: 'grid',
                  gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, minmax(0, 1fr))' },
                  gap: 2.5,
                }}
              >
                <AdminCredentialInfo
                  label={t('apiIntegrationApproval.deliveryDetails.attempts')}
                  value={String(delivery.attempt_count)}
                />
                <AdminCredentialInfo
                  label={t('apiIntegrationApproval.deliveryDetails.createdAt')}
                  value={formatDate(delivery.created_at, locale)}
                />
                <AdminCredentialInfo
                  label={t('apiIntegrationApproval.deliveryDetails.eventTime')}
                  value={formatDate(webhookEventTime(delivery), locale)}
                />
                <AdminCredentialInfo
                  label={t('apiIntegrationApproval.deliveryDetails.entityId')}
                  value={delivery.resource_id || '—'}
                />
                <AdminCredentialInfo
                  label={t('apiIntegrationApproval.deliveryDetails.resourceType')}
                  value={delivery.resource_type || '—'}
                />
                <AdminCredentialInfo
                  label={t('apiIntegrationApproval.deliveryDetails.application')}
                  value={delivery.application_id || '—'}
                />
              </Box>

              <Divider />

              <Box>
                <Typography variant="subtitle1" sx={{ mb: 1.25 }}>
                  {t('apiIntegrationApproval.deliveryDetails.payload')}
                </Typography>
                <Box
                  component="pre"
                  sx={{
                    m: 0,
                    p: 2,
                    maxHeight: 300,
                    overflow: 'auto',
                    whiteSpace: 'pre-wrap',
                    overflowWrap: 'anywhere',
                    border: '1px solid',
                    borderColor: 'divider',
                    borderRadius: 1.5,
                    bgcolor: 'background.neutral',
                    fontFamily: 'monospace',
                    fontSize: 13,
                    lineHeight: 1.65,
                  }}
                >
                  {formatJson(delivery.payload)}
                </Box>
              </Box>

              <Divider />

              <Box>
                <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 1.25 }}>
                  <Typography variant="subtitle1">
                    {t('apiIntegrationApproval.deliveryDetails.latestResponse')}
                  </Typography>
                  {delivery.response_status && (
                    <Typography variant="body2" color="text.secondary">
                      HTTP {delivery.response_status}
                    </Typography>
                  )}
                </Stack>
                <Box
                  component="pre"
                  sx={{
                    m: 0,
                    p: 2,
                    whiteSpace: 'pre-wrap',
                    overflowWrap: 'anywhere',
                    border: '1px solid',
                    borderColor: delivery.last_error ? 'error.light' : 'divider',
                    borderRadius: 1.5,
                    bgcolor: 'background.neutral',
                    color: delivery.last_error ? 'error.main' : 'text.secondary',
                    fontFamily: 'monospace',
                    fontSize: 13,
                  }}
                >
                  {responseText}
                </Box>
              </Box>
            </Stack>

            <Box
              sx={{
                borderLeft: { md: '1px solid' },
                borderTop: { xs: '1px solid', md: 0 },
                borderColor: { xs: 'divider', md: 'divider' },
              }}
            >
              <Stack
                direction="row"
                justifyContent="space-between"
                alignItems="center"
                sx={{ px: 3, py: 2.25, borderBottom: '1px solid', borderColor: 'divider' }}
              >
                <Typography variant="h6">
                  {t('apiIntegrationApproval.deliveryDetails.deliveryAttempts')}
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  {t('apiIntegrationApproval.deliveryDetails.attemptCount', {
                    count: delivery.attempt_count,
                  })}
                </Typography>
              </Stack>
              <Stack direction="row" spacing={1.5} alignItems="flex-start" sx={{ p: 3 }}>
                <Iconify
                  icon={
                    delivery.status === 'delivered' || delivery.status === 'success'
                      ? 'solar:check-circle-bold'
                      : 'solar:danger-circle-bold'
                  }
                  width={22}
                  sx={{
                    mt: 0.25,
                    color:
                      delivery.status === 'delivered' || delivery.status === 'success'
                        ? 'success.main'
                        : 'error.main',
                    flexShrink: 0,
                  }}
                />
                <Box sx={{ minWidth: 0, flex: 1 }}>
                  <Stack direction="row" justifyContent="space-between" spacing={1.5}>
                    <Box>
                      <Typography variant="subtitle1">
                        {t('apiIntegrationApproval.deliveryDetails.latestAttempt')}
                      </Typography>
                      <Typography variant="body2" color="text.secondary" sx={{ mt: 0.25 }}>
                        {delivery.response_status ? `HTTP ${delivery.response_status}` : '—'}
                      </Typography>
                    </Box>
                    <Typography variant="body2" color="text.secondary" sx={{ flexShrink: 0 }}>
                      {formatDate(attemptTime || '', locale)}
                    </Typography>
                  </Stack>
                  {delivery.next_attempt_at && (
                    <Typography
                      variant="caption"
                      color="text.secondary"
                      sx={{ mt: 1, display: 'block' }}
                    >
                      {t('apiIntegrationApproval.deliveryDetails.nextAttempt', {
                        date: formatDate(delivery.next_attempt_at, locale),
                      })}
                    </Typography>
                  )}
                </Box>
              </Stack>
            </Box>
          </Box>
        )}
      </DialogContent>
      <DialogActions sx={{ justifyContent: 'flex-start', px: 3, py: 1.5 }}>
        <Button color="inherit" onClick={onClose}>
          {t('apiIntegrationApproval.buttons.close')}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

function AdminCredentialInfo({ label, value }: { label: string; value: string }) {
  return (
    <Box>
      <Typography variant="caption" color="text.secondary">
        {label}
      </Typography>
      <Typography variant="body2" sx={{ mt: 0.25, fontWeight: 600, overflowWrap: 'anywhere' }}>
        {value}
      </Typography>
    </Box>
  );
}

function maskAdminClientId(value: string) {
  if (!value) return '—';
  if (value.length <= 18) return value;
  return `${value.slice(0, 10)}••••••${value.slice(-12)}`;
}

function SummaryMetric({
  label,
  value,
  helper,
  icon,
  color,
  last = false,
}: {
  label: string;
  value: number;
  helper: string;
  icon: string;
  color: string;
  last?: boolean;
}) {
  return (
    <Box
      sx={{
        p: { xs: 2.25, md: 3 },
        position: 'relative',
        '&::after': {
          content: '""',
          position: 'absolute',
          right: 0,
          top: { xs: '18%', md: '22%' },
          width: '1px',
          height: { xs: '64%', md: '56%' },
          bgcolor: 'divider',
          display: last ? 'none' : 'block',
        },
      }}
    >
      <Stack direction="row" justifyContent="space-between" spacing={1.5}>
        <Box>
          <Typography variant="body2" color="text.secondary">
            {label}
          </Typography>
          <Typography variant="h3" sx={{ mt: 0.75, lineHeight: 1 }}>
            {Number.isFinite(value) ? value : 0}
          </Typography>
          <Typography variant="caption" color="text.secondary" sx={{ mt: 1, display: 'block' }}>
            {helper}
          </Typography>
        </Box>
        <Iconify icon={icon} width={27} sx={{ color, flexShrink: 0 }} />
      </Stack>
    </Box>
  );
}

function SectionHeading({
  icon,
  title,
  description,
}: {
  icon: string;
  title: string;
  description: string;
}) {
  return (
    <Stack direction="row" spacing={1.5} alignItems="flex-start">
      <Iconify icon={icon} width={25} sx={{ color: 'text.secondary', mt: 0.25 }} />
      <Box>
        <Typography variant="h6">{title}</Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mt: 0.25 }}>
          {description}
        </Typography>
      </Box>
    </Stack>
  );
}

function InlineEmpty({ text }: { text: string }) {
  return (
    <Stack alignItems="center" spacing={1} sx={{ py: 5 }}>
      <Iconify icon="solar:inbox-line-bold-duotone" width={32} sx={{ color: 'text.disabled' }} />
      <Typography variant="body2" color="text.secondary">
        {text}
      </Typography>
    </Stack>
  );
}

function RequestDetailDrawer({
  request,
  locale,
  reviewDisabled,
  approveDisabled,
  onClose,
  onApprove,
  onReject,
}: {
  request: IntegrationRequest | null;
  locale: string;
  reviewDisabled: boolean;
  approveDisabled: boolean;
  onClose: () => void;
  onApprove: (request: IntegrationRequest) => void;
  onReject: (request: IntegrationRequest) => void;
}) {
  const { t } = useTranslation('admin');
  if (!request) return null;

  let details: string[][];
  if (request.kind === 'ip_allowlist') {
    details = [
      [t('apiIntegrationApproval.details.cidr'), request.cidr],
      [t('apiIntegrationApproval.details.label'), request.label],
      [t('apiIntegrationApproval.details.environment'), request.environment],
    ];
  } else if (request.kind === 'webhook_signing_key') {
    details = [
      [
        t('apiIntegrationApproval.details.change'),
        t('apiIntegrationApproval.webhookKeys.requestSummary'),
      ],
      [
        t('apiIntegrationApproval.details.overlapWindow'),
        t('apiIntegrationApproval.webhookKeys.windowHours', {
          hours: request.overlap_hours,
        }),
      ],
    ];
  } else {
    details = [
      [t('apiIntegrationApproval.details.url'), request.webhook_url],
      [t('apiIntegrationApproval.details.events'), request.events.join(', ')],
    ];
  }

  return (
    <Drawer
      anchor="right"
      open
      onClose={onClose}
      PaperProps={{ sx: { width: { xs: '100%', sm: 500 } } }}
    >
      <Stack sx={{ height: '100%' }}>
        <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ p: 3 }}>
          <Box>
            <Typography variant="h5">{t('apiIntegrationApproval.details.title')}</Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mt: 0.25 }}>
              {request.id}
            </Typography>
          </Box>
          <Button color="inherit" onClick={onClose}>
            {t('apiIntegrationApproval.buttons.close')}
          </Button>
        </Stack>
        <Divider />
        <Box sx={{ p: 3, flex: 1, overflowY: 'auto' }}>
          <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 3 }}>
            <Label color={requestStatusColor(request.status)}>
              {t(`apiIntegrationApproval.status.${request.status}`)}
            </Label>
            <Chip
              size="small"
              variant="outlined"
              label={t(`apiIntegrationApproval.types.${request.kind}`)}
            />
            <Chip
              size="small"
              variant="outlined"
              label={t(`apiIntegrationApproval.actions.${request.action}`, {
                defaultValue: request.action,
              })}
            />
          </Stack>

          <DetailSection title={t('apiIntegrationApproval.details.requestContent')}>
            {details.map(([label, value]) => (
              <DetailRow key={label} label={label} value={value || '—'} />
            ))}
            {request.target_id && (
              <DetailRow
                label={t('apiIntegrationApproval.details.targetId')}
                value={request.target_id}
              />
            )}
          </DetailSection>

          <DetailSection title={t('apiIntegrationApproval.details.requestInformation')}>
            <DetailRow
              label={t('apiIntegrationApproval.table.requestedBy')}
              value={request.requested_by || '—'}
            />
            <DetailRow
              label={t('apiIntegrationApproval.details.channel')}
              value={
                request.requested_via
                  ? t(`apiIntegrationApproval.channels.${request.requested_via}`, {
                      defaultValue: request.requested_via,
                    })
                  : '—'
              }
            />
            <DetailRow
              label={t('apiIntegrationApproval.table.submittedAt')}
              value={formatDate(request.created_at, locale)}
            />
            <DetailRow
              label={t('apiIntegrationApproval.details.reason')}
              value={request.reason || '—'}
              multiline
            />
          </DetailSection>

          {request.status !== 'pending' && (
            <DetailSection title={t('apiIntegrationApproval.details.reviewInformation')}>
              <DetailRow
                label={t('apiIntegrationApproval.details.reviewedBy')}
                value={request.reviewed_by || '—'}
              />
              <DetailRow
                label={t('apiIntegrationApproval.details.reviewedAt')}
                value={formatDate(request.reviewed_at, locale)}
              />
              <DetailRow
                label={t('apiIntegrationApproval.details.reviewNote')}
                value={request.review_note || '—'}
                multiline
              />
            </DetailSection>
          )}
        </Box>
        {request.status === 'pending' && (
          <>
            <Divider />
            <Stack direction="row" spacing={1.5} sx={{ p: 3 }}>
              <Button
                fullWidth
                color="error"
                variant="outlined"
                disabled={reviewDisabled}
                onClick={() => onReject(request)}
              >
                {t('apiIntegrationApproval.buttons.reject')}
              </Button>
              <Button
                fullWidth
                color="success"
                variant="contained"
                disabled={reviewDisabled || approveDisabled}
                onClick={() => onApprove(request)}
              >
                {t('apiIntegrationApproval.buttons.approve')}
              </Button>
            </Stack>
          </>
        )}
      </Stack>
    </Drawer>
  );
}

function DetailSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <Box sx={{ mb: 3.5 }}>
      <Typography variant="overline" color="text.secondary">
        {title}
      </Typography>
      <Stack spacing={1.5} sx={{ mt: 1.25 }}>
        {children}
      </Stack>
    </Box>
  );
}

function DetailRow({
  label,
  value,
  multiline = false,
}: {
  label: string;
  value: string;
  multiline?: boolean;
}) {
  return (
    <Box>
      <Typography variant="caption" color="text.secondary">
        {label}
      </Typography>
      <Typography
        variant="body2"
        sx={{
          mt: 0.25,
          fontWeight: 600,
          whiteSpace: multiline ? 'pre-wrap' : 'normal',
          overflowWrap: 'anywhere',
        }}
      >
        {value}
      </Typography>
    </Box>
  );
}
