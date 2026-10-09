import { Router, Request, Response } from 'express';
import Joi from 'joi';
import { validate } from '../middleware/validate';
import { authenticate, AuthenticatedRequest } from '../auth/middleware';
import { requirePermission } from '../auth/permissions';
import { success, error } from '../utils/response';
import { adminPool } from '../db/pool';
import { logger } from '../middleware/logger';

export const prospectsRouter = Router();

prospectsRouter.use(authenticate);

// ============================================================
// Territory Management (System Admin)
// ============================================================

// POST /api/v1/prospects/territories/:tenantId/preview — Resolve a location string
// to boundary CANDIDATES (city vs province vs state, like Google Maps) WITHOUT
// writing anything. Each candidate includes a completeness-aware hex preview and its
// boundary polygon so the admin can see exactly what they'd be assigning before saving.
const previewTerritorySchema = Joi.object({
  query: Joi.string().trim().min(2).max(200).required(),
});

prospectsRouter.post('/territories/:tenantId/preview', requirePermission('*:*'), validate(previewTerritorySchema), async (req: Request, res: Response) => {
  try {
    const { query } = req.body;
    const { resolveTerritoryCandidates, geocodePostalCode } = await import('../services/google-places.service');
    const { tileTerritoryComplete, geojsonToH3Rings } = await import('../services/h3-territory.service');

    const found = await resolveTerritoryCandidates(query);

    // Build a preview per candidate: tile its boundary completely and report the
    // hex count / resolution / completeness so the UI can show the trade-off.
    // Drop any that tile to 0 cells (a degenerate/point boundary is not a territory).
    const candidates = found
      .map((c) => {
        const rings = geojsonToH3Rings(c.geojson);
        const tiling = tileTerritoryComplete(rings, c.viewport ?? null, c.lat, c.lng);
        return {
          id: c.id,
          label: c.label,
          kind: c.kind,
          lat: c.lat,
          lng: c.lng,
          geojson: c.geojson,
          hexCount: tiling.hexagons.length,
          resolution: tiling.resolution,
          complete: tiling.complete,
          hasBoundary: tiling.hasBoundary,
        };
      })
      .filter((c) => c.hexCount > 0);

    // Fallback: if NO administrative boundary matched (informal name), offer the raw
    // geocode viewport as a single approximate (rectangle) option, clearly flagged.
    if (candidates.length === 0) {
      const geo = await geocodePostalCode(query);
      if (geo) {
        const tiling = tileTerritoryComplete(null, geo.viewport ?? null, geo.lat, geo.lng);
        candidates.push({
          id: 'viewport',
          label: `${query} (approximate area — no precise boundary found)`,
          kind: 'approximate',
          lat: geo.lat,
          lng: geo.lng,
          geojson: null as any,
          hexCount: tiling.hexagons.length,
          resolution: tiling.resolution,
          complete: tiling.complete,
          hasBoundary: false,
        });
      }
    }

    success(res, { candidates });
  } catch (err: any) {
    // A throttled/unavailable boundary service must NOT look like "no boundary" —
    // tell the client to retry rather than silently offering an approximate box.
    if (err?.name === 'GeoLookupUnavailableError') { error(res, err.message, 'GEO_UNAVAILABLE', 503); return; }
    error(res, err.message || 'Failed to resolve territory', 'INTERNAL_ERROR', 500);
  }
});

// GET /api/v1/prospects/territories/:tenantId — The tenant's current territory
// composition (the component areas + stored center/label) for the picker to show.
prospectsRouter.get('/territories/:tenantId', requirePermission('*:*'), async (req: Request, res: Response) => {
  try {
    const { rows } = await adminPool.query(
      `SELECT id, name, territory_lat, territory_lng, territory_address, territory_components
       FROM sys_tenants WHERE id = $1`,
      [req.params.tenantId],
    );
    if (rows.length === 0) { error(res, 'Tenant not found', 'NOT_FOUND', 404); return; }
    const { rows: hexCount } = await adminPool.query(
      `SELECT COUNT(*)::int AS n FROM prp_tenant_territories WHERE tenant_id = $1`, [req.params.tenantId],
    );
    success(res, { ...rows[0], hexagons: hexCount[0]?.n ?? 0 });
  } catch (err: any) { error(res, 'Failed to read territory', 'INTERNAL_ERROR', 500); }
});

