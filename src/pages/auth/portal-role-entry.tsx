import { Helmet } from 'react-helmet-async';
import { Link as RouterLink } from 'react-router-dom';
import { Button, Stack, Typography } from '@mui/material';
import { useSearchParams } from 'src/routes/hooks';

function loginPath(scope: 'customer' | 'portal', returnTo: string | null) {
  if (!returnTo) return `/${scope}/login`;
  return `/${scope}/login?${new URLSearchParams({ returnTo }).toString()}`;
}

export default function PortalRoleEntryPage() {
  const searchParams = useSearchParams();
  const returnTo = searchParams.get('returnTo');

  return (
    <>
      <Helmet>
        <title>选择账户类型 | SSC Digital Bank</title>
      </Helmet>
      <Stack spacing={2.5}>
        <Typography variant="h3">选择账户类型</Typography>
        <Typography color="text.secondary">
          网上银行与合作伙伴工作台采用独立的安全会话。请选择与您的账户类型相符的登录入口。
        </Typography>
        <Button
          component={RouterLink}
          to={loginPath('customer', returnTo)}
          size="large"
          variant="contained"
        >
          进入网上银行
        </Button>
        <Button
          component={RouterLink}
          to={loginPath('portal', returnTo)}
          size="large"
          variant="outlined"
        >
          进入合作伙伴工作台
        </Button>
      </Stack>
    </>
  );
}
