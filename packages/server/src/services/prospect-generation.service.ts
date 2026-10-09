import { adminPool } from '../db/pool';
import { logger } from '../middleware/logger';
import { getSearchCoordinates } from './h3-territory.service';
import { searchCellRecursive } from './google-places.service';
import * as h3 from 'h3-js';

/**
 * Prospect generation service (spec phase 10 / prospects). Generation is the COSTLY
 * operation (Google Places calls), so it is driven BY TENANT ID — a system admin
 * runs it when defining a tenant; the tenant itself only views the results. The
 * engine (recursive density drill-down + territory geo-filter) is unchanged; this
 * just parameterizes it on an explicit tenantId instead of the caller's JWT.
 */

const PAGES_PER_SEARCH = 3;        // Google Text Search returns up to 3 pages (60)
const COST_CENTS_PER_CALL = 3.2;   // Text Search ≈ $32 / 1000 calls

export interface ProspectPlanPreview {
  search_centers: number;
  categories: number;
  parent_resolution: number;
  estimated_api_calls: number;        // back-compat: the minimum
  estimated_cost_usd: string;         // back-compat: the minimum
  estimated_api_calls_min: number;
  estimated_api_calls_max: number;
  estimated_cost_usd_min: string;
  estimated_cost_usd_max: string;
  note: string;
}

/** Preview the search plan (call-count range + cost) for a tenant's territory. */
export async function previewProspectPlan(tenantId: string, categoryIds: string[] | null): Promise<ProspectPlanPreview> {
  const { coordinates, parentResolution } = await getSearchCoordinates(tenantId);

  const catQuery = categoryIds
    ? `SELECT google_search_strings FROM prp_category_mappings WHERE active = true AND id = ANY($1)`
    : `SELECT google_search_strings FROM prp_category_mappings WHERE active = true`;
  const { rows: categoryMappings } = await adminPool.query(catQuery, categoryIds ? [categoryIds] : []);

  const searchCenters = coordinates.length;
  const categoryCount = categoryMappings.length;

  // Drill-down means the real count depends on density → present a range.
  const { rows: hexRows } = await adminPool.query(
    `SELECT COUNT(*)::int AS n FROM prp_tenant_territories WHERE tenant_id = $1 AND is_searchable = true`,
    [tenantId],
  );
  const fineCells = hexRows[0]?.n ?? searchCenters;

  const minCalls = searchCenters * categoryCount * PAGES_PER_SEARCH;
  const maxCalls = fineCells * categoryCount * PAGES_PER_SEARCH;
  const cost = (calls: number) => (calls / 1000 * 32).toFixed(2);

  return {
    search_centers: searchCenters,
    categories: categoryCount,
    parent_resolution: parentResolution,
    estimated_api_calls: minCalls,
    estimated_cost_usd: cost(minCalls),
    estimated_api_calls_min: minCalls,
    estimated_api_calls_max: maxCalls,
    estimated_cost_usd_min: cost(minCalls),
    estimated_cost_usd_max: cost(maxCalls),
    note: 'Dense areas are automatically searched in finer detail (drill-down) to capture the full list, so actual API calls land between the min and max shown.',
  };
}

export interface ProspectGenerationResult {
  total_returned: number;
  new_added: number;
  inactive_marked: number;
  api_calls: number;
}

/** Error thrown when a tenant has no territory assigned yet. */
export class NoTerritoryError extends Error {
  constructor() { super('No territory assigned for this tenant. Assign a territory first.'); this.name = 'NoTerritoryError'; }
}
/** Error thrown when no prospect categories are configured. */
export class NoCategoriesError extends Error {
  constructor() { super('No prospect categories configured.'); this.name = 'NoCategoriesError'; }
}

/**
 * Generate/refresh the prospect list for a tenant from Google Places, using the
 * recursive density drill-down so dense areas return the FULL list (not just the
 * first 60 per cell). Results are geo-filtered to the tenant's territory hexes,
 * upserted, prospects not returned are marked inactive, and the run is logged.
 */
