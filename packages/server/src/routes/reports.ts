import { Router, Request, Response } from 'express';
import { authenticate, AuthenticatedRequest } from '../auth/middleware';
import { tenantContext } from '../auth/tenant-context';
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

export const reportsRouter = Router();
reportsRouter.use(authenticate);
reportsRouter.use(tenantContext);

// --- Dashboard ---
reportsRouter.get('/dashboard', requirePermission('reports:read'), async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthenticatedRequest;
    const start = req.query.start_date as string || new Date(Date.now() - 30 * 86400000).toISOString().split('T')[0];
    const end = req.query.end_date as string || new Date().toISOString().split('T')[0];
    const data = await dashboardService.getDashboardData(authReq.tenantId, authReq.user.sub, { start, end });
    success(res, data);
  } catch (err: any) { error(res, 'Failed', 'INTERNAL_ERROR', 500); }
});

reportsRouter.get('/dashboard/config', requirePermission('reports:read'), async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthenticatedRequest;
    const config = await dashboardService.getDashboardConfig(authReq.tenantId, authReq.user.sub);
    success(res, config || { widgets: dashboardService.getDefaultWidgets('owner') });
  } catch (err: any) { error(res, 'Failed', 'INTERNAL_ERROR', 500); }
});

reportsRouter.put('/dashboard/config', requirePermission('reports:read'), async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthenticatedRequest;
    const config = await dashboardService.saveDashboardConfig(authReq.tenantId, authReq.user.sub, req.body.widgets || []);
    success(res, config);
  } catch (err: any) { error(res, 'Failed', 'INTERNAL_ERROR', 500); }
});

// --- Domain Reports ---
reportsRouter.get('/revenue', requirePermission('reports:read'), async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthenticatedRequest;
    const start = req.query.start_date as string || new Date(Date.now() - 30 * 86400000).toISOString().split('T')[0];
    const end = req.query.end_date as string || new Date().toISOString().split('T')[0];
    const data = await revenueService.getRevenueReport(authReq.tenantId, start, end);
    success(res, data);
  } catch (err: any) { error(res, 'Failed', 'INTERNAL_ERROR', 500); }
});

reportsRouter.get('/bookings', requirePermission('reports:read'), async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthenticatedRequest;
    const start = req.query.start_date as string || new Date(Date.now() - 30 * 86400000).toISOString().split('T')[0];
    const end = req.query.end_date as string || new Date().toISOString().split('T')[0];
    const data = await bookingsService.getBookingsReport(authReq.tenantId, start, end);
    success(res, data);
  } catch (err: any) { error(res, 'Failed', 'INTERNAL_ERROR', 500); }
});

reportsRouter.get('/memberships', requirePermission('reports:read'), async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthenticatedRequest;
    const start = req.query.start_date as string || new Date(Date.now() - 30 * 86400000).toISOString().split('T')[0];
    const end = req.query.end_date as string || new Date().toISOString().split('T')[0];
    const data = await membershipsService.getMembershipsReport(authReq.tenantId, start, end);
    success(res, data);
  } catch (err: any) { error(res, 'Failed', 'INTERNAL_ERROR', 500); }
});

reportsRouter.get('/staff', requirePermission('reports:read'), async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthenticatedRequest;
    const start = req.query.start_date as string || new Date(Date.now() - 30 * 86400000).toISOString().split('T')[0];
    const end = req.query.end_date as string || new Date().toISOString().split('T')[0];
    const data = await staffService.getStaffReport(authReq.tenantId, start, end);
    success(res, data);
  } catch (err: any) { error(res, 'Failed', 'INTERNAL_ERROR', 500); }
});

reportsRouter.get('/customers', requirePermission('reports:read'), async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthenticatedRequest;
    const start = req.query.start_date as string || new Date(Date.now() - 30 * 86400000).toISOString().split('T')[0];
    const end = req.query.end_date as string || new Date().toISOString().split('T')[0];
    const data = await customersService.getCustomersReport(authReq.tenantId, start, end);
    success(res, data);
  } catch (err: any) { error(res, 'Failed', 'INTERNAL_ERROR', 500); }
});

