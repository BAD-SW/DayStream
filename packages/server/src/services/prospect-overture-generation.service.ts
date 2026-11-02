import { adminPool } from '../db/pool';
import { logger } from '../middleware/logger';
import {
  queryOvertureCandidates, filterToTerritory, OvertureCandidate,
} from './overture.service';
import {
  clusterBusinesses, coalesceField, DedupRecord,
} from './prospect-dedup';
import {
  scoreFit, detectMultiLocation, loadFitConfig, FitInput,
} from './prospect-fit';
import {
  classifyProspect, loadClassifyConfig, ContactFilter, Classification,
} from './prospect-classify';
import {
  GenerationRunStatus, NoTerritoryError, NoCategoriesError, runs,
} from './prospect-generation.service';

/**
 * Overture prospect generation (spec 31). The discovery funnel:
 *
 *   [1] queryOvertureCandidates(hexes, categoryIds)  — bbox + category only (DuckDB)
 *   [2] filterToTerritory                             — precise H3-polygon membership
 *   [3] clusterBusinesses                             — de-dup by name + location, reconcile
 *   [4] detectMultiLocation                           — flag chains (name-cluster, de-duped set)
 *   [5] scoreFit                                      — fit signals + Fit Score + tier
 *   [6] classifyProspect                              — reversible inclusion flags
 *   [7] persist ALL to prp_prospects                  — nothing discarded
 *   [8] log run to prp_generation_log (engine='overture')
 *
 * This engine is additive behind feature.prospects_overture; the Google engine is untouched
 * and remains the fallback. No Google calls, no API cost — the Overture query is free.
 */

/** A cluster reconciled into a single persistable prospect. */
interface ReconciledProspect {
  externalId: string;
  name: string;
  category: string | null;
  basicCategory: string | null;
  hierarchy: string[];
  confidence: number | null;
  address: string | null;
  city: string | null;
  region: string | null;
  postcode: string | null;
  phone: string | null;
  website: string | null;
  social: string | null;
  lat: number;
  lng: number;
  contributingSources: string[];
}

export interface OvertureGenerationResult {
  total_returned: number;  // distinct businesses after de-dup
  new_added: number;       // rows inserted/updated
  held_count: number;      // classified 'held' (confidence/contact)
  inactive_marked: number; // existing overture prospects no longer returned
  truncated: boolean;      // always false for Overture (no budget cap) — kept for shape parity
}

export interface OvertureGenerateOptions {
  /** Operator contact-completeness choice for this run (persisted as inclusion flags). */
  contactFilter?: ContactFilter;
}

/**
 * Clamp a string to a column's max length. Overture values (especially website URLs with
 * tracking params, and freeform addresses) are not length-bounded like Google's were, so we
 * truncate defensively to avoid "value too long for type character varying(N)" on insert.
 * Returns null for empty/nullish so bounded columns store NULL rather than ''.
 */
function clampLen(v: string | null | undefined, max: number): string | null {
  if (v == null) return null;
  const s = String(v).trim();
  if (!s) return null;
  return s.length > max ? s.slice(0, max) : s;
}

// prp_prospects varchar widths the Overture insert writes into.
const LEN = { externalId: 300, name: 300, address: 500, city: 200, phone: 50, website: 500 } as const;

interface CategoryRow { ui_category_name: string; overture_taxonomy: string[] | null; display_order: number | null }

/**
 * Build a resolver mapping a business's Overture taxonomy to the UI category it belongs to —
 * HIERARCHY-AWARE to match the hierarchy-aware query filter.
 *
 * A business qualified because one of its hierarchy codes is in some category's selected set.
 * We attribute it to the UI category whose selected code sits DEEPEST in this business's
 * hierarchy path — i.e. the most specific match. Example: a business with hierarchy
 * [health_care, ..., complementary_and_alternative_medicine, naturopathic_medicine] attributed
 * to a category that selected `naturopathic_medicine` (depth 3) over one that selected
 * `health_care` (depth 0). Ties resolve by category display order (deterministic).
 *
 * Returns null when nothing matches (caller falls back to the first selected category).
 */
