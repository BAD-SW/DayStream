import { parsePhoneNumberFromString, CountryCode } from 'libphonenumber-js';
import { countryNameToIso2 } from '@daystream/shared';
import { adminPool } from '../db/pool';
import { createActivity } from './customer-activity.service';
import { logAudit } from './audit.service';
import { logger } from '../middleware/logger';

/**
 * Phase 46 — the single way a person (a row of cus_customers) comes into existence.
 *
 * Every entry point (manual entry, import, booking widget, registration, lead form, inbound
 * message) calls findOrCreatePerson, so the same human ends up on the same record however
 * they reach the business. Matching rules (requirements.md R3):
 *   1. email, ignoring case
 *   2. phone, when exactly one person in the business has it
 *   3. otherwise a new person; several phone matches are flagged as possible duplicates
 * Names never match. Nothing matches across businesses.
 */

export const PERSON_SOURCES = [
  'manual', 'import', 'booking_widget', 'online_registration', 'lead_form',
  'inbound_message', 'referral', 'walk_in', 'api', 'unknown',
] as const;
export type PersonSource = typeof PERSON_SOURCES[number];

export const SOURCE_LABELS: Record<PersonSource, string> = {
  manual: 'Added by staff',
  import: 'Import',
  booking_widget: 'Booking widget',
  online_registration: 'Online registration',
  lead_form: 'Lead form',
  inbound_message: 'Inbound message',
  referral: 'Referral',
  walk_in: 'Walk-in',
  api: 'API',
  unknown: 'Unknown',
};

export interface PersonInput {
  businessId: string;
  tenantId: string;
  email?: string | null;
  phone?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  source: PersonSource;
  sourceDetail?: string | null;
  /** Stage for a NEW person. Defaults to 'lead'. Never changes an existing person's stage. */
  initialStage?: string;
  /** The login this person owns, when the caller is that logged-in customer. */
  userId?: string | null;
  /** Who is doing this (a staff member, or the customer themselves). */
  actorUserId?: string | null;
  dateOfBirth?: string | null;
  gender?: string | null;
  preferredLanguage?: string | null;
  country?: string | null;
}

export interface PersonResult {
  person: any;
  created: boolean;
  matchedBy: 'email' | 'phone' | null;
  duplicateFlagIds: string[];
}

export class ContactPointRequiredError extends Error {
  code = 'CONTACT_POINT_REQUIRED';
  constructor() { super('An email address or a phone number is required'); }
}

export function normaliseEmail(email: string | null | undefined): string | null {
  const e = (email || '').trim().toLowerCase();
  return e === '' ? null : e;
}

/** International format (+34600111222), or null when the text is not a recognisable number. */
export function normalisePhone(phone: string | null | undefined, defaultRegion?: string | null): string | null {
  const raw = (phone || '').trim();
  if (raw === '') return null;
  try {
    const parsed = parsePhoneNumberFromString(raw, (defaultRegion || undefined) as CountryCode | undefined);
    if (parsed && parsed.isPossible()) return parsed.number;
  } catch { /* fall through */ }
  return null;
}

const regionCache = new Map<string, string | null>();

/** Region used to read phone numbers typed without a country prefix: taken from the business's own phone. */
export async function defaultRegionFor(businessId: string): Promise<string | null> {
  if (regionCache.has(businessId)) return regionCache.get(businessId)!;
  let region: string | null = null;
  try {
    const { rows } = await adminPool.query('SELECT phone FROM sys_businesses WHERE id = $1', [businessId]);
    const parsed = rows[0]?.phone ? parsePhoneNumberFromString(String(rows[0].phone)) : undefined;
    region = parsed?.country || null;
  } catch { region = null; }
  regionCache.set(businessId, region);
  return region;
}

async function regionForInput(input: { businessId: string; country?: string | null }): Promise<string | null> {
  return countryNameToIso2(input.country) || (await defaultRegionFor(input.businessId));
}

const LIVE = "status NOT IN ('merged', 'anonymized')";

