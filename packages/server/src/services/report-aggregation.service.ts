import { adminPool } from '../db/pool';

const UPSERT_METRIC = `
  INSERT INTO report_daily_metrics (tenant_id, metric_date, metric_category, metric_name, metric_value, dimensions)
  VALUES ($1, $2, $3, $4, $5, $6)
  ON CONFLICT (tenant_id, metric_date, metric_category, metric_name, dimensions)
  DO UPDATE SET metric_value = EXCLUDED.metric_value`;

/**
 * Run all daily aggregations for a tenant on a given date.
 */
export async function runDailyAggregation(tenantId: string, date: string) {
  await aggregateRevenue(tenantId, date);
  await aggregateBookings(tenantId, date);
  await aggregateMemberships(tenantId, date);
  await aggregateCustomers(tenantId, date);
  await aggregateCheckins(tenantId, date);
}

/**
 * Aggregate revenue metrics from completed bookings.
 */
export async function aggregateRevenue(tenantId: string, date: string) {
  const { rows } = await adminPool.query(
    `SELECT COALESCE(SUM(b.price), 0) AS total_revenue, COUNT(*)::int AS booking_count
     FROM bookings b
     JOIN businesses bus ON bus.id = b.business_id
     WHERE bus.tenant_id = $1
       AND b.status = 'completed'
       AND b.start_time::date = $2::date`,
    [tenantId, date],
  );

  const { total_revenue, booking_count } = rows[0];

  await adminPool.query(UPSERT_METRIC, [tenantId, date, 'revenue', 'total_revenue', total_revenue, '{}']);
  await adminPool.query(UPSERT_METRIC, [tenantId, date, 'revenue', 'completed_bookings', booking_count, '{}']);

  if (booking_count > 0) {
    const avg = parseFloat(total_revenue) / booking_count;
    await adminPool.query(UPSERT_METRIC, [tenantId, date, 'revenue', 'avg_per_booking', avg.toFixed(2), '{}']);
  }
}

/**
 * Aggregate booking metrics by status.
 */
export async function aggregateBookings(tenantId: string, date: string) {
  const { rows } = await adminPool.query(
    `SELECT b.status, COUNT(*)::int AS cnt
     FROM bookings b
     JOIN businesses bus ON bus.id = b.business_id
     WHERE bus.tenant_id = $1 AND b.start_time::date = $2::date
     GROUP BY b.status`,
    [tenantId, date],
  );

  for (const row of rows) {
    await adminPool.query(UPSERT_METRIC, [
      tenantId, date, 'bookings', `status_${row.status}`, row.cnt, '{}',
    ]);
  }

  const total = rows.reduce((sum, r) => sum + r.cnt, 0);
  await adminPool.query(UPSERT_METRIC, [tenantId, date, 'bookings', 'total', total, '{}']);
}

/**
 * Aggregate membership metrics.
 */
export async function aggregateMemberships(tenantId: string, date: string) {
  const { rows: activeRows } = await adminPool.query(
    `SELECT COUNT(*)::int AS cnt FROM memberships
     WHERE tenant_id = $1 AND status = 'active' AND started_at <= $2::date`,
    [tenantId, date],
  );

  const { rows: newRows } = await adminPool.query(
    `SELECT COUNT(*)::int AS cnt FROM memberships
     WHERE tenant_id = $1 AND started_at::date = $2::date`,
    [tenantId, date],
  );

  const { rows: cancelledRows } = await adminPool.query(
    `SELECT COUNT(*)::int AS cnt FROM memberships
     WHERE tenant_id = $1 AND cancelled_at::date = $2::date`,
    [tenantId, date],
  );

  await adminPool.query(UPSERT_METRIC, [tenantId, date, 'memberships', 'active', activeRows[0].cnt, '{}']);
  await adminPool.query(UPSERT_METRIC, [tenantId, date, 'memberships', 'new', newRows[0].cnt, '{}']);
  await adminPool.query(UPSERT_METRIC, [tenantId, date, 'memberships', 'cancelled', cancelledRows[0].cnt, '{}']);
}

/**
 * Aggregate customer metrics.
 */
export async function aggregateCustomers(tenantId: string, date: string) {
  const { rows: totalRows } = await adminPool.query(
    `SELECT COUNT(*)::int AS cnt FROM customers
     WHERE tenant_id = $1 AND created_at::date <= $2::date`,
    [tenantId, date],
  );

  const { rows: newRows } = await adminPool.query(
    `SELECT COUNT(*)::int AS cnt FROM customers
     WHERE tenant_id = $1 AND created_at::date = $2::date`,
    [tenantId, date],
  );

  await adminPool.query(UPSERT_METRIC, [tenantId, date, 'customers', 'total', totalRows[0].cnt, '{}']);
  await adminPool.query(UPSERT_METRIC, [tenantId, date, 'customers', 'new', newRows[0].cnt, '{}']);
}

/**
 * Aggregate check-in metrics.
 */
export async function aggregateCheckins(tenantId: string, date: string) {
  const { rows } = await adminPool.query(
    `SELECT check_in_method, COUNT(*)::int AS cnt
     FROM check_in_records
     WHERE tenant_id = $1 AND check_in_time::date = $2::date AND status = 'completed'
     GROUP BY check_in_method`,
    [tenantId, date],
  );

  let total = 0;
  for (const row of rows) {
    total += row.cnt;
    await adminPool.query(UPSERT_METRIC, [
      tenantId, date, 'checkins', `method_${row.check_in_method}`, row.cnt, '{}',
    ]);
  }

  await adminPool.query(UPSERT_METRIC, [tenantId, date, 'checkins', 'total', total, '{}']);
}
