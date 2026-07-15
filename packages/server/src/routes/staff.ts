import { Router, Request, Response } from 'express';
import Joi from 'joi';
import multer from 'multer';
import { authenticate, AuthenticatedRequest } from '../auth/middleware';
import { tenantContext } from '../auth/tenant-context';
import { requirePermission, requireAnyPermission } from '../auth/permissions';
import { validate } from '../middleware/validate';
import { success, error } from '../utils/response';
import * as staffService from '../services/staff.service';
import * as qualService from '../services/staff-qualifications.service';
import * as availService from '../services/staff-availability.service';
import * as leaveService from '../services/staff-leave.service';
import * as assignService from '../services/staff-assignments.service';
import * as capacityService from '../services/staff-capacity.service';
import * as calendarService from '../services/staff-calendar.service';
import * as notifService from '../services/staff-notifications.service';
import { storage } from '../services/storage.service';

export const staffRouter = Router();

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });

// ============================================================
// Public Directory (no auth required)
// ============================================================

staffRouter.get('/directory', async (req: Request, res: Response) => {
  try {
    const tenantId = req.query.tenant_id as string;
    if (!tenantId) { error(res, 'tenant_id required', 'VALIDATION_ERROR', 400); return; }

    const locationId = req.query.location_id as string;
    const serviceId = req.query.service_id as string;

    let query = `
      SELECT sp.id, sp.first_name, sp.last_name, sp.bio, sp.profile_photo_path, sp.languages
      FROM stf_profiles sp
      WHERE sp.tenant_id = $1 AND sp.status = 'active' AND sp.show_on_directory = true
    `;
    const params: any[] = [tenantId];
    let idx = 2;

    if (locationId) {
      query += ` AND sp.id IN (SELECT staff_id FROM stf_location_assignments WHERE location_id = $${idx++})`;
      params.push(locationId);
    }
    if (serviceId) {
      query += ` AND sp.id IN (SELECT staff_id FROM stf_service_assignments WHERE service_id = $${idx++})`;
      params.push(serviceId);
    }
    query += ` ORDER BY sp.last_name, sp.first_name`;

    const { rows: staff } = await (await import('../db/pool')).adminPool.query(query, params);

    // Load qualifications for display
    for (const s of staff) {
      const { rows: quals } = await (await import('../db/pool')).adminPool.query(
        `SELECT name, issuing_body FROM stf_qualifications WHERE staff_id = $1 AND show_on_directory = true`,
        [s.id],
      );
      (s as any).qualifications = quals;
    }

    success(res, staff);
  } catch (err: any) {
    error(res, 'Failed to load directory', 'INTERNAL_ERROR', 500);
  }
});

// ============================================================
// Authenticated routes
// ============================================================

staffRouter.use(authenticate);
staffRouter.use(tenantContext);

// ============================================================
// Self-Service Portal (/me routes — before /:id to avoid conflict)
// ============================================================

staffRouter.get('/me', async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthenticatedRequest;
    const staff = await staffService.getStaffByUserId(authReq.user.sub, authReq.tenantId);
    if (!staff) { error(res, 'No staff profile linked to this user', 'NOT_FOUND', 404); return; }
    success(res, staff);
  } catch (err: any) {
    error(res, 'Failed to get profile', 'INTERNAL_ERROR', 500);
  }
});

staffRouter.put('/me', async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthenticatedRequest;
    const staff = await staffService.getStaffByUserId(authReq.user.sub, authReq.tenantId);
    if (!staff) { error(res, 'No staff profile linked', 'NOT_FOUND', 404); return; }

    // Self-service can only update bio, profile_photo_path, mobile_phone, languages
    const allowed: Record<string, any> = {};
    if (req.body.bio !== undefined) allowed.bio = req.body.bio;
    if (req.body.mobile_phone !== undefined) allowed.mobile_phone = req.body.mobile_phone;
    if (req.body.languages !== undefined) allowed.languages = req.body.languages;

    const updated = await staffService.updateStaff(staff.id, authReq.tenantId, allowed, authReq.user.sub);
    success(res, updated);
  } catch (err: any) {
    error(res, 'Failed to update profile', 'INTERNAL_ERROR', 500);
  }
});