// POST /api/v1/prospects/territories/hydrate — Re-hydrate stored territory components
// (which carry only {id,label,kind,lat,lng} — geometry was stripped on save) back
// into full candidates WITH boundary geojson + hex counts, so the picker can
// pre-load the current territory into its editable "Selected areas" list and draw
// it on the map. Boundaries come from the cached batch OSM lookup.
const hydrateSchema = Joi.object({
  components: Joi.array().items(Joi.object({
    id: Joi.string().max(120).allow('', null),
    label: Joi.string().max(300).allow('', null),
    kind: Joi.string().max(40).allow('', null),
    lat: Joi.number().allow(null),
    lng: Joi.number().allow(null),
  }).unknown(true)).default([]),
});

prospectsRouter.post('/territories/hydrate', requirePermission('*:*'), validate(hydrateSchema), async (req: Request, res: Response) => {
  try {
    const components: Array<{ id?: string; label?: string; kind?: string; lat?: number; lng?: number }> = req.body.components || [];
    const { lookupTerritoryBoundaries } = await import('../services/google-places.service');
    const { tileTerritoryComplete, geojsonToH3Rings } = await import('../services/h3-territory.service');

    const refs = components.map((c) => c.id).filter((id): id is string => !!id && id !== 'viewport');
    const boundaryMap = refs.length > 0 ? await lookupTerritoryBoundaries(refs) : new Map();

    const hydrated = components.map((c) => {
      const b = c.id ? boundaryMap.get(c.id) : undefined;
      const geojson = b?.geojson ?? null;
      const rings = geojson ? geojsonToH3Rings(geojson) : null;
      const tiling = tileTerritoryComplete(rings, null, c.lat ?? b?.lat, c.lng ?? b?.lng);
      return {
        id: c.id || '',
        label: c.label || '',
        kind: c.kind || 'area',
        lat: c.lat ?? b?.lat ?? 0,
        lng: c.lng ?? b?.lng ?? 0,
        geojson,
        hexCount: tiling.hexagons.length,
        resolution: tiling.resolution,
        complete: tiling.complete,
        hasBoundary: !!geojson,
      };
    });
    success(res, { components: hydrated });
  } catch (err: any) {
    if (err?.name === 'GeoLookupUnavailableError') { error(res, err.message, 'GEO_UNAVAILABLE', 503); return; }
    error(res, 'Failed to hydrate territory components', 'INTERNAL_ERROR', 500);
  }
});

// PUT /api/v1/prospects/territories/:tenantId — Assign/update territory (system admin).
// Preferred: { components: [ {label, kind, lat, lng, geojson}, ... ] } — a composed
// territory (e.g. several counties) whose boundaries are unioned and whose component
// list is persisted for the contract definition. Back-compat: a single candidate
// ({ geojson, label, lat, lng }) or a bare { location } string still work.
const territoryComponentSchema = Joi.object({
  id: Joi.string().max(120).allow('', null),
  label: Joi.string().max(300).required(),
  kind: Joi.string().max(40).allow('', null),
  lat: Joi.number(),
  lng: Joi.number(),
  geojson: Joi.object().unknown(true).allow(null),
}).unknown(true);

const updateTerritorySchema = Joi.object({
  // Preferred: composed territory.
  components: Joi.array().items(territoryComponentSchema).min(1),
  // Single-candidate save:
  geojson: Joi.object().unknown(true),
  label: Joi.string().max(300),
  lat: Joi.number(),
  lng: Joi.number(),
  // Back-compat location-string save:
  location: Joi.string().max(200),
  territory_radius_km: Joi.number().integer().min(5).default(50),
}).or('components', 'geojson', 'location', 'lat');

