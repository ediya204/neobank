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
import { IS_NEOBANK_DEPLOYMENT } from 'src/config/deployment-mode';
import {
  loadNeobankCustomerRecords,
  mapNeobankCustomer,
  NeobankCustomerRecord,
  NeobankKycReviewResult,
} from 'src/features/customers/neobank-customer';
import { coreApi, Customer, neobankApi } from 'src/features/finance/core-api';
import { paths } from 'src/routes/paths';

type ReviewDecision = 'approve' | 'reject';
type ReviewCheck = 'identity' | 'profile' | 'screening' | 'consent';

const reviewChecks: Array<{ key: ReviewCheck; label: string; detail: string }> = [
  {
    key: 'identity',
    label: '身份与证件资料一致',
    detail: '姓名、出生日期或企业登记资料与提交文件一致，文件清晰且仍在有效期内。',
  },
  {
    key: 'profile',
    label: '客户资料完整且可核验',
    detail: '联系方式、国家/地区、个人或企业基本资料不存在明显冲突或缺失。',
  },
  {
    key: 'screening',
    label: '制裁、PEP 与负面信息筛查已完成',
    detail: '筛查结果已人工复核；如有命中，必须拒绝或升级处理，不能直接通过。',
  },
  {
    key: 'consent',
    label: '授权与条款记录有效',
    detail: '客户已同意 KYC 处理及服务条款，提交来源和申请时间可以追溯。',
  },
];

const rejectionReasons = [
  ['identity_mismatch', '身份或登记资料不一致'],
  ['document_invalid', '证件缺失、过期或无法核验'],
  ['screening_hit', '制裁、PEP 或负面信息命中'],
  ['information_incomplete', '申请资料不完整'],
] as const;

function kycReviewPresentation(status: Customer['kycStatus']) {
  if (status === 'APPROVED') return { label: '已通过', color: 'success' as const };
  if (status === 'REJECTED') return { label: '已拒绝', color: 'error' as const };
  return { label: '待审核', color: 'warning' as const };
}

