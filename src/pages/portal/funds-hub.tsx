import { Helmet } from 'react-helmet-async';
import { useNavigate } from 'react-router-dom';
import { Alert, Box, Container, Stack, Typography } from '@mui/material';
import CustomBreadcrumbs from 'src/components/custom-breadcrumbs';
import Iconify from 'src/components/iconify';
import { APP_DISPLAY_NAME } from 'src/config-global';
import FundsActionList, { FundsActionItem } from 'src/sections/portal/funds/funds-action-list';

const fiatActions: FundsActionItem[] = [
  {
    title: '法币转入',
    description: '查看 USD / HKD 银行入款信息与专属附言',
    path: '/portal/money/deposit',
    icon: 'solar:download-minimalistic-bold-duotone',
    tone: '#E8F6F2',
  },
  {
    title: '法币转出',
    description: '代付、POBO 或 VA 转出到已登记银行收款人',
    path: '/portal/money/payouts',
    icon: 'solar:upload-minimalistic-bold-duotone',
    tone: '#EAF1FF',
    badge: '平台审批',
    badgeColor: 'warning',
  },
  {
    title: 'USD / HKD 换汇',
    description: '使用当前报价兑换账户内法币余额',
    path: '/portal/money/fx',
    icon: 'solar:refresh-square-bold-duotone',
    tone: '#FFF5E6',
  },
];

const cryptoActions: FundsActionItem[] = [
  {
    title: 'USDT 转入',
    description: '获取 TRON（TRC20）收币地址与确认要求',
    path: '/portal/crypto-wallet/deposit',
    icon: 'solar:download-minimalistic-bold-duotone',
    tone: '#E8F6F2',
    badge: 'TRON',
    badgeColor: 'success',
  },
  {
    title: 'USDT 转出',
    description: '提交 TRON（TRC20）链上转账申请',
    path: '/portal/crypto-wallet/withdraw',
    icon: 'solar:upload-minimalistic-bold-duotone',
    tone: '#FFF0F1',
    badge: '平台审批',
    badgeColor: 'warning',
  },
  {
    title: 'OTC 兑换',
    description: '在 USD / HKD 与 USDT 之间兑换',
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
            links={[{ name: '总览', href: '/portal/home' }, { name: '收付与兑换' }]}
          />
          <Typography color="text.secondary" sx={{ mt: -2 }}>
            从一个入口完成法币、USDT-TRON 和 OTC 资金操作。
          </Typography>

          <FundsActionList
            title="法币"
            subtitle="USD 与 HKD"
            actions={fiatActions}
            onOpen={navigate}
          />
          <FundsActionList
            title="数字货币"
            subtitle="USDT · TRON（TRC20）"
            actions={cryptoActions}
            onOpen={navigate}
          />

          <Alert
            severity="info"
            icon={<Iconify icon="solar:shield-check-bold-duotone" width={24} />}
          >
            <Box>
              <Typography variant="subtitle2">资金安全边界</Typography>
              <Typography variant="body2" sx={{ mt: 0.5 }}>
                转出提交后先冻结相应可用余额；平台审批并取得银行参考号或链上 Tx Hash
                后才完成扣账。拒绝时释放冻结金额，所有状态变化保留审计记录。
              </Typography>
            </Box>
          </Alert>
        </Stack>
      </Container>
    </>
  );
}
