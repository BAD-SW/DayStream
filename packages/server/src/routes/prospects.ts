import { Router, Request, Response } from 'express';
import Joi from 'joi';
import { validate } from '../middleware/validate';
import { authenticate, AuthenticatedRequest } from '../auth/middleware';
import { requirePermission, requireTenantLevel } from '../auth/permissions';
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
    const { tileTerritoryComplete, geojsonToH3Rings, populationForHexes, areaKm2ForHexes, overlapSummary } = await import('../services/h3-territory.service');

    const found = await resolveTerritoryCandidates(query);

    // Build a preview per candidate: tile its boundary completely and report the hex count /
    // resolution / completeness + population estimate + density (people/km²) + whether it
    // overlaps another tenant's territory, so the UI can show the trade-off. Drop 0-cell areas.
    const candidates = (await Promise.all(
      found.map(async (c) => {
        const rings = geojsonToH3Rings(c.geojson);
        const tiling = tileTerritoryComplete(rings, c.viewport ?? null, c.lat, c.lng);
        const population = await populationForHexes(tiling.hexagons);
        const areaKm2 = areaKm2ForHexes(tiling.hexagons);
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
          population,
          areaKm2: Math.round(areaKm2),
          density: population != null && areaKm2 > 0 ? Math.round((population / areaKm2) * 10) / 10 : null,
          overlap: await overlapSummary(req.params.tenantId, tiling.hexagons),
        };
      }),
    )).filter((c) => c.hexCount > 0);

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
          population: await populationForHexes(tiling.hexagons),
          areaKm2: Math.round(areaKm2ForHexes(tiling.hexagons)),
          density: null,
          overlap: await overlapSummary(req.params.tenantId, tiling.hexagons),
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
      `SELECT id, name, territory_lat, territory_lng, territory_address, territory_components, territory_population
       FROM sys_tenants WHERE id = $1`,
      [req.params.tenantId],
    );
    if (rows.length === 0) { error(res, 'Tenant not found', 'NOT_FOUND', 404); return; }
    const { rows: hexCount } = await adminPool.query(
      `SELECT COUNT(*)::int AS n FROM prp_tenant_territories WHERE tenant_id = $1`, [req.params.tenantId],
    );
    success(res, { ...rows[0], hexagons: hexCount[0]?.n ?? 0 });
  } catch (err: any) { console.error('Failed to read territory', err?.message || err); error(res, 'Failed to read territory', 'INTERNAL_ERROR', 500); }
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
    const { tileTerritoryComplete, geojsonToH3Rings, populationForHexes, areaKm2ForHexes, overlapSummary } = await import('../services/h3-territory.service');

    const refs = components.map((c) => c.id).filter((id): id is string => !!id && id !== 'viewport');
    const boundaryMap = refs.length > 0 ? await lookupTerritoryBoundaries(refs) : new Map();

    const hydrated = await Promise.all(components.map(async (c) => {
      const b = c.id ? boundaryMap.get(c.id) : undefined;
      const geojson = b?.geojson ?? null;
      const rings = geojson ? geojsonToH3Rings(geojson) : null;
      const tiling = tileTerritoryComplete(rings, null, c.lat ?? b?.lat, c.lng ?? b?.lng);
      const population = await populationForHexes(tiling.hexagons);
      const areaKm2 = areaKm2ForHexes(tiling.hexagons);
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
        population,
        areaKm2: Math.round(areaKm2),
        density: population != null && areaKm2 > 0 ? Math.round((population / areaKm2) * 10) / 10 : null,
        overlap: await overlapSummary(req.params.tenantId, tiling.hexagons),
      };
    }));
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
      tileTerritoryComplete, tileManyComplete, saveTerritoryHexagons, geojsonToH3Rings, populationForHexes, areaKm2ForHexes,
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
        const population = await populationForHexes(tiling.hexagons);
        const storedComps = comps.map((c) => stripComp({ ...c, population }));
        const { rows: r0 } = await adminPool.query(
          `UPDATE sys_tenants SET territory_lat = $1, territory_lng = $2, territory_radius_km = $3,
             territory_address = $4, territory_components = $5, territory_population = $6, updated_at = NOW()
           WHERE id = $7 RETURNING id, name, territory_lat, territory_lng, territory_radius_km, territory_address, territory_components, territory_population`,
          [geo.lat, geo.lng, territory_radius_km, location, JSON.stringify(storedComps), population, req.params.tenantId],
        );
        if (r0.length === 0) { error(res, 'Tenant not found', 'NOT_FOUND', 404); return; }
        success(res, { ...r0[0], hexagons: tiling.hexagons.length, resolution: tiling.resolution, complete: tiling.complete, hasBoundary: tiling.hasBoundary, population });
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

    // Per-component population: tile each area on its own (at the union's resolution) and sum
    // its hexes' population. The TERRITORY total is summed over the UNION hexes (so overlapping
    // areas aren't double-counted), which is why it can be < the sum of per-area figures.
    const perComponentPop = await Promise.all(resolved.map(async (c) => {
      if (!c.rings && c.centerLat == null) return null;
      const t = tileTerritoryComplete(c.rings, null, c.centerLat, c.centerLng);
      return populationForHexes(t.hexagons);
    }));
    const territoryPopulation = await populationForHexes(tiling.hexagons);
    const territoryAreaKm2 = areaKm2ForHexes(tiling.hexagons);
    const territoryDensity = territoryPopulation != null && territoryAreaKm2 > 0
      ? Math.round((territoryPopulation / territoryAreaKm2) * 10) / 10 : null;

    // A combined human/contract label + the stored component list (geometry stripped, population kept).
    const combinedLabel = comps.length === 1
      ? shortLabel(comps[0].label)
      : comps.map((c) => shortLabel(c.label)).join(' + ');
    const center = resolved.find((c) => c.lat != null && c.lng != null);
    const storedComps = comps.map((c, i) => stripComp({ ...c, population: perComponentPop[i] ?? null }));

    const { rows } = await adminPool.query(
      `UPDATE sys_tenants SET territory_lat = $1, territory_lng = $2, territory_radius_km = $3,
         territory_address = $4, territory_components = $5, territory_population = $6, updated_at = NOW()
       WHERE id = $7 RETURNING id, name, territory_lat, territory_lng, territory_radius_km, territory_address, territory_components, territory_population`,
      [center?.lat ?? null, center?.lng ?? null, territory_radius_km, combinedLabel, JSON.stringify(storedComps), territoryPopulation, req.params.tenantId],
    );
    if (rows.length === 0) { error(res, 'Tenant not found', 'NOT_FOUND', 404); return; }
    success(res, {
      ...rows[0],
      hexagons: tiling.hexagons.length,
      resolution: tiling.resolution,
      complete: tiling.complete,
      hasBoundary: tiling.hasBoundary,
      componentCount: tiling.componentCount,
      population: territoryPopulation,
      areaKm2: Math.round(territoryAreaKm2),
      density: territoryDensity,
    });
  } catch (err: any) { error(res, err.message || 'Failed to update territory', 'INTERNAL_ERROR', 500); }
});

