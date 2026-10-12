import { Router, Request, Response } from 'express';
import { authenticate, AuthenticatedRequest } from '../auth/middleware';
import { tenantContext, callerScope } from '../auth/tenant-context';
import { withReportBusiness } from '../services/report-scope';
import { adminPool } from '../db/pool';
import { requirePermission } from '../auth/permissions';
import { success, error } from '../utils/response';
import * as aggregationService from '../services/report-aggregation.service';
import * as dashboardService from '../services/report-dashboard.service';
import * as revenueService from '../services/report-revenue.service';
import * as bookingsService from '../services/report-bookings.service';
import * as membershipsService from '../services/report-memberships.service';
import * as staffService from '../services/report-staff.service';
import * as customersService from '../services/report-customers.service';
import * as financialService from '../services/report-financial.service';
import * as schedulingService from '../services/report-scheduling.service';
import * as exportService from '../services/report-export.service';
import { getReportDefinition } from '../services/reports/registry';
import { runReport } from '../services/reports/run.service';
import { toCsv, toPdf, exportFilename } from '../services/reports/export.service';

export const reportsRouter = Router();
reportsRouter.use(authenticate);
reportsRouter.use(tenantContext);

// Reports are for one business: the one named in the request (already checked by
// tenantContext) or the caller's own. Only a tenant-level user who names none gets the whole
// tenant. The older reports used to cover every business of the tenant for everyone.
reportsRouter.use(async (req: Request, res: Response, next) => {
  try {
    const authReq = req as AuthenticatedRequest;
    const scope = await callerScope(authReq.user.sub);
    let businessId = resolveBusinessId(req);
    if (scope?.level === 'business' && scope.businessId) businessId = scope.businessId;
    (req as any).reportBusinessId = businessId;
    (req as any).reportWholeTenant = !businessId;
    withReportBusiness(businessId, () => next());
  } catch (err: any) { console.error('Report scope failed', err?.message || err); error(res, 'Failed', 'INTERNAL_ERROR', 500); }
});

/**
 * Figures that exist per tenant only (the stored daily metrics, scheduled reports): a
 * business-level user may use them when the tenant has just that one business.
 */
async function tenantWideAllowed(req: Request): Promise<boolean> {
  const authReq = req as AuthenticatedRequest;
  const scope = await callerScope(authReq.user.sub);
  if (scope?.level !== 'business') return true;
  const { rows } = await adminPool.query("SELECT COUNT(*)::int AS n FROM sys_businesses WHERE tenant_id = $1 AND status <> 'archived'", [authReq.tenantId]);
  return rows[0].n <= 1;
}

// A report period is two calendar days, the first not after the second.
reportsRouter.use((req: Request, res: Response, next) => {
  const { start_date: a, end_date: b } = req.query as Record<string, string | undefined>;
  const isDay = (v: string) => /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v + 'T00:00:00Z'));
  if ((a !== undefined && !isDay(a)) || (b !== undefined && !isDay(b))) { error(res, 'Dates must be given as YYYY-MM-DD', 'VALIDATION_ERROR', 400); return; }
  if (a && b && a > b) { error(res, 'The start date is after the end date', 'VALIDATION_ERROR', 400); return; }
  next();
});

reportsRouter.use(async (req: Request, res: Response, next) => {
  const tenantWide = /^\/(dashboard|scheduled|aggregate)(\/|$)/.test(req.path) && !req.path.startsWith('/dashboard/config');
  if (!tenantWide) { next(); return; }
  try {
    if (await tenantWideAllowed(req)) { next(); return; }
    if (req.method !== 'GET') { error(res, 'This is managed for the whole organisation by a tenant administrator', 'FORBIDDEN', 403); return; }
    success(res, req.path.startsWith('/scheduled') ? [] : { widgets: [] });
  } catch (err: any) { console.error('Report scope failed', err?.message || err); error(res, 'Failed', 'INTERNAL_ERROR', 500); }
});

// --- Report Framework (generic run + export, keyed by report id) ---

/** Resolve the business id the same way business-scoped report routes do. */
function resolveBusinessId(req: Request): string | null {
  return (req.headers['x-business-id'] as string)
    || (req.query.business_id as string)
    || null;
}

function resolveDateRange(req: Request): { start: string; end: string } {
  const start = (req.query.start_date as string) || new Date(Date.now() - 30 * 86400000).toISOString().split('T')[0];
  const end = (req.query.end_date as string) || new Date().toISOString().split('T')[0];
  return { start, end };
}

