import Avatar, { AvatarProps } from '@mui/material/Avatar';
import { ICON_SIZES } from 'src/theme/iconography';
import Iconify, { IconifyProps } from '../iconify';

export type UiIconBadgeTone = 'primary' | 'info' | 'success' | 'warning' | 'error' | 'neutral';

export type UiIconBadgeProps = Omit<AvatarProps, 'children' | 'color'> & {
  icon: IconifyProps;
  tone?: UiIconBadgeTone;
  size?: number;
  iconSize?: number;
};

export default function UiIconBadge({
  icon,
  tone = 'neutral',
  size = 40,
  iconSize = ICON_SIZES.navigation,
  variant = 'rounded',
  sx,
  ...other
}: UiIconBadgeProps) {
  const isNeutral = tone === 'neutral';

  return (
    <Avatar
      variant={variant}
      sx={{
        width: size,
        height: size,
        bgcolor: isNeutral ? 'background.neutral' : `${tone}.lighter`,
        color: isNeutral ? 'text.secondary' : `${tone}.dark`,
        ...sx,
      }}
      {...other}
    >
      <Iconify icon={icon} width={iconSize} />
    </Avatar>
  );
}
