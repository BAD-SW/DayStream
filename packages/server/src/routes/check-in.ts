import { Router, Request, Response, NextFunction } from 'express';
import { authenticate, AuthenticatedRequest } from '../auth/middleware';
import { tenantContext } from '../auth/tenant-context';
import { requirePermission } from '../auth/permissions';
import { success, error } from '../utils/response';
import { adminPool } from '../db/pool';
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

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A refused check-in carries its reason; anything else is a failure and is not shown. */
function refuse(res: Response, err: any, fallback: string): void {
  if (err instanceof checkinService.CheckInRefused) { error(res, err.message, 'CHECK_IN_REFUSED', 400); return; }
  console.error(fallback, err?.message || err);
  error(res, fallback, 'INTERNAL_ERROR', 500);
}

// ============================================================
// Kiosk device (its own credential, no user session)
// ============================================================
// A registered kiosk identifies itself with the token it was given at registration, sent as
// the X-Kiosk-Token header (or ?token= for the status check). With a token these two routes
// answer without a login; without one they fall through to the signed-in routes below.

function kioskToken(req: Request): string {
  return String(req.headers['x-kiosk-token'] || req.query.token || '').trim();
}

async function kioskSession(token: string) {
  const kiosk = await kioskService.getKioskStatus(token);
  if (!kiosk) return null;
  const { rows } = await adminPool.query('SELECT business_id FROM sys_locations WHERE id = $1', [kiosk.location_id]);
  return { kiosk, businessId: rows[0]?.business_id as string | undefined };
}

checkInRouter.get('/kiosk/status', async (req: Request, res: Response, next: NextFunction) => {
  const token = kioskToken(req);
  if (!token) { next(); return; }
  try {
    const session = await kioskSession(token);
    if (!session) { error(res, 'Kiosk not registered or switched off', 'KIOSK_UNKNOWN', 401); return; }
    const { kiosk } = session;
    success(res, { id: kiosk.id, device_name: kiosk.device_name, location_id: kiosk.location_id, is_active: kiosk.is_active, last_activity_at: kiosk.last_activity_at });
  } catch (err: any) { console.error('Failed to get status', err?.message || err); error(res, 'Failed to get status', 'INTERNAL_ERROR', 500); }
});

checkInRouter.post('/kiosk', async (req: Request, res: Response, next: NextFunction) => {
  const token = kioskToken(req);
  if (!token) { next(); return; }
  try {
    const session = await kioskSession(token);
    if (!session || !session.businessId) { error(res, 'Kiosk not registered or switched off', 'KIOSK_UNKNOWN', 401); return; }
    const result = await checkinService.checkInKiosk(
      { code: req.body.code, reference: req.body.reference, name: req.body.name, phone: req.body.phone },
      session.kiosk.tenant_id, session.kiosk.location_id, session.businessId);
    // The kiosk shows a greeting and what the visit is: no contact details, no ids of the person.
    const { rows } = await adminPool.query(
      `SELECT b.booking_reference, b.start_time, s.name AS service_name, c.first_name
         FROM apt_bookings b JOIN svc_services s ON s.id = b.service_id LEFT JOIN cus_customers c ON c.id = b.customer_id
        WHERE b.id = $1`, [result.booking_id]);
    success(res, { checked_in: true, ...(rows[0] || {}), warnings: result.validation.warnings });
  } catch (err: any) { refuse(res, err, 'Check-in failed'); }
});

checkInRouter.use(authenticate);
checkInRouter.use(tenantContext);

// ============================================================
// Business scope
// ============================================================
// Check-in belongs to one business: the one named in business_id (the app sends the active
// business; tenantContext has already verified the caller may use it) or, failing that, the
// caller's own. It used to cover every business of the tenant at once.

