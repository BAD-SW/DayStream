import { Router, Request, Response } from 'express';
import Joi from 'joi';
import { validate } from '../middleware/validate';
import { authenticate, AuthenticatedRequest } from '../auth/middleware';
import { requirePermission } from '../auth/permissions';
import { success, error } from '../utils/response';
import { adminPool } from '../db/pool';

export const prospectsRouter = Router();

prospectsRouter.use(authenticate);

// ============================================================
// Territory Management (System Admin)
// ============================================================

const updateTerritorySchema = Joi.object({
  location: Joi.string().max(200).required(),
  territory_radius_km: Joi.number().integer().min(5).required(),
});

// PUT /api/v1/prospects/territories/:tenantId — Assign/update territory (system admin)
prospectsRouter.put('/territories/:tenantId', requirePermission('*:*'), validate(updateTerritorySchema), async (req: Request, res: Response) => {
  try {
    const { location, territory_radius_km } = req.body;

    // Geocode the location to get coordinates
    const { geocodePostalCode } = await import('../services/google-places.service');
    const geo = await geocodePostalCode(location);
    if (!geo) { error(res, 'Could not resolve location. Please check and try again.', 'VALIDATION_ERROR', 400); return; }

    const radius = territory_radius_km;

    // Generate H3 hexagons for the territory
    const { generateTerritoryHexagons, saveTerritoryHexagons } = await import('../services/h3-territory.service');
    const hexagons = generateTerritoryHexagons(geo.lat, geo.lng, radius);
    await saveTerritoryHexagons(req.params.tenantId, hexagons);

    // Update tenant record
    const { rows } = await adminPool.query(
      `UPDATE sys_tenants SET territory_lat = $1, territory_lng = $2, territory_radius_km = $3, territory_address = $4, updated_at = NOW()
       WHERE id = $5 RETURNING id, name, territory_lat, territory_lng, territory_radius_km, territory_address`,
      [geo.lat, geo.lng, radius, location, req.params.tenantId],
    );
    if (rows.length === 0) { error(res, 'Tenant not found', 'NOT_FOUND', 404); return; }
    success(res, { ...rows[0], hexagon_count: hexagons.length });
  } catch (err: any) { error(res, err.message || 'Failed to update territory', 'INTERNAL_ERROR', 500); }
});

// GET /api/v1/prospects/territories — List all territories (system admin, for coverage map)
prospectsRouter.get('/territories', requirePermission('*:*'), async (_req: Request, res: Response) => {
  try {
    const { getAllTerritories } = await import('../services/h3-territory.service');
    const territories = await getAllTerritories();
    success(res, territories);
  } catch (err: any) { error(res, 'Failed to list territories', 'INTERNAL_ERROR', 500); }
});

// ============================================================
// Prospect Categories (System Admin)
// ============================================================

// GET /api/v1/prospects/categories — List all categories
prospectsRouter.get('/categories', requirePermission('*:*'), async (_req: Request, res: Response) => {
  try {
    const { rows } = await adminPool.query('SELECT * FROM sys_prospect_categories ORDER BY label');
    success(res, rows);
  } catch (err: any) { error(res, 'Failed to list categories', 'INTERNAL_ERROR', 500); }
});

// POST /api/v1/prospects/categories — Add a category
prospectsRouter.post('/categories', requirePermission('*:*'), async (req: Request, res: Response) => {
  try {
    const { google_type, label } = req.body;
    if (!google_type || !label) { error(res, 'google_type and label required', 'VALIDATION_ERROR', 400); return; }
    const { rows } = await adminPool.query(
      'INSERT INTO sys_prospect_categories (google_type, label) VALUES ($1, $2) ON CONFLICT (google_type) DO UPDATE SET label = $2 RETURNING *',
      [google_type, label],
    );
    success(res, rows[0], undefined, 201);
  } catch (err: any) { error(res, 'Failed to add category', 'INTERNAL_ERROR', 500); }
});

