import { adminPool } from '../db/pool';
import { logger } from '../middleware/logger';
import { filterAudience, summarise, Channel, Purpose, AudienceSummary } from './contactability.service';

interface SegmentRule {
  field: string;
  operator: 'eq' | 'neq' | 'gt' | 'lt' | 'gte' | 'lte' | 'in' | 'between' | 'contains' | 'within_days' | 'older_than_days' | 'never' | 'is_true' | 'is_false';
  value?: any;
}

interface SegmentDefinition {
  logic: 'AND' | 'OR';
  rules: SegmentRule[];
}

export type SegmentKind = 'dynamic' | 'static';

interface CreateSegmentInput {
  businessId: string;
  name: string;
  rules?: SegmentDefinition;
  kind?: SegmentKind;
  description?: string | null;
  createdBy: string;
}

export class SegmentInUseError extends Error {
  code = 'SEGMENT_IN_USE';
  constructor(public usedBy: string[]) { super(`This segment is used by: ${usedBy.join(', ')}`); }
}

const EMPTY_RULES: SegmentDefinition = { logic: 'AND', rules: [] };

// Allowed fields for segment rules (mapped to SQL columns/expressions)
const FIELD_MAP: Record<string, string> = {
  lifecycle_stage: 'c.lifecycle_stage',
  status: 'c.status',
  email: 'c.email',
  first_name: 'c.first_name',
  last_name: 'c.last_name',
  gender: 'c.gender',
  country: 'c.country',
  preferred_language: 'c.preferred_language',
  created_at: 'c.created_at',
  updated_at: 'c.updated_at',
  // Phase 46
  source: 'c.source',
  owner_user_id: 'c.owner_user_id',
  last_activity_at: 'c.last_activity_at',
  last_visit_at: 'c.last_visit_at',
  last_login_at: '(SELECT u.last_login_at FROM usr_users u WHERE u.id = c.user_id)',
  birth_month: 'EXTRACT(MONTH FROM c.date_of_birth)::int',
};

// Yes / no facts about a person (used with the is_true / is_false operators).
const BOOLEAN_FIELD_MAP: Record<string, string> = {
  has_account: '(c.user_id IS NOT NULL)',
  incomplete: `(c.email IS NULL OR BTRIM(c.first_name) = '' OR BTRIM(c.last_name) = '')`,
  has_owner: '(c.owner_user_id IS NOT NULL)',
  birthday_this_month: '(c.date_of_birth IS NOT NULL AND EXTRACT(MONTH FROM c.date_of_birth) = EXTRACT(MONTH FROM NOW()))',
  created_this_month: `(c.created_at >= date_trunc('month', NOW()))`,
  'consent.email': consentExists('email'),
  'consent.sms': consentExists('sms'),
  'consent.whatsapp': consentExists('whatsapp'),
  'consent.push': consentExists('push'),
  // THE-18: has an upcoming class or event booking.
  upcoming_event: `EXISTS (SELECT 1 FROM evt_registrations er JOIN evt_events e ON e.id = er.event_id
                     WHERE er.customer_id = c.id AND er.status IN ('confirmed', 'pending') AND e.start_time > NOW() AND e.deleted_at IS NULL)`,
};

/** "Today" in the business's own time zone. */
const TODAY = `(NOW() AT TIME ZONE COALESCE((SELECT b.timezone FROM sys_businesses b WHERE b.id = c.business_id), 'UTC'))::date`;

type Param = (v: any) => string;
const COUNT_OPS: Record<string, string> = { gt: '>', lt: '<', eq: '=', gte: '>=', lte: '<=' };
const uuidOk = (v: any) => typeof v === 'string' && /^[0-9a-f-]{36}$/i.test(v);

/**
 * Filters that need more than a column (THE-18, David 2026-11-04). Each returns a SQL condition on
 * `c` (cus_customers), or null when the rule is incomplete (it is then ignored).
 */
