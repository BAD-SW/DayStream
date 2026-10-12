import { adminPool } from '../db/pool';
import { logAudit } from './audit.service';
import { logger } from '../middleware/logger';
import { findOrCreatePerson, findPersonByContactPoint, normalisePhone, defaultRegionFor, PersonSource } from './person-identity.service';
import { createActivity } from './customer-activity.service';
import { transitionLifecycle, LIFECYCLE_STAGES, LifecycleStage } from './customer-lifecycle.service';
import * as segmentsService from './customer-segments.service';
import { getCustomerCreditBalance } from './account-credit.service';

interface CreateCustomerInput {
  businessId: string;
  tenantId: string;
  email?: string | null;
  firstName: string;
  lastName?: string | null;
  phone?: string;
  dateOfBirth?: string;
  gender?: string;
  preferredLanguage?: string;
  country?: string;
  /** How the person came to the business. Staff may choose manual, walk_in or referral. */
  source?: PersonSource;
  sourceDetail?: string | null;
  createdBy: string;
}

/** System views of the People list (Phase 46 R1): a view is a fixed set of lifecycle stages. */
export const PEOPLE_VIEWS: Record<string, LifecycleStage[] | null> = {
  all: null,
  leads: ['lead'],
  customers: ['trial', 'active', 'at_risk', 'winback'],
  at_risk: ['at_risk'],
  former: ['churned'],
};

interface CustomerFilters {
  search?: string;
  lifecycle_stage?: string;
  tag_ids?: string[];
  page?: number;
  limit?: number;
  sort?: string;
  order?: 'asc' | 'desc';
  // Per-column filters (customers-page-requirements.md §A3) — all "contains", combine with AND.
  ref?: string;
  first_name?: string;
  last_name?: string;
  email?: string;
  phone?: string;
  created_from?: string;
  created_to?: string;
  // Phase 46
  view?: string;
  source?: string;
  /** 'me' is resolved by the route to the caller's id; 'none' means unassigned. */
  owner?: string;
  incomplete?: boolean;
  segment_id?: string;
  include_archived?: boolean;
  last_activity_from?: string;
  last_activity_to?: string;
}

/**
 * Create a person by hand. Goes through the identity service like every other entry point:
 * if the email (or a unique phone) already belongs to someone in this business, that person
 * is returned instead of a second record being created.
 *
 * The caller reports that as a refusal ("already exists"), so the existing person is left
 * exactly as they are: unlike a booking or a form, a refused add must not fill in their
 * details behind the user's back.
 */
export async function createCustomer(input: CreateCustomerInput) {
  const existing = await findPersonByContactPoint(input.businessId, { email: input.email, phone: input.phone, country: input.country });
  if (existing.person) {
    return { duplicate: true, existingId: existing.person.id, matchedBy: existing.matchedBy, customer: existing.person };
  }

  const result = await findOrCreatePerson({
    businessId: input.businessId,
    tenantId: input.tenantId,
    email: input.email,
    phone: input.phone,
    firstName: input.firstName,
    lastName: input.lastName,
    dateOfBirth: input.dateOfBirth,
    gender: input.gender,
    preferredLanguage: input.preferredLanguage,
    country: input.country,
    source: input.source || 'manual',
    sourceDetail: input.sourceDetail,
    actorUserId: input.createdBy,
  });

  if (!result.created) {
    return { duplicate: true, existingId: result.person.id, matchedBy: result.matchedBy, customer: result.person };
  }
  return { duplicate: false, customer: result.person, duplicateFlagIds: result.duplicateFlagIds };
}

