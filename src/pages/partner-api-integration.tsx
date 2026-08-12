import { FormEvent, ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Card,
  Checkbox,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  ListItemText,
  MenuItem,
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
import { useTranslation } from 'react-i18next';
import { Link as RouterLink } from 'react-router-dom';
import Iconify from 'src/components/iconify';
import Label from 'src/components/label';
import { ConfirmDialog } from 'src/components/custom-dialog';
import { getLocalizedApiError } from 'src/locales/api-error';
import { browserApiFetch } from 'src/utils/browser-api';

const PORTAL_API_BASE = '/api/browser/v1/portal';
const PARTNER_API_BASE_URL = 'https://moventra.xyz/api/v1';

export const WEBHOOK_EVENTS = [
  {
    value: 'application.status_changed',
    label: '开户状态变化',
  },
  {
    value: 'va_account.activated',
    label: 'VA 账户已开通',
  },
  {
    value: 'fund_transaction.status_changed',
    label: '资金交易状态变化',
  },
  {
    value: 'fiat_deposit.cleared_and_converted',
    label: '法币入账已清算并兑换',
  },
  {
    value: 'otc_order.status_changed',
    label: 'OTC 订单状态变化',
  },
  {
    value: 'usdt_sweep.locked',
    label: 'USDT 归集已锁定',
  },
  {
    value: 'usdt_sweep.completed',
    label: 'USDT 归集已完成',
  },
  {
    value: 'usdt_sweep.cancelled',
    label: 'USDT 归集已取消',
  },
] as const;

const IP_ENVIRONMENTS = [
  { value: 'production', label: '生产主出口' },
  { value: 'disaster_recovery', label: '灾备出口' },
  { value: 'development', label: '开发测试出口' },
] as const;

type TranslationValues = Record<string, string | number | boolean | undefined>;
export type Translate = (key: string, values?: TranslationValues) => string;
type RequestKind = 'ip_allowlist' | 'webhook';
type IpRequestAction = 'add' | 'remove';
type WebhookRequestAction = 'upsert' | 'disable';
type LoadScope = 'all' | 'ip' | 'webhook';
type IntegrationTab = 'credentials' | 'webhooks' | 'ip-allowlist';

type ApiCredential = {
  id: string;
  clientId: string;
  duration: string;
  expiresAt: string;
  previousSecretExpiresAt: string;
  status: string;
  revealStatus: string;
  secretAvailable: boolean;
  updatedAt: string;
  revealedAt: string;
  createdAt: string;
  secretVersion: number;
};

type CredentialRotationRequest = {
  id: string;
  status: string;
  reason: string;
  migrationWindowHours: number;
  createdAt: string;
  reviewedAt: string;
  reviewNote: string;
};

type WebhookSigningKey = {
  id: string;
  status: string;
  revealStatus: string;
  secretAvailable: boolean;
  overlapHours: number;
  createdAt: string;
  activatedAt: string;
  expiresAt: string;
  secretVersion: number;
};

type WebhookSigningKeyRequest = {
  id: string;
  status: string;
  reason: string;
  overlapHours: number;
  createdAt: string;
  reviewNote: string;
};

type IpAllowlistEntry = {
  id: string;
  label: string;
  cidr: string;
  environment: string;
  enabled: boolean;
  status: string;
  createdAt: string;
  updatedAt: string;
};

type WebhookEndpoint = {
  id: string;
  endpointUrl: string;
  events: string[];
  status: string;
  lastDeliveryAt: string;
  lastSuccessAt: string;
  createdAt: string;
  updatedAt: string;
};

type IntegrationRequest = {
  id: string;
  kind: RequestKind;
  action: string;
  status: string;
  cidr: string;
  label: string;
  environment: string;
  targetEntryId: string;
  endpointUrl: string;
  events: string[];
  reason: string;
  createdAt: string;
  updatedAt: string;
  reviewedAt: string;
  reviewNote: string;
};

export type WebhookDelivery = {
  id: string;
  eventType: string;
  status: string;
  httpStatus: number | null;
  attemptCount: number;
  createdAt: string;
  deliveredAt: string;
  requestId: string;
  error: string;
  payload: string;
  endpointUrl: string;
  resourceId: string;
  resourceStatus: string;
};

type IntegrationSnapshot = {
  summary: {
    pending: number;
    approvedIpRules: number;
    webhookEndpoints: number;
    apiCredentials: number;
    failedDeliveries: number;
  };
  security: {
    accessServiceTokenRequired: boolean;
    ipAllowlistEnabled: boolean;
    rateLimit: {
      enabled: boolean;
      limit: number;
      periodSeconds: number;
    };
    credentialManagement: {
      configured: boolean;
    };
  };
  credentials: ApiCredential[];
  credentialRotationRequests: CredentialRotationRequest[];
  webhookSigningKeys: WebhookSigningKey[];
  webhookSigningKeyRequests: WebhookSigningKeyRequest[];
  ipAllowlist: IpAllowlistEntry[];
  webhooks: WebhookEndpoint[];
  requests: IntegrationRequest[];
  deliveries: WebhookDelivery[];
};

type Confirmation =
  | {
      kind: 'ip';
      payload: {
        action: IpRequestAction;
        cidr?: string;
        label?: string;
        environment?: string;
        target_entry_id?: string;
        reason: string;
      };
    }
  | {
      kind: 'webhook';
      payload: {
        action: WebhookRequestAction;
        endpoint_url?: string;
        events?: string[];
        reason: string;
      };
    }
  | {
      kind: 'cancel';
      request: IntegrationRequest;
    }
  | {
      kind: 'test';
    };

type PortalApiError = Error & {
  code?: string;
  requestId?: string;
};

const EMPTY_SNAPSHOT: IntegrationSnapshot = {
  summary: {
    pending: 0,
    approvedIpRules: 0,
    webhookEndpoints: 0,
    apiCredentials: 0,
    failedDeliveries: 0,
  },
  security: {
    accessServiceTokenRequired: true,
    ipAllowlistEnabled: false,
    rateLimit: {
      enabled: true,
      limit: 120,
      periodSeconds: 60,
    },
    credentialManagement: {
      configured: false,
    },
  },
  credentials: [],
  credentialRotationRequests: [],
  webhookSigningKeys: [],
  webhookSigningKeyRequests: [],
  ipAllowlist: [],
  webhooks: [],
  requests: [],
  deliveries: [],
};

export async function portalApi(path: string, init?: RequestInit) {
  let response: Response;
  try {
    response = await browserApiFetch(`${PORTAL_API_BASE}${path}`, {
      ...init,
      credentials: 'same-origin',
      headers: {
        ...(init?.body ? { 'content-type': 'application/json' } : {}),
        ...init?.headers,
      },
    });
  } catch {
    const error = new Error('session_unavailable') as PortalApiError;
    error.code = 'session_unavailable';
    throw error;
  }

  const contentType = response.headers.get('content-type') || '';
  let body: any = null;
  if (response.status !== 204 && contentType.includes('application/json')) {
    try {
      body = await response.json();
    } catch {
      body = null;
    }
  }

  if (!response.ok) {
    const code = typeof body?.error?.code === 'string' ? body.error.code : '';
    const requestId =
      response.headers.get('x-request-id') ||
      (typeof body?.error?.details?.request_id === 'string' ? body.error.details.request_id : '');
    const error = new Error(code || 'request_failed') as PortalApiError;
    error.code = code;
    error.requestId = requestId;
    throw error;
  }

  if (response.status !== 204 && !body) {
    const error = new Error('session_unavailable') as PortalApiError;
    error.code = 'session_unavailable';
    throw error;
  }

  return body;
}

export default function PartnerApiIntegration() {
  const { t, i18n } = useTranslation('portal');
  const translate = useCallback(
    (key: string, values?: TranslationValues) =>
      t(key, { keySeparator: false, defaultValue: key, ...values }),
    [t]
  );
  const locale = i18n.language === 'cn' ? 'zh-CN' : 'en-US';
  const requestSequence = useRef(0);
  const activeLoads = useRef({ ip: 0, webhook: 0 });
  const [snapshot, setSnapshot] = useState<IntegrationSnapshot>(EMPTY_SNAPSHOT);
  const [activeTab, setActiveTab] = useState<IntegrationTab>('credentials');
  const [hasLoaded, setHasLoaded] = useState(false);
  const [ipLoading, setIpLoading] = useState(true);
  const [webhookLoading, setWebhookLoading] = useState(true);
  const [ipError, setIpError] = useState('');
  const [webhookError, setWebhookError] = useState('');
  const [ipMutation, setIpMutation] = useState('');
  const [webhookMutation, setWebhookMutation] = useState('');
  const [ipDialogOpen, setIpDialogOpen] = useState(false);
  const [webhookDialogOpen, setWebhookDialogOpen] = useState(false);
  const [selectedWebhookId, setSelectedWebhookId] = useState('');
  const [selectedDelivery, setSelectedDelivery] = useState<WebhookDelivery | null>(null);
  const [cancelMutation, setCancelMutation] = useState('');
  const [successMessage, setSuccessMessage] = useState('');
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null);
  const [ipFormErrors, setIpFormErrors] = useState<Record<string, string>>({});
  const [webhookFormErrors, setWebhookFormErrors] = useState<Record<string, string>>({});
  const [ipForm, setIpForm] = useState({
    action: 'add' as IpRequestAction,
    label: '',
    environment: 'production',
    cidr: '',
    targetEntryId: '',
    reason: '',
  });
  const [webhookForm, setWebhookForm] = useState({
    action: 'upsert' as WebhookRequestAction,
    endpointUrl: '',
    events: WEBHOOK_EVENTS.map((event) => event.value) as string[],
    reason: '',
  });
  const [credentialMutation, setCredentialMutation] = useState('');
  const [credentialDialogOpen, setCredentialDialogOpen] = useState(false);
  const [credentialDialogError, setCredentialDialogError] = useState('');
  const [credentialDialogSubmitted, setCredentialDialogSubmitted] = useState(false);
  const [credentialError, setCredentialError] = useState('');
  const [rotationReason, setRotationReason] = useState('');
  const [migrationWindowHours, setMigrationWindowHours] = useState(48);
  const [revealCredential, setRevealCredential] = useState<ApiCredential | null>(null);
  const [totpCode, setTotpCode] = useState('');
  const [revealedSecret, setRevealedSecret] = useState<{
    clientId: string;
    clientSecret: string;
  } | null>(null);
  const [webhookKeyDialogOpen, setWebhookKeyDialogOpen] = useState(false);
  const [webhookKeyReason, setWebhookKeyReason] = useState('');
  const [webhookKeyOverlapHours, setWebhookKeyOverlapHours] = useState(48);
  const [webhookKeyMutation, setWebhookKeyMutation] = useState('');
  const [webhookKeyError, setWebhookKeyError] = useState('');
  const [webhookKeyStepUp, setWebhookKeyStepUp] = useState<{
    key: WebhookSigningKey;
    action: 'reveal' | 'activate';
  } | null>(null);
  const [webhookKeyTotpCode, setWebhookKeyTotpCode] = useState('');
  const [revealedWebhookSecret, setRevealedWebhookSecret] = useState<{
    keyId: string;
    secret: string;
  } | null>(null);

  const loadIntegration = useCallback(
    async (scope: LoadScope = 'all') => {
      requestSequence.current += 1;
      const sequence = requestSequence.current;
      const includesIp = scope === 'all' || scope === 'ip';
      const includesWebhook = scope === 'all' || scope === 'webhook';
      if (includesIp) {
        activeLoads.current.ip += 1;
        setIpLoading(true);
        setIpError('');
      }
      if (includesWebhook) {
        activeLoads.current.webhook += 1;
        setWebhookLoading(true);
        setWebhookError('');
      }

      try {
        const value = await portalApi('/api-integration');
        if (sequence !== requestSequence.current) return;
        const next = normalizeIntegrationSnapshot(value);
        setSnapshot(next);
        setHasLoaded(true);
        const activeWebhook =
          next.webhooks.find((item) => item.status === 'active' || item.status === 'enabled') ||
          next.webhooks[0];
        if (activeWebhook) {
          setWebhookForm((current) =>
            current.endpointUrl
              ? current
              : {
                  ...current,
                  endpointUrl: activeWebhook.endpointUrl,
                  events: activeWebhook.events.length ? activeWebhook.events : current.events,
                }
          );
        }
      } catch (caught) {
        if (sequence !== requestSequence.current) return;
        const message = integrationErrorMessage(caught, translate);
        if (includesIp) setIpError(message);
        if (includesWebhook) setWebhookError(message);
      } finally {
        if (includesIp) {
          activeLoads.current.ip = Math.max(0, activeLoads.current.ip - 1);
          if (activeLoads.current.ip === 0) setIpLoading(false);
        }
        if (includesWebhook) {
          activeLoads.current.webhook = Math.max(0, activeLoads.current.webhook - 1);
          if (activeLoads.current.webhook === 0) setWebhookLoading(false);
        }
      }
    },
    [translate]
  );

  useEffect(() => {
    loadIntegration('all');
  }, [loadIntegration]);

  useEffect(() => {
    setSuccessMessage('');
    setIpFormErrors({});
    setWebhookFormErrors({});
    setConfirmation(null);
    setCredentialError('');
    setTotpCode('');
    setRevealedSecret(null);
    setRevealCredential(null);
  }, [i18n.language]);

  useEffect(
    () => () => {
      setRevealedSecret(null);
      setTotpCode('');
    },
    []
  );

  const activeWebhook =
    snapshot.webhooks.find((item) => item.status === 'active' || item.status === 'enabled') ||
    snapshot.webhooks[0];
  const selectedWebhook = snapshot.webhooks.find((item) => item.id === selectedWebhookId) || null;
  const pendingRequests = snapshot.requests.filter((item) =>
    ['submitted', 'pending'].includes(item.status)
  );
  const approvedIpRules =
    snapshot.summary.approvedIpRules ||
    snapshot.ipAllowlist.filter((item) => item.enabled || item.status === 'active').length;
  const summaryPending = snapshot.summary.pending || pendingRequests.length;
  const isBusy = Boolean(ipMutation || webhookMutation || cancelMutation || credentialMutation);
  const activeCredential =
    snapshot.credentials.find((item) => item.status === 'active') || snapshot.credentials[0];
  const pendingRotation = snapshot.credentialRotationRequests.find(
    (item) => item.status === 'pending'
  );
  const pendingWebhookKeyRequest = snapshot.webhookSigningKeyRequests.find(
    (item) => item.status === 'pending'
  );
  let credentialDialogTitle = activeCredential ? '轮换 API Key' : '创建 API Key';
  if (credentialDialogSubmitted) credentialDialogTitle = '申请已提交';

  const requestHistory = useMemo(
    () =>
      [...snapshot.requests].sort(
        (left, right) =>
          new Date(right.createdAt || 0).getTime() - new Date(left.createdAt || 0).getTime()
      ),
    [snapshot.requests]
  );
  const visibleRequestHistory = useMemo(
    () =>
      requestHistory.filter((request) =>
        activeTab === 'webhooks' ? request.kind === 'webhook' : request.kind === 'ip_allowlist'
      ),
    [activeTab, requestHistory]
  );

  const deliveries = useMemo(
    () =>
      [...snapshot.deliveries].sort(
        (left, right) =>
          new Date(right.createdAt || 0).getTime() - new Date(left.createdAt || 0).getTime()
      ),
    [snapshot.deliveries]
  );
  const selectedWebhookDeliveries = selectedWebhook
    ? deliveries.filter((delivery) => delivery.endpointUrl === selectedWebhook.endpointUrl)
    : [];

  const submitIpRequest = (event: FormEvent) => {
    event.preventDefault();
    const errors: Record<string, string> = {};
    if (ipForm.action === 'add' && !isValidCidr(ipForm.cidr.trim())) {
      errors.cidr = translate('请输入有效的 IPv4、IPv6、单 IP 或 CIDR');
    }
    if (ipForm.action === 'remove' && !ipForm.targetEntryId) {
      errors.targetEntryId = translate('请选择要移除的已批准规则');
    }
    if (!ipForm.reason.trim()) {
      errors.reason = translate('请填写申请原因');
    }
    setIpFormErrors(errors);
    if (Object.keys(errors).length) return;

    const target = snapshot.ipAllowlist.find((item) => item.id === ipForm.targetEntryId);
    setConfirmation({
      kind: 'ip',
      payload:
        ipForm.action === 'add'
          ? {
              action: 'add',
              cidr: ipForm.cidr.trim(),
              ...(ipForm.label.trim() ? { label: ipForm.label.trim() } : {}),
              environment: ipForm.environment,
              reason: ipForm.reason.trim(),
            }
          : {
              action: 'remove',
              target_entry_id: ipForm.targetEntryId,
              ...(target?.cidr ? { cidr: target.cidr } : {}),
              ...(target?.label ? { label: target.label } : {}),
              ...(target?.environment ? { environment: target.environment } : {}),
              reason: ipForm.reason.trim(),
            },
    });
    setIpDialogOpen(false);
  };

  const submitWebhookRequest = (event: FormEvent) => {
    event.preventDefault();
    const errors: Record<string, string> = {};
    if (webhookForm.action === 'upsert') {
      if (!isValidWebhookUrl(webhookForm.endpointUrl.trim())) {
        errors.endpointUrl = translate('请输入有效的公网 HTTPS Webhook 地址');
      }
      if (!webhookForm.events.length) {
        errors.events = translate('请至少选择一个 Webhook 事件');
      }
    }
    if (!webhookForm.reason.trim()) {
      errors.reason = translate('请填写申请原因');
    }
    setWebhookFormErrors(errors);
    if (Object.keys(errors).length) return;

    setConfirmation({
      kind: 'webhook',
      payload:
        webhookForm.action === 'upsert'
          ? {
              action: 'upsert',
              endpoint_url: webhookForm.endpointUrl.trim(),
              events: webhookForm.events,
              reason: webhookForm.reason.trim(),
            }
          : {
              action: 'disable',
              reason: webhookForm.reason.trim(),
            },
    });
    setWebhookDialogOpen(false);
  };

  const executeConfirmation = async () => {
    const current = confirmation;
    if (!current) return;
    setSuccessMessage('');
    setConfirmation(null);

    if (current.kind === 'ip') {
      setIpMutation('submit');
      setIpError('');
      try {
        await portalApi('/api-integration/ip-allowlist-requests', {
          method: 'POST',
          body: JSON.stringify(current.payload),
        });
        setIpForm({
          action: 'add',
          label: '',
          environment: 'production',
          cidr: '',
          targetEntryId: '',
          reason: '',
        });
        setSuccessMessage(translate('IP 白名单申请已提交，等待后台审批'));
        await loadIntegration('ip');
      } catch (caught) {
        setIpError(integrationErrorMessage(caught, translate));
      } finally {
        setIpMutation('');
      }
      return;
    }

    if (current.kind === 'webhook') {
      setWebhookMutation('submit');
      setWebhookError('');
      try {
        await portalApi('/api-integration/webhook-requests', {
          method: 'POST',
          body: JSON.stringify(current.payload),
        });
        setWebhookForm((value) => ({ ...value, reason: '' }));
        setSuccessMessage(translate('Webhook 配置申请已提交，等待后台审批'));
        await loadIntegration('webhook');
      } catch (caught) {
        setWebhookError(integrationErrorMessage(caught, translate));
      } finally {
        setWebhookMutation('');
      }
      return;
    }

    if (current.kind === 'cancel') {
      setCancelMutation(current.request.id);
      const setPanelError = current.request.kind === 'webhook' ? setWebhookError : setIpError;
      setPanelError('');
      try {
        await portalApi(
          `/api-integration/requests/${encodeURIComponent(current.request.id)}/cancel`,
          {
            method: 'POST',
          }
        );
        setSuccessMessage(translate('申请已取消'));
        await loadIntegration(current.request.kind === 'webhook' ? 'webhook' : 'ip');
      } catch (caught) {
        setPanelError(integrationErrorMessage(caught, translate));
      } finally {
        setCancelMutation('');
      }
      return;
    }

    setWebhookMutation('test');
    setWebhookError('');
    try {
      await portalApi('/api-integration/webhook-test', {
        method: 'POST',
      });
      setSuccessMessage(translate('测试 Webhook 已加入投递队列，请查看最近投递结果'));
      await loadIntegration('webhook');
    } catch (caught) {
      setWebhookError(integrationErrorMessage(caught, translate));
    } finally {
      setWebhookMutation('');
    }
  };

  const confirmationBusy =
    (confirmation?.kind === 'ip' && Boolean(ipMutation)) ||
    (confirmation?.kind === 'webhook' && Boolean(webhookMutation)) ||
    (confirmation?.kind === 'cancel' && Boolean(cancelMutation)) ||
    (confirmation?.kind === 'test' && webhookMutation === 'test');

  const submitCredentialRotation = async () => {
    const reason = rotationReason.trim();
    if (!reason) {
      setCredentialDialogError(translate('请填写轮换原因'));
      return;
    }
    setCredentialMutation('rotation');
    setCredentialError('');
    setCredentialDialogError('');
    try {
      await portalApi('/api-integration/credential-rotation-requests', {
        method: 'POST',
        body: JSON.stringify({
          reason,
          migration_window_hours: migrationWindowHours,
        }),
      });
      setRotationReason('');
      setCredentialDialogSubmitted(true);
      await loadIntegration('all');
    } catch (caught) {
      setCredentialDialogError(integrationErrorMessage(caught, translate));
    } finally {
      setCredentialMutation('');
    }
  };

  const cancelCredentialRotation = async (requestId: string) => {
    setCredentialMutation(`cancel:${requestId}`);
    setCredentialError('');
    try {
      await portalApi(
        `/api-integration/credential-rotation-requests/${encodeURIComponent(requestId)}/cancel`,
        { method: 'POST' }
      );
      setSuccessMessage(translate('凭证更换申请已撤回'));
      await loadIntegration('all');
    } catch (caught) {
      setCredentialError(integrationErrorMessage(caught, translate));
    } finally {
      setCredentialMutation('');
    }
  };

  const revealApiCredentialSecret = async () => {
    if (!revealCredential || !/^\d{6}$/.test(totpCode)) {
      setCredentialError(translate('请输入 6 位 TOTP 验证码'));
      return;
    }
    setCredentialMutation('reveal');
    setCredentialError('');
    try {
      const value = await portalApi(
        `/api-integration/credentials/${encodeURIComponent(revealCredential.id)}/reveal`,
        {
          method: 'POST',
          body: JSON.stringify({ totp_code: totpCode }),
        }
      );
      const data = asRecord(value?.data);
      setRevealedSecret({
        clientId: stringValue(data.client_id),
        clientSecret: stringValue(data.client_secret),
      });
      setTotpCode('');
      await loadIntegration('all');
    } catch (caught) {
      setCredentialError(integrationErrorMessage(caught, translate));
      if ((caught as PortalApiError)?.code === 'credential_secret_already_revealed') {
        setRevealCredential(null);
        setTotpCode('');
        await loadIntegration('all');
      }
    } finally {
      setCredentialMutation('');
    }
  };

  const copyCredentialValue = async (value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setSuccessMessage(translate('已复制到剪贴板'));
    } catch {
      setCredentialError(translate('复制失败，请手动选择并复制'));
    }
  };

  const submitWebhookSigningKeyRequest = async () => {
    const reason = webhookKeyReason.trim();
    if (!reason) {
      setWebhookKeyError(translate('请填写创建或轮换原因'));
      return;
    }
    setWebhookKeyMutation('request');
    setWebhookKeyError('');
    try {
      await portalApi('/api-integration/webhook-signing-key-requests', {
        method: 'POST',
        body: JSON.stringify({ reason, overlap_hours: webhookKeyOverlapHours }),
      });
      setWebhookKeyReason('');
      setWebhookKeyDialogOpen(false);
      setSuccessMessage(translate('Webhook 签名密钥申请已提交，等待后台审批'));
      await loadIntegration('webhook');
    } catch (caught) {
      setWebhookKeyError(integrationErrorMessage(caught, translate));
    } finally {
      setWebhookKeyMutation('');
    }
  };

  const executeWebhookKeyStepUp = async () => {
    if (!webhookKeyStepUp || !/^\d{6}$/.test(webhookKeyTotpCode)) {
      setWebhookKeyError(translate('请输入 6 位 TOTP 验证码'));
      return;
    }
    const { key, action } = webhookKeyStepUp;
    setWebhookKeyMutation(action);
    setWebhookKeyError('');
    try {
      const value = await portalApi(
        `/api-integration/webhook-signing-keys/${encodeURIComponent(key.id)}/${action}`,
        {
          method: 'POST',
          body: JSON.stringify({ totp_code: webhookKeyTotpCode }),
        }
      );
      if (action === 'reveal') {
        const data = asRecord(value?.data);
        setRevealedWebhookSecret({
          keyId: stringValue(data.key_id),
          secret: stringValue(data.signing_secret),
        });
      } else {
        setSuccessMessage(translate('新 Webhook 签名密钥已启用，旧密钥进入过渡期'));
      }
      setWebhookKeyStepUp(null);
      setWebhookKeyTotpCode('');
      await loadIntegration('webhook');
    } catch (caught) {
      setWebhookKeyError(integrationErrorMessage(caught, translate));
    } finally {
      setWebhookKeyMutation('');
    }
  };

  return (
    <>
      <Stack spacing={3}>
        {successMessage && (
          <Alert severity="success" onClose={() => setSuccessMessage('')}>
            {successMessage}
          </Alert>
        )}

        <Card sx={{ p: { xs: 2.5, md: 3 } }}>
          <Stack
            direction={{ xs: 'column', md: 'row' }}
            alignItems={{ md: 'flex-start' }}
            justifyContent="space-between"
            spacing={2}
          >
            <Box>
              <Typography variant="h5">{translate('API 配置中心')}</Typography>
              <Typography color="text.secondary" sx={{ mt: 0.5 }}>
                {translate(
                  '集中查看机器 API 凭证与安全状态，并提交凭证更换、IP 白名单和 Webhook 配置申请。'
                )}
              </Typography>
              <Stack
                direction={{ xs: 'column', sm: 'row' }}
                spacing={1}
                alignItems={{ sm: 'center' }}
                sx={{ mt: 2 }}
              >
                <Typography variant="body2" color="text.secondary">
                  Base URL
                </Typography>
                <Box
                  component="code"
                  sx={{
                    px: 1.25,
                    py: 0.75,
                    borderRadius: 1,
                    bgcolor: 'background.neutral',
                    color: 'text.primary',
                    fontSize: 14,
                    overflowWrap: 'anywhere',
                  }}
                >
                  {PARTNER_API_BASE_URL}
                </Box>
              </Stack>
            </Box>
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.25}>
              <Button
                href="/portal/api-guide"
                target="_blank"
                rel="noopener noreferrer"
                variant="contained"
                startIcon={<Iconify icon="solar:book-bookmark-bold-duotone" />}
              >
                {translate('打开 Partner API 指南')}
              </Button>
              <Button
                href="/api/browser/v1/portal/openapi.yaml"
                target="_blank"
                rel="noopener noreferrer"
                variant="outlined"
                startIcon={<Iconify icon="solar:document-text-bold-duotone" />}
              >
                {translate('下载 OpenAPI 3.1 规范')}
              </Button>
            </Stack>
          </Stack>

          <Box
            sx={{
              mt: 3,
              display: 'grid',
              gridTemplateColumns: {
                xs: '1fr',
                sm: 'repeat(2, minmax(0, 1fr))',
                lg: 'repeat(4, minmax(0, 1fr))',
              },
              gap: 1.5,
            }}
          >
            <IntegrationMetric
              icon="solar:key-minimalistic-square-bold-duotone"
              color="success"
              label={translate('Access 服务令牌')}
              value={
                hasLoaded
                  ? translate(
                      snapshot.security.accessServiceTokenRequired ? '已强制保护' : '状态异常'
                    )
                  : '—'
              }
              description={translate('机器请求的第一层认证')}
            />
            <IntegrationMetric
              icon="solar:shield-network-bold-duotone"
              color="info"
              label={translate('IP 白名单')}
              value={
                hasLoaded
                  ? translate(snapshot.security.ipAllowlistEnabled ? '已启用' : '当前关闭')
                  : '—'
              }
              description={translate('{{approved}} 条已批准 · {{pending}} 条待审批', {
                approved: approvedIpRules,
                pending: summaryPending,
              })}
            />
            <IntegrationMetric
              icon="solar:bell-bing-bold-duotone"
              color="warning"
              label={translate('Webhook')}
              value={
                hasLoaded
                  ? translate(activeWebhook ? webhookStatusLabel(activeWebhook.status) : '尚未配置')
                  : '—'
              }
              description={translate('{{count}} 个生效地址 · {{failed}} 个失败投递', {
                count: snapshot.summary.webhookEndpoints,
                failed: snapshot.summary.failedDeliveries,
              })}
            />
            <IntegrationMetric
              icon="solar:clock-circle-bold-duotone"
              color="primary"
              label={translate('流量限制')}
              value={
                hasLoaded
                  ? `${snapshot.security.rateLimit.limit} / ${snapshot.security.rateLimit.periodSeconds}s`
                  : '—'
              }
              description={translate(
                snapshot.security.rateLimit.enabled ? '平台限流已启用' : '平台限流状态异常'
              )}
            />
          </Box>
        </Card>

        <Card sx={{ px: { xs: 1, sm: 1.5 }, py: 0.5 }}>
          <Tabs
            value={activeTab}
            onChange={(_, value: IntegrationTab) => setActiveTab(value)}
            variant="scrollable"
            scrollButtons="auto"
            aria-label={translate('API 接入管理')}
            sx={{
              minHeight: 56,
              '& .MuiTab-root': {
                minHeight: 56,
                px: { xs: 1.5, sm: 2.5 },
                typography: 'subtitle2',
              },
            }}
          >
            <Tab
              value="credentials"
              icon={<Iconify icon="solar:key-square-2-bold-duotone" width={20} />}
              iconPosition="start"
              label={translate('API Keys')}
            />
            <Tab
              value="webhooks"
              icon={<Iconify icon="solar:bell-bing-bold-duotone" width={20} />}
              iconPosition="start"
              label={translate('Webhooks')}
            />
            <Tab
              value="ip-allowlist"
              icon={<Iconify icon="solar:lock-keyhole-minimalistic-bold-duotone" width={20} />}
              iconPosition="start"
              label={translate('IP Whitelist')}
            />
          </Tabs>
        </Card>

        <Card
          sx={{
            p: { xs: 2.5, md: 3 },
            display: activeTab === 'credentials' ? 'block' : 'none',
          }}
        >
          <Stack
            direction={{ xs: 'column', sm: 'row' }}
            alignItems={{ sm: 'center' }}
            justifyContent="space-between"
            spacing={2}
          >
            <Box>
              <Typography variant="h6">
                {translate('{{count}} 个 API Keys', { count: snapshot.credentials.length })}
              </Typography>
              <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
                {translate('用于机器 API 认证的 Cloudflare Access 长期凭证。')}
              </Typography>
            </Box>
            <Stack direction="row" spacing={1}>
              <Button
                color="inherit"
                disabled={Boolean(credentialMutation)}
                startIcon={<Iconify icon="solar:refresh-linear" />}
                onClick={() => loadIntegration('all')}
              >
                {translate('刷新')}
              </Button>
              <Button
                variant="contained"
                disabled={Boolean(credentialMutation) || Boolean(pendingRotation)}
                startIcon={<Iconify icon="solar:add-circle-linear" />}
                onClick={() => {
                  setCredentialError('');
                  setCredentialDialogError('');
                  setCredentialDialogSubmitted(false);
                  setCredentialDialogOpen(true);
                }}
              >
                {translate(activeCredential ? '轮换 API Key' : '创建 API Key')}
              </Button>
            </Stack>
          </Stack>

          {credentialError && (
            <Alert severity="error" sx={{ mt: 2.5 }} onClose={() => setCredentialError('')}>
              {credentialError}
            </Alert>
          )}

          {pendingRotation && (
            <Alert
              severity="info"
              sx={{ mt: 2.5 }}
              action={
                <Button
                  color="inherit"
                  size="small"
                  disabled={Boolean(credentialMutation)}
                  onClick={() => cancelCredentialRotation(pendingRotation.id)}
                >
                  {translate('撤回')}
                </Button>
              }
            >
              <Stack spacing={1.25}>
                <Typography variant="body2">
                  {translate('API Key 轮换申请待审批，旧 Secret 过渡期为 {{hours}} 小时。', {
                    hours: pendingRotation.migrationWindowHours,
                  })}
                </Typography>
                <CredentialProgress activeStep={1} translate={translate} compact />
              </Stack>
            </Alert>
          )}

          <Alert severity="warning" sx={{ mt: 2.5 }}>
            {translate('Client Secret 只显示一次；领取时需要当前 Portal 账户的 6 位 TOTP。')}
          </Alert>

          <ApiCredentialTable
            rows={snapshot.credentials}
            locale={locale}
            busy={Boolean(credentialMutation)}
            onReveal={(credential) => {
              setCredentialError('');
              setTotpCode('');
              setRevealedSecret(null);
              setRevealCredential(credential);
            }}
            onCreate={() => {
              setCredentialDialogError('');
              setCredentialDialogSubmitted(false);
              setCredentialDialogOpen(true);
            }}
            canCreate={!pendingRotation && !credentialMutation}
            translate={translate}
          />

          <Dialog
            open={credentialDialogOpen}
            onClose={() => {
              if (!credentialMutation) {
                setCredentialDialogOpen(false);
                setCredentialDialogError('');
                setCredentialDialogSubmitted(false);
              }
            }}
            fullWidth
            maxWidth="sm"
          >
            <DialogTitle>{translate(credentialDialogTitle)}</DialogTitle>
            <DialogContent dividers>
              {credentialDialogSubmitted ? (
                <Stack spacing={2.5} alignItems="center" sx={{ py: 2, textAlign: 'center' }}>
                  <Box
                    sx={{
                      width: 56,
                      height: 56,
                      display: 'grid',
                      placeItems: 'center',
                      borderRadius: '50%',
                      bgcolor: 'success.lighter',
                      color: 'success.dark',
                    }}
                  >
                    <Iconify icon="solar:check-circle-bold" width={32} />
                  </Box>
                  <Box>
                    <Typography variant="h6">{translate('等待后台审批')}</Typography>
                    <Typography variant="body2" color="text.secondary" sx={{ mt: 0.75 }}>
                      {translate('批准后，回到此页使用 TOTP 一次性领取新 Secret。')}
                    </Typography>
                  </Box>
                  <CredentialProgress activeStep={1} translate={translate} />
                </Stack>
              ) : (
                <Stack spacing={2.5}>
                  <Alert severity="info">
                    {translate('提交后需要后台审批。批准后新 Secret 才会开放一次性领取。')}
                  </Alert>
                  <TextField
                    select
                    fullWidth
                    label={translate('旧 Secret 过渡期')}
                    value={migrationWindowHours}
                    disabled={Boolean(credentialMutation)}
                    onChange={(event) => setMigrationWindowHours(Number(event.target.value))}
                  >
                    {[24, 48, 72, 168].map((hours) => (
                      <MenuItem key={hours} value={hours}>
                        {translate('{{hours}} 小时', { hours })}
                      </MenuItem>
                    ))}
                  </TextField>
                  <TextField
                    required
                    fullWidth
                    multiline
                    minRows={4}
                    label={translate('申请原因')}
                    placeholder={translate('说明创建用途、轮换原因或计划切换时间')}
                    value={rotationReason}
                    disabled={Boolean(credentialMutation)}
                    inputProps={{ maxLength: 500 }}
                    onChange={(event) => {
                      setRotationReason(event.target.value);
                      setCredentialDialogError('');
                    }}
                  />
                  {credentialDialogError && (
                    <Alert severity="error" onClose={() => setCredentialDialogError('')}>
                      {credentialDialogError}
                    </Alert>
                  )}
                </Stack>
              )}
            </DialogContent>
            <ResponsiveDialogActions>
              {credentialDialogSubmitted ? (
                <Button
                  variant="contained"
                  onClick={() => {
                    setCredentialDialogOpen(false);
                    setCredentialDialogSubmitted(false);
                  }}
                >
                  {translate('查看申请状态')}
                </Button>
              ) : (
                <>
                  <Button color="inherit" onClick={() => setCredentialDialogOpen(false)}>
                    {translate('取消')}
                  </Button>
                  <Button
                    variant="contained"
                    disabled={Boolean(credentialMutation) || !rotationReason.trim()}
                    onClick={submitCredentialRotation}
                  >
                    {credentialMutation === 'rotation'
                      ? translate('正在提交…')
                      : translate('提交审批')}
                  </Button>
                </>
              )}
            </ResponsiveDialogActions>
          </Dialog>
        </Card>

        <Box
          sx={{
            display: activeTab === 'credentials' ? 'none' : 'block',
          }}
        >
          <Card
            sx={{
              p: { xs: 2.5, md: 3 },
              display: activeTab === 'ip-allowlist' ? 'block' : 'none',
            }}
          >
            <PanelHeader
              icon="solar:shield-plus-bold-duotone"
              title={translate('IP 白名单申请')}
              description={translate(
                '提交固定出口 IP 或 CIDR；后台批准后才会写入机器 API 白名单。'
              )}
              status={
                <Label color={snapshot.security.ipAllowlistEnabled ? 'success' : 'default'}>
                  {translate(
                    snapshot.security.ipAllowlistEnabled ? '白名单已启用' : '白名单当前关闭'
                  )}
                </Label>
              }
              loading={ipLoading}
              onRefresh={() => loadIntegration('ip')}
              translate={translate}
            />

            <PanelLoadAlert
              loading={ipLoading && !hasLoaded}
              error={ipError}
              loadingMessage={translate('正在读取 IP 白名单与申请记录…')}
              onRetry={() => loadIntegration('ip')}
              translate={translate}
            />

            <Alert severity="info" sx={{ mt: 2.5 }}>
              {translate('提交申请不会立即改变访问权限；只有后台审批通过后，新规则才会生效。')}
              <br />
              {translate(
                '出口用途仅用于区分主出口、灾备或测试来源；所有已批准且启用的规则均作用于当前 moventra.xyz 生产 API。'
              )}
            </Alert>

            <Stack
              direction={{ xs: 'column', sm: 'row' }}
              alignItems={{ xs: 'stretch', sm: 'center' }}
              justifyContent="space-between"
              spacing={1.5}
              sx={{ mt: 3 }}
            >
              <Typography variant="h6">{translate('已加入白名单的 IP')}</Typography>
              <Button
                variant="contained"
                startIcon={<Iconify icon="solar:add-circle-linear" />}
                onClick={() => {
                  setIpFormErrors({});
                  setIpDialogOpen(true);
                }}
                sx={{ width: { xs: '100%', sm: 'auto' }, minHeight: 44 }}
              >
                {translate('新增 IP')}
              </Button>
            </Stack>
            <IpRuleTable rows={snapshot.ipAllowlist} locale={locale} translate={translate} />

            <Dialog
              open={ipDialogOpen}
              onClose={() => !ipMutation && setIpDialogOpen(false)}
              fullWidth
              maxWidth="sm"
            >
              <DialogTitle>
                {translate(ipForm.action === 'add' ? '新增 IP' : '移除 IP')}
              </DialogTitle>
              <DialogContent dividers>
                <Box component="form" id="ip-allowlist-form" onSubmit={submitIpRequest}>
                  <Stack spacing={2}>
                    <TextField
                      select
                      fullWidth
                      label={translate('申请类型')}
                      value={ipForm.action}
                      disabled={Boolean(ipMutation)}
                      onChange={(event) => {
                        const action = event.target.value as IpRequestAction;
                        setIpForm((current) => ({
                          ...current,
                          action,
                          targetEntryId:
                            action === 'remove'
                              ? current.targetEntryId || snapshot.ipAllowlist[0]?.id || ''
                              : '',
                        }));
                        setIpFormErrors({});
                      }}
                    >
                      <MenuItem value="add">{translate('申请添加 IP')}</MenuItem>
                      <MenuItem value="remove">{translate('申请移除 IP')}</MenuItem>
                    </TextField>

                    {ipForm.action === 'add' ? (
                      <>
                        <Box
                          sx={{
                            display: 'grid',
                            gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' },
                            gap: 2,
                          }}
                        >
                          <TextField
                            select
                            fullWidth
                            label={translate('出口用途')}
                            value={ipForm.environment}
                            disabled={Boolean(ipMutation)}
                            onChange={(event) =>
                              setIpForm((current) => ({
                                ...current,
                                environment: event.target.value,
                              }))
                            }
                          >
                            {IP_ENVIRONMENTS.map((environment) => (
                              <MenuItem key={environment.value} value={environment.value}>
                                {translate(environment.label)}
                              </MenuItem>
                            ))}
                          </TextField>
                          <TextField
                            fullWidth
                            label={translate('规则名称（可选）')}
                            placeholder={translate('例如：生产主出口')}
                            value={ipForm.label}
                            disabled={Boolean(ipMutation)}
                            onChange={(event) =>
                              setIpForm((current) => ({ ...current, label: event.target.value }))
                            }
                          />
                        </Box>
                        <TextField
                          required
                          fullWidth
                          label={translate('固定出口 IP / CIDR')}
                          placeholder={translate('例如：你的固定公网 IPv4/32')}
                          value={ipForm.cidr}
                          disabled={Boolean(ipMutation)}
                          error={Boolean(ipFormErrors.cidr)}
                          helperText={
                            ipFormErrors.cidr ||
                            translate(
                              '仅接受公网单播 IPv4、IPv6 或 CIDR；私网、保留地址及过宽范围会被拒绝'
                            )
                          }
                          onChange={(event) => {
                            setIpForm((current) => ({ ...current, cidr: event.target.value }));
                            setIpFormErrors((current) => ({ ...current, cidr: '' }));
                          }}
                        />
                      </>
                    ) : (
                      <TextField
                        select
                        required
                        fullWidth
                        label={translate('选择要移除的规则')}
                        value={ipForm.targetEntryId}
                        disabled={Boolean(ipMutation) || !snapshot.ipAllowlist.length}
                        error={Boolean(ipFormErrors.targetEntryId)}
                        helperText={
                          ipFormErrors.targetEntryId ||
                          (!snapshot.ipAllowlist.length
                            ? translate('当前没有可申请移除的已批准规则')
                            : ' ')
                        }
                        onChange={(event) => {
                          setIpForm((current) => ({
                            ...current,
                            targetEntryId: event.target.value,
                          }));
                          setIpFormErrors((current) => ({
                            ...current,
                            targetEntryId: '',
                          }));
                        }}
                      >
                        {snapshot.ipAllowlist.map((entry) => (
                          <MenuItem key={entry.id} value={entry.id}>
                            {entry.label || translate('未命名规则')} · {entry.cidr}
                          </MenuItem>
                        ))}
                      </TextField>
                    )}

                    <TextField
                      required
                      fullWidth
                      multiline
                      minRows={3}
                      label={translate('申请原因')}
                      placeholder={translate('说明业务用途、切换时间或其他需要后台核对的信息')}
                      value={ipForm.reason}
                      disabled={Boolean(ipMutation)}
                      error={Boolean(ipFormErrors.reason)}
                      helperText={ipFormErrors.reason}
                      inputProps={{ maxLength: 500 }}
                      onChange={(event) => {
                        setIpForm((current) => ({ ...current, reason: event.target.value }));
                        setIpFormErrors((current) => ({ ...current, reason: '' }));
                      }}
                    />
                  </Stack>
                </Box>
              </DialogContent>
              <ResponsiveDialogActions>
                <Button color="inherit" onClick={() => setIpDialogOpen(false)}>
                  {translate('取消')}
                </Button>
                <Button
                  type="submit"
                  form="ip-allowlist-form"
                  variant="contained"
                  disabled={
                    Boolean(ipMutation) ||
                    ipLoading ||
                    (ipForm.action === 'remove' && !snapshot.ipAllowlist.length)
                  }
                >
                  {translate(ipForm.action === 'add' ? '提交新增申请' : '提交移除申请')}
                </Button>
              </ResponsiveDialogActions>
            </Dialog>
          </Card>

          <Card
            sx={{
              p: { xs: 2.5, md: 3 },
              display: activeTab === 'webhooks' ? 'block' : 'none',
            }}
          >
            {selectedWebhook && (
              <WebhookEndpointDetail
                webhook={selectedWebhook}
                deliveries={selectedWebhookDeliveries}
                locale={locale}
                translate={translate}
                onBack={() => setSelectedWebhookId('')}
                onEdit={() => {
                  setWebhookFormErrors({});
                  setWebhookForm({
                    action: 'upsert',
                    endpointUrl: selectedWebhook.endpointUrl,
                    events: selectedWebhook.events,
                    reason: '',
                  });
                  setWebhookDialogOpen(true);
                }}
                onTest={() => setConfirmation({ kind: 'test' })}
                onSelectDelivery={setSelectedDelivery}
                busy={Boolean(webhookMutation)}
                error={webhookError}
              />
            )}
            <Box sx={{ display: selectedWebhook ? 'none' : 'block' }}>
              <PanelHeader
                icon="solar:bell-bing-bold-duotone"
                title={translate('Webhook 配置')}
                description={translate('订阅开户、VA、资金和 OTC 状态变化；配置需经后台审批。')}
                status={
                  <IntegrationStatus
                    value={activeWebhook?.status || 'not_configured'}
                    translate={translate}
                  />
                }
                loading={webhookLoading}
                onRefresh={() => loadIntegration('webhook')}
                translate={translate}
              />

              <PanelLoadAlert
                loading={webhookLoading && !hasLoaded}
                error={webhookError}
                loadingMessage={translate('正在读取 Webhook 配置与投递记录…')}
                onRetry={() => loadIntegration('webhook')}
                translate={translate}
              />

              <Alert severity="info" sx={{ mt: 2.5 }}>
                {translate(
                  'Webhook 签名密钥由后台安全生成；审批后使用 TOTP 一次性领取，确认接收端配置完成后再启用。'
                )}
              </Alert>

              <Box
                sx={{
                  mt: 2.5,
                  p: 2,
                  border: '1px solid',
                  borderColor: 'divider',
                  borderRadius: 1.5,
                }}
              >
                <Stack
                  direction={{ xs: 'column', sm: 'row' }}
                  justifyContent="space-between"
                  alignItems={{ sm: 'center' }}
                  spacing={1.5}
                >
                  <Box>
                    <Typography variant="h6">{translate('Webhook 签名密钥')}</Typography>
                    <Typography variant="body2" color="text.secondary">
                      {translate('只显示 Key ID 和状态；明文密钥仅能领取一次。')}
                    </Typography>
                  </Box>
                  <Button
                    variant="outlined"
                    disabled={Boolean(pendingWebhookKeyRequest) || Boolean(webhookKeyMutation)}
                    onClick={() => {
                      setWebhookKeyError('');
                      setWebhookKeyDialogOpen(true);
                    }}
                  >
                    {translate(snapshot.webhookSigningKeys.length ? '轮换密钥' : '创建密钥')}
                  </Button>
                </Stack>
                {pendingWebhookKeyRequest && (
                  <Alert severity="warning" sx={{ mt: 2 }}>
                    {translate('签名密钥申请正在等待后台审批。')}
                  </Alert>
                )}
                {webhookKeyError && (
                  <Alert severity="error" sx={{ mt: 2 }} onClose={() => setWebhookKeyError('')}>
                    {webhookKeyError}
                  </Alert>
                )}
                <Stack spacing={1.25} sx={{ mt: 2 }}>
                  {snapshot.webhookSigningKeys.map((key) => (
                    <Stack
                      key={key.id}
                      direction={{ xs: 'column', md: 'row' }}
                      justifyContent="space-between"
                      alignItems={{ md: 'center' }}
                      spacing={1.25}
                      sx={{ p: 1.5, bgcolor: 'background.neutral', borderRadius: 1 }}
                    >
                      <Box sx={{ minWidth: 0 }}>
                        <Stack direction="row" spacing={1} alignItems="center">
                          <Typography variant="subtitle2" sx={{ overflowWrap: 'anywhere' }}>
                            {key.id}
                          </Typography>
                          <IntegrationStatus value={key.status} translate={translate} />
                        </Stack>
                        <Typography variant="caption" color="text.secondary">
                          {translate('版本 {{version}} · 创建于 {{date}}', {
                            version: key.secretVersion,
                            date: formatDate(key.createdAt, locale),
                          })}
                        </Typography>
                      </Box>
                      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1}>
                        {key.secretAvailable && (
                          <Button
                            size="small"
                            variant="contained"
                            disabled={Boolean(webhookKeyMutation)}
                            onClick={() => {
                              setWebhookKeyTotpCode('');
                              setWebhookKeyStepUp({ key, action: 'reveal' });
                            }}
                          >
                            {translate('领取密钥')}
                          </Button>
                        )}
                        {key.status === 'available' && key.revealStatus === 'revealed' && (
                          <Button
                            size="small"
                            color="warning"
                            variant="outlined"
                            disabled={Boolean(webhookKeyMutation)}
                            onClick={() => {
                              setWebhookKeyTotpCode('');
                              setWebhookKeyStepUp({ key, action: 'activate' });
                            }}
                          >
                            {translate('启用密钥')}
                          </Button>
                        )}
                      </Stack>
                    </Stack>
                  ))}
                  {!snapshot.webhookSigningKeys.length && (
                    <Typography variant="body2" color="text.secondary">
                      {translate('尚未创建托管签名密钥；当前仍使用兼容的 Worker Secret。')}
                    </Typography>
                  )}
                </Stack>
              </Box>

              <Stack
                direction={{ xs: 'column', sm: 'row' }}
                alignItems={{ xs: 'stretch', sm: 'center' }}
                justifyContent="space-between"
                spacing={1.5}
                sx={{ mt: 3 }}
              >
                <Typography variant="h6">{translate('Webhook 端点')}</Typography>
                <Button
                  variant="contained"
                  startIcon={<Iconify icon="solar:add-circle-linear" />}
                  onClick={() => {
                    setWebhookFormErrors({});
                    setWebhookForm((current) => ({ ...current, action: 'upsert' }));
                    setWebhookDialogOpen(true);
                  }}
                  sx={{ width: { xs: '100%', sm: 'auto' }, minHeight: 44 }}
                >
                  {translate('新建 Webhook')}
                </Button>
              </Stack>
              <WebhookEndpointTable
                rows={snapshot.webhooks}
                locale={locale}
                translate={translate}
                onSelect={(webhook) => setSelectedWebhookId(webhook.id)}
              />

              <Dialog
                open={webhookDialogOpen}
                onClose={() => !webhookMutation && setWebhookDialogOpen(false)}
                fullWidth
                maxWidth="sm"
              >
                <DialogTitle>
                  {translate(
                    webhookForm.action === 'upsert' ? '新建或更新 Webhook' : '停用 Webhook'
                  )}
                </DialogTitle>
                <DialogContent dividers>
                  <Box component="form" id="webhook-form" onSubmit={submitWebhookRequest}>
                    <Stack spacing={2}>
                      <TextField
                        select
                        fullWidth
                        label={translate('申请类型')}
                        value={webhookForm.action}
                        disabled={Boolean(webhookMutation)}
                        onChange={(event) => {
                          setWebhookForm((current) => ({
                            ...current,
                            action: event.target.value as WebhookRequestAction,
                          }));
                          setWebhookFormErrors({});
                        }}
                      >
                        <MenuItem value="upsert">{translate('新增或更新 Webhook')}</MenuItem>
                        <MenuItem value="disable">{translate('申请停用 Webhook')}</MenuItem>
                      </TextField>

                      {webhookForm.action === 'upsert' && (
                        <>
                          <TextField
                            required
                            fullWidth
                            label={translate('Webhook HTTPS 地址')}
                            placeholder="https://api.example.com/webhooks/va"
                            value={webhookForm.endpointUrl}
                            disabled={Boolean(webhookMutation)}
                            error={Boolean(webhookFormErrors.endpointUrl)}
                            helperText={
                              webhookFormErrors.endpointUrl ||
                              translate('必须使用可从公网访问的 HTTPS 地址')
                            }
                            onChange={(event) => {
                              setWebhookForm((current) => ({
                                ...current,
                                endpointUrl: event.target.value,
                              }));
                              setWebhookFormErrors((current) => ({
                                ...current,
                                endpointUrl: '',
                              }));
                            }}
                          />
                          <TextField
                            select
                            required
                            fullWidth
                            label={translate('订阅事件')}
                            value={webhookForm.events}
                            disabled={Boolean(webhookMutation)}
                            error={Boolean(webhookFormErrors.events)}
                            helperText={
                              webhookFormErrors.events ||
                              translate('可选择多个事件；状态变化后系统会异步投递')
                            }
                            SelectProps={{
                              multiple: true,
                              renderValue: (selected) =>
                                (selected as string[])
                                  .map((value) => webhookEventLabel(value, translate))
                                  .join('、'),
                            }}
                            onChange={(event) => {
                              const { value } = event.target;
                              setWebhookForm((current) => ({
                                ...current,
                                events: typeof value === 'string' ? value.split(',') : value,
                              }));
                              setWebhookFormErrors((current) => ({ ...current, events: '' }));
                            }}
                          >
                            {WEBHOOK_EVENTS.map((event) => (
                              <MenuItem key={event.value} value={event.value}>
                                <Checkbox checked={webhookForm.events.includes(event.value)} />
                                <ListItemText
                                  primary={translate(event.label)}
                                  secondary={event.value}
                                />
                              </MenuItem>
                            ))}
                          </TextField>
                        </>
                      )}

                      <TextField
                        required
                        fullWidth
                        multiline
                        minRows={3}
                        label={translate('申请原因')}
                        placeholder={translate('说明接入用途、切换窗口或停用原因')}
                        value={webhookForm.reason}
                        disabled={Boolean(webhookMutation)}
                        error={Boolean(webhookFormErrors.reason)}
                        helperText={webhookFormErrors.reason}
                        inputProps={{ maxLength: 500 }}
                        onChange={(event) => {
                          setWebhookForm((current) => ({
                            ...current,
                            reason: event.target.value,
                          }));
                          setWebhookFormErrors((current) => ({ ...current, reason: '' }));
                        }}
                      />
                    </Stack>
                  </Box>
                </DialogContent>
                <ResponsiveDialogActions>
                  <Button color="inherit" onClick={() => setWebhookDialogOpen(false)}>
                    {translate('取消')}
                  </Button>
                  <Button
                    type="submit"
                    form="webhook-form"
                    variant="contained"
                    disabled={Boolean(webhookMutation) || webhookLoading}
                  >
                    {translate('提交 Webhook 申请')}
                  </Button>
                </ResponsiveDialogActions>
              </Dialog>

              {activeWebhook && (
                <>
                  <Divider sx={{ my: 3 }} />
                  <Typography variant="h6">{translate('当前生效配置')}</Typography>
                  <Box
                    sx={{
                      mt: 2,
                      p: 2,
                      border: '1px solid',
                      borderColor: 'divider',
                      borderRadius: 1.5,
                      bgcolor: 'background.neutral',
                    }}
                  >
                    <Stack spacing={1.5}>
                      <ConfigInfo
                        label={translate('Webhook 地址')}
                        value={activeWebhook.endpointUrl}
                      />
                      <Box>
                        <Typography variant="caption" color="text.secondary">
                          {translate('订阅事件')}
                        </Typography>
                        <Stack
                          direction="row"
                          spacing={0.75}
                          useFlexGap
                          flexWrap="wrap"
                          sx={{ mt: 0.75 }}
                        >
                          {activeWebhook.events.map((event) => (
                            <Label key={event} color="info">
                              {webhookEventLabel(event, translate)}
                            </Label>
                          ))}
                        </Stack>
                      </Box>
                      <Box
                        sx={{
                          display: 'grid',
                          gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' },
                          gap: 2,
                        }}
                      >
                        <ConfigInfo
                          label={translate('最近投递')}
                          value={formatDate(activeWebhook.lastDeliveryAt, locale)}
                        />
                        <ConfigInfo
                          label={translate('最近成功投递')}
                          value={formatDate(activeWebhook.lastSuccessAt, locale)}
                        />
                      </Box>
                      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1}>
                        <Button
                          variant="outlined"
                          disabled={Boolean(webhookMutation)}
                          startIcon={<Iconify icon="solar:pen-bold" />}
                          onClick={() => {
                            setWebhookFormErrors({});
                            setWebhookForm({
                              action: 'upsert',
                              endpointUrl: activeWebhook.endpointUrl,
                              events: activeWebhook.events,
                              reason: '',
                            });
                            setWebhookDialogOpen(true);
                          }}
                        >
                          {translate('编辑配置')}
                        </Button>
                        <Button
                          variant="outlined"
                          disabled={
                            Boolean(webhookMutation) ||
                            !['active', 'enabled'].includes(activeWebhook.status)
                          }
                          startIcon={<Iconify icon="solar:play-circle-bold-duotone" />}
                          onClick={() => setConfirmation({ kind: 'test' })}
                        >
                          {webhookMutation === 'test'
                            ? translate('发送中…')
                            : translate('发送测试事件')}
                        </Button>
                      </Stack>
                    </Stack>
                  </Box>
                </>
              )}
            </Box>
          </Card>
        </Box>

        <Box
          sx={{
            display:
              activeTab === 'credentials' || (activeTab === 'webhooks' && selectedWebhook)
                ? 'none'
                : 'grid',
            gridTemplateColumns: {
              xs: '1fr',
              lg: activeTab === 'webhooks' ? 'minmax(0, 1fr) minmax(0, 1fr)' : '1fr',
            },
            gap: 3,
          }}
        >
          <Card sx={{ p: { xs: 2.5, md: 3 } }}>
            <Stack direction="row" alignItems="center" justifyContent="space-between">
              <Box>
                <Typography variant="h6">
                  {translate(activeTab === 'webhooks' ? 'Webhook 申请历史' : 'IP 白名单申请历史')}
                </Typography>
                <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
                  {translate('查看申请的审批进度和后台备注。')}
                </Typography>
              </Box>
              <Label
                color={
                  visibleRequestHistory.some((request) =>
                    ['submitted', 'pending'].includes(request.status)
                  )
                    ? 'warning'
                    : 'default'
                }
              >
                {translate('{{count}} 条待审批', {
                  count: visibleRequestHistory.filter((request) =>
                    ['submitted', 'pending'].includes(request.status)
                  ).length,
                })}
              </Label>
            </Stack>
            <RequestHistoryTable
              rows={visibleRequestHistory}
              locale={locale}
              cancelMutation={cancelMutation}
              onCancel={(request) => setConfirmation({ kind: 'cancel', request })}
              translate={translate}
            />
          </Card>

          <Card
            sx={{
              p: { xs: 2.5, md: 3 },
              display: activeTab === 'webhooks' ? 'block' : 'none',
            }}
          >
            <Stack direction="row" alignItems="center" justifyContent="space-between">
              <Box>
                <Typography variant="h6">{translate('Webhook 投递记录')}</Typography>
                <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
                  {translate('核对事件、HTTP 结果与重试状态。')}
                </Typography>
              </Box>
              <Stack direction="row" spacing={1} alignItems="center">
                <Label color={snapshot.summary.failedDeliveries ? 'error' : 'success'}>
                  {translate('{{count}} 个失败', {
                    count: snapshot.summary.failedDeliveries,
                  })}
                </Label>
                <Button
                  component={RouterLink}
                  to="/portal/webhook-deliveries"
                  variant="outlined"
                  size="small"
                  endIcon={<Iconify icon="solar:alt-arrow-right-linear" width={16} />}
                >
                  {translate('查看全部')}
                </Button>
              </Stack>
            </Stack>
            <WebhookDeliveryTable
              rows={deliveries}
              locale={locale}
              translate={translate}
              onSelect={setSelectedDelivery}
            />
          </Card>
        </Box>

        <Card
          sx={{
            p: { xs: 2.5, md: 3 },
            display: activeTab === 'credentials' ? 'block' : 'none',
          }}
        >
          <Stack
            direction={{ xs: 'column', md: 'row' }}
            justifyContent="space-between"
            alignItems={{ md: 'center' }}
            spacing={2}
          >
            <Stack direction="row" spacing={1.5} alignItems="flex-start">
              <Iconify
                icon="solar:code-square-bold-duotone"
                width={28}
                sx={{ color: 'primary.main', flexShrink: 0 }}
              />
              <Box>
                <Typography variant="h6">{translate('开发者指南')}</Typography>
                <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
                  {translate(
                    '查看认证、开户、余额、交易与自动兑换记录的完整请求示例和错误处理说明。'
                  )}
                </Typography>
              </Box>
            </Stack>
            <Typography
              component="pre"
              sx={{
                m: 0,
                p: 2,
                minWidth: { md: 410 },
                borderRadius: 1.5,
                bgcolor: 'grey.900',
                color: 'common.white',
                overflowX: 'auto',
                fontSize: 13,
              }}
            >
              {`CF-Access-Client-Id: <CLIENT_ID>
CF-Access-Client-Secret: <CLIENT_SECRET>
Idempotency-Key: <UUID>`}
            </Typography>
          </Stack>
        </Card>
      </Stack>

      <ConfirmDialog
        open={Boolean(confirmation)}
        onClose={() => {
          if (!isBusy) setConfirmation(null);
        }}
        title={confirmationTitle(confirmation, translate)}
        content={confirmationContent(confirmation, snapshot, translate)}
        action={
          <Button variant="contained" disabled={confirmationBusy} onClick={executeConfirmation}>
            {confirmationBusy ? translate('处理中…') : translate('确认提交')}
          </Button>
        }
      />

      <Dialog
        open={Boolean(revealCredential) && !revealedSecret}
        onClose={() => {
          if (credentialMutation !== 'reveal') {
            setRevealCredential(null);
            setTotpCode('');
          }
        }}
        fullWidth
        maxWidth="sm"
      >
        <DialogTitle>{translate('TOTP 二次验证')}</DialogTitle>
        <DialogContent>
          <Alert severity="warning" sx={{ mb: 2.5 }}>
            {translate('验证成功后 Secret 只显示一次。请确认你已准备好密码管理器或安全存储位置。')}
          </Alert>
          <TextField
            autoFocus
            fullWidth
            label={translate('6 位 TOTP 验证码')}
            value={totpCode}
            disabled={credentialMutation === 'reveal'}
            error={Boolean(totpCode) && !/^\d{6}$/.test(totpCode)}
            inputProps={{ inputMode: 'numeric', maxLength: 6, autoComplete: 'one-time-code' }}
            onChange={(event) => {
              setTotpCode(event.target.value.replace(/\D/g, '').slice(0, 6));
              setCredentialError('');
            }}
          />
        </DialogContent>
        <ResponsiveDialogActions>
          <Button
            color="inherit"
            disabled={credentialMutation === 'reveal'}
            onClick={() => {
              setRevealCredential(null);
              setTotpCode('');
            }}
          >
            {translate('取消')}
          </Button>
          <Button
            variant="contained"
            disabled={!/^\d{6}$/.test(totpCode) || credentialMutation === 'reveal'}
            onClick={revealApiCredentialSecret}
          >
            {credentialMutation === 'reveal' ? translate('验证中…') : translate('验证并领取')}
          </Button>
        </ResponsiveDialogActions>
      </Dialog>

      <Dialog
        open={Boolean(revealedSecret)}
        onClose={() => {
          setRevealedSecret(null);
          setRevealCredential(null);
        }}
        fullWidth
        maxWidth="md"
      >
        <DialogTitle>{translate('新 API 凭证（仅显示一次）')}</DialogTitle>
        <DialogContent>
          <Alert severity="success" sx={{ mb: 2.5 }}>
            {translate('凭证已领取。关闭此窗口后 Client Secret 将从系统中销毁，无法再次查看。')}
          </Alert>
          <Stack spacing={2}>
            <SecretValue
              label="CF-Access-Client-Id"
              value={revealedSecret?.clientId || ''}
              onCopy={copyCredentialValue}
              translate={translate}
            />
            <SecretValue
              label="CF-Access-Client-Secret"
              value={revealedSecret?.clientSecret || ''}
              onCopy={copyCredentialValue}
              translate={translate}
            />
          </Stack>
        </DialogContent>
        <ResponsiveDialogActions>
          <Button
            variant="contained"
            onClick={() => {
              setRevealedSecret(null);
              setRevealCredential(null);
            }}
          >
            {translate('我已安全保存，关闭')}
          </Button>
        </ResponsiveDialogActions>
      </Dialog>

      <Dialog
        open={webhookKeyDialogOpen}
        onClose={() => !webhookKeyMutation && setWebhookKeyDialogOpen(false)}
        fullWidth
        maxWidth="sm"
      >
        <DialogTitle>{translate('创建或轮换 Webhook 签名密钥')}</DialogTitle>
        <DialogContent dividers>
          <Stack spacing={2}>
            <Alert severity="info">
              {translate('审批通过后密钥不会立即启用；请先一次性领取并配置到接收端。')}
            </Alert>
            <TextField
              select
              fullWidth
              label={translate('旧密钥过渡期')}
              value={webhookKeyOverlapHours}
              onChange={(event) => setWebhookKeyOverlapHours(Number(event.target.value))}
            >
              {[24, 48, 72, 168].map((hours) => (
                <MenuItem key={hours} value={hours}>
                  {translate('{{hours}} 小时', { hours })}
                </MenuItem>
              ))}
            </TextField>
            <TextField
              required
              multiline
              minRows={3}
              label={translate('申请原因')}
              value={webhookKeyReason}
              onChange={(event) => setWebhookKeyReason(event.target.value)}
              inputProps={{ maxLength: 500 }}
            />
            {webhookKeyError && <Alert severity="error">{webhookKeyError}</Alert>}
          </Stack>
        </DialogContent>
        <ResponsiveDialogActions>
          <Button color="inherit" onClick={() => setWebhookKeyDialogOpen(false)}>
            {translate('取消')}
          </Button>
          <Button
            variant="contained"
            disabled={!webhookKeyReason.trim() || Boolean(webhookKeyMutation)}
            onClick={submitWebhookSigningKeyRequest}
          >
            {webhookKeyMutation === 'request' ? translate('提交中…') : translate('提交审批')}
          </Button>
        </ResponsiveDialogActions>
      </Dialog>

      <Dialog
        open={Boolean(webhookKeyStepUp)}
        onClose={() => !webhookKeyMutation && setWebhookKeyStepUp(null)}
        fullWidth
        maxWidth="sm"
      >
        <DialogTitle>
          {translate(webhookKeyStepUp?.action === 'activate' ? '确认启用签名密钥' : '领取签名密钥')}
        </DialogTitle>
        <DialogContent>
          <Alert severity="warning" sx={{ mb: 2 }}>
            {translate(
              webhookKeyStepUp?.action === 'activate'
                ? '启用后新 Webhook 将立即使用此密钥签名，请确认接收端已经配置完成。'
                : '验证成功后密钥只显示一次，请准备好安全存储位置。'
            )}
          </Alert>
          <TextField
            autoFocus
            fullWidth
            label={translate('6 位 TOTP 验证码')}
            value={webhookKeyTotpCode}
            onChange={(event) =>
              setWebhookKeyTotpCode(event.target.value.replace(/\D/g, '').slice(0, 6))
            }
            inputProps={{ inputMode: 'numeric', maxLength: 6, autoComplete: 'one-time-code' }}
          />
        </DialogContent>
        <ResponsiveDialogActions>
          <Button color="inherit" onClick={() => setWebhookKeyStepUp(null)}>
            {translate('取消')}
          </Button>
          <Button
            variant="contained"
            disabled={!/^\d{6}$/.test(webhookKeyTotpCode) || Boolean(webhookKeyMutation)}
            onClick={executeWebhookKeyStepUp}
          >
            {translate(webhookKeyStepUp?.action === 'activate' ? '验证并启用' : '验证并领取')}
          </Button>
        </ResponsiveDialogActions>
      </Dialog>

      <Dialog
        open={Boolean(revealedWebhookSecret)}
        onClose={() => setRevealedWebhookSecret(null)}
        fullWidth
        maxWidth="md"
      >
        <DialogTitle>{translate('Webhook 签名密钥（仅显示一次）')}</DialogTitle>
        <DialogContent>
          <Alert severity="success" sx={{ mb: 2 }}>
            {translate('请先将密钥保存到接收端 Secret Manager，再返回列表显式启用。')}
          </Alert>
          <Stack spacing={2}>
            <SecretValue
              label="X-VA-Webhook-Key-Id"
              value={revealedWebhookSecret?.keyId || ''}
              onCopy={copyCredentialValue}
              translate={translate}
            />
            <SecretValue
              label={translate('Webhook Signing Secret')}
              value={revealedWebhookSecret?.secret || ''}
              onCopy={copyCredentialValue}
              translate={translate}
            />
          </Stack>
        </DialogContent>
        <ResponsiveDialogActions>
          <Button variant="contained" onClick={() => setRevealedWebhookSecret(null)}>
            {translate('我已安全保存，关闭')}
          </Button>
        </ResponsiveDialogActions>
      </Dialog>

      <Dialog
        open={Boolean(selectedDelivery)}
        onClose={() => setSelectedDelivery(null)}
        fullWidth
        maxWidth="md"
      >
        <DialogTitle>{translate('Webhook 投递详情')}</DialogTitle>
        <DialogContent dividers>
          {selectedDelivery && (
            <Stack spacing={2.5}>
              <Stack
                direction={{ xs: 'column', sm: 'row' }}
                justifyContent="space-between"
                spacing={1}
              >
                <Box>
                  <Typography variant="subtitle1">
                    {webhookEventLabel(selectedDelivery.eventType, translate)}
                  </Typography>
                  <Typography variant="caption" color="text.secondary">
                    {selectedDelivery.eventType}
                  </Typography>
                  <Typography variant="caption" color="text.secondary" display="block">
                    {selectedDelivery.id}
                  </Typography>
                </Box>
                <WebhookDeliveryStatus value={selectedDelivery.status} translate={translate} />
              </Stack>
              <Divider />
              <Box
                sx={{
                  display: 'grid',
                  gridTemplateColumns: {
                    xs: '1fr',
                    sm: 'repeat(2, minmax(0, 1fr))',
                    md: 'repeat(4, minmax(0, 1fr))',
                  },
                  gap: 2,
                }}
              >
                <ConfigInfo
                  label={translate('尝试次数')}
                  value={String(selectedDelivery.attemptCount)}
                />
                <ConfigInfo
                  label={translate('HTTP 结果')}
                  value={selectedDelivery.httpStatus ? `HTTP ${selectedDelivery.httpStatus}` : '—'}
                />
                <ConfigInfo
                  label={translate('事件时间')}
                  value={formatDate(selectedDelivery.createdAt, locale)}
                />
                <ConfigInfo
                  label={translate('投递时间')}
                  value={formatDate(selectedDelivery.deliveredAt, locale)}
                />
              </Box>
              <ConfigInfo label={translate('资源 ID')} value={selectedDelivery.resourceId} />
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
                    fontSize: 13,
                  }}
                >
                  {formatJson(selectedDelivery.payload)}
                </Box>
              </Box>
            </Stack>
          )}
        </DialogContent>
        <ResponsiveDialogActions>
          <Button onClick={() => setSelectedDelivery(null)}>{translate('关闭')}</Button>
        </ResponsiveDialogActions>
      </Dialog>
    </>
  );
}

