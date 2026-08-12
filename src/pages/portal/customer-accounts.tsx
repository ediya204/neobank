import { useState } from 'react';
import { Helmet } from 'react-helmet-async';
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Container,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  FormControl,
  InputLabel,
  MenuItem,
  Select,
  Stack,
  Tab,
  Tabs,
  TextField,
  Typography,
} from '@mui/material';
import Iconify from 'src/components/iconify';
import { usePortalCustomer } from 'src/features/finance/portal-customer-context';
import {
  coreApi,
  Currency,
  MoneyAccount,
  VirtualAccountRequest,
} from 'src/features/finance/core-api';
import { AccountKindChip, accountLabel, money } from './customer-shared';

type AccountTab = 'all' | 'wallet' | 'va' | 'crypto';

export default function CustomerAccounts() {
  const { customer, error, refresh } = usePortalCustomer();
  const [tab, setTab] = useState<AccountTab>('all');
  const [selected, setSelected] = useState<MoneyAccount | null>(null);
  const [vaOpen, setVaOpen] = useState(false);
  const accounts = (customer?.accounts || []).filter((row) => {
    if (tab === 'wallet') return row.kind === 'SYSTEM_WALLET';
    if (tab === 'va') return row.kind === 'VIRTUAL_ACCOUNT';
    if (tab === 'crypto') return row.kind === 'CRYPTO_WALLET';
    return ['SYSTEM_WALLET', 'VIRTUAL_ACCOUNT', 'CRYPTO_WALLET'].includes(row.kind);
  });
  return (
    <>
      <Helmet>
        <title>我的账户 | Moventra</title>
      </Helmet>
      <Container maxWidth="xl">
        <Stack spacing={3}>
          <Stack direction={{ xs: 'column', sm: 'row' }} justifyContent="space-between" gap={2}>
            <Box>
              <Typography variant="h4">账户</Typography>
              <Typography color="text.secondary" sx={{ mt: 0.75 }}>
                查看多币种余额和专属收款账户。
              </Typography>
            </Box>
            <Button
              variant="contained"
              startIcon={<Iconify icon="solar:add-circle-bold" />}
              onClick={() => setVaOpen(true)}
            >
              申请新的 VA
            </Button>
          </Stack>
          {error && <Alert severity="error">{error}</Alert>}
          <Card>
            <Tabs
              value={tab}
              onChange={(_, value) => setTab(value)}
              variant="scrollable"
              scrollButtons="auto"
              sx={{ px: 2 }}
            >
              <Tab value="all" label="全部" />
              <Tab value="wallet" label="余额账户" />
              <Tab value="va" label="收款账户 / VA" />
              <Tab value="crypto" label="数字钱包" />
            </Tabs>
          </Card>
          <Box
            sx={{
              display: 'grid',
              gridTemplateColumns: { xs: '1fr', md: 'repeat(2, 1fr)', xl: 'repeat(3, 1fr)' },
              gap: 2.5,
            }}
          >
            {accounts.map((account) => (
              <AccountCard key={account.id} account={account} onOpen={() => setSelected(account)} />
            ))}
          </Box>
          {!accounts.length && (
            <Card sx={{ py: 8, textAlign: 'center' }}>
              <Typography color="text.secondary">暂无此类账户</Typography>
            </Card>
          )}
        </Stack>
      </Container>
      <AccountDialog account={selected} onClose={() => setSelected(null)} />
      <VaRequestDialog
        open={vaOpen}
        customerId={customer?.id || ''}
        onClose={() => setVaOpen(false)}
        onCreated={() => {
          setVaOpen(false);
          refresh().catch(() => undefined);
        }}
      />
    </>
  );
}