/** Conditions shared by the list, the view counts and bulk actions. All columns are prefixed `c.`. */
async function buildListConditions(businessId: string, filters: CustomerFilters, skipView = false) {
  const conditions = ['c.business_id = $1', "c.status NOT IN ('anonymized', 'merged')"];
  const params: any[] = [businessId];
  let paramIndex = 2;

  if (!filters.include_archived) conditions.push("c.status <> 'archived'");

  if (filters.search) {
    // Names are compared without accents, so "garcia" finds "García" and the other way round.
    conditions.push(`(${plainText('c.first_name')} LIKE ${plainText(`$${paramIndex}`)} OR ${plainText('c.last_name')} LIKE ${plainText(`$${paramIndex}`)} OR ${plainText("c.first_name || ' ' || c.last_name")} LIKE ${plainText(`$${paramIndex}`)} OR COALESCE(c.email, '') ILIKE $${paramIndex} OR COALESCE(c.phone, '') ILIKE $${paramIndex} OR COALESCE(c.phone_e164, '') ILIKE $${paramIndex} OR COALESCE(c.reference_number, '') ILIKE $${paramIndex})`);
    params.push(`%${filters.search}%`);
    paramIndex++;
  }

  const viewStages = skipView ? null : PEOPLE_VIEWS[filters.view || 'all'];
  if (viewStages) {
    conditions.push(`c.lifecycle_stage = ANY($${paramIndex}::text[])`);
    params.push(viewStages);
    paramIndex++;
  }

  if (filters.lifecycle_stage) {
    conditions.push(`c.lifecycle_stage = $${paramIndex}`);
    params.push(filters.lifecycle_stage);
    paramIndex++;
  }

  if (filters.source) {
    conditions.push(`c.source = $${paramIndex}`);
    params.push(filters.source);
    paramIndex++;
  }

  if (filters.owner === 'none') {
    // Unassigned also covers people whose owner has since been deactivated.
    conditions.push(`(c.owner_user_id IS NULL OR NOT EXISTS (SELECT 1 FROM usr_users ou WHERE ou.id = c.owner_user_id AND ou.status = 'active'))`);
  } else if (filters.owner) {
    conditions.push(`c.owner_user_id = $${paramIndex}`);
    params.push(filters.owner);
    paramIndex++;
  }

  if (filters.incomplete) {
    conditions.push(`(c.email IS NULL OR BTRIM(c.first_name) = '' OR BTRIM(c.last_name) = '')`);
  }

  if (filters.last_activity_from) {
    conditions.push(`c.last_activity_at >= $${paramIndex}`);
    params.push(filters.last_activity_from);
    paramIndex++;
  }
  if (filters.last_activity_to) {
    conditions.push(`(c.last_activity_at IS NULL OR c.last_activity_at < ($${paramIndex}::date + INTERVAL '1 day'))`);
    params.push(filters.last_activity_to);
    paramIndex++;
  }

  if (filters.segment_id) {
    const member = await segmentsService.memberFilterSql(filters.segment_id, businessId, 'c', paramIndex);
    if (member) {
      conditions.push(member.sql);
      params.push(...member.params);
      paramIndex += member.params.length;
    } else {
      conditions.push('false');
    }
  }

  const containsFilters: [string | undefined, string][] = [
    [filters.ref, 'c.reference_number'],
    [filters.first_name, 'c.first_name'],
    [filters.last_name, 'c.last_name'],
    [filters.email, 'c.email'],
    [filters.phone, 'c.phone'],
  ];
  for (const [value, column] of containsFilters) {
    if (value) {
      conditions.push(`${column} ILIKE $${paramIndex}`);
      params.push(`%${value}%`);
      paramIndex++;
    }
  }

  if (filters.created_from) {
    conditions.push(`c.created_at >= $${paramIndex}`);
    params.push(filters.created_from);
    paramIndex++;
  }
  if (filters.created_to) {
    conditions.push(`c.created_at < ($${paramIndex}::date + INTERVAL '1 day')`);
    params.push(filters.created_to);
    paramIndex++;
  }

  return { where: conditions.join(' AND '), params };
}

/** The extra facts shown next to each person: owner, login, next booking, consent, incomplete. */
/** SQL for a text without accents and in lower case, for name searches. */
const ACCENTED = 'áàäâãåéèëêíìïîóòöôõúùüûñç';
const UNACCENTED = 'aaaaaaeeeeiiiiooooouuuunc';
export function plainText(expr: string): string {
  return `TRANSLATE(LOWER(COALESCE(${expr}, '')), '${ACCENTED}', '${UNACCENTED}')`;
}

