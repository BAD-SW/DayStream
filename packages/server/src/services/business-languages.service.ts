import { SUPPORTED_LANGUAGES, businessLanguages } from '@daystream/shared';
import type { SupportedLanguage } from '@daystream/shared';
import { adminPool } from '../db/pool';

/**
 * A business's languages (Phase 44, requirement 8): its default language first, then the others it
 * chose from DayStream's list. They narrow its customer record, template, form and Check-In languages,
 * its translation tables, and its public pages' language menu.
 */

export interface BusinessLanguages {
  defaultLanguage: SupportedLanguage;
  languages: SupportedLanguage[];
}

export async function getBusinessLanguages(businessId: string): Promise<BusinessLanguages | null> {
  const { rows } = await adminPool.query('SELECT default_language, languages FROM sys_businesses WHERE id = $1', [businessId]);
  if (!rows[0]) return null;
  const languages = businessLanguages(rows[0].default_language, rows[0].languages);
  return { defaultLanguage: languages[0], languages };
}

/** Save the business's other languages; codes not on DayStream's list are dropped, the default is always kept. */
export async function setBusinessLanguages(businessId: string, chosen: readonly string[]): Promise<BusinessLanguages | null> {
  const known = chosen.filter((l) => (SUPPORTED_LANGUAGES as readonly string[]).includes(l));
  const { rows } = await adminPool.query(
    `UPDATE sys_businesses SET languages = $2, updated_at = NOW() WHERE id = $1 RETURNING default_language, languages`,
    [businessId, known],
  );
  if (!rows[0]) return null;
  const languages = businessLanguages(rows[0].default_language, rows[0].languages);
  return { defaultLanguage: languages[0], languages };
}
