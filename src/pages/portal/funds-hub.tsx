import { Helmet } from 'react-helmet-async';
import { useNavigate } from 'react-router-dom';
import { Alert, Box, Container, Stack, Typography } from '@mui/material';
import CustomBreadcrumbs from 'src/components/custom-breadcrumbs';
import Iconify from 'src/components/iconify';
import { APP_DISPLAY_NAME } from 'src/config-global';
import FundsActionList, { FundsActionItem } from 'src/sections/portal/funds/funds-action-list';

const fiatActions: FundsActionItem[] = [
  {
    title: '银行转入',
    description: '查看 USD / HKD 收款账户及专属汇款附言',
    path: '/portal/money/deposit',
    icon: 'solar:download-minimalistic-bold-duotone',
    tone: '#E8F6F2',
  },
  {
    title: '银行转出',
    description: '通过代付、POBO 或 VA 向已登记收款人付款',
    path: '/portal/money/payouts',
    icon: 'solar:upload-minimalistic-bold-duotone',
    tone: '#EAF1FF',
    badge: '审核后处理',
    badgeColor: 'warning',
  },
  {
    title: '法币兑换',
    description: '按当前报价在 USD 与 HKD 账户之间兑换',
    path: '/portal/money/fx',
    icon: 'solar:refresh-square-bold-duotone',
    tone: '#FFF5E6',
  },
];

const cryptoActions: FundsActionItem[] = [
  {
    title: 'USDT 转入',
    description: '查看 TRON（TRC20）转入地址及到账要求',
    path: '/portal/crypto-wallet/deposit',
    icon: 'solar:download-minimalistic-bold-duotone',
    tone: '#E8F6F2',
    badge: 'TRON',
    badgeColor: 'success',
  },
  {
    title: 'USDT 转出',
    description: '向已验证地址提交 TRON（TRC20）转出申请',
    path: '/portal/crypto-wallet/withdraw',
    icon: 'solar:upload-minimalistic-bold-duotone',
    tone: '#FFF0F1',
    badge: '审核后处理',
    badgeColor: 'warning',
  },
  {
    title: 'OTC 兑换',
    description: '按实时报价在 USD / HKD 与 USDT 之间兑换',
    path: '/portal/money/otc',
    icon: 'solar:hand-money-bold-duotone',
    tone: '#F3EDFF',
  },
];

export default function FundsHub() {
  const navigate = useNavigate();

  return (
    <>
      <Helmet>
        <title>收付与兑换 | {APP_DISPLAY_NAME}</title>
      </Helmet>
      <Container maxWidth="lg">
        <Stack spacing={3}>
          <CustomBreadcrumbs
            heading="收付与兑换"
            links={[{ name: '账户概览', href: '/portal/home' }, { name: '收付与兑换' }]}
          />
          <Typography color="text.secondary" sx={{ mt: -2 }}>
            集中办理银行转入、转出、法币兑换及 USDT 资金操作。
          </Typography>

          <FundsActionList
            title="法币"
            subtitle="USD 与 HKD"
            actions={fiatActions}
            onOpen={navigate}
          />
          <FundsActionList
            title="数字资产"
            subtitle="USDT · TRON（TRC20）"
            actions={cryptoActions}
            onOpen={navigate}
          />

          <Alert
            severity="info"
            icon={<Iconify icon="solar:shield-check-bold-duotone" width={24} />}
          >
            <Box>
              <Typography variant="subtitle2">资金处理说明</Typography>
              <Typography variant="body2" sx={{ mt: 0.5 }}>
                转出申请提交后，相应金额会先从可用余额中冻结。审核通过并取得银行参考号或链上 Tx Hash
                后才完成扣账；申请未通过时，冻结金额将自动释放。全部状态变化均保留记录。
              </Typography>
            </Box>
          </Alert>
        </Stack>
      </Container>
    </>
  );
}