const PERSON_EXTRAS = `
  NULLIF(BTRIM(COALESCE(ou.first_name, '') || ' ' || COALESCE(ou.last_name, '')), '') AS owner_name,
  lu.last_login_at,
  (c.user_id IS NOT NULL) AS has_account,
  (c.email IS NULL OR BTRIM(c.first_name) = '' OR BTRIM(c.last_name) = '') AS incomplete,
  (SELECT MIN(b.start_time) FROM apt_bookings b
    WHERE b.customer_id = c.id AND b.start_time > NOW() AND b.status NOT IN ('cancelled', 'no_show')) AS next_booking_at,
  COALESCE((SELECT array_agg(p.channel ORDER BY p.channel) FROM mkt_communication_preferences p
    WHERE p.customer_id = c.id AND p.category = 'marketing' AND p.opted_in), '{}') AS marketing_consent`;

const PERSON_JOINS = `
  LEFT JOIN usr_users ou ON ou.id = c.owner_user_id
  LEFT JOIN usr_users lu ON lu.id = c.user_id`;

const SORT_COLUMNS: Record<string, string> = {
  first_name: 'c.first_name', last_name: 'c.last_name', email: 'c.email', phone: 'c.phone',
  reference_number: 'c.reference_number', created_at: 'c.created_at', lifecycle_stage: 'c.lifecycle_stage',
  source: 'c.source', last_activity_at: 'c.last_activity_at', last_visit_at: 'c.last_visit_at',
  last_login_at: 'lu.last_login_at', owner_name: 'owner_name',
};

export async function getCustomers(businessId: string, filters: CustomerFilters) {
  const { where, params } = await buildListConditions(businessId, filters);

  const sort = SORT_COLUMNS[filters.sort || ''] || 'c.created_at';
  const order = filters.order === 'asc' ? 'ASC' : 'DESC';
  const limit = Math.min(filters.limit || 20, 100);
  const page = filters.page || 1;
  const offset = (page - 1) * limit;

  const [dataResult, countResult] = await Promise.all([
    adminPool.query(
      `SELECT c.*, ${PERSON_EXTRAS} FROM cus_customers c ${PERSON_JOINS}
        WHERE ${where} ORDER BY ${sort} ${order} NULLS LAST, c.id LIMIT ${limit} OFFSET ${offset}`,
      params,
    ),
    adminPool.query(`SELECT COUNT(*) AS total FROM cus_customers c WHERE ${where}`, params),
  ]);

  return {
    customers: dataResult.rows,
    total: parseInt(countResult.rows[0].total, 10),
    page,
    limit,
  };
}

/** How many people are in each system view, for the tabs above the list. */
export async function getViewCounts(businessId: string): Promise<Record<string, number>> {
  const { rows } = await adminPool.query(
    `SELECT lifecycle_stage, COUNT(*)::int AS n FROM cus_customers
      WHERE business_id = $1 AND status = 'active' GROUP BY lifecycle_stage`,
    [businessId],
  );
  const byStage: Record<string, number> = {};
  for (const r of rows) byStage[r.lifecycle_stage] = r.n;
  const counts: Record<string, number> = {};
  for (const [view, stages] of Object.entries(PEOPLE_VIEWS)) {
    counts[view] = (stages || [...LIFECYCLE_STAGES]).reduce((sum, s) => sum + (byStage[s] || 0), 0);
  }
  return counts;
}

// --- Bulk actions (Phase 46 R8) ---

export type BulkAction = 'add_tag' | 'remove_tag' | 'assign_owner' | 'change_stage' | 'add_to_list' | 'archive';

export interface BulkTarget { ids?: string[]; filters?: CustomerFilters }

/** The people a bulk action will touch: an explicit selection, or everyone matching the filters. */
export async function resolveBulkTarget(businessId: string, target: BulkTarget): Promise<string[]> {
  if (target.ids && target.ids.length > 0) {
    const { rows } = await adminPool.query(
      `SELECT id FROM cus_customers WHERE business_id = $1 AND id = ANY($2::uuid[]) AND status NOT IN ('anonymized', 'merged')`,
      [businessId, target.ids],
    );
    return rows.map((r) => r.id);
  }
  const { where, params } = await buildListConditions(businessId, target.filters || {});
  const { rows } = await adminPool.query(`SELECT c.id FROM cus_customers c WHERE ${where}`, params);
  return rows.map((r) => r.id);
}