/** Store a component without its (large) geometry — the list is the contract definition.
 *  Carries a population estimate (modeled, may be null when unknown) for sizing/valuation. */
function stripComp(c: { id?: string; label: string; kind?: string; lat?: number; lng?: number; population?: number | null }) {
  return { id: c.id ?? null, label: c.label, kind: c.kind ?? null, lat: c.lat ?? null, lng: c.lng ?? null, population: c.population ?? null };
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
  } catch (err: any) { console.error('Failed to list territories', err?.message || err); error(res, 'Failed to list territories', 'INTERNAL_ERROR', 500); }
});

// ============================================================
// Prospect Categories (System Admin)
// ============================================================

// GET /api/v1/prospects/categories — List all category mappings
prospectsRouter.get('/categories', requireTenantLevel(), requirePermission('settings:*'), async (req: Request, res: Response) => {
  try {
    const includeInactive = req.query.include_inactive === 'true';
    const where = includeInactive ? '' : 'WHERE active = true';
    const { rows } = await adminPool.query(`SELECT * FROM prp_category_mappings ${where} ORDER BY display_order`);
    success(res, rows);
  } catch (err: any) { console.error('Failed to list categories', err?.message || err); error(res, 'Failed to list categories', 'INTERNAL_ERROR', 500); }
});

