import { useTranslation } from 'react-i18next';
import i18n from './i18n';

export type PortalTranslationValues = Record<string, string | number | boolean | undefined>;

export function portalText(key: string, values?: PortalTranslationValues) {
  return i18n.t(key, {
    ns: 'portal',
    keySeparator: false,
    defaultValue: key,
    ...values,
  });
}

export function portalLocale() {
  return i18n.resolvedLanguage === 'cn' || i18n.language === 'cn' ? 'zh-CN' : 'en-US';
}

export function usePortalLanguage() {
  const { i18n: activeI18n } = useTranslation('portal');
  return activeI18n.resolvedLanguage === 'cn' || activeI18n.language === 'cn' ? 'zh-CN' : 'en-US';
}