export async function runBulkAction(
  businessId: string,
  tenantId: string,
  target: BulkTarget,
  action: BulkAction,
  payload: { tag_id?: string; owner_user_id?: string | null; stage?: LifecycleStage; segment_id?: string },
  userId: string,
): Promise<{ affected: number }> {
  const ids = await resolveBulkTarget(businessId, target);
  if (ids.length === 0) return { affected: 0 };
  let affected = ids.length;

  if (action === 'add_tag' || action === 'remove_tag') {
    const { rows: tag } = await adminPool.query('SELECT id, name FROM cus_tags WHERE id = $1 AND business_id = $2', [payload.tag_id, businessId]);
    if (!tag[0]) throw new Error('Tag not found');
    if (action === 'add_tag') {
      const { rows } = await adminPool.query(
        `INSERT INTO cus_customer_tags (customer_id, tag_id, assigned_by)
         SELECT unnest($1::uuid[]), $2, $3 ON CONFLICT (customer_id, tag_id) DO NOTHING RETURNING customer_id`,
        [ids, tag[0].id, userId],
      );
      await logBulk(rows.map((r) => r.customer_id), businessId, 'tag', `Tag added: ${tag[0].name}`, userId);
      affected = rows.length;
    } else {
      const { rows } = await adminPool.query(
        'DELETE FROM cus_customer_tags WHERE tag_id = $2 AND customer_id = ANY($1::uuid[]) RETURNING customer_id',
        [ids, tag[0].id],
      );
      await logBulk(rows.map((r) => r.customer_id), businessId, 'tag', `Tag removed: ${tag[0].name}`, userId);
      affected = rows.length;
    }
  } else if (action === 'assign_owner') {
    const ownerName = await assertOwner(payload.owner_user_id || null, tenantId);
    const { rows } = await adminPool.query(
      `UPDATE cus_customers SET owner_user_id = $2, updated_at = NOW()
        WHERE id = ANY($1::uuid[]) AND owner_user_id IS DISTINCT FROM $2 RETURNING id`,
      [ids, payload.owner_user_id || null],
    );
    await logBulk(rows.map((r) => r.id), businessId, 'profile_change', ownerName ? `Owner: ${ownerName}` : 'Owner removed', userId);
    affected = rows.length;
  } else if (action === 'change_stage') {
    if (!payload.stage || !LIFECYCLE_STAGES.includes(payload.stage)) throw new Error('Unknown stage');
    affected = 0;
    for (const id of ids) {
      const r = await transitionLifecycle(id, businessId, payload.stage, 'Bulk change by staff', userId);
      if (r.success && r.from !== r.to) affected++;
    }
  } else if (action === 'add_to_list') {
    const added = await segmentsService.addMembers(payload.segment_id || '', businessId, ids, userId);
    if (added === null) throw new Error('Fixed list not found');
    affected = added;
  } else if (action === 'archive') {
    const { rows } = await adminPool.query(
      `UPDATE cus_customers SET status = 'archived', updated_at = NOW() WHERE id = ANY($1::uuid[]) AND status = 'active' RETURNING id`,
      [ids],
    );
    await logBulk(rows.map((r) => r.id), businessId, 'profile_change', 'Archived', userId);
    affected = rows.length;
  } else {
    throw new Error('Unknown action');
  }

  await logAudit({ tenantId, userId, action: `customer.bulk_${action}`, resourceType: 'customer', details: { businessId, selected: ids.length, affected, payload } });
  return { affected };
}

async function logBulk(ids: string[], businessId: string, type: string, description: string, userId: string) {
  if (ids.length === 0) return;
  await adminPool.query(
    `INSERT INTO cus_activities (customer_id, business_id, activity_type, description, metadata, created_by)
     SELECT unnest($1::uuid[]), $2, $3, $4, $5, $6`,
    [ids, businessId, type, description, JSON.stringify({ bulk: true }), userId],
  );
}

/** An owner must be an active staff login of the same tenant. Returns their name, or null for "nobody". */
async function assertOwner(ownerUserId: string | null, tenantId: string): Promise<string | null> {
  if (!ownerUserId) return null;
  const { rows } = await adminPool.query(
    `SELECT first_name, last_name FROM usr_users WHERE id = $1 AND tenant_id = $2 AND status = 'active' AND persona <> 'customer'`,
    [ownerUserId, tenantId],
  );
  if (!rows[0]) throw new Error('Owner must be an active staff member of this business');
  return `${rows[0].first_name} ${rows[0].last_name}`.trim();
}