function ResponsiveDialogActions({ children }: { children: ReactNode }) {
  return (
    <DialogActions
      sx={{
        flexDirection: { xs: 'column-reverse', sm: 'row' },
        alignItems: { xs: 'stretch', sm: 'center' },
        gap: { xs: 1, sm: 0 },
        '& > :not(style)': {
          width: { xs: '100%', sm: 'auto' },
          minHeight: 44,
        },
        '& > :not(style) ~ :not(style)': {
          ml: { xs: 0, sm: 1 },
        },
      }}
    >
      {children}
    </DialogActions>
  );
}

function SecretValue({
  label,
  value,
  onCopy,
  translate,
}: {
  label: string;
  value: string;
  onCopy: (value: string) => void | Promise<void>;
  translate: Translate;
}) {
  return (
    <Box>
      <Typography variant="caption" color="text.secondary">
        {label}
      </Typography>
      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} sx={{ mt: 0.75 }}>
        <Box
          component="code"
          sx={{
            p: 1.5,
            flex: 1,
            borderRadius: 1,
            bgcolor: 'grey.900',
            color: 'common.white',
            overflowWrap: 'anywhere',
            userSelect: 'all',
          }}
        >
          {value}
        </Box>
        <Button
          variant="outlined"
          startIcon={<Iconify icon="solar:copy-linear" />}
          onClick={() => onCopy(value)}
        >
          {translate('复制')}
        </Button>
      </Stack>
    </Box>
  );
}

