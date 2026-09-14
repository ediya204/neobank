import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { REGISTRATION_COUNTRIES, REGISTRATION_PHONE_CODES } from 'src/data/registration-countries';
import { Helmet } from 'react-helmet-async';
import { useNavigate } from 'react-router-dom';
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
  FormControl,
  InputAdornment,
  InputLabel,
  MenuItem,
  Select,
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
import Iconify from 'src/components/iconify';
import Label from 'src/components/label';
import UiIconBadge from 'src/components/ui-icon-badge';
import { IS_NEOBANK_DEPLOYMENT } from 'src/config/deployment-mode';
import { useAuthContext } from 'src/auth/hooks';
import { hasAdminPermission } from 'src/auth/permissions';
import {
  loadNeobankCustomerRecords,
  mapNeobankCustomer,
} from 'src/features/customers/neobank-customer';
import { paths } from 'src/routes/paths';
import { ACTION_ICONS } from 'src/theme/iconography';
import { coreApi, neobankApi, Customer, demoOrganizationId } from 'src/features/finance/core-api';

type CustomerForm = {
  password: string;
  confirmPassword: string;
  type: 'INDIVIDUAL' | 'BUSINESS';
  displayName: string;
  legalName: string;
  familyName: string;
  givenName: string;
  email: string;
  phone: string;
  phoneCountryCode: string;
  countryCode: string;
  incorporationCountry: string;
  registrationNo: string;
  dateOfBirth: string;
  nationality: string;
  contactName: string;
  contactRole: string;
  beneficialOwnerName: string;
  beneficialOwnerOwnership: string;
};

const emptyCustomer: CustomerForm = {
  password: '',
  confirmPassword: '',
  type: 'INDIVIDUAL',
  displayName: '',
  legalName: '',
  familyName: '',
  givenName: '',
  email: '',
  phone: '',
  phoneCountryCode: '+852',
  countryCode: 'SG',
  incorporationCountry: '',
  registrationNo: '',
  dateOfBirth: '',
  nationality: '',
  contactName: '',
  contactRole: '',
  beneficialOwnerName: '',
  beneficialOwnerOwnership: '',
};

