/**
 * THE one list of DayStream's languages (Phase 44; owner, 24 Nov 2026: one list for every language
 * choice, and a language is on it from the moment work on it starts).
 *
 * Everything that offers, validates or compares a language reads from here: the menu bar's language
 * choice, the customer record's language, document template, form and Check-In wording languages, the
 * customer import, the server's validation, and the translation command and checks. To add a language:
 *   1. add its code to SUPPORTED_LANGUAGES and its entry to LANGUAGE_DETAILS,
 *   2. run `npm run translate` to fill its translation files (phrases not translated yet show in English).
 * Nothing else needs to change.
 */
export const SUPPORTED_LANGUAGES = ['en', 'es'] as const;
export type SupportedLanguage = (typeof SUPPORTED_LANGUAGES)[number];

/** The same list, under the name the translation command and checks use. */
export const TRANSLATED_LANGUAGES = SUPPORTED_LANGUAGES;
export type TranslatedLanguage = SupportedLanguage;

/** The language used when none is chosen. */
export const DEFAULT_LANGUAGE: SupportedLanguage = 'en';

/**
 * How each language is named in its own language, its default format (the Intl locale used when the
 * device's regional setting is for another language, and for emails and documents), and other names
 * it is known by (lower case).
 */
export const LANGUAGE_DETAILS: Record<TranslatedLanguage, { label: string; locale: string; aliases: readonly string[] }> = {
  en: { label: 'English', locale: 'en-US', aliases: ['english', 'inglés', 'ingles'] },
  es: { label: 'Español', locale: 'es-ES', aliases: ['spanish', 'español', 'espanol', 'castellano'] },
};

/** The default format (Intl locale) of a language; English's for anything unknown. */
export function languageLocale(language: string | null | undefined): string {
  const d = (LANGUAGE_DETAILS as Record<string, { locale: string } | undefined>)[language ?? ''];
  return d?.locale ?? LANGUAGE_DETAILS.en.locale;
}

/** The label of each supported language, for dropdowns. */
export const LANGUAGE_LABELS = Object.fromEntries(
  SUPPORTED_LANGUAGES.map((code) => [code, LANGUAGE_DETAILS[code].label]),
) as Record<SupportedLanguage, string>;

/** The supported languages as dropdown options, in list order. */
export const LANGUAGE_OPTIONS: { code: SupportedLanguage; label: string }[] =
  SUPPORTED_LANGUAGES.map((code) => ({ code, label: LANGUAGE_DETAILS[code].label }));

export function isSupportedLanguage(value: unknown): value is SupportedLanguage {
  return typeof value === 'string' && (SUPPORTED_LANGUAGES as readonly string[]).includes(value);
}

/**
 * Read a language from free text: a code ("en", "en-US", "EN") or a name ("English").
 * Returns the supported code, or null when it is blank or not a supported language.
 */
export function languageFromText(value: unknown): SupportedLanguage | null {
  if (typeof value !== 'string') return null;
  const v = value.trim().toLowerCase().replace('_', '-');
  if (!v) return null;
  const base = v.split('-')[0];
  for (const code of SUPPORTED_LANGUAGES) {
    const d = LANGUAGE_DETAILS[code];
    if (v === code || base === code || d.label.toLowerCase() === v || d.aliases.includes(v)) return code;
  }
  return null;
}

/** The supported languages in words for messages: "English", "English and Spanish". */
export function supportedLanguagesText(): string {
  const names = SUPPORTED_LANGUAGES.map((c) => LANGUAGE_DETAILS[c].label);
  return names.length <= 1 ? names.join('') : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

export const SUPPORTED_CURRENCIES = ['EUR', 'USD', 'GBP', 'MXN', 'CHF'] as const;
export type SupportedCurrency = (typeof SUPPORTED_CURRENCIES)[number];
