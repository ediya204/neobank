import { Box } from '@mui/material';
import { ICON_SIZES } from 'src/theme/iconography';
import { getAssetIcon, getNetworkIcon, NETWORK_META } from 'src/utils/asset-icons';
import Iconify from '../iconify';

export type AssetIconProps = {
  asset: string;
  network?: string | null;
  size?: number;
};

export default function AssetIcon({ asset, network, size = ICON_SIZES.feature }: AssetIconProps) {
  const showNetworkBadge = asset === 'USDT' && Boolean(network && network in NETWORK_META);

  if (showNetworkBadge) {
    return (
      <Box
        role="img"
        aria-label={`${asset} on ${network}`}
        sx={{ width: size, height: size, position: 'relative', flexShrink: 0 }}
      >
        <Iconify icon={getAssetIcon(asset)} width={size * 0.78} />
        <Box
          sx={{
            position: 'absolute',
            right: 0,
            bottom: 0,
            width: size * 0.46,
            height: size * 0.46,
            borderRadius: '50%',
            bgcolor: 'background.paper',
            boxShadow: '0 0 0 2px',
            color: 'background.paper',
            display: 'grid',
            placeItems: 'center',
          }}
        >
          <Iconify icon={getNetworkIcon(network)} width={size * 0.38} />
        </Box>
      </Box>
    );
  }

  return <Iconify role="img" aria-label={asset} icon={getAssetIcon(asset)} width={size} />;
}
