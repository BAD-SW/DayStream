import * as h3 from 'h3-js';
import { adminPool } from '../db/pool';
import { logger } from '../middleware/logger';

const HEX_EDGE_LENGTH_KM = 7; // approximate for resolution 6

const DISPLAY_RESOLUTION = 7;  // ~2.6km edge — sharp borders for coverage map
const SEARCH_PARENT_RESOLUTION = 4; // ~22km edge — collapsed parents for efficient searching

async function getSearchResolution(): Promise<number> {
  try {
    const { rows } = await adminPool.query(
      `SELECT config_data FROM sys_system_configurations WHERE category = 'prospects'`,
    );
    return rows[0]?.config_data?.h3_resolution || SEARCH_PARENT_RESOLUTION;
  } catch { return SEARCH_PARENT_RESOLUTION; }
}

const MAX_TERRITORY_HEXES = 10000;

/** A viewport bounding box (Google geocode bounds) as a fillable ring. */
export interface TerritoryViewport {
  ne: { lat: number; lng: number };
  sw: { lat: number; lng: number };
}

/** Build a rectangular [lat,lng] ring from a viewport bounding box. */
function viewportToRing(vp: TerritoryViewport): number[][] {
  const { ne, sw } = vp;
  return [
    [ne.lat, ne.lng],
    [ne.lat, sw.lng],
    [sw.lat, sw.lng],
    [sw.lat, ne.lng],
    [ne.lat, ne.lng],
  ];
}

/**
 * Generate H3 hexagon indexes for a territory, in priority order:
 *   1. A boundary (one ring per polygon — e.g. every island of a state): fill ALL
 *      rings and union them, so non-contiguous areas are fully covered.
 *   2. No boundary but a geocoder viewport (informal names like "South Florida"):
 *      fill the viewport bounding box — far closer to the real extent than a dot.
 *   3. Last resort: a point + radius disk around the center.
 * The storage/search path is unchanged — this only affects which hexes are produced.
 */
export async function generateTerritoryHexagons(
  lat: number,
  lng: number,
  radiusKm: number,
  boundaryRings?: number[][][] | number[][] | null,
  viewport?: TerritoryViewport | null,
): Promise<string[]> {
  const resolution = DISPLAY_RESOLUTION;

  // Normalize boundary input: accept a single ring (back-compat) or a list of rings.
  let rings: number[][][] | null = null;
  if (boundaryRings && boundaryRings.length > 0) {
    rings = Array.isArray((boundaryRings as any)[0]?.[0]) ? (boundaryRings as number[][][]) : [boundaryRings as number[][]];
  }

  const fillRings = (ringList: number[][][], source: string): string[] => {
    const set = new Set<string>();
    for (const ring of ringList) {
      if (ring.length < 3) continue;
      try {
        for (const hex of h3.polygonToCells(ring, resolution)) {
          set.add(hex);
          if (set.size >= MAX_TERRITORY_HEXES) break;
        }
      } catch (err: any) {
        logger.error(`[H3Territory] polygonToCells failed for a ${source} ring: ${err.message}`);
      }
      if (set.size >= MAX_TERRITORY_HEXES) break;
    }
    return Array.from(set);
  };

  // 1. Boundary rings (all pieces).
  if (rings) {
    const hexagons = fillRings(rings, 'boundary');
    if (hexagons.length > 0) {
      logger.info(`[H3Territory] Generated ${hexagons.length} hexagons from ${rings.length} boundary ring(s) (resolution=${resolution})`);
      if (hexagons.length >= MAX_TERRITORY_HEXES) {
        logger.warn(`[H3Territory] Territory hit the ${MAX_TERRITORY_HEXES}-hexagon cap`);
      }
      return hexagons;
    }
  }

  // 2. No boundary: fill the geocoder viewport bounding box if we have one.
  if (viewport) {
    const hexagons = fillRings([viewportToRing(viewport)], 'viewport');
    if (hexagons.length > 0) {
      logger.info(`[H3Territory] Generated ${hexagons.length} hexagons from geocoder viewport (resolution=${resolution})`);
      return hexagons;
    }
  }

  // 3. Last resort: point + radius disk.
  const centerHex = h3.latLngToCell(lat, lng, resolution);
  const edgeLengthKm = 2.6; // resolution 7
  const ringSize = Math.ceil(radiusKm / (edgeLengthKm * 1.5));
  const hexagons = h3.gridDisk(centerHex, ringSize);
  logger.info(`[H3Territory] Generated ${hexagons.length} hexagons from gridDisk (resolution=${resolution}, radius=${radiusKm}km, rings=${ringSize})`);
  return hexagons;
}

