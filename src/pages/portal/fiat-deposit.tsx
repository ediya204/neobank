import { useEffect, useMemo, useState } from 'react';
import { Helmet } from 'react-helmet-async';
import { useNavigate } from 'react-router-dom';
import {
  Alert,
  Box,
  Button,
  ButtonBase,
  Card,
  CardContent,
  Container,
  FormControl,
  InputLabel,
  MenuItem,
  Select,
  Stack,
  Typography,
} from '@mui/material';
import CustomBreadcrumbs from 'src/components/custom-breadcrumbs';
import Iconify from 'src/components/iconify';
import Label from 'src/components/label';
import { APP_DISPLAY_NAME } from 'src/config-global';
import { usePortalCustomer } from 'src/features/finance/portal-customer-context';
import {
  coreApi,
  FundingChannel,
  MoneyAccount,
  SYSTEM_WALLET_PRODUCT_NAME,
} from 'src/features/finance/core-api';
import { portalText } from 'src/locales/portal-text';

type DepositMode = 'PLATFORM' | 'VA' | 'OTC';

const modes: Array<{
  value: DepositMode;
  title: string;
  description: string;
  icon: string;
}> = [
  {
    value: 'PLATFORM',
    title: '平台账户转入',
    description: '汇入 SSC 平台银行账户，并准确填写专属汇款附言',
    icon: 'solar:buildings-2-bold-duotone',
  },
  {
    value: 'VA',
    title: 'VA 账户收款',
    description: '使用客户名下的 USD / HKD VA 银行账户收款',
    icon: 'solar:wallet-money-bold-duotone',
  },
  {
    value: 'OTC',
    title: 'OTC 兑换入账',
    description: '卖出 USDT 后将法币转入 {{productName}} 或 VA 账户',
    icon: 'solar:hand-money-bold-duotone',
  },
];

