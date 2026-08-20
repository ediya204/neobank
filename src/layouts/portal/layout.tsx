import { useState } from 'react';
import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import {
  AppBar,
  Avatar,
  Box,
  Button,
  Chip,
  Container,
  Divider,
  IconButton,
  Menu,
  MenuItem,
  Select,
  Stack,
  Toolbar,
  Typography,
} from '@mui/material';
import Logo from 'src/components/logo';
import Iconify from 'src/components/iconify';
import { useAuthContext } from 'src/auth/hooks';
import { canAccessPortalPath } from 'src/auth/role-access';
import { APP_NAME_CN, APP_NAME_EN } from 'src/config-global';
import { IS_NEOBANK_DEPLOYMENT } from 'src/config/deployment-mode';
import {
  PortalCustomerProvider,
  usePortalCustomer,
} from 'src/features/finance/portal-customer-context';
import { portalText, usePortalLanguage } from 'src/locales/portal-text';

const navItems = [
  ['业务概览', '/portal/home', 'solar:home-2-bold-duotone'],
  ['客户账户', '/portal/money/accounts', 'solar:wallet-money-bold-duotone'],
  ['资金服务', '/portal/money/transfers', 'solar:transfer-horizontal-bold-duotone'],
  ['交易明细', '/portal/transactions', 'solar:history-bold-duotone'],
  ['收款人管理', '/portal/money/beneficiaries', 'solar:user-id-bold-duotone'],
] as const;

const customerNavItems = [
  ['账户概览', '/portal/home', 'solar:home-2-bold-duotone'],
  ['账户与资产', '/portal/money/accounts', 'solar:wallet-money-bold-duotone'],
  ['收付与兑换', '/portal/money/transfers', 'solar:transfer-horizontal-bold-duotone'],
  ['OTC 兑换', '/portal/money/otc', 'solar:hand-money-bold-duotone'],
  ['交易明细', '/portal/transactions', 'solar:history-bold-duotone'],
] as const;

const customerMobileNavPaths = new Set([
  '/portal/home',
  '/portal/money/accounts',
  '/portal/money/transfers',
  '/portal/money/otc',
  '/portal/transactions',
]);

export default function PortalLayout() {
  return (
    <PortalCustomerProvider>
      <PortalFrame />
    </PortalCustomerProvider>
  );
}