const COMPLEX_FIELDS: Record<string, (rule: SegmentRule, p: Param) => string | null> = {
  // Visits: attended appointments (completed / checked in) and attended events, more than / less
  // than / exactly N, narrowed by dates, event type, event, recurring events, service, membership
  // used, staff member, location (of the booked resource or of the event).
  visits: (rule, p) => {
    const v = rule.value || {};
    const op = COUNT_OPS[rule.operator]; const n = Number(v.count);
    if (!op || !Number.isFinite(n)) return null;
    const bookingOnly = v.service_id || v.staff_id || v.membership_plan_id;
    const eventOnly = v.event_type_id || v.event_id || v.recurring;
    const b: string[] = [`b.customer_id = c.id`, `b.status IN ('completed', 'checked_in')`];
    const e: string[] = [`er.customer_id = c.id`, `er.status <> 'cancelled'`, `(er.checked_in_at IS NOT NULL OR (er.status = 'confirmed' AND ev.end_time < NOW()))`];
    if (v.within_days) { const d = p(Number(v.within_days)); b.push(`b.start_time >= NOW() - (${d}::int * INTERVAL '1 day')`); e.push(`ev.start_time >= NOW() - (${d}::int * INTERVAL '1 day')`); }
    if (v.from) { const f = p(v.from); b.push(`b.start_time::date >= ${f}::date`); e.push(`ev.start_time::date >= ${f}::date`); }
    if (v.to) { const t = p(v.to); b.push(`b.start_time::date <= ${t}::date`); e.push(`ev.start_time::date <= ${t}::date`); }
    if (uuidOk(v.service_id)) b.push(`b.service_id = ${p(v.service_id)}`);
    if (uuidOk(v.staff_id)) b.push(`b.staff_id = ${p(v.staff_id)}`);
    if (uuidOk(v.location_id)) { const l = p(v.location_id); b.push(`r.location_id = ${l}`); e.push(`ev.location_id = ${l}`); }
    if (uuidOk(v.membership_plan_id)) {
      b.push(`EXISTS (SELECT 1 FROM mbr_enrollments me WHERE me.customer_id = c.id AND me.plan_id = ${p(v.membership_plan_id)}
                AND b.start_time::date >= me.start_date AND (me.status = 'active' OR b.start_time::date <= COALESCE(me.cancelled_at::date, me.current_period_end)))`);
    }
    if (uuidOk(v.event_type_id)) e.push(`ev.event_type_id = ${p(v.event_type_id)}`);
    if (uuidOk(v.event_id)) e.push(`ev.id = ${p(v.event_id)}`);
    if (v.recurring) e.push(`ev.series_id IS NOT NULL`);
    const parts: string[] = [];
    if (!eventOnly) parts.push(`SELECT 1 FROM apt_bookings b LEFT JOIN res_resources r ON r.id = b.resource_id WHERE ${b.join(' AND ')}`);
    if (!bookingOnly) parts.push(`SELECT 1 FROM evt_registrations er JOIN evt_events ev ON ev.id = er.event_id WHERE ${e.join(' AND ')}`);
    if (!parts.length) return 'false';
    return `(SELECT COUNT(*) FROM (${parts.join(' UNION ALL ')}) v) ${op} ${p(n)}`;
  },
  // Future bookings: more than / less than / exactly N appointments ahead, optionally within X days.
  future_bookings: (rule, p) => {
    const v = rule.value || {};
    const op = COUNT_OPS[rule.operator]; const n = Number(v.count);
    if (!op || !Number.isFinite(n)) return null;
    const within = v.within_days ? ` AND b.start_time <= NOW() + (${p(Number(v.within_days))}::int * INTERVAL '1 day')` : '';
    return `(SELECT COUNT(*) FROM apt_bookings b WHERE b.customer_id = c.id AND b.start_time > NOW() AND b.status IN ('confirmed', 'pending')${within}) ${op} ${p(n)}`;
  },
  // Address: any filled part must match; not case-sensitive, accents and abbreviations ignored,
  // words may be missing ("McAllister" finds "McAllister Avenue"); small typos with pg_trgm.
  address: (rule, p) => {
    const v = rule.value || {};
    const conds: string[] = [];
    const words = (col: string, text: string) => {
      const t = p(text);
      const exact = `NOT EXISTS (SELECT 1 FROM unnest(string_to_array(ds_norm_address(${t}), ' ')) w WHERE w <> '' AND ds_norm_address(${col}) !~ ('\m' || w))`;
      return trgm ? `(${exact} OR word_similarity(ds_norm_address(${t}), ds_norm_address(${col})) >= 0.6)` : exact;
    };
    if (v.street?.trim()) conds.push(words('c.address_line', v.street));
    if (v.city?.trim()) conds.push(words('c.city', v.city));
    if (v.postcode?.trim()) conds.push(`REPLACE(UPPER(COALESCE(c.postal_code, '')), ' ', '') LIKE REPLACE(UPPER(${p(v.postcode.trim())}), ' ', '') || '%'`);
    if (v.country?.trim()) conds.push(`LOWER(COALESCE(c.country, '')) = LOWER(${p(v.country.trim())})`);
    return conds.length ? `(${conds.join(' AND ')})` : null;
  },
  // Last contacted: the latest message to the person on any channel (staff or automatic), or on one.
  last_contacted: (rule, p) => {
    const v = rule.value || {};
    const ch = v.channel ? p(v.channel) : null;
    const last = `GREATEST(
      (SELECT MAX(m.created_at) FROM inbox_messages m JOIN inbox_conversations ic ON ic.id = m.conversation_id WHERE ic.customer_id = c.id AND m.direction IN ('out', 'auto')${ch ? ` AND m.channel = ${ch}` : ''}),
      (SELECT MAX(q.sent_at) FROM apt_notification_queue q WHERE q.recipient_id = c.id AND q.status = 'sent'${ch ? ` AND q.channel = ${ch}` : ''}),
      (SELECT MAX(cr.sent_at) FROM mkt_campaign_recipients cr WHERE cr.customer_id = c.id${ch ? ` AND ${ch} = 'email'` : ''}))`;
    if (rule.operator === 'within_days') return `${last} >= NOW() - (${p(Number(v.days))}::int * INTERVAL '1 day')`;
    if (rule.operator === 'older_than_days') return `(${last} IS NULL OR ${last} < NOW() - (${p(Number(v.days))}::int * INTERVAL '1 day'))`;
    if (rule.operator === 'between' && v.from && v.to) return `${last}::date BETWEEN ${p(v.from)}::date AND ${p(v.to)}::date`;
    if (rule.operator === 'never') return `${last} IS NULL`;
    return null;
  },
  // Membership: for a chosen plan, has it active / cancelled / expired / never had it / not active.
  membership: (rule, p) => {
    const v = rule.value || {};
    if (!uuidOk(v.plan_id)) return null;
    const plan = p(v.plan_id);
    const has = (status: string) => `EXISTS (SELECT 1 FROM mbr_enrollments me WHERE me.customer_id = c.id AND me.plan_id = ${plan} AND me.status = '${status}')`;
    switch (v.state) {
      case 'active': return has('active');
      case 'cancelled': return has('cancelled');
      case 'expired': return has('expired');
      case 'never': return `NOT EXISTS (SELECT 1 FROM mbr_enrollments me WHERE me.customer_id = c.id AND me.plan_id = ${plan})`;
      case 'not_active': return `NOT ${has('active')}`;
      default: return null;
    }
  },
  // Birthday: an exact day, between two days, this month, next month (follows the calendar), or in
  // the next X days; the year of birth does not matter.
  birthday: (rule, p) => {
    const v = rule.value || {};
    const md = `to_char(c.date_of_birth, 'MM-DD')`;
    const toMd = (d: string) => (d.length > 5 ? d.slice(5, 10) : d);
    const range = (from: string, to: string) => `(c.date_of_birth IS NOT NULL AND CASE WHEN ${from} <= ${to} THEN ${md} BETWEEN ${from} AND ${to} ELSE (${md} >= ${from} OR ${md} <= ${to}) END)`;
    switch (v.mode) {
      case 'date': return v.date ? `${md} = ${p(toMd(v.date))}` : null;
      case 'between': return v.from && v.to ? range(p(toMd(v.from)), p(toMd(v.to))) : null;
      case 'this_month': return `EXTRACT(MONTH FROM c.date_of_birth) = EXTRACT(MONTH FROM ${TODAY})`;
      case 'next_month': return `EXTRACT(MONTH FROM c.date_of_birth) = EXTRACT(MONTH FROM ${TODAY} + INTERVAL '1 month')`;
      case 'next_days': {
        const d = Number(v.days); if (!Number.isFinite(d) || d < 0) return null;
        return range(`to_char(${TODAY}, 'MM-DD')`, `to_char(${TODAY} + (${p(d)}::int * INTERVAL '1 day'), 'MM-DD')`);
      }
      default: return null;
    }
  },
  // Age: between X and Y years (either may be open).
  age: (rule, p) => {
    const v = rule.value || {};
    const age = `date_part('year', age(${TODAY}, c.date_of_birth))`;
    const conds = ['c.date_of_birth IS NOT NULL'];
    if (v.min !== undefined && v.min !== '' && v.min !== null) conds.push(`${age} >= ${p(Number(v.min))}`);
    if (v.max !== undefined && v.max !== '' && v.max !== null) conds.push(`${age} <= ${p(Number(v.max))}`);
    return conds.length > 1 ? `(${conds.join(' AND ')})` : null;
  },
  // Tags: has any / all / none of the chosen tags.
  tags: (rule, p) => {
    const v = rule.value || {};
    const ids = (v.tag_ids || []).filter(uuidOk);
    if (!ids.length) return null;
    const list = p(ids);
    if (v.mode === 'all') return `(SELECT COUNT(DISTINCT ct.tag_id) FROM cus_customer_tags ct WHERE ct.customer_id = c.id AND ct.tag_id = ANY(${list}::uuid[])) = ${p(ids.length)}`;
    const any = `EXISTS (SELECT 1 FROM cus_customer_tags ct WHERE ct.customer_id = c.id AND ct.tag_id = ANY(${list}::uuid[]))`;
    return v.mode === 'none' ? `NOT ${any}` : any;
  },
  // Business location where they booked (the booked resource's location) or attended an event.
  location: (rule, p) => {
    const v = rule.value || {};
    if (!uuidOk(v.location_id)) return null;
    const l = p(v.location_id);
    return `(EXISTS (SELECT 1 FROM apt_bookings b JOIN res_resources r ON r.id = b.resource_id WHERE b.customer_id = c.id AND b.status <> 'cancelled' AND r.location_id = ${l})
             OR EXISTS (SELECT 1 FROM evt_registrations er JOIN evt_events ev ON ev.id = er.event_id WHERE er.customer_id = c.id AND er.status <> 'cancelled' AND ev.location_id = ${l}))`;
  },
  // A business resource (room, equipment) they booked.
  resource: (rule, p) => {
    const v = rule.value || {};
    if (!uuidOk(v.resource_id)) return null;
    return `EXISTS (SELECT 1 FROM apt_bookings b WHERE b.customer_id = c.id AND b.status <> 'cancelled' AND b.resource_id = ${p(v.resource_id)})`;
  },
  // A service they booked, past or future; "past only" / "future only" narrow it.
  service: (rule, p) => {
    const v = rule.value || {};
    if (!uuidOk(v.service_id)) return null;
    const when = v.when === 'past' ? ' AND b.start_time <= NOW()' : v.when === 'future' ? ' AND b.start_time > NOW()' : '';
    return `EXISTS (SELECT 1 FROM apt_bookings b WHERE b.customer_id = c.id AND b.status NOT IN ('cancelled', 'no_show') AND b.service_id = ${p(v.service_id)}${when})`;
  },
};

