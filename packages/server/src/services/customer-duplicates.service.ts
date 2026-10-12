import { PoolClient } from 'pg';
import { adminPool } from '../db/pool';
import { logAudit } from './audit.service';
import { createActivity } from './customer-activity.service';
import { logger } from '../middleware/logger';
import { normaliseEmail, normalisePhone, defaultRegionFor } from './person-identity.service';

interface DuplicateMatch {
  id: string;
  email: string;
  first_name: string;
  last_name: string;
  phone: string | null;
  match_type: 'email' | 'phone' | 'name';
  confidence: number;
}

const LIVE = `status NOT IN ('anonymized', 'merged')`;

/**
 * Check for potential duplicate customers within a business.
 * Checks email match, phone match, and name similarity. This is a hint for staff; only email
 * and a single phone match are ever used to match people automatically (person-identity.service).
 */
export async function findDuplicates(
  businessId: string,
  email: string,
  phone?: string,
  firstName?: string,
  lastName?: string,
): Promise<DuplicateMatch[]> {
  const matches: DuplicateMatch[] = [];

  // Email match (exact, ignoring case)
  const normalisedEmail = normaliseEmail(email);
  if (normalisedEmail) {
    const { rows } = await adminPool.query(
      `SELECT id, email, first_name, last_name, phone FROM cus_customers
       WHERE business_id = $1 AND LOWER(email) = $2 AND ${LIVE}`,
      [businessId, normalisedEmail],
    );
    for (const row of rows) {
      matches.push({ ...row, match_type: 'email', confidence: 1.0 });
    }
  }

  // Phone match (same number, however it was typed)
  if (phone && phone.trim() !== '') {
    const e164 = normalisePhone(phone, await defaultRegionFor(businessId));
    const { rows } = await adminPool.query(
      `SELECT id, email, first_name, last_name, phone FROM cus_customers
       WHERE business_id = $1 AND (phone = $2 OR ($3::text IS NOT NULL AND phone_e164 = $3)) AND ${LIVE}
       AND id != ALL($4::uuid[])`,
      [businessId, phone, e164, matches.map((m) => m.id)],
    );
    for (const row of rows) {
      matches.push({ ...row, match_type: 'phone', confidence: 0.9 });
    }
  }

  // Name similarity (first + last name match)
  if (firstName && lastName) {
    const { rows } = await adminPool.query(
      `SELECT id, email, first_name, last_name, phone FROM cus_customers
       WHERE business_id = $1
       AND LOWER(first_name) = LOWER($2)
       AND LOWER(last_name) = LOWER($3)
       AND ${LIVE}
       AND id != ALL($4::uuid[])`,
      [businessId, firstName, lastName, matches.map((m) => m.id)],
    );
    for (const row of rows) {
      matches.push({ ...row, match_type: 'name', confidence: 0.7 });
    }
  }

  return matches;
}

// ---------------------------------------------------------------------------
// Merge (Phase 46, requirements.md R12)
// ---------------------------------------------------------------------------

const MERGEABLE_FIELDS = ['email', 'first_name', 'last_name', 'phone', 'date_of_birth', 'gender', 'preferred_language', 'country', 'avatar_url'];

/**
 * Tables where a person can hold only one row of a kind (one streak, one tag assignment, one
 * progress record per video). When both people have such a row the primary's is kept and the
 * secondary's dropped. For any OTHER table with that kind of clash the merge is refused, so a
 * membership or an enrolment is never silently discarded.
 */
const KEEP_PRIMARY_ON_CLASH = new Set([
  'cus_customer_tags', 'cus_custom_fields', 'cus_preferences', 'cus_segment_members',
  'mkt_sequence_enrollments', 'mkt_campaign_recipients',
  'eng_customer_streaks', 'eng_customer_badges', 'eng_reactions', 'eng_vod_progress',
  'eng_course_enrollments', 'eng_course_lesson_progress', 'eng_challenge_participants',
  'pay_customer_refs',
]);

/** Handled by hand below, not by the generic move. */
const SPECIAL_TABLES = new Set(['cus_customers', 'mkt_communication_preferences', 'cus_duplicate_flags']);

