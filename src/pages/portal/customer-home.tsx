import { useEffect, useState } from 'react';
import { Helmet } from 'react-helmet-async';
import {
  Alert,
  Box,
  Button,
  ButtonBase,
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
import AssetIcon from 'src/components/asset-icon';
import { APP_DISPLAY_NAME } from 'src/config-global';
import { usePortalCustomer } from 'src/features/finance/portal-customer-context';
import {
  AssetSummary,
  coreApi,
  MoneyAccount,
  supportedFiatCurrencies,
} from 'src/features/finance/core-api';
import { accountLabel, money, OperationStatus, OperationTitle } from './customer-shared';

type AssetSummaryRequestState = 'idle' | 'loading' | 'ready' | 'unavailable';

export default function CustomerHome() {
  const navigate = useNavigate();
  const { customer, operations, loading, error } = usePortalCustomer();
  const [assetSummary, setAssetSummary] = useState<AssetSummary | null>(null);
  const [assetSummaryState, setAssetSummaryState] = useState<AssetSummaryRequestState>('idle');
  const [assetSummaryError, setAssetSummaryError] = useState('');
  const [assetSummaryReload, setAssetSummaryReload] = useState(0);
  const accounts = customer?.accounts || [];
  const fiatAccounts = accounts.filter((row) => row.kind !== 'CRYPTO_WALLET');
  const assetSummaryLoading = loading || assetSummaryState === 'loading';
  const valuationLabel =
    assetSummary?.valuationStatus === 'partial' ? '部分资产估值' : '总资产估值';
  const firstName =
    customer?.type === 'INDIVIDUAL' ? customer.displayName : customer?.displayName.split(' ')[0];
  const quickActions = [
    {
      label: '法币转入',
      path: '/portal/money/deposit',
      icon: 'solar:download-minimalistic-bold-duotone',
      iconColor: '#16876A',
    },
    {
      label: '法币转出',
      path: '/portal/money/payouts',
      icon: 'solar:upload-minimalistic-bold-duotone',
      iconColor: '#3267C8',
    },
    {
      label: 'USDT 转入',
      path: '/portal/crypto-wallet/deposit',
      icon: 'solar:download-minimalistic-bold-duotone',
      iconColor: '#26A17B',
    },
    {
      label: 'USDT 转出',
      path: '/portal/crypto-wallet/withdraw',
      icon: 'solar:upload-minimalistic-bold-duotone',
      iconColor: '#D34F5D',
    },
    {
      label: 'OTC',
      path: '/portal/money/otc',
      icon: 'solar:hand-money-bold-duotone',
      iconColor: '#7654C5',
    },
  ] as const;
  const featured = fiatAccounts.filter((row) => row.kind === 'SYSTEM_WALLET').slice(0, 5);

  useEffect(() => {
    let active = true;
    if (!customer) {
      setAssetSummary(null);
      setAssetSummaryState('idle');
      setAssetSummaryError('');
      return () => {
        active = false;
      };
    }
    setAssetSummary(null);
    setAssetSummaryState('loading');
    setAssetSummaryError('');
    coreApi<AssetSummary>(`/accounts/summary?customerId=${customer.id}`)
      .then((result) => {
        if (!Number.isFinite(Number(result.totalBalance))) {
          throw new Error('估值数据格式无效');
        }
        if (active) {
          setAssetSummary(result);
          setAssetSummaryState('ready');
        }
      })
      .catch((value) => {
        if (active) {
          setAssetSummary(null);
          setAssetSummaryState('unavailable');
          setAssetSummaryError(value instanceof Error ? value.message : '资产估值加载失败');
        }
      });
    return () => {
      active = false;
    };
  }, [assetSummaryReload, customer]);

  let valuationContent = (
    <Typography variant="h3" sx={{ mt: 1, mb: 3, letterSpacing: '-0.03em' }}>
      暂不可用
    </Typography>
  );
  if (assetSummaryLoading) {
    valuationContent = <Skeleton width={240} height={58} />;
  } else if (assetSummary) {
    valuationContent = (
      <Typography variant="h2" sx={{ mt: 1, mb: 3, letterSpacing: '-0.04em' }}>
        {money(Number(assetSummary.totalBalance), 'USD')}
      </Typography>
    );
  }

  return (
    <>
      <Helmet>
        <title>我的账户 | {APP_DISPLAY_NAME}</title>
      </Helmet>
      <Container maxWidth="xl">
        <Stack spacing={3}>
          {error && <Alert severity="error">{error}</Alert>}
          {assetSummaryState === 'unavailable' && customer && (
            <Alert
              severity="warning"
              action={
                <Button
                  color="inherit"
                  size="small"
                  onClick={() => setAssetSummaryReload((value) => value + 1)}
                >
                  重试
                </Button>
              }
            >
              总资产估值暂不可用：{assetSummaryError}。为避免误导，当前未使用静态汇率推算金额。
            </Alert>
          )}
          {assetSummary?.valuationStatus === 'partial' && (
            <Alert severity="warning">
              当前仅为部分资产估值；
              {assetSummary.missingRates.length
                ? `${assetSummary.missingRates.join('、')} 暂无有效估值汇率，未计入当前金额。`
                : '部分资产暂无有效估值汇率，未计入当前金额。'}
            </Alert>
          )}
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
                <Typography sx={{ opacity: 0.72 }}>{valuationLabel}</Typography>
                {valuationContent}
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
                    <Typography variant="h6">{supportedFiatCurrencies.length} 种法币</Typography>
                  </Box>
                  <Box>
                    <Typography variant="caption" sx={{ opacity: 0.7 }}>
                      数字钱包
                    </Typography>
                    <Typography variant="h6">USDT · TRON</Typography>
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
                  {quickActions.map((action) => (
                    <Button
                      key={action.path}
                      onClick={() => navigate(action.path)}
                      sx={{
                        minHeight: 86,
                        py: 1.75,
                        px: 1,
                        bgcolor: 'background.paper',
                        color: 'text.primary',
                        border: '1px solid',
                        borderColor: 'divider',
                        borderRadius: 1.5,
                        flexDirection: 'column',
                        gap: 0.75,
                        fontWeight: 600,
                        transition: 'border-color 160ms ease-out, background-color 160ms ease-out',
                        '&:hover': {
                          bgcolor: 'background.paper',
                          borderColor: action.iconColor,
                        },
                      }}
                    >
                      <Iconify icon={action.icon} width={27} color={action.iconColor} />
                      {action.label}
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
                endIcon={<Iconify icon="solar:alt-arrow-right-linear" />}
                onClick={() => navigate('/portal/money/accounts')}
              >
                全部账户
              </Button>
            </Stack>
            <Card sx={{ overflow: 'hidden' }}>
              <Box
                sx={{
                  display: { xs: 'none', md: 'grid' },
                  gridTemplateColumns: 'minmax(220px, 1.4fr) minmax(160px, 1fr) 1fr 1fr 32px',
                  alignItems: 'center',
                  px: 3,
                  py: 1.5,
                  bgcolor: 'background.neutral',
                  borderBottom: '1px solid',
                  borderColor: 'divider',
                }}
              >
                <Typography variant="caption" color="text.secondary">
                  币种账户
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  账户类型
                </Typography>
                <Typography variant="caption" color="text.secondary" textAlign="right">
                  可用余额
                </Typography>
                <Typography variant="caption" color="text.secondary" textAlign="right">
                  冻结余额
                </Typography>
              </Box>

              {featured.map((account, index) => (
                <BalanceListRow
                  key={account.id}
                  account={account}
                  divider={index < featured.length - 1}
                  onClick={() => navigate('/portal/money/accounts')}
                />
              ))}
            </Card>
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
                          ? 'solar:download-minimalistic-bold-duotone'
                          : 'solar:upload-minimalistic-bold-duotone'
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
                    <AssetIcon asset="USDT" network="TRON" size={32} />
                  </Box>
                  <Box>
                    <Typography variant="h6">USDT 数字钱包</Typography>
                    <Typography variant="body2" color="text.secondary">
                      仅支持 TRON（TRC20）网络的 USDT 余额和收付币
                    </Typography>
                  </Box>
                </Stack>
                <Button
                  variant="outlined"
                  endIcon={<Iconify icon="solar:alt-arrow-right-linear" />}
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

function BalanceListRow({
  account,
  divider,
  onClick,
}: {
  account: MoneyAccount;
  divider: boolean;
  onClick: () => void;
}) {
  return (
    <ButtonBase
      onClick={onClick}
      sx={{
        width: '100%',
        display: 'grid',
        gridTemplateColumns: {
          xs: 'minmax(0, 1fr) auto',
          md: 'minmax(220px, 1.4fr) minmax(160px, 1fr) 1fr 1fr 32px',
        },
        alignItems: 'center',
        gap: { xs: 1, md: 0 },
        px: 3,
        py: { xs: 2.25, md: 2 },
        textAlign: 'left',
        borderBottom: divider ? '1px solid' : 0,
        borderColor: 'divider',
        transition: 'background-color 160ms ease-out',
        '&:hover': { bgcolor: 'action.hover' },
        '&:focus-visible': {
          outline: '2px solid',
          outlineColor: 'primary.main',
          outlineOffset: -2,
        },
      }}
    >
      <Stack direction="row" spacing={1.5} alignItems="center" sx={{ minWidth: 0 }}>
        <Box
          sx={{
            width: 40,
            height: 40,
            borderRadius: '50%',
            bgcolor: 'background.neutral',
            display: 'grid',
            placeItems: 'center',
            flexShrink: 0,
          }}
        >
          <AssetIcon
            asset={account.currency}
            network={account.network}
            size={account.currency === 'USDT' ? 30 : 28}
          />
        </Box>
        <Box sx={{ minWidth: 0 }}>
          <Typography variant="subtitle2">{account.currency} 账户</Typography>
          <Typography
            variant="caption"
            color="text.secondary"
            sx={{ display: { xs: 'block', md: 'none' } }}
          >
            {accountLabel(account)}
          </Typography>
        </Box>
      </Stack>

      <Typography
        variant="body2"
        color="text.secondary"
        sx={{ display: { xs: 'none', md: 'block' } }}
      >
        {accountLabel(account)}
      </Typography>

      <Box sx={{ textAlign: 'right' }}>
        <Typography variant="subtitle2">
          {money(account.availableBalance, account.currency)}
        </Typography>
        <Typography
          variant="caption"
          color="text.secondary"
          sx={{ display: { xs: 'block', md: 'none' } }}
        >
          可用
        </Typography>
      </Box>

      <Typography
        variant="body2"
        color={Number(account.frozenBalance) > 0 ? 'warning.main' : 'text.secondary'}
        textAlign="right"
        sx={{ display: { xs: 'none', md: 'block' } }}
      >
        {money(account.frozenBalance, account.currency)}
      </Typography>

      <Iconify
        icon="solar:alt-arrow-right-linear"
        width={18}
        sx={{ display: { xs: 'none', md: 'block' }, color: 'text.disabled', justifySelf: 'end' }}
      />
    </ButtonBase>
  );
}