/** Whether pg_trgm is installed (typo-tolerant address matching); checked once. */
let trgm = false;
adminPool.query(`SELECT 1 FROM pg_extension WHERE extname = 'pg_trgm'`).then((r) => { trgm = r.rows.length > 0; }).catch(() => undefined);

function consentExists(channel: string): string {
  return `EXISTS (SELECT 1 FROM mkt_communication_preferences p WHERE p.customer_id = c.id AND p.channel = '${channel}' AND p.category = 'marketing' AND p.opted_in)`;
}

/** People who are never part of a segment: merged and anonymised records. */
const LIVE = `c.status NOT IN ('anonymized', 'merged')`;

function parseRules(raw: any): SegmentDefinition {
  const def = typeof raw === 'string' ? JSON.parse(raw) : raw;
  return def && Array.isArray(def.rules) ? def : EMPTY_RULES;
}

/**
 * Create a saved segment. A dynamic segment follows its rules; a static one is a fixed list
 * holding exactly the people added by hand.
 */
export async function createSegment(input: CreateSegmentInput) {
  const kind: SegmentKind = input.kind === 'static' ? 'static' : 'dynamic';
  const { rows } = await adminPool.query(
    `INSERT INTO cus_segments (business_id, name, rules, is_predefined, created_by, kind, description)
     VALUES ($1, $2, $3, false, $4, $5, $6)
     RETURNING *`,
    [input.businessId, input.name, JSON.stringify(kind === 'static' ? EMPTY_RULES : (input.rules || EMPTY_RULES)), input.createdBy, kind, input.description || null],
  );
  return rows[0];
}