export default function FiatDepositPage() {
  const navigate = useNavigate();
  const { customer } = usePortalCustomer();
  const [mode, setMode] = useState<DepositMode>('PLATFORM');
  const [channels, setChannels] = useState<FundingChannel[]>([]);
  const [accountId, setAccountId] = useState('');
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState('');

  const systemAccounts = useMemo(
    () =>
      (customer?.accounts || []).filter(
        (row) => row.kind === 'SYSTEM_WALLET' && ['USD', 'HKD'].includes(row.currency)
      ),
    [customer?.accounts]
  );
  const vaAccounts = useMemo(
    () =>
      (customer?.accounts || []).filter(
        (row) => row.kind === 'VIRTUAL_ACCOUNT' && ['USD', 'HKD'].includes(row.currency)
      ),
    [customer?.accounts]
  );
  const availableAccounts = mode === 'VA' ? vaAccounts : systemAccounts;
  const account = availableAccounts.find((row) => row.id === accountId) || availableAccounts[0];
  const channel = channels.find(
    (row) => row.active && row.supportedCurrencies.includes(account?.currency || 'USD')
  );
  const reference = customer ? `SSC-${customer.id.slice(-8).toUpperCase()}` : '';

  useEffect(() => {
    if (!customer) return;
    coreApi<FundingChannel[]>(
      `/funding-channels?organizationId=${customer.organizationId}&type=FIAT_INBOUND&active=true`
    )
      .then(setChannels)
      .catch((value) =>
        setError(
          value instanceof Error
            ? value.message
            : portalText('暂时无法读取银行转入资料，请稍后重试。')
        )
      );
  }, [customer]);

  useEffect(() => {
    setAccountId(availableAccounts[0]?.id || '');
  }, [mode]); // eslint-disable-line react-hooks/exhaustive-deps

  const copyInstructions = async () => {
    if (!account) return;
    const text = depositInstructionText(mode, account, channel, reference);
    await navigator.clipboard?.writeText(text);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1600);
  };

  return (
    <>
      <Helmet>
        <title>{portalText('银行转入')} | {APP_DISPLAY_NAME}</title>
      </Helmet>
      <Container maxWidth="md">
        <Stack spacing={3}>
          <CustomBreadcrumbs
            heading={portalText('银行转入')}
            links={[
              {
                name: portalText('收付与兑换'),
                href: '/portal/money/transfers',
              },
              { name: portalText('银行转入') },
            ]}
          />

          <Typography color="text.secondary" sx={{ mt: -2 }}>
            {portalText('根据资金来源选择平台银行账户、VA 账户或 OTC 兑换入账。')}
          </Typography>
          {error && <Alert severity="error">{error}</Alert>}

          <Box
            sx={{
              display: 'grid',
              gridTemplateColumns: { xs: '1fr', md: 'repeat(3, 1fr)' },
              gap: 1.5,
            }}
          >
            {modes.map((item) => {
              const selected = mode === item.value;
              return (
                <ButtonBase
                  key={item.value}
                  onClick={() => setMode(item.value)}
                  sx={{
                    p: 2.25,
                    borderRadius: 2,
                    border: '1px solid',
                    borderColor: selected ? 'primary.main' : 'divider',
                    bgcolor: selected ? 'primary.lighter' : 'background.paper',
                    textAlign: 'left',
                    alignItems: 'flex-start',
                    '&:hover': { borderColor: 'primary.main' },
                  }}
                >
                  <Stack spacing={1} sx={{ width: 1 }}>
                    <Stack direction="row" justifyContent="space-between" alignItems="center">
                      <Iconify icon={item.icon} width={27} color="primary.main" />
                      {selected && <Label color="primary">{portalText('已选择')}</Label>}
                    </Stack>
                    <Typography variant="subtitle1">{portalText(item.title)}</Typography>
                    <Typography variant="caption" color="text.secondary">
                      {portalText(item.description, { productName: SYSTEM_WALLET_PRODUCT_NAME })}
                    </Typography>
                  </Stack>
                </ButtonBase>
              );
            })}
          </Box>

          {mode === 'PLATFORM' && (
            <BankInstructionCard
              title={portalText('平台账户转入资料')}
              description={portalText('从外部银行账户汇入 SSC 平台账户')}
              accounts={systemAccounts}
              account={account}
              accountId={accountId}
              onAccountChange={setAccountId}
              channel={channel}
              reference={reference}
              copied={copied}
              onCopy={copyInstructions}
              platform
            />
          )}

          {mode === 'VA' && (
            <BankInstructionCard
              title={portalText('VA 账户收款资料')}
              description={portalText('向下方客户专属 VA 银行账户汇款')}
              accounts={vaAccounts}
              account={account}
              accountId={accountId}
              onAccountChange={setAccountId}
              copied={copied}
              onCopy={copyInstructions}
            />
          )}

          {mode === 'OTC' && (
            <Card>
              <CardContent sx={{ p: { xs: 2.5, md: 4 } }}>
                <Stack spacing={2.5}>
                  <Box>
                    <Typography variant="h6">{portalText('卖出 USDT 并接收法币')}</Typography>
                    <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
                      {portalText(
                        'OTC 成交后，USD / HKD 将转入 {{productName}} 或客户 VA 账户。每笔入账均关联对应的 OTC 订单和成交报价。',
                        { productName: SYSTEM_WALLET_PRODUCT_NAME }
                      )}
                    </Typography>
                  </Box>
                  <Box
                    sx={{
                      display: 'grid',
                      gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, 1fr)' },
                      gap: 1.5,
                    }}
                  >
                    <OtcDestination
                      title={portalText('入{{value0}}', { value0: SYSTEM_WALLET_PRODUCT_NAME })}
                      description={portalText('可选 {{value0}}', {
                        value0:
                          systemAccounts.map((row) => row.currency).join(' / ') || 'USD / HKD',
                      })}
                      icon="solar:cash-out-bold-duotone"
                      onClick={() =>
                        navigate('/portal/money/otc?source=USDT&targetKind=SYSTEM_WALLET')
                      }
                    />

                    <OtcDestination
                      title={portalText('入 VA 账户')}
                      description={
                        vaAccounts.length
                          ? portalText('可选 {{value0}}', {
                              value0: vaAccounts.map((row) => row.currency).join(' / '),
                            })
                          : portalText('当前客户尚未开通 VA')
                      }
                      icon="solar:wallet-money-bold-duotone"
                      disabled={!vaAccounts.length}
                      onClick={() =>
                        navigate('/portal/money/otc?source=USDT&targetKind=VIRTUAL_ACCOUNT')
                      }
                    />
                  </Box>
                  <Alert severity="info">
                    {portalText(
                      'OTC 申请提交后将先冻结相应 USDT。审核、成交及记账完成后，法币才会转入所选账户。'
                    )}
                  </Alert>
                </Stack>
              </CardContent>
            </Card>
          )}
        </Stack>
      </Container>
    </>
  );
}

