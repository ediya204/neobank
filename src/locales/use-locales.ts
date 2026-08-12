import { useTranslation } from 'react-i18next';
import { useCallback, useEffect } from 'react';
// utils
import { localStorageGetItem } from 'src/utils/storage-available';
// components
import { useSettingsContext } from 'src/components/settings';
//
import { allLangs, defaultLang, normalizeLanguage } from './config-lang';

// ----------------------------------------------------------------------

export default function useLocales() {
  const { i18n, t } = useTranslation();

  const settings = useSettingsContext();

  const langStorage = localStorageGetItem('i18nextLng');
  const activeLanguage = normalizeLanguage(
    i18n.resolvedLanguage || i18n.language || langStorage || defaultLang.value
  );

  const currentLang =
    allLangs.find((lang) => lang.value === activeLanguage) ||
    allLangs.find((lang) => lang.value === langStorage) ||
    defaultLang;

  useEffect(() => {
    document.documentElement.lang = currentLang.htmlLang;
    document.documentElement.dir = currentLang.direction;
  }, [currentLang.direction, currentLang.htmlLang]);

  const onChangeLang = useCallback(
    (newlang: string) => {
      const nextLanguage = normalizeLanguage(newlang);

      i18n.changeLanguage(nextLanguage);
      settings.onChangeDirectionByLang(nextLanguage);
    },
    [i18n, settings]
  );

  return {
    allLangs,
    t,
    currentLang,
    onChangeLang,
  };
}