// DELETE /api/v1/prospects/categories/:id — Delete a category
prospectsRouter.delete('/categories/:id', requirePermission('*:*'), async (req: Request, res: Response) => {
  try {
    await adminPool.query('DELETE FROM sys_prospect_categories WHERE id = $1', [req.params.id]);
    success(res, { deleted: true });
  } catch (err: any) { error(res, 'Failed to delete category', 'INTERNAL_ERROR', 500); }
});

// ============================================================
// Prospect List Management (Tenant Manager)
// ============================================================

// GET /api/v1/prospects/maps-key — Get API key for client-side Google Maps embed
prospectsRouter.get('/maps-key', requirePermission('*:*'), async (_req: Request, res: Response) => {
  try {
    const { rows } = await adminPool.query(
      `SELECT config_data FROM sys_system_configurations WHERE category = 'api_keys'`,
    );
    const key = rows[0]?.config_data?.google_places || null;
    success(res, { key });
  } catch (err: any) { error(res, 'Failed to get maps key', 'INTERNAL_ERROR', 500); }
});

// GET /api/v1/prospects/territory-info — Get current tenant's territory info
prospectsRouter.get('/territory-info', requirePermission('settings:*'), async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthenticatedRequest;
    const tenantId = authReq.tenantId;
    if (!tenantId) { error(res, 'Tenant context required', 'VALIDATION_ERROR', 400); return; }
    const { rows } = await adminPool.query(
      'SELECT territory_address, territory_radius_km, territory_lat, territory_lng FROM sys_tenants WHERE id = $1',
      [tenantId],
    );
    success(res, rows[0] || null);
  } catch (err: any) { error(res, 'Failed to get territory info', 'INTERNAL_ERROR', 500); }
});

// GET /api/v1/prospects — List prospects for the current tenant
prospectsRouter.get('/', requirePermission('settings:*'), async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthenticatedRequest;
    const tenantId = authReq.tenantId;
    if (!tenantId) { error(res, 'Tenant context required', 'VALIDATION_ERROR', 400); return; }

    const conditions = ['tenant_id = $1'];
    const params: any[] = [tenantId];
    let idx = 2;

    const showDismissed = req.query.show_dismissed === 'true';
    if (!showDismissed) {
      conditions.push(`status != 'dismissed'`);
      conditions.push('is_active = true');
    }
    if (req.query.status) { conditions.push(`status = $${idx++}`); params.push(req.query.status); }
    if (req.query.category) { conditions.push(`category = $${idx++}`); params.push(req.query.category); }
    if (req.query.search) { conditions.push(`(name ILIKE $${idx} OR address ILIKE $${idx})`); params.push(`%${req.query.search}%`); idx++; }

    const where = conditions.join(' AND ');

    // Get territory center for distance calculation
    const { rows: tenantInfo } = await adminPool.query(
      'SELECT territory_lat, territory_lng FROM sys_tenants WHERE id = $1',
      [tenantId],
    );
    const tLat = tenantInfo[0]?.territory_lat;
    const tLng = tenantInfo[0]?.territory_lng;

    const distanceExpr = tLat && tLng
      ? `, ROUND((6371 * acos(LEAST(1.0, cos(radians(${tLat})) * cos(radians(lat)) * cos(radians(lng) - radians(${tLng})) + sin(radians(${tLat})) * sin(radians(lat)))))::numeric, 1) AS distance_km`
      : ', NULL AS distance_km';

    const { rows } = await adminPool.query(
      `SELECT *${distanceExpr} FROM prp_prospects WHERE ${where} ORDER BY created_at DESC`,
      params,
    );
    success(res, rows);
  } catch (err: any) { error(res, 'Failed to list prospects', 'INTERNAL_ERROR', 500); }
});