checkInRouter.use(async (req: Request, res: Response, next: NextFunction) => {
  try {
    const authReq = req as AuthenticatedRequest;
    let businessId = (req.query.business_id || req.body?.business_id) as string | undefined;
    if (!businessId) {
      const { rows } = await adminPool.query('SELECT business_id FROM usr_users WHERE id = $1', [authReq.user.sub]);
      businessId = rows[0]?.business_id || undefined;
    }
    if (!businessId || !UUID_RE.test(businessId)) {
      error(res, 'Choose a business first: check-in belongs to a business', 'BUSINESS_REQUIRED', 400);
      return;
    }
    const { rows: own } = await adminPool.query('SELECT 1 FROM sys_businesses WHERE id = $1 AND tenant_id = $2', [businessId, authReq.tenantId]);
    if (own.length === 0) { error(res, 'You do not have access to this business', 'FORBIDDEN', 403); return; }
    (req as any).checkInBusinessId = businessId;
    next();
  } catch (err: any) { console.error('Check-in scope failed', err?.message || err); error(res, 'Failed', 'INTERNAL_ERROR', 500); }
});

const bizOf = (req: Request): string => (req as any).checkInBusinessId as string;

async function bookingInBusiness(bookingId: string, businessId: string): Promise<{ customer_id: string | null } | null> {
  if (!UUID_RE.test(bookingId || '')) return null;
  const { rows } = await adminPool.query('SELECT customer_id FROM apt_bookings WHERE id = $1 AND business_id = $2', [bookingId, businessId]);
  return rows[0] || null;
}

async function customerInBusiness(customerId: string, businessId: string): Promise<boolean> {
  if (!UUID_RE.test(customerId || '')) return false;
  const { rows } = await adminPool.query('SELECT 1 FROM cus_customers WHERE id = $1 AND business_id = $2', [customerId, businessId]);
  return rows.length > 0;
}

/** Report period: the last 30 days unless given. */
function period(req: Request): [string, string] {
  return [
    (req.query.start_date as string) || new Date(Date.now() - 30 * 86400000).toISOString(),
    (req.query.end_date as string) || new Date().toISOString(),
  ];
}

// ============================================================
// Check-In Methods
// ============================================================

checkInRouter.post('/qr', requirePermission('checkin:*'), async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthenticatedRequest;
    const method = req.body.method === 'qr_self' ? 'qr_self' : 'qr_staff';
    const result = await checkinService.checkInByQr(req.body.code, authReq.tenantId, authReq.user.sub, method, bizOf(req));
    success(res, result);
  } catch (err: any) { refuse(res, err, 'Check-in failed'); }
});

checkInRouter.post('/reception', requirePermission('checkin:*'), async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthenticatedRequest;
    const result = await checkinService.checkInByBookingId(req.body.booking_id, authReq.tenantId, authReq.user.sub, bizOf(req));
    success(res, result);
  } catch (err: any) { refuse(res, err, 'Check-in failed'); }
});

// A kiosk screen used by a signed-in member of staff (a registered device uses its token, above).
checkInRouter.post('/kiosk', requirePermission('checkin:*'), async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthenticatedRequest;
    const result = await checkinService.checkInKiosk(
      { code: req.body.code, reference: req.body.reference, name: req.body.name, phone: req.body.phone },
      authReq.tenantId, req.body.location_id, bizOf(req));
    success(res, result);
  } catch (err: any) { refuse(res, err, 'Check-in failed'); }
});

checkInRouter.post('/walk-in', requirePermission('checkin:*'), async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthenticatedRequest;
    if (!UUID_RE.test(req.body.customer_id || '') || !UUID_RE.test(req.body.service_id || '')) {
      error(res, 'customer_id and service_id are required', 'VALIDATION_ERROR', 400); return;
    }
    const result = await walkinService.walkInCheckIn(authReq.tenantId, {
      businessId: bizOf(req), customerId: req.body.customer_id, serviceId: req.body.service_id,
      locationId: req.body.location_id || undefined, variantId: req.body.variant_id || undefined,
      staffId: req.body.staff_id || undefined, userId: authReq.user.sub,
    });
    success(res, result, undefined, 201);
  } catch (err: any) { refuse(res, err, 'Walk-in failed'); }
});

// ============================================================
// Validation (dry run)
// ============================================================

