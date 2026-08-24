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
  customerAuthApi,
  neobankApi,
  supportedCryptoNetwork,
  supportedFiatCurrencies,
} from './core-api';

type BeneficiaryType = 'BANK' | 'CRYPTO';

type Props = {
  open: boolean;
  customerId: string;
  userId?: string;
  customerSession?: boolean;
  totpEnabled?: boolean;
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
    title: '法币银行账户',
    description: 'USD / HKD 转出白名单',
    icon: 'solar:buildings-2-bold-duotone',
  },
  {
    type: 'CRYPTO',
    title: '数字货币地址',
    description: 'USDT · TRON（TRC20）白名单',
    icon: 'solar:wallet-money-bold-duotone',
  },
];

export default function BeneficiaryDialog({
  open,
  customerId,
  userId,
  customerSession = false,
  totpEnabled = false,
  onClose,
  onCreated,
}: Props) {
  const [type, setType] = useState<BeneficiaryType>('BANK');
  const [name, setName] = useState('');
  const [currency, setCurrency] = useState<Currency>('USD');
  const [bankName, setBankName] = useState('');
  const [accountNumber, setAccountNumber] = useState('');
  const [swiftBic, setSwiftBic] = useState('');
  const [iban, setIban] = useState('');
  const [bankAddress, setBankAddress] = useState('');
  const [countryCode, setCountryCode] = useState('HK');
  const [walletAddress, setWalletAddress] = useState('');
  const [addressConfirmed, setAddressConfirmed] = useState(false);
  const [otpCode, setOtpCode] = useState('');
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
    setIban('');
    setBankAddress('');
    setCountryCode('HK');
    setWalletAddress('');
    setAddressConfirmed(false);
    setOtpCode('');
    setError('');
  }, [open]);

  const selectType = (nextType: BeneficiaryType) => {
    setType(nextType);
    setCurrency(nextType === 'CRYPTO' ? 'USDT' : 'USD');
    setError('');
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const normalizedName = name.trim();
    const normalizedCountryCode = countryCode.trim().toUpperCase();
    const normalizedBankName = bankName.trim();
    const normalizedAccountNumber = accountNumber.trim();
    const normalizedWalletAddress = walletAddress.trim();
    if (!customerId) {
      setError('请选择客户后再新增收款人');
      return;
    }
    if (!normalizedName) {
      setError(type === 'BANK' ? '请输入收款人姓名或企业名称' : '请输入地址名称');
      return;
    }
    if (
      type === 'BANK' &&
      (!/^[A-Z]{2}$/.test(normalizedCountryCode) || !normalizedBankName || !normalizedAccountNumber)
    ) {
      setError('请填写两位国家/地区代码、收款银行和银行账号');
      return;
    }
    if (type === 'CRYPTO' && !normalizedWalletAddress) {
      setError('请输入 TRC20 收币地址');
      return;
    }
    if (type === 'CRYPTO' && !addressConfirmed) {
      setError('请确认已核对收款网络和钱包地址');
      return;
    }
    if (customerSession && !totpEnabled) {
      setError('请先在“安全与设置”中启用两步验证');
      return;
    }
    if (customerSession && !/^\d{6}$/.test(otpCode)) {
      setError('请输入验证器当前显示的 6 位动态码');
      return;
    }
    setSubmitting(true);
    setError('');
    try {
      if (customerSession) {
        const stepUp = await customerAuthApi<{ step_up_token: string }>('/step-up/totp', {
          method: 'POST',
          body: JSON.stringify({
            purpose: 'add_withdrawal_address',
            otp_code: otpCode,
          }),
        });
        if (type === 'BANK') {
          await neobankApi('/customer/fiat-beneficiaries', {
            method: 'POST',
            body: JSON.stringify({
              name: normalizedName,
              currency,
              bank_name: normalizedBankName,
              account_number: normalizedAccountNumber,
              swift_bic: swiftBic.trim().toUpperCase(),
              iban: iban.trim().toUpperCase(),
              bank_address: bankAddress.trim(),
              country_code: normalizedCountryCode,
              step_up_token: stepUp.step_up_token,
              idempotency_key: crypto.randomUUID(),
            }),
          });
        } else {
          await neobankApi('/customer/withdrawal-addresses', {
            method: 'POST',
            body: JSON.stringify({
              label: normalizedName,
              address: normalizedWalletAddress,
              step_up_token: stepUp.step_up_token,
              idempotency_key: crypto.randomUUID(),
            }),
          });
        }
      } else {
        await coreApi('/beneficiaries', {
          method: 'POST',
          userId,
          body: JSON.stringify(
            type === 'BANK'
              ? {
                  customerId,
                  type,
                  name: normalizedName,
                  currency,
                  bankName: normalizedBankName,
                  accountNumber: normalizedAccountNumber,
                  swiftBic: swiftBic.trim().toUpperCase() || undefined,
                  iban: iban.trim().toUpperCase() || undefined,
                  bankAddress: bankAddress.trim() || undefined,
                  countryCode: normalizedCountryCode,
                }
              : {
                  customerId,
                  type,
                  name: normalizedName,
                  currency: 'USDT',
                  network: supportedCryptoNetwork,
                  walletAddress: normalizedWalletAddress,
                }
          ),
        });
      }
      onCreated();
    } catch (value) {
      const message = value instanceof Error ? value.message : '保存失败';
      if (message === 'invalid_totp_code') {
        setError('动态码无效、已过期或已使用，请输入验证器当前显示的动态码');
      } else if (message === 'totp_not_enrolled') {
        setError('当前账户尚未绑定验证器，无法新增转出白名单');
      } else if (
        message === 'withdrawal_address_already_exists' ||
        message === 'fiat_beneficiary_already_exists'
      ) {
        setError('该收款目标已经在转出白名单中');
      } else {
        setError(message);
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onClose={submitting ? undefined : onClose} fullWidth maxWidth="sm">
      <Box component="form" onSubmit={submit} noValidate>
        <DialogTitle sx={{ pb: 1 }}>新增转出白名单</DialogTitle>
        <DialogContent>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2.5 }}>
            选择目标类型并填写完整资料。保存后目标资料不可修改，如有变更请停用后重新添加。
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
              onChange={(event) => {
                setName(event.target.value);
                setError('');
              }}
            />

            {type === 'BANK' ? (
              <>
                <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
                  <TextField
                    required
                    fullWidth
                    label="国家/地区代码"
                    value={countryCode}
                    onChange={(event) => {
                      setCountryCode(event.target.value.toUpperCase());
                      setError('');
                    }}
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
                  onChange={(event) => {
                    setBankName(event.target.value);
                    setError('');
                  }}
                />
                <TextField
                  required
                  label="银行账号"
                  value={accountNumber}
                  onChange={(event) => {
                    setAccountNumber(event.target.value);
                    setError('');
                  }}
                />
                <TextField
                  label="SWIFT / BIC"
                  value={swiftBic}
                  onChange={(event) => setSwiftBic(event.target.value.toUpperCase())}
                />
                <TextField
                  label="IBAN（选填）"
                  value={iban}
                  onChange={(event) => setIban(event.target.value.toUpperCase())}
                />
                <TextField
                  label="银行地址（选填）"
                  value={bankAddress}
                  onChange={(event) => setBankAddress(event.target.value)}
                  multiline
                  minRows={2}
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
                    setError('');
                  }}
                  helperText="系统会验证 TRON Base58Check 地址格式；保存后仍请在付币前逐字核对。"
                  inputProps={{ spellCheck: false, autoComplete: 'off' }}
                />
                <Alert severity="warning">
                  数字货币转账不可撤销。这里保存的是外部收款地址，不是 SSC/Cregis 分配的充值地址。
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

            {customerSession && (
              <>
                <Alert severity={totpEnabled ? 'info' : 'warning'}>
                  {totpEnabled
                    ? '新增转出白名单必须使用当前账户验证器生成的动态码确认。'
                    : '当前账户尚未启用两步验证，请先前往“安全与设置”完成绑定。'}
                </Alert>
                <TextField
                  required
                  disabled={!totpEnabled}
                  label="6 位动态码"
                  value={otpCode}
                  onChange={(event) => {
                    setOtpCode(event.target.value.replace(/\D/g, '').slice(0, 6));
                    setError('');
                  }}
                  inputProps={{ inputMode: 'numeric', pattern: '[0-9]*', maxLength: 6 }}
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
            disabled={
              submitting ||
              !customerId ||
              (type === 'CRYPTO' && !addressConfirmed) ||
              (customerSession && (!totpEnabled || otpCode.length !== 6))
            }
          >
            {submitting ? '正在验证并保存…' : '验证并加入白名单'}
          </Button>
        </DialogActions>
      </Box>
    </Dialog>
  );
}