staffRouter.get('/me/calendar', async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthenticatedRequest;
    const staff = await staffService.getStaffByUserId(authReq.user.sub, authReq.tenantId);
    if (!staff) { error(res, 'No staff profile linked', 'NOT_FOUND', 404); return; }

    const startDate = req.query.start_date as string || new Date().toISOString().split('T')[0];
    const endDate = req.query.end_date as string || startDate;
    const calendar = await calendarService.getStaffCalendar(staff.id, startDate, endDate);
    success(res, calendar);
  } catch (err: any) {
    error(res, 'Failed to get calendar', 'INTERNAL_ERROR', 500);
  }
});

staffRouter.get('/me/metrics', async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthenticatedRequest;
    const staff = await staffService.getStaffByUserId(authReq.user.sub, authReq.tenantId);
    if (!staff) { error(res, 'No staff profile linked', 'NOT_FOUND', 404); return; }

    const startDate = req.query.start_date as string || new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().split('T')[0];
    const endDate = req.query.end_date as string || new Date().toISOString().split('T')[0];
    const metrics = await calendarService.getStaffMetrics(staff.id, startDate, endDate);
    success(res, metrics);
  } catch (err: any) {
    error(res, 'Failed to get metrics', 'INTERNAL_ERROR', 500);
  }
});

staffRouter.get('/me/notifications/preferences', async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthenticatedRequest;
    const userId = authReq.user.sub;

    const staff = await staffService.getStaffByUserId(userId, authReq.tenantId);
    if (!staff) {
      // User has no staff profile — return defaults (all off)
      const allEvents = ['booking_confirmed', 'booking_cancelled', 'booking_reminder', 'schedule_changed', 'leave_approved', 'leave_rejected', 'new_review', 'payroll_ready'];
      const prefs: Record<string, boolean> = {};
      for (const event of allEvents) prefs[event] = false;
      success(res, prefs);
      return;
    }

    const rows = await notifService.getNotificationPreferences(staff.id);

    // Transform to flat boolean format for the frontend
    const allEvents = ['booking_confirmed', 'booking_cancelled', 'booking_reminder', 'schedule_changed', 'leave_approved', 'leave_rejected', 'new_review', 'payroll_ready'];
    const prefs: Record<string, boolean> = {};
    for (const event of allEvents) {
      const row = rows.find((r: any) => r.event_type === event);
      prefs[event] = row ? (row.channel_email || row.channel_in_app) : false;
    }

    success(res, prefs);
  } catch (err: any) {
    error(res, 'Failed to get preferences', 'INTERNAL_ERROR', 500);
  }
});

staffRouter.put('/me/notifications/preferences', async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthenticatedRequest;
    const userId = authReq.user.sub;

    const staff = await staffService.getStaffByUserId(userId, authReq.tenantId);
    if (!staff) {
      // Can't save preferences without a staff profile
      error(res, 'No staff profile linked to this user. Contact your administrator.', 'NOT_FOUND', 404);
      return;
    }

    // Accept flat boolean format from frontend: { booking_confirmed: true, ... }
    const updates = req.body;
    const preferences = Object.entries(updates)
      .filter(([_, value]) => typeof value === 'boolean')
      .map(([key, value]) => ({
        eventType: key,
        channelEmail: value as boolean,
        channelInApp: value as boolean,
        channelSms: false,
      }));

    await notifService.setNotificationPreferences(staff.id, preferences);

    // Return updated full preferences
    const rows = await notifService.getNotificationPreferences(staff.id);
    const allEvents = ['booking_confirmed', 'booking_cancelled', 'booking_reminder', 'schedule_changed', 'leave_approved', 'leave_rejected', 'new_review', 'payroll_ready'];
    const prefs: Record<string, boolean> = {};
    for (const event of allEvents) {
      const row = rows.find((r: any) => r.event_type === event);
      prefs[event] = row ? (row.channel_email || row.channel_in_app) : false;
    }

    success(res, prefs);
  } catch (err: any) {
    error(res, 'Failed to update preferences', 'INTERNAL_ERROR', 500);
  }
});

