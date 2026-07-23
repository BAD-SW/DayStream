import { Router, Request, Response } from 'express';
import Joi from 'joi';
import { authenticate, AuthenticatedRequest } from '../auth/middleware';
import { tenantContext } from '../auth/tenant-context';
import { requirePermission } from '../auth/permissions';
import { validate } from '../middleware/validate';
import { success, error } from '../utils/response';
import * as locationService from '../services/location.service';

export const locationsRouter = Router();

locationsRouter.use(authenticate);
locationsRouter.use(tenantContext);

// ============================================================
// Validation Schemas
// ============================================================

const createLocationSchema = Joi.object({
  business_id: Joi.string().uuid().required(),
  name: Joi.string().min(1).max(200).required(),
  is_primary: Joi.boolean().default(false),
  address_line1: Joi.string().max(255).allow('', null),
  address_line2: Joi.string().max(255).allow('', null),
  city: Joi.string().max(100).allow('', null),
  state_province: Joi.string().max(100).allow('', null),
  postal_code: Joi.string().max(20).allow('', null),
  country: Joi.string().max(2).allow('', null),
  phone: Joi.string().max(50).allow('', null),
  email: Joi.string().email({ tlds: false }).allow('', null),
  latitude: Joi.number().min(-90).max(90).allow(null),
  longitude: Joi.number().min(-180).max(180).allow(null),
  timezone: Joi.string().max(50).allow('', null),
  description: Joi.string().max(2000).allow('', null),
  display_order: Joi.number().integer().min(0).default(0),
});

const updateLocationSchema = Joi.object({
  name: Joi.string().min(1).max(200),
  status: Joi.string().valid('active', 'inactive', 'temporarily_closed'),
  is_primary: Joi.boolean(),
  address_line1: Joi.string().max(255).allow('', null),
  address_line2: Joi.string().max(255).allow('', null),
  city: Joi.string().max(100).allow('', null),
  state_province: Joi.string().max(100).allow('', null),
  postal_code: Joi.string().max(20).allow('', null),
  country: Joi.string().max(2).allow('', null),
  phone: Joi.string().max(50).allow('', null),
  email: Joi.string().email({ tlds: false }).allow('', null),
  latitude: Joi.number().min(-90).max(90).allow(null),
  longitude: Joi.number().min(-180).max(180).allow(null),
  timezone: Joi.string().max(50).allow('', null),
  description: Joi.string().max(2000).allow('', null),
  photo_url: Joi.string().max(500).allow('', null),
  display_order: Joi.number().integer().min(0),
}).min(1);

// ============================================================
// Routes
// ============================================================

// GET /api/v1/locations — List locations for a business
locationsRouter.get('/', requirePermission('settings:read'), async (req: Request, res: Response) => {
  try {
    const businessId = req.query.business_id as string;
    if (!businessId) { error(res, 'business_id required', 'VALIDATION_ERROR', 400); return; }

    const locations = await locationService.getLocations(businessId, {
      status: req.query.status as string,
      search: req.query.search as string,
    });

    success(res, locations);
  } catch (err: any) {
    error(res, 'Failed to list locations', 'INTERNAL_ERROR', 500);
  }
});

// POST /api/v1/locations — Create a location
locationsRouter.post('/', requirePermission('settings:*'), validate(createLocationSchema), async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthenticatedRequest;
    const location = await locationService.createLocation({
      businessId: req.body.business_id,
      name: req.body.name,
      isPrimary: req.body.is_primary,
      addressLine1: req.body.address_line1,
      addressLine2: req.body.address_line2,
      city: req.body.city,
      stateProvince: req.body.state_province,
      postalCode: req.body.postal_code,
      country: req.body.country,
      phone: req.body.phone,
      email: req.body.email,
      latitude: req.body.latitude,
      longitude: req.body.longitude,
      timezone: req.body.timezone,
      description: req.body.description,
      displayOrder: req.body.display_order,
      createdBy: authReq.user.sub,
      tenantId: authReq.tenantId,
    });

    success(res, location, undefined, 201);
  } catch (err: any) {
    if (err.message?.includes('duplicate') || err.message?.includes('unique')) {
      error(res, 'A location with this name already exists', 'DUPLICATE_NAME', 409);
    } else {
      error(res, 'Failed to create location', 'INTERNAL_ERROR', 500);
    }
  }
});

// GET /api/v1/locations/:id — Get location detail
locationsRouter.get('/:id', requirePermission('settings:read'), async (req: Request, res: Response) => {
  try {
    const businessId = req.query.business_id as string;
    if (!businessId) { error(res, 'business_id required', 'VALIDATION_ERROR', 400); return; }

    const location = await locationService.getLocationById(req.params.id, businessId);
    if (!location) { error(res, 'Location not found', 'NOT_FOUND', 404); return; }

    // Include assignment counts
    const summary = await locationService.getLocationSummary(req.params.id);

    success(res, { ...location, ...summary });
  } catch (err: any) {
    error(res, 'Failed to get location', 'INTERNAL_ERROR', 500);
  }
});

