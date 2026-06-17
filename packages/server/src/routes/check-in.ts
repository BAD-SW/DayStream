import { Router, Request, Response } from 'express';
import { authenticate, AuthenticatedRequest } from '../auth/middleware';
import { tenantContext } from '../auth/tenant-context';
import { requirePermission } from '../auth/permissions';
import { success, error } from '../utils/response';
import * as qrService from '../services/checkin-qr.service';
import * as checkinService from '../services/checkin.service';
import * as walkinService from '../services/checkin-walkin.service';
import * as noshowService from '../services/checkin-noshow.service';
import * as configService from '../services/checkin-config.service';
import * as kioskService from '../services/checkin-kiosk.service';
import * as dashboardService from '../services/checkin-dashboard.service';
import * as reportsService from '../services/checkin-reports.service';
import * as validationService from '../services/checkin-validation.service';

export const checkInRouter = Router();
checkInRouter.use(authenticate);
checkInRouter.use(tenantContext);

// ============================================================
// Check-In Methods
// ============================================================

checkInRouter.post('/qr', requirePermission('checkin:*'), async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthenticatedRequest;
    const result = await checkinService.checkInByQr(req.body.code, authReq.tenantId, authReq.user.sub, req.body.method || 'qr_staff');
    success(res, result);
  } catch (err: any) { error(res, err.message || 'Check-in failed', 'VALIDATION_ERROR', 400); }
});

checkInRouter.post('/reception', requirePermission('checkin:*'), async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthenticatedRequest;
    const result = await checkinService.checkInByBookingId(req.body.booking_id, authReq.tenantId, authReq.user.sub);
    success(res, result);
  } catch (err: any) { error(res, err.message || 'Check-in failed', 'VALIDATION_ERROR', 400); }
});

checkInRouter.post('/kiosk', async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthenticatedRequest;
    const result = await checkinService.checkInKiosk(
      { code: req.body.code, reference: req.body.reference, name: req.body.name, phone: req.body.phone },
      authReq.tenantId, req.body.location_id);
    success(res, result);
  } catch (err: any) { error(res, err.message || 'Check-in failed', 'VALIDATION_ERROR', 400); }
});

checkInRouter.post('/walk-in', requirePermission('checkin:*'), async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthenticatedRequest;
    const result = await walkinService.walkInCheckIn(authReq.tenantId, {
      customerId: req.body.customer_id, serviceId: req.body.service_id, locationId: req.body.location_id,
    });
    success(res, result, undefined, 201);
  } catch (err: any) { error(res, err.message || 'Walk-in failed', 'VALIDATION_ERROR', 400); }
});

// ============================================================
// Validation (dry run)
// ============================================================

checkInRouter.get('/validate/:bookingId', requirePermission('checkin:read'), async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthenticatedRequest;
    const { rows } = await (await import('../db/pool')).adminPool.query(
      `SELECT b.customer_id FROM bookings b JOIN businesses bus ON bus.id = b.business_id
       WHERE b.id = $1 AND bus.tenant_id = $2`, [req.params.bookingId, authReq.tenantId]);
    if (rows.length === 0) { error(res, 'Booking not found', 'NOT_FOUND', 404); return; }
    const result = await validationService.validateSession(req.params.bookingId, rows[0].customer_id, authReq.tenantId);
    success(res, result);
  } catch (err: any) { error(res, 'Validation failed', 'INTERNAL_ERROR', 500); }
});

// ============================================================
// QR Codes
// ============================================================

checkInRouter.get('/qr-code/booking/:bookingId', requirePermission('checkin:read'), async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthenticatedRequest;
    const qr = await qrService.getBookingQrCode(authReq.tenantId, req.params.bookingId);
    success(res, qr);
  } catch (err: any) { error(res, err.message || 'Failed', 'INTERNAL_ERROR', 500); }
});

checkInRouter.get('/qr-code/customer/:customerId', requirePermission('checkin:read'), async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthenticatedRequest;
    const qr = await qrService.getCustomerQrCode(authReq.tenantId, req.params.customerId);
    success(res, qr);
  } catch (err: any) { error(res, err.message || 'Failed', 'INTERNAL_ERROR', 500); }
});

checkInRouter.post('/qr-code/customer/:customerId/regenerate', requirePermission('checkin:*'), async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthenticatedRequest;
    const qr = await qrService.regenerateCustomerQrCode(authReq.tenantId, req.params.customerId);
    success(res, qr);
  } catch (err: any) { error(res, err.message || 'Failed', 'INTERNAL_ERROR', 500); }
});

// ============================================================
// Dashboard
// ============================================================

checkInRouter.get('/dashboard', requirePermission('checkin:read'), async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthenticatedRequest;
    const dashboard = await dashboardService.getDashboard(authReq.tenantId, req.query.location_id as string, {
      staffId: req.query.staff_id as string, serviceId: req.query.service_id as string,
    });
    success(res, dashboard);
  } catch (err: any) { error(res, 'Failed to get dashboard', 'INTERNAL_ERROR', 500); }
});

checkInRouter.get('/dashboard/upcoming', requirePermission('checkin:read'), async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthenticatedRequest;
    const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : 10;
    const upcoming = await dashboardService.getUpcoming(authReq.tenantId, limit);
    success(res, upcoming);
  } catch (err: any) { error(res, 'Failed to get upcoming', 'INTERNAL_ERROR', 500); }
});