export async function generateProspectsForTenant(
  tenantId: string, categoryIds: string[] | null,
): Promise<ProspectGenerationResult> {
  // Territory must exist.
  const { rows: tenantRows } = await adminPool.query(
    'SELECT territory_address, territory_lat, territory_lng, territory_radius_km FROM sys_tenants WHERE id = $1',
    [tenantId],
  );
  if (tenantRows.length === 0 || !tenantRows[0].territory_address) throw new NoTerritoryError();
  const { territory_address } = tenantRows[0];

  // Categories.
  const catQuery = categoryIds
    ? `SELECT ui_category_name, google_search_strings, api_exclusion_types FROM prp_category_mappings WHERE active = true AND id = ANY($1) ORDER BY display_order`
    : `SELECT ui_category_name, google_search_strings, api_exclusion_types FROM prp_category_mappings WHERE active = true ORDER BY display_order`;
  const { rows: categoryMappings } = await adminPool.query(catQuery, categoryIds ? [categoryIds] : []);
  if (categoryMappings.length === 0) throw new NoCategoriesError();

  const { coordinates: searchCoords } = await getSearchCoordinates(tenantId);
  let newCount = 0;
  let totalApiCalls = 0;
  const returnedPlaceIds: string[] = [];
  const seenPlaceIds = new Set<string>();

  const { rows: terrHexRows } = await adminPool.query(
    'SELECT h3_index FROM prp_tenant_territories WHERE tenant_id = $1', [tenantId],
  );
  const territoryHexSet = new Set(terrHexRows.map((r: any) => r.h3_index));

  logger.info(`[Prospects] Tenant ${tenantId}: ${searchCoords.length} centers × ${categoryMappings.length} categories (recursive drill-down)`);

  for (const catMap of categoryMappings) {
    const exclusions: string[] = catMap.api_exclusion_types || [];
    const keywords: string[] = catMap.google_search_strings || [];
    const optimizedQuery = keywords.join(' OR ');

    const acc = { byId: new Map<string, any>(), apiCalls: 0, cellsSearched: 0, cellsSaturatedAtMaxRes: 0 };
    for (const coord of searchCoords) {
      await searchCellRecursive(coord.parentHex, optimizedQuery, exclusions, territory_address, acc);
    }
    totalApiCalls += acc.apiCalls;
    if (acc.cellsSaturatedAtMaxRes > 0) {
      logger.warn(`[Prospects] ${acc.cellsSaturatedAtMaxRes} cell(s) still saturated at finest resolution for "${catMap.ui_category_name}" — extremely dense.`);
    }

    for (const place of acc.byId.values()) {
      if (seenPlaceIds.has(place.place_id)) continue;
      if (place.lat && place.lng) {
        const placeHex = h3.latLngToCell(place.lat, place.lng, 7);
        if (!territoryHexSet.has(placeHex)) continue; // outside the territory
      }
      seenPlaceIds.add(place.place_id);
      returnedPlaceIds.push(place.place_id);

      await adminPool.query(
        `INSERT INTO prp_prospects (tenant_id, google_place_id, name, address, city, phone, website, category, rating, review_count, lat, lng, source)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, 'api')
         ON CONFLICT (tenant_id, google_place_id) DO UPDATE SET
           name = EXCLUDED.name, address = EXCLUDED.address, city = EXCLUDED.city, phone = EXCLUDED.phone,
           website = EXCLUDED.website, rating = EXCLUDED.rating, review_count = EXCLUDED.review_count,
           lat = EXCLUDED.lat, lng = EXCLUDED.lng,
           is_active = true, updated_at = NOW()`,
        [tenantId, place.place_id, place.name, place.address, place.city || null, place.phone || null, place.website || null, catMap.ui_category_name, place.rating || null, place.review_count || 0, place.lat || null, place.lng || null],
      );
      newCount++;
    }
  }

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

  await adminPool.query(
    `INSERT INTO prp_generation_log (tenant_id, new_count, total_returned, inactive_marked, cost_cents)
     VALUES ($1, $2, $3, $4, $5)`,
    [tenantId, newCount, seenPlaceIds.size, inactiveMarked, Math.ceil(totalApiCalls * COST_CENTS_PER_CALL)],
  );

  logger.info(`[Prospects] Tenant ${tenantId} done: ${seenPlaceIds.size} prospects from ${totalApiCalls} API calls`);
  return { total_returned: seenPlaceIds.size, new_added: newCount, inactive_marked: inactiveMarked, api_calls: totalApiCalls };
}
