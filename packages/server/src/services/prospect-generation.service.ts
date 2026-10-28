import { adminPool } from '../db/pool';
import { logger } from '../middleware/logger';
import { getSearchCoordinates } from './h3-territory.service';
import { searchCellRecursive, DrillAccumulator } from './google-places.service';
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
  /** True when the per-run API-call budget stopped the drill-down early (partial results). */
  truncated: boolean;
}

/** Progress snapshot emitted during a run (for the background-job status endpoint). */
export interface GenerationProgress {
  phase: 'searching' | 'saving' | 'finalizing';
  categories_total: number;
  categories_done: number;
  centers_total: number;
  centers_done: number;
  api_calls: number;
  found: number;
  current_category?: string;
}

export interface GenerateOptions {
  /** Hard ceiling on Google calls for the whole run. Protects cost/time on dense territories. */
  maxApiCalls?: number;
  /** Called as the run progresses (throttled by the caller if needed). */
  onProgress?: (p: GenerationProgress) => void;
}

/**
 * Per-run API-call budget. This is a RUNAWAY SAFETY NET, not an accuracy limiter — a
 * complete prospect list (no missed businesses) is the product's value, so the budget is
 * set high enough that a legitimately dense territory finishes WITHOUT truncation. If a run
 * ever hits this, it's flagged truncated so we can investigate rather than silently drop
 * businesses. ~8,000 keeps a full run within the 10,000/month free Places tier for a single
 * territory while covering deep metro drill-downs.
 */
export const DEFAULT_MAX_API_CALLS = 8000;

/**
 * Top-level search centers are crawled SERIALLY (concurrency 1). The parallelism that
 * matters lives INSIDE the drill-down (DRILL_CONCURRENCY in google-places.service), where
 * the deep 7×-per-level tree is. Keeping centers serial avoids multiplying the two pools
 * (center × drill) into a burst that trips Google's rate limit. Non-saturating centers are
 * ~2.5s each anyway, so serializing them costs little.
 */
export const SEARCH_CONCURRENCY = 1;

/**
 * Run `worker` over `items` with at most `limit` in flight at once. Workers pull from a
 * shared cursor, so a slow item doesn't block others. `shouldStop` lets the caller halt
 * scheduling of NEW items (e.g. once the API-call budget is hit); in-flight items finish.
 */
async function runWithConcurrency<T>(
  items: T[], limit: number, worker: (item: T, index: number) => Promise<void>,
  shouldStop?: () => boolean,
): Promise<void> {
  let cursor = 0;
  let firstError: unknown = null;
  const runNext = async (): Promise<void> => {
    while (cursor < items.length) {
      if ((shouldStop && shouldStop()) || firstError) return;
      const i = cursor++;
      try {
        await worker(items[i], i);
      } catch (err) {
        // One cell failing must not abandon the pool or leave the run wedged. Record the
        // first error, stop scheduling, and let all workers wind down; the caller decides.
        if (!firstError) firstError = err;
        return;
      }
    }
  };
  const workers = Array.from({ length: Math.min(limit, items.length) }, () => runNext());
  await Promise.all(workers);
  if (firstError) throw firstError;
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
  tenantId: string, categoryIds: string[] | null, opts: GenerateOptions = {},
): Promise<ProspectGenerationResult> {
  const maxApiCalls = opts.maxApiCalls ?? DEFAULT_MAX_API_CALLS;
  const onProgress = opts.onProgress;

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
  let truncated = false;
  const returnedPlaceIds: string[] = [];
  const seenPlaceIds = new Set<string>();

  const { rows: terrHexRows } = await adminPool.query(
    'SELECT h3_index FROM prp_tenant_territories WHERE tenant_id = $1', [tenantId],
  );
  const territoryHexSet = new Set(terrHexRows.map((r: any) => r.h3_index));

  logger.info(`[Prospects] Tenant ${tenantId}: ${searchCoords.length} centers × ${categoryMappings.length} categories (recursive drill-down, budget ${maxApiCalls} calls)`);

  const emit = (patch: Partial<GenerationProgress>) => {
    if (!onProgress) return;
    onProgress({
      phase: 'searching',
      categories_total: categoryMappings.length,
      categories_done: 0,
      centers_total: searchCoords.length,
      centers_done: 0,
      api_calls: totalApiCalls,
      found: seenPlaceIds.size,
      ...patch,
    });
  };

  let catIndex = 0;
  for (const catMap of categoryMappings) {
    const exclusions: string[] = catMap.api_exclusion_types || [];
    const keywords: string[] = catMap.google_search_strings || [];
    const optimizedQuery = keywords.join(' OR ');

    // Budget is shared across the WHOLE run: carry the running total into each category's
    // accumulator so dense early categories can't starve later ones unboundedly.
    const acc: DrillAccumulator = {
      byId: new Map<string, any>(), apiCalls: 0, cellsSearched: 0, cellsSaturatedAtMaxRes: 0,
      maxApiCalls: Math.max(0, maxApiCalls - totalApiCalls),
    };
    let centersDone = 0;
    // Crawl centers in parallel (bounded). The shared `acc` (byId map + apiCalls counter)
    // is safe under Node's single-threaded model — mutations are atomic between awaits —
    // and the budget check inside searchCellRecursive reads the shared counter, so workers
    // wind down naturally as it fills. shouldStop halts scheduling new centers once hit.
    await runWithConcurrency(
      searchCoords, SEARCH_CONCURRENCY,
      async (coord) => {
        await searchCellRecursive(coord.parentHex, optimizedQuery, exclusions, territory_address, acc);
        centersDone++;
        emit({ categories_done: catIndex, centers_done: centersDone, current_category: catMap.ui_category_name, api_calls: totalApiCalls + acc.apiCalls });
      },
      () => !!acc.budgetHit,
    );
    totalApiCalls += acc.apiCalls;
    if (acc.budgetHit) truncated = true;
    logger.info(`[Prospects] Tenant ${tenantId}: category "${catMap.ui_category_name}" — ${acc.cellsSearched} cells, ${acc.apiCalls} calls, ${acc.byId.size} found${acc.budgetHit ? ' (budget hit)' : ''}`);
    if (acc.cellsSaturatedAtMaxRes > 0) {
      logger.warn(`[Prospects] ${acc.cellsSaturatedAtMaxRes} cell(s) still saturated at finest resolution for "${catMap.ui_category_name}" — extremely dense.`);
    }

    emit({ phase: 'saving', categories_done: catIndex, centers_done: searchCoords.length, api_calls: totalApiCalls });
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

    catIndex++;
    // Global budget exhausted — stop processing further categories (results are partial).
    if (totalApiCalls >= maxApiCalls) { truncated = true; break; }
  }

  emit({ phase: 'finalizing', categories_done: catIndex, api_calls: totalApiCalls });
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

  logger.info(`[Prospects] Tenant ${tenantId} done: ${seenPlaceIds.size} prospects from ${totalApiCalls} API calls${truncated ? ' (TRUNCATED — API-call budget reached)' : ''}`);
  return { total_returned: seenPlaceIds.size, new_added: newCount, inactive_marked: inactiveMarked, api_calls: totalApiCalls, truncated };
}

