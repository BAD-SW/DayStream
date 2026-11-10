import i18n from 'i18next';
import { isSupportedLanguage, DEFAULT_LANGUAGE, SUPPORTED_LANGUAGES } from '@daystream/shared';
import { initReactI18next } from 'react-i18next';

import enCommon from './locales/en/common.json';
import enAuth from './locales/en/auth.json';
import enErrors from './locales/en/errors.json';
import esCommon from './locales/es/common.json';
import esAuth from './locales/es/auth.json';
import esErrors from './locales/es/errors.json';

const resources = {
  en: { common: enCommon, auth: enAuth, errors: enErrors },
  es: { common: esCommon, auth: esAuth, errors: esErrors },
};

// Which languages are offered is decided by the shared supported list. The translations loaded
// above for a language that is not on that list (Spanish) stay unused until it is added.
// Detect language: remembered choice → browser → default.
function detectLanguage(): string {
  const stored = localStorage.getItem('language');
  if (isSupportedLanguage(stored)) return stored;

  const browser = navigator.language.split('-')[0];
  if (isSupportedLanguage(browser)) return browser;

  return DEFAULT_LANGUAGE;
}

i18n.use(initReactI18next).init({
  resources,
  lng: detectLanguage(),
  fallbackLng: DEFAULT_LANGUAGE,
  supportedLngs: [...SUPPORTED_LANGUAGES],
  ns: ['common', 'auth', 'errors'],
  defaultNS: 'common',
  interpolation: { escapeValue: false },
});

export default i18n;