function IntegrationMetric({
  icon,
  color,
  label,
  value,
  description,
}: {
  icon: string;
  color: 'primary' | 'success' | 'info' | 'warning';
  label: string;
  value: string;
  description: string;
}) {
  const palette = {
    primary: { background: 'primary.lighter', foreground: 'primary.main' },
    success: { background: 'success.lighter', foreground: 'success.dark' },
    info: { background: 'info.lighter', foreground: 'info.dark' },
    warning: { background: 'warning.lighter', foreground: 'warning.dark' },
  }[color];

  return (
    <Box
      sx={{
        p: 2,
        minWidth: 0,
        border: '1px solid',
        borderColor: 'divider',
        borderRadius: 1.5,
        bgcolor: 'background.paper',
      }}
    >
      <Stack direction="row" spacing={1.25} alignItems="center">
        <Box
          sx={{
            width: 38,
            height: 38,
            display: 'grid',
            placeItems: 'center',
            borderRadius: 1.25,
            bgcolor: palette.background,
            color: palette.foreground,
            flexShrink: 0,
          }}
        >
          <Iconify icon={icon} width={22} />
        </Box>
        <Box sx={{ minWidth: 0 }}>
          <Typography variant="caption" color="text.secondary">
            {label}
          </Typography>
          <Typography variant="subtitle1" noWrap>
            {value}
          </Typography>
        </Box>
      </Stack>
      <Typography variant="caption" color="text.secondary" sx={{ mt: 1.25, display: 'block' }}>
        {description}
      </Typography>
    </Box>
  );
}