// Resolution envelope for territory tiling. Must stay within [MIN..MAX]:
//   - <= 8 so the population filter's cellToChildren(hex, 8) is valid
//   - >= SEARCH_PARENT_RESOLUTION (4) so the search's cellToParent(hex, 4) is valid
// We tile at the FINEST resolution whose cell count fits the budget, stepping coarser
// only when a territory would otherwise be too large — so coverage is always COMPLETE
// (never truncated) while staying as sharp as the budget allows.
const TILING_MAX_RESOLUTION = 7;  // sharpest (~2.6km edge)
const TILING_MIN_RESOLUTION = 5;  // coarsest we'll drop to (~8km edge) — still > search parent (4)
const TILING_BUDGET = 10000;      // max cells stored per territory

/** Fill all boundary rings at a given resolution, unioned. */
function fillRingsAtResolution(rings: number[][][], resolution: number, budget: number): string[] {
  const set = new Set<string>();
  for (const ring of rings) {
    if (ring.length < 3) continue;
    try {
      for (const hex of h3.polygonToCells(ring, resolution)) {
        set.add(hex);
        if (set.size > budget) return Array.from(set); // over budget — bail early
      }
    } catch (err: any) {
      logger.error(`[H3Territory] polygonToCells failed at res ${resolution}: ${err.message}`);
    }
  }
  return Array.from(set);
}

export interface TerritoryTiling {
  hexagons: string[];
  resolution: number;
  complete: boolean;      // true if the whole boundary was tiled within budget
  hasBoundary: boolean;   // false => fell back to viewport/disk (approximate rectangle)
}

/**
 * Tile a territory COMPLETELY from its boundary rings, auto-coarsening the H3
 * resolution (7 → 6 → 5) until the whole area fits the cell budget, so a large
 * region (e.g. Andalusia) is never silently truncated. Falls back to the geocoder
 * viewport (a rectangle) only when there is no true boundary, flagged via hasBoundary.
 */
export function tileTerritoryComplete(
  boundaryRings: number[][][] | null,
  viewport?: TerritoryViewport | null,
  centerLat?: number,
  centerLng?: number,
  radiusKm = 50,
): TerritoryTiling {
  if (boundaryRings && boundaryRings.length > 0) {
    for (let resolution = TILING_MAX_RESOLUTION; resolution >= TILING_MIN_RESOLUTION; resolution--) {
      const hexagons = fillRingsAtResolution(boundaryRings, resolution, TILING_BUDGET);
      if (hexagons.length <= TILING_BUDGET) {
        logger.info(`[H3Territory] Tiled ${boundaryRings.length} ring(s) completely at res ${resolution}: ${hexagons.length} hexagons`);
        return { hexagons, resolution, complete: true, hasBoundary: true };
      }
      logger.info(`[H3Territory] res ${resolution} over budget (${hexagons.length} > ${TILING_BUDGET}); coarsening`);
    }
    // Even the coarsest resolution exceeds budget — tile at MIN and accept the cap.
    const hexagons = fillRingsAtResolution(boundaryRings, TILING_MIN_RESOLUTION, TILING_BUDGET).slice(0, TILING_BUDGET);
    logger.warn(`[H3Territory] Territory exceeds budget even at res ${TILING_MIN_RESOLUTION}; capped at ${hexagons.length}`);
    return { hexagons, resolution: TILING_MIN_RESOLUTION, complete: false, hasBoundary: true };
  }

  // No boundary: viewport rectangle (approximate) or point+radius disk.
  if (viewport) {
    for (let resolution = TILING_MAX_RESOLUTION; resolution >= TILING_MIN_RESOLUTION; resolution--) {
      const hexagons = fillRingsAtResolution([viewportToRing(viewport)], resolution, TILING_BUDGET);
      if (hexagons.length <= TILING_BUDGET) {
        return { hexagons, resolution, complete: true, hasBoundary: false };
      }
    }
  }
  if (centerLat != null && centerLng != null) {
    const centerHex = h3.latLngToCell(centerLat, centerLng, TILING_MAX_RESOLUTION);
    const ringSize = Math.ceil(radiusKm / (2.6 * 1.5));
    return { hexagons: h3.gridDisk(centerHex, ringSize), resolution: TILING_MAX_RESOLUTION, complete: true, hasBoundary: false };
  }
  return { hexagons: [], resolution: TILING_MAX_RESOLUTION, complete: false, hasBoundary: false };
}