export async function getCustomerById(id: string, businessId: string) {
  const { rows } = await adminPool.query(
    `SELECT c.*, ${PERSON_EXTRAS} FROM cus_customers c ${PERSON_JOINS} WHERE c.id = $1 AND c.business_id = $2`,
    [id, businessId],
  );
  if (!rows[0]) return null;
  // The person's own tags. The profile used to show every tag of the business instead.
  const { rows: tags } = await adminPool.query(
    `SELECT t.id, t.name, t.color FROM cus_customer_tags ct JOIN cus_tags t ON t.id = ct.tag_id
      WHERE ct.customer_id = $1 ORDER BY t.name`,
    [id],
  );
  return { ...rows[0], tags };
}

export async function updateCustomer(id: string, businessId: string, updates: Record<string, any>, userId: string) {
  const customer = await getCustomerById(id, businessId);
  if (!customer) return null;

  const allowedFields = ['email', 'first_name', 'last_name', 'phone', 'date_of_birth', 'gender', 'preferred_language', 'country', 'avatar_url', 'status', 'lifecycle_stage', 'owner_user_id', 'source_detail'];
  const fields: string[] = [];
  const values: any[] = [];
  let idx = 1;

  // An email or phone cleared on screen arrives as '': store that as "none".
  for (const key of ['email', 'phone', 'owner_user_id']) {
    if (updates[key] === '') updates[key] = null;
  }
  if (typeof updates.email === 'string') updates.email = updates.email.trim().toLowerCase();

  const nextEmail = 'email' in updates ? updates.email : customer.email;
  const nextPhone = 'phone' in updates ? updates.phone : customer.phone;
  if (!nextEmail && !nextPhone) {
    throw Object.assign(new Error('An email address or a phone number is required'), { code: 'CONTACT_POINT_REQUIRED' });
  }
  if (updates.email && updates.email !== (customer.email || '').toLowerCase()) {
    const { rows: taken } = await adminPool.query(
      `SELECT id FROM cus_customers WHERE business_id = $1 AND LOWER(email) = $2 AND id <> $3 AND status <> 'merged' LIMIT 1`,
      [businessId, updates.email, id],
    );
    if (taken[0]) throw Object.assign(new Error('Another person in this business already has this email'), { code: 'EMAIL_IN_USE', existingId: taken[0].id });
  }
  if ('owner_user_id' in updates && updates.owner_user_id) await assertOwner(updates.owner_user_id, customer.tenant_id);

  for (const [key, value] of Object.entries(updates)) {
    if (allowedFields.includes(key)) {
      fields.push(`${key} = $${idx++}`);
      // Convert empty strings to null for date fields
      values.push(key === 'date_of_birth' && value === '' ? null : value);
    }
  }

  if ('phone' in updates) {
    // Keep the international form in step with what was typed.
    fields.push(`phone_e164 = $${idx++}`);
    values.push(normalisePhone(updates.phone, await defaultRegionFor(businessId)));
  }
  if ('lifecycle_stage' in updates && updates.lifecycle_stage !== customer.lifecycle_stage) {
    fields.push('lifecycle_changed_at = NOW()');
  }

  if (fields.length === 0) return customer;

  fields.push('updated_at = NOW()');
  values.push(id);
  values.push(businessId);

  await adminPool.query(
    `UPDATE cus_customers SET ${fields.join(', ')} WHERE id = $${idx++} AND business_id = $${idx}`,
    values,
  );

  // Build change descriptions with from → to values
  const changes: { field: string; from: any; to: any }[] = [];
  for (const [key, value] of Object.entries(updates)) {
    if (!allowedFields.includes(key)) continue;
    const oldVal = customer[key];
    const newVal = value;

    // Normalize for comparison: treat null/undefined/empty string as equivalent
    const normalizeVal = (v: any): string => {
      if (v === null || v === undefined || v === '') return '';
      if (v instanceof Date) return v.toISOString();
      return String(v).trim();
    };

    if (normalizeVal(oldVal) !== normalizeVal(newVal)) {
      changes.push({ field: key, from: oldVal ?? null, to: newVal ?? null });
    }
  }

  // Log activity only if something actually changed
  if (changes.length > 0) {
    const description = changes.map((c) => {
      const label = c.field.replace(/_/g, ' ').replace(/\b\w/g, (l) => l.toUpperCase());
      const fromVal = c.from || '(empty)';
      const toVal = c.to || '(empty)';
      return `${label}: ${fromVal} → ${toVal}`;
    }).join('; ');

    await adminPool.query(
      `INSERT INTO cus_activities (customer_id, business_id, activity_type, description, metadata, created_by)
       VALUES ($1, $2, 'profile_change', $3, $4, $5)`,
      [id, businessId, description, JSON.stringify({ changes }), userId],
    );
  }

  return getCustomerById(id, businessId);
}

