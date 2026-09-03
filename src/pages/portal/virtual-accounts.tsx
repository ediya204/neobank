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
import { portalLocale, portalText } from 'src/locales/portal-text';

export default function VirtualAccountsPage() {
  const { customer } = usePortalCustomer();
  const [channels, setChannels] = useState<FundingChannel[]>([]);
  const [requests, setRequests] = useState<VirtualAccountRequest[]>([]);
  const [channelId, setChannelId] = useState('');
  const [currency, setCurrency] = useState<Currency>('USD');
  const [purpose, setPurpose] = useState(portalText('接收业务款项'));
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
      setError(
        value instanceof Error ? value.message : portalText('暂时无法读取 VA 账户，请稍后重试。')
      );
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
      setSuccess(
        portalText('VA 账户申请已提交。审核完成并取得银行分配的账号后，账户资料会显示在本页。')
      );
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
        <title>
          {portalText('VA 账户')} | {APP_DISPLAY_NAME}
        </title>
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
                {portalText('虚拟账户（VA）')}
              </Typography>
              <Typography color="text.secondary" sx={{ mt: 0.75 }}>
                {portalText('按银行与币种申请专属收款账户，并在本页跟踪审核进度。')}
              </Typography>
            </Box>
            <Button
              variant={applying ? 'outlined' : 'contained'}
              startIcon={<Iconify icon="solar:buildings-2-bold-duotone" />}
              onClick={() => setApplying((value) => !value)}
            >
              {applying ? portalText('收起申请表') : portalText('申请 VA 账户')}
            </Button>
          </Stack>

          {error && <Alert severity="error">{vaErrorMessage(new Error(error))}</Alert>}
          {success && <Alert severity="success">{success}</Alert>}

          {applying && (
            <Card variant="outlined" sx={{ boxShadow: 'none' }}>
              <Box component="form" onSubmit={submit} sx={{ p: { xs: 2.5, md: 3.5 } }}>
                <Stack spacing={2.5}>
                  <Box>
                    <Typography variant="h6">{portalText('选择服务银行')}</Typography>
                    <Typography variant="body2" color="text.secondary">
                      {portalText('本页仅显示当前可受理 VA 账户申请的银行及其支持币种。')}
                    </Typography>
                  </Box>
                  <FormControl fullWidth required>
                    <InputLabel>{portalText('银行')}</InputLabel>
                    <Select
                      label={portalText('银行')}
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
                          {selectedChannel.bankAddress || portalText('银行地址以最终开户资料为准')}
                        </Typography>
                        <Typography variant="caption" color="text.secondary">
                          SWIFT / BIC：{selectedChannel.swiftBic || '—'}
                        </Typography>
                      </Box>
                      <Box>
                        <Typography variant="caption" color="text.secondary">
                          {portalText('支持币种')}
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
                    <Alert severity="info">
                      {portalText('当前暂无可受理申请的银行。如需协助，请联系客户服务团队。')}
                    </Alert>
                  )}

                  {selectedChannel && (
                    <FormControl fullWidth required>
                      <InputLabel>{portalText('开户币种')}</InputLabel>
                      <Select
                        label={portalText('开户币种')}
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
                    label={portalText('账户用途')}
                    value={purpose}
                    inputProps={{ maxLength: 500 }}
                    onChange={(event) => setPurpose(event.target.value)}
                  />

                  <Stack direction="row" justifyContent="flex-end" spacing={1.5}>
                    <Button color="inherit" onClick={() => setApplying(false)}>
                      {portalText('取消')}
                    </Button>
                    <Button
                      type="submit"
                      variant="contained"
                      disabled={!selectedChannel || submitting}
                    >
                      {submitting ? portalText('正在提交…') : portalText('提交申请')}
                    </Button>
                  </Stack>
                </Stack>
              </Box>
            </Card>
          )}

          <Box>
            <Typography variant="h5">{portalText('VA 账户与申请记录')}</Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
              {portalText('账户名称、账号及 IBAN 以银行最终分配结果为准。')}
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
                {portalText('暂无 VA 账户申请')}
              </Typography>
              <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
                {portalText('申请后可在本页查看审核状态及已开通账户资料。')}
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
    SUBMITTED: { label: portalText('审核中'), color: 'warning' as const },
    APPROVED: { label: portalText('已开通'), color: 'success' as const },
    REJECTED: { label: portalText('未通过'), color: 'error' as const },
    CANCELLED: { label: portalText('已取消'), color: 'default' as const },
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
            {request.channel?.settlementBankName ||
              request.channel?.name ||
              portalText('历史 VA 申请')}
          </Typography>
          <Chip size="small" label={status.label} color={status.color} variant="outlined" />
        </Stack>
        <Typography variant="body2" color="text.secondary" sx={{ mt: 0.75 }}>
          {request.purpose}
        </Typography>
      </Box>
      <Box>
        <Typography variant="caption" color="text.secondary">
          {portalText('申请币种')}
        </Typography>
        <Typography variant="h6">{request.currency}</Typography>
        <Typography variant="caption" color="text.secondary">
          {new Date(request.createdAt).toLocaleString(portalLocale())}
        </Typography>
      </Box>
      <Box>
        {account && (
          <Stack spacing={0.35}>
            <Typography variant="subtitle2">{account.name}</Typography>
            <Typography variant="body2">
              {portalText('账号：')}
              {account.accountNumber || '—'}
            </Typography>
            {account.iban && <Typography variant="body2">IBAN：{account.iban}</Typography>}
            <Typography variant="caption" color="text.secondary">
              {[account.swiftBic, account.bankAddress].filter(Boolean).join(' · ')}
            </Typography>
          </Stack>
        )}
        {!account && request.status === 'REJECTED' && (
          <Alert severity="error" variant="outlined">
            {request.rejectionReason ||
              portalText('申请未通过。如需了解详情，请联系客户服务团队。')}
          </Alert>
        )}
        {!account && request.status !== 'REJECTED' && (
          <Typography variant="body2" color="text.secondary">
            {portalText('审核完成并取得银行分配的账号后，账户资料会显示在这里。')}
          </Typography>
        )}
      </Box>
    </Box>
  );
}

function vaErrorMessage(value: unknown) {
  const message = value instanceof Error ? value.message : '';
  const messages: Record<string, string> = {
    active_customer_required: portalText('账户尚未激活，暂时无法申请 VA 账户。'),
    virtual_account_channel_not_found: portalText('所选银行已停用或不存在，请刷新后重新选择。'),
    virtual_account_channel_currency_unsupported:
      portalText('所选银行不支持这个币种，请重新选择。'),
    virtual_account_request_already_pending: portalText('该银行和币种已有一笔审核中的申请。'),
    virtual_account_purpose_required: portalText('请说明该账户的主要用途。'),
    customer_core_route_forbidden: portalText('当前账户没有申请 VA 账户的权限。'),
  };
  return messages[message] || message || portalText('暂时无法处理 VA 账户申请，请稍后重试。');
}
