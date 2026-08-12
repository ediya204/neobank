import { FormEvent, useCallback, useEffect, useState } from 'react';
import { Helmet } from 'react-helmet-async';
import { useNavigate } from 'react-router-dom';
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  Container,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  Drawer,
  FormControl,
  IconButton,
  InputLabel,
  MenuItem,
  Select,
  Skeleton,
  Stack,
  Step,
  StepLabel,
  Stepper,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import Iconify from 'src/components/iconify';
import Label from 'src/components/label';
import { usePortalCustomer } from 'src/features/finance/portal-customer-context';
import {
  coreApi,
  CryptoNetwork,
  CryptoTransfer,
  CryptoWallet,
} from 'src/features/finance/core-api';

export type CryptoWalletView = 'overview' | 'deposit' | 'withdraw';

const networkMeta: Record<
  CryptoNetwork,
  { name: string; standard: string; icon: string; color: string; soft: string }
> = {
  TRON: {
    name: 'Tron',
    standard: 'TRC20',
    icon: 'cryptocurrency-color:trx',
    color: '#EF3340',
    soft: '#FFF0F1',
  },
  BSC: {
    name: 'BNB Smart Chain',
    standard: 'BEP20',
    icon: 'cryptocurrency-color:bnb',
    color: '#E9B719',
    soft: '#FFF8DF',
  },
  ETHEREUM: {
    name: 'Ethereum',
    standard: 'ERC20',
    icon: 'logos:ethereum-color',
    color: '#627EEA',
    soft: '#EEF1FF',
  },
};