reportsRouter.get('/run/:reportId', requirePermission('reports:read'), async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthenticatedRequest;
    const definition = getReportDefinition(req.params.reportId);
    if (!definition) { error(res, 'Unknown report', 'NOT_FOUND', 404); return; }

    const businessId = resolveBusinessId(req);
    if (!businessId) { error(res, 'Business ID is required', 'MISSING_BUSINESS_ID', 400); return; }

    const { start, end } = resolveDateRange(req);
    const result = await runReport(definition, { tenantId: authReq.tenantId, businessId, start, end });
    success(res, result);
  } catch (err: any) {
    console.error('Failed to run report', err?.message || err);
    error(res, 'Failed to run report', 'INTERNAL_ERROR', 500);
  }
});

reportsRouter.get('/run/:reportId/export', requirePermission('reports:read'), async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthenticatedRequest;
    const definition = getReportDefinition(req.params.reportId);
    if (!definition) { error(res, 'Unknown report', 'NOT_FOUND', 404); return; }

    const format = (req.query.format as string) || 'csv';
    if (format !== 'csv' && format !== 'pdf') { error(res, 'Unsupported format', 'BAD_REQUEST', 400); return; }

    const businessId = resolveBusinessId(req);
    if (!businessId) { error(res, 'Business ID is required', 'MISSING_BUSINESS_ID', 400); return; }

    const { start, end } = resolveDateRange(req);
    const result = await runReport(definition, { tenantId: authReq.tenantId, businessId, start, end });
    const filename = exportFilename(result, format);

    if (format === 'pdf') {
      const buffer = await toPdf(result);
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      res.send(buffer);
    } else {
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      res.send(toCsv(result));
    }
  } catch (err: any) {
    console.error('Failed to export report', err?.message || err);
    error(res, 'Failed to export report', 'INTERNAL_ERROR', 500);
  }
});

// --- Dashboard ---
reportsRouter.get('/dashboard', requirePermission('reports:read'), async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthenticatedRequest;
    const start = req.query.start_date as string || new Date(Date.now() - 30 * 86400000).toISOString().split('T')[0];
    const end = req.query.end_date as string || new Date().toISOString().split('T')[0];
    const data = await dashboardService.getDashboardData(authReq.tenantId, authReq.user.sub, { start, end });
    success(res, data);
  } catch (err: any) { console.error('Failed', err?.message || err); error(res, 'Failed', 'INTERNAL_ERROR', 500); }
});

reportsRouter.get('/dashboard/config', requirePermission('reports:read'), async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthenticatedRequest;
    const config = await dashboardService.getDashboardConfig(authReq.tenantId, authReq.user.sub);
    success(res, config || { widgets: dashboardService.getDefaultWidgets('owner') });
  } catch (err: any) { console.error('Failed', err?.message || err); error(res, 'Failed', 'INTERNAL_ERROR', 500); }
});

reportsRouter.put('/dashboard/config', requirePermission('reports:read'), async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthenticatedRequest;
    const config = await dashboardService.saveDashboardConfig(authReq.tenantId, authReq.user.sub, req.body.widgets || []);
    success(res, config);
  } catch (err: any) { console.error('Failed', err?.message || err); error(res, 'Failed', 'INTERNAL_ERROR', 500); }
});

// --- Domain Reports ---
reportsRouter.get('/revenue', requirePermission('reports:read'), async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthenticatedRequest;
    const start = req.query.start_date as string || new Date(Date.now() - 30 * 86400000).toISOString().split('T')[0];
    const end = req.query.end_date as string || new Date().toISOString().split('T')[0];
    const data = await revenueService.getRevenueReport(authReq.tenantId, start, end);
    success(res, data);
  } catch (err: any) { console.error('Failed', err?.message || err); error(res, 'Failed', 'INTERNAL_ERROR', 500); }
});

reportsRouter.get('/bookings', requirePermission('reports:read'), async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthenticatedRequest;
    const start = req.query.start_date as string || new Date(Date.now() - 30 * 86400000).toISOString().split('T')[0];
    const end = req.query.end_date as string || new Date().toISOString().split('T')[0];
    const data = await bookingsService.getBookingsReport(authReq.tenantId, start, end);
    success(res, data);
  } catch (err: any) { console.error('Failed', err?.message || err); error(res, 'Failed', 'INTERNAL_ERROR', 500); }
});

reportsRouter.get('/memberships', requirePermission('reports:read'), async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthenticatedRequest;
    const start = req.query.start_date as string || new Date(Date.now() - 30 * 86400000).toISOString().split('T')[0];
    const end = req.query.end_date as string || new Date().toISOString().split('T')[0];
    const data = await membershipsService.getMembershipsReport(authReq.tenantId, start, end);
    success(res, data);
  } catch (err: any) { console.error('Failed', err?.message || err); error(res, 'Failed', 'INTERNAL_ERROR', 500); }
});

