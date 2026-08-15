import { FormEvent, useEffect, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  ButtonBase,
  Checkbox,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControl,
  FormControlLabel,
  InputLabel,
  MenuItem,
  Select,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import Iconify from 'src/components/iconify';
import {
  coreApi,
  Currency,
  supportedCryptoNetwork,
  supportedFiatCurrencies,
} from './core-api';

type BeneficiaryType = 'BANK' | 'CRYPTO';

type Props = {
  open: boolean;
  customerId: string;
  userId?: string;
  onClose: () => void;
  onCreated: () => void;
};

const options: Array<{
  type: BeneficiaryType;
  title: string;
  description: string;
  icon: string;
}> = [
  {
    type: 'BANK',
    title: '银行账户',
    description: 'USD / HKD 法币付款',
    icon: 'solar:bank-bold-duotone',
  },
  {
    type: 'CRYPTO',
    title: '数字货币地址',
    description: 'USDT · TRON (TRC20)',
    icon: 'solar:wallet-money-bold-duotone',
  },
];

export default function BeneficiaryDialog({
  open,
  customerId,
  userId,
  onClose,
  onCreated,
}: Props) {
  const [type, setType] = useState<BeneficiaryType>('BANK');
  const [name, setName] = useState('');
  const [currency, setCurrency] = useState<Currency>('USD');
  const [bankName, setBankName] = useState('');
  const [accountNumber, setAccountNumber] = useState('');
  const [swiftBic, setSwiftBic] = useState('');
  const [countryCode, setCountryCode] = useState('HK');
  const [walletAddress, setWalletAddress] = useState('');
  const [addressConfirmed, setAddressConfirmed] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open) return;
    setType('BANK');
    setName('');
    setCurrency('USD');
    setBankName('');
    setAccountNumber('');
    setSwiftBic('');
    setCountryCode('HK');
    setWalletAddress('');
    setAddressConfirmed(false);
    setError('');
  }, [open]);

  const selectType = (nextType: BeneficiaryType) => {
    setType(nextType);
    setCurrency(nextType === 'CRYPTO' ? 'USDT' : 'USD');
    setError('');
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (type === 'CRYPTO' && !addressConfirmed) {
      setError('请确认已核对收款网络和钱包地址');
      return;
    }
    setSubmitting(true);
    setError('');
    try {
      await coreApi('/beneficiaries', {
        method: 'POST',
        userId,
        body: JSON.stringify(
          type === 'BANK'
            ? {
                customerId,
                type,
                name,
                currency,
                bankName,
                accountNumber,
                swiftBic: swiftBic || undefined,
                countryCode,
              }
            : {
                customerId,
                type,
                name,
                currency: 'USDT',
                network: supportedCryptoNetwork,
                walletAddress,
              }
        ),
      });
      onCreated();
    } catch (value) {
      setError(value instanceof Error ? value.message : '保存失败');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onClose={submitting ? undefined : onClose} fullWidth maxWidth="sm">
      <Box component="form" onSubmit={submit}>
        <DialogTitle sx={{ pb: 1 }}>新增第三方收款人</DialogTitle>
        <DialogContent>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2.5 }}>
            选择收款方式后，只填写该通道必需的资料。
          </Typography>
          <Box
            sx={{
              display: 'grid',
              gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, 1fr)' },
              gap: 1.5,
              mb: 3,
            }}
          >
            {options.map((option) => {
              const selected = type === option.type;
              return (
                <ButtonBase
                  key={option.type}
                  onClick={() => selectType(option.type)}
                  sx={{
                    p: 2,
                    gap: 1.5,
                    justifyContent: 'flex-start',
                    textAlign: 'left',
                    border: '1px solid',
                    borderColor: selected ? 'primary.main' : 'divider',
                    borderRadius: 1.5,
                    bgcolor: selected ? 'primary.lighter' : 'background.paper',
                  }}
                >
                  <Box
                    sx={{
                      width: 40,
                      height: 40,
                      flexShrink: 0,
                      display: 'grid',
                      placeItems: 'center',
                      borderRadius: 1.25,
                      bgcolor: selected ? 'primary.main' : 'grey.100',
                      color: selected ? 'primary.contrastText' : 'text.secondary',
                    }}
                  >
                    <Iconify icon={option.icon} width={22} />
                  </Box>
                  <Box>
                    <Typography variant="subtitle2">{option.title}</Typography>
                    <Typography variant="caption" color="text.secondary">
                      {option.description}
                    </Typography>
                  </Box>
                </ButtonBase>
              );
            })}
          </Box>

          <Stack spacing={2}>
            {error && <Alert severity="error">{error}</Alert>}
            <TextField
              required
              autoFocus
              label={type === 'BANK' ? '收款人姓名 / 企业名称' : '地址名称'}
              placeholder={type === 'CRYPTO' ? '例如：供应商 TRON 钱包' : undefined}
              value={name}
              onChange={(event) => setName(event.target.value)}
            />

            {type === 'BANK' ? (
              <>
                <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
                  <TextField
                    required
                    fullWidth
                    label="国家/地区代码"
                    value={countryCode}
                    onChange={(event) => setCountryCode(event.target.value.toUpperCase())}
                    inputProps={{ maxLength: 2 }}
                  />
                  <FormControl fullWidth>
                    <InputLabel>收款币种</InputLabel>
                    <Select
                      label="收款币种"
                      value={currency}
                      onChange={(event) => setCurrency(event.target.value as Currency)}
                    >
                      {supportedFiatCurrencies.map((item) => (
                        <MenuItem key={item} value={item}>
                          {item}
                        </MenuItem>
                      ))}
                    </Select>
                  </FormControl>
                </Stack>
                <TextField
                  required
                  label="收款银行"
                  value={bankName}
                  onChange={(event) => setBankName(event.target.value)}
                />
                <TextField
                  required
                  label="银行账号 / IBAN"
                  value={accountNumber}
                  onChange={(event) => setAccountNumber(event.target.value)}
                />
                <TextField
                  label="SWIFT / BIC"
                  value={swiftBic}
                  onChange={(event) => setSwiftBic(event.target.value.toUpperCase())}
                />
              </>
            ) : (
              <>
                <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
                  <TextField fullWidth label="币种" value="USDT" InputProps={{ readOnly: true }} />
                  <TextField
                    fullWidth
                    label="网络"
                    value="TRON (TRC20)"
                    InputProps={{ readOnly: true }}
                  />
                </Stack>
                <TextField
                  required
                  label="TRC20 收币地址"
                  placeholder="T..."
                  value={walletAddress}
                  onChange={(event) => {
                    setWalletAddress(event.target.value.trim());
                    setAddressConfirmed(false);
                  }}
                  helperText="系统会验证 TRON Base58Check 地址格式；保存后仍请在付币前逐字核对。"
                  inputProps={{ spellCheck: false, autoComplete: 'off' }}
                />
                <Alert severity="warning">
                  数字货币转账不可撤销。这里保存的是外部收款地址，不是 SCC/Cregis
                  分配的充值地址。
                </Alert>
                <FormControlLabel
                  control={
                    <Checkbox
                      checked={addressConfirmed}
                      onChange={(event) => setAddressConfirmed(event.target.checked)}
                    />
                  }
                  label="我已与收款人核对币种、TRON 网络和完整地址"
                />
              </>
            )}
          </Stack>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2.5 }}>
          <Button disabled={submitting} onClick={onClose}>
            取消
          </Button>
          <Button
            type="submit"
            variant="contained"
            disabled={submitting || !customerId || (type === 'CRYPTO' && !addressConfirmed)}
          >
            {submitting ? '保存中…' : '保存收款人'}
          </Button>
        </DialogActions>
      </Box>
    </Dialog>
  );
}