// POST /api/v1/prospects/categories — Add a category mapping
prospectsRouter.post('/categories', requirePermission('*:*'), async (req: Request, res: Response) => {
  try {
    const { ui_category_name, google_search_strings, api_exclusion_types, overture_taxonomy } = req.body;
    if (!ui_category_name || !google_search_strings || google_search_strings.length === 0) {
      error(res, 'ui_category_name and google_search_strings required', 'VALIDATION_ERROR', 400); return;
    }
    const { rows } = await adminPool.query(
      `INSERT INTO prp_category_mappings (ui_category_name, google_search_strings, api_exclusion_types, overture_taxonomy)
       VALUES ($1, $2, $3, $4) RETURNING *`,
      [ui_category_name, google_search_strings, api_exclusion_types || [], overture_taxonomy || []],
    );
    success(res, rows[0], undefined, 201);
  } catch (err: any) { console.error('Failed to add category', err?.message || err); error(res, 'Failed to add category', 'INTERNAL_ERROR', 500); }
});

// PUT /api/v1/prospects/categories/:id — Update a category mapping
prospectsRouter.put('/categories/:id', requirePermission('*:*'), async (req: Request, res: Response) => {
  try {
    const { ui_category_name, google_search_strings, api_exclusion_types, overture_taxonomy, active } = req.body;
    const fields: string[] = [];
    const params: any[] = [];
    let idx = 1;
    if (ui_category_name !== undefined) { fields.push(`ui_category_name = $${idx++}`); params.push(ui_category_name); }
    if (google_search_strings !== undefined) { fields.push(`google_search_strings = $${idx++}`); params.push(google_search_strings); }
    if (api_exclusion_types !== undefined) { fields.push(`api_exclusion_types = $${idx++}`); params.push(api_exclusion_types); }
    if (overture_taxonomy !== undefined) { fields.push(`overture_taxonomy = $${idx++}`); params.push(overture_taxonomy); }
    if (active !== undefined) { fields.push(`active = $${idx++}`); params.push(active); }
    if (fields.length === 0) { error(res, 'Nothing to update', 'VALIDATION_ERROR', 400); return; }
    params.push(req.params.id);
    const { rows } = await adminPool.query(
      `UPDATE prp_category_mappings SET ${fields.join(', ')} WHERE id = $${idx} RETURNING *`, params,
    );
    if (rows.length === 0) { error(res, 'Category not found', 'NOT_FOUND', 404); return; }
    success(res, rows[0]);
  } catch (err: any) { console.error('Failed to update category', err?.message || err); error(res, 'Failed to update category', 'INTERNAL_ERROR', 500); }
});

// DELETE /api/v1/prospects/categories/:id — Delete a category mapping
prospectsRouter.delete('/categories/:id', requirePermission('*:*'), async (req: Request, res: Response) => {
  try {
    await adminPool.query('DELETE FROM prp_category_mappings WHERE id = $1', [req.params.id]);
    success(res, { deleted: true });
  } catch (err: any) { console.error('Failed to delete category', err?.message || err); error(res, 'Failed to delete category', 'INTERNAL_ERROR', 500); }
});