function PortalFrame() {
  usePortalLanguage();
  const navigate = useNavigate();
  const location = useLocation();
  const { customers, customer, selectCustomer } = usePortalCustomer();
  const { user, logout } = useAuthContext();
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  let visibleNavItems: ReadonlyArray<readonly [string, string, string]> = [];
  if (user?.role === 'customer') {
    visibleNavItems = customerNavItems;
  } else if (user) {
    visibleNavItems = navItems.filter(([, path]) => canAccessPortalPath(user, path));
  }
  const mobileNavItems =
    user?.role === 'customer'
      ? visibleNavItems.filter(([, path]) => customerMobileNavPaths.has(path))
      : visibleNavItems;
  const showAccountSettings = Boolean(user && canAccessPortalPath(user, '/portal/settings'));
  const isActive = (path: string) => {
    if (path === '/portal/home') {
      return location.pathname === path;
    }
    if (path === '/portal/money/accounts') {
      if (user?.role === 'customer') {
        return (
          location.pathname.startsWith(path) ||
          location.pathname.startsWith('/portal/virtual-accounts') ||
          location.pathname.startsWith('/portal/crypto-wallet')
        );
      }
      return (
        location.pathname.startsWith(path) || location.pathname.startsWith('/portal/crypto-wallet')
      );
    }
    if (path === '/portal/money/transfers') {
      return (
        location.pathname.startsWith(path) ||
        location.pathname.startsWith('/portal/money/deposit') ||
        location.pathname.startsWith('/portal/money/fx') ||
        location.pathname.startsWith('/portal/money/payouts')
      );
    }
    return location.pathname.startsWith(path);
  };

  return (
    <Box sx={{ minHeight: '100vh', bgcolor: '#F5F7FA' }}>
      <AppBar
        position="sticky"
        elevation={0}
        color="inherit"
        sx={{ borderBottom: '1px solid', borderColor: 'divider', bgcolor: 'rgba(255,255,255,.94)' }}
      >
        <Container maxWidth="xl">
          <Toolbar disableGutters sx={{ minHeight: { xs: 64, md: 72 }, gap: 2 }}>
            <Stack direction="row" alignItems="center" spacing={1.25} sx={{ mr: { md: 4 } }}>
              <Logo sx={{ width: 34, height: 34 }} />
              <Box sx={{ lineHeight: 1.1 }}>
                <Typography variant="subtitle1" sx={{ fontWeight: 800, letterSpacing: '-0.02em' }}>
                  {APP_NAME_CN}
                </Typography>
                <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 600 }}>
                  {APP_NAME_EN}
                </Typography>
              </Box>
            </Stack>
            <Stack
              direction="row"
              spacing={0.5}
              sx={{ display: { xs: 'none', lg: 'flex' }, flex: 1 }}
            >
              {visibleNavItems.map(([label, path]) => (
                <Button
                  key={path}
                  color={isActive(path) ? 'primary' : 'inherit'}
                  onClick={() => navigate(path)}
                  sx={{ fontWeight: isActive(path) ? 700 : 500, px: 1.5 }}
                >
                  {portalText(label)}
                </Button>
              ))}
            </Stack>
            <Box sx={{ flex: { xs: 1, lg: 0 } }} />
            {process.env.NODE_ENV === 'development' && !IS_NEOBANK_DEPLOYMENT && customer && (
              <Select
                size="small"
                value={customer.id}
                onChange={(event) => selectCustomer(event.target.value)}
                sx={{
                  display: { xs: 'none', md: 'flex' },
                  minWidth: 210,
                  bgcolor: 'background.paper',
                }}
              >
                {customers
                  .filter((row) => row.id.startsWith('cus_demo_'))
                  .map((row) => (
                    <MenuItem key={row.id} value={row.id}>
                      {row.type === 'BUSINESS' ? portalText('企业 ·') : portalText('个人 ·')}
                      {row.displayName}
                    </MenuItem>
                  ))}
              </Select>
            )}
            <IconButton
              onClick={(event) => setAnchor(event.currentTarget)}
              aria-label={portalText('打开账户菜单')}
            >
              <Avatar sx={{ width: 36, height: 36, bgcolor: 'primary.main', typography: 'body2' }}>
                {customer?.displayName.slice(0, 1) || 'M'}
              </Avatar>
            </IconButton>
            <Menu anchorEl={anchor} open={Boolean(anchor)} onClose={() => setAnchor(null)}>
              <Box sx={{ px: 2, py: 1, minWidth: 220 }}>
                <Typography variant="subtitle2">
                  {customer?.displayName || portalText('客户账户')}
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  {customer?.email}
                </Typography>
              </Box>
              <Divider />
              {showAccountSettings && (
                <MenuItem
                  onClick={() => {
                    setAnchor(null);
                    navigate('/portal/settings');
                  }}
                >
                  <Iconify icon="solar:settings-bold-duotone" sx={{ mr: 1.5 }} />
                  {portalText('安全与设置')}
                </MenuItem>
              )}
              {user?.role === 'customer' ? (
                <MenuItem
                  onClick={() => {
                    setAnchor(null);
                    logout().finally(() => window.location.assign('/customer/login'));
                  }}
                >
                  <Iconify icon="solar:logout-2-linear" sx={{ mr: 1.5 }} />
                  {portalText('退出登录')}
                </MenuItem>
              ) : (
                <MenuItem
                  onClick={() => {
                    setAnchor(null);
                    window.location.assign('/dashboard/overview');
                  }}
                >
                  <Iconify icon="solar:shield-user-linear" sx={{ mr: 1.5 }} />
                  {portalText('进入运营管理后台')}
                </MenuItem>
              )}
            </Menu>
          </Toolbar>
        </Container>
      </AppBar>

      <Box component="main" sx={{ py: { xs: 3, md: 5 }, pb: { xs: 11, lg: 6 } }}>
        {customer && (
          <Container maxWidth="xl" sx={{ mb: 2, display: { xs: 'block', md: 'none' } }}>
            <Stack direction="row" justifyContent="space-between" alignItems="center">
              <Box>
                <Typography variant="caption" color="text.secondary">
                  {portalText('当前客户')}
                </Typography>
                <Typography variant="subtitle2">{customer.displayName}</Typography>
              </Box>
              <Chip
                size="small"
                label={
                  customer.type === 'BUSINESS' ? portalText('企业账户') : portalText('个人账户')
                }
              />
            </Stack>
          </Container>
        )}
        <Outlet />
      </Box>

      <Box
        sx={{
          display: { xs: 'grid', lg: 'none' },
          gridTemplateColumns: `repeat(${Math.max(mobileNavItems.length, 1)}, 1fr)`,
          position: 'fixed',
          left: 0,
          right: 0,
          bottom: 0,
          zIndex: 1200,
          bgcolor: 'background.paper',
          borderTop: '1px solid',
          borderColor: 'divider',
          pb: 'env(safe-area-inset-bottom)',
        }}
      >
        {mobileNavItems.map(([label, path, icon]) => (
          <Button
            key={path}
            onClick={() => navigate(path)}
            color={isActive(path) ? 'primary' : 'inherit'}
            sx={{ minWidth: 0, py: 1, flexDirection: 'column', gap: 0.25, typography: 'caption' }}
          >
            <Iconify icon={icon} width={21} />
            {portalText(label)}
          </Button>
        ))}
      </Box>
    </Box>
  );
}
