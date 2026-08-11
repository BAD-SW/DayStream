import * as h3 from 'h3-js';
import { adminPool } from '../db/pool';
import { logger } from '../middleware/logger';

const H3_RESOLUTION = 6; // ~7km edge length, good for regional franchise territories
const HEX_EDGE_LENGTH_KM = 7;

/**
 * Generate H3 hexagon indexes for a territory defined by center + radius.
 */
export function generateTerritoryHexagons(lat: number, lng: number, radiusKm: number): string[] {
  const centerHex = h3.latLngToCell(lat, lng, H3_RESOLUTION);
  const ringSize = Math.ceil(radiusKm / (HEX_EDGE_LENGTH_KM * 1.5));
  const hexagons = h3.gridDisk(centerHex, ringSize);
  return hexagons;
}

/**
 * Save territory hexagons for a tenant (replaces any existing assignment).
 */
export async function saveTerritoryHexagons(tenantId: string, hexagons: string[]): Promise<number> {
  // Clear existing territory
  await adminPool.query('DELETE FROM prp_tenant_territories WHERE tenant_id = $1', [tenantId]);

  if (hexagons.length === 0) return 0;

  // Batch insert
  const values: string[] = [];
  const params: any[] = [];
  let idx = 1;

  for (const hex of hexagons) {
    values.push(`($${idx++}, $${idx++})`);
    params.push(tenantId, hex);
  }

  await adminPool.query(
    `INSERT INTO prp_tenant_territories (tenant_id, h3_index) VALUES ${values.join(', ')} ON CONFLICT DO NOTHING`,
    params,
  );

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
