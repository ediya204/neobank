import i18n from 'i18next';
import LanguageDetector from 'i18next-browser-languagedetector';
import { initReactI18next } from 'react-i18next';
// utils
import { localStorageGetItem } from 'src/utils/storage-available';
//
import { defaultLang, normalizeLanguage } from './config-lang';
//
import translationEn from './langs/en.json';
import translationCn from './langs/cn.json';
import commonEn from './langs/common.en.json';
import commonCn from './langs/common.cn.json';
import portalEn from './langs/portal.en.json';
import portalCn from './langs/portal.cn.json';
import adminEn from './langs/admin.en.json';
import adminCn from './langs/admin.cn.json';
import operationsEn from './langs/operations.en.json';
import operationsCn from './langs/operations.cn.json';

// ----------------------------------------------------------------------

const storedLanguage = localStorageGetItem('i18nextLng');
const browserLanguage =
  typeof navigator === 'undefined' ? '' : navigator.languages?.[0] || navigator.language;
const lng = normalizeLanguage(storedLanguage || browserLanguage || defaultLang.value);

i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources: {
      en: {
        translations: translationEn,
        common: commonEn,
        portal: portalEn,
        admin: adminEn,
        operations: operationsEn,
      },
      cn: {
        translations: translationCn,
        common: commonCn,
        portal: portalCn,
        admin: adminCn,
        operations: operationsCn,
      },
    },
    lng,
    fallbackLng: 'en',
    supportedLngs: ['en', 'cn'],
    nonExplicitSupportedLngs: false,
    debug: false,
    ns: ['translations', 'common', 'portal', 'admin', 'operations'],
    defaultNS: 'translations',
    returnNull: false,
    returnEmptyString: false,
    interpolation: {
      escapeValue: false,
    },
  });

function syncDocumentLanguage(language: string) {
  if (typeof document === 'undefined') return;

  const normalizedLanguage = normalizeLanguage(language);
  document.documentElement.lang = normalizedLanguage === 'cn' ? 'zh-CN' : 'en-US';
  document.documentElement.dir = 'ltr';
}

syncDocumentLanguage(lng);
i18n.on('languageChanged', syncDocumentLanguage);

export default i18n;
