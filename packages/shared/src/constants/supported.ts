export const SUPPORTED_LANGUAGES = ['en', 'es'] as const;
export type SupportedLanguage = (typeof SUPPORTED_LANGUAGES)[number];

export const SUPPORTED_CURRENCIES = ['EUR', 'USD', 'GBP', 'MXN', 'CHF'] as const;
export type SupportedCurrency = (typeof SUPPORTED_CURRENCIES)[number];
