import { useCallback, useEffect, useMemo, useState } from 'react';
import { Helmet } from 'react-helmet-async';
import { useNavigate, useParams } from 'react-router-dom';
import {
  Alert,
  Box,
  Button,
  Checkbox,
  CircularProgress,
  Container,
  Divider,
  FormControl,
  FormControlLabel,
  FormLabel,
  MenuItem,
  Paper,
  Radio,
  RadioGroup,
  Stack,
  Step,
  StepLabel,
  Stepper,
  TextField,
  Typography,
} from '@mui/material';
import Iconify from 'src/components/iconify';
import Label from 'src/components/label';
import {
  coreApi,
  Customer,
  demoOrganizationId,
  VirtualAccountRequest,
} from 'src/features/finance/core-api';
import { paths } from 'src/routes/paths';

type Decision = 'approve' | 'reject';

const rejectionReasons = [
  ['bank_unavailable', '所选银行暂时无法受理'],
  ['currency_unavailable', '所选银行暂不支持该币种'],
  ['purpose_not_supported', '账户用途不符合银行受理范围'],
  ['information_incomplete', '申请资料不足，需重新申请'],
] as const;

function formatDate(value?: string) {
  if (!value) return '—';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return '—';
  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(parsed);
}

function Field({ label, value }: { label: string; value?: string | null }) {
  return (
    <Box sx={{ py: 1.35, borderBottom: '1px solid', borderColor: 'divider' }}>
      <Typography variant="caption" color="text.secondary">
        {label}
      </Typography>
      <Typography variant="body2" fontWeight={650} sx={{ mt: 0.35, wordBreak: 'break-word' }}>
        {value || '—'}
      </Typography>
    </Box>
  );
}

function statusPresentation(status: VirtualAccountRequest['status']) {
  if (status === 'APPROVED') return { label: '已开通', color: 'success' as const };
  if (status === 'REJECTED') return { label: '已拒绝', color: 'error' as const };
  return { label: '待处理', color: 'warning' as const };
}