export async function archiveCustomer(id: string, businessId: string, userId: string, tenantId: string) {
  const customer = await getCustomerById(id, businessId);
  if (!customer) return null;

  await adminPool.query(
    "UPDATE cus_customers SET status = 'archived', updated_at = NOW() WHERE id = $1 AND business_id = $2",
    [id, businessId],
  );

  await logAudit({ tenantId, userId, action: 'customer.archived', resourceType: 'customer', resourceId: id });

  return { ...customer, status: 'archived' };
}

export async function anonymizeCustomer(id: string, businessId: string, userId: string, tenantId: string) {
  const customer = await getCustomerById(id, businessId);
  if (!customer) return null;

  await adminPool.query(
    `UPDATE cus_customers SET
       first_name = '[deleted]', last_name = '[deleted]', email = $3,
       phone = NULL, date_of_birth = NULL, gender = NULL, country = NULL, avatar_url = NULL,
       status = 'anonymized', anonymized_at = NOW(), anonymized_by = $4, updated_at = NOW()
     WHERE id = $1 AND business_id = $2`,
    [id, businessId, `anonymized-${id}@deleted.local`, userId],
  );

  // Delete notes content
  await adminPool.query('DELETE FROM cus_notes WHERE customer_id = $1', [id]);

  // Log
  await logAudit({ tenantId, userId, action: 'customer.anonymized', resourceType: 'customer', resourceId: id });

  return { id, status: 'anonymized' };
}

/**
 * One person's money at a glance, for the profile: what they still owe on issued invoices,
 * what they have paid in total (charges less refunds) and their unused account credit.
 * Amounts are integer cents in the business currency.
 */
export async function getFinancialSummary(customerId: string, businessId: string) {
  const [business, invoices, payments, credit] = await Promise.all([
    adminPool.query('SELECT currency FROM sys_businesses WHERE id = $1', [businessId]),
    adminPool.query(
      `SELECT COALESCE(SUM(total_cents - amount_paid_cents), 0)::int AS balance_due_cents,
              COUNT(*)::int AS open_invoices,
              COUNT(*) FILTER (WHERE status = 'overdue' OR due_date < CURRENT_DATE)::int AS overdue_invoices
         FROM pay_invoices
        WHERE business_id = $1 AND customer_id = $2 AND status IN ('issued', 'overdue')`,
      [businessId, customerId],
    ),
    adminPool.query(
      `SELECT COALESCE(SUM(CASE WHEN type = 'charge' THEN amount WHEN type = 'refund' THEN -ABS(amount) ELSE 0 END), 0)::int AS lifetime_value_cents
         FROM pay_transactions
        WHERE business_id = $1 AND customer_id = $2 AND status = 'completed' AND payment_method <> 'account_credit'`,
      [businessId, customerId],
    ),
    getCustomerCreditBalance(businessId, customerId).catch(() => null),
  ]);
  return {
    currency: business.rows[0]?.currency || 'USD',
    balance_due_cents: invoices.rows[0].balance_due_cents,
    open_invoices: invoices.rows[0].open_invoices,
    overdue_invoices: invoices.rows[0].overdue_invoices,
    lifetime_value_cents: payments.rows[0].lifetime_value_cents,
    account_credit_cents: credit?.availableCents ?? 0,
  };
}