function makeCategoryResolver(rows: CategoryRow[]): (category: string | null, basicCategory: string | null, hierarchy?: string[]) => string | null {
  // Each category's selected codes as a Set (exact codes), carried with display order.
  const cats = rows.map((r, idx) => ({
    name: r.ui_category_name,
    order: r.display_order ?? idx,
    codes: new Set((r.overture_taxonomy || []).map((t) => String(t).toLowerCase()).filter(Boolean)),
  }));

  return (category: string | null, basicCategory: string | null, hierarchy?: string[]): string | null => {
    // Build the ordered path to test against (deepest-last), with primary/basic as fallbacks.
    const path = (hierarchy && hierarchy.length ? hierarchy : [])
      .map((c) => c.toLowerCase());
    const prim = (category || '').toLowerCase();
    const basic = (basicCategory || '').toLowerCase();
    // A candidate "depth" for a code = its index in the hierarchy (deeper = more specific);
    // primary/basic (not in hierarchy) are treated as deepest so an exact leaf still wins.
    const depthOf = (code: string): number => {
      const i = path.lastIndexOf(code);
      if (i >= 0) return i;
      if (code === prim || code === basic) return path.length; // treat as deepest
      return -1;
    };

    let best: { name: string; depth: number; order: number } | null = null;
    for (const c of cats) {
      for (const code of c.codes) {
        const d = depthOf(code);
        if (d < 0) continue;
        const better =
          best === null ||
          d > best.depth ||
          (d === best.depth && c.order < best.order);
        if (better) best = { name: c.name, depth: d, order: c.order };
      }
    }
    return best ? best.name : null;
  };
}

/**
 * Reconcile a de-dup cluster into one record: canonical = richest name (chosen by
 * clusterBusinesses), with best-available value coalesced per field across the cluster.
 * String fields are clamped to their DB column widths (Overture values are unbounded).
 */
function reconcileCluster(records: Array<DedupRecord & OvertureCandidate>, canonical: DedupRecord & OvertureCandidate): ReconciledProspect {
  return {
    externalId: clampLen(canonical.externalId, LEN.externalId) ?? canonical.externalId,
    name: clampLen(canonical.name, LEN.name) ?? canonical.name,
    category: (coalesceField(records, 'category') as string | null) ?? null,
    basicCategory: (coalesceField(records, 'basicCategory') as string | null) ?? null,
    hierarchy: canonical.hierarchy || [],
    // Confidence: keep the HIGHEST across the cluster (best evidence the place is real).
    confidence: records.reduce<number | null>((best, r) => {
      if (r.confidence == null) return best;
      return best == null ? r.confidence : Math.max(best, r.confidence);
    }, null),
    address: clampLen(coalesceField(records, 'address') as string | null, LEN.address),
    city: clampLen(coalesceField(records, 'city') as string | null, LEN.city),
    region: (coalesceField(records, 'region') as string | null) ?? null,
    postcode: (coalesceField(records, 'postcode') as string | null) ?? null,
    phone: clampLen(coalesceField(records, 'phone') as string | null, LEN.phone),
    website: clampLen(coalesceField(records, 'website') as string | null, LEN.website),
    social: (coalesceField(records, 'social') as string | null) ?? null,
    lat: canonical.lat,
    lng: canonical.lng,
    contributingSources: ['overture'],
  };
}

/**
 * Generate/refresh a tenant's prospect list from Overture. Returns counts; persists all.
 */