// ============================================================
// Expiring Qualifications (before /:id)
// ============================================================

staffRouter.get('/qualifications/expiring', requirePermission('staff:read'), async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthenticatedRequest;
    const days = parseInt(req.query.days as string, 10) || 30;
    const expiring = await qualService.getExpiringQualifications(authReq.tenantId, days);
    success(res, expiring);
  } catch (err: any) {
    error(res, 'Failed to get expiring qualifications', 'INTERNAL_ERROR', 500);
  }
});

// ============================================================
// Leave Management (before /:id)
// ============================================================

staffRouter.get('/leave', requirePermission('staff:read'), async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthenticatedRequest;
    const result = await leaveService.getLeaveRequests(authReq.tenantId, {
      staffId: req.query.staff_id as string,
      status: req.query.status as string,
      startDate: req.query.start_date as string,
      endDate: req.query.end_date as string,
      page: req.query.page ? parseInt(req.query.page as string, 10) : 1,
      limit: req.query.limit ? parseInt(req.query.limit as string, 10) : 20,
    });
    success(res, result.requests, { page: result.page, limit: result.limit, total: result.total });
  } catch (err: any) {
    error(res, 'Failed to list leave requests', 'INTERNAL_ERROR', 500);
  }
});

staffRouter.put('/leave/:lid/approve', requirePermission('staff:*'), async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthenticatedRequest;
    const result = await leaveService.approveLeave(req.params.lid, authReq.tenantId, authReq.user.sub);
    if (!result) { error(res, 'Leave request not found or not pending', 'NOT_FOUND', 404); return; }
    success(res, result);
  } catch (err: any) {
    error(res, 'Failed to approve leave', 'INTERNAL_ERROR', 500);
  }
});

staffRouter.put('/leave/:lid/reject', requirePermission('staff:*'), async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthenticatedRequest;
    const result = await leaveService.rejectLeave(req.params.lid, authReq.tenantId, authReq.user.sub);
    if (!result) { error(res, 'Leave request not found or not pending', 'NOT_FOUND', 404); return; }
    success(res, result);
  } catch (err: any) {
    error(res, 'Failed to reject leave', 'INTERNAL_ERROR', 500);
  }
});

staffRouter.put('/leave/:lid/cancel', async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthenticatedRequest;
    const result = await leaveService.cancelLeave(req.params.lid, authReq.tenantId, authReq.user.sub);
    if (!result) { error(res, 'Leave request not found', 'NOT_FOUND', 404); return; }
    success(res, result);
  } catch (err: any) {
    error(res, 'Failed to cancel leave', 'INTERNAL_ERROR', 500);
  }
});

// ============================================================
// Team Calendar (before /:id)
// ============================================================

staffRouter.get('/calendar/team', requirePermission('staff:read'), async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthenticatedRequest;
    const startDate = req.query.start_date as string;
    const endDate = req.query.end_date as string;
    if (!startDate || !endDate) { error(res, 'start_date and end_date required', 'VALIDATION_ERROR', 400); return; }

    const data = await calendarService.getTeamCalendar(authReq.tenantId, startDate, endDate, {
      locationId: req.query.location_id as string,
      serviceId: req.query.service_id as string,
    });
    success(res, data);
  } catch (err: any) {
    error(res, 'Failed to get team calendar', 'INTERNAL_ERROR', 500);
  }
});

// ============================================================
// Staff CRUD
// ============================================================

const createStaffSchema = Joi.object({
  first_name: Joi.string().min(1).max(100).required(),
  last_name: Joi.string().min(1).max(100).required(),
  email: Joi.string().email({ tlds: false }).required(),
  password: Joi.string().min(8).max(128).required(),
  mobile_phone: Joi.string().max(50).allow('', null),
  date_of_birth: Joi.string().isoDate().allow(null),
  hire_date: Joi.string().isoDate().allow(null),
  employment_type: Joi.string().valid('full_time', 'part_time', 'contractor').default('full_time'),
  role: Joi.string().valid('business_owner', 'business_manager', 'business_staff').default('business_staff'),
  bio: Joi.string().max(2000).allow('', null),
  languages: Joi.string().max(200).allow('', null),
  show_on_directory: Joi.boolean().default(true),
  primary_location_id: Joi.string().uuid().allow(null),
  user_id: Joi.string().uuid().allow(null),
  business_id: Joi.string().uuid().allow(null),
});

