import { adminPool } from '../../../db/pool';
import { ReportDefinition } from '../types';
import { computeDailyHours } from '../../clock.service';

/**
 * Timesheet report — clocked hours by staff and day, for compliance review and
 * payroll reconciliation.
 *
 * One row per staff member per day on which they have clock activity, showing
 * worked hours (net of breaks) and break hours. Hours are derived from the
 * clk_events log via the shared computeDailyHours helper — the SAME computation
 * that feeds clocked-basis hourly payroll — so the report reconciles with pay.
 * Day bucketing uses the business timezone. Group by Staff for per-person
 * totals; the Worked/Break columns total across the range.
 *
 * Uses adminPool scoped by business_id, matching the other reports.
 */
export const timesheetReport: ReportDefinition = {
  id: 'timesheet',
  title: 'Timesheet',
  columns: [
    { key: 'date', header: 'Date', type: 'date', filterable: true },
    { key: 'staff', header: 'Staff', type: 'text', filterable: true, groupable: true },
    { key: 'worked_hours', header: 'Worked Hours', type: 'number', total: true },
    { key: 'break_hours', header: 'Break Hours', type: 'number', total: true },
  ],
  run: async (ctx) => {
    const { businessId, start, end } = ctx;

    const { rows: bizRows } = await adminPool.query(
      `SELECT COALESCE(timezone, 'UTC') AS tz FROM sys_businesses WHERE id = $1`,
      [businessId],
    );
    const tz: string = bizRows[0]?.tz || 'UTC';

    // Staff who have any clock activity in the range, with display names.
    const { rows: staff } = await adminPool.query(
      `SELECT DISTINCT ce.user_id,
              TRIM(COALESCE(u.first_name, '') || ' ' || COALESCE(u.last_name, '')) AS staff
         FROM clk_events ce
         JOIN usr_users u ON u.id = ce.user_id
        WHERE ce.business_id = $1
          AND ce.event_at >= $2::timestamptz AND ce.event_at < ($3::date + INTERVAL '1 day')`,
      [businessId, start, end],
    );

    const toHours = (mins: number) => Math.round((mins / 60) * 100) / 100;
    const rows: Record<string, any>[] = [];

    for (const s of staff) {
      const days = await computeDailyHours(businessId, s.user_id, start, end, tz);
      for (const d of days) {
        // Skip days that netted no time (e.g. only a dangling punch).
        if (d.worked_minutes === 0 && d.break_minutes === 0) continue;
        rows.push({
          date: d.date,
          staff: s.staff || '—',
          worked_hours: toHours(d.worked_minutes),
          break_hours: toHours(d.break_minutes),
        });
      }
    }

    rows.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : a.staff.localeCompare(b.staff)));
    return rows;
  },
};