// ============================================================
// Background run manager — lets the HTTP request return immediately (202) instead of
// holding the connection open for the whole Google crawl. Status is kept in-process
// (one run per tenant); the UI polls GET /:tenantId/generate/status. No DB migration.
// ============================================================

export interface GenerationRunStatus {
  tenantId: string;
  state: 'running' | 'done' | 'error';
  startedAt: string;
  finishedAt?: string;
  progress?: GenerationProgress;
  result?: ProspectGenerationResult;
  error?: string;
  errorCode?: string;
}

const runs = new Map<string, GenerationRunStatus>();

/** The current/last run status for a tenant, or null if none. */
export function getGenerationStatus(tenantId: string): GenerationRunStatus | null {
  return runs.get(tenantId) || null;
}

/**
 * Start a generation run in the background and return immediately. If a run is already
 * in progress for this tenant, it is NOT restarted — the existing status is returned so
 * the caller can keep polling. Validation errors (no territory/categories) are detected
 * synchronously so the caller can surface them right away.
 */
export async function startProspectGeneration(
  tenantId: string, categoryIds: string[] | null, opts: GenerateOptions = {},
): Promise<GenerationRunStatus> {
  const existing = runs.get(tenantId);
  if (existing && existing.state === 'running') return existing;

  const status: GenerationRunStatus = {
    tenantId,
    state: 'running',
    startedAt: new Date().toISOString(),
  };
  runs.set(tenantId, status);

  // Throttle progress writes to the status object (cheap, in-memory, but keep it tidy).
  const onProgress = (p: GenerationProgress) => { status.progress = p; };

  // Fire and forget — the request handler does not await this.
  void (async () => {
    try {
      const result = await generateProspectsForTenant(tenantId, categoryIds, { ...opts, onProgress });
      status.result = result;
      status.state = 'done';
    } catch (err: any) {
      status.state = 'error';
      status.error = err?.message || 'Generation failed';
      if (err?.name === 'NoTerritoryError' || err?.name === 'NoCategoriesError') status.errorCode = 'VALIDATION_ERROR';
      else if (String(err?.message).includes('GOOGLE_PLACES_API_KEY')) status.errorCode = 'CONFIGURATION_ERROR';
      else status.errorCode = 'INTERNAL_ERROR';
      logger.error(`[Prospects] Tenant ${tenantId} generation failed: ${status.error}`);
    } finally {
      status.finishedAt = new Date().toISOString();
    }
  })();

  return status;
}
