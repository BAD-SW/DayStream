import { SUPPORTED_LANGUAGES } from '../constants/supported';
import type { SupportedLanguage } from '../constants/supported';

/**
 * Phase 44, requirements 8 and 9: a business's languages, and the offering texts it translates.
 */

/** What can be translated, per kind of record (design 14.1). */
export const TRANSLATABLE_FIELDS = {
  service: ['name', 'short_description', 'description'],
  product: ['name', 'short_description', 'description'],
  membership: ['name', 'short_description', 'description'],
  package: ['name', 'short_description', 'description'],
  service_option: ['name'],
  addon: ['name', 'description'],
} as const;

export type TranslatableEntity = keyof typeof TRANSLATABLE_FIELDS;
export type TranslatableField = 'name' | 'short_description' | 'description';
export type TranslationFields = Partial<Record<TranslatableField, string>>;

export const TRANSLATABLE_ENTITIES = Object.keys(TRANSLATABLE_FIELDS) as TranslatableEntity[];

export function isTranslatableEntity(value: unknown): value is TranslatableEntity {
  return typeof value === 'string' && (TRANSLATABLE_ENTITIES as string[]).includes(value);
}

/**
 * A business's languages: its default language first, then the others it chose, kept to DayStream's
 * list and in list order. Unknown codes are dropped.
 */
export function businessLanguages(defaultLanguage: string | null | undefined, chosen: readonly string[] | null | undefined): SupportedLanguage[] {
  const list = SUPPORTED_LANGUAGES as readonly string[];
  const def = (defaultLanguage && list.includes(defaultLanguage) ? defaultLanguage : 'en') as SupportedLanguage;
  const others = (SUPPORTED_LANGUAGES as readonly SupportedLanguage[]).filter((l) => l !== def && (chosen ?? []).includes(l));
  return [def, ...others];
}
