import duckdb from 'duckdb';
import * as h3 from 'h3-js';
import { adminPool } from '../db/pool';
import { logger } from '../middleware/logger';

/**
 * Overture Maps Places query service (spec 31 redesign).
 *
 * Fetches business candidates for a territory from Overture's public GeoParquet on S3,
 * using an embedded DuckDB engine (httpfs + spatial) to query the remote Parquet directly
 * via HTTP range requests — no API key, no result cap, no per-call cost.
 *
 * DESIGN: this layer applies ONLY the two structurally-necessary filters —
 *   - geography: a bounding box derived from the territory's H3 hexes (drives predicate
 *     pushdown so we read only the relevant row groups), and
 *   - category: the tenant's selected categories, mapped to curated Overture taxonomy values.
 * It deliberately does NOT filter on confidence, the precise territory polygon, or fit —
 * those are applied downstream in app code so they stay observable and tunable, and so no
 * record is discarded at fetch time (see design.md §3-4).
 */

/** Default Overture release path. Overridable via OVERTURE_RELEASE_PATH env for new releases. */
const DEFAULT_OVERTURE_PATH =
  's3://overturemaps-us-west-2/release/2026-10-21.0/theme=places/type=place/*';

function overturePath(): string {
  return process.env.OVERTURE_RELEASE_PATH || DEFAULT_OVERTURE_PATH;
}

/** Hard cap on how long a single Overture query may run before we abort the connection. */
const QUERY_TIMEOUT_MS = 60_000;

/** A raw business candidate from Overture (pre-filter, pre-dedup, pre-fit). */
export interface OvertureCandidate {
  externalId: string;
  name: string;
  category: string | null;        // Overture taxonomy.primary
  basicCategory: string | null;
  hierarchy: string[];            // Overture taxonomy.hierarchy [L0..primary] — for category attribution
  confidence: number | null;      // Overture's 0..1 data-quality score
  address: string | null;
  city: string | null;
  region: string | null;
  postcode: string | null;
  phone: string | null;           // first phone, if any
  website: string | null;         // first website, if any
  social: string | null;          // first social (e.g. facebook), if any
  lat: number;
  lng: number;
}

/** Bounding box (lat/lng extremes) around a set of H3 hexes, with a small padding margin. */
export function bboxFromHexes(hexes: string[], padDeg = 0.02): { xmin: number; xmax: number; ymin: number; ymax: number } | null {
  if (!hexes.length) return null;
  let xmin = Infinity, xmax = -Infinity, ymin = Infinity, ymax = -Infinity;
  for (const hex of hexes) {
    try {
      const [lat, lng] = h3.cellToLatLng(hex);
      if (lng < xmin) xmin = lng;
      if (lng > xmax) xmax = lng;
      if (lat < ymin) ymin = lat;
      if (lat > ymax) ymax = lat;
    } catch { /* skip bad hex */ }
  }
  if (!Number.isFinite(xmin)) return null;
  // Pad so businesses near a hex edge aren't clipped (the precise polygon filter runs later).
  return { xmin: xmin - padDeg, xmax: xmax + padDeg, ymin: ymin - padDeg, ymax: ymax + padDeg };
}

/** Load the curated Overture-taxonomy terms for the given (or all active) categories. */
export async function loadOvertureTaxonomy(categoryIds: string[] | null): Promise<string[]> {
  const q = categoryIds && categoryIds.length
    ? `SELECT overture_taxonomy FROM prp_category_mappings WHERE active = true AND id = ANY($1)`
    : `SELECT overture_taxonomy FROM prp_category_mappings WHERE active = true`;
  const { rows } = await adminPool.query(q, categoryIds && categoryIds.length ? [categoryIds] : []);
  const terms = new Set<string>();
  for (const r of rows) for (const t of (r.overture_taxonomy || [])) if (t) terms.add(String(t).toLowerCase());
  return [...terms];
}

/**
 * Precise territory membership test, robust to mixed stored-hex resolutions.
 *
 * Stored territory hexes can be res 5, 6, or 7 (the tiler auto-coarsens large territories),
 * so we cannot assume a single resolution. We build the set of distinct resolutions present
 * in the territory, and a candidate is "in territory" if, at ANY of those resolutions, the
 * H3 cell containing the candidate's point is one of the stored hexes. This is the precise
 * polygon filter that removes the bounding-box spillover (e.g. Canada, across a state line).
 */
export function makeTerritoryMembershipTest(territoryHexes: string[]): (lat: number, lng: number) => boolean {
  const hexSet = new Set(territoryHexes);
  const resolutions = [...new Set(territoryHexes.map((h) => {
    try { return h3.getResolution(h); } catch { return -1; }
  }).filter((r) => r >= 0))];

  return (lat: number, lng: number): boolean => {
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return false;
    for (const res of resolutions) {
      try {
        if (hexSet.has(h3.latLngToCell(lat, lng, res))) return true;
      } catch { /* skip */ }
    }
    return false;
  };
}

/** Filter raw Overture candidates to those whose point falls inside the territory hexes. */
export function filterToTerritory(candidates: OvertureCandidate[], territoryHexes: string[]): OvertureCandidate[] {
  const inTerritory = makeTerritoryMembershipTest(territoryHexes);
  return candidates.filter((c) => inTerritory(c.lat, c.lng));
}

