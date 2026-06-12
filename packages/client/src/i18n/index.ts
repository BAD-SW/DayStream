import i18n from 'i18next';
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

// Detect language: browser → fallback 'en'
function detectLanguage(): string {
  const stored = localStorage.getItem('language');
  if (stored && ['en', 'es'].includes(stored)) return stored;

  const browser = navigator.language.split('-')[0];
  if (['en', 'es'].includes(browser)) return browser;

  return 'en';
}

i18n.use(initReactI18next).init({
  resources,
  lng: detectLanguage(),
  fallbackLng: 'en',
  ns: ['common', 'auth', 'errors'],
  defaultNS: 'common',
  interpolation: { escapeValue: false },
});

export default i18n;
