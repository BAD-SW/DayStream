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
