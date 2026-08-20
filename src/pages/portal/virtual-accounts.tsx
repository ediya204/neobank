import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import { Helmet } from 'react-helmet-async';
import {
  Alert,
  Box,
  Button,
  Card,
  Chip,
  Container,
  Divider,
  FormControl,
  InputLabel,
  MenuItem,
  Select,
  Skeleton,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import Iconify from 'src/components/iconify';
import { APP_DISPLAY_NAME } from 'src/config-global';
import { usePortalCustomer } from 'src/features/finance/portal-customer-context';
import {
  coreApi,
  Currency,
  demoOrganizationId,
  FundingChannel,
  VirtualAccountRequest,
} from 'src/features/finance/core-api';

export default function VirtualAccountsPage() {
  const { customer } = usePortalCustomer();
  const [channels, setChannels] = useState<FundingChannel[]>([]);
  const [requests, setRequests] = useState<VirtualAccountRequest[]>([]);
  const [channelId, setChannelId] = useState('');
  const [currency, setCurrency] = useState<Currency>('USD');
  const [purpose, setPurpose] = useState('接收业务款项');
  const [applying, setApplying] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const load = useCallback(async () => {
    if (!customer?.id) return;
    setLoading(true);
    setError('');
    try {
      const [channelRows, requestRows] = await Promise.all([
        coreApi<FundingChannel[]>(
          `/funding-channels?organizationId=${demoOrganizationId}&type=VIRTUAL_ACCOUNT&active=true`
        ),
        coreApi<VirtualAccountRequest[]>(`/customers/${customer.id}/virtual-account-requests`),
      ]);
      setChannels(channelRows);
      setRequests(requestRows);
      if (!channelRows.some((channel) => channel.id === channelId)) {
        const first = channelRows[0];
        setChannelId(first?.id || '');
        if (first?.supportedCurrencies[0]) setCurrency(first.supportedCurrencies[0]);
      }
    } catch (value) {
      setError(value instanceof Error ? value.message : 'VA 账户数据加载失败');
    } finally {
      setLoading(false);
    }
  }, [channelId, customer?.id]);

  useEffect(() => {
    load().catch(() => undefined);
  }, [load]);

  const selectedChannel = useMemo(
    () => channels.find((channel) => channel.id === channelId),
    [channelId, channels]
  );

  const selectChannel = (nextChannelId: string) => {
    const channel = channels.find((item) => item.id === nextChannelId);
    setChannelId(nextChannelId);
    if (channel && !channel.supportedCurrencies.includes(currency)) {
      setCurrency(channel.supportedCurrencies[0]);
    }
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!customer?.id || !selectedChannel) return;
    setSubmitting(true);
    setError('');
    setSuccess('');
    try {
      await coreApi(`/customers/${customer.id}/virtual-account-requests`, {
        method: 'POST',
        body: JSON.stringify({ channelId: selectedChannel.id, currency, purpose }),
      });
      setSuccess('VA 申请已提交。银行账号会在后台完成审核与录入后显示。');
      setApplying(false);
      await load();
    } catch (value) {
      setError(vaErrorMessage(value));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <>
      <Helmet>
        <title>VA 账户 | {APP_DISPLAY_NAME}</title>
      </Helmet>
      <Container maxWidth="lg">
        <Stack spacing={3}>
          <Stack
            direction={{ xs: 'column', sm: 'row' }}
            justifyContent="space-between"
            alignItems={{ xs: 'flex-start', sm: 'center' }}
            gap={2}
          >
            <Box>
              <Typography variant="overline" color="primary.main">
                Virtual accounts
              </Typography>
              <Typography variant="h3" sx={{ mt: 0.25 }}>
                VA 账户
              </Typography>
              <Typography color="text.secondary" sx={{ mt: 0.75 }}>
                选择银行并查看其支持币种；提交后由运营录入银行实际分配的账号。
              </Typography>
            </Box>
            <Button
              variant={applying ? 'outlined' : 'contained'}
              startIcon={<Iconify icon="solar:buildings-2-bold-duotone" />}
              onClick={() => setApplying((value) => !value)}
            >
              {applying ? '收起申请' : '申请 VA'}
            </Button>
          </Stack>

          {error && <Alert severity="error">{vaErrorMessage(new Error(error))}</Alert>}
          {success && <Alert severity="success">{success}</Alert>}

          {applying && (
            <Card variant="outlined" sx={{ boxShadow: 'none' }}>
              <Box component="form" onSubmit={submit} sx={{ p: { xs: 2.5, md: 3.5 } }}>
                <Stack spacing={2.5}>
                  <Box>
                    <Typography variant="h6">选择开户银行</Typography>
                    <Typography variant="body2" color="text.secondary">
                      这里只显示后台已启用、资料完整的 VA 银行渠道。
                    </Typography>
                  </Box>
                  <FormControl fullWidth required>
                    <InputLabel>银行</InputLabel>
                    <Select
                      label="银行"
                      value={channelId}
                      onChange={(event) => selectChannel(event.target.value)}
                    >
                      {channels.map((channel) => (
                        <MenuItem key={channel.id} value={channel.id}>
                          {channel.settlementBankName || channel.name} ·{' '}
                          {channel.bankCountry || '--'}
                        </MenuItem>
                      ))}
                    </Select>
                  </FormControl>

                  {selectedChannel ? (
                    <Box
                      sx={{
                        display: 'grid',
                        gridTemplateColumns: { xs: '1fr', md: '1.2fr .8fr' },
                        gap: 2,
                        p: 2.5,
                        bgcolor: 'background.neutral',
                        borderRadius: 1.5,
                      }}
                    >
                      <Box>
                        <Typography variant="subtitle1">
                          {selectedChannel.settlementBankName || selectedChannel.name}
                        </Typography>
                        <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
                          {selectedChannel.bankAddress || '银行地址由运营维护'}
                        </Typography>
                        <Typography variant="caption" color="text.secondary">
                          SWIFT / BIC：{selectedChannel.swiftBic || '—'}
                        </Typography>
                      </Box>
                      <Box>
                        <Typography variant="caption" color="text.secondary">
                          支持币种
                        </Typography>
                        <Stack direction="row" flexWrap="wrap" gap={0.75} sx={{ mt: 0.75 }}>
                          {selectedChannel.supportedCurrencies.map((item) => (
                            <Chip
                              key={item}
                              label={item}
                              size="small"
                              color="primary"
                              variant="outlined"
                            />
                          ))}
                        </Stack>
                      </Box>
                    </Box>
                  ) : (
                    <Alert severity="info">当前没有可申请的 VA 银行，请联系运营人员。</Alert>
                  )}

                  {selectedChannel && (
                    <FormControl fullWidth required>
                      <InputLabel>开户币种</InputLabel>
                      <Select
                        label="开户币种"
                        value={currency}
                        onChange={(event) => setCurrency(event.target.value as Currency)}
                      >
                        {selectedChannel.supportedCurrencies.map((item) => (
                          <MenuItem key={item} value={item}>
                            {item}
                          </MenuItem>
                        ))}
                      </Select>
                    </FormControl>
                  )}
                  <TextField
                    required
                    multiline
                    minRows={2}
                    label="账户用途"
                    value={purpose}
                    inputProps={{ maxLength: 500 }}
                    onChange={(event) => setPurpose(event.target.value)}
                  />
                  <Stack direction="row" justifyContent="flex-end" spacing={1.5}>
                    <Button color="inherit" onClick={() => setApplying(false)}>
                      取消
                    </Button>
                    <Button
                      type="submit"
                      variant="contained"
                      disabled={!selectedChannel || submitting}
                    >
                      {submitting ? '正在提交…' : '提交申请'}
                    </Button>
                  </Stack>
                </Stack>
              </Box>
            </Card>
          )}

          <Box>
            <Typography variant="h5">账户与申请记录</Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
              银行固定资料来自所选渠道；账号与 IBAN 由运营按银行回执录入。
            </Typography>
          </Box>

          {loading && (
            <Stack spacing={1.5}>
              {[0, 1].map((item) => (
                <Skeleton key={item} variant="rounded" height={150} />
              ))}
            </Stack>
          )}
          {!loading && requests.length > 0 && (
            <Card variant="outlined" sx={{ boxShadow: 'none' }}>
              <Stack divider={<Divider flexItem />}>
                {requests.map((request) => (
                  <RequestRow key={request.id} request={request} />
                ))}
              </Stack>
            </Card>
          )}
          {!loading && requests.length === 0 && (
            <Box
              sx={{
                py: 7,
                px: 3,
                textAlign: 'center',
                border: 1,
                borderColor: 'divider',
                borderRadius: 2,
                bgcolor: 'background.paper',
              }}
            >
              <Iconify icon="solar:buildings-2-bold-duotone" width={36} color="primary.main" />
              <Typography variant="h6" sx={{ mt: 1.5 }}>
                尚未申请 VA
              </Typography>
              <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
                选择银行后即可查看支持币种并提交申请。
              </Typography>
            </Box>
          )}
        </Stack>
      </Container>
    </>
  );
}

function RequestRow({ request }: { request: VirtualAccountRequest }) {
  const account = request.assignedAccount;
  const status = {
    SUBMITTED: { label: '审核中', color: 'warning' as const },
    APPROVED: { label: '已开通', color: 'success' as const },
    REJECTED: { label: '未通过', color: 'error' as const },
  }[request.status];
  return (
    <Box
      sx={{
        display: 'grid',
        gridTemplateColumns: {
          xs: '1fr',
          md: 'minmax(230px, 1fr) minmax(180px, .7fr) minmax(260px, 1.2fr)',
        },
        gap: 2,
        p: { xs: 2.5, md: 3 },
      }}
    >
      <Box>
        <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap">
          <Typography variant="subtitle1">
            {request.channel?.settlementBankName || request.channel?.name || '历史 VA 申请'}
          </Typography>
          <Chip size="small" label={status.label} color={status.color} variant="outlined" />
        </Stack>
        <Typography variant="body2" color="text.secondary" sx={{ mt: 0.75 }}>
          {request.purpose}
        </Typography>
      </Box>
      <Box>
        <Typography variant="caption" color="text.secondary">
          申请币种
        </Typography>
        <Typography variant="h6">{request.currency}</Typography>
        <Typography variant="caption" color="text.secondary">
          {new Date(request.createdAt).toLocaleString('zh-CN')}
        </Typography>
      </Box>
      <Box>
        {account && (
          <Stack spacing={0.35}>
            <Typography variant="subtitle2">{account.name}</Typography>
            <Typography variant="body2">账号：{account.accountNumber || '—'}</Typography>
            {account.iban && <Typography variant="body2">IBAN：{account.iban}</Typography>}
            <Typography variant="caption" color="text.secondary">
              {[account.swiftBic, account.bankAddress].filter(Boolean).join(' · ')}
            </Typography>
          </Stack>
        )}
        {!account && request.status === 'REJECTED' && (
          <Alert severity="error" variant="outlined">
            {request.rejectionReason || '申请未通过，请联系运营人员。'}
          </Alert>
        )}
        {!account && request.status !== 'REJECTED' && (
          <Typography variant="body2" color="text.secondary">
            运营录入银行实际账号后会显示在这里。
          </Typography>
        )}
      </Box>
    </Box>
  );
}

function vaErrorMessage(value: unknown) {
  const message = value instanceof Error ? value.message : '';
  const messages: Record<string, string> = {
    active_customer_required: '账户尚未激活，暂时不能申请 VA。',
    virtual_account_channel_not_found: '所选银行已停用或不存在，请刷新后重新选择。',
    virtual_account_channel_currency_unsupported: '所选银行不支持这个币种，请重新选择。',
    virtual_account_request_already_pending: '该银行和币种已有一笔审核中的申请。',
    virtual_account_purpose_required: '请填写清晰的账户用途。',
    customer_core_route_forbidden: '当前客户会话无权访问这项后台能力。',
  };
  return messages[message] || message || 'VA 申请处理失败，请稍后重试。';
}
