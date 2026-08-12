import { CryptoNetwork, Currency, Prisma } from '@prisma/client';

export const supportedFiatCurrencies = ['USD', 'HKD'] satisfies Currency[];
export const supportedCryptoAsset: Currency = 'USDT';
export const supportedCryptoNetwork: CryptoNetwork = 'TRON';

export const supportedCustomerAccountWhere = {
  OR: [
    {
      currency: { in: supportedFiatCurrencies },
      kind: { in: ['SYSTEM_WALLET', 'VIRTUAL_ACCOUNT'] },
    },
    {
      currency: supportedCryptoAsset,
      kind: 'CRYPTO_WALLET',
      network: supportedCryptoNetwork,
    },
  ],
} satisfies Prisma.AccountWhereInput;

export function isSupportedFiatCurrency(currency: Currency) {
  return supportedFiatCurrencies.includes(currency as (typeof supportedFiatCurrencies)[number]);
}