// ============================================================
// No-Show Management
// ============================================================

checkInRouter.get('/no-shows', requirePermission('checkin:read'), async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthenticatedRequest;
    const records = await noshowService.getNoShows(authReq.tenantId, {
      startDate: req.query.start_date as string, endDate: req.query.end_date as string,
      customerId: req.query.customer_id as string,
    });
    success(res, records);
  } catch (err: any) { error(res, 'Failed to list no-shows', 'INTERNAL_ERROR', 500); }
});

checkInRouter.put('/no-shows/:id/waive', requirePermission('checkin:*'), async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthenticatedRequest;
    const record = await noshowService.waiveNoShow(req.params.id, authReq.tenantId, authReq.user.sub, req.body.reason);
    success(res, record);
  } catch (err: any) { error(res, err.message || 'Failed to waive', 'NOT_FOUND', 404); }
});

checkInRouter.get('/no-shows/customer/:customerId', requirePermission('checkin:read'), async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthenticatedRequest;
    const history = await noshowService.getCustomerNoShowHistory(req.params.customerId, authReq.tenantId);
    success(res, history);
  } catch (err: any) { error(res, 'Failed to get history', 'INTERNAL_ERROR', 500); }
});

// ============================================================
// Configuration
// ============================================================

checkInRouter.get('/config', requirePermission('checkin:read'), async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthenticatedRequest;
    const config = await configService.getConfig(authReq.tenantId);
    success(res, config);
  } catch (err: any) { error(res, 'Failed to get config', 'INTERNAL_ERROR', 500); }
});

checkInRouter.put('/config', requirePermission('checkin:*'), async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthenticatedRequest;
    const config = await configService.updateConfig(authReq.tenantId, req.body);
    success(res, config);
  } catch (err: any) { error(res, 'Failed to update config', 'INTERNAL_ERROR', 500); }
});

// ============================================================
// Kiosk
// ============================================================

checkInRouter.post('/kiosk/register', requirePermission('checkin:*'), async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthenticatedRequest;
    const kiosk = await kioskService.registerKiosk(authReq.tenantId, req.body.location_id, req.body.device_name);
    success(res, kiosk, undefined, 201);
  } catch (err: any) { error(res, 'Failed to register kiosk', 'INTERNAL_ERROR', 500); }
});

checkInRouter.get('/kiosk/status', async (req: Request, res: Response) => {
  try {
    const token = req.query.token as string;
    if (!token) { error(res, 'token required', 'VALIDATION_ERROR', 400); return; }
    const kiosk = await kioskService.getKioskStatus(token);
    if (!kiosk) { error(res, 'Kiosk not found or inactive', 'NOT_FOUND', 404); return; }
    success(res, kiosk);
  } catch (err: any) { error(res, 'Failed to get status', 'INTERNAL_ERROR', 500); }
});

// ============================================================
// Reports
// ============================================================

checkInRouter.get('/reports/attendance', requirePermission('checkin:read'), async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthenticatedRequest;
    const startDate = req.query.start_date as string || new Date(Date.now() - 30 * 86400000).toISOString();
    const endDate = req.query.end_date as string || new Date().toISOString();
    const data = await reportsService.getAttendanceRate(authReq.tenantId, startDate, endDate);
    success(res, data);
  } catch (err: any) { error(res, 'Failed', 'INTERNAL_ERROR', 500); }
});

checkInRouter.get('/reports/no-shows', requirePermission('checkin:read'), async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthenticatedRequest;
    const startDate = req.query.start_date as string || new Date(Date.now() - 30 * 86400000).toISOString();
    const endDate = req.query.end_date as string || new Date().toISOString();
    const data = await reportsService.getNoShowRate(authReq.tenantId, startDate, endDate);
    success(res, data);
  } catch (err: any) { error(res, 'Failed', 'INTERNAL_ERROR', 500); }
});

checkInRouter.get('/reports/walk-ins', requirePermission('checkin:read'), async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthenticatedRequest;
    const startDate = req.query.start_date as string || new Date(Date.now() - 30 * 86400000).toISOString();
    const endDate = req.query.end_date as string || new Date().toISOString();
    const data = await reportsService.getWalkInVolume(authReq.tenantId, startDate, endDate);
    success(res, data);
  } catch (err: any) { error(res, 'Failed', 'INTERNAL_ERROR', 500); }
});

checkInRouter.get('/reports/peak-times', requirePermission('checkin:read'), async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthenticatedRequest;
    const startDate = req.query.start_date as string || new Date(Date.now() - 30 * 86400000).toISOString();
    const endDate = req.query.end_date as string || new Date().toISOString();
    const data = await reportsService.getPeakTimes(authReq.tenantId, startDate, endDate);
    success(res, data);
  } catch (err: any) { error(res, 'Failed', 'INTERNAL_ERROR', 500); }
});

checkInRouter.get('/reports/methods', requirePermission('checkin:read'), async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthenticatedRequest;
    const startDate = req.query.start_date as string || new Date(Date.now() - 30 * 86400000).toISOString();
    const endDate = req.query.end_date as string || new Date().toISOString();
    const data = await reportsService.getMethodBreakdown(authReq.tenantId, startDate, endDate);
    success(res, data);
  } catch (err: any) { error(res, 'Failed', 'INTERNAL_ERROR', 500); }
});
