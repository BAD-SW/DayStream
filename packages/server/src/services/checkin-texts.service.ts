import { adminPool } from '../db/pool';
import { logAudit } from './audit.service';
import {
  checkInTextFor, languageFromText, DEFAULT_LANGUAGE, EDITABLE_CHECK_IN_TEXT_KEYS, isSupportedLanguage,
} from '@daystream/shared';
import type { CheckInText } from '@daystream/shared';
import { msg } from '../i18n';

/**
 * The wording of the customer check-in screens (spec 51, gap 3). A business changes only the pieces it
 * wants to; the rest come from the built-in wording of the customer's language (shared package).
 * Scoped by business_id like the other business tables.
 */
export class CheckInTextError extends Error {
  code: string;
  constructor(message: string, code: string) { super(message); this.name = 'CheckInTextError'; this.code = code; }
}

const MAX_TEXT = 400;

/** The language a customer's screen uses: their own, then the business's, then the system default. */
export async function languageFor(businessId: string, customerLanguage?: string | null): Promise<string> {
  const own = languageFromText(customerLanguage);
  if (own) return own;
  const { rows } = await adminPool.query('SELECT default_language FROM sys_businesses WHERE id = $1', [businessId]);
  return languageFromText(rows[0]?.default_language) ?? DEFAULT_LANGUAGE;
}

/** What the business changed for one language (only the changed pieces). */
export async function getOverrides(businessId: string, language: string): Promise<Record<string, string>> {
  const { rows } = await adminPool.query(
    'SELECT texts FROM apt_check_in_texts WHERE business_id = $1 AND language = $2', [businessId, language],
  );
  return (rows[0]?.texts ?? {}) as Record<string, string>;
}

/** The platform's wording for one language (spec 51, gap 17, criterion 9): only the changed pieces. */
export async function getSystemTexts(language: string): Promise<Record<string, string>> {
  const { rows } = await adminPool.query('SELECT texts FROM sys_check_in_texts WHERE language = $1', [language]);
  return (rows[0]?.texts ?? {}) as Record<string, string>;
}

/** The wording a business starts from: the platform's over the language's built-in wording. */
export async function platformTexts(language: string): Promise<CheckInText> {
  return checkInTextFor(language, await getSystemTexts(language));
}

/** The complete wording for a screen: the business's changes over the platform's over the built-in wording. */
export async function resolveTexts(businessId: string, language: string): Promise<CheckInText> {
  return checkInTextFor(language, { ...(await getSystemTexts(language)), ...(await getOverrides(businessId, language)) });
}

/** Only known pieces, as trimmed text; a blank piece is left out (it goes back to the wording below it). */
function cleanTexts(input: Record<string, unknown>): Record<string, string> {
  const clean: Record<string, string> = {};
  for (const [key, value] of Object.entries(input)) {
    if (!(EDITABLE_CHECK_IN_TEXT_KEYS as readonly string[]).includes(key)) throw new CheckInTextError(msg('errors:checkinTexts.isNotWordingThatCanBe', { key }), 'INVALID_TEXT');
    if (value === null || value === undefined) continue;
    if (typeof value !== 'string') throw new CheckInTextError(msg('errors:checkinTexts.wordingMustBeText'), 'INVALID_TEXT');
    const v = value.trim();
    if (v === '') continue;
    if (v.length > MAX_TEXT) throw new CheckInTextError(msg('errors:checkinTexts.aPieceOfWordingIsToo'), 'INVALID_TEXT');
    clean[key] = v;
  }
  return clean;
}

/** Saves the platform's wording for a language (platform administrators). */
export async function saveSystemTexts(language: string, input: Record<string, unknown>, actor: { userId: string; tenantId: string }): Promise<Record<string, string>> {
  if (!isSupportedLanguage(language)) throw new CheckInTextError(msg('errors:checkinTexts.chooseASupportedLanguage'), 'INVALID_LANGUAGE');
  const clean = cleanTexts(input);
  await adminPool.query(
    `INSERT INTO sys_check_in_texts (language, texts, updated_by) VALUES ($1, $2, $3)
     ON CONFLICT (language) DO UPDATE SET texts = EXCLUDED.texts, updated_by = EXCLUDED.updated_by, updated_at = NOW()`,
    [language, JSON.stringify(clean), actor.userId]);
  await logAudit({ tenantId: actor.tenantId, userId: actor.userId, action: 'checkin.system_texts_updated', resourceType: 'sys_check_in_texts', details: { language, changed: Object.keys(clean) } }).catch(() => undefined);
  return clean;
}

/** Saves the business's wording for a language. A blank piece goes back to the built-in wording. */
export async function saveOverrides(
  businessId: string, tenantId: string, userId: string, language: string, input: Record<string, unknown>,
): Promise<Record<string, string>> {
  if (!isSupportedLanguage(language)) throw new CheckInTextError(msg('errors:checkinTexts.chooseASupportedLanguage'), 'INVALID_LANGUAGE');
  const clean = cleanTexts(input);
  await adminPool.query(
    `INSERT INTO apt_check_in_texts (tenant_id, business_id, language, texts, updated_by)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (business_id, language) DO UPDATE SET texts = EXCLUDED.texts, updated_by = EXCLUDED.updated_by, updated_at = NOW()`,
    [tenantId, businessId, language, JSON.stringify(clean), userId],
  );
  await logAudit({
    tenantId, userId, action: 'checkin.texts_updated', resourceType: 'apt_check_in_texts',
    details: { businessId, language, changed: Object.keys(clean) },
  });
  return clean;
}