/** Find the person a contact point belongs to, by the matching rules above. */
export async function findPersonByContactPoint(
  businessId: string,
  cp: { email?: string | null; phone?: string | null; country?: string | null },
): Promise<{ person: any | null; matchedBy: 'email' | 'phone' | null; phoneMatches: any[] }> {
  const email = normaliseEmail(cp.email);
  if (email) {
    const { rows } = await adminPool.query(
      `SELECT * FROM cus_customers WHERE business_id = $1 AND LOWER(email) = $2 AND ${LIVE} LIMIT 1`,
      [businessId, email],
    );
    if (rows[0]) return { person: rows[0], matchedBy: 'email', phoneMatches: [] };
  }

  const e164 = normalisePhone(cp.phone, await regionForInput({ businessId, country: cp.country }));
  if (e164) {
    const { rows } = await adminPool.query(
      `SELECT * FROM cus_customers WHERE business_id = $1 AND phone_e164 = $2 AND ${LIVE} ORDER BY created_at`,
      [businessId, e164],
    );
    // A phone match only counts when the incoming email does not contradict it: two people can
    // share a phone (a family), and a different email says this is someone else.
    const compatible = rows.filter((r) => !email || !r.email);
    if (rows.length === 1 && compatible.length === 1) return { person: rows[0], matchedBy: 'phone', phoneMatches: rows };
    return { person: null, matchedBy: null, phoneMatches: rows };
  }

  return { person: null, matchedBy: null, phoneMatches: [] };
}

/**
 * Return the existing person for these contact details, or create one.
 * An existing person has their empty details filled in; nothing already present is overwritten,
 * and their source and stage never change.
 */
export async function findOrCreatePerson(input: PersonInput): Promise<PersonResult> {
  const email = normaliseEmail(input.email);
  const phoneRaw = (input.phone || '').trim() || null;
  if (!email && !phoneRaw) throw new ContactPointRequiredError();

  const region = await regionForInput(input);
  const e164 = normalisePhone(phoneRaw, region);

  const match = await findPersonByContactPoint(input.businessId, { email, phone: phoneRaw, country: input.country });
  if (match.person) {
    const person = await fillEmptyDetails(match.person, input, email, phoneRaw, e164);
    await createActivity({
      customerId: person.id,
      businessId: input.businessId,
      activityType: 'identity_match',
      description: `Recognised again via ${SOURCE_LABELS[input.source].toLowerCase()}${input.sourceDetail ? ` (${input.sourceDetail})` : ''}`,
      metadata: { source: input.source, source_detail: input.sourceDetail || null, matched_by: match.matchedBy },
      createdBy: input.actorUserId || undefined,
    });
    return { person, created: false, matchedBy: match.matchedBy, duplicateFlagIds: [] };
  }

  let person: any;
  try {
    person = await insertPerson(input, email, phoneRaw, e164);
  } catch (err: any) {
    // Two requests created the same email at the same moment: the unique index stopped the
    // second one, so return the person the first one created.
    if (err?.code === '23505' && email) {
      const again = await findPersonByContactPoint(input.businessId, { email });
      if (again.person) return { person: again.person, created: false, matchedBy: 'email', duplicateFlagIds: [] };
    }
    throw err;
  }

  const duplicateFlagIds: string[] = [];
  for (const other of match.phoneMatches) {
    const { rows } = await adminPool.query(
      `INSERT INTO cus_duplicate_flags (tenant_id, business_id, customer_id, other_customer_id, match_type)
       VALUES ($1, $2, $3, $4, 'phone')
       ON CONFLICT (customer_id, other_customer_id) DO NOTHING
       RETURNING id`,
      [input.tenantId, input.businessId, person.id, other.id],
    );
    if (rows[0]) duplicateFlagIds.push(rows[0].id);
  }

  await logAudit({
    tenantId: input.tenantId,
    userId: input.actorUserId || undefined,
    action: 'customer.created',
    resourceType: 'customer',
    resourceId: person.id,
    details: { email, businessId: input.businessId, source: input.source },
  });

  logger.info('Person created', { personId: person.id, businessId: input.businessId, source: input.source });
  return { person, created: true, matchedBy: null, duplicateFlagIds };
}

async function insertPerson(input: PersonInput, email: string | null, phoneRaw: string | null, e164: string | null) {
  const { rows: refRows } = await adminPool.query('SELECT generate_customer_reference($1) AS ref', [input.businessId]);
  const { rows } = await adminPool.query(
    `INSERT INTO cus_customers (
       tenant_id, business_id, reference_number, email, first_name, last_name, phone, phone_e164,
       date_of_birth, gender, preferred_language, country,
       lifecycle_stage, source, source_detail, user_id, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)
     RETURNING *`,
    [
      input.tenantId, input.businessId, refRows[0].ref, email,
      (input.firstName || '').trim(), (input.lastName || '').trim(), phoneRaw, e164,
      input.dateOfBirth || null, input.gender || null, input.preferredLanguage || 'en', input.country || null,
      input.initialStage || 'lead', input.source, (input.sourceDetail || '').slice(0, 200) || null,
      input.userId || null, input.actorUserId || null,
    ],
  );
  return rows[0];
}