prospectsRouter.put('/territories/:tenantId', requirePermission('*:*'), validate(updateTerritorySchema), async (req: Request, res: Response) => {
  try {
    const { components, geojson, label, lat, lng, location, territory_radius_km } = req.body;
    const { geocodePostalCode, lookupTerritoryBoundaries } = await import('../services/google-places.service');
    const {
      tileTerritoryComplete, tileManyComplete, saveTerritoryHexagons, geojsonToH3Rings,
    } = await import('../services/h3-territory.service');

    // Normalize to a component list. Single-candidate and legacy-location collapse
    // to a one-element composition so there's a single save path.
    let comps: Array<{ id?: string; label: string; kind?: string; lat?: number; lng?: number; geojson?: any }>;
    if (Array.isArray(components) && components.length > 0) {
      comps = components;
    } else if (geojson || lat != null) {
      comps = [{ label: label || '', geojson: geojson || null, lat, lng }];
    } else {
      // Legacy: geocode the location string into a single component.
      const geo = await geocodePostalCode(location);
      if (!geo) { error(res, 'Could not resolve location. Please check and try again.', 'VALIDATION_ERROR', 400); return; }
      comps = [{ label: location, geojson: geo.geojson || null, lat: geo.lat, lng: geo.lng }];
      if (!geo.geojson && geo.viewport) {
        // tileTerritoryComplete handles the viewport; pass it via a single-area tile below.
        const tiling = tileTerritoryComplete(null, geo.viewport, geo.lat, geo.lng, territory_radius_km);
        await saveTerritoryHexagons(req.params.tenantId, tiling.hexagons);
        const { rows: r0 } = await adminPool.query(
          `UPDATE sys_tenants SET territory_lat = $1, territory_lng = $2, territory_radius_km = $3,
             territory_address = $4, territory_components = $5, updated_at = NOW()
           WHERE id = $6 RETURNING id, name, territory_lat, territory_lng, territory_radius_km, territory_address, territory_components`,
          [geo.lat, geo.lng, territory_radius_km, location, JSON.stringify(comps.map(stripComp)), req.params.tenantId],
        );
        if (r0.length === 0) { error(res, 'Tenant not found', 'NOT_FOUND', 404); return; }
        success(res, { ...r0[0], hexagons: tiling.hexagons.length, resolution: tiling.resolution, complete: tiling.complete, hasBoundary: tiling.hasBoundary });
        return;
      }
    }

    // Resolve each component's boundary. The client sends lightweight refs (no
    // geometry — a many-county payload would exceed the body limit), so look the
    // boundaries up by OSM id server-side in a SINGLE batch call when geojson wasn't
    // inlined (avoids per-area rate-limiting).
    const refsToLookup = comps
      .filter((c) => !c.geojson && c.id && c.id !== 'viewport')
      .map((c) => c.id as string);
    const boundaryMap = refsToLookup.length > 0 ? await lookupTerritoryBoundaries(refsToLookup) : new Map();

    const resolved = comps.map((c) => {
      let gj = c.geojson || null;
      let cLat = c.lat; let cLng = c.lng;
      if (!gj && c.id && boundaryMap.has(c.id)) {
        const b = boundaryMap.get(c.id)!;
        gj = b.geojson; cLat = cLat ?? b.lat; cLng = cLng ?? b.lng;
      }
      return { rings: gj ? geojsonToH3Rings(gj) : null, centerLat: cLat, centerLng: cLng, lat: cLat, lng: cLng };
    });

    // Tile the union of all components (auto-coarsened together, never truncated).
    const tiling = tileManyComplete(resolved.map((c) => ({
      rings: c.rings,
      centerLat: c.centerLat,
      centerLng: c.centerLng,
    })));
    await saveTerritoryHexagons(req.params.tenantId, tiling.hexagons);

    // A combined human/contract label + the stored component list (geometry stripped).
    const combinedLabel = comps.length === 1
      ? shortLabel(comps[0].label)
      : comps.map((c) => shortLabel(c.label)).join(' + ');
    const center = resolved.find((c) => c.lat != null && c.lng != null);

    const { rows } = await adminPool.query(
      `UPDATE sys_tenants SET territory_lat = $1, territory_lng = $2, territory_radius_km = $3,
         territory_address = $4, territory_components = $5, updated_at = NOW()
       WHERE id = $6 RETURNING id, name, territory_lat, territory_lng, territory_radius_km, territory_address, territory_components`,
      [center?.lat ?? null, center?.lng ?? null, territory_radius_km, combinedLabel, JSON.stringify(comps.map(stripComp)), req.params.tenantId],
    );
    if (rows.length === 0) { error(res, 'Tenant not found', 'NOT_FOUND', 404); return; }
    success(res, {
      ...rows[0],
      hexagons: tiling.hexagons.length,
      resolution: tiling.resolution,
      complete: tiling.complete,
      hasBoundary: tiling.hasBoundary,
      componentCount: tiling.componentCount,
    });
  } catch (err: any) { error(res, err.message || 'Failed to update territory', 'INTERNAL_ERROR', 500); }
});