// GET /api/v1/prospects/overture-taxonomy — The full Overture taxonomy catalog (the ~2.2k
// categories with hierarchy) used to drive the category tag picker. Served from a committed
// data asset extracted from the Overture release we query, so the picker's options are valid
// by construction (no free-typing). Cached in memory after first read.
let overtureTaxonomyCache: any = null;
prospectsRouter.get('/overture-taxonomy', requirePermission('*:*'), async (_req: Request, res: Response) => {
  try {
    if (!overtureTaxonomyCache) {
      const { readFileSync } = await import('fs');
      const path = await import('path');
      const file = path.join(__dirname, '..', 'data', 'overture-taxonomy.json');
      overtureTaxonomyCache = JSON.parse(readFileSync(file, 'utf8'));
    }
    success(res, overtureTaxonomyCache);
  } catch (err: any) { console.error('Failed to load Overture taxonomy', err?.message || err); error(res, 'Failed to load Overture taxonomy', 'INTERNAL_ERROR', 500); }
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
  } catch (err: any) { console.error('Failed to get maps key', err?.message || err); error(res, 'Failed to get maps key', 'INTERNAL_ERROR', 500); }
});

// GET /api/v1/prospects/usage — Authoritative Google Places/Maps API usage for the
// current billing month, read from Google Cloud Monitoring (system-admin only).
// Degrades gracefully: returns { status: 'not_configured' | 'error' } rather than
// failing when the Google Cloud service-account credential is absent or unreadable.
prospectsRouter.get('/usage', requirePermission('*:*'), async (req: Request, res: Response) => {
  try {
    const { getPlacesUsage } = await import('../services/google-cloud-usage.service');
    const force = req.query.refresh === 'true';
    const usage = await getPlacesUsage(force);
    success(res, usage);
  } catch (err: any) {
    console.error('Failed to get Places usage', err?.message || err);
    // Still return a graceful shape so the UI can show a degraded state rather than crash.
    success(res, { status: 'error', message: 'Could not read usage.' });
  }
});

// GET /api/v1/prospects/territory-info — Get current tenant's territory info
prospectsRouter.get('/territory-info', requireTenantLevel(), requirePermission('settings:*'), async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthenticatedRequest;
    const tenantId = authReq.tenantId;
    if (!tenantId) { error(res, 'Tenant context required', 'VALIDATION_ERROR', 400); return; }
    const { rows } = await adminPool.query(
      'SELECT territory_address, territory_radius_km, territory_lat, territory_lng FROM sys_tenants WHERE id = $1',
      [tenantId],
    );
    success(res, rows[0] || null);
  } catch (err: any) { console.error('Failed to get territory info', err?.message || err); error(res, 'Failed to get territory info', 'INTERNAL_ERROR', 500); }
});

// GET /api/v1/prospects — List prospects for the current tenant
prospectsRouter.get('/', requireTenantLevel(), requirePermission('settings:*'), async (req: Request, res: Response) => {
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
    // Held prospects (filtered out by the confidence/contact classification) are retained in
    // the DB but hidden from the working list unless explicitly requested — so the contact
    // filter visibly shrinks the list. 'held' is reversible, never a delete.
    const showHeld = req.query.show_held === 'true';
    if (!showHeld) conditions.push(`inclusion = 'included'`);
    if (req.query.status) { conditions.push(`status = $${idx++}`); params.push(req.query.status); }
    if (req.query.category) { conditions.push(`category = $${idx++}`); params.push(req.query.category); }
    if (req.query.search) { conditions.push(`(name ILIKE $${idx} OR address ILIKE $${idx})`); params.push(`%${req.query.search}%`); idx++; }

    const where = conditions.join(' AND ');

    const { rows } = await adminPool.query(
      `SELECT * FROM prp_prospects WHERE ${where} ORDER BY created_at DESC`,
      params,
    );
    success(res, rows);
  } catch (err: any) { console.error('Failed to list prospects', err?.message || err); error(res, 'Failed to list prospects', 'INTERNAL_ERROR', 500); }
});

