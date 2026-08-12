export const ASSET_ICONS = {
  USD: 'circle-flags:us',
  SGD: 'circle-flags:sg',
  HKD: 'circle-flags:hk',
  EUR: 'circle-flags:eu',
  GBP: 'circle-flags:gb',
  USDT: 'cryptocurrency-color:usdt',
} as const;

export const NETWORK_META = {
  TRON: {
    name: 'TRON',
    standard: 'TRC20',
    icon: 'cryptocurrency-color:trx',
    color: '#EF3340',
    soft: '#FFF0F1',
  },
  ETHEREUM: {
    name: 'Ethereum',
    standard: 'ERC20',
    icon: 'cryptocurrency-color:eth',
    color: '#627EEA',
    soft: '#EEF1FF',
  },
  SOLANA: {
    name: 'Solana',
    standard: 'SPL',
    icon: 'cryptocurrency-color:sol',
    color: '#7C4DFF',
    soft: '#F3EDFF',
  },
  BSC: {
    name: 'BNB Smart Chain',
    standard: 'BEP20',
    icon: 'cryptocurrency-color:bnb',
    color: '#E9B719',
    soft: '#FFF8DF',
  },
} as const;

export const CRYPTO_NETWORK_OPTIONS = [
  { value: 'TRON', label: NETWORK_META.TRON.name, ...NETWORK_META.TRON },
  { value: 'ETHEREUM', label: NETWORK_META.ETHEREUM.name, ...NETWORK_META.ETHEREUM },
  { value: 'SOLANA', label: NETWORK_META.SOLANA.name, ...NETWORK_META.SOLANA },
  { value: 'BSC', label: NETWORK_META.BSC.name, ...NETWORK_META.BSC },
] as const;

export const USD_ASSET_ICON = ASSET_ICONS.USD;
export const USDT_ASSET_ICON = ASSET_ICONS.USDT;

export function getAssetIcon(asset: string) {
  return ASSET_ICONS[asset as keyof typeof ASSET_ICONS] || 'solar:wallet-money-bold-duotone';
}

export function getNetworkIcon(network?: string | null) {
  return network && network in NETWORK_META
    ? NETWORK_META[network as keyof typeof NETWORK_META].icon
    : 'solar:link-circle-bold-duotone';
}