/** Store a component without its (large) geometry — the list is the contract definition. */
function stripComp(c: { id?: string; label: string; kind?: string; lat?: number; lng?: number }) {
  return { id: c.id ?? null, label: c.label, kind: c.kind ?? null, lat: c.lat ?? null, lng: c.lng ?? null };
}

/** First 2 comma-parts of a long display name, for a compact label. */
function shortLabel(label: string): string {
  return (label || '').split(',').slice(0, 2).join(',').trim();
}

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

// GET /api/v1/prospects/categories — List all category mappings
prospectsRouter.get('/categories', requirePermission('settings:*'), async (req: Request, res: Response) => {
  try {
    const includeInactive = req.query.include_inactive === 'true';
    const where = includeInactive ? '' : 'WHERE active = true';
    const { rows } = await adminPool.query(`SELECT * FROM prp_category_mappings ${where} ORDER BY display_order`);
    success(res, rows);
  } catch (err: any) { error(res, 'Failed to list categories', 'INTERNAL_ERROR', 500); }
});

// POST /api/v1/prospects/categories — Add a category mapping
prospectsRouter.post('/categories', requirePermission('*:*'), async (req: Request, res: Response) => {
  try {
    const { ui_category_name, google_search_strings, api_exclusion_types } = req.body;
    if (!ui_category_name || !google_search_strings || google_search_strings.length === 0) {
      error(res, 'ui_category_name and google_search_strings required', 'VALIDATION_ERROR', 400); return;
    }
    const { rows } = await adminPool.query(
      `INSERT INTO prp_category_mappings (ui_category_name, google_search_strings, api_exclusion_types)
       VALUES ($1, $2, $3) RETURNING *`,
      [ui_category_name, google_search_strings, api_exclusion_types || []],
    );
    success(res, rows[0], undefined, 201);
  } catch (err: any) { error(res, 'Failed to add category', 'INTERNAL_ERROR', 500); }
});

// PUT /api/v1/prospects/categories/:id — Update a category mapping
prospectsRouter.put('/categories/:id', requirePermission('*:*'), async (req: Request, res: Response) => {
  try {
    const { ui_category_name, google_search_strings, api_exclusion_types, active } = req.body;
    const fields: string[] = [];
    const params: any[] = [];
    let idx = 1;
    if (ui_category_name !== undefined) { fields.push(`ui_category_name = $${idx++}`); params.push(ui_category_name); }
    if (google_search_strings !== undefined) { fields.push(`google_search_strings = $${idx++}`); params.push(google_search_strings); }
    if (api_exclusion_types !== undefined) { fields.push(`api_exclusion_types = $${idx++}`); params.push(api_exclusion_types); }
    if (active !== undefined) { fields.push(`active = $${idx++}`); params.push(active); }
    if (fields.length === 0) { error(res, 'Nothing to update', 'VALIDATION_ERROR', 400); return; }
    params.push(req.params.id);
    const { rows } = await adminPool.query(
      `UPDATE prp_category_mappings SET ${fields.join(', ')} WHERE id = $${idx} RETURNING *`, params,
    );
    if (rows.length === 0) { error(res, 'Category not found', 'NOT_FOUND', 404); return; }
    success(res, rows[0]);
  } catch (err: any) { error(res, 'Failed to update category', 'INTERNAL_ERROR', 500); }
});

