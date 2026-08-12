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
import {
  coreApi,
  Currency,
  Customer,
  demoOrganizationId,
  demoUsers,
  VirtualAccountRequest,
} from 'src/features/finance/core-api';

type CustomerForm = {
  type: 'INDIVIDUAL' | 'BUSINESS';
  displayName: string;
  legalName: string;
  email: string;
  phone: string;
  countryCode: string;
  registrationNo: string;
};

const emptyCustomer: CustomerForm = {
  type: 'BUSINESS',
  displayName: '',
  legalName: '',
  email: '',
  phone: '',
  countryCode: 'SG',
  registrationNo: '',
};

const fiatCurrencies: Currency[] = ['USD', 'SGD', 'HKD', 'EUR', 'GBP'];

export default function OnboardingWorkspace({ portal = false }: { portal?: boolean }) {
  const [tab, setTab] = useState<'customers' | 'va'>('customers');
  const [userId, setUserId] = useState('usr_maker');
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
        coreApi<Customer[]>(`/customers?organizationId=${demoOrganizationId}`, { userId }),
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
      await coreApi('/customers', {
        method: 'POST',
        userId,
        body: JSON.stringify({ ...customerForm, organizationId: demoOrganizationId }),
      });
      setCustomerOpen(false);
      setCustomerForm(emptyCustomer);
      setSuccess('开户申请已提交，等待另一名复核人员审核');
      await load();
    } catch (value) {
      setError(value instanceof Error ? value.message : '提交失败');
    }
  };

  const reviewCustomer = async (customer: Customer, action: 'approve' | 'reject') => {
    try {
      await coreApi(`/customers/${customer.id}/${action}`, {
        method: 'PATCH',
        userId,
        body: JSON.stringify(
          action === 'approve' ? { note: '资料核验通过' } : { reason: '资料不完整，请重新提交' }
        ),
      });
      setSuccess(action === 'approve' ? '客户开户已通过，五币种钱包已自动创建' : '开户申请已拒绝');
      setSelectedCustomer(null);
      await load();
    } catch (value) {
      setError(value instanceof Error ? value.message : '审核失败');
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
      setSuccess('VA 申请已提交，等待另一名人员复核');
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
      setError(value instanceof Error ? value.message : '复核失败');
    }
  };

  return (
    <>
      <Helmet>
        <title>客户开户与 VA | Moventra</title>
      </Helmet>
      <Container maxWidth="xl">
        <Stack spacing={3}>
          <Stack direction={{ xs: 'column', md: 'row' }} justifyContent="space-between" gap={2}>
            <Box>
              <Typography variant="h4">客户开户与 VA</Typography>
              <Typography color="text.secondary" sx={{ mt: 0.75 }}>
                支持个人和企业开户；审核通过后创建五币种法币钱包，可继续申请一个或多个独立 VA。
              </Typography>
            </Box>
            <Stack direction="row" spacing={1.5}>
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
              <Button
                variant="contained"
                startIcon={<Iconify icon="mingcute:add-line" />}
                onClick={() => setCustomerOpen(true)}
              >
                发起开户
              </Button>
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
        onReview={reviewCustomer}
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
              <TableCell>
                <CustomerStatus status={customer.status} />
              </TableCell>
              <TableCell>{customer.accounts?.length || 0}</TableCell>
            </TableRow>
          ))}
          {!rows.length && (
            <TableRow>
              <TableCell colSpan={6} align="center" sx={{ py: 8 }}>
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
                      disabled={request.makerId === currentUserId}
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
                label="国家代码"
                value={form.countryCode}
                inputProps={{ maxLength: 2 }}
                onChange={(event) => set('countryCode', event.target.value.toUpperCase())}
              />
              {form.type === 'BUSINESS' && (
                <TextField
                  fullWidth
                  label="注册号"
                  value={form.registrationNo}
                  onChange={(event) => set('registrationNo', event.target.value)}
                />
              )}
            </Stack>
            <Alert severity="info">提交后进入待审核；提交人不能审批自己创建的客户。</Alert>
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
  onReview,
  onRequestVa,
}: {
  customer: Customer | null;
  currentUserId: string;
  portal: boolean;
  onClose: () => void;
  onReview: (customer: Customer, action: 'approve' | 'reject') => Promise<void>;
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
        <Info label="客户编号" value={customer.id} />
        <Alert severity="info">
          开户通过后自动创建 USD、SGD、HKD、EUR、GBP 五个法币钱包；数字钱包保持禁用。
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
        {!portal && customer.status === 'PENDING_REVIEW' && (
          <Stack direction="row" spacing={1}>
            <Button
              fullWidth
              color="error"
              variant="outlined"
              onClick={() => onReview(customer, 'reject').catch(() => undefined)}
            >
              拒绝
            </Button>
            <Button
              fullWidth
              variant="contained"
              disabled={customer.creatorId === currentUserId}
              onClick={() => onReview(customer, 'approve').catch(() => undefined)}
            >
              审核通过
            </Button>
          </Stack>
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
    SUBMITTED: '待复核',
    APPROVED: '已开通',
  };
  return <Label color={color}>{labels[status] || status}</Label>;
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