reportsRouter.get('/financial', requirePermission('reports:read'), async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthenticatedRequest;
    const start = req.query.start_date as string || new Date(Date.now() - 30 * 86400000).toISOString().split('T')[0];
    const end = req.query.end_date as string || new Date().toISOString().split('T')[0];
    const data = await financialService.getFinancialReport(authReq.tenantId, start, end);
    success(res, data);
  } catch (err: any) { error(res, 'Failed', 'INTERNAL_ERROR', 500); }
});

// --- Aggregation ---
reportsRouter.post('/aggregate', requirePermission('reports:*'), async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthenticatedRequest;
    const date = req.body.date || new Date(Date.now() - 86400000).toISOString().split('T')[0];
    await aggregationService.runDailyAggregation(authReq.tenantId, date);
    success(res, { aggregated: true, date });
  } catch (err: any) { error(res, 'Failed', 'INTERNAL_ERROR', 500); }
});

// --- Scheduled Reports ---
reportsRouter.get('/scheduled', requirePermission('reports:read'), async (req: Request, res: Response) => {
  try { const authReq = req as AuthenticatedRequest; const data = await schedulingService.getScheduledReports(authReq.tenantId); success(res, data); }
  catch (err: any) { error(res, 'Failed', 'INTERNAL_ERROR', 500); }
});
reportsRouter.post('/scheduled', requirePermission('reports:*'), async (req: Request, res: Response) => {
  try { const authReq = req as AuthenticatedRequest; const r = await schedulingService.createScheduledReport(authReq.tenantId, { ...req.body, created_by: authReq.user.sub }); success(res, r, undefined, 201); }
  catch (err: any) { error(res, 'Failed', 'INTERNAL_ERROR', 500); }
});
reportsRouter.put('/scheduled/:id', requirePermission('reports:*'), async (req: Request, res: Response) => {
  try { const authReq = req as AuthenticatedRequest; const r = await schedulingService.updateScheduledReport(req.params.id, authReq.tenantId, req.body); if (!r) { error(res, 'Not found', 'NOT_FOUND', 404); return; } success(res, r); }
  catch (err: any) { error(res, 'Failed', 'INTERNAL_ERROR', 500); }
});
reportsRouter.delete('/scheduled/:id', requirePermission('reports:*'), async (req: Request, res: Response) => {
  try { const authReq = req as AuthenticatedRequest; const d = await schedulingService.deleteScheduledReport(req.params.id, authReq.tenantId); if (!d) { error(res, 'Not found', 'NOT_FOUND', 404); return; } success(res, { deleted: true }); }
  catch (err: any) { error(res, 'Failed', 'INTERNAL_ERROR', 500); }
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
  } catch (err: any) { error(res, 'Failed', 'INTERNAL_ERROR', 500); }
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

    // Today's bookings
    const { rows: todayRows } = await adminPool.query(
      `SELECT COUNT(*) as count FROM apt_bookings WHERE business_id = $1 AND DATE(start_time) = CURRENT_DATE`,
      [businessId],
    );

    // This week's bookings
    const { rows: weekRows } = await adminPool.query(
      `SELECT COUNT(*) as count FROM apt_bookings WHERE business_id = $1 AND start_time >= date_trunc('week', NOW()) AND start_time < date_trunc('week', NOW()) + INTERVAL '7 days'`,
      [businessId],
    );

    // Active customers (from customers table, scoped to business — all non-archived)
    const { rows: custRows } = await adminPool.query(
      `SELECT COUNT(*) as count FROM cus_customers WHERE business_id = $1 AND status != 'archived' AND status != 'anonymized'`,
      [businessId],
    );

    // New customers this month
    const { rows: newCustRows } = await adminPool.query(
      `SELECT COUNT(*) as count FROM cus_customers WHERE business_id = $1 AND status != 'archived' AND status != 'anonymized' AND created_at >= date_trunc('month', NOW())`,
      [businessId],
    );

    // Revenue MTD/YTD - placeholder until payment ledger exists
    success(res, {
      revenue_ytd: 0,
      revenue_mtd: 0,
      todays_bookings: parseInt(todayRows[0].count),
      week_bookings: parseInt(weekRows[0].count),
      active_customers: parseInt(custRows[0].count),
      new_customers_month: parseInt(newCustRows[0].count),
    });
  } catch (err: any) {
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
    error(res, 'Failed to get staff KPIs', 'INTERNAL_ERROR', 500);
  }
});