/** One area in a composed territory: boundary rings, or a viewport/center fallback. */
export interface TerritoryComponentInput {
  rings: number[][][] | null;
  viewport?: TerritoryViewport | null;
  centerLat?: number;
  centerLng?: number;
}

export interface ComposedTiling extends TerritoryTiling {
  componentCount: number;
}

/**
 * Tile a COMPOSED territory from several component areas (e.g. a set of counties),
 * unioning all their hexes. The whole set is auto-coarsened TOGETHER (res 7 → 6 → 5)
 * so the combined territory stays within budget and complete — not each component in
 * isolation. Components with no boundary fall back to their viewport/disk; hasBoundary
 * is true only if EVERY component had a real boundary.
 */
export function tileManyComplete(components: TerritoryComponentInput[]): ComposedTiling {
  if (components.length === 0) {
    return { hexagons: [], resolution: TILING_MAX_RESOLUTION, complete: false, hasBoundary: false, componentCount: 0 };
  }

  const allHaveBoundary = components.every((c) => c.rings && c.rings.length > 0);

  // Build the ring set per component, substituting a viewport rectangle when a
  // component has no boundary, so the union still covers that area.
  const ringSets: number[][][][] = components.map((c) => {
    if (c.rings && c.rings.length > 0) return c.rings;
    if (c.viewport) return [viewportToRing(c.viewport)];
    return [];
  });

  for (let resolution = TILING_MAX_RESOLUTION; resolution >= TILING_MIN_RESOLUTION; resolution--) {
    const set = new Set<string>();
    let over = false;
    for (const rings of ringSets) {
      for (const hex of fillRingsAtResolution(rings, resolution, TILING_BUDGET)) {
        set.add(hex);
        if (set.size > TILING_BUDGET) { over = true; break; }
      }
      if (over) break;
    }
    if (!over) {
      logger.info(`[H3Territory] Composed ${components.length} area(s) completely at res ${resolution}: ${set.size} hexagons`);
      return { hexagons: Array.from(set), resolution, complete: true, hasBoundary: allHaveBoundary, componentCount: components.length };
    }
    logger.info(`[H3Territory] composed res ${resolution} over budget; coarsening`);
  }

  // Still over budget at the coarsest resolution — tile at MIN and cap.
  const set = new Set<string>();
  for (const rings of ringSets) {
    for (const hex of fillRingsAtResolution(rings, TILING_MIN_RESOLUTION, TILING_BUDGET)) {
      set.add(hex);
      if (set.size >= TILING_BUDGET) break;
    }
    if (set.size >= TILING_BUDGET) break;
  }
  logger.warn(`[H3Territory] Composed territory exceeds budget even at res ${TILING_MIN_RESOLUTION}; capped at ${set.size}`);
  return { hexagons: Array.from(set), resolution: TILING_MIN_RESOLUTION, complete: false, hasBoundary: allHaveBoundary, componentCount: components.length };
}

/**
 * Extract ALL outer rings from a GeoJSON geometry for h3.polygonToCells.
 * A Polygon yields one ring; a MultiPolygon yields one ring PER polygon (e.g. one
 * per island for a state like Hawaii) — every piece is kept, not just the largest,
 * so non-contiguous territories are fully covered. GeoJSON uses [lng, lat]; H3
 * expects [lat, lng]. Returns null when no usable ring exists.
 */
export function geojsonToH3Rings(geojson: any): number[][][] | null {
  if (!geojson) return null;

  const outerRings: number[][][] = [];
  if (geojson.type === 'Polygon') {
    // coordinates[0] is the outer ring (any holes in [1..] are ignored).
    outerRings.push(geojson.coordinates[0]);
  } else if (geojson.type === 'MultiPolygon') {
    for (const poly of geojson.coordinates) outerRings.push(poly[0]);
  } else {
    return null;
  }

  // Convert each ring [lng,lat] → [lat,lng]; drop degenerate rings (<3 points).
  const rings = outerRings
    .map((ring) => ring.map(([lng, lat]: number[]) => [lat, lng]))
    .filter((ring) => ring.length >= 3);

  return rings.length > 0 ? rings : null;
}

