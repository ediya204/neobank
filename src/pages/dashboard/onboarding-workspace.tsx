import { FormEvent, useCallback, useEffect, useState } from 'react';
import { Helmet } from 'react-helmet-async';
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  Container,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Drawer,
  FormControl,
  InputLabel,
  MenuItem,
  Select,
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
import Iconify from 'src/components/iconify';
import Label from 'src/components/label';
import { IS_NEOBANK_DEPLOYMENT } from 'src/config/deployment-mode';
import {
  coreApi,
  Currency,
  Customer,
  demoOrganizationId,
  demoUsers,
  neobankApi,
  supportedFiatCurrencies,
  VirtualAccountRequest,
} from 'src/features/finance/core-api';

type NeobankCustomer = {
  id: string;
  email: string;
  display_name: string;
  status: string;
  kyc_status: string;
  operations_status: string;
  account_type?: 'individual' | 'business';
  phone_country_code?: string;
  phone?: string;
  residence_country?: string;
  full_name?: string;
  date_of_birth?: string;
  nationality?: string;
  legal_name?: string;
  registration_number?: string;
  incorporation_country?: string;
  contact_name?: string;
  contact_role?: string;
  beneficial_owner_name?: string;
  beneficial_owner_ownership?: string;
};

function mapNeobankCustomer(row: NeobankCustomer): Customer {
  let status: Customer['status'] = 'PENDING_REVIEW';
  let kycStatus: Customer['kycStatus'] = 'PENDING';
  if (row.kyc_status === 'rejected') status = 'REJECTED';
  if (row.kyc_status === 'rejected') kycStatus = 'REJECTED';
  if (row.kyc_status === 'approved') kycStatus = 'APPROVED';
  if (row.status === 'suspended' || row.status === 'closed') status = 'SUSPENDED';
  if (row.status === 'active' && row.operations_status === 'active') status = 'ACTIVE';
  return {
    id: row.id,
    organizationId: demoOrganizationId,
    type: row.account_type === 'business' ? 'BUSINESS' : 'INDIVIDUAL',
    status,
    displayName: row.display_name,
    legalName: row.legal_name || row.full_name || row.display_name,
    email: row.email,
    phone: row.phone,
    phoneCountryCode: row.phone_country_code,
    countryCode: row.incorporation_country || row.residence_country || '--',
    registrationNo: row.registration_number,
    dateOfBirth: row.date_of_birth,
    nationality: row.nationality,
    contactName: row.contact_name,
    contactRole: row.contact_role,
    beneficialOwnerName: row.beneficial_owner_name,
    beneficialOwnerOwnership: row.beneficial_owner_ownership,
    kycStatus,
    accounts: [],
  };
}

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

const fiatCurrencies: Currency[] = supportedFiatCurrencies;

