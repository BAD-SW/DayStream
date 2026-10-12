import { adminPool } from '../db/pool';
import { logger } from '../middleware/logger';
import { filterAudience, summarise, Channel, Purpose, AudienceSummary } from './contactability.service';

interface SegmentRule {
  field: string;
  operator: 'eq' | 'neq' | 'gt' | 'lt' | 'in' | 'between' | 'contains' | 'within_days' | 'older_than_days' | 'never' | 'is_true' | 'is_false';
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
};

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
  const ruleConditions: string[] = [];

  for (const rule of definition.rules) {
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

  if (ruleConditions.length > 0) {
    const logic = definition.logic === 'OR' ? ' OR ' : ' AND ';
    conditions.push(`(${ruleConditions.join(logic)})`);
  }

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