const updateStaffSchema = Joi.object({
  first_name: Joi.string().min(1).max(100),
  last_name: Joi.string().min(1).max(100),
  email: Joi.string().email({ tlds: false }).allow('', null),
  mobile_phone: Joi.string().max(50).allow('', null),
  date_of_birth: Joi.string().isoDate().allow(null),
  hire_date: Joi.string().isoDate().allow(null),
  employment_type: Joi.string().valid('full_time', 'part_time', 'contractor'),
  bio: Joi.string().max(2000).allow('', null),
  languages: Joi.string().max(200).allow('', null),
  show_on_directory: Joi.boolean(),
  primary_location_id: Joi.string().uuid().allow(null),
  user_id: Joi.string().uuid().allow(null),
}).min(1);

// GET /api/v1/staff — List staff
staffRouter.get('/', requirePermission('staff:read'), async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthenticatedRequest;
    const result = await staffService.getStaffList(authReq.tenantId, {
      status: req.query.status as string,
      employmentType: req.query.employment_type as string,
      locationId: req.query.location_id as string,
      serviceId: req.query.service_id as string,
      businessId: req.query.business_id as string,
      search: req.query.search as string,
      page: req.query.page ? parseInt(req.query.page as string, 10) : 1,
      limit: req.query.limit ? parseInt(req.query.limit as string, 10) : 20,
    });
    success(res, result.staff, { page: result.page, limit: result.limit, total: result.total });
  } catch (err: any) {
    error(res, 'Failed to list staff', 'INTERNAL_ERROR', 500);
  }
});

// POST /api/v1/staff — Create staff
staffRouter.post('/', requirePermission('staff:*'), validate(createStaffSchema), async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthenticatedRequest;
    const staff = await staffService.createStaff({
      tenantId: authReq.tenantId,
      userId: req.body.user_id,
      firstName: req.body.first_name,
      lastName: req.body.last_name,
      email: req.body.email,
      password: req.body.password,
      mobilePhone: req.body.mobile_phone,
      dateOfBirth: req.body.date_of_birth,
      hireDate: req.body.hire_date,
      employmentType: req.body.employment_type,
      role: req.body.role,
      bio: req.body.bio,
      languages: req.body.languages,
      showOnDirectory: req.body.show_on_directory,
      primaryLocationId: req.body.primary_location_id,
      businessId: req.body.business_id || (req.headers['x-business-id'] as string),
      createdBy: authReq.user.sub,
    });
    success(res, staff, undefined, 201);
  } catch (err: any) {
    error(res, 'Failed to create staff', 'INTERNAL_ERROR', 500);
  }
});

// GET /api/v1/staff/:id — Get staff detail
staffRouter.get('/:id', requirePermission('staff:read'), async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthenticatedRequest;
    const staff = await staffService.getStaffById(req.params.id, authReq.tenantId);
    if (!staff) { error(res, 'Staff not found', 'NOT_FOUND', 404); return; }
    success(res, staff);
  } catch (err: any) {
    error(res, 'Failed to get staff', 'INTERNAL_ERROR', 500);
  }
});

// PUT /api/v1/staff/:id — Update staff
staffRouter.put('/:id', requirePermission('staff:*'), validate(updateStaffSchema), async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthenticatedRequest;
    const staff = await staffService.updateStaff(req.params.id, authReq.tenantId, req.body, authReq.user.sub);
    if (!staff) { error(res, 'Staff not found', 'NOT_FOUND', 404); return; }
    success(res, staff);
  } catch (err: any) {
    error(res, 'Failed to update staff', 'INTERNAL_ERROR', 500);
  }
});

