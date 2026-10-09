import { apiClient } from './client';

/**
 * Territory resolution/preview/save API (system admin). Lets an admin type a place
 * name, see the candidate administrative areas (city vs province vs state, like
 * Google Maps), preview the exact boundary + hex coverage, and confirm before saving.
 */

export interface TerritoryCandidate {
  id: string;                 // osm ref, or 'viewport' for the approximate fallback
  label: string;              // full display name
  kind: string;               // 'state' | 'province' | 'county' | 'city' | 'country' | 'area' | 'approximate'
  lat: number;
  lng: number;
  geojson: GeoJsonGeometry | null;  // boundary (null for the approximate/viewport option)
  hexCount: number;           // how many H3 cells this territory would cover
  resolution: number;         // H3 resolution used (coarser for very large areas)
  complete: boolean;          // false => coverage was capped (very large area)
  hasBoundary: boolean;       // false => approximate rectangle (no precise boundary)
}

export interface GeoJsonGeometry {
  type: 'Polygon' | 'MultiPolygon';
  coordinates: any;
}

/** Resolve a place name to boundary candidates (no DB write). */
export async function previewTerritory(tenantId: string, query: string): Promise<TerritoryCandidate[]> {
  const res = await apiClient.post(`/v1/prospects/territories/${tenantId}/preview`, { query });
  return res.data.data.candidates;
}

export interface SaveTerritoryResult {
  id: string;
  name: string;
  territory_lat: number | null;
  territory_lng: number | null;
  territory_address: string;
  hexagons: number;
  resolution: number;
  complete: boolean;
  hasBoundary: boolean;
  componentCount?: number;
}

/** Save a single chosen candidate as the tenant's territory. */
export async function saveTerritory(tenantId: string, candidate: TerritoryCandidate): Promise<SaveTerritoryResult> {
  return saveTerritoryComposition(tenantId, [candidate]);
}

/**
 * Save a COMPOSED territory — the union of several chosen areas (e.g. counties).
 * The component list is persisted so a franchise contract can enumerate exactly
 * which areas are included.
 */
export async function saveTerritoryComposition(tenantId: string, candidates: TerritoryCandidate[]): Promise<SaveTerritoryResult> {
  // Send only lightweight refs — NOT the boundary geometry. A many-area composition
  // of full polygons would exceed the request body size limit; the server re-resolves
  // each boundary from its OSM id. The 'viewport' (approximate) option has no id, so
  // it carries its lat/lng for the server's disk fallback.
  const res = await apiClient.put(`/v1/prospects/territories/${tenantId}`, {
    components: candidates.map((c) => ({
      id: c.id,
      label: c.label,
      kind: c.kind,
      lat: c.lat,
      lng: c.lng,
      // Keep geojson only for the approximate option (no OSM id to look up).
      ...(c.id === 'viewport' ? { geojson: c.geojson ?? null } : {}),
    })),
  });
  return res.data.data;
}

/** A stored territory component (contract enumeration). */
export interface TerritoryComponent {
  id: string | null;
  label: string;
  kind: string | null;
  lat: number | null;
  lng: number | null;
}

export interface CurrentTerritory {
  id: string;
  name: string;
  territory_lat: number | null;
  territory_lng: number | null;
  territory_address: string | null;
  territory_components: TerritoryComponent[];
  hexagons: number;
}

/** Read the tenant's current territory composition (components + totals). */
export async function getTerritory(tenantId: string): Promise<CurrentTerritory> {
  const res = await apiClient.get(`/v1/prospects/territories/${tenantId}`);
  return res.data.data;
}

/**
 * Re-hydrate stored territory components (which carry only {id,label,kind,lat,lng}
 * — the boundary geometry was stripped on save) back into full candidates WITH
 * boundary geojson + hex counts. Lets the picker pre-load the saved territory into
 * its editable "Selected areas" list and draw the outline on the map on open.
 */
export async function hydrateTerritoryComponents(components: TerritoryComponent[]): Promise<TerritoryCandidate[]> {
  const res = await apiClient.post('/v1/prospects/territories/hydrate', {
    components: components.map((c) => ({
      id: c.id,
      label: c.label,
      kind: c.kind,
      lat: c.lat,
      lng: c.lng,
    })),
  });
  return res.data.data.components;
}