/**
 * Back-compat single-ring helper. Returns the largest outer ring (most vertices).
 * Prefer geojsonToH3Rings, which keeps every piece of a MultiPolygon.
 */
export function geojsonToH3Polygon(geojson: any): number[][] | null {
  const rings = geojsonToH3Rings(geojson);
  if (!rings) return null;
  let largest = rings[0];
  for (const r of rings) if (r.length > largest.length) largest = r;
  return largest;
}

/**
 * Save territory hexagons for a tenant (replaces any existing assignment).
 * Checks population lookup to flag unpopulated hexagons as non-searchable.
 */
export async function saveTerritoryHexagons(tenantId: string, hexagons: string[]): Promise<number> {
  // Clear existing territory
  await adminPool.query('DELETE FROM prp_tenant_territories WHERE tenant_id = $1', [tenantId]);

  if (hexagons.length === 0) return 0;

  // Batch insert in chunks of 500 with population-based searchability
  const chunkSize = 500;
  for (let i = 0; i < hexagons.length; i += chunkSize) {
    const chunk = hexagons.slice(i, i + chunkSize);
    const values: string[] = [];
    const params: any[] = [];
    let idx = 1;

    for (const hex of chunk) {
      values.push(`($${idx++}, $${idx++})`);
      params.push(tenantId, hex);
    }

    await adminPool.query(
      `INSERT INTO prp_tenant_territories (tenant_id, h3_index) VALUES ${values.join(', ')} ON CONFLICT DO NOTHING`,
      params,
    );
  }

  // Update is_searchable based on population data (if available for this region)
  const { rows: popCount } = await adminPool.query('SELECT 1 FROM prp_population_lookup LIMIT 1').catch(() => ({ rows: [] }));
  if (popCount.length > 0) {
    try {
      const { rows: terrHexes } = await adminPool.query(
        'SELECT h3_index FROM prp_tenant_territories WHERE tenant_id = $1', [tenantId],
      );

      // Build all res-8 children for the territory
      const hexToChildren = new Map<string, string[]>();
      const allChildren: string[] = [];
      for (const row of terrHexes) {
        const children = h3.cellToChildren(row.h3_index, 8);
        hexToChildren.set(row.h3_index, children);
        allChildren.push(...children);
      }

      // Check if population data exists for this region at all
      // Sample a few children — if none exist in population table, skip filtering (no data for this area)
      const sampleSize = Math.min(100, allChildren.length);
      const sample = allChildren.slice(0, sampleSize);
      const { rows: sampleCheck } = await adminPool.query(
        `SELECT COUNT(*) as cnt FROM prp_population_lookup WHERE h3_index = ANY($1)`,
        [sample],
      );
      const sampleHits = parseInt(sampleCheck[0]?.cnt || '0');

      if (sampleHits === 0) {
        // No population data for this region — skip filtering, keep all searchable
        logger.info(`[H3Territory] No population data found for this region — skipping filter`);
      } else {
        // Population data exists — find populated children
        const populatedChildren = new Set<string>();
        for (let i = 0; i < allChildren.length; i += 5000) {
          const chunk = allChildren.slice(i, i + 5000);
          const { rows: popRows } = await adminPool.query(
            `SELECT h3_index FROM prp_population_lookup WHERE h3_index = ANY($1) AND population > 50`,
            [chunk],
          );
          for (const r of popRows) populatedChildren.add(r.h3_index);
        }

        // Mark territory hexes with no populated children as non-searchable
        const nonSearchable: string[] = [];
        for (const [hex, children] of hexToChildren) {
          const hasPopulation = children.some(c => populatedChildren.has(c));
          if (!hasPopulation) nonSearchable.push(hex);
        }

        if (nonSearchable.length > 0) {
          await adminPool.query(
            `UPDATE prp_tenant_territories SET is_searchable = false WHERE tenant_id = $1 AND h3_index = ANY($2)`,
            [tenantId, nonSearchable],
          );
        }
        logger.info(`[H3Territory] Population filter: ${nonSearchable.length}/${terrHexes.length} hexagons marked non-searchable`);
      }
    } catch (err: any) {
      logger.warn(`[H3Territory] Population filter failed: ${err.message}`);
    }
  }

  logger.info(`[H3Territory] Saved ${hexagons.length} hexagons for tenant ${tenantId}`);
  return hexagons.length;
}