reportsRouter.get('/staff', requirePermission('reports:read'), async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthenticatedRequest;
    const start = req.query.start_date as string || new Date(Date.now() - 30 * 86400000).toISOString().split('T')[0];
    const end = req.query.end_date as string || new Date().toISOString().split('T')[0];
    const data = await staffService.getStaffReport(authReq.tenantId, start, end);
    success(res, data);
  } catch (err: any) { console.error('Failed', err?.message || err); error(res, 'Failed', 'INTERNAL_ERROR', 500); }
});

reportsRouter.get('/customers', requirePermission('reports:read'), async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthenticatedRequest;
    const start = req.query.start_date as string || new Date(Date.now() - 30 * 86400000).toISOString().split('T')[0];
    const end = req.query.end_date as string || new Date().toISOString().split('T')[0];
    const data = await customersService.getCustomersReport(authReq.tenantId, start, end);
    success(res, data);
  } catch (err: any) { console.error('Failed', err?.message || err); error(res, 'Failed', 'INTERNAL_ERROR', 500); }
});

reportsRouter.get('/financial', requirePermission('reports:read'), async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthenticatedRequest;
    const start = req.query.start_date as string || new Date(Date.now() - 30 * 86400000).toISOString().split('T')[0];
    const end = req.query.end_date as string || new Date().toISOString().split('T')[0];
    const data = await financialService.getFinancialReport(authReq.tenantId, start, end);
    success(res, data);
  } catch (err: any) { console.error('Failed', err?.message || err); error(res, 'Failed', 'INTERNAL_ERROR', 500); }
});

// --- Aggregation ---
reportsRouter.post('/aggregate', requirePermission('reports:*'), async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthenticatedRequest;
    const date = req.body.date || new Date(Date.now() - 86400000).toISOString().split('T')[0];
    await aggregationService.runDailyAggregation(authReq.tenantId, date);
    success(res, { aggregated: true, date });
  } catch (err: any) { console.error('Failed', err?.message || err); error(res, 'Failed', 'INTERNAL_ERROR', 500); }
});

// --- Scheduled Reports ---
reportsRouter.get('/scheduled', requirePermission('reports:read'), async (req: Request, res: Response) => {
  try { const authReq = req as AuthenticatedRequest; const data = await schedulingService.getScheduledReports(authReq.tenantId); success(res, data); }
  catch (err: any) { console.error('Failed', err?.message || err); error(res, 'Failed', 'INTERNAL_ERROR', 500); }
});
reportsRouter.post('/scheduled', requirePermission('reports:*'), async (req: Request, res: Response) => {
  try { const authReq = req as AuthenticatedRequest; const r = await schedulingService.createScheduledReport(authReq.tenantId, { ...req.body, created_by: authReq.user.sub }); success(res, r, undefined, 201); }
  catch (err: any) { console.error('Failed', err?.message || err); error(res, 'Failed', 'INTERNAL_ERROR', 500); }
});
reportsRouter.put('/scheduled/:id', requirePermission('reports:*'), async (req: Request, res: Response) => {
  try { const authReq = req as AuthenticatedRequest; const r = await schedulingService.updateScheduledReport(req.params.id, authReq.tenantId, req.body); if (!r) { error(res, 'Not found', 'NOT_FOUND', 404); return; } success(res, r); }
  catch (err: any) { console.error('Failed', err?.message || err); error(res, 'Failed', 'INTERNAL_ERROR', 500); }
});
reportsRouter.delete('/scheduled/:id', requirePermission('reports:*'), async (req: Request, res: Response) => {
  try { const authReq = req as AuthenticatedRequest; const d = await schedulingService.deleteScheduledReport(req.params.id, authReq.tenantId); if (!d) { error(res, 'Not found', 'NOT_FOUND', 404); return; } success(res, { deleted: true }); }
  catch (err: any) { console.error('Failed', err?.message || err); error(res, 'Failed', 'INTERNAL_ERROR', 500); }
});

// --- Export ---
reportsRouter.get('/:type/export', requirePermission('reports:read'), async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthenticatedRequest;
    const start = req.query.start_date as string || new Date(Date.now() - 30 * 86400000).toISOString().split('T')[0];
    const end = req.query.end_date as string || new Date().toISOString().split('T')[0];
    const format = req.query.format as string || 'csv';
    const data = await exportService.getExportData(authReq.tenantId, req.params.type, start, end);
    if (format === 'json') { success(res, JSON.parse(exportService.exportToJson(data))); }
    else { res.setHeader('Content-Type', 'text/csv'); res.send(exportService.exportToCsv(data)); }
  } catch (err: any) { console.error('Failed', err?.message || err); error(res, 'Failed', 'INTERNAL_ERROR', 500); }
});


