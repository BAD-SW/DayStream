import { adminPool } from '../db/pool';

interface DateRange {
  start: string;
  end: string;
}

interface Widget {
  id: string;
  type: string;
  metric_category: string;
  metric_name?: string;
  title: string;
  size?: string;
}

/**
 * Get full dashboard data: resolve config then fetch metrics for each widget.
 */
export async function getDashboardData(tenantId: string, userId: string, dateRange: DateRange) {
  const config = await getDashboardConfig(tenantId, userId);
  const widgets: Widget[] = config?.widgets || getDefaultWidgets('owner');

  const widgetData = await Promise.all(
    widgets.map(async (widget) => {
      const metrics = await adminPool.query(
        `SELECT metric_date, metric_name, metric_value
         FROM report_daily_metrics
         WHERE tenant_id = $1
           AND metric_category = $2
           AND metric_date BETWEEN $3::date AND $4::date
         ORDER BY metric_date`,
        [tenantId, widget.metric_category, dateRange.start, dateRange.end],
      );

      return {
        ...widget,
        data: metrics.rows,
      };
    }),
  );

  return { widgets: widgetData, dateRange };
}

/**
 * Get a user's dashboard configuration.
 */
export async function getDashboardConfig(tenantId: string, userId: string) {
  const { rows } = await adminPool.query(
    `SELECT * FROM dashboard_configs
     WHERE tenant_id = $1 AND user_id = $2
     ORDER BY is_default DESC, updated_at DESC
     LIMIT 1`,
    [tenantId, userId],
  );
  return rows[0] || null;
}

/**
 * Save or update a user's dashboard configuration.
 */
export async function saveDashboardConfig(tenantId: string, userId: string, widgets: Widget[]) {
  const { rows } = await adminPool.query(
    `INSERT INTO dashboard_configs (tenant_id, user_id, widgets)
     VALUES ($1, $2, $3)
     ON CONFLICT (id) DO UPDATE SET widgets = EXCLUDED.widgets, updated_at = NOW()
     RETURNING *`,
    [tenantId, userId, JSON.stringify(widgets)],
  );

  // If no row was updated via conflict, try upsert by user
  if (rows.length === 0) {
    const { rows: updated } = await adminPool.query(
      `UPDATE dashboard_configs SET widgets = $3, updated_at = NOW()
       WHERE tenant_id = $1 AND user_id = $2
       RETURNING *`,
      [tenantId, userId, JSON.stringify(widgets)],
    );
    return updated[0] || null;
  }

  return rows[0];
}

/**
 * Get default widgets based on role type.
 */
export function getDefaultWidgets(roleType: string): Widget[] {
  const baseWidgets: Widget[] = [
    { id: 'revenue-total', type: 'metric', metric_category: 'revenue', metric_name: 'total_revenue', title: 'Total Revenue' },
    { id: 'bookings-total', type: 'metric', metric_category: 'bookings', metric_name: 'total', title: 'Total Bookings' },
    { id: 'customers-new', type: 'metric', metric_category: 'customers', metric_name: 'new', title: 'New Customers' },
    { id: 'checkins-total', type: 'metric', metric_category: 'checkins', metric_name: 'total', title: 'Check-ins' },
  ];

  if (roleType === 'owner' || roleType === 'admin') {
    return [
      ...baseWidgets,
      { id: 'memberships-active', type: 'metric', metric_category: 'memberships', metric_name: 'active', title: 'Active Memberships' },
      { id: 'revenue-trend', type: 'chart', metric_category: 'revenue', title: 'Revenue Trend', size: 'wide' },
    ];
  }

  return baseWidgets;
}