function BankInstructionCard({
  title,
  description,
  accounts,
  account,
  accountId,
  onAccountChange,
  channel,
  reference,
  copied,
  onCopy,
  platform = false,
}: {
  title: string;
  description: string;
  accounts: MoneyAccount[];
  account?: MoneyAccount;
  accountId: string;
  onAccountChange: (id: string) => void;
  channel?: FundingChannel;
  reference?: string;
  copied: boolean;
  onCopy: () => void;
  platform?: boolean;
}) {
  const bankName = platform ? channel?.settlementBankName : account?.bankName;
  const bankAccount = platform ? channel?.settlementAccount : account?.accountNumber;
  const swiftBic = platform ? channel?.swiftBic : account?.swiftBic;
  const ready = Boolean(account && bankName && bankAccount);
  return (
    <Card>
      <CardContent sx={{ p: { xs: 2.5, md: 4 } }}>
        <Stack spacing={2.5}>
          <Box>
            <Typography variant="h6">{title}</Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
              {description}
            </Typography>
          </Box>
          <FormControl fullWidth>
            <InputLabel>{platform ? portalText('到账币种') : portalText('选择 VA')}</InputLabel>
            <Select
              label={platform ? portalText('到账币种') : portalText('选择 VA')}
              value={account?.id || accountId}
              onChange={(event) => onAccountChange(event.target.value)}
            >
              {accounts.map((row) => (
                <MenuItem key={row.id} value={row.id}>
                  {row.currency} · {platform ? SYSTEM_WALLET_PRODUCT_NAME : row.name}
                </MenuItem>
              ))}
            </Select>
          </FormControl>
          {ready ? (
            <Card variant="outlined" sx={{ bgcolor: 'background.neutral' }}>
              <CardContent sx={{ p: 3 }}>
                <Stack spacing={2}>
                  <InstructionRow label={portalText('币种')} value={account?.currency || '—'} />

                  <InstructionRow label={portalText('收款银行')} value={bankName || '—'} />

                  <InstructionRow label={portalText('收款账号')} value={bankAccount || '—'} />

                  <InstructionRow label="SWIFT / BIC" value={swiftBic || '—'} />
                  {platform && (
                    <InstructionRow
                      label={portalText('专属转账附言')}
                      value={reference || '—'}
                      highlight
                    />
                  )}
                </Stack>
              </CardContent>
            </Card>
          ) : (
            <Alert severity="warning">
              {accounts.length
                ? portalText('当前币种的银行收款资料尚未配置完整。')
                : portalText('当前客户尚未开通可用于收款的账户。')}
            </Alert>
          )}
          <Alert severity="info">
            {platform
              ? portalText('汇款时请准确填写专属附言。银行来账将在核验及清算完成后计入可用余额。')
              : portalText(
                  '请核对币种、收款户名及 VA 账号。银行来账匹配并完成清算后，将计入 VA 可用余额。'
                )}
          </Alert>
          <Button
            size="large"
            variant="contained"
            startIcon={<Iconify icon="solar:copy-linear" />}
            onClick={onCopy}
            disabled={!ready}
          >
            {copied ? portalText('银行转入资料已复制') : portalText('复制银行转入资料')}
          </Button>
        </Stack>
      </CardContent>
    </Card>
  );
}

function OtcDestination({
  title,
  description,
  icon,
  onClick,
  disabled = false,
}: {
  title: string;
  description: string;
  icon: string;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <ButtonBase
      disabled={disabled}
      onClick={onClick}
      sx={{
        p: 2.5,
        borderRadius: 1.5,
        border: '1px solid',
        borderColor: 'divider',
        textAlign: 'left',
        justifyContent: 'flex-start',
        opacity: disabled ? 0.55 : 1,
        '&:hover': { borderColor: 'primary.main', bgcolor: 'action.hover' },
      }}
    >
      <Stack direction="row" spacing={1.5} alignItems="center">
        <Iconify icon={icon} width={28} color="primary.main" />
        <Box>
          <Typography variant="subtitle2">{title}</Typography>
          <Typography variant="caption" color="text.secondary">
            {description}
          </Typography>
        </Box>
      </Stack>
    </ButtonBase>
  );
}

function InstructionRow({
  label,
  value,
  highlight = false,
}: {
  label: string;
  value: string;
  highlight?: boolean;
}) {
  return (
    <Stack direction={{ xs: 'column', sm: 'row' }} justifyContent="space-between" gap={0.5}>
      <Typography variant="body2" color="text.secondary">
        {label}
      </Typography>
      <Typography variant="subtitle2" color={highlight ? 'primary.main' : 'text.primary'}>
        {value}
      </Typography>
    </Stack>
  );
}

function depositInstructionText(
  mode: DepositMode,
  account: MoneyAccount,
  channel: FundingChannel | undefined,
  reference: string
) {
  const platform = mode === 'PLATFORM';
  return [
    portalText('币种: {{value0}}', { value0: account.currency }),
    portalText('银行: {{value0}}', {
      value0: platform ? channel?.settlementBankName || '—' : account.bankName || '—',
    }),
    portalText('账号: {{value0}}', {
      value0: platform ? channel?.settlementAccount || '—' : account.accountNumber || '—',
    }),
    `SWIFT/BIC: ${platform ? channel?.swiftBic || '—' : account.swiftBic || '—'}`,
    ...(platform ? [portalText('转账附言: {{value0}}', { value0: reference })] : []),
  ].join('\n');
}
