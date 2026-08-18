import { useEffect, useMemo, useState } from 'react';
import { Helmet } from 'react-helmet-async';
import { Alert, Box, Button, Card, CardContent, Container, Stack, Typography } from '@mui/material';
import { useNavigate } from 'react-router-dom';
import Iconify from 'src/components/iconify';
import { coreApi, Customer, demoOrganizationId, Operation } from 'src/features/finance/core-api';

export default function CoreOverview({ portal = false }: { portal?: boolean }) {
  const navigate = useNavigate();
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [operations, setOperations] = useState<Operation[]>([]);
  const [error, setError] = useState('');
  useEffect(() => {
    Promise.all([
      coreApi<Customer[]>(`/customers?organizationId=${demoOrganizationId}`, {
        userId: 'usr_admin',
      }),
      coreApi<Operation[]>(`/operations?organizationId=${demoOrganizationId}`, {
        userId: 'usr_admin',
      }),
    ])
      .then(([customerRows, operationRows]) => {
        setCustomers(customerRows);
        setOperations(operationRows);
      })
      .catch((value) => setError(value instanceof Error ? value.message : '加载失败'));
  }, []);
  const metrics = useMemo(() => {
    const accounts = customers.flatMap((customer) => customer.accounts || []);
    const accountProductCount = (kind: 'SYSTEM_WALLET' | 'VIRTUAL_ACCOUNT') =>
      new Set(
        accounts
          .filter((account) => account.kind === kind && account.customerId)
          .map((account) => account.customerId)
      ).size;
    return {
      customers: customers.filter((customer) => customer.status === 'ACTIVE').length,
      wallets: accountProductCount('SYSTEM_WALLET'),
      va: accountProductCount('VIRTUAL_ACCOUNT'),
      approvals: operations.filter((operation) => operation.status === 'SUBMITTED').length,
      processing: operations.filter((operation) => operation.status === 'PROCESSING').length,
    };
  }, [customers, operations]);
  const root = portal ? '/portal' : '/dashboard';
  const links = portal
    ? [
        ['客户开户', `${root}/onboarding`, 'solar:user-plus-bold-duotone'],
        ['钱包与 VA', `${root}/money/accounts`, 'solar:wallet-money-bold-duotone'],
        ['内部转账', `${root}/money/transfers`, 'solar:transfer-horizontal-bold-duotone'],
        ['发起出款', `${root}/money/payouts`, 'solar:upload-minimalistic-bold-duotone'],
      ]
    : [
        ['客户开户', `${root}/onboarding`, 'solar:user-plus-bold-duotone'],
        ['法币入账', `${root}/operations/deposits`, 'solar:download-minimalistic-bold-duotone'],
        ['审批中心', `${root}/operations/approvals`, 'solar:clipboard-check-bold-duotone'],
        ['资金通道', `${root}/funding-channels`, 'solar:bank-bold-duotone'],
      ];
  return (
    <>
      <Helmet>
        <title>业务总览 | SSC Digital Bank</title>
      </Helmet>
      <Container maxWidth="xl">
        <Stack spacing={3}>
          <Box>
            <Typography variant="h4">业务总览</Typography>
            <Typography color="text.secondary" sx={{ mt: 0.75 }}>
              客户开户、系统多货币法币账户、VA 账户、USDT-TRON 与资金审批的本地实时数据。
            </Typography>
          </Box>
          {error && <Alert severity="error">{error}</Alert>}
          <Box
            sx={{
              display: 'grid',
              gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, 1fr)', lg: 'repeat(5, 1fr)' },
              gap: 2,
            }}
          >
            <Metric title="有效客户" value={metrics.customers} />
            <Metric title="多货币法币账户" value={metrics.wallets} />
            <Metric title="VA 账户" value={metrics.va} />
            <Metric title="待审批" value={metrics.approvals} highlight />
            <Metric title="执行中出款" value={metrics.processing} highlight />
          </Box>
          <Card>
            <CardContent>
              <Typography variant="h6" sx={{ mb: 2 }}>
                常用操作
              </Typography>
              <Box
                sx={{
                  display: 'grid',
                  gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, 1fr)', lg: 'repeat(4, 1fr)' },
                  gap: 1.5,
                }}
              >
                {links.map(([label, path, icon]) => (
                  <Button
                    key={path}
                    variant="outlined"
                    size="large"
                    startIcon={<Iconify icon={icon} />}
                    onClick={() => navigate(path)}
                    sx={{ justifyContent: 'flex-start', py: 1.5 }}
                  >
                    {label}
                  </Button>
                ))}
              </Box>
            </CardContent>
          </Card>
          <Card>
            <CardContent>
              <Stack direction="row" justifyContent="space-between" alignItems="center">
                <Box>
                  <Typography variant="h6">数字钱包</Typography>
                  <Typography color="text.secondary">
                    仅支持 USDT-TRON（TRC20）；本地审批与记账已启用，真实链上广播保持人工执行。
                  </Typography>
                </Box>
                <Button onClick={() => navigate('/dashboard/operations/crypto-wallets')}>
                  进入审批
                </Button>
              </Stack>
            </CardContent>
          </Card>
        </Stack>
      </Container>
    </>
  );
}

function Metric({
  title,
  value,
  highlight = false,
}: {
  title: string;
  value: number;
  highlight?: boolean;
}) {
  return (
    <Card>
      <CardContent>
        <Typography variant="body2" color="text.secondary">
          {title}
        </Typography>
        <Typography
          variant="h3"
          color={highlight && value ? 'warning.main' : 'text.primary'}
          sx={{ mt: 1 }}
        >
          {value}
        </Typography>
      </CardContent>
    </Card>
  );
}
