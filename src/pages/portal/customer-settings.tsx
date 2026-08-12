import { Helmet } from 'react-helmet-async';
import { APP_DISPLAY_NAME } from 'src/config-global';
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Container,
  Divider,
  Stack,
  Typography,
} from '@mui/material';
import Iconify from 'src/components/iconify';
import { usePortalCustomer } from 'src/features/finance/portal-customer-context';

export default function CustomerSettings() {
  const { customer } = usePortalCustomer();
  return (
    <>
      <Helmet>
        <title>账户设置 | {APP_DISPLAY_NAME}</title>
      </Helmet>
      <Container maxWidth="md">
        <Stack spacing={3}>
          <Box>
            <Typography variant="h4">账户设置</Typography>
            <Typography color="text.secondary" sx={{ mt: 0.75 }}>
              管理客户资料、安全设置和企业成员。
            </Typography>
          </Box>
          <Card>
            <CardContent sx={{ p: 3 }}>
              <Stack direction="row" justifyContent="space-between" alignItems="center">
                <Box>
                  <Typography variant="h6">客户资料</Typography>
                  <Typography color="text.secondary">
                    {customer?.type === 'BUSINESS' ? '企业认证资料' : '个人认证资料'}
                  </Typography>
                </Box>
                <Button variant="outlined">申请更新</Button>
              </Stack>
              <Divider sx={{ my: 2.5 }} />
              <Detail
                label={customer?.type === 'BUSINESS' ? '企业名称' : '姓名'}
                value={customer?.legalName || '—'}
              />
              <Detail label="电子邮箱" value={customer?.email || '—'} />
              <Detail label="注册国家/地区" value={customer?.countryCode || '—'} />
            </CardContent>
          </Card>
          <Card>
            <CardContent sx={{ p: 3 }}>
              <Stack direction="row" spacing={2} alignItems="center">
                <Box
                  sx={{
                    width: 46,
                    height: 46,
                    borderRadius: 2,
                    bgcolor: 'success.lighter',
                    display: 'grid',
                    placeItems: 'center',
                  }}
                >
                  <Iconify icon="solar:shield-check-bold-duotone" color="success.main" />
                </Box>
                <Box sx={{ flex: 1 }}>
                  <Typography variant="h6">登录与安全</Typography>
                  <Typography color="text.secondary">
                    密码与动态验证码共同保护你的资金账户。
                  </Typography>
                </Box>
                <Button>管理</Button>
              </Stack>
            </CardContent>
          </Card>
          {customer?.type === 'BUSINESS' && (
            <Card>
              <CardContent sx={{ p: 3 }}>
                <Typography variant="h6">企业成员与权限</Typography>
                <Typography color="text.secondary" sx={{ mt: 0.5, mb: 2 }}>
                  邀请财务人员，并分别设置查看、制单和审批权限。
                </Typography>
                <Alert severity="info">企业内部审批与平台资金审批相互独立。</Alert>
                <Button sx={{ mt: 2 }}>管理企业成员</Button>
              </CardContent>
            </Card>
          )}
        </Stack>
      </Container>
    </>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <Stack direction="row" justifyContent="space-between" sx={{ py: 1 }}>
      <Typography color="text.secondary">{label}</Typography>
      <Typography variant="subtitle2">{value}</Typography>
    </Stack>
  );
}
