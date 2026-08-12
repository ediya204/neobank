import merge from 'lodash/merge';
import { enUS as enUSAdapter, zhCN as zhCNAdapter } from 'date-fns/locale';
// core
import { enUS as enUSCore, zhCN as zhCNCore } from '@mui/material/locale';
// date-pickers
import { enUS as enUSDate, zhCN as zhCNDate } from '@mui/x-date-pickers/locales';
// data-grid
import { enUS as enUSDataGrid, zhCN as zhCNDataGrid } from '@mui/x-data-grid';

// PLEASE REMOVE `LOCAL STORAGE` WHEN YOU CHANGE SETTINGS.
// ----------------------------------------------------------------------

export type AppLanguage = 'en' | 'cn';

export function normalizeLanguage(language?: string | null): AppLanguage {
  const normalized = language?.trim().toLowerCase() || '';

  return normalized === 'cn' || normalized.startsWith('zh') ? 'cn' : 'en';
}

export const allLangs = [
  {
    label: 'English (US)',
    value: 'en',
    htmlLang: 'en-US',
    direction: 'ltr' as const,
    systemValue: merge(enUSDate, enUSDataGrid, enUSCore),
    adapterLocale: enUSAdapter,
    icon: 'flagpack:us',
  },
  {
    label: '简体中文',
    value: 'cn',
    htmlLang: 'zh-CN',
    direction: 'ltr' as const,
    systemValue: merge(zhCNDate, zhCNDataGrid, zhCNCore),
    adapterLocale: zhCNAdapter,
    icon: 'flagpack:cn',
  },
];

export const defaultLang = allLangs[0]; // English

// GET MORE COUNTRY FLAGS
// https://icon-sets.iconify.design/flagpack/
// https://www.dropbox.com/sh/nec1vwswr9lqbh9/AAB9ufC8iccxvtWi3rzZvndLa?dl=0
