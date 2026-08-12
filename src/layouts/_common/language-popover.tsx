import { useCallback } from 'react';
import { m } from 'framer-motion';
// @mui
import MenuItem from '@mui/material/MenuItem';
import IconButton from '@mui/material/IconButton';
// locales
import { useLocales } from 'src/locales';
// components
import Iconify from 'src/components/iconify';
import { varHover } from 'src/components/animate';
import CustomPopover, { usePopover } from 'src/components/custom-popover';

// ----------------------------------------------------------------------

export default function LanguagePopover() {
  const locales = useLocales();

  const popover = usePopover();
  const languageLabel = (value: string) =>
    value === 'cn' ? locales.t('language.chinese', { ns: 'common' }) : locales.t('language.english', { ns: 'common' });

  const handleChangeLang = useCallback(
    (newLang: string) => {
      locales.onChangeLang(newLang);
      popover.onClose();
    },
    [locales, popover]
  );

  return (
    <>
      <IconButton
        aria-label={locales.t('language.label', { ns: 'common' })}
        component={m.button}
        whileTap="tap"
        whileHover="hover"
        variants={varHover(1.05)}
        onClick={popover.onOpen}
        sx={{
          width: 40,
          height: 40,
          ...(popover.open && {
            bgcolor: 'action.selected',
          }),
        }}
      >
        <Iconify icon={locales.currentLang.icon} sx={{ borderRadius: 0.65, width: 28 }} />
      </IconButton>

      <CustomPopover open={popover.open} onClose={popover.onClose} sx={{ width: 160 }}>
        {locales.allLangs.map((option) => (
          <MenuItem
            key={option.value}
            selected={option.value === locales.currentLang.value}
            onClick={() => handleChangeLang(option.value)}
            aria-label={locales.t('language.switch_to', {
              ns: 'common',
              language: languageLabel(option.value),
            })}
          >
            <Iconify icon={option.icon} sx={{ borderRadius: 0.65, width: 28 }} />

            {languageLabel(option.value)}
          </MenuItem>
        ))}
      </CustomPopover>
    </>
  );
}