// POST /api/v1/prospects — Manually add a prospect
prospectsRouter.post('/', requirePermission('settings:*'), async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthenticatedRequest;
    const tenantId = authReq.tenantId;
    if (!tenantId) { error(res, 'Tenant context required', 'VALIDATION_ERROR', 400); return; }

    const { name, address, phone, website, category, notes } = req.body;
    if (!name) { error(res, 'name required', 'VALIDATION_ERROR', 400); return; }

    const { rows } = await adminPool.query(
      `INSERT INTO prp_prospects (tenant_id, name, address, phone, website, category, notes, source)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 'manual') RETURNING *`,
      [tenantId, name, address || null, phone || null, website || null, category || null, notes || null],
    );
    success(res, rows[0], undefined, 201);
  } catch (err: any) { error(res, 'Failed to add prospect', 'INTERNAL_ERROR', 500); }
});

// PUT /api/v1/prospects/:id — Update prospect (status, notes)
prospectsRouter.put('/:id', requirePermission('settings:*'), async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthenticatedRequest;
    const tenantId = authReq.tenantId;

    const { status, notes } = req.body;
    const fields: string[] = [];
    const params: any[] = [];
    let idx = 1;

    if (status !== undefined) { fields.push(`status = $${idx++}`); params.push(status); fields.push(`last_status_change = NOW()`); }
    if (notes !== undefined) { fields.push(`notes = $${idx++}`); params.push(notes); }
    fields.push('updated_at = NOW()');

    if (params.length === 0) { error(res, 'Nothing to update', 'VALIDATION_ERROR', 400); return; }

    params.push(req.params.id, tenantId);
    const { rows } = await adminPool.query(
      `UPDATE prp_prospects SET ${fields.join(', ')} WHERE id = $${idx++} AND tenant_id = $${idx} RETURNING *`,
      params,
    );
    if (rows.length === 0) { error(res, 'Prospect not found', 'NOT_FOUND', 404); return; }
    success(res, rows[0]);
  } catch (err: any) { error(res, 'Failed to update prospect', 'INTERNAL_ERROR', 500); }
});

// PUT /api/v1/prospects/:id/dismiss — Dismiss a prospect
prospectsRouter.put('/:id/dismiss', requirePermission('settings:*'), async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthenticatedRequest;
    const tenantId = authReq.tenantId;
    const { rows } = await adminPool.query(
      `UPDATE prp_prospects SET status = 'dismissed', last_status_change = NOW(), updated_at = NOW() WHERE id = $1 AND tenant_id = $2 RETURNING *`,
      [req.params.id, tenantId],
    );
    if (rows.length === 0) { error(res, 'Prospect not found', 'NOT_FOUND', 404); return; }
    success(res, rows[0]);
  } catch (err: any) { error(res, 'Failed to dismiss prospect', 'INTERNAL_ERROR', 500); }
});

