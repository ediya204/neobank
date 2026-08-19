import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
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
import { IS_NEOBANK_DEPLOYMENT } from 'src/config/deployment-mode';
import {
  loadNeobankCustomerRecords,
  mapNeobankCustomer,
} from 'src/features/customers/neobank-customer';
import { paths } from 'src/routes/paths';
import { coreApi, Customer, demoOrganizationId } from 'src/features/finance/core-api';

type CustomerForm = {
  type: 'INDIVIDUAL' | 'BUSINESS';
  displayName: string;
  legalName: string;
  email: string;
  phone: string;
  phoneCountryCode: string;
  countryCode: string;
  registrationNo: string;
  dateOfBirth: string;
  nationality: string;
  contactName: string;
  contactRole: string;
  beneficialOwnerName: string;
  beneficialOwnerOwnership: string;
};

const emptyCustomer: CustomerForm = {
  type: 'BUSINESS',
  displayName: '',
  legalName: '',
  email: '',
  phone: '',
  phoneCountryCode: '+852',
  countryCode: 'SG',
  registrationNo: '',
  dateOfBirth: '',
  nationality: '',
  contactName: '',
  contactRole: '',
  beneficialOwnerName: '',
  beneficialOwnerOwnership: '',
};

export default function OnboardingWorkspace() {
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
    try {
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
      setError(value instanceof Error ? value.message : '提交失败');
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
                  ? '集中处理 Render PostgreSQL 中待审核和已拒绝的申请；KYC 通过后自动开户并进入客户管理。'
                  : '支持个人和企业开户；先完成人工 KYC，再由运营批准开户。只有运营批准后才创建钱包。'}
              </Typography>
            </Box>
            <Stack direction="row" spacing={1.5}>
              {!IS_NEOBANK_DEPLOYMENT && (
                <Button
                  variant="contained"
                  startIcon={<Iconify icon="solar:add-circle-linear" />}
                  onClick={() => setCustomerOpen(true)}
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
        open={customerOpen}
        form={customerForm}
        setForm={setCustomerForm}
        onClose={() => setCustomerOpen(false)}
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
                {loading ? '加载中…' : '暂无开户申请'}
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
  open,
  form,
  setForm,
  onClose,
  onSubmit,
}: {
  open: boolean;
  form: CustomerForm;
  setForm: (form: CustomerForm) => void;
  onClose: () => void;
  onSubmit: (event: FormEvent) => void;
}) {
  const set = (key: keyof CustomerForm, value: string) => setForm({ ...form, [key]: value });
  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="md">
      <Box component="form" onSubmit={onSubmit}>
        <DialogTitle>发起客户开户</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ mt: 1 }}>
            <FormControl fullWidth>
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
              <TextField
                required
                fullWidth
                label="显示名称"
                value={form.displayName}
                onChange={(event) => set('displayName', event.target.value)}
              />
              <TextField
                required
                fullWidth
                label={form.type === 'BUSINESS' ? '企业法定名称' : '个人法定姓名'}
                value={form.legalName}
                onChange={(event) => set('legalName', event.target.value)}
              />
            </Stack>
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
              <TextField
                required
                fullWidth
                type="email"
                label="邮箱"
                value={form.email}
                onChange={(event) => set('email', event.target.value)}
              />
              <TextField
                required
                sx={{ width: { sm: 150 } }}
                label="电话区号"
                value={form.phoneCountryCode}
                inputProps={{ pattern: '^\\+[1-9][0-9]{0,3}$', maxLength: 5 }}
                onChange={(event) => set('phoneCountryCode', event.target.value)}
              />
              <TextField
                required
                fullWidth
                label="电话"
                value={form.phone}
                onChange={(event) => set('phone', event.target.value)}
              />
            </Stack>
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
              <TextField
                required
                fullWidth
                label={form.type === 'BUSINESS' ? '注册国家/地区' : '常住国家/地区'}
                value={form.countryCode}
                inputProps={{ maxLength: 2 }}
                onChange={(event) => set('countryCode', event.target.value.toUpperCase())}
              />
              {form.type === 'BUSINESS' ? (
                <TextField
                  required
                  fullWidth
                  label="注册号"
                  value={form.registrationNo}
                  onChange={(event) => set('registrationNo', event.target.value)}
                />
              ) : (
                <TextField
                  required
                  fullWidth
                  label="国籍代码"
                  value={form.nationality}
                  inputProps={{ maxLength: 2 }}
                  onChange={(event) => set('nationality', event.target.value.toUpperCase())}
                />
              )}
            </Stack>
            {form.type === 'INDIVIDUAL' ? (
              <TextField
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
                    required
                    fullWidth
                    label="授权联系人"
                    value={form.contactName}
                    onChange={(event) => set('contactName', event.target.value)}
                  />
                  <TextField
                    required
                    fullWidth
                    label="联系人职务"
                    value={form.contactRole}
                    onChange={(event) => set('contactRole', event.target.value)}
                  />
                </Stack>
                <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
                  <TextField
                    required
                    fullWidth
                    label="最终受益人姓名"
                    value={form.beneficialOwnerName}
                    onChange={(event) => set('beneficialOwnerName', event.target.value)}
                  />
                  <TextField
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
            <Alert severity="info">
              提交后进入 KYC 待审核。KYC 通过仅进入运营审核，不会自动开通账户或钱包。
            </Alert>
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={onClose}>取消</Button>
          <Button type="submit" variant="contained">
            提交开户
          </Button>
        </DialogActions>
      </Box>
    </Dialog>
  );
}
