import { adminPool } from '../db/pool';
import { logAudit } from './audit.service';

interface CreateSeriesInput {
  title: string;
  description?: string;
  totalSessions: number;
  pricingModel: 'series' | 'per_session' | 'drop_in';
  seriesPrice?: number; // cents
  allowDropIn: boolean;
  requireSequential: boolean;
}

/**
 * List event series for a tenant.
 */
export async function getSeries(tenantId: string) {
  const { rows } = await adminPool.query(
    `SELECT es.*,
            (SELECT COUNT(*)::int FROM events WHERE series_id = es.id) AS event_count
     FROM event_series es
     WHERE es.tenant_id = $1
     ORDER BY es.created_at DESC`,
    [tenantId],
  );
  return rows;
}

/**
 * Create an event series.
 */
export async function createSeries(tenantId: string, input: CreateSeriesInput) {
  const { rows } = await adminPool.query(
    `INSERT INTO event_series (
       tenant_id, title, description, total_sessions,
       pricing_model, series_price, allow_drop_in, require_sequential
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
     RETURNING *`,
    [
      tenantId,
      input.title,
      input.description || null,
      input.totalSessions,
      input.pricingModel,
      input.seriesPrice || null,
      input.allowDropIn,
      input.requireSequential,
    ],
  );

  await logAudit({
    tenantId,
    action: 'event_series.created',
    resourceType: 'event_series',
    resourceId: rows[0].id,
    details: { title: input.title },
  });

  return rows[0];
}

/**
 * Get a series by ID.
 */
export async function getSeriesById(id: string, tenantId: string) {
  const { rows } = await adminPool.query(
    `SELECT es.*,
            (SELECT COUNT(*)::int FROM events WHERE series_id = es.id) AS event_count
     FROM event_series es
     WHERE es.id = $1 AND es.tenant_id = $2`,
    [id, tenantId],
  );
  return rows[0] || null;
}

/**
 * Update a series.
 */
export async function updateSeries(id: string, tenantId: string, updates: Record<string, any>) {
  const fields: string[] = [];
  const values: any[] = [];
  let idx = 1;

  const allowedFields = [
    'title', 'description', 'total_sessions', 'pricing_model',
    'series_price', 'allow_drop_in', 'require_sequential',
  ];

  for (const key of allowedFields) {
    if (updates[key] !== undefined) {
      fields.push(`${key} = $${idx++}`);
      values.push(updates[key]);
    }
  }

  if (fields.length === 0) return null;
  values.push(id, tenantId);

  const { rows } = await adminPool.query(
    `UPDATE event_series SET ${fields.join(', ')}
     WHERE id = $${idx++} AND tenant_id = $${idx} RETURNING *`,
    values,
  );

  if (rows[0]) {
    await logAudit({
      tenantId,
      action: 'event_series.updated',
      resourceType: 'event_series',
      resourceId: id,
      details: updates,
    });
  }

  return rows[0] || null;
}

/**
 * Get a customer's progress in a series: sessions attended / total.
 */
export async function getSeriesProgress(seriesId: string, customerId: string) {
  const { rows: seriesRows } = await adminPool.query(
    `SELECT total_sessions FROM event_series WHERE id = $1`,
    [seriesId],
  );
  if (seriesRows.length === 0) throw new Error('Series not found');

  const { rows: attendedRows } = await adminPool.query(
    `SELECT COUNT(*)::int AS attended
     FROM event_registrations er
     JOIN events e ON e.id = er.event_id
     WHERE e.series_id = $1
       AND er.customer_id = $2
       AND er.status = 'confirmed'
       AND er.checked_in_at IS NOT NULL`,
    [seriesId, customerId],
  );

  return {
    seriesId,
    customerId,
    attended: attendedRows[0].attended,
    totalSessions: seriesRows[0].total_sessions,
    completionPercentage: Math.round((attendedRows[0].attended / seriesRows[0].total_sessions) * 100),
  };
}