export default function OnboardingWorkspace({ portal = false }: { portal?: boolean }) {
  const [tab, setTab] = useState<'customers' | 'va'>('customers');
  const [userId, setUserId] = useState('usr_admin');
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [vaRequests, setVaRequests] = useState<VirtualAccountRequest[]>([]);
  const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(null);
  const [customerOpen, setCustomerOpen] = useState(false);
  const [vaOpen, setVaOpen] = useState(false);
  const [customerForm, setCustomerForm] = useState<CustomerForm>(emptyCustomer);
  const [vaCurrency, setVaCurrency] = useState<Currency>('USD');
  const [vaCountry, setVaCountry] = useState('SG');
  const [vaPurpose, setVaPurpose] = useState('跨境贸易收款');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [customerRows, requestRows] = await Promise.all([
        IS_NEOBANK_DEPLOYMENT
          ? neobankApi<{ data: NeobankCustomer[] }>('/admin/customers', { userId }).then(
              (payload) => payload.data.map(mapNeobankCustomer)
            )
          : coreApi<Customer[]>(`/customers?organizationId=${demoOrganizationId}`, { userId }),
        coreApi<VirtualAccountRequest[]>(
          `/virtual-account-requests?organizationId=${demoOrganizationId}`,
          { userId }
        ),
      ]);
      setCustomers(customerRows);
      setVaRequests(requestRows);
    } catch (value) {
      setError(value instanceof Error ? value.message : '加载失败');
    } finally {
      setLoading(false);
    }
  }, [userId]);

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

  const reviewKyc = async (customer: Customer, decision: 'APPROVE' | 'REJECT') => {
    try {
      const note = decision === 'APPROVE' ? 'KYC 资料人工核验通过' : 'KYC 资料未通过人工核验';
      if (IS_NEOBANK_DEPLOYMENT) {
        await neobankApi(`/admin/customers/${customer.id}/kyc`, {
          method: 'PATCH',
          userId,
          body: JSON.stringify({ decision: decision.toLowerCase(), note }),
        });
      } else {
        await coreApi(`/customers/${customer.id}/kyc`, {
          method: 'PATCH',
          userId,
          body: JSON.stringify({ decision, note }),
        });
      }
      let reviewMessage = 'KYC 未通过，申请已拒绝';
      if (decision === 'APPROVE') {
        reviewMessage = IS_NEOBANK_DEPLOYMENT
          ? 'KYC 已通过，客户已自动激活并创建 USDT-TRC20 钱包'
          : 'KYC 已通过，申请进入运营开户审核';
      }
      setSuccess(reviewMessage);
      setSelectedCustomer(null);
      await load();
    } catch (value) {
      setError(value instanceof Error ? value.message : '审核失败');
    }
  };

  const approveCustomer = async (customer: Customer) => {
    try {
      if (IS_NEOBANK_DEPLOYMENT) {
        await neobankApi(`/admin/customers/${customer.id}/activate`, {
          method: 'PATCH',
          userId,
          body: JSON.stringify({}),
        });
      } else {
        await coreApi(`/customers/${customer.id}/approve`, {
          method: 'PATCH',
          userId,
          body: JSON.stringify({ note: 'KYC 已通过，运营批准开户' }),
        });
      }
      setSuccess(
        IS_NEOBANK_DEPLOYMENT
          ? '运营已批准开户；客户登录状态已按现有凭据流程更新。'
          : '运营已批准开户，USD/HKD 与 USDT-TRON 钱包已创建'
      );
      setSelectedCustomer(null);
      await load();
    } catch (value) {
      setError(value instanceof Error ? value.message : '运营审核失败');
    }
  };

  const requestVa = async (event: FormEvent) => {
    event.preventDefault();
    if (!selectedCustomer) return;
    try {
      await coreApi(`/customers/${selectedCustomer.id}/virtual-account-requests`, {
        method: 'POST',
        userId,
        body: JSON.stringify({
          currency: vaCurrency,
          preferredCountry: vaCountry,
          purpose: vaPurpose,
        }),
      });
      setVaOpen(false);
      setSelectedCustomer(null);
      setTab('va');
      setSuccess('VA 申请已提交，管理员可直接完成审批');
      await load();
    } catch (value) {
      setError(value instanceof Error ? value.message : 'VA 申请失败');
    }
  };

  const reviewVa = async (request: VirtualAccountRequest, action: 'approve' | 'reject') => {
    try {
      await coreApi(`/virtual-account-requests/${request.id}/${action}`, {
        method: 'PATCH',
        userId,
        body: action === 'reject' ? JSON.stringify({ reason: '银行资料需要补充' }) : undefined,
      });
      setSuccess(action === 'approve' ? 'VA 已开通并建立独立余额账户' : 'VA 申请已拒绝');
      await load();
    } catch (value) {
      setError(value instanceof Error ? value.message : '审批失败');
    }
  };

  return (
    <>
      <Helmet>
        <title>客户开户与 VA | SCC Digital Bank</title>
      </Helmet>
      <Container maxWidth="xl">
        <Stack spacing={3}>
          <Stack direction={{ xs: 'column', md: 'row' }} justifyContent="space-between" gap={2}>
            <Box>
              <Typography variant="h4">客户开户与 VA</Typography>
              <Typography color="text.secondary" sx={{ mt: 0.75 }}>
                {IS_NEOBANK_DEPLOYMENT
                  ? '显示 Render PostgreSQL 中的真实客户申请；KYC 通过后自动激活并创建 USDT-TRC20 钱包。'
                  : '支持个人和企业开户；先完成人工 KYC，再由运营批准开户。只有运营批准后才创建钱包。'}
              </Typography>
            </Box>
            <Stack direction="row" spacing={1.5}>
              {!IS_NEOBANK_DEPLOYMENT && (
                <FormControl size="small" sx={{ minWidth: 180 }}>
                  <InputLabel>本地演示身份</InputLabel>
                  <Select
                    label="本地演示身份"
                    value={userId}
                    onChange={(event) => setUserId(event.target.value)}
                  >
                    {demoUsers.map((user) => (
                      <MenuItem key={user.id} value={user.id}>
                        {user.label}
                      </MenuItem>
                    ))}
                  </Select>
                </FormControl>
              )}
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
            <Tabs value={tab} onChange={(_, value) => setTab(value)} sx={{ px: 2.5 }}>
              <Tab value="customers" label={`开户申请 (${customers.length})`} />
              <Tab value="va" label={`VA 申请 (${vaRequests.length})`} />
            </Tabs>
            {tab === 'customers' ? (
              <CustomerTable rows={customers} loading={loading} onOpen={setSelectedCustomer} />
            ) : (
              <VaRequestTable
                rows={vaRequests}
                currentUserId={userId}
                portal={portal}
                onReview={reviewVa}
              />
            )}
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
      <CustomerDrawer
        customer={selectedCustomer}
        currentUserId={userId}
        portal={portal}
        onClose={() => setSelectedCustomer(null)}
        onReviewKyc={reviewKyc}
        onApproveCustomer={approveCustomer}
        onRequestVa={() => setVaOpen(true)}
      />
      <Dialog open={vaOpen} onClose={() => setVaOpen(false)} fullWidth maxWidth="sm">
        <Box component="form" onSubmit={requestVa}>
          <DialogTitle>申请独立 VA</DialogTitle>
          <DialogContent>
            <Stack spacing={2} sx={{ mt: 1 }}>
              <FormControl fullWidth>
                <InputLabel>币种</InputLabel>
                <Select
                  label="币种"
                  value={vaCurrency}
                  onChange={(event) => setVaCurrency(event.target.value as Currency)}
                >
                  {fiatCurrencies.map((currency) => (
                    <MenuItem key={currency} value={currency}>
                      {currency}
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>
              <TextField
                required
                label="开户地区（国家代码）"
                value={vaCountry}
                onChange={(event) => setVaCountry(event.target.value.toUpperCase())}
                inputProps={{ maxLength: 2 }}
              />
              <TextField
                required
                multiline
                minRows={2}
                label="账户用途"
                value={vaPurpose}
                onChange={(event) => setVaPurpose(event.target.value)}
              />
            </Stack>
          </DialogContent>
          <DialogActions>
            <Button onClick={() => setVaOpen(false)}>取消</Button>
            <Button type="submit" variant="contained">
              提交 VA 申请
            </Button>
          </DialogActions>
        </Box>
      </Dialog>
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
            <TableCell>客户</TableCell>
            <TableCell>类型</TableCell>
            <TableCell>国家/地区</TableCell>
            <TableCell>邮箱</TableCell>
            <TableCell>KYC</TableCell>
            <TableCell>状态</TableCell>
            <TableCell>钱包/VA</TableCell>
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
              <TableCell>{customer.email}</TableCell>
              <TableCell>{kycStatusLabel(customer.kycStatus, customer.status)}</TableCell>
              <TableCell>
                <CustomerStatus status={customer.status} />
              </TableCell>
              <TableCell>{customer.accounts?.length || 0}</TableCell>
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

function VaRequestTable({
  rows,
  currentUserId,
  portal,
  onReview,
}: {
  rows: VirtualAccountRequest[];
  currentUserId: string;
  portal: boolean;
  onReview: (request: VirtualAccountRequest, action: 'approve' | 'reject') => Promise<void>;
}) {
  return (
    <TableContainer>
      <Table>
        <TableHead>
          <TableRow>
            <TableCell>客户</TableCell>
            <TableCell>币种</TableCell>
            <TableCell>地区</TableCell>
            <TableCell>用途</TableCell>
            <TableCell>状态/账户</TableCell>
            <TableCell align="right">操作</TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {rows.map((request) => (
            <TableRow key={request.id}>
              <TableCell>{request.customer.displayName}</TableCell>
              <TableCell>{request.currency}</TableCell>
              <TableCell>{request.preferredCountry}</TableCell>
              <TableCell>{request.purpose}</TableCell>
              <TableCell>
                <Stack alignItems="flex-start" gap={0.5}>
                  <CustomerStatus status={request.status} />
                  {request.assignedAccount && (
                    <Typography variant="caption">
                      {request.assignedAccount.accountNumber}
                    </Typography>
                  )}
                </Stack>
              </TableCell>
              <TableCell align="right">
                {!portal && request.status === 'SUBMITTED' && (
                  <Stack direction="row" justifyContent="flex-end" spacing={1}>
                    <Button
                      size="small"
                      color="error"
                      onClick={() => onReview(request, 'reject').catch(() => undefined)}
                    >
                      拒绝
                    </Button>
                    <Button
                      size="small"
                      variant="contained"
                      disabled={request.makerId === currentUserId && currentUserId !== 'usr_admin'}
                      onClick={() => onReview(request, 'approve').catch(() => undefined)}
                    >
                      通过
                    </Button>
                  </Stack>
                )}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </TableContainer>
  );
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

function CustomerDrawer({
  customer,
  currentUserId,
  portal,
  onClose,
  onReviewKyc,
  onApproveCustomer,
  onRequestVa,
}: {
  customer: Customer | null;
  currentUserId: string;
  portal: boolean;
  onClose: () => void;
  onReviewKyc: (customer: Customer, decision: 'APPROVE' | 'REJECT') => Promise<void>;
  onApproveCustomer: (customer: Customer) => Promise<void>;
  onRequestVa: () => void;
}) {
  if (!customer) return null;
  return (
    <Drawer
      anchor="right"
      open
      onClose={onClose}
      PaperProps={{ sx: { width: { xs: 1, sm: 520 }, p: 3 } }}
    >
      <Stack spacing={3}>
        <Stack direction="row" justifyContent="space-between">
          <Box>
            <Typography variant="h5">{customer.displayName}</Typography>
            <Typography color="text.secondary">
              {customer.type === 'BUSINESS' ? '企业客户' : '个人客户'} · {customer.countryCode}
            </Typography>
          </Box>
          <CustomerStatus status={customer.status} />
        </Stack>
        <Info label="法定名称" value={customer.legalName} />
        <Info label="邮箱" value={customer.email} />
        <Info
          label="电话"
          value={`${customer.phoneCountryCode || ''} ${customer.phone || ''}`.trim() || '-'}
        />
        <Info label="KYC 状态" value={kycStatusLabel(customer.kycStatus, customer.status)} />
        {customer.type === 'INDIVIDUAL' ? (
          <>
            <Info label="出生日期" value={customer.dateOfBirth?.slice(0, 10) || '-'} />
            <Info label="国籍" value={customer.nationality || '-'} />
          </>
        ) : (
          <>
            <Info label="企业注册号" value={customer.registrationNo || '-'} />
            <Info label="授权联系人" value={customer.contactName || '-'} />
            <Info label="联系人职务" value={customer.contactRole || '-'} />
            <Info label="最终受益人" value={customer.beneficialOwnerName || '-'} />
            <Info
              label="持股或控制比例"
              value={
                customer.beneficialOwnerOwnership ? `${customer.beneficialOwnerOwnership}%` : '-'
              }
            />
          </>
        )}
        <Info label="客户编号" value={customer.id} />
        <Alert severity="info">
          {IS_NEOBANK_DEPLOYMENT
            ? 'KYC 通过会自动激活客户并幂等创建一个经 Cregis 归属验证的 USDT-TRC20 钱包。'
            : 'KYC 通过不代表开户完成。运营批准后才创建 USD、HKD 法币钱包和 USDT-TRON 数字钱包。'}
        </Alert>
        {customer.status === 'ACTIVE' && (
          <>
            <Typography variant="h6">已开通账户</Typography>
            <Stack spacing={1}>
              {customer.accounts?.map((account) => (
                <Card key={account.id} variant="outlined">
                  <CardContent sx={{ py: 1.5 }}>
                    <Stack direction="row" justifyContent="space-between">
                      <Box>
                        <Typography variant="subtitle2">{account.name}</Typography>
                        <Typography variant="caption" color="text.secondary">
                          {account.accountNumber}
                        </Typography>
                      </Box>
                      <Chip size="small" label={account.currency} />
                    </Stack>
                  </CardContent>
                </Card>
              ))}
            </Stack>
            <Button variant="contained" onClick={onRequestVa}>
              申请新的独立 VA
            </Button>
          </>
        )}
        {!portal && customer.status === 'PENDING_REVIEW' && customer.kycStatus === 'PENDING' && (
          <Stack direction="row" spacing={1}>
            <Button
              fullWidth
              color="error"
              variant="outlined"
              onClick={() => onReviewKyc(customer, 'REJECT').catch(() => undefined)}
            >
              KYC 不通过
            </Button>
            <Button
              fullWidth
              variant="contained"
              disabled={customer.creatorId === currentUserId && currentUserId !== 'usr_admin'}
              onClick={() => onReviewKyc(customer, 'APPROVE').catch(() => undefined)}
            >
              KYC 通过
            </Button>
          </Stack>
        )}
        {!IS_NEOBANK_DEPLOYMENT &&
          !portal &&
          customer.status === 'PENDING_REVIEW' &&
          customer.kycStatus === 'APPROVED' && (
            <Button
              fullWidth
              variant="contained"
              disabled={customer.creatorId === currentUserId && currentUserId !== 'usr_admin'}
              onClick={() => onApproveCustomer(customer).catch(() => undefined)}
            >
              运营批准开户
            </Button>
          )}
      </Stack>
    </Drawer>
  );
}

function CustomerStatus({ status }: { status: string }) {
  let color: 'success' | 'error' | 'warning' = 'warning';
  if (status === 'ACTIVE' || status === 'APPROVED') color = 'success';
  if (status === 'REJECTED') color = 'error';
  const labels: Record<string, string> = {
    ACTIVE: '已开通',
    PENDING_REVIEW: '待审核',
    REJECTED: '已拒绝',
    SUSPENDED: '已暂停',
    SUBMITTED: '待审批',
    APPROVED: '已开通',
  };
  return <Label color={color}>{labels[status] || status}</Label>;
}
function kycStatusLabel(status: Customer['kycStatus'], customerStatus: Customer['status']) {
  if (status === 'APPROVED') {
    return customerStatus === 'PENDING_REVIEW' ? '已通过，待运营审核' : '已通过';
  }
  return { PENDING: '待人工审核', REJECTED: '未通过' }[status];
}
function Info({ label, value }: { label: string; value: string }) {
  return (
    <Stack direction="row" justifyContent="space-between" gap={2}>
      <Typography color="text.secondary">{label}</Typography>
      <Typography variant="subtitle2" textAlign="right">
        {value}
      </Typography>
    </Stack>
  );
}