/** DuckDB connection helper with a hard timeout around a single query. */
function runQuery(con: any, sql: string, timeoutMs = QUERY_TIMEOUT_MS): Promise<any[]> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (!settled) { settled = true; reject(new Error('Overture query timed out')); }
    }, timeoutMs);
    con.all(sql, (err: any, rows: any[]) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (err) reject(err); else resolve(rows);
    });
  });
}

function firstOf(v: any): string | null {
  // DuckDB returns VARCHAR[] as a JS array (or null).
  if (Array.isArray(v)) return v.length ? String(v[0]) : null;
  return v == null ? null : String(v);
}

/**
 * Query Overture for candidates within a territory's bbox matching the category taxonomy.
 * Returns raw candidates — NO confidence/territory/fit filtering (done downstream).
 */
export async function queryOvertureCandidates(
  hexes: string[], categoryIds: string[] | null,
): Promise<OvertureCandidate[]> {
  const bbox = bboxFromHexes(hexes);
  if (!bbox) return [];
  const taxonomy = await loadOvertureTaxonomy(categoryIds);
  if (taxonomy.length === 0) return [];

  // HIERARCHY-AWARE category filter. The selected codes are exact Overture taxonomy codes
  // (chosen from the catalog picker). A candidate matches if ANY selected code appears in its
  // taxonomy.hierarchy path — so choosing a PARENT (e.g. complementary_and_alternative_medicine)
  // catches every descendant (naturopathic_medicine, acupuncture, ...). We also match on
  // basic_category and taxonomy.primary directly to be safe. Exact-code matching avoids the
  // loose-substring false positives the old regexp approach produced (e.g. 'spa' inside words).
  // Codes are sanitized to [a-z0-9_] and single-quoted for the SQL list literal.
  const codes = [...new Set(taxonomy.map((t) => t.toLowerCase().replace(/[^a-z0-9_]/g, '')).filter(Boolean))];
  if (codes.length === 0) return [];
  const codeList = codes.map((c) => `'${c}'`).join(', ');

  const db = new duckdb.Database(':memory:');
  const con = db.connect();
  try {
    await runQuery(con, "INSTALL httpfs; LOAD httpfs; INSTALL spatial; LOAD spatial; SET s3_region='us-west-2';", 30_000);
    const sql = `
      SELECT
        id AS external_id,
        names.primary AS name,
        taxonomy.primary AS category,
        basic_category,
        CAST(taxonomy.hierarchy AS VARCHAR) AS hierarchy,
        confidence,
        addresses[1].freeform AS address,
        addresses[1].locality AS city,
        addresses[1].region AS region,
        addresses[1].postcode AS postcode,
        CAST(phones AS VARCHAR) AS phones,
        CAST(websites AS VARCHAR) AS websites,
        CAST(socials AS VARCHAR) AS socials,
        bbox.ymin AS lat,
        bbox.xmin AS lng
      FROM read_parquet('${overturePath()}', filename=true, hive_partitioning=1)
      WHERE bbox.xmin BETWEEN ${bbox.xmin} AND ${bbox.xmax}
        AND bbox.ymin BETWEEN ${bbox.ymin} AND ${bbox.ymax}
        AND names.primary IS NOT NULL
        AND (
          len(list_intersect(coalesce(taxonomy.hierarchy, []), [${codeList}])) > 0
          OR basic_category IN (${codeList})
          OR taxonomy.primary IN (${codeList})
        )
    `;
    const t0 = Date.now();
    const rows = await runQuery(con, sql);
    logger.info(`[Overture] Queried ${rows.length} candidates (bbox ${bbox.xmin.toFixed(2)},${bbox.ymin.toFixed(2)}..${bbox.xmax.toFixed(2)},${bbox.ymax.toFixed(2)}) in ${((Date.now() - t0) / 1000).toFixed(1)}s`);

    return rows.map((r): OvertureCandidate => {
      const parseList = (s: any): string[] => {
        if (s == null) return [];
        const str = String(s);
        if (str === '[]' || str === 'null') return [];
        // DuckDB CAST(... AS VARCHAR) renders a list like [a, b]; strip brackets and split.
        return str.replace(/^\[|\]$/g, '').split(',').map((x) => x.trim().replace(/^'|'$/g, '')).filter(Boolean);
      };
      const phones = parseList(r.phones);
      const websites = parseList(r.websites);
      const socials = parseList(r.socials);
      return {
        externalId: String(r.external_id),
        name: String(r.name),
        category: r.category ?? null,
        basicCategory: r.basic_category ?? null,
        hierarchy: parseList(r.hierarchy),
        confidence: r.confidence == null ? null : Number(r.confidence),
        address: r.address ?? null,
        city: r.city ?? null,
        region: r.region ?? null,
        postcode: r.postcode ?? null,
        phone: phones[0] ?? null,
        website: websites[0] ?? null,
        social: socials[0] ?? null,
        lat: Number(r.lat),
        lng: Number(r.lng),
      };
    });
  } finally {
    try { con.close(); } catch { /* ignore */ }
    try { db.close(() => {}); } catch { /* ignore */ }
  }
}