// DELETE /api/v1/prospects/categories/:id — Delete a category mapping
prospectsRouter.delete('/categories/:id', requirePermission('*:*'), async (req: Request, res: Response) => {
  try {
    await adminPool.query('DELETE FROM prp_category_mappings WHERE id = $1', [req.params.id]);
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

    const { rows } = await adminPool.query(
      `SELECT * FROM prp_prospects WHERE ${where} ORDER BY created_at DESC`,
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

// ============================================================
// Prospect GENERATION — SYSTEM ADMIN ONLY, per tenant (requirePermission '*:*').
// Generation incurs Google Places cost, so it is NOT tenant-triggerable. A system
// admin runs it for a chosen tenant (by :tenantId) when defining that tenant; the
// tenant only VIEWS the resulting list. Mirrors the territories/:tenantId pattern.
// ============================================================

// GET /api/v1/prospects/:tenantId/generate/preview — Preview the search plan.
prospectsRouter.get('/:tenantId/generate/preview', requirePermission('*:*'), async (req: Request, res: Response) => {
  try {
    const categoryIds = req.query.category_ids ? String(req.query.category_ids).split(',') : null;
    const { previewProspectPlan } = await import('../services/prospect-generation.service');
    success(res, await previewProspectPlan(req.params.tenantId, categoryIds));
  } catch (err: any) { error(res, 'Failed to preview prospect plan', 'INTERNAL_ERROR', 500); }
});

// POST /api/v1/prospects/:tenantId/generate — Generate/refresh a tenant's prospect list.
prospectsRouter.post('/:tenantId/generate', requirePermission('*:*'), async (req: Request, res: Response) => {
  try {
    const categoryIds = req.body?.category_ids || null;
    const { generateProspectsForTenant } = await import('../services/prospect-generation.service');
    const result = await generateProspectsForTenant(req.params.tenantId, categoryIds);
    success(res, result);
  } catch (err: any) {
    if (err?.name === 'NoTerritoryError' || err?.name === 'NoCategoriesError') { error(res, err.message, 'VALIDATION_ERROR', 400); return; }
    if (err.message?.includes('GOOGLE_PLACES_API_KEY')) { error(res, 'Google Places API key not configured.', 'CONFIGURATION_ERROR', 500); return; }
    error(res, `Failed to generate prospects: ${err.message}`, 'INTERNAL_ERROR', 500);
  }
});

// (Legacy tenant-scoped generate/preview routes were removed — generation is now
//  system-admin-only via /:tenantId/generate above, implemented in
//  services/prospect-generation.service.ts.)

// ============================================================
// SYSTEM-ADMIN per-tenant prospect VIEW/MANAGE (requirePermission '*:*').
// Lets a system admin see and manage a specific tenant's prospects (the same
// list/detail the tenant sees) without being that tenant. Mirrors the JWT-scoped
// tenant routes below, but takes :tenantId from the URL. These 2–3 segment paths
// are registered before the 1-segment tenant routes and never shadow them.
// ============================================================

// GET /api/v1/prospects/:tenantId/territory-info — a tenant's territory info.
prospectsRouter.get('/:tenantId/territory-info', requirePermission('*:*'), async (req: Request, res: Response) => {
  try {
    const { rows } = await adminPool.query(
      'SELECT territory_address, territory_radius_km, territory_lat, territory_lng FROM sys_tenants WHERE id = $1',
      [req.params.tenantId],
    );
    success(res, rows[0] || null);
  } catch (err: any) { error(res, 'Failed to get territory info', 'INTERNAL_ERROR', 500); }
});

// GET /api/v1/prospects/:tenantId/prospects — list a tenant's prospects (+ filters).
prospectsRouter.get('/:tenantId/prospects', requirePermission('*:*'), async (req: Request, res: Response) => {
  try {
    const conditions = ['tenant_id = $1'];
    const params: any[] = [req.params.tenantId];
    let idx = 2;
    const showDismissed = req.query.show_dismissed === 'true';
    if (!showDismissed) {
      conditions.push(`status != 'dismissed'`);
      conditions.push('is_active = true');
    }
    if (req.query.status) { conditions.push(`status = $${idx++}`); params.push(req.query.status); }
    if (req.query.category) { conditions.push(`category = $${idx++}`); params.push(req.query.category); }
    if (req.query.search) { conditions.push(`(name ILIKE $${idx} OR address ILIKE $${idx})`); params.push(`%${req.query.search}%`); idx++; }
    const { rows } = await adminPool.query(
      `SELECT * FROM prp_prospects WHERE ${conditions.join(' AND ')} ORDER BY created_at DESC`, params,
    );
    success(res, rows);
  } catch (err: any) { error(res, 'Failed to list prospects', 'INTERNAL_ERROR', 500); }
});

// POST /api/v1/prospects/:tenantId/prospects — manually add a prospect for a tenant.
prospectsRouter.post('/:tenantId/prospects', requirePermission('*:*'), async (req: Request, res: Response) => {
  try {
    const { name, address, phone, website, category, notes } = req.body;
    if (!name) { error(res, 'name required', 'VALIDATION_ERROR', 400); return; }
    const { rows } = await adminPool.query(
      `INSERT INTO prp_prospects (tenant_id, name, address, phone, website, category, notes, source)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 'manual') RETURNING *`,
      [req.params.tenantId, name, address || null, phone || null, website || null, category || null, notes || null],
    );
    success(res, rows[0], undefined, 201);
  } catch (err: any) { error(res, 'Failed to add prospect', 'INTERNAL_ERROR', 500); }
});

// PUT /api/v1/prospects/:tenantId/prospects/:id — update a tenant's prospect (status/notes).
prospectsRouter.put('/:tenantId/prospects/:id', requirePermission('*:*'), async (req: Request, res: Response) => {
  try {
    const { status, notes } = req.body;
    const fields: string[] = [];
    const params: any[] = [];
    let idx = 1;
    if (status !== undefined) { fields.push(`status = $${idx++}`); params.push(status); fields.push(`last_status_change = NOW()`); }
    if (notes !== undefined) { fields.push(`notes = $${idx++}`); params.push(notes); }
    fields.push('updated_at = NOW()');
    if (params.length === 0) { error(res, 'Nothing to update', 'VALIDATION_ERROR', 400); return; }
    params.push(req.params.id, req.params.tenantId);
    const { rows } = await adminPool.query(
      `UPDATE prp_prospects SET ${fields.join(', ')} WHERE id = $${idx++} AND tenant_id = $${idx} RETURNING *`, params,
    );
    if (rows.length === 0) { error(res, 'Prospect not found', 'NOT_FOUND', 404); return; }
    success(res, rows[0]);
  } catch (err: any) { error(res, 'Failed to update prospect', 'INTERNAL_ERROR', 500); }
});

// PUT /api/v1/prospects/:tenantId/prospects/:id/dismiss — dismiss a tenant's prospect.
prospectsRouter.put('/:tenantId/prospects/:id/dismiss', requirePermission('*:*'), async (req: Request, res: Response) => {
  try {
    const { rows } = await adminPool.query(
      `UPDATE prp_prospects SET status = 'dismissed', last_status_change = NOW(), updated_at = NOW()
       WHERE id = $1 AND tenant_id = $2 RETURNING *`,
      [req.params.id, req.params.tenantId],
    );
    if (rows.length === 0) { error(res, 'Prospect not found', 'NOT_FOUND', 404); return; }
    success(res, rows[0]);
  } catch (err: any) { error(res, 'Failed to dismiss prospect', 'INTERNAL_ERROR', 500); }
});

/** Build the prospect CSV for a tenant (optional status/category filters). */
async function buildProspectsCsv(tenantId: string, status?: string, category?: string): Promise<string> {
  const conditions = ['tenant_id = $1', 'is_active = true'];
  const params: any[] = [tenantId];
  let idx = 2;
  if (status) { conditions.push(`status = $${idx++}`); params.push(status); }
  if (category) { conditions.push(`category = $${idx++}`); params.push(category); }
  const { rows } = await adminPool.query(
    `SELECT name, address, phone, website, category, rating, review_count, status, notes, source, created_at
     FROM prp_prospects WHERE ${conditions.join(' AND ')} ORDER BY name`,
    params,
  );
  const headers = ['Name', 'Address', 'Phone', 'Website', 'Category', 'Rating', 'Reviews', 'Status', 'Notes', 'Source', 'Date Added'];
  const lines = [headers.join(',')];
  for (const row of rows) {
    lines.push([
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
  return lines.join('\n');
}

// GET /api/v1/prospects/export — Export the current tenant's prospects as CSV.
prospectsRouter.get('/export', requirePermission('settings:*'), async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthenticatedRequest;
    if (!authReq.tenantId) { error(res, 'Tenant context required', 'VALIDATION_ERROR', 400); return; }
    const csv = await buildProspectsCsv(authReq.tenantId, req.query.status as string | undefined, req.query.category as string | undefined);
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="prospects.csv"');
    res.send(csv);
  } catch (err: any) { error(res, 'Failed to export prospects', 'INTERNAL_ERROR', 500); }
});

// GET /api/v1/prospects/:tenantId/prospects/export — SYSTEM ADMIN: export a tenant's prospects.
prospectsRouter.get('/:tenantId/prospects/export', requirePermission('*:*'), async (req: Request, res: Response) => {
  try {
    const csv = await buildProspectsCsv(req.params.tenantId, req.query.status as string | undefined, req.query.category as string | undefined);
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="prospects.csv"');
    res.send(csv);
  } catch (err: any) { error(res, 'Failed to export prospects', 'INTERNAL_ERROR', 500); }
});