// PUT /api/v1/staff/:id/deactivate — Deactivate staff
staffRouter.put('/:id/deactivate', requirePermission('staff:*'), async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthenticatedRequest;
    const staff = await staffService.deactivateStaff(req.params.id, authReq.tenantId, authReq.user.sub);
    if (!staff) { error(res, 'Staff not found or already inactive', 'NOT_FOUND', 404); return; }
    success(res, staff);
  } catch (err: any) {
    error(res, 'Failed to deactivate staff', 'INTERNAL_ERROR', 500);
  }
});

// POST /api/v1/staff/:id/photo — Upload profile photo
staffRouter.post('/:id/photo', requirePermission('staff:*'), upload.single('photo'), async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthenticatedRequest;
    if (!req.file) { error(res, 'No photo file provided', 'VALIDATION_ERROR', 400); return; }

    const staff = await staffService.getStaffById(req.params.id, authReq.tenantId);
    if (!staff) { error(res, 'Staff not found', 'NOT_FOUND', 404); return; }

    const ext = req.file.originalname.split('.').pop() || 'jpg';
    const relativePath = `staff/${authReq.tenantId}/${req.params.id}-photo.${ext}`;
    await storage.save(relativePath, req.file.buffer);

    const updated = await staffService.updateProfilePhoto(req.params.id, authReq.tenantId, relativePath);
    success(res, updated);
  } catch (err: any) {
    error(res, 'Failed to upload photo', 'INTERNAL_ERROR', 500);
  }
});

// ============================================================
// Qualifications
// ============================================================

staffRouter.get('/:id/qualifications', requirePermission('staff:read'), async (req: Request, res: Response) => {
  try {
    const quals = await qualService.getQualifications(req.params.id);
    success(res, quals);
  } catch (err: any) {
    error(res, 'Failed to list qualifications', 'INTERNAL_ERROR', 500);
  }
});

staffRouter.post('/:id/qualifications', requirePermission('staff:*'), async (req: Request, res: Response) => {
  try {
    const qual = await qualService.addQualification(req.params.id, {
      name: req.body.name,
      issuingBody: req.body.issuing_body,
      dateObtained: req.body.date_obtained,
      expiryDate: req.body.expiry_date,
      certificationNumber: req.body.certification_number,
      documentPath: req.body.document_path,
      showOnDirectory: req.body.show_on_directory,
    });
    success(res, qual, undefined, 201);
  } catch (err: any) {
    error(res, 'Failed to add qualification', 'INTERNAL_ERROR', 500);
  }
});

staffRouter.put('/:id/qualifications/:qid', requirePermission('staff:*'), async (req: Request, res: Response) => {
  try {
    const qual = await qualService.updateQualification(req.params.qid, req.params.id, req.body);
    if (!qual) { error(res, 'Qualification not found', 'NOT_FOUND', 404); return; }
    success(res, qual);
  } catch (err: any) {
    error(res, 'Failed to update qualification', 'INTERNAL_ERROR', 500);
  }
});

staffRouter.delete('/:id/qualifications/:qid', requirePermission('staff:*'), async (req: Request, res: Response) => {
  try {
    const deleted = await qualService.deleteQualification(req.params.qid, req.params.id);
    if (!deleted) { error(res, 'Qualification not found', 'NOT_FOUND', 404); return; }
    success(res, { deleted: true });
  } catch (err: any) {
    error(res, 'Failed to delete qualification', 'INTERNAL_ERROR', 500);
  }
});

// ============================================================
// Availability Patterns
// ============================================================

staffRouter.get('/:id/availability/patterns', requirePermission('staff:read'), async (req: Request, res: Response) => {
  try {
    const patterns = await availService.getPatterns(req.params.id);
    success(res, patterns);
  } catch (err: any) {
    error(res, 'Failed to list patterns', 'INTERNAL_ERROR', 500);
  }
});