function PanelHeader({
  icon,
  title,
  description,
  status,
  loading,
  onRefresh,
  translate,
}: {
  icon: string;
  title: string;
  description: string;
  status: ReactNode;
  loading: boolean;
  onRefresh: () => void | Promise<void>;
  translate: Translate;
}) {
  return (
    <Stack
      direction={{ xs: 'column', sm: 'row' }}
      justifyContent="space-between"
      alignItems={{ xs: 'stretch', sm: 'flex-start' }}
      spacing={2}
    >
      <Stack direction="row" spacing={1.5}>
        <Box
          sx={{
            width: 42,
            height: 42,
            display: 'grid',
            placeItems: 'center',
            borderRadius: 1.5,
            bgcolor: 'primary.lighter',
            color: 'primary.main',
            flexShrink: 0,
          }}
        >
          <Iconify icon={icon} width={24} />
        </Box>
        <Box sx={{ minWidth: 0 }}>
          <Typography variant="h6">{title}</Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
            {description}
          </Typography>
          <Box sx={{ mt: 1 }}>{status}</Box>
        </Box>
      </Stack>
      <Button
        color="inherit"
        size="small"
        disabled={loading}
        startIcon={<Iconify icon="solar:refresh-linear" />}
        onClick={() => onRefresh()}
        sx={{
          width: { xs: '100%', sm: 'auto' },
          minHeight: 44,
          flexShrink: 0,
        }}
      >
        {translate(loading ? '读取中…' : '刷新')}
      </Button>
    </Stack>
  );
}