/** Rename a segment or change its rules. Starter segments keep their rules. */
export async function updateSegment(
  id: string,
  businessId: string,
  updates: { name?: string; rules?: SegmentDefinition; description?: string | null },
) {
  const { rows: existing } = await adminPool.query('SELECT * FROM cus_segments WHERE id = $1 AND business_id = $2', [id, businessId]);
  const segment = existing[0];
  if (!segment) return null;

  const set: string[] = [];
  const values: any[] = [];
  const add = (column: string, value: any) => { values.push(value); set.push(`${column} = $${values.length}`); };
  if (updates.name !== undefined) add('name', updates.name);
  if (updates.description !== undefined) add('description', updates.description || null);
  if (updates.rules !== undefined && segment.kind === 'dynamic' && !segment.is_predefined) add('rules', JSON.stringify(updates.rules));
  if (set.length === 0) return segment;

  values.push(id, businessId);
  const { rows } = await adminPool.query(
    `UPDATE cus_segments SET ${set.join(', ')}, updated_at = NOW() WHERE id = $${values.length - 1} AND business_id = $${values.length} RETURNING *`,
    values,
  );
  return rows[0];
}

/**
 * List all segments for a business.
 */
export async function getSegments(businessId: string) {
  const { rows } = await adminPool.query(
    'SELECT * FROM cus_segments WHERE business_id = $1 ORDER BY is_predefined DESC, created_at DESC',
    [businessId],
  );
  return rows;
}