const TABLE_LABELS: Record<string, string> = {
  apt_bookings: 'Bookings', apt_check_in_records: 'Check-ins', apt_waitlist_entries: 'Waitlist entries',
  apt_no_show_records: 'No-shows', apt_recurring_series: 'Recurring bookings',
  mem_memberships: 'Memberships', mbr_enrollments: 'Memberships', pkg_purchases: 'Packages',
  fin_orders: 'Orders', pay_invoices: 'Invoices', pay_transactions: 'Payments',
  pay_payment_methods: 'Stored payment methods', pay_account_credits: 'Account credit', pay_gift_cards: 'Gift cards',
  evt_registrations: 'Event registrations', evt_waitlist: 'Event waitlist entries',
  cus_notes: 'Notes', cus_customer_tags: 'Tags', cus_activities: 'Timeline entries', cus_custom_fields: 'Custom fields',
  mkt_campaign_recipients: 'Campaigns received', mkt_sequence_enrollments: 'Sequences', mkt_sequence_history: 'Sequence history',
  web_form_submissions: 'Website form submissions', wgt_widget_transactions: 'Widget payments',
  cus_consent_events: 'Consent history', mkt_communication_preferences: 'Consent settings',
};

interface FkRef { table: string; column: string }

type Queryable = Pick<PoolClient, 'query'>;

/** Every column in the database that points at a person, read live so a new table is never missed. */
export async function getPersonReferences(db: Queryable = adminPool): Promise<FkRef[]> {
  const { rows } = await db.query(
    `SELECT c.conrelid::regclass::text AS "table", a.attname AS "column"
       FROM pg_constraint c
       JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = c.conkey[1]
      WHERE c.contype = 'f' AND c.confrelid = 'cus_customers'::regclass AND array_length(c.conkey, 1) = 1
      ORDER BY 1, 2`,
  );
  return rows;
}

/** Unique keys of a table that include the given column: each as the list of the OTHER columns. */
async function uniqueKeysIncluding(db: Queryable, table: string, column: string): Promise<string[][]> {
  const { rows } = await db.query(
    `SELECT i.indexrelid, array_agg(a.attname::text ORDER BY a.attnum) AS cols
       FROM pg_index i
       JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY(i.indkey)
      WHERE i.indrelid = $1::regclass AND i.indisunique
      GROUP BY i.indexrelid`,
    [table],
  );
  return rows
    .map((r) => r.cols as string[])
    .filter((cols) => cols.includes(column))
    .map((cols) => cols.filter((c) => c !== column));
}

function clashPredicate(table: string, column: string, otherCols: string[], primaryParam: string): string {
  const same = otherCols.map((c) => `p."${c}" IS NOT DISTINCT FROM s."${c}"`).join(' AND ');
  return `EXISTS (SELECT 1 FROM ${table} p WHERE p."${column}" = ${primaryParam}${same ? ` AND ${same}` : ''})`;
}

export interface MergePreview {
  primary: { id: string; name: string; reference_number: string };
  secondary: { id: string; name: string; reference_number: string };
  moves: Array<{ table: string; label: string; count: number }>;
  blockers: Array<{ table: string; label: string; count: number }>;
}

async function loadPair(db: Queryable, primaryId: string, secondaryId: string, businessId: string, lock: boolean) {
  const { rows } = await db.query(
    `SELECT * FROM cus_customers WHERE id = ANY($1::uuid[]) AND business_id = $2 ORDER BY id${lock ? ' FOR UPDATE' : ''}`,
    [[primaryId, secondaryId], businessId],
  );
  return {
    primary: rows.find((r) => r.id === primaryId),
    secondary: rows.find((r) => r.id === secondaryId),
  };
}

function validatePair(primary: any, secondary: any, primaryId: string, secondaryId: string): string | null {
  if (primaryId === secondaryId) return 'Cannot merge a customer with itself';
  if (!primary) return 'Primary customer not found';
  if (!secondary) return 'Secondary customer not found';
  for (const p of [primary, secondary]) {
    if (p.status === 'merged') return 'One of these records has already been merged';
    if (p.status === 'anonymized') return 'An anonymised record cannot be merged';
  }
  return null;
}

