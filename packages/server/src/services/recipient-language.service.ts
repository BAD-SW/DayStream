import { TRANSLATED_LANGUAGES } from '@daystream/shared';
import { adminPool } from '../db/pool';

/**
 * The language to write to someone in (Phase 44, requirement 5): a customer's is the language on their
 * customer record; a staff member's is the language saved on their account. Null when none is set or
 * it is not a language with translations, which means English.
 */

const known = (value: unknown): string | null =>
  typeof value === 'string' && (TRANSLATED_LANGUAGES as readonly string[]).includes(value.toLowerCase()) ? value.toLowerCase() : null;

export async function customerLanguage(customerId: string | null | undefined): Promise<string | null> {
  if (!customerId) return null;
  const { rows } = await adminPool.query('SELECT preferred_language FROM cus_customers WHERE id = $1', [customerId]);
  return known(rows[0]?.preferred_language);
}

export async function userLanguage(userId: string | null | undefined): Promise<string | null> {
  if (!userId) return null;
  const { rows } = await adminPool.query('SELECT preferred_language FROM usr_users WHERE id = $1', [userId]);
  return known(rows[0]?.preferred_language);
}

/** A notification's recipient: a customer (their record's language) or a staff member (their account's). */
export async function recipientLanguage(recipientId: string | null | undefined): Promise<string | null> {
  if (!recipientId) return null;
  const { rows } = await adminPool.query(
    `SELECT (SELECT preferred_language FROM cus_customers WHERE id = $1) AS customer,
            (SELECT preferred_language FROM usr_users WHERE id = $1) AS staff`,
    [recipientId],
  );
  return known(rows[0]?.customer) ?? known(rows[0]?.staff);
}
