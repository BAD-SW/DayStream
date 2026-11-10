/**
 * THE one place that says which languages DayStream supports.
 *
 * Everything that offers, validates or compares a language reads from here: the language switcher,
 * customers' and businesses' language dropdowns, form and document-template languages, the
 * customer import, and the server's API validation. To add a language:
 *   1. add its code to SUPPORTED_LANGUAGES,
 *   2. add its entry to LANGUAGE_DETAILS (TypeScript will not compile until you do),
 *   3. provide its interface translations (client i18n resources and server messages).
 * Nothing else needs to change.
 */
export const SUPPORTED_LANGUAGES = ['en'] as const;
export type SupportedLanguage = (typeof SUPPORTED_LANGUAGES)[number];

/** The language used when none is chosen. */
export const DEFAULT_LANGUAGE: SupportedLanguage = 'en';

/** How each language is named in its own language, plus other names it is known by (lower case). */
export const LANGUAGE_DETAILS: Record<SupportedLanguage, { label: string; aliases: readonly string[] }> = {
  en: { label: 'English', aliases: ['english', 'inglés', 'ingles'] },
};

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