export default function CryptoWalletPage({ view = 'overview' }: { view?: CryptoWalletView }) {
  const navigate = useNavigate();
  const { customer } = usePortalCustomer();
  const [wallets, setWallets] = useState<CryptoWallet[]>([]);
  const [transfers, setTransfers] = useState<CryptoTransfer[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [selectedTransfer, setSelectedTransfer] = useState<CryptoTransfer | null>(null);

  const load = useCallback(async () => {
    if (!customer) return;
    setLoading(true);
    setError('');
    try {
      const [walletRows, transferRows] = await Promise.all([
        coreApi<CryptoWallet[]>(`/crypto-wallets?customerId=${customer.id}`),
        coreApi<CryptoTransfer[]>(`/crypto-wallets/transfers?customerId=${customer.id}`),
      ]);
      setWallets(walletRows);
      setTransfers(transferRows);
    } catch (value) {
      setError(value instanceof Error ? value.message : '数字钱包加载失败');
    } finally {
      setLoading(false);
    }
  }, [customer]);

  useEffect(() => {
    load().catch(() => undefined);
  }, [load]);

  let title = '数字钱包';
  if (view === 'deposit') title = '收币';
  if (view === 'withdraw') title = '付币';

  return (
    <>
      <Helmet>
        <title>{title} | Moventra</title>
      </Helmet>
      <Container maxWidth="xl">
        <Stack spacing={3}>
          <Stack direction={{ xs: 'column', md: 'row' }} justifyContent="space-between" gap={2}>
            <Box>
              <Stack direction="row" alignItems="center" spacing={1.25}>
                {view !== 'overview' && (
                  <IconButton
                    onClick={() => navigate('/portal/crypto-wallet')}
                    aria-label="返回数字钱包"
                  >
                    <Iconify icon="eva:arrow-back-fill" />
                  </IconButton>
                )}
                <Box>
                  <Typography variant="h4">{title}</Typography>
                  <Typography color="text.secondary" sx={{ mt: 0.5 }}>
                    {view === 'overview' && '在 TRON、BSC 和 Ethereum 网络管理 USDT。'}
                    {view === 'deposit' && '选择网络并使用对应地址接收 USDT。'}
                    {view === 'withdraw' && '向外部链上地址发送 USDT。'}
                  </Typography>
                </Box>
              </Stack>
            </Box>
            <Stack direction="row" spacing={1}>
              <Button
                variant={view === 'deposit' ? 'contained' : 'outlined'}
                startIcon={<Iconify icon="solar:download-minimalistic-bold" />}
                onClick={() => navigate('/portal/crypto-wallet/deposit')}
              >
                收币
              </Button>
              <Button
                variant={view === 'withdraw' ? 'contained' : 'outlined'}
                startIcon={<Iconify icon="solar:upload-minimalistic-bold" />}
                onClick={() => navigate('/portal/crypto-wallet/withdraw')}
              >
                付币
              </Button>
            </Stack>
          </Stack>
          {error && <Alert severity="error">{error}</Alert>}

          {view === 'overview' && (
            <WalletOverview
              wallets={wallets}
              transfers={transfers}
              loading={loading}
              onOpenTransfer={setSelectedTransfer}
            />
          )}
          {view === 'deposit' && (
            <DepositView
              wallets={wallets}
              transfers={transfers.filter((row) => row.direction === 'DEPOSIT')}
              loading={loading}
              customerId={customer?.id || ''}
              onOpenTransfer={setSelectedTransfer}
            />
          )}
          {view === 'withdraw' && (
            <WithdrawView
              wallets={wallets}
              transfers={transfers.filter((row) => row.direction === 'WITHDRAWAL')}
              loading={loading}
              customerId={customer?.id || ''}
              onOpenTransfer={setSelectedTransfer}
              onCreated={load}
            />
          )}
        </Stack>
      </Container>
      <TransferDrawer transfer={selectedTransfer} onClose={() => setSelectedTransfer(null)} />
    </>
  );
}

function WalletOverview({
  wallets,
  transfers,
  loading,
  onOpenTransfer,
}: {
  wallets: CryptoWallet[];
  transfers: CryptoTransfer[];
  loading: boolean;
  onOpenTransfer: (transfer: CryptoTransfer) => void;
}) {
  const navigate = useNavigate();
  const total = wallets.reduce((sum, wallet) => sum + Number(wallet.availableBalance), 0);
  const frozen = wallets.reduce((sum, wallet) => sum + Number(wallet.frozenBalance), 0);
  return (
    <>
      <Card sx={{ bgcolor: '#102C27', color: 'common.white' }}>
        <CardContent sx={{ p: { xs: 3, md: 4 } }}>
          <Stack direction={{ xs: 'column', md: 'row' }} justifyContent="space-between" gap={3}>
            <Box>
              <Stack direction="row" alignItems="center" spacing={1}>
                <Iconify icon="cryptocurrency-color:usdt" width={30} />
                <Typography sx={{ opacity: 0.72 }}>USDT 总余额</Typography>
              </Stack>
              {loading ? (
                <Skeleton width={260} height={70} />
              ) : (
                <Typography variant="h2" sx={{ mt: 1, letterSpacing: '-0.04em' }}>
                  {formatUsdt(total)}
                </Typography>
              )}
              <Typography variant="body2" sx={{ mt: 1, opacity: 0.62 }}>
                冻结 {formatUsdt(frozen)} · 分布在 {wallets.length} 条网络
              </Typography>
            </Box>
            <Stack direction="row" spacing={1.5} alignItems="center">
              <Button
                variant="contained"
                color="inherit"
                startIcon={<Iconify icon="solar:download-minimalistic-bold" />}
                onClick={() => navigate('/portal/crypto-wallet/deposit')}
                sx={{
                  color: '#102C27',
                  bgcolor: 'common.white',
                  '&:hover': { bgcolor: 'grey.200' },
                }}
              >
                收币
              </Button>
              <Button
                variant="outlined"
                startIcon={<Iconify icon="solar:upload-minimalistic-bold" />}
                onClick={() => navigate('/portal/crypto-wallet/withdraw')}
                sx={{ color: 'common.white', borderColor: 'rgba(255,255,255,.38)' }}
              >
                付币
              </Button>
            </Stack>
          </Stack>
        </CardContent>
      </Card>

      <Box>
        <Typography variant="h5" sx={{ mb: 2 }}>
          网络余额
        </Typography>
        <Box
          sx={{
            display: 'grid',
            gridTemplateColumns: { xs: '1fr', md: 'repeat(3, 1fr)' },
            gap: 2.5,
          }}
        >
          {wallets.map((wallet) => (
            <NetworkWalletCard key={wallet.id} wallet={wallet} />
          ))}
        </Box>
      </Box>

      <TransferList
        title="最近链上记录"
        rows={transfers.slice(0, 8)}
        loading={loading}
        onOpen={onOpenTransfer}
      />
    </>
  );
}

function NetworkWalletCard({ wallet }: { wallet: CryptoWallet }) {
  const meta = networkMeta[wallet.network];
  return (
    <Card>
      <CardContent sx={{ p: 3 }}>
        <Stack direction="row" justifyContent="space-between" alignItems="flex-start">
          <Stack direction="row" spacing={1.5} alignItems="center">
            <Box
              sx={{
                width: 46,
                height: 46,
                borderRadius: 2,
                display: 'grid',
                placeItems: 'center',
                bgcolor: meta.soft,
              }}
            >
              <Iconify icon={meta.icon} width={27} />
            </Box>
            <Box>
              <Typography variant="h6">{meta.name}</Typography>
              <Typography variant="caption" color="text.secondary">
                USDT · {meta.standard}
              </Typography>
            </Box>
          </Stack>
          <Chip size="small" label="正常" color="success" variant="soft" />
        </Stack>
        <Typography variant="h4" sx={{ mt: 3 }}>
          {formatUsdt(wallet.availableBalance)}
        </Typography>
        <Typography variant="caption" color="text.secondary">
          可用余额
        </Typography>
        <Divider sx={{ my: 2 }} />
        <Stack direction="row" justifyContent="space-between">
          <Typography variant="body2" color="text.secondary">
            网络手续费
          </Typography>
          <Typography variant="subtitle2">{formatUsdt(wallet.withdrawalFee)}</Typography>
        </Stack>
      </CardContent>
    </Card>
  );
}

function DepositView({
  wallets,
  transfers,
  loading,
  customerId,
  onOpenTransfer,
}: {
  wallets: CryptoWallet[];
  transfers: CryptoTransfer[];
  loading: boolean;
  customerId: string;
  onOpenTransfer: (transfer: CryptoTransfer) => void;
}) {
  const [network, setNetwork] = useState<CryptoNetwork>('BSC');
  const [qrCode, setQrCode] = useState('');
  const [copied, setCopied] = useState(false);
  const wallet = wallets.find((row) => row.network === network) || wallets[0];

  useEffect(() => {
    if (!wallet || !customerId) return;
    setQrCode('');
    coreApi<{ dataUrl: string }>(`/crypto-wallets/${wallet.id}/qr?customerId=${customerId}`)
      .then((result) => setQrCode(result.dataUrl))
      .catch(() => setQrCode(''));
  }, [customerId, wallet]);

  const copyAddress = async () => {
    if (!wallet) return;
    await navigator.clipboard?.writeText(wallet.walletAddress);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1600);
  };

  return (
    <>
      <Box
        sx={{
          display: 'grid',
          gridTemplateColumns: { xs: '1fr', lg: 'minmax(0, 2fr) minmax(300px, .9fr)' },
          gap: 2.5,
        }}
      >
        <Card>
          <CardContent sx={{ p: { xs: 2.5, md: 3.5 } }}>
            <Stepper orientation="vertical" activeStep={2}>
              <Step>
                <StepLabel>
                  <Typography variant="subtitle2">选择币种</Typography>
                </StepLabel>
                <Box sx={{ ml: 4.5, mt: 1, mb: 2.5 }}>
                  <TextField
                    fullWidth
                    value="USDT  Tether"
                    InputProps={{
                      readOnly: true,
                      startAdornment: (
                        <Iconify icon="cryptocurrency-color:usdt" width={22} sx={{ mr: 1 }} />
                      ),
                    }}
                  />
                </Box>
              </Step>
              <Step>
                <StepLabel>
                  <Typography variant="subtitle2">选择网络</Typography>
                </StepLabel>
                <Box sx={{ ml: 4.5, mt: 1, mb: 2.5 }}>
                  <FormControl fullWidth>
                    <InputLabel>网络</InputLabel>
                    <Select
                      label="网络"
                      value={wallets.some((row) => row.network === network) ? network : ''}
                      onChange={(event) => setNetwork(event.target.value as CryptoNetwork)}
                    >
                      {wallets.map((row) => {
                        const meta = networkMeta[row.network];
                        return (
                          <MenuItem key={row.id} value={row.network}>
                            {meta.name} ({meta.standard}) · USDT
                          </MenuItem>
                        );
                      })}
                    </Select>
                  </FormControl>
                  {wallet && (
                    <Typography
                      variant="caption"
                      color="text.secondary"
                      sx={{ mt: 1, display: 'block' }}
                    >
                      最少充值 {wallet.minimumDeposit} USDT · {wallet.confirmationsRequired}{' '}
                      次确认到账
                    </Typography>
                  )}
                </Box>
              </Step>
              <Step>
                <StepLabel>
                  <Typography variant="subtitle2">获取收币地址</Typography>
                </StepLabel>
                <Box sx={{ ml: { xs: 0, sm: 4.5 }, mt: 1.5 }}>
                  {wallet ? (
                    <Stack
                      direction={{ xs: 'column', md: 'row' }}
                      spacing={3}
                      alignItems={{ md: 'center' }}
                    >
                      <Box sx={{ flex: 1, width: 1 }}>
                        <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
                          充值地址
                        </Typography>
                        <TextField
                          fullWidth
                          value={wallet.walletAddress}
                          InputProps={{
                            readOnly: true,
                            endAdornment: (
                              <Tooltip title={copied ? '已复制' : '复制地址'}>
                                <IconButton onClick={copyAddress}>
                                  <Iconify icon="solar:copy-linear" />
                                </IconButton>
                              </Tooltip>
                            ),
                          }}
                        />
                        <Alert severity="success" icon={false} sx={{ mt: 1.5 }}>
                          仅支持 USDT 通过 {networkMeta[wallet.network].name}（
                          {wallet.tokenStandard}）网络充值
                        </Alert>
                        <Stack direction="row" spacing={1} alignItems="center" sx={{ mt: 1.5 }}>
                          <Iconify icon="solar:shield-check-bold" color="success.main" />
                          <Typography variant="caption" color="text.secondary">
                            地址已通过本地风控校验；Cregis 接入后启用链上地址托管。
                          </Typography>
                        </Stack>
                      </Box>
                      <Box
                        sx={{
                          width: 190,
                          height: 190,
                          p: 1,
                          border: '1px solid',
                          borderColor: 'divider',
                          borderRadius: 2,
                          display: 'grid',
                          placeItems: 'center',
                          bgcolor: 'common.white',
                        }}
                      >
                        {qrCode ? (
                          <Box
                            component="img"
                            src={qrCode}
                            alt={`${wallet.network} USDT 收币二维码`}
                            sx={{ width: 170, height: 170 }}
                          />
                        ) : (
                          <Skeleton variant="rectangular" width={170} height={170} />
                        )}
                      </Box>
                    </Stack>
                  ) : (
                    <Skeleton height={180} />
                  )}
                </Box>
              </Step>
            </Stepper>
          </CardContent>
        </Card>
        <Card sx={{ alignSelf: 'start' }}>
          <CardContent sx={{ p: 3 }}>
            <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 2 }}>
              <Iconify icon="solar:info-circle-bold" color="info.main" />
              <Typography variant="h6">收币须知</Typography>
            </Stack>
            <Notice number="1" text="币种和网络必须与发送方完全一致，错误网络可能导致资产丢失。" />
            <Notice number="2" text="不要向此地址发送 USDT 以外的资产。" />
            <Notice number="3" text="达到网络确认数后，余额会自动更新。" />
            <Notice
              number="4"
              text="本地阶段地址用于界面和流程验收，真实到账将在接入 Cregis 后启用。"
            />
          </CardContent>
        </Card>
      </Box>
      <TransferList title="近期收币" rows={transfers} loading={loading} onOpen={onOpenTransfer} />
    </>
  );
}