staffRouter.post('/:id/availability/patterns', requirePermission('staff:*'), async (req: Request, res: Response) => {
  try {
    const pattern = await availService.createPattern({
      staffId: req.params.id,
      name: req.body.name,
      effectiveFrom: req.body.effective_from,
      effectiveTo: req.body.effective_to,
      isDefault: req.body.is_default,
      locationId: req.body.location_id,
      slots: (req.body.slots || []).map((s: any) => ({
        dayOfWeek: s.day_of_week,
        startTime: s.start_time,
        endTime: s.end_time,
      })),
    });
    success(res, pattern, undefined, 201);
  } catch (err: any) {
    error(res, 'Failed to create pattern', 'INTERNAL_ERROR', 500);
  }
});

staffRouter.put('/:id/availability/patterns/:pid', requirePermission('staff:*'), async (req: Request, res: Response) => {
  try {
    const pattern = await availService.updatePattern(req.params.pid, req.params.id, {
      name: req.body.name,
      effectiveFrom: req.body.effective_from,
      effectiveTo: req.body.effective_to,
      isDefault: req.body.is_default,
      locationId: req.body.location_id,
      slots: req.body.slots?.map((s: any) => ({
        dayOfWeek: s.day_of_week,
        startTime: s.start_time,
        endTime: s.end_time,
      })),
    });
    if (!pattern) { error(res, 'Pattern not found', 'NOT_FOUND', 404); return; }
    success(res, pattern);
  } catch (err: any) {
    error(res, 'Failed to update pattern', 'INTERNAL_ERROR', 500);
  }
});

staffRouter.delete('/:id/availability/patterns/:pid', requirePermission('staff:*'), async (req: Request, res: Response) => {
  try {
    const deleted = await availService.deletePattern(req.params.pid, req.params.id);
    if (!deleted) { error(res, 'Pattern not found', 'NOT_FOUND', 404); return; }
    success(res, { deleted: true });
  } catch (err: any) {
    error(res, 'Failed to delete pattern', 'INTERNAL_ERROR', 500);
  }
});

staffRouter.post('/:id/availability/patterns/:pid/copy', requirePermission('staff:*'), async (req: Request, res: Response) => {
  try {
    const pattern = await availService.copyPattern(req.params.pid, req.params.id);
    if (!pattern) { error(res, 'Pattern not found', 'NOT_FOUND', 404); return; }
    success(res, pattern, undefined, 201);
  } catch (err: any) {
    error(res, 'Failed to copy pattern', 'INTERNAL_ERROR', 500);
  }
});

// GET /api/v1/staff/:id/availability — Resolved availability for date range
staffRouter.get('/:id/availability', requirePermission('staff:read'), async (req: Request, res: Response) => {
  try {
    const startDate = req.query.start_date as string;
    const endDate = req.query.end_date as string;
    if (!startDate || !endDate) { error(res, 'start_date and end_date required', 'VALIDATION_ERROR', 400); return; }

    const locationId = req.query.location_id as string;
    const availability = await availService.getEffectiveAvailabilityRange(req.params.id, startDate, endDate, locationId);
    success(res, availability);
  } catch (err: any) {
    error(res, 'Failed to get availability', 'INTERNAL_ERROR', 500);
  }
});

// ============================================================
// Availability Overrides
// ============================================================

staffRouter.get('/:id/availability/overrides', requirePermission('staff:read'), async (req: Request, res: Response) => {
  try {
    const startDate = req.query.start_date as string || new Date().toISOString().split('T')[0];
    const endDate = req.query.end_date as string || new Date(Date.now() + 90 * 86400000).toISOString().split('T')[0];
    const overrides = await availService.getOverrides(req.params.id, startDate, endDate);
    success(res, overrides);
  } catch (err: any) {
    error(res, 'Failed to list overrides', 'INTERNAL_ERROR', 500);
  }
});

staffRouter.post('/:id/availability/overrides', requirePermission('staff:*'), async (req: Request, res: Response) => {
  try {
    const override = await availService.createOverride(req.params.id, {
      overrideDate: req.body.override_date,
      overrideType: req.body.override_type,
      startTime: req.body.start_time,
      endTime: req.body.end_time,
      reason: req.body.reason,
      locationId: req.body.location_id,
    });
    success(res, override, undefined, 201);
  } catch (err: any) {
    error(res, 'Failed to create override', 'INTERNAL_ERROR', 500);
  }
});

