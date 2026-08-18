import { useMemo, useState } from 'react';
import { Helmet } from 'react-helmet-async';
import { useNavigate, useParams } from 'react-router-dom';
import {
  Avatar,
  Box,
  Button,
  Chip,
  Container,
  Divider,
  FormControlLabel,
  LinearProgress,
  MenuItem,
  Paper,
  Select,
  Snackbar,
  Stack,
  Switch,
  Tab,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Tabs,
  TextField,
  Typography,
} from '@mui/material';
import { alpha, useTheme } from '@mui/material/styles';
import Iconify from 'src/components/iconify';
import Label from 'src/components/label';
import { paths } from 'src/routes/paths';

type DemoVariant = 'command' | 'timeline' | 'dossier';

const variants: Array<{
  id: DemoVariant;
  number: string;
  name: string;
  note: string;
}> = [
  { id: 'command', number: '01', name: '指挥中心', note: '行动优先' },
  { id: 'timeline', number: '02', name: '运营时间线', note: '过程优先' },
  { id: 'dossier', number: '03', name: '金融档案', note: '数据优先' },
];

const balances = [
  { asset: 'USD', available: '128,420.80', pending: '8,250.00', tone: '#2F6B4F' },
  { asset: 'HKD', available: '642,180.00', pending: '0.00', tone: '#9C6A2C' },
  { asset: 'USDT', available: '34,892.56', pending: '1,200.00', tone: '#277D70' },
];

const transactions = [
  {
    id: 'TXN-892140',
    type: 'VA 入账',
    asset: 'USD',
    amount: '+ 25,000.00',
    status: '已完成',
    time: '08-19 14:32',
  },
  {
    id: 'TXN-891772',
    type: 'USDT 提币',
    asset: 'USDT',
    amount: '- 8,000.00',
    status: '待复核',
    time: '08-19 11:08',
  },
  {
    id: 'TXN-890316',
    type: '内部换汇',
    asset: 'USD → HKD',
    amount: '12,500.00',
    status: '已完成',
    time: '08-18 17:44',
  },
  {
    id: 'TXN-888902',
    type: 'VA 入账',
    asset: 'HKD',
    amount: '+ 80,000.00',
    status: '已完成',
    time: '08-16 09:21',
  },
];

const timelineItems = [
  {
    title: 'USDT 提币进入二次复核',
    detail: '8,000 USDT · TRON · 收款地址已通过白名单校验',
    actor: '风控规则引擎',
    time: '今天 11:08',
    icon: 'solar:shield-check-bold',
    color: '#9C6A2C',
  },
  {
    title: 'USD 虚拟账户入账完成',
    detail: '25,000.00 USD · DBS Bank · 参考号 FT2608190321',
    actor: '清算服务',
    time: '今天 10:42',
    icon: 'solar:banknote-2-bold',
    color: '#2F6B4F',
  },
  {
    title: '更新客户专属手续费规则',
    detail: 'USDT-TRON：固定费用由 1.00 调整为 0.80 USDT',
    actor: '陈俊杰 · 运营管理员',
    time: '昨天 16:20',
    icon: 'solar:settings-bold',
    color: '#315F8C',
  },
  {
    title: 'KYC 年度复核通过',
    detail: '受益所有人及公司登记资料已完成复核，下次复核 2027-08-18',
    actor: '刘嘉欣 · 合规复核员',
    time: '昨天 09:15',
    icon: 'solar:verified-check-bold',
    color: '#277D70',
  },
];

const fieldRows = [
  ['客户编号', 'CUS-2026-00198'],
  ['法定名称', 'Northstar Commerce Limited'],
  ['注册地', 'Hong Kong SAR'],
  ['公司编号', '76543210'],
  ['主要联系人', 'Amelia Wong'],
  ['联系邮箱', 'amelia@northstar.example'],
  ['联系电话', '+852 6123 8890'],
  ['客户经理', 'Ethan Chan'],
];

const feeRules = [
  { service: 'USDT 提币', basis: '固定费用', defaultFee: '1.00 USDT', customerFee: '0.80 USDT' },
  {
    service: 'USD 汇出',
    basis: '固定 + 比例',
    defaultFee: '15 + 0.10%',
    customerFee: '10 + 0.08%',
  },
  { service: '内部换汇', basis: '点差', defaultFee: '35 bps', customerFee: '28 bps' },
];