export default function OnboardingWorkspace() {
  const { user } = useAuthContext();
  const [submitting, setSubmitting] = useState(false);
  const [openingKey, setOpeningKey] = useState('');
  const navigate = useNavigate();
  const userId = 'usr_admin';
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [customerOpen, setCustomerOpen] = useState(false);
  const [customerForm, setCustomerForm] = useState<CustomerForm>(emptyCustomer);
  const [query, setQuery] = useState('');
  const [kycFilter, setKycFilter] = useState<'ALL' | 'PENDING' | 'REJECTED'>('ALL');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const customerRows = IS_NEOBANK_DEPLOYMENT
        ? await loadNeobankCustomerRecords(userId).then((rows) => rows.map(mapNeobankCustomer))
        : await coreApi<Customer[]>(`/customers?organizationId=${demoOrganizationId}`, { userId });
      setCustomers(customerRows);
    } catch (value) {
      setError(value instanceof Error ? value.message : '加载失败');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load().catch(() => undefined);
  }, [load]);

  const createCustomer = async (event: FormEvent) => {
    event.preventDefault();
    if (submitting) return;
    setError('');
    if (IS_NEOBANK_DEPLOYMENT && customerForm.password !== customerForm.confirmPassword) {
      setError('两次输入的密码不一致');
      return;
    }
    if (customerForm.phone.replace(/\D/g, '').length < 6) {
      setError('电话号码至少需要 6 位数字');
      return;
    }
    if (customerForm.type === 'INDIVIDUAL') {
      const birthDate = new Date(`${customerForm.dateOfBirth}T00:00:00Z`);
      const adultCutoff = new Date();
      adultCutoff.setUTCFullYear(adultCutoff.getUTCFullYear() - 18);
      if (Number.isNaN(birthDate.getTime()) || birthDate > adultCutoff) {
        setError('个人客户须年满 18 周岁，请检查出生日期');
        return;
      }
    }
    setSubmitting(true);
    try {
      if (IS_NEOBANK_DEPLOYMENT) {
        const personal = customerForm.type === 'INDIVIDUAL';
        const result = await neobankApi<{ id: string; wallet_provisioning?: { status: string } }>(
          '/admin/customers',
          {
            method: 'POST',
            timeoutMs: 60_000,
            headers: { 'Idempotency-Key': openingKey },
            body: JSON.stringify({
              account_type: personal ? 'individual' : 'business',
              email: customerForm.email,
              password: customerForm.password,
              phone_country_code: customerForm.phoneCountryCode,
              phone: customerForm.phone,
              residence_country: customerForm.countryCode,
              ...(personal
                ? {
                    family_name: customerForm.familyName.trim(),
                    given_name: customerForm.givenName.trim(),
                    date_of_birth: customerForm.dateOfBirth,
                    nationality: customerForm.nationality,
                  }
                : {
                    legal_name: customerForm.legalName,
                    registration_number: customerForm.registrationNo,
                    incorporation_country: customerForm.incorporationCountry,
                    contact_name: customerForm.contactName,
                    contact_role: customerForm.contactRole,
                    beneficial_owner_name: customerForm.beneficialOwnerName,
                    beneficial_owner_ownership: customerForm.beneficialOwnerOwnership,
                  }),
            }),
          }
        );
        setCustomerOpen(false);
        setCustomerForm(emptyCustomer);
        setSuccess(
          result.wallet_provisioning
            ? '客户已开户，可使用设置的密码登录；数字钱包尚未就绪，请在客户管理中查看状态。'
            : '客户已开户，可使用设置的密码直接登录。请前往客户管理查看账户。'
        );
        await load();
        return;
      }
      const common = {
        organizationId: demoOrganizationId,
        type: customerForm.type,
        displayName: customerForm.displayName,
        legalName: customerForm.legalName,
        email: customerForm.email,
        phone: customerForm.phone,
        phoneCountryCode: customerForm.phoneCountryCode,
        countryCode: customerForm.countryCode,
      };
      const typeSpecific =
        customerForm.type === 'INDIVIDUAL'
          ? {
              dateOfBirth: customerForm.dateOfBirth,
              nationality: customerForm.nationality,
            }
          : {
              registrationNo: customerForm.registrationNo,
              contactName: customerForm.contactName,
              contactRole: customerForm.contactRole,
              beneficialOwnerName: customerForm.beneficialOwnerName,
              beneficialOwnerOwnership: Number(customerForm.beneficialOwnerOwnership),
            };
      await coreApi('/customers', {
        method: 'POST',
        userId,
        body: JSON.stringify({ ...common, ...typeSpecific }),
      });
      setCustomerOpen(false);
      setCustomerForm(emptyCustomer);
      setSuccess('开户申请已提交，需先完成 KYC 人工审核，再由运营批准开户');
      await load();
    } catch (value) {
      const message = value instanceof Error ? value.message : '提交失败';
      const messages: Record<string, string> = {
        customer_already_exists: '该邮箱已存在客户账号，请到客户管理中查看。',
        validation_error: '资料格式不正确，请检查姓名、日期、联系方式和密码要求。',
        idempotency_key_conflict: '该次开户已提交且资料发生变化，请到客户管理确认结果。',
      };
      setError(messages[message] || message);
    } finally {
      setSubmitting(false);
    }
  };

  const applicationRows = useMemo(() => {
    const keyword = query.trim().toLowerCase();
    return customers.filter((customer) => {
      if (customer.kycStatus === 'APPROVED') return false;
      if (kycFilter !== 'ALL' && customer.kycStatus !== kycFilter) return false;
      return (
        !keyword ||
        [
          customer.displayName,
          customer.legalName,
          customer.email,
          customer.phone,
          customer.id,
        ].some((value) =>
          String(value || '')
            .toLowerCase()
            .includes(keyword)
        )
      );
    });
  }, [customers, kycFilter, query]);

  return (
    <>
      <Helmet>
        <title>开户与 KYC | SSC Digital Bank</title>
      </Helmet>
      <Container maxWidth="xl">
        <Stack spacing={3}>
          <Stack direction={{ xs: 'column', md: 'row' }} justifyContent="space-between" gap={2}>
            <Box>
              <Typography variant="h4">开户与 KYC</Typography>
              <Typography color="text.secondary" sx={{ mt: 0.75 }}>
                {IS_NEOBANK_DEPLOYMENT
                  ? '支持后台录入资料直接开户；客户自行提交的申请需完成 KYC 人工审核。'
                  : '支持个人和企业开户；先完成人工 KYC，再由运营批准开户。只有运营批准后才创建钱包。'}
              </Typography>
            </Box>
            <Stack direction="row" spacing={1.5} alignItems="center" sx={{ flexShrink: 0 }}>
              {(!IS_NEOBANK_DEPLOYMENT ||
                hasAdminPermission(user, 'customer_credentials.manage')) && (
                <Button
                  variant="contained"
                  size="small"
                  sx={{ height: 36, px: 1.5, whiteSpace: 'nowrap' }}
                  startIcon={<Iconify icon="solar:add-circle-linear" />}
                  onClick={() => {
                    setOpeningKey(crypto.randomUUID());
                    setError('');
                    setCustomerOpen(true);
                  }}
                >
                  发起开户
                </Button>
              )}
            </Stack>
          </Stack>
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
          <Card>
            <Stack direction={{ xs: 'column', md: 'row' }} spacing={1.5} sx={{ p: 2 }}>
              <TextField
                fullWidth
                size="small"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="搜索申请人、邮箱、电话或申请编号"
                InputProps={{
                  startAdornment: (
                    <InputAdornment position="start">
                      <Iconify icon="solar:magnifier-linear" />
                    </InputAdornment>
                  ),
                }}
              />
              <TextField
                select
                size="small"
                label="审核状态"
                value={kycFilter}
                onChange={(event) =>
                  setKycFilter(event.target.value as 'ALL' | 'PENDING' | 'REJECTED')
                }
                sx={{ minWidth: 180 }}
              >
                <MenuItem value="ALL">全部申请</MenuItem>
                <MenuItem value="PENDING">待审核</MenuItem>
                <MenuItem value="REJECTED">已拒绝</MenuItem>
              </TextField>
            </Stack>
            <CustomerTable
              rows={applicationRows}
              loading={loading}
              onOpen={(customer) => navigate(paths.dashboard.onboardingReview(customer.id))}
            />
          </Card>
        </Stack>
      </Container>

      <CustomerDialog
        submitting={submitting}
        error={error}
        open={customerOpen}
        form={customerForm}
        setForm={setCustomerForm}
        onClose={() => {
          if (!submitting) {
            setCustomerOpen(false);
            setCustomerForm(emptyCustomer);
          }
        }}
        onSubmit={createCustomer}
      />
    </>
  );
}

