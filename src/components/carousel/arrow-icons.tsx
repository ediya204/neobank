//
import Iconify, { IconifyProps } from '../iconify';

// ----------------------------------------------------------------------

type Props = {
  icon?: IconifyProps; // Right icon
  isRTL?: boolean;
};

export function LeftIcon({ icon = 'solar:alt-arrow-right-linear', isRTL }: Props) {
  return (
    <Iconify
      icon={icon}
      sx={{
        transform: ' scaleX(-1)',
        ...(isRTL && {
          transform: ' scaleX(1)',
        }),
      }}
    />
  );
}

export function RightIcon({ icon = 'solar:alt-arrow-right-linear', isRTL }: Props) {
  return (
    <Iconify
      icon={icon}
      sx={{
        ...(isRTL && {
          transform: ' scaleX(-1)',
        }),
      }}
    />
  );
}