export default function VaRequestReviewPage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const userId = 'usr_admin';
  const [request, setRequest] = useState<VirtualAccountRequest | null>(null);
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [decision, setDecision] = useState<Decision>('approve');
  const [accountName, setAccountName] = useState('');
  const [accountNumber, setAccountNumber] = useState('');
  const [iban, setIban] = useState('');
  const [rejectionReason, setRejectionReason] = useState('');
  const [rejectionNote, setRejectionNote] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const load = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    setError('');
    try {
      const rows = await coreApi<VirtualAccountRequest[]>(
        `/virtual-account-requests?organizationId=${demoOrganizationId}`,
        { userId }
      );
      const current = rows.find((row) => row.id === id);
      if (!current) throw new Error('virtual_account_request_not_found');
      setRequest(current);
      if (current.assignedAccount) {
        setAccountName(current.assignedAccount.name || '');
        setAccountNumber(current.assignedAccount.accountNumber || '');
        setIban(current.assignedAccount.iban || '');
      } else {
        setAccountName(current.customer?.legalName || current.customer?.displayName || '');
      }
      try {
        const customerRow = await coreApi<Customer>(`/customers/${current.customerId}`, { userId });
        setCustomer(customerRow);
      } catch {
        setCustomer(current.customer || null);
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'VA 申请加载失败');
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    load().catch(() => undefined);
  }, [load]);

  const channelReady = Boolean(
    request?.channel?.active &&
      request.channel.settlementBankName &&
      request.channel.swiftBic &&
      request.channel.bankCountry &&
      request.channel.bankAddress
  );
  const completed = request?.status !== 'SUBMITTED';
  const canApprove =
    decision === 'approve' &&
    channelReady &&
    accountName.trim().length >= 2 &&
    accountNumber.trim().length >= 4 &&
    (!iban.trim() || iban.trim().length >= 4) &&
    confirmed;
  const canReject =
    decision === 'reject' &&
    Boolean(rejectionReason) &&
    rejectionNote.trim().length >= 10 &&
    confirmed;
  const canSubmit = !completed && !submitting && (canApprove || canReject);

  const rejectionText = useMemo(() => {
    const reason = rejectionReasons.find(([value]) => value === rejectionReason)?.[1];
    return `拒绝原因：${reason || rejectionReason}。客户说明：${rejectionNote.trim()}`.slice(
      0,
      500
    );
  }, [rejectionNote, rejectionReason]);

  const submit = async () => {
    if (!request || !canSubmit) return;
    setSubmitting(true);
    setError('');
    setSuccess('');
    try {
      if (decision === 'approve') {
        await coreApi(`/virtual-account-requests/${request.id}/approve`, {
          method: 'PATCH',
          userId,
          body: JSON.stringify({
            accountName: accountName.trim(),
            accountNumber: accountNumber.trim(),
            ...(iban.trim() ? { iban: iban.trim().toUpperCase() } : {}),
          }),
        });
        setSuccess('VA 已开通；银行固定资料和实际账号已写入客户账户。');
      } else {
        await coreApi(`/virtual-account-requests/${request.id}/reject`, {
          method: 'PATCH',
          userId,
          body: JSON.stringify({ reason: rejectionText }),
        });
        setSuccess('VA 申请已拒绝；客户可见原因已保存。');
      }
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'VA 申请处理失败');
    } finally {
      setSubmitting(false);
    }
  };

  if (loading && !request) {
    return (
      <Box sx={{ minHeight: 560, display: 'grid', placeItems: 'center' }}>
        <Stack alignItems="center" spacing={1.5}>
          <CircularProgress size={30} />
          <Typography color="text.secondary">正在读取 VA 申请…</Typography>
        </Stack>
      </Box>
    );
  }

  if (!request) {
    return (
      <Container maxWidth="lg">
        <Alert
          severity="error"
          action={
            <Button onClick={() => navigate(paths.dashboard.fundOperations.virtualAccounts)}>
              返回申请列表
            </Button>
          }
        >
          {error || '未找到 VA 申请'}
        </Alert>
      </Container>
    );
  }

  const presentation = statusPresentation(request.status);
  const rejected = request.status === 'REJECTED';
  const workflowSteps = [
    '客户提交',
    rejected ? '申请已拒绝' : '银行处理中',
    '录入实际账号',
    'VA 已开通',
  ];
  let submitLabel = decision === 'approve' ? '确认开通 VA' : '拒绝 VA 申请';
  if (submitting) submitLabel = '正在提交…';

  return (
    <>
      <Helmet>
        <title>{request.customer?.displayName || request.id} | VA 申请详情</title>
      </Helmet>
      <Container maxWidth="xl">
        <Stack spacing={2.5}>
          <Box>
            <Button
              color="inherit"
              startIcon={<Iconify icon="solar:arrow-left-linear" />}
              onClick={() => navigate(paths.dashboard.fundOperations.virtualAccounts)}
              sx={{ ml: -1, mb: 0.8 }}
            >
              返回 VA 申请
            </Button>
            <Typography variant="overline" color="primary.main" fontWeight={800}>
              VA FULFILMENT DESK
            </Typography>
            <Stack direction="row" spacing={1.25} alignItems="center" flexWrap="wrap">
              <Typography variant="h4">VA 申请详情</Typography>
              <Label color={presentation.color}>{presentation.label}</Label>
            </Stack>
            <Typography color="text.secondary" sx={{ mt: 0.65 }}>
              {request.customer?.displayName || request.customerId} · {request.id}
            </Typography>
          </Box>

          <Paper variant="outlined" sx={{ p: { xs: 2, md: 2.5 }, boxShadow: 'none' }}>
            <Stepper
              activeStep={request.status === 'APPROVED' ? workflowSteps.length : 1}
              alternativeLabel
            >
              {workflowSteps.map((label, index) => (
                <Step key={label}>
                  <StepLabel error={rejected && index === 1}>{label}</StepLabel>
                </Step>
              ))}
            </Stepper>
          </Paper>

          {error && (
            <Alert severity="error" onClose={() => setError('')}>
              {error}
            </Alert>
          )}
          {success && (
            <Alert severity="success" onClose={() => setSuccess('')}>
              {success}
            </Alert>
          )}

          <Box
            sx={{
              display: 'grid',
              gridTemplateColumns: { xs: '1fr', lg: 'minmax(0, 1.55fr) minmax(340px, .8fr)' },
              gap: 2.25,
              alignItems: 'start',
            }}
          >
            <Stack spacing={2.25}>
              <Paper variant="outlined" sx={{ boxShadow: 'none', overflow: 'hidden' }}>
                <Box sx={{ px: 2.5, py: 2, bgcolor: 'action.hover' }}>
                  <Typography variant="overline" color="text.secondary">
                    CUSTOMER REQUEST
                  </Typography>
                  <Typography variant="h6">客户与申请资料</Typography>
                </Box>
                <Box
                  sx={{
                    display: 'grid',
                    gridTemplateColumns: { xs: '1fr', md: 'repeat(2, minmax(0, 1fr))' },
                    columnGap: 3,
                    px: 2.5,
                    pb: 1.5,
                  }}
                >
                  <Field
                    label="客户"
                    value={customer?.displayName || request.customer?.displayName}
                  />
                  <Field label="客户邮箱" value={customer?.email || request.customer?.email} />
                  <Field label="客户状态" value={customer?.status || request.customer?.status} />
                  <Field
                    label="KYC 状态"
                    value={customer?.kycStatus || request.customer?.kycStatus}
                  />
                  <Field
                    label="申请来源"
                    value={request.requestSource === 'CUSTOMER' ? '客户 Portal' : '管理员代申请'}
                  />
                  <Field
                    label="提交人"
                    value={request.requesterEmail || request.maker?.displayName || request.makerId}
                  />
                  <Field label="提交时间" value={formatDate(request.createdAt)} />
                  <Field label="账户用途" value={request.purpose} />
                </Box>
              </Paper>

              <Paper variant="outlined" sx={{ boxShadow: 'none', overflow: 'hidden' }}>
                <Box sx={{ px: 2.5, py: 2, bgcolor: 'action.hover' }}>
                  <Typography variant="overline" color="text.secondary">
                    SELECTED BANK
                  </Typography>
                  <Typography variant="h6">客户所选银行与币种</Typography>
                  <Typography variant="body2" color="text.secondary" sx={{ mt: 0.45 }}>
                    以下资料只读。审批时只能录入银行实际分配的账户名称、账号和 IBAN。
                  </Typography>
                </Box>
                <Box
                  sx={{
                    display: 'grid',
                    gridTemplateColumns: { xs: '1fr', md: 'repeat(2, minmax(0, 1fr))' },
                    columnGap: 3,
                    px: 2.5,
                    pb: 1.5,
                  }}
                >
                  <Field
                    label="银行"
                    value={request.channel?.settlementBankName || request.channel?.name}
                  />
                  <Field label="开户币种" value={request.currency} />
                  <Field label="银行国家/地区" value={request.channel?.bankCountry} />
                  <Field label="SWIFT / BIC" value={request.channel?.swiftBic} />
                  <Field label="银行地址" value={request.channel?.bankAddress} />
                </Box>
                {!channelReady && request.status === 'SUBMITTED' && (
                  <Alert severity="warning" sx={{ m: 2.5, mt: 1 }}>
                    所选银行渠道已停用或固定资料不完整，不能批准。请在“资金通道”修复后刷新。
                  </Alert>
                )}
              </Paper>
            </Stack>

            <Paper
              variant="outlined"
              sx={{ p: 2.5, boxShadow: 'none', position: { lg: 'sticky' }, top: { lg: 96 } }}
            >
              <Typography variant="overline" color="text.secondary">
                FULFILMENT DECISION
              </Typography>
              <Typography variant="h6">处理决定</Typography>

              {completed ? (
                <Stack spacing={1.5} sx={{ mt: 2 }}>
                  <Alert severity={request.status === 'APPROVED' ? 'success' : 'error'}>
                    本申请已完成处理，不能重复提交。
                  </Alert>
                  <Field label="处理状态" value={presentation.label} />
                  <Field label="处理时间" value={formatDate(request.reviewedAt)} />
                  <Field label="处理人" value={request.checker?.displayName || request.checkerId} />
                  {request.status === 'APPROVED' ? (
                    <>
                      <Field label="账户名称" value={request.assignedAccount?.name} />
                      <Field label="银行账号" value={request.assignedAccount?.accountNumber} />
                      <Field label="IBAN" value={request.assignedAccount?.iban} />
                    </>
                  ) : (
                    <Field label="拒绝原因" value={request.rejectionReason} />
                  )}
                  <Button
                    fullWidth
                    variant="outlined"
                    onClick={() => navigate(paths.dashboard.fundOperations.virtualAccounts)}
                  >
                    返回申请列表
                  </Button>
                </Stack>
              ) : (
                <Stack spacing={2} sx={{ mt: 2 }}>
                  <FormControl>
                    <FormLabel>决定</FormLabel>
                    <RadioGroup
                      value={decision}
                      onChange={(event) => {
                        setDecision(event.target.value as Decision);
                        setConfirmed(false);
                      }}
                    >
                      <FormControlLabel
                        value="approve"
                        control={<Radio />}
                        label="录入账号并开通 VA"
                      />
                      <FormControlLabel value="reject" control={<Radio />} label="拒绝申请" />
                    </RadioGroup>
                  </FormControl>

                  {decision === 'approve' ? (
                    <Stack spacing={1.5}>
                      <TextField
                        required
                        fullWidth
                        label="账户名称"
                        value={accountName}
                        inputProps={{ maxLength: 160 }}
                        onChange={(event) => setAccountName(event.target.value)}
                      />
                      <TextField
                        required
                        fullWidth
                        label="银行实际分配账号"
                        value={accountNumber}
                        inputProps={{ minLength: 4, maxLength: 80 }}
                        onChange={(event) => setAccountNumber(event.target.value)}
                      />
                      <TextField
                        fullWidth
                        label="IBAN（如适用）"
                        value={iban}
                        inputProps={{ minLength: 4, maxLength: 80 }}
                        onChange={(event) => setIban(event.target.value.toUpperCase())}
                      />
                      <Alert severity="info">开通 VA 不会增加余额、创建入账或产生账本分录。</Alert>
                    </Stack>
                  ) : (
                    <Stack spacing={1.5}>
                      <TextField
                        select
                        required
                        fullWidth
                        label="拒绝原因"
                        value={rejectionReason}
                        onChange={(event) => setRejectionReason(event.target.value)}
                      >
                        {rejectionReasons.map(([value, label]) => (
                          <MenuItem key={value} value={value}>
                            {label}
                          </MenuItem>
                        ))}
                      </TextField>
                      <TextField
                        required
                        fullWidth
                        multiline
                        minRows={4}
                        label="客户可见说明"
                        value={rejectionNote}
                        helperText={`${rejectionNote.trim().length}/400；至少 10 个字符`}
                        inputProps={{ maxLength: 400 }}
                        onChange={(event) => setRejectionNote(event.target.value)}
                      />
                    </Stack>
                  )}

                  <Divider />
                  <FormControlLabel
                    control={
                      <Checkbox
                        checked={confirmed}
                        onChange={(event) => setConfirmed(event.target.checked)}
                      />
                    }
                    label={
                      decision === 'approve'
                        ? '我确认账号来自银行实际回执，且银行、币种与客户申请一致。'
                        : '我确认拒绝原因准确且可由客户查看。'
                    }
                    sx={{ alignItems: 'flex-start' }}
                  />

                  <Button
                    fullWidth
                    size="large"
                    variant="contained"
                    color={decision === 'approve' ? 'primary' : 'error'}
                    disabled={!canSubmit}
                    onClick={() => submit().catch(() => undefined)}
                  >
                    {submitLabel}
                  </Button>
                </Stack>
              )}
            </Paper>
          </Box>
        </Stack>
      </Container>
    </>
  );
}