function PanelLoadAlert({
  loading,
  error,
  loadingMessage,
  onRetry,
  translate,
}: {
  loading: boolean;
  error: string;
  loadingMessage: string;
  onRetry: () => void | Promise<void>;
  translate: Translate;
}) {
  if (!loading && !error) return null;
  return (
    <Alert
      severity={error ? 'error' : 'info'}
      sx={{ mt: 2.5 }}
      action={
        error ? (
          <Button color="inherit" size="small" onClick={() => onRetry()}>
            {translate('重新读取')}
          </Button>
        ) : undefined
      }
    >
      {error || loadingMessage}
    </Alert>
  );
}

function CredentialProgress({
  activeStep,
  translate,
  compact = false,
}: {
  activeStep: 1 | 2 | 3;
  translate: Translate;
  compact?: boolean;
}) {
  const steps = ['申请已提交', '后台审批', 'TOTP 领取'];
  return (
    <Stack
      direction={{ xs: 'column', sm: 'row' }}
      spacing={compact ? 0.75 : 1}
      sx={{ width: '100%' }}
      aria-label={translate('API Key 申请进度')}
    >
      {steps.map((step, index) => {
        const number = index + 1;
        const complete = number < activeStep;
        const active = number === activeStep;
        let stepBackground = 'action.disabledBackground';
        let stepColor = 'text.disabled';
        if (complete) stepBackground = 'success.main';
        if (active) stepBackground = 'info.main';
        if (complete || active) stepColor = 'common.white';
        return (
          <Stack
            key={step}
            direction="row"
            spacing={0.75}
            alignItems="center"
            sx={{ flex: 1, minWidth: 0 }}
          >
            <Box
              sx={{
                width: compact ? 22 : 26,
                height: compact ? 22 : 26,
                display: 'grid',
                placeItems: 'center',
                borderRadius: '50%',
                flexShrink: 0,
                bgcolor: stepBackground,
                color: stepColor,
                fontSize: 12,
                fontWeight: 700,
              }}
            >
              {complete ? <Iconify icon="solar:check-read-bold" width={14} /> : number}
            </Box>
            <Typography
              variant="caption"
              color={active ? 'text.primary' : 'text.secondary'}
              sx={{ fontWeight: active ? 700 : 500 }}
            >
              {translate(step)}
            </Typography>
          </Stack>
        );
      })}
    </Stack>
  );
}

