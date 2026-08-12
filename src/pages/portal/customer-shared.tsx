import { Chip, Stack, Typography } from '@mui/material';
import Label from 'src/components/label';
import { Currency, MoneyAccount, Operation } from 'src/features/finance/core-api';

export const currencySymbols: Record<Currency, string> = {
  USD: '$',
  SGD: 'S$',
  HKD: 'HK$',
  EUR: '€',
  GBP: '£',
  USDT: '₮',
};

export function money(value: string | number, currency: Currency) {
  return `${currencySymbols[currency]}${Number(value).toLocaleString('zh-CN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: currency === 'USDT' ? 4 : 2,
  })}`;
}

export function accountLabel(account: MoneyAccount) {
  if (account.kind === 'VIRTUAL_ACCOUNT') return `${account.currency} 收款账户`;
  if (account.kind === 'CRYPTO_WALLET') return 'USDT 数字钱包';
  return `${account.currency} 余额账户`;
}

const typeNames: Record<Operation['type'], string> = {
  DEPOSIT: '入账',
  PAYOUT: '付款',
  ADJUSTMENT: '余额调整',
  INTERNAL_TRANSFER: '内部转账',
  FX: '换汇',
  OTC: 'OTC 兑换',
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
      <Typography variant="subtitle2">{typeNames[operation.type]}</Typography>
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
  return <Label color={color}>{statusNames[status]}</Label>;
}

export function AccountKindChip({ account }: { account: MoneyAccount }) {
  let label = '法币';
  if (account.kind === 'VIRTUAL_ACCOUNT') label = '独立 VA';
  if (account.kind === 'CRYPTO_WALLET') label = '数字资产';
  return (
    <Chip
      size="small"
      label={label}
      color={account.kind === 'VIRTUAL_ACCOUNT' ? 'primary' : 'default'}
      variant="soft"
    />
  );
}