export async function generateProspectsFromOverture(
  tenantId: string, categoryIds: string[] | null, opts: OvertureGenerateOptions = {},
): Promise<OvertureGenerationResult> {
  // Territory must exist (same precondition as the Google engine).
  const { rows: terrHexRows } = await adminPool.query(
    'SELECT h3_index FROM prp_tenant_territories WHERE tenant_id = $1', [tenantId],
  );
  if (terrHexRows.length === 0) throw new NoTerritoryError();
  const territoryHexes: string[] = terrHexRows.map((r: any) => r.h3_index);

  // Categories must be configured. Pull each selected category's Overture taxonomy terms so
  // we can label each business with the UI category it actually belongs to (not a blanket
  // first-category label). Longest display_order wins ties deterministically.
  const catQuery = categoryIds
    ? `SELECT id, ui_category_name, overture_taxonomy, display_order FROM prp_category_mappings WHERE active = true AND id = ANY($1) ORDER BY display_order`
    : `SELECT id, ui_category_name, overture_taxonomy, display_order FROM prp_category_mappings WHERE active = true ORDER BY display_order`;
  const { rows: categoryRows } = await adminPool.query(catQuery, categoryIds ? [categoryIds] : []);
  if (categoryRows.length === 0) throw new NoCategoriesError();

  // Build a resolver: given a business's Overture taxonomy text, return the UI category whose
  // curated terms best match it. "Best" = the category with the longest matching term (a more
  // specific term like 'medical_spa' beats a generic 'spa'); ties fall back to display order.
  const resolveCategory = makeCategoryResolver(categoryRows);
  const fallbackLabel: string = categoryRows[0].ui_category_name;

  const fitConfig = await loadFitConfig();
  const classifyConfig = await loadClassifyConfig();
  const contactFilter: ContactFilter = opts.contactFilter ?? classifyConfig.contactFilter;

  logger.info(`[Overture] Tenant ${tenantId}: querying ${categoryRows.length} categories across ${territoryHexes.length} hexes`);

  // [1] query + [2] territory filter
  const raw = await queryOvertureCandidates(territoryHexes, categoryIds);
  const inTerritory = filterToTerritory(raw, territoryHexes);
  logger.info(`[Overture] Tenant ${tenantId}: ${raw.length} raw -> ${inTerritory.length} in-territory`);

  // [3] de-dup within this result set (name + location); reconcile each cluster.
  const clusters = clusterBusinesses(inTerritory as Array<DedupRecord & OvertureCandidate>);
  const reconciled = clusters.map((c) =>
    reconcileCluster(c.records as Array<DedupRecord & OvertureCandidate>, c.canonical as DedupRecord & OvertureCandidate),
  );
  logger.info(`[Overture] Tenant ${tenantId}: ${inTerritory.length} -> ${reconciled.length} after de-dup`);

  // [4] multi-location flags over the DE-DUPED set (same name, different locations = chain).
  const multiIdx = detectMultiLocation(reconciled.map((r) => r.name));

  // [5] fit + [6] classification, then [7] persist all.
  let newCount = 0;
  let heldCount = 0;
  const returnedExternalIds: string[] = [];

  for (let i = 0; i < reconciled.length; i++) {
    const r = reconciled[i];
    const rowCategory = resolveCategory(r.category, r.basicCategory, r.hierarchy) ?? fallbackLabel;
    const fitInput: FitInput = {
      name: r.name,
      category: r.category,
      basicCategory: r.basicCategory,
      confidence: r.confidence,
      phone: r.phone,
      website: r.website,
      social: r.social,
      address: r.address,
      multiLocation: multiIdx.has(i),
    };
    const fit = scoreFit(fitInput, fitConfig.weights, fitConfig.tierThresholds);
    const classification: Classification = classifyProspect(
      { confidence: r.confidence, phone: r.phone, website: r.website },
      { contactFilter, confidenceThreshold: classifyConfig.confidenceThreshold },
    );
    if (classification.inclusion === 'held') heldCount++;
    returnedExternalIds.push(r.externalId);

    // Persist. ON CONFLICT (tenant_id, external_id) updates on re-run (no duplicate).
    // fit_signals stored raw for the learning loop; inclusion/hold_reason are reversible.
    await adminPool.query(
      `INSERT INTO prp_prospects
         (tenant_id, external_id, source, name, address, city, phone, website, category,
          lat, lng, confidence, fit_signals, fit_score, fit_tier, inclusion, hold_reason,
          contributing_sources, is_active)
       VALUES ($1, $2, 'overture', $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, true)
       ON CONFLICT (tenant_id, external_id) WHERE external_id IS NOT NULL DO UPDATE SET
         name = EXCLUDED.name, address = EXCLUDED.address, city = EXCLUDED.city,
         phone = EXCLUDED.phone, website = EXCLUDED.website, category = EXCLUDED.category,
         lat = EXCLUDED.lat, lng = EXCLUDED.lng, confidence = EXCLUDED.confidence,
         fit_signals = EXCLUDED.fit_signals, fit_score = EXCLUDED.fit_score,
         fit_tier = EXCLUDED.fit_tier, contributing_sources = EXCLUDED.contributing_sources,
         is_active = true, updated_at = NOW(),
         -- Preserve an operator's manual hold; otherwise take the recomputed classification.
         inclusion = CASE WHEN prp_prospects.hold_reason = 'manual' THEN prp_prospects.inclusion ELSE EXCLUDED.inclusion END,
         hold_reason = CASE WHEN prp_prospects.hold_reason = 'manual' THEN prp_prospects.hold_reason ELSE EXCLUDED.hold_reason END`,
      [
        tenantId, r.externalId, r.name, r.address, r.city, r.phone, r.website, rowCategory,
        r.lat, r.lng, r.confidence, JSON.stringify(fit.signals), fit.score, fit.tier,
        classification.inclusion, classification.holdReason, r.contributingSources,
      ],
    );
    newCount++;
  }

  // [7b] Mark previously-returned Overture prospects not in this run inactive (soft).
  let inactiveMarked = 0;
  if (returnedExternalIds.length > 0) {
    const { rowCount } = await adminPool.query(
      `UPDATE prp_prospects SET is_active = false, updated_at = NOW()
       WHERE tenant_id = $1 AND source = 'overture' AND external_id IS NOT NULL
         AND external_id != ALL($2) AND is_active = true`,
      [tenantId, returnedExternalIds],
    );
    inactiveMarked = rowCount ?? 0;
  }

  // [8] Log the run (engine='overture', free so cost_cents=0).
  await adminPool.query(
    `INSERT INTO prp_generation_log (tenant_id, new_count, total_returned, inactive_marked, cost_cents, engine, held_count)
     VALUES ($1, $2, $3, $4, 0, 'overture', $5)`,
    [tenantId, newCount, reconciled.length, inactiveMarked, heldCount],
  );

  logger.info(`[Overture] Tenant ${tenantId} done: ${reconciled.length} businesses (${heldCount} held, ${inactiveMarked} marked inactive)`);
  return {
    total_returned: reconciled.length,
    new_added: newCount,
    held_count: heldCount,
    inactive_marked: inactiveMarked,
    truncated: false,
  };
}