function VaRequestDialog({
  open,
  customerId,
  onClose,
  onCreated,
}: {
  open: boolean;
  customerId: string;
  onClose: () => void;
  onCreated: () => void;
}) {
  const [currency, setCurrency] = useState<Currency>('USD');
  const [country, setCountry] = useState('SG');
  const [purpose, setPurpose] = useState('接收客户货款');
  const [error, setError] = useState('');
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError('');
    try {
      await coreApi<VirtualAccountRequest>(`/customers/${customerId}/virtual-account-requests`, {
        method: 'POST',
        body: JSON.stringify({ currency, preferredCountry: country, purpose }),
      });
      onCreated();
    } catch (value) {
      setError(value instanceof Error ? value.message : '申请提交失败');
    }
  };
  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="sm">
      <Box component="form" onSubmit={submit}>
        <DialogTitle>申请新的专属收款账户</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ mt: 1 }}>
            {error && <Alert severity="error">{error}</Alert>}
            <FormControl fullWidth>
              <InputLabel>币种</InputLabel>
              <Select
                label="币种"
                value={currency}
                onChange={(event) => setCurrency(event.target.value as Currency)}
              >
                {(['USD', 'SGD', 'HKD', 'EUR', 'GBP'] as Currency[]).map((item) => (
                  <MenuItem key={item} value={item}>
                    {item}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
            <TextField
              required
              label="开户地区代码"
              value={country}
              onChange={(event) => setCountry(event.target.value.toUpperCase())}
              inputProps={{ maxLength: 2 }}
            />
            <TextField
              required
              label="账户用途"
              value={purpose}
              onChange={(event) => setPurpose(event.target.value)}
              multiline
              minRows={2}
            />
            <Alert severity="info">
              申请需要平台复核。批准后会在账户页显示独立账号、银行和 SWIFT 信息。
            </Alert>
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={onClose}>取消</Button>
          <Button type="submit" variant="contained">
            提交申请
          </Button>
        </DialogActions>
      </Box>
    </Dialog>
  );
}

function AccountCard({ account, onOpen }: { account: MoneyAccount; onOpen: () => void }) {
  const crypto = account.kind === 'CRYPTO_WALLET';
  let accentColor = 'grey.300';
  if (account.kind === 'VIRTUAL_ACCOUNT') accentColor = 'primary.main';
  if (crypto) accentColor = 'warning.main';
  return (
    <Card sx={{ position: 'relative', overflow: 'hidden' }}>
      <Box
        sx={{
          height: 5,
          bgcolor: accentColor,
        }}
      />
      <CardContent sx={{ p: 3 }}>
        <Stack direction="row" justifyContent="space-between">
          <Box>
            <Typography variant="h6">{accountLabel(account)}</Typography>
            <Typography variant="body2" color="text.secondary">
              {account.name}
            </Typography>
          </Box>
          <AccountKindChip account={account} />
        </Stack>
        <Typography variant="h4" sx={{ mt: 3 }}>
          {money(account.availableBalance, account.currency)}
        </Typography>
        <Typography variant="caption" color="text.secondary">
          可用余额
        </Typography>
        <Divider sx={{ my: 2.5 }} />
        {crypto ? (
          <Stack spacing={1.5}>
            <Alert severity="info" icon={false}>
              USDT 已按 TRON、BSC、Ethereum 分链展示。
            </Alert>
            <Button fullWidth variant="contained" href="/portal/crypto-wallet">
              进入数字钱包
            </Button>
          </Stack>
        ) : (
          <Stack direction="row" spacing={1}>
            <Button fullWidth variant="contained" onClick={onOpen}>
              收款
            </Button>
            <Button fullWidth variant="outlined" href="/portal/money/transfers">
              转账
            </Button>
          </Stack>
        )}
      </CardContent>
    </Card>
  );
}

function AccountDialog({
  account,
  onClose,
}: {
  account: MoneyAccount | null;
  onClose: () => void;
}) {
  if (!account) return null;
  const isVa = account.kind === 'VIRTUAL_ACCOUNT';
  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="sm">
      <DialogTitle>{isVa ? '使用专属 VA 收款' : `${account.currency} 入账信息`}</DialogTitle>
      <DialogContent>
        <Alert severity="info" sx={{ mb: 2 }}>
          请确保汇款人名称与客户资料一致。银行到账后需运营复核，完成后余额自动更新。
        </Alert>
        <Stack divider={<Divider flexItem />}>
          <Detail label="账户名称" value={account.name} />
          <Detail label="银行" value={account.bankName || 'Moventra 合作银行'} />
          <Detail label="账户号码" value={account.accountNumber || '-'} mono />
          <Detail label="SWIFT / BIC" value={account.swiftBic || '-'} mono />
          <Detail label="币种" value={account.currency} />
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>关闭</Button>
        <Button
          variant="contained"
          onClick={() => navigator.clipboard?.writeText(account.accountNumber || '')}
        >
          复制账户号码
        </Button>
      </DialogActions>
    </Dialog>
  );
}

function Detail({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <Stack direction="row" justifyContent="space-between" sx={{ py: 1.5 }}>
      <Typography color="text.secondary">{label}</Typography>
      <Typography
        variant="subtitle2"
        sx={{ fontFamily: mono ? 'monospace' : undefined, textAlign: 'right' }}
      >
        {value}
      </Typography>
    </Stack>
  );
}
