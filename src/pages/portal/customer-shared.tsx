import { Chip, Stack, Typography } from '@mui/material';
import Label from 'src/components/label';
import {
  accountBalanceLabel,
  Currency,
  MoneyAccount,
  Operation,
  SYSTEM_WALLET_PRODUCT_NAME,
} from 'src/features/finance/core-api';
import { portalLocale, portalText } from 'src/locales/portal-text';

export const currencySymbols: Record<Currency, string> = {
  USD: '$',
  SGD: 'S$',
  HKD: 'HK$',
  EUR: '€',
  GBP: '£',
  USDT: '₮',
};

export function money(value: string | number, currency: Currency) {
  return `${currencySymbols[currency]}${Number(value).toLocaleString(portalLocale(), {
    minimumFractionDigits: 2,
    maximumFractionDigits: currency === 'USDT' ? 4 : 2,
  })}`;
}

export function accountLabel(account: MoneyAccount) {
  return accountBalanceLabel(account);
}

const typeNames: Record<Operation['type'], string> = {
  DEPOSIT: '入账',
  PAYOUT: '付款',
  ADJUSTMENT: '账户调整',
  INTERNAL_TRANSFER: '账户间划转',
  FX: '换汇',
  OTC: 'OTC 兑换',
  VA_OPENING_FEE: 'VA 开户手续费',
};

const statusNames: Record<Operation['status'], string> = {
  DRAFT: '草稿',
  SUBMITTED: '审核中',
  APPROVED: '已批准',
  REJECTED: '未通过',
  PROCESSING: '处理中',
  COMPLETED: '已完成',
  FAILED: '失败',
  CANCELLED: '已取消',
};

export function OperationTitle({ operation }: { operation: Operation }) {
  return (
    <Stack spacing={0.35}>
      <Typography variant="subtitle2">{portalText(typeNames[operation.type])}</Typography>
      <Typography variant="caption" color="text.secondary">
        {operation.reference}
      </Typography>
    </Stack>
  );
}

export function OperationStatus({ status }: { status: Operation['status'] }) {
  let color: 'success' | 'error' | 'warning' | 'default' = 'default';
  if (status === 'COMPLETED') color = 'success';
  if (status === 'REJECTED' || status === 'FAILED') color = 'error';
  if (status === 'SUBMITTED' || status === 'PROCESSING') color = 'warning';
  return <Label color={color}>{portalText(statusNames[status])}</Label>;
}

export function AccountKindChip({ account }: { account: MoneyAccount }) {
  let label = SYSTEM_WALLET_PRODUCT_NAME;
  if (account.kind === 'VIRTUAL_ACCOUNT') label = portalText('VA 账户');
  if (account.kind === 'CRYPTO_WALLET') label = portalText('数字资产账户');
  return (
    <Chip
      size="small"
      label={label}
      color={account.kind === 'VIRTUAL_ACCOUNT' ? 'primary' : 'default'}
      variant="soft"
    />
  );
}