// POST /api/v1/prospects — Manually add a prospect
prospectsRouter.post('/', requireTenantLevel(), requirePermission('settings:*'), async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthenticatedRequest;
    const tenantId = authReq.tenantId;
    if (!tenantId) { error(res, 'Tenant context required', 'VALIDATION_ERROR', 400); return; }

    const { name, address, phone, website, category, notes } = req.body;
    if (!name) { error(res, 'name required', 'VALIDATION_ERROR', 400); return; }

    // Same name at the same address (ignoring case and spacing) is the same business.
    const { rows: same } = await adminPool.query(
      `SELECT id, name FROM prp_prospects
        WHERE tenant_id = $1
          AND LOWER(BTRIM(name)) = LOWER(BTRIM($2))
          AND LOWER(BTRIM(COALESCE(address, ''))) = LOWER(BTRIM(COALESCE($3, '')))
        LIMIT 1`,
      [tenantId, name, address || ''],
    );
    if (same[0]) {
      res.status(409).json({ error: 'This business is already in your prospect list', code: 'DUPLICATE_PROSPECT', details: { existing_id: same[0].id } });
      return;
    }

    const { rows } = await adminPool.query(
      `INSERT INTO prp_prospects (tenant_id, name, address, phone, website, category, notes, source)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 'manual') RETURNING *`,
      [tenantId, name, address || null, phone || null, website || null, category || null, notes || null],
    );
    success(res, rows[0], undefined, 201);
  } catch (err: any) { console.error('Failed to add prospect', err?.message || err); error(res, 'Failed to add prospect', 'INTERNAL_ERROR', 500); }
});

// PUT /api/v1/prospects/:id — Update prospect (status, notes)
prospectsRouter.put('/:id', requireTenantLevel(), requirePermission('settings:*'), async (req: Request, res: Response) => {
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
  } catch (err: any) { console.error('Failed to update prospect', err?.message || err); error(res, 'Failed to update prospect', 'INTERNAL_ERROR', 500); }
});

// PUT /api/v1/prospects/:id/dismiss — Dismiss a prospect
prospectsRouter.put('/:id/dismiss', requireTenantLevel(), requirePermission('settings:*'), async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthenticatedRequest;
    const tenantId = authReq.tenantId;
    const { rows } = await adminPool.query(
      `UPDATE prp_prospects SET status = 'dismissed', last_status_change = NOW(), updated_at = NOW() WHERE id = $1 AND tenant_id = $2 RETURNING *`,
      [req.params.id, tenantId],
    );
    if (rows.length === 0) { error(res, 'Prospect not found', 'NOT_FOUND', 404); return; }
    success(res, rows[0]);
  } catch (err: any) { console.error('Failed to dismiss prospect', err?.message || err); error(res, 'Failed to dismiss prospect', 'INTERNAL_ERROR', 500); }
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
  } catch (err: any) { console.error('Failed to preview prospect plan', err?.message || err); error(res, 'Failed to preview prospect plan', 'INTERNAL_ERROR', 500); }
});

// POST /api/v1/prospects/:tenantId/generate — Generate/refresh a tenant's prospect list.
// Starts the run in the BACKGROUND and returns 202 immediately — the Google crawl can
// take a while on dense territories, so the HTTP request must not hold the connection
// open (that was the old "never returns" hang). The client polls .../generate/status.
prospectsRouter.post('/:tenantId/generate', requirePermission('*:*'), async (req: Request, res: Response) => {
  try {
    const categoryIds = req.body?.category_ids || null;

    // Engine selection: Overture (new, free) when the flag is on for this tenant, else the
    // existing Google engine (fallback). Additive rollout — "don't break what works".
    const { isFeatureEnabled } = await import('../services/feature-flag.service');
    const useOverture = await isFeatureEnabled('feature.prospects_overture', { tenantId: req.params.tenantId });

    if (useOverture) {
      const contactFilter = req.body?.contact_filter; // 'all' | 'phone_or_web' | 'phone_and_web'
      const { startOvertureGeneration } = await import('../services/prospect-overture-generation.service');
      const status = await startOvertureGeneration(req.params.tenantId, categoryIds, contactFilter ? { contactFilter } : {});
      success(res, { started: true, engine: 'overture', state: status.state, started_at: status.startedAt }, undefined, 202);
      return;
    }

    const maxApiCalls = Number.isFinite(Number(req.body?.max_api_calls)) && Number(req.body?.max_api_calls) > 0
      ? Math.floor(Number(req.body.max_api_calls)) : undefined;
    const { startProspectGeneration } = await import('../services/prospect-generation.service');
    const status = await startProspectGeneration(req.params.tenantId, categoryIds, maxApiCalls ? { maxApiCalls } : {});
    // 202 Accepted — work continues in the background; poll the status endpoint.
    success(res, { started: true, engine: 'google', state: status.state, started_at: status.startedAt }, undefined, 202);
  } catch (err: any) {
    if (err?.name === 'NoTerritoryError' || err?.name === 'NoCategoriesError') { error(res, err.message, 'VALIDATION_ERROR', 400); return; }
    if (err.message?.includes('GOOGLE_PLACES_API_KEY')) { error(res, 'Google Places API key not configured.', 'CONFIGURATION_ERROR', 500); return; }
    error(res, `Failed to start generation: ${err.message}`, 'INTERNAL_ERROR', 500);
  }
});

