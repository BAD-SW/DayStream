import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import { DEFAULT_LANGUAGE, LANGUAGE_DETAILS, SUPPORTED_LANGUAGES, isSupportedLanguage, languageFromText, languageLocale } from '@daystream/shared';
import type { SupportedLanguage } from '@daystream/shared';

/**
 * The web app's languages (Phase 44, design sections 3 and 4).
 *
 * English is bundled; every other language's files are loaded the first time it is shown, so English
 * users never download them. A phrase with no translation shows in English (requirement 1.6).
 */

// English, bundled: every namespace file in locales/en.
const englishFiles = import.meta.glob<{ default: Record<string, unknown> }>('./locales/en/*.json', { eager: true });
// The other languages, loaded on demand.
const otherFiles = import.meta.glob<{ default: Record<string, unknown> }>(['./locales/*/*.json', '!./locales/en/*.json']);

const namespaceOf = (path: string) => path.slice(path.lastIndexOf('/') + 1, -'.json'.length);
const languageOf = (path: string) => path.split('/')[2];

const english: Record<string, Record<string, unknown>> = {};
for (const [path, mod] of Object.entries(englishFiles)) english[namespaceOf(path)] = mod.default;
export const NAMESPACES = Object.keys(english);

const loaded = new Set<string>([DEFAULT_LANGUAGE]);

/** Load a language's files once, before it is shown. */
async function loadLanguage(language: string): Promise<void> {
  if (loaded.has(language)) return;
  const files = Object.entries(otherFiles).filter(([path]) => languageOf(path) === language);
  await Promise.all(files.map(async ([path, load]) => {
    const mod = await load();
    i18n.addResourceBundle(language, namespaceOf(path), mod.default, true, true);
  }));
  loaded.add(language);
}

// ─── Which language to show (design section 3.1) ─────────────────────────────

const DEVICE_KEY = 'language';             // the choice made in the menu bar on this device
const UNSAVED_KEY = 'language_unsaved';    // set when it was made while signed out (saved at sign-in)

/** The language picked in the menu bar on this device, if it is still offered. */
export function deviceChoice(): SupportedLanguage | null {
  const stored = localStorage.getItem(DEVICE_KEY);
  return isSupportedLanguage(stored) ? stored : null;
}

/** True when the device's choice was made while signed out and is not on the account yet. */
export function deviceChoiceUnsaved(): boolean {
  return localStorage.getItem(UNSAVED_KEY) === '1';
}

/** Remember a menu bar choice on this device. */
export function rememberChoice(language: SupportedLanguage, signedIn: boolean): void {
  localStorage.setItem(DEVICE_KEY, language);
  if (signedIn) localStorage.removeItem(UNSAVED_KEY);
  else localStorage.setItem(UNSAVED_KEY, '1');
}

export function markChoiceSaved(): void {
  localStorage.removeItem(UNSAVED_KEY);
}

/** The first of the browser's languages that is offered (es-MX counts as Spanish), or null. */
export function browserLanguage(offered?: readonly string[]): SupportedLanguage | null {
  const list = navigator.languages?.length ? navigator.languages : [navigator.language];
  for (const tag of list) {
    const lang = languageFromText(tag);
    if (lang && (!offered || offered.includes(lang))) return lang;
  }
  return null;
}

/**
 * The language to show: the System persona always sees English; otherwise the account's saved
 * language, else the choice made on this device, else the browser's language, else English.
 * When working in a business, only its languages are offered (`offered`, its default first): a choice
 * it does not offer is passed over (and kept, for when the business offers it again), and with none
 * left the business's default language is shown (Phase 44, requirement 8.3).
 */
export function resolveLanguage(opts: { persona: string | null; accountLanguage: string | null | undefined; offered?: readonly string[] }): SupportedLanguage {
  if (opts.persona === 'system') return DEFAULT_LANGUAGE;
  const ok = (l: string | null | undefined): l is SupportedLanguage => isSupportedLanguage(l) && (!opts.offered || opts.offered.includes(l));
  if (ok(opts.accountLanguage)) return opts.accountLanguage;
  const device = deviceChoice();
  if (ok(device)) return device;
  const browser = browserLanguage(opts.offered);
  if (browser) return browser;
  const first = opts.offered?.[0];
  return isSupportedLanguage(first) ? first : DEFAULT_LANGUAGE;
}

/** Show a language: load it if needed, switch, and set <html lang> for screen readers. */
export async function showLanguage(language: string): Promise<void> {
  const lang = isSupportedLanguage(language) ? language : DEFAULT_LANGUAGE;
  await loadLanguage(lang);
  if (i18n.language !== lang) await i18n.changeLanguage(lang);
  document.documentElement.lang = lang;
}

// ─── Formats (design section 5) ──────────────────────────────────────────────

/**
 * The Intl locale for dates and numbers: the device's regional setting when it is for the language
 * shown (en-GB or en-US for English), otherwise the language's own default (es-ES for Spanish).
 */
export function currentLocale(): string {
  const shown = i18n.language || DEFAULT_LANGUAGE;
  const list = navigator.languages?.length ? navigator.languages : [navigator.language];
  const device = list.find((tag) => tag && tag.toLowerCase().split('-')[0] === shown);
  if (device) {
    try { return Intl.getCanonicalLocales(device)[0]; } catch { /* not a valid tag */ }
  }
  return languageLocale(shown);
}

/** The language being shown, as the server's Accept-Language. */
export function currentLanguage(): string {
  return i18n.language || DEFAULT_LANGUAGE;
}

// ─── Start-up ────────────────────────────────────────────────────────────────

const initial = resolveLanguage({ persona: null, accountLanguage: null });

i18n.use(initReactI18next).init({
  resources: { [DEFAULT_LANGUAGE]: english },
  lng: DEFAULT_LANGUAGE,
  fallbackLng: DEFAULT_LANGUAGE,
  supportedLngs: [...SUPPORTED_LANGUAGES],
  ns: NAMESPACES,
  defaultNS: 'common',
  // Keys are flat dot paths ("bookings.list.empty"), not nested objects.
  keySeparator: false,
  interpolation: { escapeValue: false },
  returnNull: false,
});
document.documentElement.lang = DEFAULT_LANGUAGE;
if (initial !== DEFAULT_LANGUAGE) void showLanguage(initial);

/** Every language's own name, for the menu bar (requirement 1.5). */
export const languageLabel = (code: SupportedLanguage) => LANGUAGE_DETAILS[code].label;

export default i18n;
