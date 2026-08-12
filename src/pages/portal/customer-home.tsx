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
import { AssetSummary, coreApi, MoneyAccount } from 'src/features/finance/core-api';
import { ACTION_ICONS } from 'src/theme/iconography';
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
  const assetSummaryAsOf = assetSummary
    ? new Intl.DateTimeFormat('zh-CN', {
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      }).format(new Date(assetSummary.asOf))
    : '';
  const firstName =
    customer?.type === 'INDIVIDUAL' ? customer.displayName : customer?.displayName.split(' ')[0];
  const quickActions = [
    {
      label: '法币转入',
      hint: 'USD · HKD',
      path: '/portal/money/deposit',
      icon: ACTION_ICONS.fundsIn,
      iconColor: '#16876A',
      iconBackground: '#E7F5F0',
    },
    {
      label: '法币转出',
      hint: '银行付款',
      path: '/portal/money/payouts',
      icon: ACTION_ICONS.fundsOut,
      iconColor: '#3267C8',
      iconBackground: '#EAF0FC',
    },
    {
      label: 'USDT 转入',
      hint: 'TRON · TRC20',
      path: '/portal/crypto-wallet/deposit',
      icon: ACTION_ICONS.fundsIn,
      iconColor: '#26A17B',
      iconBackground: '#E7F5F0',
    },
    {
      label: 'USDT 转出',
      hint: 'TRON · TRC20',
      path: '/portal/crypto-wallet/withdraw',
      icon: ACTION_ICONS.fundsOut,
      iconColor: '#D34F5D',
      iconBackground: '#FCECEF',
    },
    {
      label: 'OTC',
      hint: 'USDT ⇄ 法币',
      path: '/portal/money/otc',
      icon: ACTION_ICONS.otc,
      iconColor: '#7654C5',
      iconBackground: '#F1EDFB',
      fullWidth: true,
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
    <Typography variant="h3" sx={{ mt: 1, mb: 2.25, letterSpacing: '-0.03em' }}>
      暂不可用
    </Typography>
  );
  if (assetSummaryLoading) {
    valuationContent = <Skeleton width={240} height={58} />;
  } else if (assetSummary) {
    valuationContent = (
      <Typography variant="h2" sx={{ mt: 1, mb: 2.25, letterSpacing: '-0.04em' }}>
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
              gridTemplateColumns: { xs: '1fr', lg: 'minmax(0, 1.5fr) minmax(340px, .62fr)' },
              alignItems: 'stretch',
              gap: 2.5,
            }}
          >
            <Card
              sx={{
                minHeight: { xs: 304, md: 318 },
                color: '#F3FAF7',
                bgcolor: '#123F38',
                backgroundImage:
                  'radial-gradient(circle at 92% 8%, rgba(105, 193, 165, .24), transparent 34%)',
                boxShadow: 'none',
                overflow: 'hidden',
                position: 'relative',
              }}
            >
              <Box
                sx={{
                  position: 'absolute',
                  width: 230,
                  height: 230,
                  borderRadius: '50%',
                  border: '1px solid rgba(255,255,255,.07)',
                  right: -106,
                  bottom: -135,
                }}
              />
              <CardContent
                sx={{
                  p: { xs: 3, sm: 3.5, md: 4 },
                  height: '100%',
                  display: 'flex',
                  flexDirection: 'column',
                  position: 'relative',
                }}
              >
                <Stack direction="row" justifyContent="space-between" alignItems="center" gap={2}>
                  <Typography
                    variant="overline"
                    sx={{ color: '#B7D8CE', letterSpacing: 1.2, lineHeight: 1 }}
                  >
                    {valuationLabel}
                  </Typography>
                  <Box
                    sx={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 0.75,
                      px: 1.25,
                      py: 0.65,
                      borderRadius: 10,
                      bgcolor: 'rgba(255,255,255,.08)',
                      color: '#D9ECE6',
                      typography: 'caption',
                      fontWeight: 700,
                      whiteSpace: 'nowrap',
                    }}
                  >
                    <Box sx={{ width: 6, height: 6, borderRadius: '50%', bgcolor: '#79D6B8' }} />
                    USD 折算
                  </Box>
                </Stack>
                {valuationContent}
                <Typography variant="body2" sx={{ mt: -1.25, color: '#B7D8CE' }}>
                  {assetSummaryAsOf ? `更新于 ${assetSummaryAsOf}` : '正在同步账户余额'}
                </Typography>

                <Box sx={{ mt: 2.5 }}>
                  {assetSummaryLoading ? (
                    <Skeleton height={10} sx={{ bgcolor: 'rgba(255,255,255,.12)' }} />
                  ) : (
                    <Box
                      role="img"
                      aria-label="资产币种占比"
                      sx={{
                        height: 7,
                        display: 'flex',
                        gap: '2px',
                        overflow: 'hidden',
                        borderRadius: 8,
                        bgcolor: 'rgba(255,255,255,.1)',
                      }}
                    >
                      {assetSummary?.distribution.map((item) => (
                        <Box
                          key={item.currency}
                          sx={{
                            flexGrow: item.shareBps,
                            flexBasis: 0,
                            minWidth: item.shareBps > 0 ? 3 : 0,
                            bgcolor: assetSummaryColor[item.currency] || '#B7D8CE',
                          }}
                        />
                      ))}
                    </Box>
                  )}
                  <Stack
                    direction="row"
                    flexWrap="wrap"
                    useFlexGap
                    gap={{ xs: 1.5, sm: 2.5 }}
                    sx={{ mt: 1.25, minHeight: 20 }}
                  >
                    {!assetSummaryLoading &&
                      assetSummary?.distribution.map((item) => (
                        <Stack
                          key={item.currency}
                          direction="row"
                          alignItems="center"
                          spacing={0.75}
                        >
                          <Box
                            sx={{
                              width: 7,
                              height: 7,
                              borderRadius: '50%',
                              bgcolor: assetSummaryColor[item.currency] || '#B7D8CE',
                            }}
                          />
                          <Typography variant="caption" sx={{ color: '#D4E8E2' }}>
                            {item.currency} {(item.shareBps / 100).toFixed(1)}%
                          </Typography>
                        </Stack>
                      ))}
                  </Stack>
                </Box>

                <Box
                  sx={{
                    display: 'grid',
                    gridTemplateColumns: {
                      xs: 'repeat(2, minmax(0, 1fr))',
                      sm: 'repeat(3, minmax(0, 1fr))',
                    },
                    mt: 'auto',
                    pt: 2.5,
                    borderTop: '1px solid rgba(255,255,255,.13)',
                    gap: { xs: 2, sm: 3 },
                  }}
                >
                  <AssetSummaryMetric
                    label="可用资产"
                    value={assetSummary ? money(assetSummary.totalAvailable, 'USD') : '—'}
                    loading={assetSummaryLoading}
                  />
                  <AssetSummaryMetric
                    label="冻结资产"
                    value={assetSummary ? money(assetSummary.totalFrozen, 'USD') : '—'}
                    loading={assetSummaryLoading}
                  />
                  <AssetSummaryMetric
                    label="资产账户"
                    value={assetSummary ? `${assetSummary.accountCount} 个` : '—'}
                    loading={assetSummaryLoading}
                    optional
                  />
                </Box>
              </CardContent>
            </Card>

            <Card sx={{ boxShadow: 'none', border: '1px solid', borderColor: 'divider' }}>
              <CardContent sx={{ p: { xs: 2.5, sm: 3 }, height: '100%' }}>
                <Box>
                  <Typography variant="h6">资金操作</Typography>
                  <Typography variant="body2" color="text.secondary" sx={{ mt: 0.35 }}>
                    转入、转出或兑换
                  </Typography>
                </Box>
                <Box
                  sx={{
                    mt: 2.25,
                    display: 'grid',
                    gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
                    gap: 1.25,
                  }}
                >
                  {quickActions.map((action) => (
                    <ButtonBase
                      key={action.path}
                      aria-label={`${action.label}，${action.hint}`}
                      onClick={() => navigate(action.path)}
                      sx={{
                        gridColumn: 'fullWidth' in action && action.fullWidth ? '1 / -1' : 'auto',
                        minHeight: 60,
                        py: 1,
                        px: 1.5,
                        justifyContent: 'flex-start',
                        textAlign: 'left',
                        color: 'text.primary',
                        border: '1px solid',
                        borderColor: 'divider',
                        borderRadius: 1.5,
                        gap: 1.25,
                        transition:
                          'transform 160ms ease-out, border-color 160ms ease-out, background-color 160ms ease-out',
                        '&:hover': {
                          bgcolor: 'action.hover',
                          borderColor: action.iconColor,
                          transform: 'translateY(-1px)',
                        },
                        '&:active': { transform: 'translateY(0)' },
                        '&:focus-visible': {
                          outline: '2px solid',
                          outlineColor: 'primary.main',
                          outlineOffset: 2,
                        },
                      }}
                    >
                      <Box
                        sx={{
                          width: 36,
                          height: 36,
                          borderRadius: 1.25,
                          display: 'grid',
                          placeItems: 'center',
                          flexShrink: 0,
                          bgcolor: action.iconBackground,
                          color: action.iconColor,
                        }}
                      >
                        <Iconify icon={action.icon} width={21} />
                      </Box>
                      <Box sx={{ minWidth: 0 }}>
                        <Typography variant="subtitle2" sx={{ lineHeight: 1.25 }}>
                          {action.label}
                        </Typography>
                        <Typography
                          variant="caption"
                          color="text.secondary"
                          sx={{ display: 'block', mt: 0.35, whiteSpace: 'nowrap' }}
                        >
                          {action.hint}
                        </Typography>
                      </Box>
                      {'fullWidth' in action && action.fullWidth && (
                        <Iconify
                          icon="solar:alt-arrow-right-linear"
                          width={18}
                          sx={{ ml: 'auto', color: 'text.disabled' }}
                        />
                      )}
                    </ButtonBase>
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

const assetSummaryColor: Record<string, string> = {
  USD: '#78D1B4',
  HKD: '#F0C97A',
  USDT: '#5FBFA4',
};

function AssetSummaryMetric({
  label,
  value,
  loading,
  optional = false,
}: {
  label: string;
  value: string;
  loading: boolean;
  optional?: boolean;
}) {
  return (
    <Box sx={{ display: optional ? { xs: 'none', sm: 'block' } : 'block', minWidth: 0 }}>
      <Typography variant="caption" sx={{ color: '#AFCFC5' }}>
        {label}
      </Typography>
      {loading ? (
        <Skeleton width={92} sx={{ bgcolor: 'rgba(255,255,255,.12)' }} />
      ) : (
        <Typography variant="subtitle1" sx={{ mt: 0.35, fontWeight: 700 }} noWrap>
          {value}
        </Typography>
      )}
    </Box>
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