// GET /api/v1/prospects/:tenantId/generate/status — poll the background run's progress.
prospectsRouter.get('/:tenantId/generate/status', requirePermission('*:*'), async (req: Request, res: Response) => {
  try {
    const { getGenerationStatus } = await import('../services/prospect-generation.service');
    const status = getGenerationStatus(req.params.tenantId);
    success(res, status || { state: 'idle' });
  } catch (err: any) { console.error('Failed to get generation status', err?.message || err); error(res, 'Failed to get generation status', 'INTERNAL_ERROR', 500); }
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
  } catch (err: any) { console.error('Failed to get territory info', err?.message || err); error(res, 'Failed to get territory info', 'INTERNAL_ERROR', 500); }
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
    // Hide held (classification-filtered) prospects unless explicitly requested. See the
    // tenant-own list route above for the rationale.
    const showHeld = req.query.show_held === 'true';
    if (!showHeld) conditions.push(`inclusion = 'included'`);
    if (req.query.status) { conditions.push(`status = $${idx++}`); params.push(req.query.status); }
    if (req.query.category) { conditions.push(`category = $${idx++}`); params.push(req.query.category); }
    if (req.query.search) { conditions.push(`(name ILIKE $${idx} OR address ILIKE $${idx})`); params.push(`%${req.query.search}%`); idx++; }
    const { rows } = await adminPool.query(
      `SELECT * FROM prp_prospects WHERE ${conditions.join(' AND ')} ORDER BY created_at DESC`, params,
    );
    success(res, rows);
  } catch (err: any) { console.error('Failed to list prospects', err?.message || err); error(res, 'Failed to list prospects', 'INTERNAL_ERROR', 500); }
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
  } catch (err: any) { console.error('Failed to add prospect', err?.message || err); error(res, 'Failed to add prospect', 'INTERNAL_ERROR', 500); }
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
  } catch (err: any) { console.error('Failed to update prospect', err?.message || err); error(res, 'Failed to update prospect', 'INTERNAL_ERROR', 500); }
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
  } catch (err: any) { console.error('Failed to dismiss prospect', err?.message || err); error(res, 'Failed to dismiss prospect', 'INTERNAL_ERROR', 500); }
});

// DELETE /api/v1/prospects/:tenantId/prospects — SYSTEM ADMIN: hard-delete ALL prospects for
// a tenant, regardless of status/source/active flag. This is a destructive reset (e.g. before
// re-running a territory from scratch), distinct from the per-prospect soft "dismiss". It
// permanently removes rows — there is no undo. System-admin only.
prospectsRouter.delete('/:tenantId/prospects', requirePermission('*:*'), async (req: Request, res: Response) => {
  try {
    const { rowCount } = await adminPool.query(
      'DELETE FROM prp_prospects WHERE tenant_id = $1',
      [req.params.tenantId],
    );
    logger.info(`[Prospects] System admin hard-deleted ${rowCount ?? 0} prospect(s) for tenant ${req.params.tenantId}`);
    success(res, { deleted: rowCount ?? 0 });
  } catch (err: any) { console.error('Failed to clear prospects', err?.message || err); error(res, 'Failed to clear prospects', 'INTERNAL_ERROR', 500); }
});