/** What a merge would move, and anything that would stop it. Changes nothing. */
export async function previewMerge(primaryId: string, secondaryId: string, businessId: string): Promise<{ error?: string; preview?: MergePreview }> {
  const { primary, secondary } = await loadPair(adminPool, primaryId, secondaryId, businessId, false);
  const invalid = validatePair(primary, secondary, primaryId, secondaryId);
  if (invalid) return { error: invalid };

  const moves: MergePreview['moves'] = [];
  const blockers: MergePreview['blockers'] = [];
  for (const ref of await getPersonReferences()) {
    if (ref.table === 'cus_customers' || ref.table === 'cus_duplicate_flags') continue;
    const { rows } = await adminPool.query(`SELECT COUNT(*)::int AS n FROM ${ref.table} WHERE "${ref.column}" = $1`, [secondaryId]);
    if (rows[0].n > 0) {
      const label = TABLE_LABELS[ref.table] || ref.table;
      const existing = moves.find((m) => m.table === ref.table);
      if (existing) existing.count += rows[0].n; else moves.push({ table: ref.table, label, count: rows[0].n });
    }
    if (SPECIAL_TABLES.has(ref.table) || KEEP_PRIMARY_ON_CLASH.has(ref.table)) continue;
    for (const otherCols of await uniqueKeysIncluding(adminPool, ref.table, ref.column)) {
      const { rows: clash } = await adminPool.query(
        `SELECT COUNT(*)::int AS n FROM ${ref.table} s WHERE s."${ref.column}" = $2 AND ${clashPredicate(ref.table, ref.column, otherCols, '$1')}`,
        [primaryId, secondaryId],
      );
      if (clash[0].n > 0) blockers.push({ table: ref.table, label: TABLE_LABELS[ref.table] || ref.table, count: clash[0].n });
    }
  }

  const summary = (p: any) => ({ id: p.id, name: p.display_name, reference_number: p.reference_number });
  return { preview: { primary: summary(primary), secondary: summary(secondary), moves: moves.sort((a, b) => b.count - a.count), blockers } };
}

/**
 * Merge two people into one. Everything linked to the secondary moves to the primary, in one
 * transaction: all of it or none of it. The secondary is kept, marked as merged into the
 * primary, so old links still resolve and the merge can be audited.
 */
