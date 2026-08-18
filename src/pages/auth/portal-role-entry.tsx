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
        <title>选择登录入口 | SSC Digital Bank</title>
      </Helmet>
      <Stack spacing={2.5}>
        <Typography variant="h3">选择登录入口</Typography>
        <Typography color="text.secondary">
          客户账户与合作方工作台使用不同的服务端会话，请选择与你的账户一致的入口。
        </Typography>
        <Button
          component={RouterLink}
          to={loginPath('customer', returnTo)}
          size="large"
          variant="contained"
        >
          客户账户
        </Button>
        <Button
          component={RouterLink}
          to={loginPath('portal', returnTo)}
          size="large"
          variant="outlined"
        >
          合作方工作台
        </Button>
      </Stack>
    </>
  );
}