function WithdrawView({
  wallets,
  transfers,
  loading,
  customerId,
  onOpenTransfer,
  onCreated,
}: {
  wallets: CryptoWallet[];
  transfers: CryptoTransfer[];
  loading: boolean;
  customerId: string;
  onOpenTransfer: (transfer: CryptoTransfer) => void;
  onCreated: () => Promise<void>;
}) {
  const [network, setNetwork] = useState<CryptoNetwork>('TRON');
  const [address, setAddress] = useState('');
  const [amount, setAmount] = useState('');
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const wallet = wallets.find((row) => row.network === network) || wallets[0];
  const fee = Number(wallet?.withdrawalFee || 0);
  const net = Math.max(0, Number(amount || 0) - fee);

  const validate = () => {
    if (!wallet) return '请选择可用网络';
    if (!address) return '请输入收币地址';
    const valid =
      network === 'TRON'
        ? /^T[1-9A-HJ-NP-Za-km-z]{33}$/.test(address)
        : /^0x[a-fA-F0-9]{40}$/.test(address);
    if (!valid) return `请输入有效的 ${networkMeta[network].standard} 地址`;
    if (!amount || Number(amount) <= fee) return '付币金额必须大于网络手续费';
    if (Number(amount) > Number(wallet.availableBalance)) return '可用余额不足';
    return '';
  };

  const openConfirmation = (event: FormEvent) => {
    event.preventDefault();
    const message = validate();
    if (message) {
      setError(message);
      return;
    }
    setError('');
    setConfirmOpen(true);
  };

  const submit = async () => {
    if (!wallet) return;
    setSubmitting(true);
    setError('');
    try {
      await coreApi('/crypto-wallets/withdrawals', {
        method: 'POST',
        body: JSON.stringify({
          customerId,
          walletId: wallet.id,
          network: wallet.network,
          amount,
          toAddress: address,
          idempotencyKey: crypto.randomUUID(),
        }),
      });
      setConfirmOpen(false);
      setAmount('');
      setAddress('');
      setSuccess('付币申请已提交，平台双人复核后进入链上执行。');
      await onCreated();
    } catch (value) {
      setError(value instanceof Error ? value.message : '付币提交失败');
      setConfirmOpen(false);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <>
      <Box
        sx={{
          display: 'grid',
          gridTemplateColumns: { xs: '1fr', lg: 'minmax(0, 1.45fr) minmax(300px, .55fr)' },
          gap: 2.5,
        }}
      >
        <Card>
          <CardContent sx={{ p: { xs: 2.5, md: 4 } }}>
            <Box component="form" onSubmit={openConfirmation}>
              <Stack spacing={2.5}>
                {error && (
                  <Alert severity="error" onClose={() => setError('')}>
                    {error}
                  </Alert>
                )}
                {success && (
                  <Alert severity="success" onClose={() => setSuccess('')}>
                    {success}
                  </Alert>
                )}
                <Box>
                  <Typography variant="subtitle2" sx={{ mb: 1 }}>
                    币种
                  </Typography>
                  <TextField
                    fullWidth
                    value="USDT  Tether"
                    InputProps={{
                      readOnly: true,
                      startAdornment: (
                        <Iconify icon="cryptocurrency-color:usdt" width={22} sx={{ mr: 1 }} />
                      ),
                    }}
                  />
                </Box>
                <FormControl fullWidth>
                  <InputLabel>发送网络</InputLabel>
                  <Select
                    label="发送网络"
                    value={wallets.some((row) => row.network === network) ? network : ''}
                    onChange={(event) => setNetwork(event.target.value as CryptoNetwork)}
                  >
                    {wallets.map((row) => (
                      <MenuItem key={row.id} value={row.network}>
                        {networkMeta[row.network].name} ({row.tokenStandard}) · 可用{' '}
                        {formatUsdt(row.availableBalance)}
                      </MenuItem>
                    ))}
                  </Select>
                </FormControl>
                <TextField
                  required
                  label="收币地址"
                  placeholder={network === 'TRON' ? 'T...' : '0x...'}
                  value={address}
                  onChange={(event) => setAddress(event.target.value.trim())}
                  helperText={`只接受 ${networkMeta[network].standard} 地址`}
                />
                <TextField
                  required
                  type="number"
                  label="发送数量（USDT）"
                  value={amount}
                  onChange={(event) => setAmount(event.target.value)}
                  inputProps={{ min: 0, step: 0.000001 }}
                  helperText={wallet ? `可用 ${formatUsdt(wallet.availableBalance)}` : undefined}
                />
                <Card variant="outlined" sx={{ bgcolor: 'grey.50' }}>
                  <CardContent sx={{ p: 2.5 }}>
                    <Stack spacing={1}>
                      <FeeRow label="发送数量" value={formatUsdt(amount || 0)} />
                      <FeeRow label="网络手续费" value={formatUsdt(fee)} />
                      <Divider />
                      <FeeRow label="预计到账" value={formatUsdt(net)} strong />
                    </Stack>
                  </CardContent>
                </Card>
                <Alert severity="warning">
                  链上转账不可撤销。提交后将冻结发送金额，并由另一名人员复核。
                </Alert>
                <Button type="submit" variant="contained" size="large" disabled={!wallet}>
                  核对并提交
                </Button>
              </Stack>
            </Box>
          </CardContent>
        </Card>
        <Card sx={{ alignSelf: 'start' }}>
          <CardContent sx={{ p: 3 }}>
            <Typography variant="h6" sx={{ mb: 2 }}>
              安全提示
            </Typography>
            <Notice number="1" text="确认收币地址支持所选网络。" />
            <Notice number="2" text="首次向新地址付款时，建议先发送小额测试。" />
            <Notice number="3" text="平台不会通过邮件或聊天索取私钥或助记词。" />
            <Divider sx={{ my: 2 }} />
            <Stack direction="row" justifyContent="space-between">
              <Typography color="text.secondary">预计处理</Typography>
              <Typography variant="subtitle2">复核后 5–20 分钟</Typography>
            </Stack>
          </CardContent>
        </Card>
      </Box>
      <TransferList title="近期付币" rows={transfers} loading={loading} onOpen={onOpenTransfer} />
      <Dialog open={confirmOpen} onClose={() => setConfirmOpen(false)} fullWidth maxWidth="sm">
        <DialogTitle>确认付币信息</DialogTitle>
        <DialogContent>
          <Alert severity="warning" sx={{ mb: 2 }}>
            请最后确认网络和地址。链上执行后无法撤销。
          </Alert>
          <Stack divider={<Divider flexItem />}>
            <DetailRow
              label="网络"
              value={`${networkMeta[network].name} (${networkMeta[network].standard})`}
            />
            <DetailRow label="发送数量" value={formatUsdt(amount || 0)} />
            <DetailRow label="手续费" value={formatUsdt(fee)} />
            <DetailRow label="预计到账" value={formatUsdt(net)} />
            <DetailRow label="收币地址" value={address} mono />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setConfirmOpen(false)}>返回修改</Button>
          <Button
            variant="contained"
            color="warning"
            disabled={submitting}
            onClick={() => submit().catch(() => undefined)}
          >
            {submitting ? '提交中…' : '确认提交'}
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
}

function TransferList({
  title,
  rows,
  loading,
  onOpen,
}: {
  title: string;
  rows: CryptoTransfer[];
  loading: boolean;
  onOpen: (transfer: CryptoTransfer) => void;
}) {
  return (
    <Card>
      <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ p: 2.5 }}>
        <Box>
          <Typography variant="h6">{title}</Typography>
          <Typography variant="body2" color="text.secondary">
            所有网络统一展示，点击记录查看详情。
          </Typography>
        </Box>
        <Button endIcon={<Iconify icon="eva:arrow-ios-forward-fill" />}>全部记录</Button>
      </Stack>
      <TableContainer>
        <Table>
          <TableHead>
            <TableRow>
              <TableCell>订单号</TableCell>
              <TableCell>状态</TableCell>
              <TableCell>方向</TableCell>
              <TableCell>链 / 网络</TableCell>
              <TableCell align="right">链上金额</TableCell>
              <TableCell align="right">到账金额</TableCell>
              <TableCell>TXID</TableCell>
              <TableCell>创建时间</TableCell>
              <TableCell align="right">操作</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {rows.map((row) => (
              <TableRow key={row.id} hover>
                <TableCell>
                  <Typography variant="body2" sx={{ fontFamily: 'monospace' }}>
                    {row.reference}
                  </Typography>
                </TableCell>
                <TableCell>
                  <CryptoStatus status={row.status} />
                </TableCell>
                <TableCell>{row.direction === 'DEPOSIT' ? '收币' : '付币'}</TableCell>
                <TableCell>
                  <Stack direction="row" spacing={1} alignItems="center">
                    <Iconify icon={networkMeta[row.network].icon} width={20} />
                    <Typography variant="body2">
                      {networkMeta[row.network].name} ({networkMeta[row.network].standard})
                    </Typography>
                  </Stack>
                </TableCell>
                <TableCell align="right">{formatUsdt(row.amount)}</TableCell>
                <TableCell align="right">{formatUsdt(row.netAmount)}</TableCell>
                <TableCell>
                  <Typography variant="body2" sx={{ fontFamily: 'monospace' }}>
                    {shorten(row.txHash || '待生成', 7, 5)}
                  </Typography>
                </TableCell>
                <TableCell>{new Date(row.createdAt).toLocaleString('zh-CN')}</TableCell>
                <TableCell align="right">
                  <Button size="small" onClick={() => onOpen(row)}>
                    详情
                  </Button>
                </TableCell>
              </TableRow>
            ))}
            {!rows.length && (
              <TableRow>
                <TableCell colSpan={9} align="center" sx={{ py: 7 }}>
                  {loading ? '加载中…' : '暂无链上记录'}
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </TableContainer>
    </Card>
  );
}

function TransferDrawer({
  transfer,
  onClose,
}: {
  transfer: CryptoTransfer | null;
  onClose: () => void;
}) {
  return (
    <Drawer
      anchor="right"
      open={Boolean(transfer)}
      onClose={onClose}
      PaperProps={{ sx: { width: { xs: 1, sm: 480 }, p: 3 } }}
    >
      {transfer && (
        <Stack spacing={3}>
          <Stack direction="row" justifyContent="space-between" alignItems="center">
            <Box>
              <Typography variant="h5">链上交易详情</Typography>
              <Typography color="text.secondary">{transfer.reference}</Typography>
            </Box>
            <IconButton onClick={onClose}>
              <Iconify icon="mingcute:close-line" />
            </IconButton>
          </Stack>
          <Stack alignItems="center" spacing={1.5} sx={{ py: 2 }}>
            <Box
              sx={{
                width: 64,
                height: 64,
                borderRadius: '50%',
                bgcolor: networkMeta[transfer.network].soft,
                display: 'grid',
                placeItems: 'center',
              }}
            >
              <Iconify icon={networkMeta[transfer.network].icon} width={34} />
            </Box>
            <Typography variant="h4">{formatUsdt(transfer.netAmount)}</Typography>
            <CryptoStatus status={transfer.status} />
          </Stack>
          <Card variant="outlined">
            <CardContent>
              <Stack divider={<Divider flexItem />}>
                <DetailRow
                  label="类型"
                  value={transfer.direction === 'DEPOSIT' ? '收币' : '付币'}
                />
                <DetailRow
                  label="网络"
                  value={`${networkMeta[transfer.network].name} (${
                    networkMeta[transfer.network].standard
                  })`}
                />
                <DetailRow label="链上金额" value={formatUsdt(transfer.amount)} />
                <DetailRow label="手续费" value={formatUsdt(transfer.feeAmount)} />
                <DetailRow label="源地址" value={shorten(transfer.fromAddress, 10, 8)} mono />
                <DetailRow label="目标地址" value={shorten(transfer.toAddress, 10, 8)} mono />
                <DetailRow
                  label="TXID"
                  value={transfer.txHash ? shorten(transfer.txHash, 10, 8) : '复核后生成'}
                  mono
                />
                <DetailRow label="网络确认" value={`${transfer.confirmations} 次`} />
                <DetailRow
                  label="创建时间"
                  value={new Date(transfer.createdAt).toLocaleString('zh-CN')}
                />
              </Stack>
            </CardContent>
          </Card>
          {transfer.status === 'SUBMITTED' && (
            <Alert severity="info">指令正在等待另一名人员复核，复核前资金处于冻结状态。</Alert>
          )}
          {transfer.rejectionReason && <Alert severity="error">{transfer.rejectionReason}</Alert>}
        </Stack>
      )}
    </Drawer>
  );
}

function CryptoStatus({ status }: { status: CryptoTransfer['status'] }) {
  const labels = {
    SUBMITTED: '待复核',
    PROCESSING: '链上处理中',
    COMPLETED: '成功',
    REJECTED: '已拒绝',
    FAILED: '失败',
  };
  let color: 'default' | 'warning' | 'info' | 'success' | 'error' = 'default';
  if (status === 'SUBMITTED') color = 'warning';
  if (status === 'PROCESSING') color = 'info';
  if (status === 'COMPLETED') color = 'success';
  if (status === 'REJECTED' || status === 'FAILED') color = 'error';
  return <Label color={color}>{labels[status]}</Label>;
}

function Notice({ number, text }: { number: string; text: string }) {
  return (
    <Stack direction="row" spacing={1.25} sx={{ mb: 1.5 }}>
      <Box
        sx={{
          flex: '0 0 auto',
          width: 22,
          height: 22,
          borderRadius: '50%',
          bgcolor: 'grey.100',
          display: 'grid',
          placeItems: 'center',
        }}
      >
        <Typography variant="caption" sx={{ fontWeight: 700 }}>
          {number}
        </Typography>
      </Box>
      <Typography variant="body2" color="text.secondary">
        {text}
      </Typography>
    </Stack>
  );
}
function FeeRow({
  label,
  value,
  strong = false,
}: {
  label: string;
  value: string;
  strong?: boolean;
}) {
  return (
    <Stack direction="row" justifyContent="space-between">
      <Typography color="text.secondary">{label}</Typography>
      <Typography variant={strong ? 'h6' : 'subtitle2'}>{value}</Typography>
    </Stack>
  );
}
function DetailRow({
  label,
  value,
  mono = false,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <Stack direction="row" justifyContent="space-between" spacing={2} sx={{ py: 1.5 }}>
      <Typography color="text.secondary">{label}</Typography>
      <Typography
        variant="subtitle2"
        sx={{
          textAlign: 'right',
          fontFamily: mono ? 'monospace' : undefined,
          wordBreak: 'break-all',
        }}
      >
        {value}
      </Typography>
    </Stack>
  );
}
function formatUsdt(value: string | number) {
  return `${Number(value).toLocaleString('zh-CN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 6,
  })} USDT`;
}
function shorten(value: string, start: number, end: number) {
  if (value.length <= start + end + 3) return value;
  return `${value.slice(0, start)}…${value.slice(-end)}`;
}