checkInRouter.get('/validate/:bookingId', requirePermission('checkin:read'), async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthenticatedRequest;
    const booking = await bookingInBusiness(req.params.bookingId, bizOf(req));
    if (!booking) { error(res, 'Booking not found', 'NOT_FOUND', 404); return; }
    const result = await validationService.validateSession(req.params.bookingId, booking.customer_id as string, authReq.tenantId);
    success(res, result);
  } catch (err: any) { console.error('Validation failed', err?.message || err); error(res, 'Validation failed', 'INTERNAL_ERROR', 500); }
});

// ============================================================
// QR Codes
// ============================================================

checkInRouter.get('/qr-code/booking/:bookingId', requirePermission('checkin:read'), async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthenticatedRequest;
    if (!(await bookingInBusiness(req.params.bookingId, bizOf(req)))) { error(res, 'Booking not found', 'NOT_FOUND', 404); return; }
    const qr = await qrService.getBookingQrCode(authReq.tenantId, req.params.bookingId);
    success(res, qr);
  } catch (err: any) { console.error('Failed to get QR code', err?.message || err); error(res, 'Failed to get QR code', 'INTERNAL_ERROR', 500); }
});

checkInRouter.get('/qr-code/customer/:customerId', requirePermission('checkin:read'), async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthenticatedRequest;
    if (!(await customerInBusiness(req.params.customerId, bizOf(req)))) { error(res, 'Customer not found', 'NOT_FOUND', 404); return; }
    const qr = await qrService.getCustomerQrCode(authReq.tenantId, req.params.customerId);
    success(res, qr);
  } catch (err: any) { console.error('Failed to get QR code', err?.message || err); error(res, 'Failed to get QR code', 'INTERNAL_ERROR', 500); }
});

checkInRouter.post('/qr-code/customer/:customerId/regenerate', requirePermission('checkin:*'), async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthenticatedRequest;
    if (!(await customerInBusiness(req.params.customerId, bizOf(req)))) { error(res, 'Customer not found', 'NOT_FOUND', 404); return; }
    const qr = await qrService.regenerateCustomerQrCode(authReq.tenantId, req.params.customerId);
    success(res, qr);
  } catch (err: any) { console.error('Failed to regenerate QR code', err?.message || err); error(res, 'Failed to regenerate QR code', 'INTERNAL_ERROR', 500); }
});

// ============================================================
// Dashboard
// ============================================================

checkInRouter.get('/dashboard', requirePermission('checkin:read'), async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthenticatedRequest;
    const dashboard = await dashboardService.getDashboard(authReq.tenantId, req.query.location_id as string, {
      staffId: req.query.staff_id as string, serviceId: req.query.service_id as string,
    }, bizOf(req));
    success(res, dashboard);
  } catch (err: any) { console.error('Failed to get dashboard', err?.message || err); error(res, 'Failed to get dashboard', 'INTERNAL_ERROR', 500); }
});

checkInRouter.get('/dashboard/upcoming', requirePermission('checkin:read'), async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthenticatedRequest;
    const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : 10;
    const upcoming = await dashboardService.getUpcoming(authReq.tenantId, limit, bizOf(req));
    success(res, upcoming);
  } catch (err: any) { console.error('Failed to get upcoming', err?.message || err); error(res, 'Failed to get upcoming', 'INTERNAL_ERROR', 500); }
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
    }, bizOf(req));
    success(res, records);
  } catch (err: any) { console.error('Failed to list no-shows', err?.message || err); error(res, 'Failed to list no-shows', 'INTERNAL_ERROR', 500); }
});

checkInRouter.put('/no-shows/:id/waive', requirePermission('checkin:*'), async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthenticatedRequest;
    if (!UUID_RE.test(req.params.id)) { error(res, 'No-show record not found', 'NOT_FOUND', 404); return; }
    const record = await noshowService.waiveNoShow(req.params.id, authReq.tenantId, authReq.user.sub, req.body.reason, bizOf(req));
    success(res, record);
  } catch (err: any) {
    if (err?.message === 'No-show record not found') { error(res, err.message, 'NOT_FOUND', 404); return; }
    console.error('Failed to waive', err?.message || err); error(res, 'Failed to waive', 'INTERNAL_ERROR', 500);
  }
});