// --- Business KPIs (Owner/Manager view) ---
reportsRouter.get('/business-kpis', requirePermission('reports:read'), async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthenticatedRequest;
    const businessId = req.headers['x-business-id'] as string;
    const { adminPool } = await import('../db/pool');

    if (!businessId) {
      error(res, 'Business ID is required', 'MISSING_BUSINESS_ID', 400);
      return;
    }

    // Days, weeks and months are the business's own (its time zone), and cancelled bookings
    // are not counted. Revenue is the money taken: completed sales, plus payments recorded
    // outside a sale, less refunds. (Revenue was a fixed 0 and "today" was the server's day.)
    const { rows } = await adminPool.query(
      `WITH biz AS (SELECT id, timezone AS tz FROM sys_businesses WHERE id = $1),
            clock AS (SELECT (NOW() AT TIME ZONE tz)::date AS today,
                             date_trunc('week', NOW() AT TIME ZONE tz)::date AS week_start,
                             date_trunc('month', NOW() AT TIME ZONE tz)::date AS month_start,
                             date_trunc('year', NOW() AT TIME ZONE tz)::date AS year_start, tz FROM biz),
            money AS (
              SELECT (o.completed_at AT TIME ZONE clock.tz)::date AS day, o.total_amount AS amount
                FROM fin_orders o, clock WHERE o.business_id = $1 AND o.status IN ('completed', 'refunded')
              UNION ALL
              SELECT (t.created_at AT TIME ZONE clock.tz)::date,
                     CASE WHEN t.type = 'charge' THEN t.amount ELSE -ABS(t.amount) END
                FROM pay_transactions t, clock
               WHERE t.business_id = $1 AND t.status = 'completed' AND t.payment_method <> 'account_credit'
                 AND ((t.type = 'charge' AND t.order_id IS NULL) OR t.type = 'refund'))
       SELECT
         (SELECT COALESCE(SUM(amount), 0)::int FROM money, clock WHERE day >= clock.year_start) AS revenue_ytd,
         (SELECT COALESCE(SUM(amount), 0)::int FROM money, clock WHERE day >= clock.month_start) AS revenue_mtd,
         (SELECT COUNT(*)::int FROM apt_bookings b, clock WHERE b.business_id = $1 AND b.status <> 'cancelled'
             AND (b.start_time AT TIME ZONE clock.tz)::date = clock.today) AS todays_bookings,
         (SELECT COUNT(*)::int FROM apt_bookings b, clock WHERE b.business_id = $1 AND b.status <> 'cancelled'
             AND (b.start_time AT TIME ZONE clock.tz)::date >= clock.week_start
             AND (b.start_time AT TIME ZONE clock.tz)::date < clock.week_start + 7) AS week_bookings,
         (SELECT COUNT(*)::int FROM cus_customers c WHERE c.business_id = $1 AND c.status = 'active') AS active_customers,
         (SELECT COUNT(*)::int FROM cus_customers c, clock WHERE c.business_id = $1 AND c.status = 'active'
             AND (c.created_at AT TIME ZONE clock.tz)::date >= clock.month_start) AS new_customers_month`,
      [businessId],
    );
    success(res, rows[0]);
  } catch (err: any) {
    console.error('Failed to get business KPIs', err?.message || err);
    error(res, 'Failed to get business KPIs', 'INTERNAL_ERROR', 500);
  }
});

// --- Staff KPIs (Individual staff view) ---
reportsRouter.get('/staff-kpis', async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthenticatedRequest;
    const userId = authReq.user.sub;
    const { adminPool } = await import('../db/pool');

    // My bookings today
    const { rows: todayRows } = await adminPool.query(
      `SELECT COUNT(*) as count FROM apt_bookings WHERE staff_id = $1 AND DATE(start_time) = CURRENT_DATE`,
      [userId],
    );

    // My bookings this week
    const { rows: weekRows } = await adminPool.query(
      `SELECT COUNT(*) as count FROM apt_bookings WHERE staff_id = $1 AND start_time >= date_trunc('week', NOW()) AND start_time < date_trunc('week', NOW()) + INTERVAL '7 days'`,
      [userId],
    );

    // My customers (unique customers from my bookings)
    const { rows: custRows } = await adminPool.query(
      `SELECT COUNT(DISTINCT customer_id) as count FROM apt_bookings WHERE staff_id = $1`,
      [userId],
    );

    // Next appointment
    const { rows: nextRows } = await adminPool.query(
      `SELECT start_time FROM apt_bookings WHERE staff_id = $1 AND start_time > NOW() AND status != 'cancelled' ORDER BY start_time LIMIT 1`,
      [userId],
    );
    const nextAppt = nextRows.length > 0 ? new Date(nextRows[0].start_time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : null;

    success(res, {
      my_bookings_today: parseInt(todayRows[0].count),
      my_bookings_week: parseInt(weekRows[0].count),
      my_customers: parseInt(custRows[0].count),
      next_appointment: nextAppt,
    });
  } catch (err: any) {
    console.error('Failed to get staff KPIs', err?.message || err);
    error(res, 'Failed to get staff KPIs', 'INTERNAL_ERROR', 500);
  }
});
