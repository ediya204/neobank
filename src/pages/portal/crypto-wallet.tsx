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
import { NETWORK_META, USDT_ASSET_ICON } from 'src/utils/asset-icons';
import { UI_ICONS } from 'src/theme/iconography';
import Label from 'src/components/label';
import { useAuthContext } from 'src/auth/hooks';
import { usePortalCustomer } from 'src/features/finance/portal-customer-context';
import {
  Beneficiary,
  coreApi,
  CryptoNetwork,
  CryptoTransfer,
  CryptoWallet,
  customerAuthApi,
  neobankApi,
  supportedCryptoNetwork,
} from 'src/features/finance/core-api';
import {
  cryptoWalletStatusDetails,
  isWithdrawalReady,
  normalizeCryptoWalletStatus,
} from 'src/features/finance/crypto-wallet-status';
import { createDepositQrCode } from 'src/features/finance/deposit-qr';
import { CustomerWalletRow, toCustomerCryptoWallet } from 'src/features/finance/customer-wallet';
import { portalLocale, portalText } from 'src/locales/portal-text';
import { APP_DISPLAY_NAME } from 'src/config-global';

export type CryptoWalletView = 'overview' | 'deposit' | 'withdraw';

type CustomerHistoryRow = {
  id: string;
  customer_id: string;
  wallet_id: string;
  direction: 'deposit' | 'withdrawal';
  amount: string;
  fee_amount?: string;
  net_amount?: string;
  status: string;
  address: string;
  from_address?: string | null;
  txid?: string;
  created_at: string;
};

type CustomerHistory = {
  withdrawals: CustomerHistoryRow[];
  deposits: CustomerHistoryRow[];
};

type CustomerWithdrawalAddressRow = {
  id: string;
  label: string;
  currency: string;
  network: 'TRON';
  address: string;
  status: 'active' | 'revoked' | 'suspended';
  verified_at: string;
  revoked_at?: string | null;
};

function isDepositReady(wallet: CryptoWallet | undefined): wallet is CryptoWallet {
  return Boolean(
    wallet?.status === 'ACTIVE' &&
      wallet.depositEnabled &&
      wallet.custodyProvider === 'CREGIS' &&
      wallet.ownershipVerifiedAt &&
      wallet.walletAddress
  );
}

function normalizeCustomerTransferStatus(status: string): CryptoTransfer['status'] {
  if (status === 'completed') return 'COMPLETED';
  if (status === 'submitted') return 'SUBMITTED';
  if (status === 'rejected') return 'REJECTED';
  if (status === 'exception') return 'PROCESSING';
  if (['failed', 'cancelled'].includes(status)) return 'FAILED';
  return 'PROCESSING';
}

function toCustomerTransfer(
  row: CustomerHistoryRow,
  wallet: CryptoWallet
): CryptoTransfer & { rawStatus?: string } {
  const status = normalizeCustomerTransferStatus(row.status);
  const deposit = row.direction === 'deposit';
  return {
    id: row.id,
    reference: row.id,
    customerId: row.customer_id,
    walletId: row.wallet_id,
    asset: 'USDT',
    network: 'TRON',
    direction: deposit ? 'DEPOSIT' : 'WITHDRAWAL',
    status,
    rawStatus: row.status,
    amount: row.amount,
    feeAmount: deposit ? '0' : row.fee_amount || '0',
    netAmount: deposit ? row.amount : row.net_amount || row.amount,
    fromAddress: deposit ? row.from_address || '' : wallet.walletAddress,
    toAddress: deposit ? row.address : row.address,
    txHash: row.txid,
    confirmations: status === 'COMPLETED' ? 20 : 0,
    submittedAt: row.created_at,
    completedAt: status === 'COMPLETED' ? row.created_at : undefined,
    createdAt: row.created_at,
    wallet,
  };
}

function rawCregisStatus(transfer: CryptoTransfer) {
  return (transfer as CryptoTransfer & { rawStatus?: string }).rawStatus;
}

function renderDepositQrCode(wallet: CryptoWallet, qrCode: string | null) {
  if (qrCode) {
    return (
      <Box
        component="img"
        src={qrCode}
        alt={portalText('{{value0}} USDT 转入地址二维码', {
          value0: wallet.network,
        })}
        sx={{ width: 170, height: 170, imageRendering: 'crisp-edges' }}
      />
    );
  }
  if (qrCode === '') {
    return (
      <Typography variant="caption" color="text.secondary" align="center" sx={{ px: 2 }}>
        {portalText('暂时无法生成二维码，请复制并逐字核对上方 TRC20 地址。')}
      </Typography>
    );
  }
  return <Skeleton variant="rectangular" width={170} height={170} />;
}

const networkMeta: Record<
  CryptoNetwork,
  { name: string; standard: string; icon: string; color: string; soft: string }
> = NETWORK_META;