function formatDate(value?: string | null) {
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

function customerFields(customer: Customer): Array<[string, string | undefined]> {
  if (customer.type === 'BUSINESS') {
    return [
      ['企业法定名称', customer.legalName],
      ['注册编号', customer.registrationNo],
      ['注册国家/地区', customer.countryCode],
      ['联系人', customer.contactName],
      ['联系人职位', customer.contactRole],
      ['受益所有人', customer.beneficialOwnerName],
      [
        '受益所有权',
        customer.beneficialOwnerOwnership ? `${customer.beneficialOwnerOwnership}%` : undefined,
      ],
    ];
  }
  return [
    ['法定姓名', customer.legalName],
    ['出生日期', customer.dateOfBirth],
    ['国籍', customer.nationality],
    ['居住国家/地区', customer.countryCode],
  ];
}

export default function KycReviewWorkspace() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const userId = 'usr_admin';
  const [record, setRecord] = useState<NeobankCustomerRecord | null>(null);
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [checks, setChecks] = useState<Record<ReviewCheck, boolean>>({
    identity: false,
    profile: false,
    screening: false,
    consent: false,
  });
  const [decision, setDecision] = useState<ReviewDecision>('approve');
  const [rejectionReason, setRejectionReason] = useState('');
  const [note, setNote] = useState('');
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
      if (IS_NEOBANK_DEPLOYMENT) {
        const rows = await loadNeobankCustomerRecords(userId);
        const source = rows.find((row) => row.id === id);
        if (!source) throw new Error('kyc_application_not_found');
        setRecord(source);
        setCustomer(mapNeobankCustomer(source));
      } else {
        const row = await coreApi<Customer>(`/customers/${id}`, { userId });
        setCustomer(row);
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'KYC 申请加载失败');
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    load().catch(() => undefined);
  }, [load]);

  const allChecksComplete = reviewChecks.every((item) => checks[item.key]);
  const canSubmit =
    customer?.kycStatus === 'PENDING' &&
    confirmed &&
    note.trim().length >= 10 &&
    (decision === 'approve' ? allChecksComplete : Boolean(rejectionReason));

  const reviewSummary = useMemo(() => {
    const completed = reviewChecks.filter((item) => checks[item.key]).map((item) => item.label);
    if (decision === 'approve') {
      return `核验项目：${completed.join('、')}。审核意见：${note.trim()}`;
    }
    const reason = rejectionReasons.find(([value]) => value === rejectionReason)?.[1];
    return `拒绝原因：${reason || rejectionReason}。审核意见：${note.trim()}`;
  }, [checks, decision, note, rejectionReason]);

  const submit = async () => {
    if (!customer || !canSubmit) return;
    setSubmitting(true);
    setError('');
    setSuccess('');
    try {
      if (IS_NEOBANK_DEPLOYMENT) {
        const result = await neobankApi<NeobankKycReviewResult>(
          `/admin/customers/${customer.id}/kyc`,
          {
            method: 'PATCH',
            userId,
            body: JSON.stringify({ decision, note: reviewSummary.slice(0, 1000) }),
          }
        );
        if (decision === 'approve') {
          setSuccess(
            result.wallet
              ? 'KYC 审核已通过；客户已自动开户，标准法币账户将在 Core 同步时自动分配。'
              : 'KYC 审核已通过并自动开户；数字钱包创建失败，系统已标记为待重试。'
          );
        } else {
          setSuccess('KYC 申请已拒绝，原因和审核意见已写入审计记录。');
        }
      } else {
        await coreApi(`/customers/${customer.id}/kyc`, {
          method: 'PATCH',
          userId,
          body: JSON.stringify({
            decision: decision === 'approve' ? 'APPROVE' : 'REJECT',
            note: reviewSummary.slice(0, 1000),
          }),
        });
        setSuccess(decision === 'approve' ? 'KYC 审核已通过。' : 'KYC 申请已拒绝。');
      }
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'KYC 审核提交失败');
    } finally {
      setSubmitting(false);
    }
  };

  if (loading && !customer) {
    return (
      <Box sx={{ minHeight: 560, display: 'grid', placeItems: 'center' }}>
        <Stack alignItems="center" spacing={1.5}>
          <CircularProgress size={30} />
          <Typography color="text.secondary">正在读取 KYC 申请…</Typography>
        </Stack>
      </Box>
    );
  }

  if (!customer) {
    return (
      <Container maxWidth="lg">
        <Alert
          severity="error"
          action={<Button onClick={() => navigate(paths.dashboard.onboarding)}>返回申请列表</Button>}
        >
          {error || '未找到 KYC 申请'}
        </Alert>
      </Container>
    );
  }

  const completed = customer.kycStatus !== 'PENDING';
  const reviewPresentation = kycReviewPresentation(customer.kycStatus);
  let submitButtonLabel = decision === 'approve' ? '通过 KYC 并自动开户' : '拒绝 KYC 申请';
  if (submitting) submitButtonLabel = '正在提交…';

  return (
    <>
      <Helmet>
        <title>{customer.displayName} | KYC 审核 | SSC Digital Bank</title>
      </Helmet>
      <Container maxWidth="xl">
        <Stack spacing={2.5}>
          <Stack direction={{ xs: 'column', md: 'row' }} justifyContent="space-between" gap={2}>
            <Box>
              <Button
                color="inherit"
                startIcon={<Iconify icon="solar:arrow-left-linear" />}
                onClick={() => navigate(paths.dashboard.onboarding)}
                sx={{ ml: -1, mb: 0.8 }}
              >
                返回开户申请
              </Button>
              <Typography variant="overline" color="primary.main" fontWeight={800}>
                KYC REVIEW DESK
              </Typography>
              <Stack direction="row" spacing={1.25} alignItems="center" flexWrap="wrap">
                <Typography variant="h4">KYC 人工审核</Typography>
                <Label color={reviewPresentation.color}>{reviewPresentation.label}</Label>
              </Stack>
              <Typography color="text.secondary" sx={{ mt: 0.65 }}>
                {customer.displayName} · {customer.type === 'BUSINESS' ? '企业客户' : '个人客户'} · {customer.id}
              </Typography>
            </Box>
          </Stack>

          <Paper variant="outlined" sx={{ p: { xs: 2, md: 2.5 }, boxShadow: 'none' }}>
            <Stepper activeStep={completed ? 4 : 2} alternativeLabel>
              {['申请提交', '资料核对', '合规筛查', '审核决定', '自动开户'].map((label) => (
                <Step key={label}>
                  <StepLabel>{label}</StepLabel>
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
            <Alert
              severity="success"
              action={
                decision === 'approve' ? (
                  <Button
                    color="inherit"
                    onClick={() => navigate(paths.dashboard.customers.root)}
                  >
                    进入客户管理
                  </Button>
                ) : undefined
              }
            >
              {success}
            </Alert>
          )}

          <Box
            sx={{
              display: 'grid',
              gridTemplateColumns: { xs: '1fr', lg: 'minmax(0, 1.55fr) minmax(330px, 0.75fr)' },
              gap: 2.25,
              alignItems: 'start',
            }}
          >
            <Stack spacing={2.25}>
              <Paper variant="outlined" sx={{ boxShadow: 'none', overflow: 'hidden' }}>
                <Box sx={{ px: 2.5, py: 2, bgcolor: 'action.hover' }}>
                  <Typography variant="overline" color="text.secondary">
                    APPLICANT PROFILE
                  </Typography>
                  <Typography variant="h6">申请人与主体资料</Typography>
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
                  <Field label="显示名称" value={customer.displayName} />
                  <Field label="邮箱" value={customer.email} />
                  <Field
                    label="电话"
                    value={[customer.phoneCountryCode, customer.phone].filter(Boolean).join(' ')}
                  />
                  <Field label="申请编号" value={record?.application_reference || customer.id} />
                  {customerFields(customer).map(([label, value]) => (
                    <Field key={label} label={label} value={value} />
                  ))}
                  <Field
                    label="申请提交时间"
                    value={formatDate(record?.application_submitted_at || customer.createdAt)}
                  />
                  <Field label="KYC 授权时间" value={formatDate(record?.kyc_consent_at)} />
                  <Field label="条款接受时间" value={formatDate(record?.terms_accepted_at)} />
                </Box>
              </Paper>

              <Paper variant="outlined" sx={{ p: 2.5, boxShadow: 'none' }}>
                <Typography variant="overline" color="text.secondary">
                  CONTROL CHECKLIST
                </Typography>
                <Typography variant="h6">人工核验清单</Typography>
                <Typography variant="body2" color="text.secondary" sx={{ mt: 0.55, mb: 2 }}>
                  每项都必须由审核人实际完成核验。勾选仅记录审核结果，不代替外部证据。
                </Typography>
                <Stack divider={<Divider flexItem />}>
                  {reviewChecks.map((item) => (
                    <FormControlLabel
                      key={item.key}
                      disabled={completed || submitting}
                      control={
                        <Checkbox
                          checked={checks[item.key]}
                          onChange={(event) =>
                            setChecks((current) => ({ ...current, [item.key]: event.target.checked }))
                          }
                        />
                      }
                      label={
                        <Box sx={{ py: 1.2 }}>
                          <Typography variant="subtitle2">{item.label}</Typography>
                          <Typography variant="body2" color="text.secondary" sx={{ mt: 0.35 }}>
                            {item.detail}
                          </Typography>
                        </Box>
                      }
                      sx={{ m: 0, alignItems: 'flex-start' }}
                    />
                  ))}
                </Stack>
              </Paper>
            </Stack>

            <Paper
              variant="outlined"
              sx={{ p: 2.5, boxShadow: 'none', position: { lg: 'sticky' }, top: { lg: 96 } }}
            >
              <Typography variant="overline" color="text.secondary">
                REVIEW DECISION
              </Typography>
              <Typography variant="h6">审核决定</Typography>

              {completed ? (
                <Stack spacing={1.6} sx={{ mt: 2 }}>
                  <Alert severity={customer.kycStatus === 'APPROVED' ? 'success' : 'error'}>
                    本申请已完成审核，不能重复提交决定。
                  </Alert>
                  <Field label="审核状态" value={customer.kycStatus === 'APPROVED' ? '通过' : '拒绝'} />
                  <Field label="审核时间" value={formatDate(customer.kycReviewedAt)} />
                  <Field label="审核人" value={customer.kycReviewerId} />
                  <Field label="审核记录" value={customer.kycReviewNote} />
                  <Button fullWidth variant="outlined" onClick={() => navigate(paths.dashboard.onboarding)}>
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
                        setDecision(event.target.value as ReviewDecision);
                        setConfirmed(false);
                      }}
                    >
                      <FormControlLabel value="approve" control={<Radio />} label="通过 KYC 并自动开户" />
                      <FormControlLabel value="reject" control={<Radio />} label="拒绝申请" />
                    </RadioGroup>
                  </FormControl>

                  {decision === 'reject' && (
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
                  )}

                  <TextField
                    required
                    fullWidth
                    multiline
                    minRows={4}
                    label={decision === 'approve' ? '审核意见' : '客户可见的拒绝说明'}
                    value={note}
                    onChange={(event) => setNote(event.target.value)}
                    helperText={`${note.trim().length}/1000；至少 10 个字符`}
                    inputProps={{ maxLength: 1000 }}
                  />

                  {decision === 'approve' && !allChecksComplete && (
                    <Alert severity="warning">通过前必须完成左侧全部人工核验项目。</Alert>
                  )}

                  <FormControlLabel
                    control={
                      <Checkbox
                        checked={confirmed}
                        onChange={(event) => setConfirmed(event.target.checked)}
                      />
                    }
                    label={
                      decision === 'approve'
                        ? '我确认审核结论真实有效，并理解通过后系统将自动开户。'
                        : '我确认拒绝原因准确、可审计，并已避免写入内部敏感信息。'
                    }
                    sx={{ alignItems: 'flex-start' }}
                  />

                  <Button
                    fullWidth
                    size="large"
                    variant="contained"
                    color={decision === 'approve' ? 'primary' : 'error'}
                    disabled={!canSubmit || submitting}
                    onClick={() => submit().catch(() => undefined)}
                  >
                    {submitButtonLabel}
                  </Button>
                  <Typography variant="caption" color="text.secondary" textAlign="center">
                    审核决定、审核人、时间和意见将写入 PostgreSQL 审计记录。
                  </Typography>
                </Stack>
              )}
            </Paper>
          </Box>
        </Stack>
      </Container>
    </>
  );
}