function ApiCredentialTable({
  rows,
  locale,
  busy,
  onReveal,
  onCreate,
  canCreate,
  translate,
}: {
  rows: ApiCredential[];
  locale: string;
  busy: boolean;
  onReveal: (credential: ApiCredential) => void;
  onCreate: () => void;
  canCreate: boolean;
  translate: Translate;
}) {
  if (!rows.length) {
    return (
      <Box sx={{ mt: 2 }}>
        <EmptyPanel
          icon="solar:key-minimalistic-square-bold-duotone"
          title={translate('还没有 API Key')}
          description={translate('创建申请审批通过后，API Key 会显示在这里。')}
        />
        <Box sx={{ display: 'flex', justifyContent: 'center', mt: -3, mb: 2 }}>
          <Button variant="outlined" disabled={!canCreate} onClick={onCreate}>
            {translate('创建 API Key')}
          </Button>
        </Box>
      </Box>
    );
  }

  return (
    <>
      <Stack spacing={1.5} sx={{ mt: 2.5, display: { xs: 'flex', lg: 'none' } }}>
        {rows.map((credential) => (
          <Box
            key={credential.id}
            sx={{
              p: 2,
              border: '1px solid',
              borderColor: 'divider',
              borderRadius: 1.5,
              bgcolor: 'background.paper',
            }}
          >
            <Stack spacing={1.75}>
              <Stack
                direction={{ xs: 'column', sm: 'row' }}
                justifyContent="space-between"
                alignItems={{ xs: 'flex-start', sm: 'center' }}
                spacing={1.25}
              >
                <Stack direction="row" spacing={1.25} alignItems="center" sx={{ minWidth: 0 }}>
                  <Box
                    sx={{
                      width: 36,
                      height: 36,
                      display: 'grid',
                      placeItems: 'center',
                      borderRadius: 1,
                      border: '1px solid',
                      borderColor: 'divider',
                      color: credential.status === 'active' ? 'text.primary' : 'text.disabled',
                      flexShrink: 0,
                    }}
                  >
                    <Iconify icon="solar:key-minimalistic-square-bold-duotone" width={18} />
                  </Box>
                  <Box sx={{ minWidth: 0 }}>
                    <Typography variant="subtitle2">
                      {translate('Machine API Key · v{{version}}', {
                        version: credential.secretVersion,
                      })}
                    </Typography>
                    <Typography
                      variant="caption"
                      color="text.secondary"
                      sx={{ overflowWrap: 'anywhere' }}
                    >
                      {maskClientId(credential.clientId)}
                    </Typography>
                  </Box>
                </Stack>
                <IntegrationStatus value={credential.status} translate={translate} />
              </Stack>

              <Box
                sx={{
                  display: 'grid',
                  gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, minmax(0, 1fr))' },
                  gap: 1.5,
                }}
              >
                <ConfigInfo
                  label={translate('创建时间')}
                  value={formatDate(credential.createdAt, locale)}
                />
                <ConfigInfo
                  label={translate('到期时间')}
                  value={formatDate(credential.expiresAt, locale)}
                />
              </Box>

              {credential.secretAvailable ? (
                <Button
                  fullWidth
                  variant="contained"
                  disabled={busy}
                  startIcon={<Iconify icon="solar:shield-keyhole-bold-duotone" />}
                  onClick={() => onReveal(credential)}
                  sx={{ minHeight: 44 }}
                >
                  {translate('领取 Secret')}
                </Button>
              ) : (
                <Typography variant="caption" color="text.secondary" sx={{ py: 1 }}>
                  {translate('Secret 已领取')}
                </Typography>
              )}
            </Stack>
          </Box>
        ))}
      </Stack>

      <TableContainer sx={{ mt: 2.5, display: { xs: 'none', lg: 'block' } }}>
        <Table sx={{ minWidth: 760 }}>
          <TableHead>
            <TableRow>
              <TableCell>{translate('名称')}</TableCell>
              <TableCell>{translate('状态')}</TableCell>
              <TableCell>{translate('创建时间')}</TableCell>
              <TableCell>{translate('到期时间')}</TableCell>
              <TableCell align="right">{translate('操作')}</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {rows.map((credential) => (
              <TableRow key={credential.id} hover>
                <TableCell>
                  <Stack direction="row" spacing={1.25} alignItems="center">
                    <Box
                      sx={{
                        width: 32,
                        height: 32,
                        display: 'grid',
                        placeItems: 'center',
                        borderRadius: 1,
                        border: '1px solid',
                        borderColor: 'divider',
                        color: credential.status === 'active' ? 'text.primary' : 'text.disabled',
                      }}
                    >
                      <Iconify icon="solar:key-minimalistic-square-bold-duotone" width={18} />
                    </Box>
                    <Box>
                      <Typography variant="subtitle2">
                        {translate('Machine API Key · v{{version}}', {
                          version: credential.secretVersion,
                        })}
                      </Typography>
                      <Typography variant="caption" color="text.secondary">
                        {maskClientId(credential.clientId)}
                      </Typography>
                    </Box>
                  </Stack>
                </TableCell>
                <TableCell>
                  <IntegrationStatus value={credential.status} translate={translate} />
                </TableCell>
                <TableCell>{formatDate(credential.createdAt, locale)}</TableCell>
                <TableCell>{formatDate(credential.expiresAt, locale)}</TableCell>
                <TableCell align="right">
                  {credential.secretAvailable ? (
                    <Button
                      size="small"
                      variant="contained"
                      disabled={busy}
                      startIcon={<Iconify icon="solar:shield-keyhole-bold-duotone" />}
                      onClick={() => onReveal(credential)}
                    >
                      {translate('领取 Secret')}
                    </Button>
                  ) : (
                    <Typography variant="caption" color="text.secondary">
                      {translate('Secret 已领取')}
                    </Typography>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableContainer>
    </>
  );
}

function IpRuleTable({
  rows,
  locale,
  translate,
}: {
  rows: IpAllowlistEntry[];
  locale: string;
  translate: Translate;
}) {
  if (!rows.length) {
    return (
      <EmptyPanel
        icon="solar:shield-network-bold-duotone"
        title={translate('尚无已批准的 IP 规则')}
        description={translate('提交申请并经后台审批后，规则会显示在这里。')}
      />
    );
  }

  return (
    <TableContainer sx={{ mt: 1.5 }}>
      <Table size="small" sx={{ minWidth: 580 }}>
        <TableHead>
          <TableRow>
            <TableCell>{translate('名称 / 出口用途')}</TableCell>
            <TableCell>CIDR</TableCell>
            <TableCell>{translate('状态')}</TableCell>
            <TableCell>{translate('最后更新')}</TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {rows.map((row) => (
            <TableRow key={row.id} hover>
              <TableCell>
                <Typography variant="subtitle2">{row.label || translate('未命名规则')}</Typography>
                <Typography variant="caption" color="text.secondary">
                  {environmentLabel(row.environment, translate)}
                </Typography>
              </TableCell>
              <TableCell>
                <Typography variant="body2" sx={{ fontWeight: 600 }}>
                  {row.cidr}
                </Typography>
              </TableCell>
              <TableCell>
                <IntegrationStatus
                  value={row.enabled || row.status === 'active' ? 'active' : row.status}
                  translate={translate}
                />
              </TableCell>
              <TableCell>{formatDate(row.updatedAt || row.createdAt, locale)}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </TableContainer>
  );
}

function WebhookEndpointTable({
  rows,
  locale,
  translate,
  onSelect,
}: {
  rows: WebhookEndpoint[];
  locale: string;
  translate: Translate;
  onSelect: (webhook: WebhookEndpoint) => void;
}) {
  if (!rows.length) {
    return (
      <EmptyPanel
        icon="solar:bell-bing-bold-duotone"
        title={translate('尚无 Webhook 端点')}
        description={translate('提交配置申请并经后台审批后，端点会显示在这里。')}
      />
    );
  }

  return (
    <TableContainer sx={{ mt: 1.5 }}>
      <Table size="small" sx={{ minWidth: 720 }}>
        <TableHead>
          <TableRow>
            <TableCell>{translate('端点')}</TableCell>
            <TableCell>{translate('状态')}</TableCell>
            <TableCell>{translate('投递健康')}</TableCell>
            <TableCell>{translate('最后更新')}</TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {rows.map((row) => {
            const active = ['active', 'enabled'].includes(row.status);
            return (
              <TableRow
                key={row.id}
                hover
                tabIndex={0}
                role="button"
                onClick={() => onSelect(row)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') onSelect(row);
                }}
                sx={{ cursor: 'pointer' }}
              >
                <TableCell>
                  <Typography variant="subtitle2" sx={{ overflowWrap: 'anywhere' }}>
                    {row.endpointUrl}
                  </Typography>
                  <Typography variant="caption" color="text.secondary">
                    {translate('{{count}} 个订阅事件', { count: row.events.length })}
                  </Typography>
                </TableCell>
                <TableCell>
                  <IntegrationStatus value={row.status} translate={translate} />
                </TableCell>
                <TableCell>
                  <Typography variant="body2">
                    {translate(active ? '正常投递' : '当前未投递')}
                  </Typography>
                  <Typography variant="caption" color="text.secondary">
                    {row.lastSuccessAt
                      ? translate('最近成功：{{time}}', {
                          time: formatDate(row.lastSuccessAt, locale),
                        })
                      : translate('暂无成功投递')}
                  </Typography>
                </TableCell>
                <TableCell>{formatDate(row.updatedAt || row.createdAt, locale)}</TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </TableContainer>
  );
}

function RequestHistoryTable({
  rows,
  locale,
  cancelMutation,
  onCancel,
  translate,
}: {
  rows: IntegrationRequest[];
  locale: string;
  cancelMutation: string;
  onCancel: (request: IntegrationRequest) => void;
  translate: Translate;
}) {
  if (!rows.length) {
    return (
      <EmptyPanel
        icon="solar:clipboard-list-bold-duotone"
        title={translate('暂无配置申请')}
        description={translate('白名单或 Webhook 申请提交后会显示在这里。')}
      />
    );
  }

  return (
    <>
      <Stack spacing={1.5} sx={{ mt: 1.5, display: { xs: 'flex', md: 'none' } }}>
        {rows.map((row) => {
          const canCancel = ['submitted', 'pending'].includes(row.status);
          return (
            <Box
              key={row.id}
              sx={{
                p: 2,
                border: '1px solid',
                borderColor: 'divider',
                borderRadius: 1.5,
                bgcolor: 'background.paper',
              }}
            >
              <Stack spacing={1.5}>
                <Stack
                  direction={{ xs: 'column', sm: 'row' }}
                  justifyContent="space-between"
                  alignItems={{ xs: 'flex-start', sm: 'center' }}
                  spacing={1}
                >
                  <Box>
                    <Typography variant="subtitle2">
                      {translate(row.kind === 'webhook' ? 'Webhook' : 'IP 白名单')}
                    </Typography>
                    <Typography variant="caption" color="text.secondary">
                      {requestActionLabel(row, translate)}
                    </Typography>
                  </Box>
                  <IntegrationStatus value={row.status} translate={translate} />
                </Stack>

                <Box>
                  <Typography variant="caption" color="text.secondary">
                    {translate('申请内容')}
                  </Typography>
                  <Typography variant="body2" sx={{ mt: 0.5, overflowWrap: 'anywhere' }}>
                    {requestTarget(row, translate)}
                  </Typography>
                  {row.reviewNote && (
                    <Typography
                      variant="caption"
                      color="text.secondary"
                      sx={{ mt: 0.75, display: 'block', overflowWrap: 'anywhere' }}
                    >
                      {translate('后台备注：{{note}}', { note: row.reviewNote })}
                    </Typography>
                  )}
                </Box>

                <ConfigInfo
                  label={translate('提交时间')}
                  value={formatDate(row.createdAt, locale)}
                />

                {canCancel && (
                  <Button
                    fullWidth
                    color="inherit"
                    variant="outlined"
                    disabled={Boolean(cancelMutation)}
                    onClick={() => onCancel(row)}
                    sx={{ minHeight: 44 }}
                  >
                    {cancelMutation === row.id ? translate('取消中…') : translate('取消申请')}
                  </Button>
                )}
              </Stack>
            </Box>
          );
        })}
      </Stack>

      <TableContainer sx={{ mt: 1.5, display: { xs: 'none', md: 'block' } }}>
        <Table size="small" sx={{ minWidth: 720 }}>
          <TableHead>
            <TableRow>
              <TableCell>{translate('类型')}</TableCell>
              <TableCell>{translate('申请内容')}</TableCell>
              <TableCell>{translate('状态')}</TableCell>
              <TableCell>{translate('提交时间')}</TableCell>
              <TableCell align="right">{translate('操作')}</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {rows.map((row) => {
              const canCancel = ['submitted', 'pending'].includes(row.status);
              return (
                <TableRow key={row.id} hover>
                  <TableCell>
                    <Typography variant="subtitle2">
                      {translate(row.kind === 'webhook' ? 'Webhook' : 'IP 白名单')}
                    </Typography>
                    <Typography variant="caption" color="text.secondary">
                      {requestActionLabel(row, translate)}
                    </Typography>
                  </TableCell>
                  <TableCell>
                    <Typography variant="body2" sx={{ maxWidth: 260, overflowWrap: 'anywhere' }}>
                      {requestTarget(row, translate)}
                    </Typography>
                    {row.reviewNote && (
                      <Typography variant="caption" color="text.secondary">
                        {translate('后台备注：{{note}}', { note: row.reviewNote })}
                      </Typography>
                    )}
                  </TableCell>
                  <TableCell>
                    <IntegrationStatus value={row.status} translate={translate} />
                  </TableCell>
                  <TableCell>{formatDate(row.createdAt, locale)}</TableCell>
                  <TableCell align="right">
                    {canCancel ? (
                      <Button
                        size="small"
                        color="inherit"
                        disabled={Boolean(cancelMutation)}
                        onClick={() => onCancel(row)}
                      >
                        {cancelMutation === row.id ? translate('取消中…') : translate('取消申请')}
                      </Button>
                    ) : (
                      <Typography variant="caption" color="text.disabled">
                        —
                      </Typography>
                    )}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </TableContainer>
    </>
  );
}

function WebhookEndpointDetail({
  webhook,
  deliveries,
  locale,
  translate,
  onBack,
  onEdit,
  onTest,
  onSelectDelivery,
  busy,
  error,
}: {
  webhook: WebhookEndpoint;
  deliveries: WebhookDelivery[];
  locale: string;
  translate: Translate;
  onBack: () => void;
  onEdit: () => void;
  onTest: () => void;
  onSelectDelivery: (delivery: WebhookDelivery) => void;
  busy: boolean;
  error: string;
}) {
  return (
    <Stack spacing={3}>
      {error && <Alert severity="error">{error}</Alert>}
      <Button
        color="inherit"
        size="small"
        startIcon={<Iconify icon="solar:arrow-left-linear" />}
        onClick={onBack}
        sx={{ alignSelf: 'flex-start' }}
      >
        {translate('返回 Webhook 列表')}
      </Button>

      <Stack direction={{ xs: 'column', md: 'row' }} justifyContent="space-between" spacing={2}>
        <Stack direction="row" spacing={1.5} alignItems="flex-start">
          <Box
            sx={{
              width: 44,
              height: 44,
              display: 'grid',
              placeItems: 'center',
              borderRadius: 1.25,
              bgcolor: 'background.neutral',
              flexShrink: 0,
            }}
          >
            <Iconify icon="solar:bell-bing-bold-duotone" width={24} />
          </Box>
          <Box sx={{ minWidth: 0 }}>
            <Typography variant="h6">{translate('Webhook 详情')}</Typography>
            <Typography color="text.secondary" sx={{ overflowWrap: 'anywhere' }}>
              {webhook.endpointUrl}
            </Typography>
          </Box>
        </Stack>
        <Stack direction="row" spacing={1}>
          <Button
            variant="outlined"
            startIcon={<Iconify icon="solar:pen-bold" />}
            disabled={busy}
            onClick={onEdit}
          >
            {translate('编辑')}
          </Button>
          <Button
            variant="contained"
            startIcon={<Iconify icon="solar:play-circle-bold-duotone" />}
            disabled={busy || !['active', 'enabled'].includes(webhook.status)}
            onClick={onTest}
          >
            {translate('发送测试事件')}
          </Button>
        </Stack>
      </Stack>

      <Box
        sx={{
          display: 'grid',
          gridTemplateColumns: {
            xs: '1fr',
            sm: 'repeat(2, minmax(0, 1fr))',
            lg: 'repeat(4, minmax(0, 1fr))',
          },
          gap: 2,
        }}
      >
        <ConfigInfo
          label={translate('订阅事件')}
          value={translate('{{count}} 个事件', { count: webhook.events.length })}
        />
        <Box>
          <Typography variant="caption" color="text.secondary">
            {translate('状态')}
          </Typography>
          <Box sx={{ mt: 0.5 }}>
            <IntegrationStatus value={webhook.status} translate={translate} />
          </Box>
        </Box>
        <ConfigInfo
          label={translate('投递健康')}
          value={translate(webhook.lastSuccessAt ? '正常投递' : '暂无成功投递')}
        />
        <ConfigInfo
          label={translate('最后更新')}
          value={formatDate(webhook.updatedAt || webhook.createdAt, locale)}
        />
      </Box>

      <Box>
        <Typography variant="overline" color="text.secondary">
          {translate('正在监听')}
        </Typography>
        <Stack direction="row" spacing={0.75} useFlexGap flexWrap="wrap" sx={{ mt: 0.75 }}>
          {webhook.events.map((event) => (
            <Label key={event} color="info">
              {webhookEventLabel(event, translate)}
            </Label>
          ))}
        </Stack>
      </Box>

      <Divider />
      <Box>
        <Typography variant="h6">
          {translate('{{count}} 条 Webhook 事件', { count: deliveries.length })}
        </Typography>
        <WebhookDeliveryTable
          rows={deliveries}
          locale={locale}
          translate={translate}
          onSelect={onSelectDelivery}
          limit={100}
        />
      </Box>
    </Stack>
  );
}

export function WebhookDeliveryTable({
  rows,
  locale,
  translate,
  onSelect,
  limit = 10,
}: {
  rows: WebhookDelivery[];
  locale: string;
  translate: Translate;
  onSelect?: (delivery: WebhookDelivery) => void;
  limit?: number;
}) {
  if (!rows.length) {
    return (
      <EmptyPanel
        icon="solar:bell-off-bold-duotone"
        title={translate('暂无 Webhook 投递')}
        description={translate('Webhook 启用并触发事件后，最近投递会显示在这里。')}
      />
    );
  }

  const visibleRows = rows.slice(0, limit);

  return (
    <>
      <Stack spacing={1.5} sx={{ mt: 1.5, display: { xs: 'flex', md: 'none' } }}>
        {visibleRows.map((row) => (
          <Box
            key={row.id}
            tabIndex={onSelect ? 0 : undefined}
            role={onSelect ? 'button' : undefined}
            onClick={() => onSelect?.(row)}
            onKeyDown={(event) => {
              if (onSelect && (event.key === 'Enter' || event.key === ' ')) onSelect(row);
            }}
            sx={{
              p: 2,
              border: '1px solid',
              borderColor: 'divider',
              borderRadius: 1.5,
              bgcolor: 'background.paper',
              cursor: onSelect ? 'pointer' : 'default',
              '&:focus-visible': {
                outline: '2px solid',
                outlineColor: 'primary.main',
                outlineOffset: 2,
              },
            }}
          >
            <Stack spacing={1.5}>
              <Stack
                direction={{ xs: 'column', sm: 'row' }}
                justifyContent="space-between"
                alignItems={{ xs: 'flex-start', sm: 'center' }}
                spacing={1}
              >
                <Box sx={{ minWidth: 0 }}>
                  <Typography variant="subtitle2">
                    {webhookEventLabel(row.eventType, translate)}
                  </Typography>
                </Box>
                <WebhookDeliveryStatus value={row.status} translate={translate} />
              </Stack>

              <Box
                sx={{
                  display: 'grid',
                  gridTemplateColumns: {
                    xs: '1fr',
                    sm: 'repeat(3, minmax(0, 1fr))',
                  },
                  gap: 1.5,
                }}
              >
                <ConfigInfo
                  label={translate('HTTP 结果')}
                  value={row.httpStatus ? `HTTP ${row.httpStatus}` : '—'}
                />
                <ConfigInfo label={translate('尝试次数')} value={String(row.attemptCount)} />
                <ConfigInfo
                  label={translate('时间')}
                  value={formatDate(row.deliveredAt || row.createdAt, locale)}
                />
              </Box>
            </Stack>
          </Box>
        ))}
      </Stack>

      <TableContainer sx={{ mt: 1.5, display: { xs: 'none', md: 'block' } }}>
        <Table size="small" sx={{ minWidth: 650 }}>
          <TableHead>
            <TableRow>
              <TableCell>{translate('事件')}</TableCell>
              <TableCell>{translate('结果')}</TableCell>
              <TableCell>{translate('尝试次数')}</TableCell>
              <TableCell>{translate('时间')}</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {visibleRows.map((row) => (
              <TableRow
                key={row.id}
                hover
                tabIndex={onSelect ? 0 : undefined}
                role={onSelect ? 'button' : undefined}
                onClick={() => onSelect?.(row)}
                onKeyDown={(event) => {
                  if (onSelect && (event.key === 'Enter' || event.key === ' ')) onSelect(row);
                }}
                sx={{ cursor: onSelect ? 'pointer' : 'default' }}
              >
                <TableCell>
                  <Typography variant="subtitle2">
                    {webhookEventLabel(row.eventType, translate)}
                  </Typography>
                </TableCell>
                <TableCell>
                  <WebhookDeliveryStatus value={row.status} translate={translate} />
                  <Typography variant="caption" color="text.secondary" sx={{ ml: 1 }}>
                    {row.httpStatus ? `HTTP ${row.httpStatus}` : ''}
                  </Typography>
                </TableCell>
                <TableCell>{row.attemptCount}</TableCell>
                <TableCell>{formatDate(row.deliveredAt || row.createdAt, locale)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableContainer>
    </>
  );
}

function EmptyPanel({
  icon,
  title,
  description,
}: {
  icon: string;
  title: string;
  description: string;
}) {
  return (
    <Box sx={{ py: 6, px: 2, textAlign: 'center' }}>
      <Iconify icon={icon} width={40} sx={{ color: 'text.disabled', mb: 1 }} />
      <Typography variant="subtitle2">{title}</Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
        {description}
      </Typography>
    </Box>
  );
}

function ConfigInfo({ label, value }: { label: string; value: string }) {
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

function IntegrationStatus({ value, translate }: { value: string; translate: Translate }) {
  const normalized = value || 'unknown';
  let color: 'default' | 'info' | 'success' | 'warning' | 'error' = 'default';
  if (['active', 'enabled', 'approved', 'delivered', 'success'].includes(normalized)) {
    color = 'success';
  } else if (
    ['submitted', 'pending', 'pending_review', 'testing', 'retry_scheduled'].includes(normalized)
  ) {
    color = 'warning';
  } else if (['failed', 'rejected', 'error', 'dead_letter'].includes(normalized)) {
    color = 'error';
  } else if (['paused', 'suspended'].includes(normalized)) {
    color = 'warning';
  } else if (
    ['cancelled', 'disabled', 'not_configured', 'inactive', 'suppressed'].includes(normalized)
  ) {
    color = 'default';
  } else {
    color = 'info';
  }
  return <Label color={color}>{translate(integrationStatusLabel(normalized))}</Label>;
}

export function WebhookDeliveryStatus({
  value,
  translate,
}: {
  value: string;
  translate: Translate;
}) {
  const normalized = value || 'pending';
  let color: 'default' | 'info' | 'success' | 'warning' | 'error' = 'info';
  if (normalized === 'delivered') color = 'success';
  if (normalized === 'retry_scheduled') color = 'warning';
  if (normalized === 'dead_letter') color = 'error';
  if (normalized === 'suppressed') color = 'default';
  const labels: Record<string, string> = {
    pending: '待投递',
    delivering: '投递中',
    retry_scheduled: '等待重试',
    delivered: '投递成功',
    dead_letter: '投递失败',
    suppressed: '已抑制',
  };
  return <Label color={color}>{translate(labels[normalized] || normalized)}</Label>;
}

function confirmationTitle(value: Confirmation | null, translate: Translate) {
  if (!value) return '';
  if (value.kind === 'ip') {
    return translate(
      value.payload.action === 'add' ? '确认提交 IP 添加申请？' : '确认提交 IP 移除申请？'
    );
  }
  if (value.kind === 'webhook') {
    return translate(
      value.payload.action === 'disable' ? '确认申请停用 Webhook？' : '确认提交 Webhook 配置申请？'
    );
  }
  if (value.kind === 'cancel') return translate('确认取消这条配置申请？');
  return translate('发送测试 Webhook？');
}

function confirmationContent(
  value: Confirmation | null,
  snapshot: IntegrationSnapshot,
  translate: Translate
) {
  if (!value) return null;
  if (value.kind === 'ip') {
    const target = snapshot.ipAllowlist.find((entry) => entry.id === value.payload.target_entry_id);
    return (
      <Stack spacing={2}>
        <Alert severity="info">
          {translate('提交后进入后台审批；审批前不会改变机器 API 的访问权限。')}
        </Alert>
        <Box
          sx={{
            display: 'grid',
            gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' },
            gap: 2,
          }}
        >
          <ConfigInfo
            label={translate('申请类型')}
            value={translate(value.payload.action === 'add' ? '添加规则' : '移除规则')}
          />
          <ConfigInfo
            label={translate('出口用途')}
            value={environmentLabel(
              value.payload.environment || target?.environment || '',
              translate
            )}
          />
          <ConfigInfo
            label={translate('规则名称')}
            value={value.payload.label || target?.label || translate('未命名规则')}
          />
          <ConfigInfo label="CIDR" value={value.payload.cidr || target?.cidr || '—'} />
        </Box>
        <ConfigInfo label={translate('申请原因')} value={value.payload.reason} />
      </Stack>
    );
  }

  if (value.kind === 'webhook') {
    return (
      <Stack spacing={2}>
        <Alert severity="info">
          {translate('后台审批通过后才会更新生效配置；签名密钥将由运营方通过安全渠道交付。')}
        </Alert>
        <ConfigInfo
          label={translate('申请类型')}
          value={translate(
            value.payload.action === 'disable' ? '停用 Webhook' : '新增或更新 Webhook'
          )}
        />
        {value.payload.action === 'upsert' && (
          <>
            <ConfigInfo
              label={translate('Webhook 地址')}
              value={value.payload.endpoint_url || '—'}
            />
            <ConfigInfo
              label={translate('订阅事件')}
              value={(value.payload.events || [])
                .map((event) => webhookEventLabel(event, translate))
                .join('、')}
            />
          </>
        )}
        <ConfigInfo label={translate('申请原因')} value={value.payload.reason} />
      </Stack>
    );
  }

  if (value.kind === 'cancel') {
    return (
      <Stack spacing={2}>
        <Alert severity="warning">
          {translate('取消后该申请不会再进入后台审批，且无法恢复。')}
        </Alert>
        <ConfigInfo label={translate('申请内容')} value={requestTarget(value.request, translate)} />
      </Stack>
    );
  }

  return (
    <Stack spacing={2}>
      <Alert severity="info">
        {translate('系统会向当前生效地址发送测试事件，不会改变客户或账本数据。')}
      </Alert>
      <ConfigInfo
        label={translate('当前 Webhook 地址')}
        value={
          snapshot.webhooks.find((item) => ['active', 'enabled'].includes(item.status))
            ?.endpointUrl ||
          snapshot.webhooks[0]?.endpointUrl ||
          '—'
        }
      />
    </Stack>
  );
}

function normalizeIntegrationSnapshot(value: any): IntegrationSnapshot {
  const root = asRecord(value?.data ?? value);
  const summary = asRecord(root.summary);
  const security = asRecord(root.security);
  const rateLimit = asRecord(security.rate_limit ?? root.rate_limit);

  return {
    summary: {
      pending: finiteNumber(summary.pending, 0),
      approvedIpRules: finiteNumber(summary.approved_ip_rules, 0),
      webhookEndpoints: finiteNumber(summary.webhook_endpoints, 0),
      apiCredentials: finiteNumber(summary.api_credentials, 0),
      failedDeliveries: finiteNumber(summary.failed_deliveries, 0),
    },
    security: {
      accessServiceTokenRequired:
        security.access_service_token_required !== false &&
        security.access_service_token_required !== 0,
      ipAllowlistEnabled:
        security.ip_allowlist_enabled === true || security.ip_allowlist_enabled === 1,
      rateLimit: {
        enabled: rateLimit.enabled !== false && rateLimit.enabled !== 0,
        limit: finiteNumber(rateLimit.limit, 120),
        periodSeconds: finiteNumber(rateLimit.period_seconds, 60),
      },
      credentialManagement: {
        configured:
          asRecord(security.credential_management).configured === true ||
          asRecord(security.credential_management).configured === 1,
      },
    },
    credentials: asArray(root.credentials).map(normalizeApiCredential),
    credentialRotationRequests: asArray(root.credential_rotation_requests).map(
      normalizeCredentialRotationRequest
    ),
    webhookSigningKeys: asArray(root.webhook_signing_keys).map(normalizeWebhookSigningKey),
    webhookSigningKeyRequests: asArray(root.webhook_signing_key_requests).map(
      normalizeWebhookSigningKeyRequest
    ),
    ipAllowlist: asArray(root.ip_allowlist).map(normalizeIpEntry),
    webhooks: asArray(root.webhooks).map(normalizeWebhook),
    requests: asArray(root.requests).map(normalizeRequest),
    deliveries: asArray(root.deliveries).map(normalizeDelivery),
  };
}

function normalizeApiCredential(value: unknown): ApiCredential {
  const row = asRecord(value);
  return {
    id: stringValue(row.id),
    clientId: stringValue(row.client_id),
    duration: stringValue(row.duration),
    expiresAt: stringValue(row.expires_at),
    previousSecretExpiresAt: stringValue(row.previous_secret_expires_at),
    status: stringValue(row.status),
    revealStatus: stringValue(row.reveal_status),
    secretAvailable: row.secret_available === true || row.reveal_status === 'available',
    updatedAt: stringValue(row.updated_at),
    revealedAt: stringValue(row.revealed_at),
    createdAt: stringValue(row.created_at),
    secretVersion: finiteNumber(row.secret_version, 1),
  };
}

function normalizeCredentialRotationRequest(value: unknown): CredentialRotationRequest {
  const row = asRecord(value);
  return {
    id: stringValue(row.id),
    status: stringValue(row.status),
    reason: stringValue(row.reason),
    migrationWindowHours: finiteNumber(row.migration_window_hours, 48),
    createdAt: stringValue(row.created_at),
    reviewedAt: stringValue(row.reviewed_at),
    reviewNote: stringValue(row.review_note),
  };
}

function normalizeWebhookSigningKey(value: unknown): WebhookSigningKey {
  const row = asRecord(value);
  return {
    id: stringValue(row.key_id ?? row.id),
    status: stringValue(row.status),
    revealStatus: stringValue(row.reveal_status),
    secretAvailable: row.secret_available === true || row.reveal_status === 'available',
    overlapHours: finiteNumber(row.overlap_hours, 48),
    createdAt: stringValue(row.created_at),
    activatedAt: stringValue(row.activated_at),
    expiresAt: stringValue(row.expires_at),
    secretVersion: finiteNumber(row.secret_version, 1),
  };
}

function normalizeWebhookSigningKeyRequest(value: unknown): WebhookSigningKeyRequest {
  const row = asRecord(value);
  return {
    id: stringValue(row.id),
    status: stringValue(row.status),
    reason: stringValue(row.reason),
    overlapHours: finiteNumber(row.overlap_hours, 48),
    createdAt: stringValue(row.created_at),
    reviewNote: stringValue(row.review_note),
  };
}

function maskClientId(value: string) {
  if (!value) return '—';
  if (value.length <= 18) return value;
  return `${value.slice(0, 10)}••••••${value.slice(-12)}`;
}

function normalizeIpEntry(value: unknown): IpAllowlistEntry {
  const row = asRecord(value);
  return {
    id: stringValue(row.id),
    label: stringValue(row.label ?? row.name),
    cidr: stringValue(row.cidr),
    environment: stringValue(row.environment),
    enabled: row.enabled === true || row.enabled === 1 || row.status === 'active',
    status: stringValue(row.status || (row.enabled ? 'active' : 'disabled')),
    createdAt: stringValue(row.created_at),
    updatedAt: stringValue(row.updated_at),
  };
}

function normalizeWebhook(value: unknown): WebhookEndpoint {
  const row = asRecord(value);
  return {
    id: stringValue(row.id),
    endpointUrl: stringValue(row.endpoint_url ?? row.url),
    events: stringArray(row.events),
    status: stringValue(row.status || (row.enabled ? 'active' : 'disabled')),
    lastDeliveryAt: stringValue(row.last_delivery_at),
    lastSuccessAt: stringValue(row.last_success_at ?? row.last_delivered_at),
    createdAt: stringValue(row.created_at),
    updatedAt: stringValue(row.updated_at),
  };
}

function normalizeRequest(value: unknown): IntegrationRequest {
  const row = asRecord(value);
  const rawKind = stringValue(row.kind ?? row.request_kind ?? row.type);
  return {
    id: stringValue(row.id),
    kind: rawKind.includes('webhook') ? 'webhook' : 'ip_allowlist',
    action: stringValue(row.action),
    status: stringValue(row.status || 'submitted'),
    cidr: stringValue(row.cidr),
    label: stringValue(row.label),
    environment: stringValue(row.environment),
    targetEntryId: stringValue(row.target_entry_id),
    endpointUrl: stringValue(row.endpoint_url ?? row.url),
    events: stringArray(row.events),
    reason: stringValue(row.reason),
    createdAt: stringValue(row.created_at),
    updatedAt: stringValue(row.updated_at),
    reviewedAt: stringValue(row.reviewed_at),
    reviewNote: stringValue(row.review_note),
  };
}

export function normalizeDelivery(value: unknown): WebhookDelivery {
  const row = asRecord(value);
  const statusValue = Number(row.http_status ?? row.response_status);
  return {
    id: stringValue(row.id),
    eventType: stringValue(row.event_type ?? row.event),
    status: stringValue(row.status),
    httpStatus: Number.isFinite(statusValue) && statusValue > 0 ? statusValue : null,
    attemptCount: finiteNumber(row.attempt_count ?? row.attempts, 0),
    createdAt: stringValue(row.created_at),
    deliveredAt: stringValue(row.delivered_at ?? row.completed_at),
    requestId: stringValue(row.request_id),
    error: stringValue(row.error ?? row.last_error),
    payload: stringValue(row.payload_json),
    endpointUrl: stringValue(row.endpoint_url),
    resourceId: stringValue(row.resource_id),
    resourceStatus: stringValue(row.resource_status),
  };
}

function asRecord(value: unknown): Record<string, any> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, any>)
    : {};
}

export function formatJson(value: string) {
  if (!value) return '—';
  try {
    return JSON.stringify(JSON.parse(value), null, 2);
  } catch {
    return value;
  }
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function stringValue(value: unknown) {
  if (typeof value === 'string') return value;
  if (value == null) return '';
  return String(value);
}

function stringArray(value: unknown) {
  if (Array.isArray(value)) return value.map(stringValue).filter(Boolean);
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      if (Array.isArray(parsed)) return parsed.map(stringValue).filter(Boolean);
    } catch {
      return value
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean);
    }
  }
  return [];
}

function finiteNumber(value: unknown, fallback: number) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function integrationErrorMessage(caught: unknown, translate: Translate) {
  if (!(caught instanceof Error)) return translate('请求失败，请重试');
  const error = caught as PortalApiError;
  if (error.code === 'session_unavailable') {
    return translate('API 会话不可用，请刷新页面后重新登录');
  }
  const localized = getLocalizedApiError(
    error.code ? { error: { code: error.code } } : undefined,
    translate('请求失败，请重试')
  );
  return error.requestId
    ? translate('{{message}}（请求编号：{{requestId}}）', {
        message: localized,
        requestId: error.requestId,
      })
    : localized;
}

export function webhookEventLabel(value: string, translate: Translate) {
  if (value === 'webhook.test') return translate('Webhook 测试');
  const event = WEBHOOK_EVENTS.find((item) => item.value === value);
  return event ? translate(event.label) : value || '—';
}

function environmentLabel(value: string, translate: Translate) {
  const environment = IP_ENVIRONMENTS.find((item) => item.value === value);
  return environment ? translate(environment.label) : value || '—';
}

function integrationStatusLabel(value: string) {
  const labels: Record<string, string> = {
    active: '已启用',
    enabled: '已启用',
    approved: '已批准',
    submitted: '待审批',
    pending: '待审批',
    pending_review: '待审批',
    rejected: '已拒绝',
    cancelled: '已取消',
    disabled: '已停用',
    inactive: '未启用',
    not_configured: '尚未配置',
    delivered: '投递成功',
    delivering: '投递中',
    retry_scheduled: '等待重试',
    dead_letter: '投递失败',
    success: '成功',
    failed: '失败',
    error: '异常',
    paused: '已暂停',
    suspended: '已暂停',
    suppressed: '已抑制',
    testing: '测试中',
  };
  return labels[value] || value || '未知';
}

function webhookStatusLabel(value: string) {
  return integrationStatusLabel(value);
}

function requestActionLabel(value: IntegrationRequest, translate: Translate) {
  if (value.kind === 'webhook') {
    return translate(value.action === 'disable' ? '停用 Webhook' : '新增或更新 Webhook');
  }
  return translate(value.action === 'remove' ? '移除规则' : '添加规则');
}

function requestTarget(value: IntegrationRequest, translate: Translate) {
  if (value.kind === 'webhook') {
    return value.action === 'disable' ? translate('停用当前 Webhook') : value.endpointUrl || '—';
  }
  return value.cidr || value.label || value.targetEntryId || '—';
}

function formatDate(value: string, locale: string) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(locale, {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

function isValidWebhookUrl(value: string) {
  const raw = value.trim();
  if (raw.length < 10 || raw.length > 2048) return false;
  try {
    const url = new URL(raw);
    if (url.protocol !== 'https:') return false;
    if (url.username || url.password) return false;
    if (url.search || url.hash) return false;
    if (url.port && url.port !== '443') return false;
    const hostname = url.hostname.toLowerCase();
    const labels = hostname.split('.');
    const validLabels =
      labels.length >= 2 &&
      labels.every(
        (label) =>
          label.length >= 1 && label.length <= 63 && /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(label)
      );
    const topLevel = labels.at(-1) || '';
    const validTopLevel = /^[a-z]{2,63}$/.test(topLevel) || /^xn--[a-z0-9-]{2,59}$/.test(topLevel);
    const reservedSuffixes = [
      '.localhost',
      '.local',
      '.internal',
      '.home',
      '.lan',
      '.test',
      '.invalid',
      '.example',
    ];
    const isIpLiteral =
      Boolean(parsePortalIpv4Bytes(hostname)) || hostname.includes(':') || hostname.startsWith('[');
    return Boolean(
      validLabels &&
        validTopLevel &&
        !isIpLiteral &&
        hostname !== 'localhost' &&
        !reservedSuffixes.some((suffix) => hostname.endsWith(suffix))
    );
  } catch {
    return false;
  }
}

function isValidCidr(value: string) {
  const parsed = parsePortalIpCidr(value);
  if (!parsed) return false;
  if (parsed.family === 4) {
    const blocked = [
      '0.0.0.0/8',
      '10.0.0.0/8',
      '100.64.0.0/10',
      '127.0.0.0/8',
      '169.254.0.0/16',
      '172.16.0.0/12',
      '192.0.0.0/24',
      '192.0.2.0/24',
      '192.88.99.0/24',
      '192.168.0.0/16',
      '198.18.0.0/15',
      '198.51.100.0/24',
      '203.0.113.0/24',
      '224.0.0.0/4',
      '240.0.0.0/4',
    ]
      .map(parsePortalIpCidr)
      .filter((item): item is PortalIpCidr => Boolean(item));
    return parsed.prefixLength >= 8 && !blocked.some((range) => portalCidrsOverlap(parsed, range));
  }

  const globalUnicast = parsePortalIpCidr('2000::/3');
  const blocked = ['2001::/23', '2001:db8::/32', '2002::/16', '3fff::/20']
    .map(parsePortalIpCidr)
    .filter((item): item is PortalIpCidr => Boolean(item));
  return Boolean(
    parsed.prefixLength >= 32 &&
      globalUnicast &&
      portalIpMatchesCidr(parsed, globalUnicast) &&
      !blocked.some((range) => portalCidrsOverlap(parsed, range))
  );
}

type PortalIpCidr = {
  family: 4 | 6;
  prefixLength: number;
  networkBytes: number[];
};

/* eslint-disable no-bitwise -- byte-level IP parsing intentionally mirrors the Worker validator. */
function parsePortalIpv4Bytes(value: string): number[] | null {
  const parts = value.split('.');
  if (parts.length !== 4 || parts.some((part) => !/^(0|[1-9]\d{0,2})$/.test(part))) {
    return null;
  }
  const bytes = parts.map(Number);
  return bytes.every((byte) => byte >= 0 && byte <= 255) ? bytes : null;
}

function parsePortalIpv6Bytes(value: string): number[] | null {
  if (!value || value.includes('%')) return null;
  let candidate = value.toLowerCase();

  if (candidate.includes('.')) {
    const lastColon = candidate.lastIndexOf(':');
    if (lastColon < 0) return null;
    const ipv4Bytes = parsePortalIpv4Bytes(candidate.slice(lastColon + 1));
    if (!ipv4Bytes) return null;
    const high = ((ipv4Bytes[0] << 8) | ipv4Bytes[1]).toString(16);
    const low = ((ipv4Bytes[2] << 8) | ipv4Bytes[3]).toString(16);
    candidate = `${candidate.slice(0, lastColon + 1)}${high}:${low}`;
  }

  if (!/^[0-9a-f:]+$/.test(candidate)) return null;
  const compressedIndex = candidate.indexOf('::');
  if (compressedIndex >= 0 && compressedIndex !== candidate.lastIndexOf('::')) {
    return null;
  }

  let groups: string[];
  if (compressedIndex >= 0) {
    const [left, right] = candidate.split('::');
    const leftGroups = left ? left.split(':') : [];
    const rightGroups = right ? right.split(':') : [];
    const missingGroups = 8 - leftGroups.length - rightGroups.length;
    if (missingGroups < 1) return null;
    groups = [...leftGroups, ...Array<string>(missingGroups).fill('0'), ...rightGroups];
  } else {
    groups = candidate.split(':');
    if (groups.length !== 8) return null;
  }

  if (groups.length !== 8 || groups.some((group) => !/^[0-9a-f]{1,4}$/.test(group))) {
    return null;
  }

  const bytes: number[] = [];
  groups.forEach((group) => {
    const value16 = Number.parseInt(group, 16);
    bytes.push(value16 >> 8, value16 & 0xff);
  });
  return bytes;
}

function maskPortalIpBytes(bytes: number[], prefixLength: number) {
  return bytes.map((byte, index) => {
    const remaining = prefixLength - index * 8;
    if (remaining >= 8) return byte;
    if (remaining <= 0) return 0;
    return byte & ((0xff << (8 - remaining)) & 0xff);
  });
}

function parsePortalIpCidr(value: string): PortalIpCidr | null {
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > 128 || /\s/.test(trimmed)) return null;
  const parts = trimmed.split('/');
  if (parts.length > 2 || !parts[0]) return null;
  const family: 4 | 6 = parts[0].includes(':') ? 6 : 4;
  const bytes = family === 6 ? parsePortalIpv6Bytes(parts[0]) : parsePortalIpv4Bytes(parts[0]);
  if (!bytes) return null;
  const maximumPrefix = family === 4 ? 32 : 128;
  let prefixLength = maximumPrefix;
  if (parts.length === 2) {
    if (!/^(0|[1-9]\d{0,2})$/.test(parts[1])) return null;
    prefixLength = Number(parts[1]);
    if (prefixLength > maximumPrefix) return null;
  }
  return {
    family,
    prefixLength,
    networkBytes: maskPortalIpBytes(bytes, prefixLength),
  };
}

function portalIpMatchesCidr(client: PortalIpCidr, cidr: PortalIpCidr) {
  if (client.family !== cidr.family) return false;
  const clientNetwork = maskPortalIpBytes(client.networkBytes, cidr.prefixLength);
  return clientNetwork.every((byte, index) => byte === cidr.networkBytes[index]);
}

function portalCidrsOverlap(left: PortalIpCidr, right: PortalIpCidr) {
  if (left.family !== right.family) return false;
  const shorter = left.prefixLength <= right.prefixLength ? left : right;
  const longer = shorter === left ? right : left;
  return portalIpMatchesCidr(longer, shorter);
}
/* eslint-enable no-bitwise */