export async function getSegment(id: string, businessId: string) {
  const { rows } = await adminPool.query('SELECT * FROM cus_segments WHERE id = $1 AND business_id = $2', [id, businessId]);
  return rows[0] || null;
}

/** Names of what still depends on a segment (a campaign about to go out). */
async function segmentUsage(id: string): Promise<string[]> {
  const { rows } = await adminPool.query(
    `SELECT name FROM mkt_campaigns WHERE segment_id = $1 AND status IN ('scheduled', 'sending')`,
    [id],
  );
  return rows.map((r) => `campaign "${r.name}"`);
}

/**
 * Delete a segment. Refused while a scheduled campaign uses it.
 */
export async function deleteSegment(id: string, businessId: string): Promise<boolean> {
  const usedBy = await segmentUsage(id);
  if (usedBy.length > 0) throw new SegmentInUseError(usedBy);
  const { rowCount } = await adminPool.query(
    'DELETE FROM cus_segments WHERE id = $1 AND business_id = $2 AND is_predefined = false',
    [id, businessId],
  );
  return (rowCount ?? 0) > 0;
}

/**
 * Evaluate a segment's rules and return matching customers + count.
 */
export async function evaluateSegment(segmentId: string, businessId: string, page = 1, limit = 20) {
  const segment = await getSegment(segmentId, businessId);
  if (!segment) return null;

  if (segment.kind === 'static') {
    const safeLimit = Math.min(limit, 100);
    const offset = (page - 1) * safeLimit;
    const [data, count] = await Promise.all([
      adminPool.query(
        `SELECT c.* FROM cus_segment_members m JOIN cus_customers c ON c.id = m.customer_id
          WHERE m.segment_id = $1 AND c.business_id = $2 AND ${LIVE}
          ORDER BY m.added_at DESC LIMIT $3 OFFSET $4`,
        [segmentId, businessId, safeLimit, offset],
      ),
      adminPool.query(
        `SELECT COUNT(*)::int AS total FROM cus_segment_members m JOIN cus_customers c ON c.id = m.customer_id
          WHERE m.segment_id = $1 AND c.business_id = $2 AND ${LIVE}`,
        [segmentId, businessId],
      ),
    ]);
    return { members: data.rows, total: count.rows[0].total, page, limit: safeLimit };
  }

  return evaluateRules(parseRules(segment.rules), businessId, page, limit);
}

