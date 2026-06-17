import { adminPool } from '../db/pool';

interface ExportableData {
  headers: string[];
  rows: (string | number | null)[][];
}

/**
 * Export data to CSV string.
 */
export function exportToCsv(data: ExportableData): string {
  const escapeCsvField = (field: string | number | null): string => {
    if (field === null || field === undefined) return '';
    const str = String(field);
    if (str.includes(',') || str.includes('"') || str.includes('\n')) {
      return `"${str.replace(/"/g, '""')}"`;
    }
    return str;
  };

  const headerLine = data.headers.map(escapeCsvField).join(',');
  const dataLines = data.rows.map(row => row.map(escapeCsvField).join(','));

  return [headerLine, ...dataLines].join('\n');
}

/**
 * Export data to JSON string.
 */
export function exportToJson(data: ExportableData): string {
  const objects = data.rows.map(row => {
    const obj: Record<string, string | number | null> = {};
    data.headers.forEach((header, i) => {
      obj[header] = row[i] ?? null;
    });
    return obj;
  });

  return JSON.stringify(objects, null, 2);
}

/**
 * Resolve report data into exportable format with headers and rows.
 */
export async function getExportData(
  tenantId: string,
  reportType: string,
  startDate: string,
  endDate: string,
): Promise<ExportableData> {
  switch (reportType) {
    case 'revenue': {
      const { rows } = await adminPool.query(
        `SELECT b.start_time::date AS date, b.service_id, b.price, b.status
         FROM bookings b
         JOIN businesses bus ON bus.id = b.business_id
         WHERE bus.tenant_id = $1
           AND b.status = 'completed'
           AND b.start_time >= $2::date
           AND b.start_time < ($3::date + INTERVAL '1 day')
         ORDER BY b.start_time`,
        [tenantId, startDate, endDate],
      );
      return {
        headers: ['date', 'service_id', 'price', 'status'],
        rows: rows.map(r => [r.date, r.service_id, r.price, r.status]),
      };
    }

    case 'bookings': {
      const { rows } = await adminPool.query(
        `SELECT b.id, b.start_time, b.end_time, b.status, b.customer_id, b.service_id, b.price
         FROM bookings b
         JOIN businesses bus ON bus.id = b.business_id
         WHERE bus.tenant_id = $1
           AND b.start_time >= $2::date
           AND b.start_time < ($3::date + INTERVAL '1 day')
         ORDER BY b.start_time`,
        [tenantId, startDate, endDate],
      );
      return {
        headers: ['id', 'start_time', 'end_time', 'status', 'customer_id', 'service_id', 'price'],
        rows: rows.map(r => [r.id, r.start_time, r.end_time, r.status, r.customer_id, r.service_id, r.price]),
      };
    }

    case 'memberships': {
      const { rows } = await adminPool.query(
        `SELECT m.id, m.customer_id, m.plan_id, m.status, m.started_at, m.cancelled_at
         FROM memberships m
         WHERE m.tenant_id = $1
           AND m.started_at <= $2::date
           AND (m.cancelled_at IS NULL OR m.cancelled_at >= $3::date)
         ORDER BY m.started_at`,
        [tenantId, endDate, startDate],
      );
      return {
        headers: ['id', 'customer_id', 'plan_id', 'status', 'started_at', 'cancelled_at'],
        rows: rows.map(r => [r.id, r.customer_id, r.plan_id, r.status, r.started_at, r.cancelled_at]),
      };
    }

    case 'customers': {
      const { rows } = await adminPool.query(
        `SELECT c.id, c.status, c.created_at
         FROM customers c
         WHERE c.tenant_id = $1
           AND c.created_at >= $2::date
           AND c.created_at < ($3::date + INTERVAL '1 day')
         ORDER BY c.created_at`,
        [tenantId, startDate, endDate],
      );
      return {
        headers: ['id', 'status', 'created_at'],
        rows: rows.map(r => [r.id, r.status, r.created_at]),
      };
    }

    case 'metrics': {
      const { rows } = await adminPool.query(
        `SELECT metric_date, metric_category, metric_name, metric_value
         FROM report_daily_metrics
         WHERE tenant_id = $1
           AND metric_date BETWEEN $2::date AND $3::date
         ORDER BY metric_date, metric_category, metric_name`,
        [tenantId, startDate, endDate],
      );
      return {
        headers: ['metric_date', 'metric_category', 'metric_name', 'metric_value'],
        rows: rows.map(r => [r.metric_date, r.metric_category, r.metric_name, r.metric_value]),
      };
    }

    default:
      return { headers: [], rows: [] };
  }
}
