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

/**
 * Generate H3 hexagon indexes for a territory.
 * If a boundary polygon is available (from Nominatim), fills the polygon shape.
 * Otherwise falls back to point + radius disk.
 */
export async function generateTerritoryHexagons(lat: number, lng: number, radiusKm: number, boundaryPolygon?: number[][]): Promise<string[]> {
  const resolution = DISPLAY_RESOLUTION;

  if (boundaryPolygon && boundaryPolygon.length >= 3) {
    // Use polygon fill — fills the exact boundary shape
    try {
      const hexagons = h3.polygonToCells(boundaryPolygon, resolution);
      if (hexagons.length > 0) {
        logger.info(`[H3Territory] Generated ${hexagons.length} hexagons from boundary polygon (resolution=${resolution})`);
        if (hexagons.length > 5000) {
          logger.warn(`[H3Territory] Territory has ${hexagons.length} hexagons — capping at 5000`);
          return hexagons.slice(0, 5000);
        }
        return hexagons;
      }
    } catch (err: any) {
      logger.error(`[H3Territory] polygonToCells failed: ${err.message}, falling back to gridDisk`);
    }
  }

  // Fallback: point + radius disk
  const centerHex = h3.latLngToCell(lat, lng, resolution);
  const edgeLengthKm = 2.6; // resolution 7
  const ringSize = Math.ceil(radiusKm / (edgeLengthKm * 1.5));
  const hexagons = h3.gridDisk(centerHex, ringSize);
  logger.info(`[H3Territory] Generated ${hexagons.length} hexagons from gridDisk (resolution=${resolution}, radius=${radiusKm}km, rings=${ringSize})`);
  return hexagons;
}

/**
 * Extract a flat coordinate array from GeoJSON for use with h3.polygonToCells.
 * GeoJSON uses [lng, lat] — H3 expects [lat, lng].
 */
export function geojsonToH3Polygon(geojson: any): number[][] | null {
  if (!geojson) return null;

  let coords: number[][];

  if (geojson.type === 'Polygon') {
    // Take the outer ring (first array)
    coords = geojson.coordinates[0];
  } else if (geojson.type === 'MultiPolygon') {
    // Take the largest polygon (most coordinates)
    let largest = geojson.coordinates[0][0];
    for (const poly of geojson.coordinates) {
      if (poly[0].length > largest.length) largest = poly[0];
    }
    coords = largest;
  } else {
    return null;
  }

  // GeoJSON is [lng, lat], H3 expects [lat, lng]
  const h3Coords = coords.map(([lng, lat]: number[]) => [lat, lng]);
  return h3Coords.length >= 3 ? h3Coords : null;
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

  // Update is_searchable based on population data (if available)
  // A hex is searchable if any of its resolution-8 children have population > 50
  // For simplicity: check if the hex itself or its parent area has population
  await adminPool.query(
    `UPDATE prp_tenant_territories tt
     SET is_searchable = EXISTS (
       SELECT 1 FROM prp_population_lookup pl
       WHERE pl.h3_index LIKE (LEFT(tt.h3_index, 8) || '%')
       AND pl.population > 50
     )
     WHERE tt.tenant_id = $1`,
    [tenantId],
  ).catch(() => {
    // If population table is empty or query fails, keep all as searchable
    logger.info(`[H3Territory] Population filter not applied (table may be empty)`);
  });

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