/**
 * Evaluate rules directly (for inline evaluation without a saved segment).
 */
export async function evaluateRules(
  rules: SegmentDefinition,
  businessId: string,
  page = 1,
  limit = 20,
) {
  const { whereClause, params } = buildWhereClause(rules, businessId);

  const offset = (page - 1) * limit;
  const safeLimit = Math.min(limit, 100);

  const [dataResult, countResult] = await Promise.all([
    adminPool.query(
      `SELECT c.* FROM cus_customers c WHERE ${whereClause} ORDER BY c.created_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, safeLimit, offset],
    ),
    adminPool.query(
      `SELECT COUNT(*)::int AS total FROM cus_customers c WHERE ${whereClause}`,
      params,
    ),
  ]);

  return {
    members: dataResult.rows,
    total: countResult.rows[0].total,
    page,
    limit: safeLimit,
  };
}

/** Live member count for rules being edited (not yet saved). */
export async function countRules(rules: SegmentDefinition, businessId: string): Promise<number> {
  const { whereClause, params } = buildWhereClause(rules, businessId);
  const { rows } = await adminPool.query(`SELECT COUNT(*)::int AS total FROM cus_customers c WHERE ${whereClause}`, params);
  return rows[0].total;
}

/**
 * Every member id of a segment, as of now. Dynamic segments are evaluated at the moment of
 * the call, so someone who stopped matching a minute ago is already gone.
 */
export async function getMemberIds(segmentId: string, businessId: string): Promise<string[] | null> {
  const segment = await getSegment(segmentId, businessId);
  if (!segment) return null;
  if (segment.kind === 'static') {
    const { rows } = await adminPool.query(
      `SELECT c.id FROM cus_segment_members m JOIN cus_customers c ON c.id = m.customer_id
        WHERE m.segment_id = $1 AND c.business_id = $2 AND ${LIVE}`,
      [segmentId, businessId],
    );
    return rows.map((r) => r.id);
  }
  const { whereClause, params } = buildWhereClause(parseRules(segment.rules), businessId);
  const { rows } = await adminPool.query(`SELECT c.id FROM cus_customers c WHERE ${whereClause}`, params);
  return rows.map((r) => r.id);
}

/** SQL fragment + params selecting a segment's members, for use inside the People list query. */
export async function memberFilterSql(
  segmentId: string,
  businessId: string,
  alias: string,
  firstParamIndex: number,
): Promise<{ sql: string; params: any[] } | null> {
  const ids = await getMemberIds(segmentId, businessId);
  if (ids === null) return null;
  return { sql: `${alias}.id = ANY($${firstParamIndex}::uuid[])`, params: [ids] };
}

/** How many members of a segment would receive a message on a channel, and why the rest would not. */
export async function audienceSummary(
  segmentId: string,
  businessId: string,
  channel: Channel,
  purpose: Purpose,
): Promise<AudienceSummary | null> {
  const ids = await getMemberIds(segmentId, businessId);
  if (ids === null) return null;
  return summarise(await filterAudience(businessId, ids, channel, purpose));
}

// --- Fixed lists ---

export async function addMembers(segmentId: string, businessId: string, customerIds: string[], userId: string): Promise<number | null> {
  const segment = await getSegment(segmentId, businessId);
  if (!segment || segment.kind !== 'static') return null;
  if (customerIds.length === 0) return 0;
  const { rowCount } = await adminPool.query(
    `INSERT INTO cus_segment_members (segment_id, customer_id, tenant_id, business_id, added_by)
     SELECT $1, c.id, c.tenant_id, c.business_id, $4
       FROM cus_customers c
      WHERE c.business_id = $2 AND c.id = ANY($3::uuid[]) AND ${LIVE}
     ON CONFLICT (segment_id, customer_id) DO NOTHING`,
    [segmentId, businessId, customerIds, userId],
  );
  return rowCount ?? 0;
}

export async function removeMembers(segmentId: string, businessId: string, customerIds: string[]): Promise<number | null> {
  const segment = await getSegment(segmentId, businessId);
  if (!segment || segment.kind !== 'static') return null;
  const { rowCount } = await adminPool.query(
    'DELETE FROM cus_segment_members WHERE segment_id = $1 AND business_id = $2 AND customer_id = ANY($3::uuid[])',
    [segmentId, businessId, customerIds],
  );
  return rowCount ?? 0;
}

/**
 * Build SQL WHERE clause from segment rules.
 */
function buildWhereClause(
  definition: SegmentDefinition,
  businessId: string,
): { whereClause: string; params: any[] } {
  const params: any[] = [businessId];
  let paramIndex = 2;

  const conditions: string[] = [`c.business_id = $1`, LIVE];
  const p: Param = (v) => { params.push(v); paramIndex = params.length + 1; return `$${params.length}`; };

  // One level of rules joined by AND / OR; a rule with field 'group' holds its own rules and
  // logic (e.g. "any of" inside "all of"), THE-18.
  const combine = (def: SegmentDefinition): string | null => {
    const ruleConditions: string[] = [];
    for (const rule of def.rules || []) {
      if (rule.field === 'group') {
        const inner = combine(rule.value || EMPTY_RULES);
        if (inner) ruleConditions.push(inner);
        continue;
      }
      const complex = COMPLEX_FIELDS[rule.field];
      if (complex) {
        const sql = complex(rule, p);
        if (sql) ruleConditions.push(sql);
        continue;
      }

      const booleanExpr = BOOLEAN_FIELD_MAP[rule.field];
      if (booleanExpr) {
        const wantTrue = rule.operator === 'is_false' ? false : !(rule.operator === 'eq' && rule.value === false);
        ruleConditions.push(wantTrue ? booleanExpr : `NOT ${booleanExpr}`);
        continue;
      }

      const column = FIELD_MAP[rule.field];
      if (!column) {
        logger.warn(`Unknown segment field: ${rule.field}`);
        continue;
      }

      const condition = buildCondition(column, rule.operator, rule.value, params, paramIndex);
      if (condition) {
        ruleConditions.push(condition.sql);
        paramIndex = condition.nextParamIndex;
      }
    }
    return ruleConditions.length ? `(${ruleConditions.join(def.logic === 'OR' ? ' OR ' : ' AND ')})` : null;
  };

  const all = combine(definition);
  if (all) conditions.push(all);

  return { whereClause: conditions.join(' AND '), params };
}

function buildCondition(
  column: string,
  operator: string,
  value: any,
  params: any[],
  paramIndex: number,
): { sql: string; nextParamIndex: number } | null {
  switch (operator) {
    case 'eq':
      params.push(value);
      return { sql: `${column} = $${paramIndex}`, nextParamIndex: paramIndex + 1 };

    case 'neq':
      params.push(value);
      return { sql: `${column} != $${paramIndex}`, nextParamIndex: paramIndex + 1 };

    case 'gt':
      params.push(value);
      return { sql: `${column} > $${paramIndex}`, nextParamIndex: paramIndex + 1 };

    case 'lt':
      params.push(value);
      return { sql: `${column} < $${paramIndex}`, nextParamIndex: paramIndex + 1 };

    // "Joined on or after" a date (THE-18).
    case 'gte':
      params.push(value);
      return { sql: `${column} >= $${paramIndex}`, nextParamIndex: paramIndex + 1 };

    case 'lte':
      params.push(value);
      return { sql: `${column} <= $${paramIndex}`, nextParamIndex: paramIndex + 1 };

    case 'in':
      if (!Array.isArray(value) || value.length === 0) return null;
      const placeholders = value.map((_, i) => `$${paramIndex + i}`).join(', ');
      params.push(...value);
      return { sql: `${column} IN (${placeholders})`, nextParamIndex: paramIndex + value.length };

    case 'between':
      if (!Array.isArray(value) || value.length !== 2) return null;
      params.push(value[0], value[1]);
      return { sql: `${column} BETWEEN $${paramIndex} AND $${paramIndex + 1}`, nextParamIndex: paramIndex + 2 };

    case 'contains':
      params.push(`%${value}%`);
      return { sql: `${column} ILIKE $${paramIndex}`, nextParamIndex: paramIndex + 1 };

    // Relative dates, so a saved segment keeps meaning "the last 30 days" as time passes.
    case 'within_days': {
      const days = parseInt(value, 10);
      if (!Number.isFinite(days) || days < 0) return null;
      params.push(days);
      return { sql: `${column} >= NOW() - ($${paramIndex}::int * INTERVAL '1 day')`, nextParamIndex: paramIndex + 1 };
    }

    case 'older_than_days': {
      const days = parseInt(value, 10);
      if (!Number.isFinite(days) || days < 0) return null;
      params.push(days);
      // "No visit in 30 days" includes people who have never visited.
      return { sql: `(${column} IS NULL OR ${column} < NOW() - ($${paramIndex}::int * INTERVAL '1 day'))`, nextParamIndex: paramIndex + 1 };
    }

    case 'never':
      return { sql: `${column} IS NULL`, nextParamIndex: paramIndex };

    default:
      return null;
  }
}

/** The starter segments every business gets (requirements.md R11.5). */
const STARTER_SEGMENTS: Array<{ name: string; description: string; rules: SegmentDefinition }> = [
  { name: 'Leads', description: 'People who have not booked or bought yet', rules: { logic: 'AND', rules: [{ field: 'lifecycle_stage', operator: 'eq', value: 'lead' }] } },
  { name: 'New customers', description: 'From their first booking until they become regulars', rules: { logic: 'AND', rules: [{ field: 'lifecycle_stage', operator: 'eq', value: 'trial' }] } },
  { name: 'Active', description: 'Regular customers', rules: { logic: 'AND', rules: [{ field: 'lifecycle_stage', operator: 'in', value: ['active', 'winback'] }] } },
  { name: 'At risk', description: 'Customers who have stopped coming', rules: { logic: 'AND', rules: [{ field: 'lifecycle_stage', operator: 'eq', value: 'at_risk' }] } },
  { name: 'Former', description: 'People who used to be customers', rules: { logic: 'AND', rules: [{ field: 'lifecycle_stage', operator: 'eq', value: 'churned' }] } },
  { name: 'New this month', description: 'Added since the first of the month', rules: { logic: 'AND', rules: [{ field: 'created_this_month', operator: 'is_true' }] } },
  { name: 'No visit in 30 days', description: 'Customers with no visit in the last 30 days', rules: { logic: 'AND', rules: [{ field: 'lifecycle_stage', operator: 'in', value: ['trial', 'active', 'at_risk', 'winback'] }, { field: 'last_visit_at', operator: 'older_than_days', value: 30 }] } },
  { name: 'Birthday this month', description: 'People whose birthday falls this month', rules: { logic: 'AND', rules: [{ field: 'birthday_this_month', operator: 'is_true' }] } },
];

// Starter segments shipped before Phase 46 whose names changed; removed so the list is not doubled.
const RETIRED_STARTER_NAMES = ['At risk (no visit in 60 days)', 'Active members'];

/**
 * Seed predefined segments for a business. Safe to run again: existing starter segments are
 * brought up to date, missing ones are added.
 */
export async function seedPredefinedSegments(businessId: string): Promise<void> {
  await adminPool.query(
    `DELETE FROM cus_segments s
      WHERE s.business_id = $1 AND s.is_predefined = true AND s.name = ANY($2)
        AND NOT EXISTS (SELECT 1 FROM mkt_campaigns c WHERE c.segment_id = s.id)`,
    [businessId, RETIRED_STARTER_NAMES],
  );

  for (const seg of STARTER_SEGMENTS) {
    const { rows } = await adminPool.query(
      'SELECT id FROM cus_segments WHERE business_id = $1 AND name = $2 AND is_predefined = true LIMIT 1',
      [businessId, seg.name],
    );
    if (rows[0]) {
      await adminPool.query(
        `UPDATE cus_segments SET rules = $1, description = $2, kind = 'dynamic', updated_at = NOW() WHERE id = $3`,
        [JSON.stringify(seg.rules), seg.description, rows[0].id],
      );
    } else {
      await adminPool.query(
        `INSERT INTO cus_segments (business_id, name, rules, is_predefined, kind, description)
         VALUES ($1, $2, $3, true, 'dynamic', $4)`,
        [businessId, seg.name, JSON.stringify(seg.rules), seg.description],
      );
    }
  }
}