async function fillEmptyDetails(person: any, input: PersonInput, email: string | null, phoneRaw: string | null, e164: string | null) {
  const set: string[] = [];
  const values: any[] = [];
  const add = (column: string, value: any) => { values.push(value); set.push(`${column} = $${values.length}`); };

  if (!person.email && email) {
    // Only take the email if nobody else in the business already has it.
    const { rows } = await adminPool.query(
      `SELECT 1 FROM cus_customers WHERE business_id = $1 AND LOWER(email) = $2 AND status <> 'merged' LIMIT 1`,
      [person.business_id, email],
    );
    if (rows.length === 0) add('email', email);
  }
  if (!person.phone && phoneRaw) { add('phone', phoneRaw); add('phone_e164', e164); }
  if (!(person.first_name || '').trim() && (input.firstName || '').trim()) add('first_name', input.firstName!.trim());
  if (!(person.last_name || '').trim() && (input.lastName || '').trim()) add('last_name', input.lastName!.trim());
  if (!person.date_of_birth && input.dateOfBirth) add('date_of_birth', input.dateOfBirth);
  if (!person.gender && input.gender) add('gender', input.gender);
  if (!person.country && input.country) add('country', input.country);
  if (!person.user_id && input.userId) {
    const { rows } = await adminPool.query(
      `SELECT 1 FROM cus_customers WHERE business_id = $1 AND user_id = $2 AND status <> 'merged' LIMIT 1`,
      [person.business_id, input.userId],
    );
    if (rows.length === 0) add('user_id', input.userId);
  }

  if (set.length === 0) return person;
  values.push(person.id);
  const { rows } = await adminPool.query(
    `UPDATE cus_customers SET ${set.join(', ')}, updated_at = NOW() WHERE id = $${values.length} RETURNING *`,
    values,
  );
  return rows[0];
}

/** Open "possible duplicate" flags for a person, with the other person's summary. */
export async function getDuplicateFlags(personId: string, businessId: string) {
  const { rows } = await adminPool.query(
    `SELECT f.id, f.match_type, f.created_at,
            o.id AS other_id, o.display_name AS other_name, o.email AS other_email, o.phone AS other_phone,
            o.reference_number AS other_reference, o.lifecycle_stage AS other_stage
       FROM cus_duplicate_flags f
       JOIN cus_customers o ON o.id = CASE WHEN f.customer_id = $1 THEN f.other_customer_id ELSE f.customer_id END
      WHERE f.business_id = $2 AND f.status = 'open' AND (f.customer_id = $1 OR f.other_customer_id = $1)
        AND o.status NOT IN ('merged', 'anonymized')
      ORDER BY f.created_at DESC`,
    [personId, businessId],
  );
  return rows;
}

export async function dismissDuplicateFlag(flagId: string, businessId: string): Promise<boolean> {
  const { rowCount } = await adminPool.query(
    `UPDATE cus_duplicate_flags SET status = 'dismissed' WHERE id = $1 AND business_id = $2 AND status = 'open'`,
    [flagId, businessId],
  );
  return (rowCount ?? 0) > 0;
}

/** Record that the person did something (booked, visited, bought, wrote, logged in). */
export async function touchActivity(personId: string, at: Date = new Date()): Promise<void> {
  await adminPool.query(
    `UPDATE cus_customers SET last_activity_at = GREATEST(COALESCE(last_activity_at, $2), $2) WHERE id = $1`,
    [personId, at],
  );
}

/** Record a visit (an attended booking or a check-in). A visit is also an activity. */
export async function touchVisit(personId: string, at: Date = new Date()): Promise<void> {
  await adminPool.query(
    `UPDATE cus_customers
        SET last_visit_at = GREATEST(COALESCE(last_visit_at, $2), $2),
            last_activity_at = GREATEST(COALESCE(last_activity_at, $2), $2)
      WHERE id = $1`,
    [personId, at],
  );
}

/** Record a login: stamps the account and counts as activity for the people linked to it. */
export async function recordLogin(userId: string): Promise<void> {
  await adminPool.query('UPDATE usr_users SET last_login_at = NOW() WHERE id = $1', [userId]);
  await adminPool.query(
    `UPDATE cus_customers SET last_activity_at = NOW() WHERE user_id = $1 AND status NOT IN ('merged', 'anonymized')`,
    [userId],
  );
}
