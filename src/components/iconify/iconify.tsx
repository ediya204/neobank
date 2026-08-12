import { forwardRef } from 'react';
// icons
import { Icon } from '@iconify/react';
// @mui
import Box, { BoxProps } from '@mui/material/Box';
import { ICON_SIZES, normalizeUiIcon } from 'src/theme/iconography';
//
import { IconifyProps } from './types';

// ----------------------------------------------------------------------

interface Props extends BoxProps {
  icon: IconifyProps;
}

const Iconify = forwardRef<SVGElement, Props>(
  ({ icon, width = ICON_SIZES.default, sx, ...other }, ref) => {
    const accessible = Boolean(other['aria-label'] || other['aria-labelledby']);

    return (
      <Box
        ref={ref}
        component={Icon}
        className="component-iconify"
        icon={typeof icon === 'string' ? normalizeUiIcon(icon) : icon}
        aria-hidden={accessible ? undefined : true}
        focusable="false"
        sx={{ width, height: width, display: 'inline-flex', flexShrink: 0, ...sx }}
        {...other}
      />
    );
  }
);

export default Iconify;