const panelSx = {
  border: '1px solid',
  borderColor: 'divider',
  borderRadius: 1.5,
  boxShadow: 'none',
  backgroundImage: 'none',
};

function isVariant(value: string | undefined): value is DemoVariant {
  return variants.some((variant) => variant.id === value);
}

function DemoModeNotice({ onAction }: { onAction: (message: string) => void }) {
  return (
    <Box
      sx={{
        px: 1.5,
        py: 1,
        border: '1px dashed',
        borderColor: 'warning.main',
        bgcolor: (theme) => alpha(theme.palette.warning.main, 0.06),
        borderRadius: 1.25,
        display: 'flex',
        alignItems: 'center',
        gap: 1,
      }}
    >
      <Iconify icon="solar:test-tube-minimalistic-bold" width={18} color="warning.main" />
      <Typography variant="caption" sx={{ flex: 1, color: 'text.secondary' }}>
        视觉 Demo · 所有操作仅展示交互，不会写入客户或财务数据
      </Typography>
      <Button size="small" color="warning" onClick={() => onAction('已保持只读 Demo 模式')}>
        查看说明
      </Button>
    </Box>
  );
}

function VariantSwitcher({ active }: { active: DemoVariant }) {
  const navigate = useNavigate();

  return (
    <Box
      sx={{
        display: 'grid',
        gridTemplateColumns: { xs: '1fr', md: 'repeat(3, 1fr)' },
        border: '1px solid',
        borderColor: 'divider',
        borderRadius: 1.5,
        overflow: 'hidden',
        bgcolor: 'background.paper',
      }}
    >
      {variants.map((variant, index) => {
        const selected = variant.id === active;
        return (
          <Button
            key={variant.id}
            disableRipple
            onClick={() => navigate(paths.dashboard.customerDemo(variant.id))}
            sx={{
              minHeight: 62,
              px: 2,
              borderRadius: 0,
              borderLeft: { xs: 0, md: index === 0 ? 0 : '1px solid' },
              borderTop: { xs: index === 0 ? 0 : '1px solid', md: 0 },
              borderColor: 'divider',
              justifyContent: 'flex-start',
              color: selected ? 'text.primary' : 'text.secondary',
              bgcolor: selected ? 'action.selected' : 'transparent',
              '&:hover': { bgcolor: 'action.hover' },
            }}
          >
            <Typography
              component="span"
              sx={{
                mr: 1.5,
                fontSize: 12,
                fontWeight: 800,
                color: selected ? 'primary.main' : 'text.disabled',
              }}
            >
              {variant.number}
            </Typography>
            <Box sx={{ textAlign: 'left' }}>
              <Typography component="span" sx={{ display: 'block', fontSize: 14, fontWeight: 700 }}>
                {variant.name}
              </Typography>
              <Typography component="span" sx={{ display: 'block', fontSize: 11, fontWeight: 500 }}>
                {variant.note}
              </Typography>
            </Box>
          </Button>
        );
      })}
    </Box>
  );
}

function CustomerIdentity({ compact = false }: { compact?: boolean }) {
  return (
    <Stack direction="row" alignItems="center" spacing={2} sx={{ minWidth: 0 }}>
      <Avatar
        sx={{
          width: compact ? 44 : 58,
          height: compact ? 44 : 58,
          bgcolor: '#1E3A34',
          color: '#F3F8F5',
          fontSize: compact ? 15 : 19,
          fontWeight: 800,
          letterSpacing: '-0.03em',
        }}
      >
        NC
      </Avatar>
      <Box sx={{ minWidth: 0 }}>
        <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
          <Typography
            sx={{
              fontSize: compact ? 17 : { xs: 22, md: 27 },
              lineHeight: 1.15,
              fontWeight: 750,
              letterSpacing: '-0.035em',
              color: 'text.primary',
            }}
          >
            Northstar Commerce
          </Typography>
          <Label color="success">正常</Label>
          <Label color="info">KYC 已通过</Label>
        </Stack>
        <Typography variant="body2" color="text.secondary" sx={{ mt: 0.6 }}>
          企业客户 · CUS-2026-00198 · 香港 · 客户经理 Ethan Chan
        </Typography>
      </Box>
    </Stack>
  );
}