export default function CryptoWalletPage({ view = 'overview' }: { view?: CryptoWalletView }) {
  const navigate = useNavigate();
  const { user } = useAuthContext();
  const { customer } = usePortalCustomer();
  const [wallets, setWallets] = useState<CryptoWallet[]>([]);
  const [transfers, setTransfers] = useState<CryptoTransfer[]>([]);
  const [beneficiaries, setBeneficiaries] = useState<Beneficiary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [selectedTransfer, setSelectedTransfer] = useState<CryptoTransfer | null>(null);

  const load = useCallback(async () => {
    if (!customer) return;
    setLoading(true);
    setError('');
    try {
      if (user?.role === 'customer') {
        const [walletPayload, history, addressPayload] = await Promise.all([
          neobankApi<{ data: CustomerWalletRow[] }>('/customer/wallets'),
          neobankApi<CustomerHistory>('/customer/history'),
          neobankApi<{ data: CustomerWithdrawalAddressRow[] }>('/customer/withdrawal-addresses'),
        ]);
        const customerWallets = walletPayload.data.map(toCustomerCryptoWallet);
        const walletById = new Map(customerWallets.map((row) => [row.id, row]));
        const customerTransfers = [...history.withdrawals, ...history.deposits]
          .map((row) => {
            const wallet = walletById.get(row.wallet_id);
            return wallet ? toCustomerTransfer(row, wallet) : null;
          })
          .filter((row): row is CryptoTransfer => Boolean(row))
          .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
        setWallets(customerWallets);
        setTransfers(customerTransfers);
        setBeneficiaries(
          addressPayload.data.map((row) => ({
            id: row.id,
            customerId: customer.id,
            type: 'CRYPTO',
            name: row.label,
            currency: 'USDT',
            walletAddress: row.address,
            network: row.network,
            active: row.status === 'active',
            status: row.status.toUpperCase() as Beneficiary['status'],
            verifiedAt: row.verified_at,
            revokedAt: row.revoked_at || undefined,
          }))
        );
        return;
      }
      const [walletRows, transferRows, customerDetail] = await Promise.all([
        coreApi<CryptoWallet[]>(`/crypto-wallets?customerId=${customer.id}`),
        coreApi<CryptoTransfer[]>(`/crypto-wallets/transfers?customerId=${customer.id}`),
        coreApi<{ beneficiaries?: Beneficiary[] }>(`/customers/${customer.id}`),
      ]);
      setWallets(
        walletRows
          .filter((row) => row.network === supportedCryptoNetwork)
          .map((row) => ({ ...row, status: normalizeCryptoWalletStatus(row.status) }))
      );
      setTransfers(transferRows.filter((row) => row.network === supportedCryptoNetwork));
      setBeneficiaries(
        (customerDetail.beneficiaries || []).filter(
          (row) =>
            row.active &&
            row.type === 'CRYPTO' &&
            row.currency === 'USDT' &&
            row.network === supportedCryptoNetwork
        )
      );
    } catch (value) {
      setError(
        value instanceof Error ? value.message : portalText('暂时无法读取 USDT 账户，请稍后重试。')
      );
    } finally {
      setLoading(false);
    }
  }, [customer, user?.role]);

  useEffect(() => {
    load().catch(() => undefined);
  }, [load]);

  let title = portalText('USDT 账户');
  if (view === 'deposit') title = portalText('USDT 转入');
  if (view === 'withdraw') title = portalText('USDT 转出');
  const hasActiveWallet = wallets.some(isWithdrawalReady);

  useEffect(() => {
    if (view === 'withdraw' && !loading && !hasActiveWallet) {
      navigate('/portal/home', { replace: true });
    }
  }, [hasActiveWallet, loading, navigate, view]);

  return (
    <>
      <Helmet>
        <title>{title} | {APP_DISPLAY_NAME}</title>
      </Helmet>
      <Container maxWidth="xl">
        <Stack spacing={3}>
          <Stack direction={{ xs: 'column', md: 'row' }} justifyContent="space-between" gap={2}>
            <Box>
              <Stack direction="row" alignItems="center" spacing={1.25}>
                {view !== 'overview' && (
                  <IconButton
                    onClick={() => navigate('/portal/home')}
                    aria-label={portalText('返回账户概览')}
                  >
                    <Iconify icon="solar:alt-arrow-left-linear" />
                  </IconButton>
                )}
                <Box>
                  <Typography variant="h4">{title}</Typography>
                  <Typography color="text.secondary" sx={{ mt: 0.5 }}>
                    {view === 'overview' && portalText('查看 TRON（TRC20）网络的余额及链上交易。')}
                    {view === 'deposit' && portalText('向本账户的 TRON（TRC20）地址转入 USDT。')}
                    {view === 'withdraw' && portalText('向已验证的 TRON（TRC20）地址转出 USDT。')}
                  </Typography>
                </Box>
              </Stack>
            </Box>
            <Stack direction="row" spacing={1}>
              <Button
                variant={view === 'deposit' ? 'contained' : 'outlined'}
                startIcon={<Iconify icon="solar:download-minimalistic-bold-duotone" />}
                onClick={() => navigate('/portal/crypto-wallet/deposit')}
              >
                {portalText('转入')}
              </Button>
              <Button
                variant={view === 'withdraw' ? 'contained' : 'outlined'}
                startIcon={<Iconify icon="solar:upload-minimalistic-bold-duotone" />}
                disabled={loading || !hasActiveWallet}
                onClick={() => navigate('/portal/crypto-wallet/withdraw')}
              >
                {portalText('转出')}
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
              customerSession={user?.role === 'customer'}
              totpEnabled={Boolean(user?.totpEnabled)}
              beneficiaries={beneficiaries}
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
  const canWithdraw = wallets.some(isWithdrawalReady);
  return (
    <>
      <Card sx={{ bgcolor: '#102C27', color: 'common.white' }}>
        <CardContent sx={{ p: { xs: 3, md: 4 } }}>
          <Stack direction={{ xs: 'column', md: 'row' }} justifyContent="space-between" gap={3}>
            <Box>
              <Stack direction="row" alignItems="center" spacing={1}>
                <Iconify icon={USDT_ASSET_ICON} width={30} />
                <Typography sx={{ opacity: 0.72 }}>{portalText('USDT 账户总余额')}</Typography>
              </Stack>
              {loading ? (
                <Skeleton width={260} height={70} />
              ) : (
                <Typography variant="h2" sx={{ mt: 1, letterSpacing: '-0.04em' }}>
                  {formatUsdt(total)}
                </Typography>
              )}
              <Typography variant="body2" sx={{ mt: 1, opacity: 0.62 }}>
                {portalText('冻结余额')}
                {formatUsdt(frozen)} · TRON（TRC20）
              </Typography>
            </Box>
            <Stack direction="row" spacing={1.5} alignItems="center">
              <Button
                variant="contained"
                color="inherit"
                startIcon={<Iconify icon="solar:download-minimalistic-bold-duotone" />}
                onClick={() => navigate('/portal/crypto-wallet/deposit')}
                sx={{
                  color: '#102C27',
                  bgcolor: 'common.white',
                  '&:hover': { bgcolor: 'grey.200' },
                }}
              >
                {portalText('转入')}
              </Button>
              <Button
                variant="outlined"
                startIcon={<Iconify icon="solar:upload-minimalistic-bold-duotone" />}
                disabled={loading || !canWithdraw}
                onClick={() => navigate('/portal/crypto-wallet/withdraw')}
                sx={{ color: 'common.white', borderColor: 'rgba(255,255,255,.38)' }}
              >
                {portalText('转出')}
              </Button>
            </Stack>
          </Stack>
        </CardContent>
      </Card>

      <Box>
        <Typography variant="h5" sx={{ mb: 2 }}>
          {portalText('网络余额')}
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
        title={portalText('近期链上交易')}
        rows={transfers.slice(0, 8)}
        loading={loading}
        onOpen={onOpenTransfer}
      />
    </>
  );
}

function NetworkWalletCard({ wallet }: { wallet: CryptoWallet }) {
  const meta = networkMeta[wallet.network];
  const status = cryptoWalletStatusDetails(wallet.status);
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
          <Chip size="small" label={status.label} color={status.color} variant="soft" />
        </Stack>
        <Typography variant="h4" sx={{ mt: 3 }}>
          {formatUsdt(wallet.availableBalance)}
        </Typography>
        <Typography variant="caption" color="text.secondary">
          {portalText('可用余额')}
        </Typography>
        <Divider sx={{ my: 2 }} />
        <Stack direction="row" justifyContent="space-between">
          <Typography variant="body2" color="text.secondary">
            {portalText('网络手续费')}
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
  onOpenTransfer,
}: {
  wallets: CryptoWallet[];
  transfers: CryptoTransfer[];
  loading: boolean;
  onOpenTransfer: (transfer: CryptoTransfer) => void;
}) {
  const [network, setNetwork] = useState<CryptoNetwork>('TRON');
  const [qrCode, setQrCode] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const depositWallets = wallets.filter((row) => isDepositReady(row));
  const wallet = depositWallets.find((row) => row.network === network) || depositWallets[0];
  const depositWalletIds = new Set(depositWallets.map((row) => row.id));
  const visibleTransfers = transfers.filter((row) => depositWalletIds.has(row.walletId));

  useEffect(() => {
    let active = true;
    setQrCode(null);
    if (!isDepositReady(wallet)) return () => undefined;

    createDepositQrCode(wallet.walletAddress)
      .then((result) => {
        if (active) setQrCode(result);
      })
      .catch(() => {
        if (active) setQrCode('');
      });

    return () => {
      active = false;
    };
  }, [wallet]);

  const copyAddress = async () => {
    if (!isDepositReady(wallet)) return;
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
            <Stepper orientation="vertical" activeStep={wallet ? 2 : 1}>
              <Step>
                <StepLabel>
                  <Typography variant="subtitle2">{portalText('选择币种')}</Typography>
                </StepLabel>
                <Box sx={{ ml: 4.5, mt: 1, mb: 2.5 }}>
                  <TextField
                    fullWidth
                    value="USDT  Tether"
                    InputProps={{
                      readOnly: true,
                      startAdornment: <Iconify icon={USDT_ASSET_ICON} width={22} sx={{ mr: 1 }} />,
                    }}
                  />
                </Box>
              </Step>
              <Step>
                <StepLabel>
                  <Typography variant="subtitle2">{portalText('选择网络')}</Typography>
                </StepLabel>
                <Box sx={{ ml: 4.5, mt: 1, mb: 2.5 }}>
                  <FormControl fullWidth>
                    <InputLabel>{portalText('网络')}</InputLabel>
                    <Select
                      label={portalText('网络')}
                      value={depositWallets.some((row) => row.network === network) ? network : ''}
                      onChange={(event) => setNetwork(event.target.value as CryptoNetwork)}
                    >
                      {depositWallets.map((row) => {
                        const meta = networkMeta[row.network];
                        return (
                          <MenuItem key={row.id} value={row.network}>
                            {meta.name} ({meta.standard}) · USDT
                          </MenuItem>
                        );
                      })}
                    </Select>
                  </FormControl>
                  {wallet ? (
                    <Typography
                      variant="caption"
                      color="text.secondary"
                      sx={{ mt: 1, display: 'block' }}
                    >
                      {portalText('最低转入 {{amount}} USDT · 达到 {{confirmations}} 次网络确认后入账', {
                        amount: wallet.minimumDeposit,
                        confirmations: wallet.confirmationsRequired,
                      })}
                    </Typography>
                  ) : (
                    <Alert severity="warning" sx={{ mt: 1.5 }}>
                      {portalText(
                        '转入服务暂不可用。托管服务完成地址分配及账户归属验证后，系统才会显示转入地址和二维码。'
                      )}
                    </Alert>
                  )}
                </Box>
              </Step>
              <Step>
                <StepLabel>
                  <Typography variant="subtitle2">{portalText('获取转入地址')}</Typography>
                </StepLabel>
                <Box sx={{ ml: { xs: 0, sm: 4.5 }, mt: 1.5 }}>
                  {isDepositReady(wallet) && (
                    <Stack
                      direction={{ xs: 'column', md: 'row' }}
                      spacing={3}
                      alignItems={{ md: 'center' }}
                    >
                      <Box sx={{ flex: 1, width: 1 }}>
                        <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
                          {portalText('转入地址')}
                        </Typography>
                        <TextField
                          fullWidth
                          value={wallet.walletAddress}
                          InputProps={{
                            readOnly: true,
                            endAdornment: (
                              <Tooltip
                                title={copied ? portalText('已复制') : portalText('复制地址')}
                              >
                                <IconButton onClick={copyAddress}>
                                  <Iconify icon="solar:copy-linear" />
                                </IconButton>
                              </Tooltip>
                            ),
                          }}
                        />

                        <Alert severity="success" icon={false} sx={{ mt: 1.5 }}>
                          {portalText('仅支持通过 {{network}}（{{standard}}）网络转入 USDT', {
                            network: networkMeta[wallet.network].name,
                            standard: wallet.tokenStandard,
                          })}
                        </Alert>
                        <Stack direction="row" spacing={1} alignItems="center" sx={{ mt: 1.5 }}>
                          <Iconify icon="solar:shield-check-bold" color="success.main" />
                          <Typography variant="caption" color="text.secondary">
                            {portalText(
                              '托管服务已验证该地址属于本账户；转账前请逐字核对网络与地址。'
                            )}
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
                        {renderDepositQrCode(wallet, qrCode)}
                      </Box>
                    </Stack>
                  )}
                  {!isDepositReady(wallet) && loading && <Skeleton height={180} />}
                  {!isDepositReady(wallet) && !loading && (
                    <Alert severity="info" icon={<Iconify icon="solar:shield-warning-bold" />}>
                      {portalText(
                        '当前暂无通过账户归属验证的转入地址。地址复制及二维码功能暂不可用。'
                      )}
                    </Alert>
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
              <Typography variant="h6">{portalText('转入须知')}</Typography>
            </Stack>
            <Notice
              number="1"
              text={portalText(
                '币种与网络必须和发送方设置完全一致，使用错误网络可能导致资产永久丢失。'
              )}
            />

            <Notice number="2" text={portalText('不要向此地址发送 USDT 以外的资产。')} />

            <Notice
              number="3"
              text={portalText('达到所需网络确认数后，转入金额将自动计入账户。')}
            />

            <Notice
              number="4"
              text={portalText('只有完成托管分配及账户归属验证的地址，才可用于转入。')}
            />
          </CardContent>
        </Card>
      </Box>
      <TransferList
        title={portalText('近期转入')}
        rows={visibleTransfers}
        loading={loading}
        onOpen={onOpenTransfer}
      />
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
  customerSession,
  totpEnabled,
  beneficiaries,
}: {
  wallets: CryptoWallet[];
  transfers: CryptoTransfer[];
  loading: boolean;
  customerId: string;
  onOpenTransfer: (transfer: CryptoTransfer) => void;
  onCreated: () => Promise<void>;
  customerSession: boolean;
  totpEnabled: boolean;
  beneficiaries: Beneficiary[];
}) {
  const navigate = useNavigate();
  const [network, setNetwork] = useState<CryptoNetwork>('TRON');
  const [beneficiaryId, setBeneficiaryId] = useState('');
  const [amount, setAmount] = useState('');
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [addressDialogOpen, setAddressDialogOpen] = useState(false);
  const [addressLabel, setAddressLabel] = useState('');
  const [newAddress, setNewAddress] = useState('');
  const [otpCode, setOtpCode] = useState('');
  const [addingAddress, setAddingAddress] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const withdrawalWallets = wallets.filter(isWithdrawalReady);
  const wallet = withdrawalWallets.find((row) => row.network === network) || withdrawalWallets[0];
  const savedBeneficiaries = beneficiaries.filter(
    (row) => row.network === network && row.active && row.status !== 'REVOKED'
  );
  const selectedBeneficiary = savedBeneficiaries.find((row) => row.id === beneficiaryId);
  const address = selectedBeneficiary?.walletAddress || '';
  const fee = Number(wallet?.withdrawalFee || 0);
  const net = Math.max(0, Number(amount || 0) - fee);

  const validate = () => {
    if (!isWithdrawalReady(wallet)) return portalText('当前没有可用于转出的 USDT 账户');
    if (!selectedBeneficiary || !address) return portalText('请选择已通过两步验证的白名单地址');
    if (!amount || Number(amount) <= fee) return portalText('转出数量必须大于网络手续费');
    if (Number(amount) > Number(wallet.availableBalance)) return portalText('可用余额不足');
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
    if (!isWithdrawalReady(wallet)) {
      setError(portalText('当前没有可用于转出的 USDT 账户。'));
      setConfirmOpen(false);
      return;
    }
    if (!selectedBeneficiary?.walletAddress) {
      setError(portalText('请选择已通过两步验证的白名单地址。'));
      setConfirmOpen(false);
      return;
    }
    setSubmitting(true);
    setError('');
    try {
      const payload = customerSession
        ? {
            wallet_id: wallet.id,
            withdrawal_address_id: selectedBeneficiary.id,
            currency: '195@TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t',
            amount,
            expected_fee_amount: wallet.withdrawalFee,
            expected_fee_rule_version: wallet.withdrawalFeeRuleVersion,
            idempotency_key: crypto.randomUUID(),
          }
        : {
            customerId,
            walletId: wallet.id,
            network: wallet.network,
            amount,
            expectedFeeAmount: wallet.withdrawalFee,
            expectedFeeRuleVersion: wallet.withdrawalFeeRuleVersion,
            toAddress: address,
            beneficiaryId: selectedBeneficiary.id,
            idempotencyKey: crypto.randomUUID(),
          };
      if (customerSession) {
        await neobankApi('/customer/withdrawals', {
          method: 'POST',
          body: JSON.stringify(payload),
        });
      } else {
        await coreApi('/crypto-wallets/withdrawals', {
          method: 'POST',
          body: JSON.stringify(payload),
        });
      }
      setConfirmOpen(false);
      setAmount('');
      setBeneficiaryId('');
      setSuccess(
        portalText('USDT 转出申请已提交。审核通过后将执行链上转账，您可在交易明细中查看进度。')
      );
      await onCreated();
    } catch (value) {
      setError(
        value instanceof Error
          ? value.message
          : portalText('USDT 转出申请暂时无法提交，请稍后重试。')
      );
      setConfirmOpen(false);
    } finally {
      setSubmitting(false);
    }
  };

  const closeAddressDialog = () => {
    if (addingAddress) return;
    setAddressDialogOpen(false);
    setAddressLabel('');
    setNewAddress('');
    setOtpCode('');
  };

  const addWithdrawalAddress = async (event: FormEvent) => {
    event.preventDefault();
    const label = addressLabel.trim();
    const destination = newAddress.trim();
    if (!label) {
      setError(portalText('请输入地址名称'));
      return;
    }
    if (!/^T[1-9A-HJ-NP-Za-km-z]{33}$/.test(destination)) {
      setError(portalText('请输入有效的 TRON（TRC20）地址'));
      return;
    }
    if (!/^\d{6}$/.test(otpCode)) {
      setError(portalText('请输入验证器当前显示的 6 位动态码。'));
      return;
    }
    setAddingAddress(true);
    setError('');
    try {
      const stepUp = await customerAuthApi<{ step_up_token: string }>('/step-up/totp', {
        method: 'POST',
        body: JSON.stringify({
          purpose: 'add_withdrawal_address',
          otp_code: otpCode,
        }),
      });
      const created = await neobankApi<CustomerWithdrawalAddressRow>(
        '/customer/withdrawal-addresses',
        {
          method: 'POST',
          body: JSON.stringify({
            label,
            address: destination,
            step_up_token: stepUp.step_up_token,
            idempotency_key: crypto.randomUUID(),
          }),
        }
      );
      await onCreated();
      setBeneficiaryId(created.id);
      setSuccess(
        portalText('白名单地址“{{value0}}”已通过两步验证并生效。', { value0: created.label })
      );
      setAddressDialogOpen(false);
      setAddressLabel('');
      setNewAddress('');
      setOtpCode('');
    } catch (value) {
      const message =
        value instanceof Error ? value.message : portalText('暂时无法添加白名单地址，请稍后重试。');
      if (message === 'invalid_totp_code') {
        setError(portalText('动态码无效、已过期或已使用，请输入验证器当前显示的动态码。'));
      } else if (message === 'totp_not_enrolled') {
        setError(portalText('当前账户尚未绑定验证器，无法添加白名单地址'));
      } else if (message === 'withdrawal_address_already_exists') {
        setError(portalText('该地址已经在白名单中'));
      } else {
        setError(message);
      }
    } finally {
      setAddingAddress(false);
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
                {!loading && !withdrawalWallets.length && (
                  <Alert severity="warning">
                    {portalText(
                      'USDT 转出暂不可用。只有状态正常的账户可以提交申请；创建中、异常、冻结或已关闭的账户均不可转出。'
                    )}
                  </Alert>
                )}
                <Box>
                  <Typography variant="subtitle2" sx={{ mb: 1 }}>
                    {portalText('币种')}
                  </Typography>
                  <TextField
                    fullWidth
                    value="USDT  Tether"
                    InputProps={{
                      readOnly: true,
                      startAdornment: <Iconify icon={USDT_ASSET_ICON} width={22} sx={{ mr: 1 }} />,
                    }}
                  />
                </Box>
                <FormControl fullWidth disabled={!withdrawalWallets.length}>
                  <InputLabel>{portalText('发送网络')}</InputLabel>
                  <Select
                    label={portalText('发送网络')}
                    value={withdrawalWallets.some((row) => row.network === network) ? network : ''}
                    onChange={(event) => {
                      setNetwork(event.target.value as CryptoNetwork);
                      setBeneficiaryId('');
                    }}
                  >
                    {withdrawalWallets.map((row) => (
                      <MenuItem key={row.id} value={row.network}>
                        {networkMeta[row.network].name} ({row.tokenStandard}
                        {portalText(') · 可用')} {formatUsdt(row.availableBalance)}
                      </MenuItem>
                    ))}
                  </Select>
                </FormControl>
                <FormControl fullWidth disabled={!wallet || !savedBeneficiaries.length}>
                  <InputLabel>{portalText('白名单地址')}</InputLabel>
                  <Select
                    required
                    label={portalText('白名单地址')}
                    value={beneficiaryId}
                    onChange={(event) => setBeneficiaryId(event.target.value)}
                    renderValue={(selected) => {
                      const beneficiary = savedBeneficiaries.find((row) => row.id === selected);
                      return beneficiary
                        ? `${beneficiary.name} · ${beneficiary.walletAddress?.slice(
                            0,
                            7
                          )}…${beneficiary.walletAddress?.slice(-6)}`
                        : '';
                    }}
                  >
                    {savedBeneficiaries.map((row) => (
                      <MenuItem key={row.id} value={row.id}>
                        <Stack direction="row" spacing={1.25} alignItems="center" sx={{ width: 1 }}>
                          <Iconify icon="solar:shield-check-bold" color="success.main" width={20} />
                          <Box sx={{ minWidth: 0, flex: 1 }}>
                            <Typography variant="subtitle2" noWrap>
                              {row.name}
                            </Typography>
                            <Typography
                              variant="caption"
                              color="text.secondary"
                              sx={{ fontFamily: 'monospace' }}
                            >
                              {row.walletAddress?.slice(0, 9)}…{row.walletAddress?.slice(-8)}
                            </Typography>
                          </Box>
                          <Chip
                            label={portalText('已验证')}
                            color="success"
                            size="small"
                            variant="outlined"
                          />
                        </Stack>
                      </MenuItem>
                    ))}
                  </Select>
                  <Typography variant="caption" color="text.secondary" sx={{ mt: 0.75 }}>
                    {portalText('USDT 只能转出至已通过两步验证的 {{standard}} 白名单地址。', {
                      standard: networkMeta[network].standard,
                    })}
                  </Typography>
                </FormControl>
                <Button
                  size="small"
                  startIcon={<Iconify icon={UI_ICONS.add} />}
                  onClick={() => {
                    if (customerSession) {
                      setError('');
                      setAddressDialogOpen(true);
                      return;
                    }
                    navigate('/portal/settings/allowlist');
                  }}
                  disabled={!wallet}
                  sx={{ mt: -1, alignSelf: 'flex-start', px: 0 }}
                >
                  {portalText('添加白名单地址')}
                </Button>
                {selectedBeneficiary?.walletAddress && (
                  <Card variant="outlined" sx={{ bgcolor: 'background.neutral' }}>
                    <CardContent sx={{ p: 2 }}>
                      <Stack direction="row" spacing={1.25} alignItems="flex-start">
                        <Iconify icon="solar:verified-check-bold" color="success.main" width={22} />
                        <Box sx={{ minWidth: 0 }}>
                          <Typography variant="subtitle2">{selectedBeneficiary.name}</Typography>
                          <Typography
                            variant="body2"
                            sx={{ mt: 0.5, fontFamily: 'monospace', overflowWrap: 'anywhere' }}
                          >
                            {selectedBeneficiary.walletAddress}
                          </Typography>
                        </Box>
                      </Stack>
                    </CardContent>
                  </Card>
                )}
                <TextField
                  required
                  disabled={!wallet}
                  type="number"
                  label={portalText('发送数量（USDT）')}
                  value={amount}
                  onChange={(event) => setAmount(event.target.value)}
                  inputProps={{ min: 0, step: 0.000001 }}
                  helperText={
                    wallet
                      ? portalText('可用 {{value0}}', {
                          value0: formatUsdt(wallet.availableBalance),
                        })
                      : undefined
                  }
                />

                <Card variant="outlined" sx={{ bgcolor: 'grey.50' }}>
                  <CardContent sx={{ p: 2.5 }}>
                    <Stack spacing={1}>
                      <FeeRow label={portalText('发送数量')} value={formatUsdt(amount || 0)} />

                      <FeeRow label={portalText('网络手续费')} value={formatUsdt(fee)} />

                      <Divider />
                      <FeeRow label={portalText('预计到账')} value={formatUsdt(net)} strong />
                    </Stack>
                  </CardContent>
                </Card>
                <Alert severity="warning">
                  {portalText('链上转账不可撤销。提交后将冻结转出金额，审核完成前不可再次使用。')}
                </Alert>
                <Button
                  type="submit"
                  variant="contained"
                  size="large"
                  disabled={!isWithdrawalReady(wallet) || !selectedBeneficiary || submitting}
                >
                  {portalText('核对并提交')}
                </Button>
              </Stack>
            </Box>
          </CardContent>
        </Card>
        <Card sx={{ alignSelf: 'start' }}>
          <CardContent sx={{ p: 3 }}>
            <Typography variant="h6" sx={{ mb: 2 }}>
              {portalText('安全提醒')}
            </Typography>
            <Notice number="1" text={portalText('请确认接收地址支持所选网络和资产。')} />

            <Notice number="2" text={portalText('首次向新地址付款时，建议先发送小额测试。')} />

            <Notice
              number="3"
              text={portalText('本机构不会通过邮件、聊天或电话索取私钥、助记词或动态码。')}
            />

            <Divider sx={{ my: 2 }} />
            <Stack direction="row" justifyContent="space-between">
              <Typography color="text.secondary">{portalText('预计处理')}</Typography>
              <Typography variant="subtitle2">{portalText('审核通过后约 5–20 分钟')}</Typography>
            </Stack>
          </CardContent>
        </Card>
      </Box>
      <TransferList
        title={portalText('近期转出')}
        rows={transfers}
        loading={loading}
        onOpen={onOpenTransfer}
      />

      <Dialog
        open={customerSession && addressDialogOpen}
        onClose={closeAddressDialog}
        fullWidth
        maxWidth="sm"
      >
        <Box component="form" onSubmit={addWithdrawalAddress}>
          <DialogTitle>{portalText('添加白名单地址')}</DialogTitle>
          <DialogContent>
            <Stack spacing={2.25} sx={{ pt: 0.5 }}>
              {totpEnabled ? (
                <Alert severity="info" icon={<Iconify icon="solar:shield-keyhole-bold" />}>
                  {portalText(
                    '新地址必须使用当前账户验证器生成的 6 位动态码确认，验证通过后才可用于转出。'
                  )}
                </Alert>
              ) : (
                <Alert
                  severity="warning"
                  action={
                    <Button
                      color="inherit"
                      size="small"
                      onClick={() => navigate('/portal/settings')}
                    >
                      {portalText('前往设置')}
                    </Button>
                  }
                >
                  {portalText(
                    '当前账户尚未启用两步验证。请先在“安全与设置”中绑定验证器，再添加白名单地址。'
                  )}
                </Alert>
              )}
              {error && <Alert severity="error">{error}</Alert>}
              <TextField
                required
                autoFocus
                label={portalText('地址名称')}
                value={addressLabel}
                onChange={(event) => setAddressLabel(event.target.value.slice(0, 100))}
                placeholder={portalText('例如：公司冷钱包')}
                inputProps={{ maxLength: 100 }}
              />

              <TextField
                required
                label={portalText('TRON（TRC20）地址')}
                value={newAddress}
                onChange={(event) => setNewAddress(event.target.value.trim())}
                placeholder="T..."
                helperText={portalText('请逐字核对网络和地址；钱包地址保存后不可修改。')}
                inputProps={{ spellCheck: false, autoComplete: 'off' }}
              />

              <Divider />
              <TextField
                required
                disabled={!totpEnabled}
                label={portalText('6 位动态码')}
                value={otpCode}
                onChange={(event) => setOtpCode(event.target.value.replace(/\D/g, '').slice(0, 6))}
                placeholder="000000"
                helperText={portalText('输入验证器当前显示且尚未使用的动态码。')}
                inputProps={{
                  inputMode: 'numeric',
                  pattern: '[0-9]*',
                  maxLength: 6,
                  autoComplete: 'one-time-code',
                }}
              />

              <Alert severity="warning">
                {portalText('链上转账不可撤销。本机构不会通过邮件、聊天或电话索取您的动态码。')}
              </Alert>
            </Stack>
          </DialogContent>
          <DialogActions>
            <Button onClick={closeAddressDialog} disabled={addingAddress}>
              {portalText('取消')}
            </Button>
            <Button
              type="submit"
              variant="contained"
              disabled={
                addingAddress ||
                !totpEnabled ||
                !addressLabel.trim() ||
                !/^T[1-9A-HJ-NP-Za-km-z]{33}$/.test(newAddress) ||
                !/^\d{6}$/.test(otpCode)
              }
            >
              {addingAddress ? portalText('验证中…') : portalText('验证并添加')}
            </Button>
          </DialogActions>
        </Box>
      </Dialog>
      <Dialog open={confirmOpen} onClose={() => setConfirmOpen(false)} fullWidth maxWidth="sm">
        <DialogTitle>{portalText('确认 USDT 转出')}</DialogTitle>
        <DialogContent>
          <Alert severity="warning" sx={{ mb: 2 }}>
            {portalText('请最后核对网络、地址及金额。链上交易执行后无法撤销。')}
          </Alert>
          <Stack divider={<Divider flexItem />}>
            <DetailRow
              label={portalText('网络')}
              value={`${networkMeta[network].name} (${networkMeta[network].standard})`}
            />

            <DetailRow label={portalText('发送数量')} value={formatUsdt(amount || 0)} />

            <DetailRow label={portalText('手续费')} value={formatUsdt(fee)} />
            <DetailRow label={portalText('预计到账')} value={formatUsdt(net)} />
            <DetailRow label={portalText('白名单名称')} value={selectedBeneficiary?.name || '-'} />

            <DetailRow label={portalText('接收地址')} value={address} mono />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setConfirmOpen(false)}>{portalText('返回修改')}</Button>
          <Button
            variant="contained"
            color="warning"
            disabled={submitting || !isWithdrawalReady(wallet) || !selectedBeneficiary}
            onClick={() => submit().catch(() => undefined)}
          >
            {submitting ? portalText('提交中…') : portalText('确认提交')}
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
            {portalText('仅展示 TRON（TRC20）网络记录，点击可查看详情。')}
          </Typography>
        </Box>
        <Button endIcon={<Iconify icon="solar:alt-arrow-right-linear" />}>
          {portalText('全部记录')}
        </Button>
      </Stack>
      <TableContainer>
        <Table>
          <TableHead>
            <TableRow>
              <TableCell>{portalText('订单号')}</TableCell>
              <TableCell>{portalText('状态')}</TableCell>
              <TableCell>{portalText('方向')}</TableCell>
              <TableCell>{portalText('链 / 网络')}</TableCell>
              <TableCell align="right">{portalText('链上金额')}</TableCell>
              <TableCell align="right">{portalText('到账金额')}</TableCell>
              <TableCell>TXID</TableCell>
              <TableCell>{portalText('创建时间')}</TableCell>
              <TableCell align="right">{portalText('操作')}</TableCell>
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
                  <CryptoStatus status={row.status} rawStatus={rawCregisStatus(row)} />
                </TableCell>
                <TableCell>
                  {row.direction === 'DEPOSIT' ? portalText('转入') : portalText('转出')}
                </TableCell>
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
                    {shorten(row.txHash || portalText('待生成'), 7, 5)}
                  </Typography>
                </TableCell>
                <TableCell>{new Date(row.createdAt).toLocaleString(portalLocale())}</TableCell>
                <TableCell align="right">
                  <Button size="small" onClick={() => onOpen(row)}>
                    {portalText('详情')}
                  </Button>
                </TableCell>
              </TableRow>
            ))}
            {!rows.length && (
              <TableRow>
                <TableCell colSpan={9} align="center" sx={{ py: 7 }}>
                  {loading ? portalText('加载中…') : portalText('暂无链上记录')}
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
              <Typography variant="h5">{portalText('链上交易详情')}</Typography>
              <Typography color="text.secondary">{transfer.reference}</Typography>
            </Box>
            <IconButton onClick={onClose}>
              <Iconify icon="solar:close-circle-linear" />
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
            <CryptoStatus status={transfer.status} rawStatus={rawCregisStatus(transfer)} />
          </Stack>
          <Card variant="outlined">
            <CardContent>
              <Stack divider={<Divider flexItem />}>
                <DetailRow
                  label={portalText('类型')}
                  value={transfer.direction === 'DEPOSIT' ? portalText('转入') : portalText('转出')}
                />

                <DetailRow
                  label={portalText('网络')}
                  value={`${networkMeta[transfer.network].name} (${
                    networkMeta[transfer.network].standard
                  })`}
                />

                <DetailRow label={portalText('链上金额')} value={formatUsdt(transfer.amount)} />

                <DetailRow label={portalText('手续费')} value={formatUsdt(transfer.feeAmount)} />

                <DetailRow
                  label={
                    transfer.direction === 'DEPOSIT'
                      ? portalText('发送方地址')
                      : portalText('转出地址')
                  }
                  value={
                    transfer.fromAddress
                      ? shorten(transfer.fromAddress, 10, 8)
                      : portalText('暂未获取')
                  }
                  mono={Boolean(transfer.fromAddress)}
                />

                <DetailRow
                  label={portalText('目标地址')}
                  value={shorten(transfer.toAddress, 10, 8)}
                  mono
                />

                <DetailRow
                  label="TXID"
                  value={
                    transfer.txHash ? shorten(transfer.txHash, 10, 8) : portalText('执行后生成')
                  }
                  mono
                />

                <DetailRow
                  label={portalText('网络确认')}
                  value={portalText('{{value0}} 次', { value0: transfer.confirmations })}
                />

                <DetailRow
                  label={portalText('创建时间')}
                  value={new Date(transfer.createdAt).toLocaleString(portalLocale())}
                />
              </Stack>
            </CardContent>
          </Card>
          {transfer.status === 'SUBMITTED' && (
            <Alert severity="info">
              {portalText('转出申请正在等待审核，审核完成前相应金额保持冻结。')}
            </Alert>
          )}
          {rawCregisStatus(transfer) === 'exception' && (
            <Alert severity="warning">
              {portalText(
                '该交易正在异常核查，相关金额仍处于冻结状态。核查完成并确认最终结果后，余额才会更新。'
              )}
            </Alert>
          )}
          {transfer.rejectionReason && <Alert severity="error">{transfer.rejectionReason}</Alert>}
        </Stack>
      )}
    </Drawer>
  );
}

function CryptoStatus({
  status,
  rawStatus,
}: {
  status: CryptoTransfer['status'];
  rawStatus?: string;
}) {
  if (rawStatus === 'exception') return <Label color="warning">{portalText('异常调单')}</Label>;
  if (rawStatus === 'cancelled') return <Label color="default">{portalText('已取消')}</Label>;
  const labels = {
    SUBMITTED: portalText('待审核'),
    PROCESSING: portalText('链上处理中'),
    COMPLETED: portalText('成功'),
    REJECTED: portalText('已拒绝'),
    FAILED: portalText('失败'),
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
  return `${Number(value).toLocaleString(portalLocale(), {
    minimumFractionDigits: 2,
    maximumFractionDigits: 6,
  })} USDT`;
}
function shorten(value: string, start: number, end: number) {
  if (value.length <= start + end + 3) return value;
  return `${value.slice(0, start)}…${value.slice(-end)}`;
}
