import type { Currency, FundingChannel, WithdrawalFeeRule } from './core-api';

type PayoutMethod = 'PLATFORM' | 'POBO' | 'VA';

export function resolveConfiguredPayout({
  channels,
  fees,
  method,
  currency,
  fundingChannelId,
}: {
  channels: FundingChannel[];
  fees: WithdrawalFeeRule[];
  method: PayoutMethod;
  currency: Currency;
  fundingChannelId?: string;
}): { channel: FundingChannel; fee: WithdrawalFeeRule } | undefined {
  const channelType = method === 'VA' ? 'VIRTUAL_ACCOUNT' : (`${method}_PAYOUT` as const);
  const eligibleChannels = channels.filter(
    (candidate) =>
      candidate.type === channelType &&
      candidate.active &&
      candidate.supportedCurrencies.includes(currency) &&
      (method !== 'VA' || candidate.id === fundingChannelId)
  );
  const fee = fees.find(
    (candidate) =>
      candidate.assetClass === 'FIAT' &&
      candidate.currency === currency &&
      candidate.method === method &&
      candidate.active &&
      eligibleChannels.some((channel) => channel.code === candidate.channelCode)
  );
  if (!fee) return undefined;
  const channel = eligibleChannels.find((candidate) => candidate.code === fee.channelCode);
  return channel ? { channel, fee } : undefined;
}