// POST /api/v1/prospects/generate — Generate/refresh prospect list from Google Places
prospectsRouter.post('/generate', requirePermission('settings:*'), async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthenticatedRequest;
    const tenantId = authReq.tenantId;
    if (!tenantId) { error(res, 'Tenant context required', 'VALIDATION_ERROR', 400); return; }

    // Load tenant territory
    const { rows: tenantRows } = await adminPool.query(
      'SELECT territory_address, territory_lat, territory_lng, territory_radius_km FROM sys_tenants WHERE id = $1',
      [tenantId],
    );
    if (tenantRows.length === 0 || !tenantRows[0].territory_address) {
      error(res, 'No territory assigned. Contact your system administrator.', 'VALIDATION_ERROR', 400);
      return;
    }
    const { territory_address, territory_lat, territory_lng } = tenantRows[0];

    // Load active categories
    const { rows: categories } = await adminPool.query(
      'SELECT google_type FROM sys_prospect_categories',
    );
    if (categories.length === 0) {
      error(res, 'No prospect categories configured. Contact your system administrator.', 'VALIDATION_ERROR', 400);
      return;
    }

    // Call Google Places Text Search per category (so client polling sees results progressively)
    const { searchByText } = await import('../services/google-places.service');
    let newCount = 0;
    const returnedPlaceIds: string[] = [];
    const seenPlaceIds = new Set<string>();

    for (const cat of categories) {
      const places = await searchByText(territory_address, cat.google_type);

      for (const place of places) {
        if (seenPlaceIds.has(place.place_id)) continue;
        seenPlaceIds.add(place.place_id);
        returnedPlaceIds.push(place.place_id);

        await adminPool.query(
          `INSERT INTO prp_prospects (tenant_id, google_place_id, name, address, phone, website, category, rating, review_count, lat, lng, source)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 'api')
           ON CONFLICT (tenant_id, google_place_id) DO UPDATE SET
             name = EXCLUDED.name, address = EXCLUDED.address, phone = EXCLUDED.phone,
             website = EXCLUDED.website, rating = EXCLUDED.rating, review_count = EXCLUDED.review_count,
             lat = EXCLUDED.lat, lng = EXCLUDED.lng,
             is_active = true, updated_at = NOW()`,
          [tenantId, place.place_id, place.name, place.address, place.phone || null, place.website || null, place.category || null, place.rating || null, place.review_count || 0, place.lat || null, place.lng || null],
        );
        newCount++;
      }
    }

    // Mark prospects not returned as inactive
    let inactiveMarked = 0;
    if (returnedPlaceIds.length > 0) {
      const { rowCount } = await adminPool.query(
        `UPDATE prp_prospects SET is_active = false, updated_at = NOW()
         WHERE tenant_id = $1 AND source = 'api' AND google_place_id IS NOT NULL
           AND google_place_id != ALL($2) AND is_active = true`,
        [tenantId, returnedPlaceIds],
      );
      inactiveMarked = rowCount ?? 0;
    }

    // Log generation
    await adminPool.query(
      `INSERT INTO prp_generation_log (tenant_id, new_count, total_returned, inactive_marked, cost_cents)
       VALUES ($1, $2, $3, $4, $5)`,
      [tenantId, newCount, seenPlaceIds.size, inactiveMarked, Math.ceil(categories.length * 1.7)],
    );

    success(res, { total_returned: seenPlaceIds.size, new_added: newCount, inactive_marked: inactiveMarked });
  } catch (err: any) {
    if (err.message.includes('GOOGLE_PLACES_API_KEY')) {
      error(res, 'Google Places API key not configured. Contact your system administrator.', 'CONFIGURATION_ERROR', 500);
    } else {
      error(res, `Failed to generate prospects: ${err.message}`, 'INTERNAL_ERROR', 500);
    }
  }
});

// GET /api/v1/prospects/export — Export prospects as CSV
prospectsRouter.get('/export', requirePermission('settings:*'), async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthenticatedRequest;
    const tenantId = authReq.tenantId;

    const conditions = ['tenant_id = $1', 'is_active = true'];
    const params: any[] = [tenantId];
    let idx = 2;

    if (req.query.status) { conditions.push(`status = $${idx++}`); params.push(req.query.status); }
    if (req.query.category) { conditions.push(`category = $${idx++}`); params.push(req.query.category); }

    const where = conditions.join(' AND ');
    const { rows } = await adminPool.query(
      `SELECT name, address, phone, website, category, rating, review_count, status, notes, source, created_at FROM prp_prospects WHERE ${where} ORDER BY name`,
      params,
    );

    // Build CSV
    const headers = ['Name', 'Address', 'Phone', 'Website', 'Category', 'Rating', 'Reviews', 'Status', 'Notes', 'Source', 'Date Added'];
    const csvLines = [headers.join(',')];
    for (const row of rows) {
      csvLines.push([
        `"${(row.name || '').replace(/"/g, '""')}"`,
        `"${(row.address || '').replace(/"/g, '""')}"`,
        `"${row.phone || ''}"`,
        `"${row.website || ''}"`,
        `"${row.category || ''}"`,
        row.rating || '',
        row.review_count || 0,
        row.status,
        `"${(row.notes || '').replace(/"/g, '""')}"`,
        row.source,
        new Date(row.created_at).toISOString().split('T')[0],
      ].join(','));
    }

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="prospects.csv"');
    res.send(csvLines.join('\n'));
  } catch (err: any) { error(res, 'Failed to export prospects', 'INTERNAL_ERROR', 500); }
});