// PUT /api/v1/locations/:id — Update location
locationsRouter.put('/:id', requirePermission('settings:*'), validate(updateLocationSchema), async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthenticatedRequest;
    const businessId = req.query.business_id as string;
    if (!businessId) { error(res, 'business_id required', 'VALIDATION_ERROR', 400); return; }

    const location = await locationService.updateLocation(
      req.params.id, businessId, req.body, authReq.user.sub, authReq.tenantId,
    );

    if (!location) { error(res, 'Location not found', 'NOT_FOUND', 404); return; }
    success(res, location);
  } catch (err: any) {
    error(res, 'Failed to update location', 'INTERNAL_ERROR', 500);
  }
});

// PUT /api/v1/locations/:id/deactivate — Deactivate location
locationsRouter.put('/:id/deactivate', requirePermission('settings:*'), async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthenticatedRequest;
    const businessId = req.query.business_id as string;
    if (!businessId) { error(res, 'business_id required', 'VALIDATION_ERROR', 400); return; }

    const deactivated = await locationService.deactivateLocation(
      req.params.id, businessId, authReq.user.sub, authReq.tenantId,
    );

    if (!deactivated) { error(res, 'Location not found or already inactive', 'NOT_FOUND', 404); return; }
    success(res, { deactivated: true });
  } catch (err: any) {
    if (err.message?.includes('only active location')) {
      error(res, err.message, 'VALIDATION_ERROR', 400);
    } else {
      error(res, 'Failed to deactivate location', 'INTERNAL_ERROR', 500);
    }
  }
});

// ============================================================
// Location Hours
// ============================================================

import * as locationHoursService from '../services/location-hours.service';

// GET /api/v1/locations/:id/hours
locationsRouter.get('/:id/hours', requirePermission('settings:read'), async (req: Request, res: Response) => {
  try {
    const hours = await locationHoursService.getLocationHours(req.params.id);
    success(res, hours);
  } catch (err: any) {
    error(res, 'Failed to get location hours', 'INTERNAL_ERROR', 500);
  }
});

// PUT /api/v1/locations/:id/hours
locationsRouter.put('/:id/hours', requirePermission('settings:*'), async (req: Request, res: Response) => {
  try {
    if (!Array.isArray(req.body.hours)) {
      error(res, 'hours array required', 'VALIDATION_ERROR', 400);
      return;
    }
    const hours = await locationHoursService.setLocationHours(req.params.id, req.body.hours);
    success(res, hours);
  } catch (err: any) {
    error(res, 'Failed to set location hours', 'INTERNAL_ERROR', 500);
  }
});


// GET /api/v1/locations/:id/hours/overrides
locationsRouter.get('/:id/hours/overrides', requirePermission('settings:read'), async (req: Request, res: Response) => {
  try {
    const year = req.query.year ? parseInt(req.query.year as string, 10) : undefined;
    const overrides = await locationHoursService.getLocationHourOverrides(req.params.id, year);
    success(res, overrides);
  } catch (err: any) {
    error(res, 'Failed to get hour overrides', 'INTERNAL_ERROR', 500);
  }
});

// POST /api/v1/locations/:id/hours/overrides
locationsRouter.post('/:id/hours/overrides', requirePermission('settings:*'), async (req: Request, res: Response) => {
  try {
    if (!req.body.override_date) { error(res, 'override_date required', 'VALIDATION_ERROR', 400); return; }
    const override = await locationHoursService.upsertLocationHourOverride(req.params.id, {
      override_date: req.body.override_date,
      label: req.body.label,
      is_closed: req.body.is_closed ?? false,
      open_time: req.body.open_time,
      close_time: req.body.close_time,
    });
    success(res, override, undefined, 201);
  } catch (err: any) {
    error(res, 'Failed to save hour override', 'INTERNAL_ERROR', 500);
  }
});

// DELETE /api/v1/locations/:id/hours/overrides/:overrideId
locationsRouter.delete('/:id/hours/overrides/:overrideId', requirePermission('settings:*'), async (req: Request, res: Response) => {
  try {
    const deleted = await locationHoursService.deleteLocationHourOverride(req.params.overrideId, req.params.id);
    if (!deleted) { error(res, 'Override not found', 'NOT_FOUND', 404); return; }
    success(res, { deleted: true });
  } catch (err: any) {
    error(res, 'Failed to delete hour override', 'INTERNAL_ERROR', 500);
  }
});


// GET /api/v1/locations/:id/hours/overrides/years
locationsRouter.get('/:id/hours/overrides/years', requirePermission('settings:read'), async (req: Request, res: Response) => {
  try {
    const years = await locationHoursService.getLocationHourOverrideYears(req.params.id);
    success(res, years);
  } catch (err: any) {
    error(res, 'Failed to get override years', 'INTERNAL_ERROR', 500);
  }
});