staffRouter.delete('/:id/availability/overrides/:oid', requirePermission('staff:*'), async (req: Request, res: Response) => {
  try {
    const deleted = await availService.deleteOverride(req.params.oid, req.params.id);
    if (!deleted) { error(res, 'Override not found', 'NOT_FOUND', 404); return; }
    success(res, { deleted: true });
  } catch (err: any) {
    error(res, 'Failed to delete override', 'INTERNAL_ERROR', 500);
  }
});

// ============================================================
// Leave (per-staff)
// ============================================================

staffRouter.post('/:id/leave', async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthenticatedRequest;
    const request = await leaveService.submitLeaveRequest({
      staffId: req.params.id,
      tenantId: authReq.tenantId,
      leaveType: req.body.leave_type,
      startDate: req.body.start_date,
      endDate: req.body.end_date,
      notes: req.body.notes,
    });
    success(res, request, undefined, 201);
  } catch (err: any) {
    error(res, 'Failed to submit leave request', 'INTERNAL_ERROR', 500);
  }
});

staffRouter.get('/:id/leave/balance', requirePermission('staff:read'), async (req: Request, res: Response) => {
  try {
    const year = req.query.year ? parseInt(req.query.year as string, 10) : undefined;
    const balances = await leaveService.getLeaveBalances(req.params.id, year);
    success(res, balances);
  } catch (err: any) {
    error(res, 'Failed to get leave balances', 'INTERNAL_ERROR', 500);
  }
});

// ============================================================
// Service Assignments
// ============================================================

staffRouter.get('/:id/services', requirePermission('staff:read'), async (req: Request, res: Response) => {
  try {
    const assignments = await assignService.getServiceAssignments(req.params.id);
    success(res, assignments);
  } catch (err: any) {
    error(res, 'Failed to list service assignments', 'INTERNAL_ERROR', 500);
  }
});

staffRouter.post('/:id/services', requirePermission('staff:*'), async (req: Request, res: Response) => {
  try {
    const result = await assignService.assignServices(req.params.id, req.body.assignments || []);
    if (result.errors.length > 0) {
      success(res, { assignments: result.assignments, warnings: result.errors });
    } else {
      success(res, result.assignments, undefined, 201);
    }
  } catch (err: any) {
    error(res, 'Failed to assign services', 'INTERNAL_ERROR', 500);
  }
});

staffRouter.delete('/:id/services/:sid', requirePermission('staff:*'), async (req: Request, res: Response) => {
  try {
    const variantId = req.query.variant_id as string;
    const deleted = await assignService.removeServiceAssignment(req.params.id, req.params.sid, variantId);
    if (!deleted) { error(res, 'Assignment not found', 'NOT_FOUND', 404); return; }
    success(res, { deleted: true });
  } catch (err: any) {
    error(res, 'Failed to remove assignment', 'INTERNAL_ERROR', 500);
  }
});

// ============================================================
// Location Assignments
// ============================================================

staffRouter.get('/:id/locations', requirePermission('staff:read'), async (req: Request, res: Response) => {
  try {
    const assignments = await assignService.getLocationAssignments(req.params.id);
    success(res, assignments);
  } catch (err: any) {
    error(res, 'Failed to list location assignments', 'INTERNAL_ERROR', 500);
  }
});

staffRouter.post('/:id/locations', requirePermission('staff:*'), async (req: Request, res: Response) => {
  try {
    const result = await assignService.assignLocations(req.params.id, req.body.assignments || []);
    success(res, result, undefined, 201);
  } catch (err: any) {
    error(res, 'Failed to assign locations', 'INTERNAL_ERROR', 500);
  }
});

staffRouter.delete('/:id/locations/:lid', requirePermission('staff:*'), async (req: Request, res: Response) => {
  try {
    const deleted = await assignService.removeLocationAssignment(req.params.id, req.params.lid);
    if (!deleted) { error(res, 'Location assignment not found', 'NOT_FOUND', 404); return; }
    success(res, { deleted: true });
  } catch (err: any) {
    error(res, 'Failed to remove location', 'INTERNAL_ERROR', 500);
  }
});

