import { adminPool } from '../db/pool';
import { logger } from '../middleware/logger';

interface SegmentRule {
  field: string;
  operator: 'eq' | 'neq' | 'gt' | 'lt' | 'in' | 'between' | 'contains';
  value: any;
}

interface SegmentDefinition {
  logic: 'AND' | 'OR';
  rules: SegmentRule[];
}

interface CreateSegmentInput {
  businessId: string;
  name: string;
  rules: SegmentDefinition;
  createdBy: string;
}

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
};

/**
 * Create a saved segment.
 */
export async function createSegment(input: CreateSegmentInput) {
  const { rows } = await adminPool.query(
    `INSERT INTO segments (business_id, name, rules, is_predefined, created_by)
     VALUES ($1, $2, $3, false, $4)
     RETURNING *`,
    [input.businessId, input.name, JSON.stringify(input.rules), input.createdBy],
  );
  return rows[0];
}

/**
 * List all segments for a business.
 */
export async function getSegments(businessId: string) {
  const { rows } = await adminPool.query(
    'SELECT * FROM segments WHERE business_id = $1 ORDER BY created_at DESC',
    [businessId],
  );
  return rows;
}

/**
 * Delete a segment.
 */
export async function deleteSegment(id: string, businessId: string): Promise<boolean> {
  const { rowCount } = await adminPool.query(
    'DELETE FROM segments WHERE id = $1 AND business_id = $2 AND is_predefined = false',
    [id, businessId],
  );
  return (rowCount ?? 0) > 0;
}

/**
 * Evaluate a segment's rules and return matching customers + count.
 */
export async function evaluateSegment(segmentId: string, businessId: string, page = 1, limit = 20) {
  const { rows: segRows } = await adminPool.query(
    'SELECT rules FROM segments WHERE id = $1 AND business_id = $2',
    [segmentId, businessId],
  );

  if (segRows.length === 0) return null;

  const rules: SegmentDefinition = typeof segRows[0].rules === 'string'
    ? JSON.parse(segRows[0].rules)
    : segRows[0].rules;

  return evaluateRules(rules, businessId, page, limit);
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
      `SELECT c.* FROM customers c WHERE ${whereClause} ORDER BY c.created_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, safeLimit, offset],
    ),
    adminPool.query(
      `SELECT COUNT(*)::int AS total FROM customers c WHERE ${whereClause}`,
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

/**
 * Build SQL WHERE clause from segment rules.
 */
function buildWhereClause(
  definition: SegmentDefinition,
  businessId: string,
): { whereClause: string; params: any[] } {
  const params: any[] = [businessId];
  let paramIndex = 2;

  const conditions: string[] = [`c.business_id = $1`, `c.status != 'anonymized'`];
  const ruleConditions: string[] = [];

  for (const rule of definition.rules) {
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

    default:
      return null;
  }
}

/**
 * Seed predefined segments for a business.
 */
export async function seedPredefinedSegments(businessId: string): Promise<void> {
  const predefined = [
    {
      name: 'New this month',
      rules: { logic: 'AND', rules: [{ field: 'created_at', operator: 'gt', value: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString() }] },
    },
    {
      name: 'At risk (no visit in 60 days)',
      rules: { logic: 'AND', rules: [{ field: 'lifecycle_stage', operator: 'in', value: ['at_risk', 'churned'] }] },
    },
    {
      name: 'Active members',
      rules: { logic: 'AND', rules: [{ field: 'lifecycle_stage', operator: 'eq', value: 'active' }] },
    },
    {
      name: 'Leads',
      rules: { logic: 'AND', rules: [{ field: 'lifecycle_stage', operator: 'eq', value: 'lead' }] },
    },
  ];

  for (const seg of predefined) {
    await adminPool.query(
      `INSERT INTO segments (business_id, name, rules, is_predefined)
       VALUES ($1, $2, $3, true)
       ON CONFLICT DO NOTHING`,
      [businessId, seg.name, JSON.stringify(seg.rules)],
    );
  }
}