export async function mergeCustomers(
  primaryId: string,
  secondaryId: string,
  businessId: string,
  keepFields: Record<string, 'primary' | 'secondary'>,
  userId: string,
  tenantId: string,
): Promise<{ success: boolean; customer?: any; error?: string; moved?: Record<string, number> }> {
  const client = await adminPool.connect();
  const moved: Record<string, number> = {};
  let secondarySnapshot: any;

  try {
    await client.query('BEGIN');

    const { primary, secondary } = await loadPair(client, primaryId, secondaryId, businessId, true);
    const invalid = validatePair(primary, secondary, primaryId, secondaryId);
    if (invalid) { await client.query('ROLLBACK'); return { success: false, error: invalid }; }
    secondarySnapshot = secondary;

    // 1. Everything that points at the secondary now points at the primary.
    for (const ref of await getPersonReferences(client)) {
      if (SPECIAL_TABLES.has(ref.table)) continue;

      for (const otherCols of await uniqueKeysIncluding(client, ref.table, ref.column)) {
        const clash = clashPredicate(ref.table, ref.column, otherCols, '$1');
        if (KEEP_PRIMARY_ON_CLASH.has(ref.table)) {
          await client.query(`DELETE FROM ${ref.table} s WHERE s."${ref.column}" = $2 AND ${clash}`, [primaryId, secondaryId]);
        } else {
          const { rows } = await client.query(
            `SELECT COUNT(*)::int AS n FROM ${ref.table} s WHERE s."${ref.column}" = $2 AND ${clash}`,
            [primaryId, secondaryId],
          );
          if (rows[0].n > 0) {
            await client.query('ROLLBACK');
            return {
              success: false,
              error: `Both records have ${(TABLE_LABELS[ref.table] || ref.table).toLowerCase()} that cannot be combined automatically. Resolve that first, then merge.`,
            };
          }
        }
      }

      const { rowCount } = await client.query(
        `UPDATE ${ref.table} SET "${ref.column}" = $1 WHERE "${ref.column}" = $2`,
        [primaryId, secondaryId],
      );
      if (rowCount) moved[ref.table] = (moved[ref.table] || 0) + rowCount;
    }

    // 2. Consent: a withdrawal on either record stands; otherwise the primary's state is kept.
    await client.query(
      `UPDATE mkt_communication_preferences p
          SET opted_in = false, opted_out_at = COALESCE(s.opted_out_at, NOW()), source = 'merge', updated_at = NOW()
         FROM mkt_communication_preferences s
        WHERE p.customer_id = $1 AND s.customer_id = $2
          AND s.channel = p.channel AND s.category = p.category
          AND s.opted_in = false AND p.opted_in = true`,
      [primaryId, secondaryId],
    );
    // Withdrawals the primary had no record of are carried over; the rest are dropped.
    await client.query(
      `UPDATE mkt_communication_preferences s SET customer_id = $1, updated_at = NOW()
        WHERE s.customer_id = $2 AND s.opted_in = false
          AND NOT EXISTS (SELECT 1 FROM mkt_communication_preferences p
                           WHERE p.customer_id = $1 AND p.channel = s.channel AND p.category = s.category)`,
      [primaryId, secondaryId],
    );
    await client.query('DELETE FROM mkt_communication_preferences WHERE customer_id = $1', [secondaryId]);

    // 3. Duplicate flags about this pair are settled; other flags follow the primary.
    await client.query(
      `UPDATE cus_duplicate_flags SET status = 'merged'
        WHERE (customer_id = $1 AND other_customer_id = $2) OR (customer_id = $2 AND other_customer_id = $1)`,
      [primaryId, secondaryId],
    );
    await client.query(
      `DELETE FROM cus_duplicate_flags WHERE status <> 'merged' AND (customer_id = $1 OR other_customer_id = $1)`,
      [secondaryId],
    );
    await client.query('UPDATE cus_customers SET merged_into_id = $1 WHERE merged_into_id = $2', [primaryId, secondaryId]);

    // 4. The secondary steps aside first, so its email and login are free for the primary to take.
    await client.query(
      `UPDATE cus_customers
          SET status = 'merged', merged_into_id = $1, merged_at = NOW(),
              email = NULL, phone = NULL, phone_e164 = NULL, user_id = NULL, updated_at = NOW()
        WHERE id = $2`,
      [primaryId, secondaryId],
    );

    // 5. The primary takes the chosen details, fills its gaps, and keeps the older history.
    const set: string[] = [];
    const values: any[] = [];
    const add = (expr: string, value?: any) => {
      if (value === undefined) { set.push(expr); return; }
      values.push(value); set.push(`${expr} = $${values.length}`);
    };
    for (const field of MERGEABLE_FIELDS) {
      const chosen = keepFields[field] === 'secondary' && secondary[field];
      const gap = (primary[field] === null || primary[field] === undefined || primary[field] === '') && secondary[field];
      if (chosen || gap) add(field, secondary[field]);
    }
    const phoneFromSecondary = (keepFields.phone === 'secondary' && secondary.phone) || (!primary.phone && secondary.phone);
    if (phoneFromSecondary) add('phone_e164', secondary.phone_e164);
    if (!primary.user_id && secondary.user_id) add('user_id', secondary.user_id);
    if (!primary.owner_user_id && secondary.owner_user_id) add('owner_user_id', secondary.owner_user_id);
    if (new Date(secondary.created_at) < new Date(primary.created_at)) {
      // The person has been known since the earlier record, and came from where it came from.
      add('created_at', secondary.created_at);
      add('source', secondary.source);
      add('source_detail', secondary.source_detail);
    }
    add('last_activity_at = GREATEST(last_activity_at, ' + pushValue(values, secondary.last_activity_at) + ')');
    add('last_visit_at = GREATEST(last_visit_at, ' + pushValue(values, secondary.last_visit_at) + ')');
    add('updated_at = NOW()');
    values.push(primaryId);
    await client.query(`UPDATE cus_customers SET ${set.join(', ')} WHERE id = $${values.length}`, values);

    await client.query('COMMIT');
  } catch (err: any) {
    await client.query('ROLLBACK').catch(() => undefined);
    logger.error('Customer merge failed', { primaryId, secondaryId, businessId, error: err.message });
    throw err;
  } finally {
    client.release();
  }

  // Log in activity timeline
  await createActivity({
    customerId: primaryId,
    businessId,
    activityType: 'profile_change',
    description: `Merged with customer ${secondarySnapshot.reference_number}${secondarySnapshot.email ? ` (${secondarySnapshot.email})` : ''}`,
    metadata: { merged_from: secondaryId, merged_reference: secondarySnapshot.reference_number, moved },
    createdBy: userId,
  });

  // Audit log
  await logAudit({
    tenantId,
    userId,
    action: 'customer.merged',
    resourceType: 'customer',
    resourceId: primaryId,
    details: { primary_id: primaryId, secondary_id: secondaryId, secondary_email: secondarySnapshot.email, moved },
  });

  logger.info('Customer merge complete', { primaryId, secondaryId, businessId });

  // Return updated primary
  const { rows: updated } = await adminPool.query('SELECT * FROM cus_customers WHERE id = $1', [primaryId]);
  return { success: true, customer: updated[0], moved };
}

function pushValue(values: any[], value: any): string {
  values.push(value || null);
  return `$${values.length}::timestamptz`;
}