/**
 * Start an Overture generation run in the background (returns immediately). Registers into
 * the SHARED `runs` map so the existing /:tenantId/generate/status endpoint reports it.
 */
export async function startOvertureGeneration(
  tenantId: string, categoryIds: string[] | null, opts: OvertureGenerateOptions = {},
): Promise<GenerationRunStatus> {
  const existing = runs.get(tenantId);
  if (existing && existing.state === 'running') return existing;

  const status: GenerationRunStatus = {
    tenantId,
    state: 'running',
    startedAt: new Date().toISOString(),
  };
  runs.set(tenantId, status);

  void (async () => {
    try {
      const result = await generateProspectsFromOverture(tenantId, categoryIds, opts);
      // Shape the Overture result onto the shared status.result (ProspectGenerationResult-ish).
      status.result = {
        total_returned: result.total_returned,
        new_added: result.new_added,
        inactive_marked: result.inactive_marked,
        api_calls: 0,
        truncated: result.truncated,
      };
      status.state = 'done';
    } catch (err: any) {
      status.state = 'error';
      status.error = err?.message || 'Overture generation failed';
      if (err?.name === 'NoTerritoryError' || err?.name === 'NoCategoriesError') status.errorCode = 'VALIDATION_ERROR';
      else status.errorCode = 'INTERNAL_ERROR';
      logger.error(`[Overture] Tenant ${tenantId} generation failed: ${status.error}`);
    } finally {
      status.finishedAt = new Date().toISOString();
    }
  })();

  return status;
}