checkInRouter.get('/no-shows/customer/:customerId', requirePermission('checkin:read'), async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthenticatedRequest;
    if (!(await customerInBusiness(req.params.customerId, bizOf(req)))) { error(res, 'Customer not found', 'NOT_FOUND', 404); return; }
    const history = await noshowService.getCustomerNoShowHistory(req.params.customerId, authReq.tenantId, bizOf(req));
    success(res, history);
  } catch (err: any) { console.error('Failed to get history', err?.message || err); error(res, 'Failed to get history', 'INTERNAL_ERROR', 500); }
});

// ============================================================
// Configuration
// ============================================================

checkInRouter.get('/config', requirePermission('checkin:read'), async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthenticatedRequest;
    const config = await configService.getConfig(authReq.tenantId);
    success(res, config);
  } catch (err: any) { console.error('Failed to get config', err?.message || err); error(res, 'Failed to get config', 'INTERNAL_ERROR', 500); }
});

checkInRouter.put('/config', requirePermission('checkin:*'), async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthenticatedRequest;
    const config = await configService.updateConfig(authReq.tenantId, req.body);
    success(res, config);
  } catch (err: any) { console.error('Failed to update config', err?.message || err); error(res, 'Failed to update config', 'INTERNAL_ERROR', 500); }
});

// ============================================================
// Kiosk
// ============================================================

checkInRouter.post('/kiosk/register', requirePermission('checkin:*'), async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthenticatedRequest;
    const locationId = req.body.location_id as string;
    const { rows } = UUID_RE.test(locationId || '')
      ? await adminPool.query('SELECT 1 FROM sys_locations WHERE id = $1 AND business_id = $2', [locationId, bizOf(req)])
      : { rows: [] };
    if (rows.length === 0) { error(res, 'Choose a location of this business', 'VALIDATION_ERROR', 400); return; }
    const kiosk = await kioskService.registerKiosk(authReq.tenantId, locationId, String(req.body.device_name || 'Kiosk').slice(0, 100));
    success(res, kiosk, undefined, 201);
  } catch (err: any) { console.error('Failed to register kiosk', err?.message || err); error(res, 'Failed to register kiosk', 'INTERNAL_ERROR', 500); }
});

// Reached only without a kiosk token (see the top of this file).
checkInRouter.get('/kiosk/status', async (_req: Request, res: Response) => {
  error(res, 'token required', 'VALIDATION_ERROR', 400);
});

// ============================================================
// Reports
// ============================================================

checkInRouter.get('/reports/attendance', requirePermission('checkin:read'), async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthenticatedRequest;
    success(res, await reportsService.getAttendanceRate(authReq.tenantId, ...period(req), bizOf(req)));
  } catch (err: any) { console.error('Failed', err?.message || err); error(res, 'Failed', 'INTERNAL_ERROR', 500); }
});

checkInRouter.get('/reports/no-shows', requirePermission('checkin:read'), async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthenticatedRequest;
    success(res, await reportsService.getNoShowRate(authReq.tenantId, ...period(req), bizOf(req)));
  } catch (err: any) { console.error('Failed', err?.message || err); error(res, 'Failed', 'INTERNAL_ERROR', 500); }
});

checkInRouter.get('/reports/walk-ins', requirePermission('checkin:read'), async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthenticatedRequest;
    success(res, await reportsService.getWalkInVolume(authReq.tenantId, ...period(req), bizOf(req)));
  } catch (err: any) { console.error('Failed', err?.message || err); error(res, 'Failed', 'INTERNAL_ERROR', 500); }
});

checkInRouter.get('/reports/peak-times', requirePermission('checkin:read'), async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthenticatedRequest;
    success(res, await reportsService.getPeakTimes(authReq.tenantId, ...period(req), bizOf(req)));
  } catch (err: any) { console.error('Failed', err?.message || err); error(res, 'Failed', 'INTERNAL_ERROR', 500); }
});

checkInRouter.get('/reports/methods', requirePermission('checkin:read'), async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthenticatedRequest;
    success(res, await reportsService.getMethodBreakdown(authReq.tenantId, ...period(req), bizOf(req)));
  } catch (err: any) { console.error('Failed', err?.message || err); error(res, 'Failed', 'INTERNAL_ERROR', 500); }
});