// ============================================================
// Capacity
// ============================================================

staffRouter.get('/:id/capacity', requirePermission('staff:read'), async (req: Request, res: Response) => {
  try {
    const config = await capacityService.getCapacityConfig(req.params.id);
    success(res, config || { max_bookings_per_day: null, max_bookings_per_week: null, max_consecutive_hours: null });
  } catch (err: any) {
    error(res, 'Failed to get capacity config', 'INTERNAL_ERROR', 500);
  }
});

staffRouter.put('/:id/capacity', requirePermission('staff:*'), async (req: Request, res: Response) => {
  try {
    const config = await capacityService.setCapacityConfig(req.params.id, {
      maxBookingsPerDay: req.body.max_bookings_per_day,
      maxBookingsPerWeek: req.body.max_bookings_per_week,
      maxConsecutiveHours: req.body.max_consecutive_hours,
    });
    success(res, config);
  } catch (err: any) {
    error(res, 'Failed to update capacity config', 'INTERNAL_ERROR', 500);
  }
});

staffRouter.post('/:id/capacity/override', requirePermission('staff:*'), async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthenticatedRequest;
    const override = await capacityService.createCapacityOverride(req.params.id, {
      overrideDate: req.body.override_date,
      maxBookings: req.body.max_bookings,
      reason: req.body.reason,
      createdBy: authReq.user.sub,
      tenantId: authReq.tenantId,
    });
    success(res, override, undefined, 201);
  } catch (err: any) {
    error(res, 'Failed to create capacity override', 'INTERNAL_ERROR', 500);
  }
});

// ============================================================
// Calendar (per-staff)
// ============================================================

staffRouter.get('/:id/calendar', requirePermission('staff:read'), async (req: Request, res: Response) => {
  try {
    const startDate = req.query.start_date as string;
    const endDate = req.query.end_date as string;
    if (!startDate || !endDate) { error(res, 'start_date and end_date required', 'VALIDATION_ERROR', 400); return; }

    const locationId = req.query.location_id as string;
    const calendar = await calendarService.getStaffCalendar(req.params.id, startDate, endDate, locationId);
    success(res, calendar);
  } catch (err: any) {
    error(res, 'Failed to get calendar', 'INTERNAL_ERROR', 500);
  }
});

// ============================================================
// Link User Account (for staff without login access)
// ============================================================

staffRouter.post('/:id/link-account', requirePermission('staff:*'), async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthenticatedRequest;
    const email = req.body.email as string;
    const role = req.body.role as string || 'business_staff';
    const password = req.body.password as string;

    if (!email) { error(res, 'email is required', 'VALIDATION_ERROR', 400); return; }
    if (!password) { error(res, 'password is required', 'VALIDATION_ERROR', 400); return; }

    const result = await staffService.linkUserAccount(
      req.params.id, authReq.tenantId, email, role, password, req.body.business_id,
    );
    success(res, result, undefined, 201);
  } catch (err: any) {
    if (err.message.includes('already')) {
      error(res, err.message, 'VALIDATION_ERROR', 400);
    } else {
      error(res, 'Failed to link user account', 'INTERNAL_ERROR', 500);
    }
  }
});


// POST /api/v1/staff/:id/reset-password — Reset staff password
staffRouter.post('/:id/reset-password', requirePermission('staff:*'), async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthenticatedRequest;
    const newPassword = req.body.password as string;
    if (!newPassword || newPassword.length < 8) {
      error(res, 'Password must be at least 8 characters', 'VALIDATION_ERROR', 400);
      return;
    }

    const result = await staffService.resetStaffPassword(req.params.id, authReq.tenantId, newPassword);
    if (!result) { error(res, 'Staff not found', 'NOT_FOUND', 404); return; }
    success(res, { reset: true });
  } catch (err: any) {
    if (err.message.includes('not found') || err.message.includes('no user')) {
      error(res, err.message, 'VALIDATION_ERROR', 400);
    } else {
      error(res, 'Failed to reset password', 'INTERNAL_ERROR', 500);
    }
  }
});