function BalanceStrip() {
  return (
    <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: 'repeat(3, 1fr)' } }}>
      {balances.map((balance, index) => (
        <Box
          key={balance.asset}
          sx={{
            p: 2.25,
            borderLeft: { xs: 0, sm: index === 0 ? 0 : '1px solid' },
            borderTop: { xs: index === 0 ? 0 : '1px solid', sm: 0 },
            borderColor: 'divider',
          }}
        >
          <Stack direction="row" alignItems="center" spacing={1}>
            <Box
              sx={{
                width: 9,
                height: 9,
                borderRadius: '50%',
                bgcolor: balance.tone,
                boxShadow: `0 0 0 4px ${alpha(balance.tone, 0.1)}`,
              }}
            />
            <Typography variant="overline" color="text.secondary">
              {balance.asset} 可用余额
            </Typography>
          </Stack>
          <Typography sx={{ mt: 1, fontSize: 22, fontWeight: 750, letterSpacing: '-0.03em' }}>
            {balance.available}
          </Typography>
          <Typography variant="caption" color="text.secondary">
            待处理 {balance.pending}
          </Typography>
        </Box>
      ))}
    </Box>
  );
}

function ActivityTable({ dense = false }: { dense?: boolean }) {
  return (
    <TableContainer>
      <Table size="small">
        <TableHead>
          <TableRow>
            <TableCell>时间 / 编号</TableCell>
            <TableCell>业务类型</TableCell>
            <TableCell>资产</TableCell>
            <TableCell align="right">金额</TableCell>
            <TableCell align="right">状态</TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {transactions.slice(0, dense ? 4 : 3).map((row) => (
            <TableRow key={row.id} hover>
              <TableCell>
                <Typography variant="body2" fontWeight={650}>
                  {row.time}
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  {row.id}
                </Typography>
              </TableCell>
              <TableCell>{row.type}</TableCell>
              <TableCell>{row.asset}</TableCell>
              <TableCell align="right" sx={{ fontWeight: 700, whiteSpace: 'nowrap' }}>
                {row.amount}
              </TableCell>
              <TableCell align="right">
                <Label color={row.status === '已完成' ? 'success' : 'warning'}>{row.status}</Label>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </TableContainer>
  );
}

function CommandCenter({ onAction }: { onAction: (message: string) => void }) {
  const [tab, setTab] = useState(0);
  const [feeOverride, setFeeOverride] = useState(true);

  return (
    <Stack spacing={2.25}>
      <Paper sx={{ ...panelSx, overflow: 'hidden' }}>
        <Box sx={{ p: { xs: 2, md: 2.75 }, display: 'flex', gap: 2, alignItems: 'center' }}>
          <Box sx={{ flex: 1, minWidth: 0 }}>
            <CustomerIdentity />
          </Box>
          <Stack direction="row" spacing={1} sx={{ display: { xs: 'none', lg: 'flex' } }}>
            <Button
              variant="outlined"
              color="inherit"
              startIcon={<Iconify icon="solar:document-text-bold" />}
              onClick={() => onAction('已打开客户报告预览')}
            >
              客户报告
            </Button>
            <Button
              variant="contained"
              startIcon={<Iconify icon="solar:bolt-bold" />}
              onClick={() => onAction('已打开操作面板（Demo）')}
            >
              发起操作
            </Button>
          </Stack>
        </Box>
        <Divider />
        <Tabs value={tab} onChange={(_, value) => setTab(value)} sx={{ px: 2 }}>
          <Tab label="概览" />
          <Tab label="资料与 KYC" />
          <Tab label="账户与 VA" />
          <Tab label="交易" />
          <Tab label="手续费" />
          <Tab label="审计" />
        </Tabs>
      </Paper>

      <Box
        sx={{
          display: 'grid',
          gridTemplateColumns: { xs: '1fr', lg: 'minmax(0, 1.7fr) 320px' },
          gap: 2.25,
          alignItems: 'start',
        }}
      >
        <Stack spacing={2.25}>
          <Paper sx={{ ...panelSx, overflow: 'hidden' }}>
            <Box sx={{ px: 2.25, pt: 2, pb: 1 }}>
              <Typography variant="overline" color="text.secondary">
                资金全景
              </Typography>
              <Typography variant="h6">账户余额</Typography>
            </Box>
            <BalanceStrip />
          </Paper>

          <Paper sx={{ ...panelSx, overflow: 'hidden' }}>
            <Stack
              direction="row"
              justifyContent="space-between"
              alignItems="center"
              sx={{ p: 2.25 }}
            >
              <Box>
                <Typography variant="overline" color="text.secondary">
                  最近 30 天
                </Typography>
                <Typography variant="h6">交易与操作</Typography>
              </Box>
              <Button size="small" endIcon={<Iconify icon="solar:arrow-right-linear" />}>
                查看全部
              </Button>
            </Stack>
            <ActivityTable />
          </Paper>
        </Stack>

        <Stack spacing={2.25}>
          <Paper sx={{ ...panelSx, p: 2.25 }}>
            <Typography variant="overline" color="text.secondary">
              当前状态
            </Typography>
            <Typography variant="h6" sx={{ mb: 2 }}>
              风险与合规
            </Typography>
            <Stack spacing={1.7}>
              {[
                ['KYC 完整度', '100%', 100, 'success.main'],
                ['资料新鲜度', '92%', 92, 'info.main'],
                ['交易风险', '低', 24, 'success.main'],
              ].map(([label, value, progress, color]) => (
                <Box key={String(label)}>
                  <Stack direction="row" justifyContent="space-between" sx={{ mb: 0.75 }}>
                    <Typography variant="body2">{label}</Typography>
                    <Typography variant="body2" fontWeight={700}>
                      {value}
                    </Typography>
                  </Stack>
                  <LinearProgress
                    variant="determinate"
                    value={Number(progress)}
                    sx={{
                      height: 5,
                      borderRadius: 1,
                      '& .MuiLinearProgress-bar': { bgcolor: color },
                    }}
                  />
                </Box>
              ))}
            </Stack>
          </Paper>

          <Paper sx={{ ...panelSx, p: 2.25 }}>
            <Stack direction="row" justifyContent="space-between" alignItems="center">
              <Box>
                <Typography variant="overline" color="text.secondary">
                  专属配置
                </Typography>
                <Typography variant="h6">手续费覆盖</Typography>
              </Box>
              <Switch
                checked={feeOverride}
                onChange={(event) => setFeeOverride(event.target.checked)}
              />
            </Stack>
            <Divider sx={{ my: 1.75 }} />
            <Typography variant="body2" color="text.secondary">
              USDT-TRON 提币
            </Typography>
            <Stack direction="row" alignItems="baseline" spacing={0.75} sx={{ mt: 0.6 }}>
              <Typography sx={{ fontSize: 25, fontWeight: 750 }}>
                {feeOverride ? '0.80' : '1.00'}
              </Typography>
              <Typography variant="body2" color="text.secondary">
                USDT / 笔
              </Typography>
            </Stack>
            <Button
              fullWidth
              variant="outlined"
              color="inherit"
              sx={{ mt: 2 }}
              onClick={() => onAction('手续费配置为 Demo，只预览未保存')}
            >
              管理客户规则
            </Button>
          </Paper>
        </Stack>
      </Box>
    </Stack>
  );
}

function TimelineWorkspace({ onAction }: { onAction: (message: string) => void }) {
  return (
    <Paper sx={{ ...panelSx, overflow: 'hidden' }}>
      <Box
        sx={{
          display: 'grid',
          gridTemplateColumns: { xs: '1fr', lg: 'minmax(0, 1fr) 340px' },
          minHeight: 720,
        }}
      >
        <Box
          sx={{ p: { xs: 2, md: 3.25 }, borderRight: { lg: '1px solid' }, borderColor: 'divider' }}
        >
          <Stack direction={{ xs: 'column', md: 'row' }} justifyContent="space-between" gap={2}>
            <CustomerIdentity />
            <Stack direction="row" spacing={1}>
              <Button
                variant="outlined"
                color="inherit"
                onClick={() => onAction('筛选器已展开（Demo）')}
                startIcon={<Iconify icon="solar:filter-bold" />}
              >
                筛选
              </Button>
              <Button
                variant="contained"
                onClick={() => onAction('已记录内部备注（Demo）')}
                startIcon={<Iconify icon="solar:notes-bold" />}
              >
                添加记录
              </Button>
            </Stack>
          </Stack>

          <Box sx={{ mt: 4.5, mb: 2 }}>
            <Typography
              sx={{
                fontSize: 12,
                fontWeight: 800,
                letterSpacing: '0.13em',
                color: 'text.disabled',
              }}
            >
              CUSTOMER OPERATIONS LOG
            </Typography>
            <Typography sx={{ mt: 0.5, fontSize: 24, fontWeight: 750, letterSpacing: '-0.035em' }}>
              客户运营时间线
            </Typography>
          </Box>

          <Box sx={{ position: 'relative', pl: 1 }}>
            <Box
              sx={{
                position: 'absolute',
                left: 24,
                top: 24,
                bottom: 22,
                width: 1,
                bgcolor: 'divider',
              }}
            />
            {timelineItems.map((item, index) => (
              <Box
                key={item.title}
                sx={{
                  position: 'relative',
                  display: 'grid',
                  gridTemplateColumns: '48px minmax(0, 1fr)',
                  gap: 2,
                  pb: index === timelineItems.length - 1 ? 0 : 3.5,
                }}
              >
                <Box
                  sx={{
                    zIndex: 1,
                    width: 34,
                    height: 34,
                    mt: 0.25,
                    ml: 0.25,
                    display: 'grid',
                    placeItems: 'center',
                    borderRadius: '50%',
                    color: item.color,
                    bgcolor: (theme) => alpha(item.color, 0.09),
                    border: '1px solid',
                    borderColor: (theme) => alpha(item.color, 0.25),
                  }}
                >
                  <Iconify icon={item.icon} width={18} />
                </Box>
                <Box sx={{ pb: 0.5 }}>
                  <Stack
                    direction={{ xs: 'column', sm: 'row' }}
                    justifyContent="space-between"
                    gap={0.5}
                  >
                    <Typography variant="subtitle1" fontWeight={750}>
                      {item.title}
                    </Typography>
                    <Typography
                      variant="caption"
                      color="text.disabled"
                      sx={{ whiteSpace: 'nowrap' }}
                    >
                      {item.time}
                    </Typography>
                  </Stack>
                  <Typography
                    variant="body2"
                    color="text.secondary"
                    sx={{ mt: 0.75, lineHeight: 1.65 }}
                  >
                    {item.detail}
                  </Typography>
                  <Typography
                    variant="caption"
                    color="text.disabled"
                    sx={{ display: 'block', mt: 1 }}
                  >
                    {item.actor}
                  </Typography>
                </Box>
              </Box>
            ))}
          </Box>
        </Box>

        <Box sx={{ bgcolor: (theme) => alpha(theme.palette.grey[500], 0.035), p: 2.5 }}>
          <Typography variant="overline" color="text.secondary">
            客户上下文
          </Typography>
          <Stack spacing={2.5} sx={{ mt: 1.2 }}>
            <Box>
              <Typography variant="caption" color="text.disabled">
                核心关系
              </Typography>
              <Stack spacing={1.2} sx={{ mt: 1 }}>
                {[
                  ['客户经理', 'Ethan Chan'],
                  ['加入时间', '2024-11-08'],
                  ['风险评级', '低风险'],
                  ['下次 KYC', '2027-08-18'],
                ].map(([label, value]) => (
                  <Stack key={label} direction="row" justifyContent="space-between">
                    <Typography variant="body2" color="text.secondary">
                      {label}
                    </Typography>
                    <Typography variant="body2" fontWeight={700}>
                      {value}
                    </Typography>
                  </Stack>
                ))}
              </Stack>
            </Box>
            <Divider />
            <Box>
              <Typography variant="caption" color="text.disabled">
                账户敞口（折合 USD）
              </Typography>
              <Typography sx={{ mt: 0.8, fontSize: 30, fontWeight: 760, letterSpacing: '-0.04em' }}>
                $255,634.21
              </Typography>
              <Typography variant="caption" color="success.main">
                本月净流入 +12.8%
              </Typography>
            </Box>
            <Divider />
            <Box>
              <Typography variant="caption" color="text.disabled">
                快速操作
              </Typography>
              <Stack spacing={0.75} sx={{ mt: 1 }}>
                {[
                  ['solar:wallet-money-bold', '调整客户手续费'],
                  ['solar:card-2-bold', '管理虚拟账户'],
                  ['solar:user-block-bold', '限制高风险操作'],
                  ['solar:document-text-bold', '导出审计记录'],
                ].map(([icon, label]) => (
                  <Button
                    key={label}
                    color="inherit"
                    fullWidth
                    startIcon={<Iconify icon={icon} width={19} />}
                    onClick={() => onAction(`${label}仅供 Demo 预览`)}
                    sx={{ justifyContent: 'flex-start', px: 1, color: 'text.secondary' }}
                  >
                    {label}
                  </Button>
                ))}
              </Stack>
            </Box>
          </Stack>
        </Box>
      </Box>
    </Paper>
  );
}

function DossierWorkspace({ onAction }: { onAction: (message: string) => void }) {
  const [feeMode, setFeeMode] = useState('customer');
  const [approvalRequired, setApprovalRequired] = useState(true);

  return (
    <Stack spacing={2}>
      <Paper sx={{ ...panelSx, p: { xs: 2, md: 2.5 } }}>
        <Stack direction={{ xs: 'column', lg: 'row' }} justifyContent="space-between" gap={2}>
          <CustomerIdentity compact />
          <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
            <Chip variant="outlined" label="3 个活跃账户" size="small" />
            <Chip variant="outlined" label="2 个 VA" size="small" />
            <Chip variant="outlined" label="风险等级 L1" size="small" />
            <Button
              size="small"
              variant="contained"
              onClick={() => onAction('客户档案变更已进入双人复核（Demo）')}
            >
              提交变更
            </Button>
          </Stack>
        </Stack>
      </Paper>

      <Box
        sx={{
          display: 'grid',
          gridTemplateColumns: { xs: '1fr', xl: 'minmax(0, 1.15fr) minmax(420px, 0.85fr)' },
          gap: 2,
          alignItems: 'start',
        }}
      >
        <Paper sx={{ ...panelSx, overflow: 'hidden' }}>
          <Box sx={{ px: 2.25, py: 1.75, bgcolor: 'action.hover' }}>
            <Typography variant="subtitle1" fontWeight={750}>
              01 / 客户主档
            </Typography>
          </Box>
          <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, 1fr)' } }}>
            {fieldRows.map(([label, value], index) => (
              <Box
                key={label}
                sx={{
                  px: 2.25,
                  py: 1.55,
                  borderTop: '1px solid',
                  borderLeft: { xs: 0, sm: index % 2 === 1 ? '1px solid' : 0 },
                  borderColor: 'divider',
                }}
              >
                <Typography variant="caption" color="text.disabled">
                  {label}
                </Typography>
                <Typography
                  variant="body2"
                  fontWeight={650}
                  sx={{ mt: 0.35, wordBreak: 'break-word' }}
                >
                  {value}
                </Typography>
              </Box>
            ))}
          </Box>
        </Paper>

        <Paper sx={{ ...panelSx, overflow: 'hidden' }}>
          <Stack
            direction="row"
            justifyContent="space-between"
            alignItems="center"
            sx={{ px: 2.25, py: 1.75, bgcolor: 'action.hover' }}
          >
            <Typography variant="subtitle1" fontWeight={750}>
              02 / 客户专属费率
            </Typography>
            <Select
              size="small"
              value={feeMode}
              onChange={(event) => setFeeMode(event.target.value)}
              sx={{ minWidth: 130 }}
            >
              <MenuItem value="customer">客户覆盖</MenuItem>
              <MenuItem value="organization">机构默认</MenuItem>
            </Select>
          </Stack>
          <Box sx={{ px: 2.25, py: 1.2 }}>
            {feeRules.map((rule, index) => (
              <Box key={rule.service}>
                <Box
                  sx={{
                    display: 'grid',
                    gridTemplateColumns: 'minmax(90px, 1fr) minmax(96px, 1fr) minmax(110px, 1.1fr)',
                    gap: 1.25,
                    py: 1.35,
                    alignItems: 'center',
                  }}
                >
                  <Box>
                    <Typography variant="body2" fontWeight={700}>
                      {rule.service}
                    </Typography>
                    <Typography variant="caption" color="text.disabled">
                      {rule.basis}
                    </Typography>
                  </Box>
                  <Box>
                    <Typography variant="caption" color="text.disabled">
                      机构默认
                    </Typography>
                    <Typography variant="body2">{rule.defaultFee}</Typography>
                  </Box>
                  <TextField
                    size="small"
                    label="客户费率"
                    value={feeMode === 'customer' ? rule.customerFee : rule.defaultFee}
                    disabled={feeMode !== 'customer'}
                    inputProps={{ readOnly: true }}
                  />
                </Box>
                {index < feeRules.length - 1 && <Divider />}
              </Box>
            ))}
            <FormControlLabel
              control={
                <Switch
                  checked={approvalRequired}
                  onChange={(event) => setApprovalRequired(event.target.checked)}
                />
              }
              label="费率变更需要双人复核"
              sx={{ mt: 0.5 }}
            />
          </Box>
        </Paper>
      </Box>

      <Paper sx={{ ...panelSx, overflow: 'hidden' }}>
        <Stack
          direction="row"
          justifyContent="space-between"
          alignItems="center"
          sx={{ px: 2.25, py: 1.75 }}
        >
          <Box>
            <Typography variant="subtitle1" fontWeight={750}>
              03 / 账户流水与操作
            </Typography>
            <Typography variant="caption" color="text.secondary">
              金额、状态与操作记录保持在同一审阅视图
            </Typography>
          </Box>
          <Button
            size="small"
            variant="outlined"
            color="inherit"
            startIcon={<Iconify icon="solar:download-minimalistic-bold-duotone" />}
            onClick={() => onAction('审计报表导出仅供 Demo 预览')}
          >
            导出
          </Button>
        </Stack>
        <ActivityTable dense />
      </Paper>
    </Stack>
  );
}

export default function CustomerDetailDemoPage() {
  const theme = useTheme();
  const { variant: routeVariant } = useParams();
  const [notice, setNotice] = useState('');
  const activeVariant: DemoVariant = isVariant(routeVariant) ? routeVariant : 'command';

  const variantDescription = useMemo(
    () => variants.find((variant) => variant.id === activeVariant)?.note || '',
    [activeVariant]
  );

  return (
    <>
      <Helmet>
        <title>客户详情视觉 Demo | SSC Digital Bank</title>
      </Helmet>
      <Box
        sx={{
          minHeight: '100%',
          pb: 6,
          bgcolor: alpha(theme.palette.grey[500], 0.025),
        }}
      >
        <Container maxWidth="xl" sx={{ pt: { xs: 2, md: 3 } }}>
          <Stack spacing={2.25}>
            <Stack direction={{ xs: 'column', md: 'row' }} justifyContent="space-between" gap={1.5}>
              <Box>
                <Typography
                  sx={{
                    fontSize: 12,
                    fontWeight: 800,
                    letterSpacing: '0.14em',
                    color: 'primary.main',
                  }}
                >
                  CUSTOMER DETAIL · DESIGN STUDY
                </Typography>
                <Typography
                  sx={{
                    mt: 0.5,
                    fontSize: { xs: 26, md: 34 },
                    fontWeight: 760,
                    letterSpacing: '-0.045em',
                  }}
                >
                  客户详情三套视觉方案
                </Typography>
                <Typography variant="body2" color="text.secondary" sx={{ mt: 0.7 }}>
                  同一份客户资料，从{variantDescription}的角度重新组织信息与操作。
                </Typography>
              </Box>
              <Button
                color="inherit"
                startIcon={<Iconify icon="solar:arrow-left-linear" />}
                href={paths.dashboard.onboarding}
                sx={{ alignSelf: { xs: 'flex-start', md: 'center' } }}
              >
                返回客户管理
              </Button>
            </Stack>

            <VariantSwitcher active={activeVariant} />
            <DemoModeNotice onAction={setNotice} />

            {activeVariant === 'command' && <CommandCenter onAction={setNotice} />}
            {activeVariant === 'timeline' && <TimelineWorkspace onAction={setNotice} />}
            {activeVariant === 'dossier' && <DossierWorkspace onAction={setNotice} />}
          </Stack>
        </Container>
      </Box>
      <Snackbar
        open={Boolean(notice)}
        autoHideDuration={2600}
        onClose={() => setNotice('')}
        message={notice}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      />
    </>
  );
}