/** Build the prospect CSV for a tenant (optional status/category filters). Excludes held
 *  prospects by default so the export matches the working list; pass showHeld to include them. */
async function buildProspectsCsv(tenantId: string, status?: string, category?: string, showHeld = false): Promise<string> {
  const conditions = ['tenant_id = $1', 'is_active = true'];
  const params: any[] = [tenantId];
  let idx = 2;
  if (!showHeld) conditions.push(`inclusion = 'included'`);
  if (status) { conditions.push(`status = $${idx++}`); params.push(status); }
  if (category) { conditions.push(`category = $${idx++}`); params.push(category); }
  const { rows } = await adminPool.query(
    `SELECT name, address, city, country, phone, email, website, category,
            confidence, fit_score, fit_tier, operating_status, inclusion, hold_reason,
            status, notes, source, created_at
     FROM prp_prospects WHERE ${conditions.join(' AND ')} ORDER BY name`,
    params,
  );
  // Columns reflect what the data actually carries. Rating/Reviews were dropped — they came
  // from Google Places only (Overture has no rating/review fields), so they were always blank
  // for Overture rows. Added City/Country/Email, the DayStream signals (Confidence, Fit Score,
  // Fit Tier), and the Overture open/closed + inclusion state.
  const q = (v: any) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const headers = ['Name', 'Address', 'City', 'Country', 'Phone', 'Email', 'Website', 'Category',
    'Confidence', 'Fit Score', 'Fit Tier', 'Operating Status', 'Inclusion', 'Hold Reason',
    'Status', 'Notes', 'Source', 'Date Added'];
  const lines = [headers.join(',')];
  for (const row of rows) {
    lines.push([
      q(row.name),
      q(row.address),
      q(row.city),
      q(row.country),
      q(row.phone),
      q(row.email),
      q(row.website),
      q(row.category),
      row.confidence != null ? Number(row.confidence).toFixed(3) : '',
      row.fit_score ?? '',
      q(row.fit_tier),
      q(row.operating_status),
      q(row.inclusion),
      q(row.hold_reason),
      q(row.status),
      q(row.notes),
      q(row.source),
      new Date(row.created_at).toISOString().split('T')[0],
    ].join(','));
  }
  return lines.join('\n');
}

// GET /api/v1/prospects/export — Export the current tenant's prospects as CSV.
prospectsRouter.get('/export', requireTenantLevel(), requirePermission('settings:*'), async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthenticatedRequest;
    if (!authReq.tenantId) { error(res, 'Tenant context required', 'VALIDATION_ERROR', 400); return; }
    const csv = await buildProspectsCsv(authReq.tenantId, req.query.status as string | undefined, req.query.category as string | undefined, req.query.show_held === 'true');
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="prospects.csv"');
    res.send(csv);
  } catch (err: any) { console.error('Failed to export prospects', err?.message || err); error(res, 'Failed to export prospects', 'INTERNAL_ERROR', 500); }
});

// GET /api/v1/prospects/:tenantId/prospects/export — SYSTEM ADMIN: export a tenant's prospects.
prospectsRouter.get('/:tenantId/prospects/export', requirePermission('*:*'), async (req: Request, res: Response) => {
  try {
    const csv = await buildProspectsCsv(req.params.tenantId, req.query.status as string | undefined, req.query.category as string | undefined, req.query.show_held === 'true');
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="prospects.csv"');
    res.send(csv);
  } catch (err: any) { console.error('Failed to export prospects', err?.message || err); error(res, 'Failed to export prospects', 'INTERNAL_ERROR', 500); }
});