/**
 * Get territory hexagons for a tenant.
 */
export async function getTerritoryHexagons(tenantId: string): Promise<string[]> {
  const { rows } = await adminPool.query(
    'SELECT h3_index FROM prp_tenant_territories WHERE tenant_id = $1',
    [tenantId],
  );
  return rows.map((r: any) => r.h3_index);
}

/**
 * Get optimized search coordinates by collapsing display hexagons into parent cells.
 * Uses hierarchical aggregation: resolution 7 display hexes → resolution 4 parents.
 * Returns ~15-20 search centers instead of thousands.
 */
export async function getSearchCoordinates(tenantId: string): Promise<{ coordinates: { lat: number; lng: number; parentHex: string }[]; parentResolution: number }> {
  const parentResolution = await getSearchResolution();

  // Get the display hexagons from DB (only searchable ones)
  const { rows } = await adminPool.query(
    'SELECT h3_index FROM prp_tenant_territories WHERE tenant_id = $1 AND is_searchable = true',
    [tenantId],
  );
  const displayHexes = rows.map((r: any) => r.h3_index);
  if (displayHexes.length === 0) return { coordinates: [], parentResolution };

  // Collapse into parent hexagons
  const uniqueParents = new Set<string>();
  for (const hex of displayHexes) {
    const parentHex = h3.cellToParent(hex, parentResolution);
    uniqueParents.add(parentHex);
  }

  // Get center coordinates of each parent
  const coordinates = Array.from(uniqueParents).map(parentHex => {
    const [lat, lng] = h3.cellToLatLng(parentHex);
    return { lat, lng, parentHex };
  });

  logger.info(`[H3Territory] Collapsed ${displayHexes.length} display hexes into ${coordinates.length} search centers (parent resolution ${parentResolution})`);
  return { coordinates, parentResolution };
}

/**
 * Get sub-cells for a parent hexagon (for dynamic density zoom when 60-result cap is hit).
 * Splits a resolution 4 parent into resolution 6 children for targeted re-search.
 */
export function getSubCells(parentHex: string, targetResolution: number = 6): { lat: number; lng: number }[] {
  const children = h3.cellToChildren(parentHex, targetResolution);
  return children.map(child => {
    const [lat, lng] = h3.cellToLatLng(child);
    return { lat, lng };
  });
}

/**
 * Get all territory hexagons grouped by tenant (for coverage map).
 */
export async function getAllTerritories(): Promise<{ tenantId: string; name: string; status: string; location: string; hexagons: string[] }[]> {
  const { rows } = await adminPool.query(
    `SELECT t.id AS tenant_id, t.name, t.status, t.territory_address AS location, array_agg(tt.h3_index) AS hexagons
     FROM sys_tenants t
     JOIN prp_tenant_territories tt ON tt.tenant_id = t.id
     GROUP BY t.id, t.name, t.status, t.territory_address
     ORDER BY t.name`,
  );
  return rows.map((r: any) => ({
    tenantId: r.tenant_id,
    name: r.name,
    status: r.status,
    location: r.location || '',
    hexagons: r.hexagons || [],
  }));
}

/**
 * Check if a hexagon is already assigned to another tenant.
 */
export async function checkOverlap(tenantId: string, hexagons: string[]): Promise<{ overlapping: string[]; owner: string } | null> {
  if (hexagons.length === 0) return null;

  const { rows } = await adminPool.query(
    `SELECT tt.h3_index, t.name AS owner_name
     FROM prp_tenant_territories tt
     JOIN sys_tenants t ON t.id = tt.tenant_id
     WHERE tt.tenant_id != $1 AND tt.h3_index = ANY($2)
     LIMIT 10`,
    [tenantId, hexagons],
  );

  if (rows.length === 0) return null;
  return { overlapping: rows.map((r: any) => r.h3_index), owner: rows[0].owner_name };
}

/**
 * Convert H3 index to polygon boundary (for client-side rendering).
 */
export function hexToPolygon(hexIndex: string): [number, number][] {
  const boundary = h3.cellToBoundary(hexIndex);
  return boundary.map(([lat, lng]) => [lat, lng]);
}