function CustomerTable({
  rows,
  loading,
  onOpen,
}: {
  rows: Customer[];
  loading: boolean;
  onOpen: (customer: Customer) => void;
}) {
  return (
    <TableContainer>
      <Table>
        <TableHead>
          <TableRow>
            <TableCell>申请人</TableCell>
            <TableCell>主体类型</TableCell>
            <TableCell>国家/地区</TableCell>
            <TableCell>联系方式</TableCell>
            <TableCell>提交时间</TableCell>
            <TableCell>KYC 状态</TableCell>
            <TableCell align="right">操作</TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {rows.map((customer) => (
            <TableRow
              key={customer.id}
              hover
              sx={{ cursor: 'pointer' }}
              onClick={() => onOpen(customer)}
            >
              <TableCell>
                <Typography variant="subtitle2">{customer.displayName}</Typography>
                <Typography variant="caption" color="text.secondary">
                  {customer.legalName}
                </Typography>
              </TableCell>
              <TableCell>{customer.type === 'BUSINESS' ? '企业' : '个人'}</TableCell>
              <TableCell>{customer.countryCode}</TableCell>
              <TableCell>
                <Typography variant="body2">{customer.email}</Typography>
                <Typography variant="caption" color="text.secondary">
                  {[customer.phoneCountryCode, customer.phone].filter(Boolean).join(' ') ||
                    '未填写电话'}
                </Typography>
              </TableCell>
              <TableCell>{formatDate(customer.createdAt)}</TableCell>
              <TableCell>
                <Label color={customer.kycStatus === 'REJECTED' ? 'error' : 'warning'}>
                  {customer.kycStatus === 'REJECTED' ? '已拒绝' : '待人工审核'}
                </Label>
              </TableCell>
              <TableCell align="right">
                <Button
                  size="small"
                  variant={customer.kycStatus === 'PENDING' ? 'contained' : 'text'}
                  endIcon={<Iconify icon="solar:arrow-right-linear" />}
                  onClick={(event) => {
                    event.stopPropagation();
                    onOpen(customer);
                  }}
                >
                  {customer.kycStatus === 'PENDING' ? '开始审核' : '查看结果'}
                </Button>
              </TableCell>
            </TableRow>
          ))}
          {!rows.length && (
            <TableRow>
              <TableCell colSpan={7} align="center" sx={{ py: 8 }}>
                {loading ? (
                  '加载中…'
                ) : (
                  <Stack alignItems="center" spacing={1.25}>
                    <UiIconBadge
                      icon={ACTION_ICONS.onboarding}
                      tone="info"
                      size={48}
                      iconSize={28}
                    />
                    <Typography color="text.secondary">暂无开户申请</Typography>
                  </Stack>
                )}
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
    </TableContainer>
  );
}

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

function CustomerDialog({
  submitting,
  error,
  open,
  form,
  setForm,
  onClose,
  onSubmit,
}: {
  submitting: boolean;
  error: string;
  open: boolean;
  form: CustomerForm;
  setForm: (form: CustomerForm) => void;
  onClose: () => void;
  onSubmit: (event: FormEvent) => void;
}) {
  const { t } = useTranslation('common');
  const set = (key: keyof CustomerForm, value: string) => setForm({ ...form, [key]: value });
  return (
    <Dialog
      open={open}
      onClose={onClose}
      fullWidth
      maxWidth="sm"
      PaperProps={{ sx: { maxWidth: 760 } }}
    >
      <Box
        component="form"
        onSubmit={onSubmit}
        sx={{ display: 'flex', flexDirection: 'column', minHeight: 0 }}
      >
        <DialogTitle>发起客户开户</DialogTitle>
        <DialogContent sx={{ pb: 2 }}>
          <Stack spacing={2} sx={{ mt: 1 }}>
            {error && <Alert severity="error">{error}</Alert>}
            <Typography variant="subtitle2">客户资料</Typography>
            <FormControl fullWidth size="small">
              <InputLabel>客户类型</InputLabel>
              <Select
                label="客户类型"
                value={form.type}
                onChange={(event) => set('type', event.target.value)}
              >
                <MenuItem value="INDIVIDUAL">个人</MenuItem>
                <MenuItem value="BUSINESS">企业</MenuItem>
              </Select>
            </FormControl>
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
              {!IS_NEOBANK_DEPLOYMENT && (
                <TextField
                  size="small"
                  required
                  fullWidth
                  label="显示名称"
                  value={form.displayName}
                  onChange={(event) => set('displayName', event.target.value)}
                />
              )}
              {IS_NEOBANK_DEPLOYMENT && form.type === 'INDIVIDUAL' ? (
                <>
                  <TextField
                    size="small"
                    required
                    fullWidth
                    label="姓（英文）"
                    value={form.familyName}
                    autoComplete="off"
                    inputProps={{
                      maxLength: 50,
                      pattern: "[A-Za-z]+(?:[ '\\-][A-Za-z]+)*",
                      title: '请填写英文姓名，与身份证件一致',
                    }}
                    onChange={(event) => set('familyName', event.target.value)}
                  />
                  <TextField
                    size="small"
                    required
                    fullWidth
                    label="名（英文）"
                    value={form.givenName}
                    autoComplete="off"
                    inputProps={{
                      maxLength: 50,
                      pattern: "[A-Za-z]+(?:[ '\\-][A-Za-z]+)*",
                      title: '请填写英文姓名，与身份证件一致',
                    }}
                    onChange={(event) => set('givenName', event.target.value)}
                  />
                </>
              ) : (
                <TextField
                  size="small"
                  required
                  fullWidth
                  label={form.type === 'BUSINESS' ? '企业法定名称' : '个人法定姓名'}
                  value={form.legalName}
                  onChange={(event) => set('legalName', event.target.value)}
                />
              )}
            </Stack>
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
              <TextField
                size="small"
                required
                fullWidth
                label={form.type === 'BUSINESS' ? '注册国家/地区' : '常住国家/地区'}
                value={form.type === 'BUSINESS' ? form.incorporationCountry : form.countryCode}
                select
                onChange={(event) =>
                  set(
                    form.type === 'BUSINESS' ? 'incorporationCountry' : 'countryCode',
                    event.target.value
                  )
                }
              >
                {REGISTRATION_COUNTRIES.map((country) => (
                  <MenuItem key={country.value} value={country.value}>
                    {t(country.labelKey)}
                  </MenuItem>
                ))}
              </TextField>
              {form.type === 'BUSINESS' ? (
                <TextField
                  size="small"
                  required
                  fullWidth
                  label="注册号"
                  value={form.registrationNo}
                  onChange={(event) => set('registrationNo', event.target.value)}
                />
              ) : (
                <TextField
                  size="small"
                  required
                  fullWidth
                  label="国籍"
                  value={form.nationality}
                  select
                  onChange={(event) => set('nationality', event.target.value)}
                >
                  {REGISTRATION_COUNTRIES.map((country) => (
                    <MenuItem key={country.value} value={country.value}>
                      {t(country.labelKey)}
                    </MenuItem>
                  ))}
                </TextField>
              )}
            </Stack>
            {form.type === 'INDIVIDUAL' ? (
              <TextField
                size="small"
                required
                fullWidth
                type="date"
                label="出生日期"
                value={form.dateOfBirth}
                InputLabelProps={{ shrink: true }}
                inputProps={{ max: new Date().toISOString().slice(0, 10) }}
                onChange={(event) => set('dateOfBirth', event.target.value)}
              />
            ) : (
              <>
                <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
                  <TextField
                    size="small"
                    required
                    fullWidth
                    label="授权联系人"
                    value={form.contactName}
                    onChange={(event) => set('contactName', event.target.value)}
                  />
                  <TextField
                    size="small"
                    required
                    fullWidth
                    label="联系人职务"
                    value={form.contactRole}
                    onChange={(event) => set('contactRole', event.target.value)}
                  />
                </Stack>
                <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
                  <TextField
                    size="small"
                    required
                    fullWidth
                    label="最终受益人姓名"
                    value={form.beneficialOwnerName}
                    onChange={(event) => set('beneficialOwnerName', event.target.value)}
                  />
                  <TextField
                    size="small"
                    required
                    fullWidth
                    type="number"
                    label="持股或控制比例（%）"
                    value={form.beneficialOwnerOwnership}
                    inputProps={{ min: 0.01, max: 100, step: 0.01 }}
                    onChange={(event) => set('beneficialOwnerOwnership', event.target.value)}
                  />
                </Stack>
              </>
            )}
            {form.type === 'BUSINESS' && (
              <TextField
                size="small"
                required
                fullWidth
                select
                label="营业国家/地区"
                value={form.countryCode}
                onChange={(event) => set('countryCode', event.target.value)}
              >
                {REGISTRATION_COUNTRIES.map((country) => (
                  <MenuItem key={country.value} value={country.value}>
                    {t(country.labelKey)}
                  </MenuItem>
                ))}
              </TextField>
            )}
            <Typography variant="subtitle2" sx={{ pt: 1 }}>
              联系方式
            </Typography>
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
              <TextField
                size="small"
                required
                fullWidth
                sx={{ flex: { sm: 1 }, minWidth: 0, width: { xs: '100%', sm: 'auto' } }}
                type="email"
                label="客户登录邮箱"
                value={form.email}
                onChange={(event) => set('email', event.target.value)}
              />
              <Stack
                direction="row"
                spacing={1.5}
                sx={{ flex: { sm: 1 }, minWidth: 0, width: { xs: '100%', sm: 'auto' } }}
              >
                <TextField
                  size="small"
                  required
                  sx={{ width: 112, flexShrink: 0 }}
                  label="电话区号"
                  value={form.phoneCountryCode}
                  select
                  onChange={(event) => set('phoneCountryCode', event.target.value)}
                >
                  {REGISTRATION_PHONE_CODES.map((code) => (
                    <MenuItem key={code} value={code}>
                      {code}
                    </MenuItem>
                  ))}
                </TextField>
                <TextField
                  size="small"
                  required
                  fullWidth
                  type="tel"
                  label="电话号码"
                  value={form.phone}
                  onChange={(event) => set('phone', event.target.value)}
                />
              </Stack>
            </Stack>
            {IS_NEOBANK_DEPLOYMENT && (
              <>
                <Typography variant="subtitle2" sx={{ pt: 1 }}>
                  登录安全
                </Typography>
                <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} alignItems="flex-start">
                  <TextField
                    size="small"
                    fullWidth
                    required
                    type="password"
                    label="登录密码"
                    autoComplete="new-password"
                    value={form.password}
                    onChange={(event) => set('password', event.target.value)}
                    inputProps={{
                      minLength: 14,
                      maxLength: 128,
                      pattern: '(?=.*[a-z])(?=.*[A-Z])(?=.*[0-9])(?=.*[^A-Za-z0-9]).{14,128}',
                    }}
                    helperText="14–128 个字符，包含大小写字母、数字和符号"
                  />
                  <TextField
                    size="small"
                    fullWidth
                    required
                    type="password"
                    label="确认密码"
                    autoComplete="new-password"
                    value={form.confirmPassword}
                    onChange={(event) => set('confirmPassword', event.target.value)}
                  />
                </Stack>
              </>
            )}
            <Alert severity="info" sx={{ typography: 'body2' }}>
              {IS_NEOBANK_DEPLOYMENT
                ? '后台开户免 KYC，创建后客户可使用邮箱和设置的密码直接登录。此操作将记录操作人。'
                : '提交后进入 KYC 待审核。KYC 通过仅进入运营审核，不会自动开通账户或钱包。'}
            </Alert>
          </Stack>
        </DialogContent>
        <DialogActions sx={{ px: 3, py: 2, borderTop: 1, borderColor: 'divider' }}>
          <Button size="small" onClick={onClose} disabled={submitting}>
            取消
          </Button>
          <Button
            size="small"
            sx={{ minWidth: 96, height: 36 }}
            type="submit"
            variant="contained"
            disabled={submitting}
          >
            {submitting ? '创建中…' : '提交开户'}
          </Button>
        </DialogActions>
      </Box>
    </Dialog>
  );
}
