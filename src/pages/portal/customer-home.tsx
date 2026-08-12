import { Helmet } from 'react-helmet-async';
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  Container,
  Divider,
  Skeleton,
  Stack,
  Typography,
} from '@mui/material';
import { useNavigate } from 'react-router-dom';
import Iconify from 'src/components/iconify';
import { usePortalCustomer } from 'src/features/finance/portal-customer-context';
import { Currency, MoneyAccount } from 'src/features/finance/core-api';
import { accountLabel, money, OperationStatus, OperationTitle } from './customer-shared';

const usdRates: Record<Currency, number> = {
  USD: 1,
  SGD: 0.78,
  HKD: 0.128,
  EUR: 1.16,
  GBP: 1.34,
  USDT: 1,
};

export default function CustomerHome() {
  const navigate = useNavigate();
  const { customer, operations, loading, error } = usePortalCustomer();
  const accounts = customer?.accounts || [];
  const fiatAccounts = accounts.filter((row) => row.kind !== 'CRYPTO_WALLET');
  const totalUsd = fiatAccounts.reduce(
    (sum, row) => sum + Number(row.availableBalance) * usdRates[row.currency],
    0
  );
  const firstName =
    customer?.type === 'INDIVIDUAL' ? customer.displayName : customer?.displayName.split(' ')[0];
  const quickActions = [
    ['收款', '/portal/money/accounts', 'solar:download-minimalistic-bold-duotone', '#E8F6F2'],
    ['转账', '/portal/money/transfers', 'solar:transfer-horizontal-bold-duotone', '#EAF1FF'],
    ['换汇', '/portal/money/fx', 'solar:refresh-square-bold-duotone', '#FFF5E6'],
    ['付款', '/portal/money/payouts', 'solar:card-send-bold-duotone', '#F3EDFF'],
  ] as const;
  const featured = fiatAccounts.filter((row) => row.kind === 'SYSTEM_WALLET').slice(0, 5);

  return (
    <>
      <Helmet>
        <title>我的账户 | Moventra</title>
      </Helmet>
      <Container maxWidth="xl">
        <Stack spacing={3}>
          {error && <Alert severity="error">{error}</Alert>}
          <Box>
            <Stack direction="row" alignItems="center" spacing={1}>
              <Typography variant="h4">你好，{firstName || '欢迎回来'}</Typography>
              {customer && (
                <Chip size="small" label={customer.type === 'BUSINESS' ? '企业账户' : '个人账户'} />
              )}
            </Stack>
            <Typography color="text.secondary" sx={{ mt: 0.75 }}>
              {customer?.type === 'BUSINESS'
                ? '管理企业的收款、付款和多币种资金。'
                : '轻松管理你的多币种余额、收款和转账。'}
            </Typography>
          </Box>

          <Box
            sx={{
              display: 'grid',
              gridTemplateColumns: { xs: '1fr', lg: 'minmax(0, 1.45fr) minmax(320px, .55fr)' },
              gap: 3,
            }}
          >
            <Card
              sx={{
                color: 'common.white',
                background: 'linear-gradient(135deg, #143B35 0%, #0B6B5B 100%)',
                overflow: 'hidden',
                position: 'relative',
              }}
            >
              <Box
                sx={{
                  position: 'absolute',
                  width: 260,
                  height: 260,
                  borderRadius: '50%',
                  bgcolor: 'rgba(255,255,255,.06)',
                  right: -80,
                  top: -100,
                }}
              />
              <CardContent sx={{ p: { xs: 3, md: 4 }, position: 'relative' }}>
                <Typography sx={{ opacity: 0.72 }}>总资产估值</Typography>
                {loading ? (
                  <Skeleton width={240} height={58} />
                ) : (
                  <Typography variant="h2" sx={{ mt: 1, mb: 3, letterSpacing: '-0.04em' }}>
                    {money(totalUsd, 'USD')}
                  </Typography>
                )}
                <Stack
                  direction="row"
                  spacing={3}
                  divider={
                    <Divider
                      orientation="vertical"
                      flexItem
                      sx={{ borderColor: 'rgba(255,255,255,.2)' }}
                    />
                  }
                >
                  <Box>
                    <Typography variant="caption" sx={{ opacity: 0.7 }}>
                      可用币种
                    </Typography>
                    <Typography variant="h6">5 种法币</Typography>
                  </Box>
                  <Box>
                    <Typography variant="caption" sx={{ opacity: 0.7 }}>
                      收款账户
                    </Typography>
                    <Typography variant="h6">
                      {accounts.filter((row) => row.kind === 'VIRTUAL_ACCOUNT').length} 个 VA
                    </Typography>
                  </Box>
                  <Box sx={{ display: { xs: 'none', sm: 'block' } }}>
                    <Typography variant="caption" sx={{ opacity: 0.7 }}>
                      资金状态
                    </Typography>
                    <Typography variant="h6">正常</Typography>
                  </Box>
                </Stack>
              </CardContent>
            </Card>

            <Card>
              <CardContent sx={{ p: 3 }}>
                <Typography variant="h6">常用功能</Typography>
                <Box
                  sx={{ mt: 2.5, display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 2 }}
                >
                  {quickActions.map(([label, path, icon, color]) => (
                    <Button
                      key={path}
                      onClick={() => navigate(path)}
                      sx={{
                        py: 2,
                        px: 1,
                        bgcolor: color,
                        color: 'text.primary',
                        flexDirection: 'column',
                        gap: 1,
                        '&:hover': { bgcolor: color, filter: 'brightness(.97)' },
                      }}
                    >
                      <Iconify icon={icon} width={28} color="primary.main" />
                      {label}
                    </Button>
                  ))}
                </Box>
              </CardContent>
            </Card>
          </Box>

          <Box>
            <Stack
              direction="row"
              justifyContent="space-between"
              alignItems="center"
              sx={{ mb: 2 }}
            >
              <Typography variant="h5">我的余额</Typography>
              <Button
                endIcon={<Iconify icon="eva:arrow-ios-forward-fill" />}
                onClick={() => navigate('/portal/money/accounts')}
              >
                全部账户
              </Button>
            </Stack>
            <Box
              sx={{
                display: 'grid',
                gridTemplateColumns: {
                  xs: 'repeat(2, minmax(0, 1fr))',
                  md: 'repeat(3, 1fr)',
                  xl: 'repeat(5, 1fr)',
                },
                gap: 2,
              }}
            >
              {featured.map((account) => (
                <BalanceCard key={account.id} account={account} />
              ))}
            </Box>
          </Box>

          <Card>
            <CardContent sx={{ p: 0 }}>
              <Stack
                direction="row"
                justifyContent="space-between"
                alignItems="center"
                sx={{ p: 3, pb: 2 }}
              >
                <Box>
                  <Typography variant="h5">最近交易</Typography>
                  <Typography variant="body2" color="text.secondary">
                    你的最新资金动态
                  </Typography>
                </Box>
                <Button onClick={() => navigate('/portal/transactions')}>查看全部</Button>
              </Stack>
              <Divider />
              {operations.slice(0, 5).map((operation, index) => (
                <Stack
                  key={operation.id}
                  direction="row"
                  alignItems="center"
                  spacing={2}
                  sx={{
                    px: 3,
                    py: 2,
                    borderBottom: index < Math.min(operations.length, 5) - 1 ? '1px solid' : 0,
                    borderColor: 'divider',
                  }}
                >
                  <Box
                    sx={{
                      width: 42,
                      height: 42,
                      borderRadius: '50%',
                      display: 'grid',
                      placeItems: 'center',
                      bgcolor: operation.type === 'DEPOSIT' ? 'success.lighter' : 'grey.100',
                    }}
                  >
                    <Iconify
                      icon={
                        operation.type === 'DEPOSIT'
                          ? 'solar:arrow-down-bold'
                          : 'solar:arrow-up-bold'
                      }
                      color={operation.type === 'DEPOSIT' ? 'success.main' : 'text.secondary'}
                    />
                  </Box>
                  <Box sx={{ flex: 1, minWidth: 0 }}>
                    <OperationTitle operation={operation} />
                  </Box>
                  <Box sx={{ textAlign: 'right' }}>
                    <Typography variant="subtitle2">
                      {operation.type === 'DEPOSIT' ? '+' : '-'}
                      {money(operation.amount, operation.currency)}
                    </Typography>
                    <OperationStatus status={operation.status} />
                  </Box>
                </Stack>
              ))}
              {!operations.length && (
                <Typography color="text.secondary" align="center" sx={{ py: 6 }}>
                  还没有交易记录
                </Typography>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardContent sx={{ p: 3 }}>
              <Stack
                direction={{ xs: 'column', md: 'row' }}
                justifyContent="space-between"
                alignItems={{ md: 'center' }}
                gap={2}
              >
                <Stack direction="row" spacing={2} alignItems="center">
                  <Box
                    sx={{
                      width: 48,
                      height: 48,
                      borderRadius: 2,
                      bgcolor: '#E8F6F2',
                      display: 'grid',
                      placeItems: 'center',
                    }}
                  >
                    <Iconify icon="cryptocurrency-color:usdt" width={29} />
                  </Box>
                  <Box>
                    <Typography variant="h6">USDT 数字钱包</Typography>
                    <Typography variant="body2" color="text.secondary">
                      TRON · BSC · Ethereum 三条网络独立余额和收付币
                    </Typography>
                  </Box>
                </Stack>
                <Button
                  variant="outlined"
                  endIcon={<Iconify icon="eva:arrow-ios-forward-fill" />}
                  onClick={() => navigate('/portal/crypto-wallet')}
                >
                  进入数字钱包
                </Button>
              </Stack>
            </CardContent>
          </Card>
        </Stack>
      </Container>
    </>
  );
}

function BalanceCard({ account }: { account: MoneyAccount }) {
  return (
    <Card>
      <CardContent sx={{ p: 2.5 }}>
        <Stack direction="row" justifyContent="space-between" alignItems="center">
          <Typography variant="subtitle2">{account.currency}</Typography>
          <Typography variant="caption" color="text.secondary">
            {accountLabel(account)}
          </Typography>
        </Stack>
        <Typography variant="h5" sx={{ mt: 2 }}>
          {money(account.availableBalance, account.currency)}
        </Typography>
        {Number(account.frozenBalance) > 0 && (
          <Typography variant="caption" color="warning.main">
            冻结 {money(account.frozenBalance, account.currency)}
          </Typography>
        )}
      </CardContent>
    </Card>
  );
}
