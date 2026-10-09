import * as h3 from 'h3-js';
import { logger } from '../middleware/logger';
import { adminPool } from '../db/pool';

// ============================================================
// Polite Nominatim (OpenStreetMap) client — the public service rate-limits to
// ~1 req/sec and returns HTTP 429 when exceeded. We SERIALIZE requests ≥1.1s
// apart and retry on 429 with backoff, so territory boundary lookups don't
// silently degrade to "approximate". Results are cached in prp_geo_cache so
// repeat lookups never touch the live service (admin boundaries don't change).
// ============================================================

const NOMINATIM_MIN_INTERVAL_MS = 1100;
let nominatimChain: Promise<void> = Promise.resolve(); // serializes all calls
let lastNominatimAt = 0;

/** Thrown when Nominatim is unreachable/throttled — distinct from "no result". */
export class GeoLookupUnavailableError extends Error {
  constructor(message = 'Boundary lookup service is temporarily unavailable (rate limited). Please retry.') {
    super(message);
    this.name = 'GeoLookupUnavailableError';
  }
}

/** Serialize + space out Nominatim calls; retry on 429/5xx. Returns parsed JSON. */
async function nominatimFetch(url: URL, attempt = 0): Promise<any> {
  // Chain onto the previous call so requests never overlap.
  const run = nominatimChain.then(async () => {
    const since = Date.now() - lastNominatimAt;
    if (since < NOMINATIM_MIN_INTERVAL_MS) await new Promise((r) => setTimeout(r, NOMINATIM_MIN_INTERVAL_MS - since));
    lastNominatimAt = Date.now();
  });
  nominatimChain = run.catch(() => {});
  await run;

  const res = await fetch(url.toString(), {
    headers: { 'User-Agent': 'DayStream/1.0 (territory-management; contact admin@daystream.app)' },
  });

  if (res.status === 429 || res.status >= 500) {
    if (attempt < 3) {
      const backoff = 1500 * (attempt + 1);
      logger.warn(`[Nominatim] ${res.status}; retrying in ${backoff}ms (attempt ${attempt + 1}/3)`);
      await new Promise((r) => setTimeout(r, backoff));
      return nominatimFetch(url, attempt + 1);
    }
    throw new GeoLookupUnavailableError();
  }
  if (!res.ok) throw new GeoLookupUnavailableError(`Boundary lookup failed (${res.status}).`);
  return res.json();
}

/** Read a cached geo payload by key, or null. */
async function readGeoCache(key: string): Promise<any | null> {
  try {
    const { rows } = await adminPool.query(`SELECT payload FROM prp_geo_cache WHERE cache_key = $1`, [key]);
    return rows[0]?.payload ?? null;
  } catch { return null; }
}

/** Upsert a cached geo payload. */
async function writeGeoCache(key: string, kind: 'search' | 'lookup', payload: any): Promise<void> {
  try {
    await adminPool.query(
      `INSERT INTO prp_geo_cache (cache_key, kind, payload) VALUES ($1, $2, $3)
       ON CONFLICT (cache_key) DO UPDATE SET payload = $3, updated_at = NOW()`,
      [key, kind, JSON.stringify(payload)],
    );
  } catch { /* cache write is best-effort */ }
}

async function getApiKey(): Promise<string> {
  // Try DB config first, fall back to env var
  const { rows } = await adminPool.query(
    `SELECT config_data FROM sys_system_configurations WHERE category = 'api_keys'`,
  );
  const keys = rows[0]?.config_data;
  if (keys?.google_places) return keys.google_places;
  if (process.env.GOOGLE_PLACES_API_KEY) return process.env.GOOGLE_PLACES_API_KEY;
  throw new Error('GOOGLE_PLACES_API_KEY not configured. Set it under Configuration \u2192 API Keys.');
}

interface PlaceResult {
  place_id: string;
  name: string;
  address: string;
  city?: string;
  lat?: number;
  lng?: number;
  phone?: string;
  website?: string;
  category?: string;
  rating?: number;
  review_count?: number;
}

/**
 * Extract city from a formatted address string.
 * Heuristic: for most addresses, the city is typically the segment before the postal code/country.
 */
function extractCity(address: string): string | undefined {
  if (!address) return undefined;
  const parts = address.split(',').map(s => s.trim());
  // Usually: street, city, state/region, country — or variations
  // Try to find a segment that looks like a city (not a number/postal code, not the last segment which is often country)
  if (parts.length >= 3) {
    // Skip last part (country), skip parts with postal codes
    for (let i = parts.length - 2; i >= 1; i--) {
      const part = parts[i];
      // Skip if it's mostly numbers (postal code)
      if (/^\d{3,}/.test(part)) continue;
      // Skip if it contains a postal code pattern
      if (/\d{4,}/.test(part)) continue;
      return part;
    }
  }
  return parts.length >= 2 ? parts[1] : undefined;
}

/**
 * Search for places using Text Search with a keyword near a specific location.
 * Combines hex-center location bias with natural language keyword for better relevance.
 * Post-filters results by exclusion types.
 */
export async function searchByKeyword(lat: number, lng: number, radiusMeters: number, keyword: string, exclusionTypes: string[], locationName?: string): Promise<PlaceResult[]> {
  const API_KEY = await getApiKey();
  const results: PlaceResult[] = [];
  let nextPageToken: string | undefined;

  // Localize by lat/lng + radius only (NOT a text location phrase) — see
  // searchByKeywordDetailed for why the "in <locationName>" hint was removed.
  void locationName;
  const query = keyword;

  for (let page = 0; page < 3; page++) {
    const url = new URL('https://maps.googleapis.com/maps/api/place/textsearch/json');
    url.searchParams.set('key', API_KEY);
    url.searchParams.set('query', query);
    url.searchParams.set('location', `${lat},${lng}`);
    url.searchParams.set('radius', String(radiusMeters));
    if (nextPageToken) {
      url.searchParams.set('pagetoken', nextPageToken);
    }

    const response = await fetch(url.toString());
    if (!response.ok) break;

    const data = await response.json() as any;
    if (data.status === 'ZERO_RESULTS') break;
    if (data.status !== 'OK') {
      logger.error(`[GooglePlaces] TextSearch error: ${data.status} - ${data.error_message || ''}`);
      break;
    }

    for (const place of (data.results || [])) {
      // Post-filter: exclude businesses with undesirable types
      const placeTypes: string[] = place.types || [];
      if (exclusionTypes.length > 0 && exclusionTypes.some(ex => placeTypes.includes(ex))) continue;

      const formattedAddress = place.formatted_address || place.vicinity || '';
      results.push({
        place_id: place.place_id,
        name: place.name,
        address: formattedAddress,
        city: extractCity(formattedAddress),
        lat: place.geometry?.location?.lat,
        lng: place.geometry?.location?.lng,
        category: keyword,
        rating: place.rating || undefined,
        review_count: place.user_ratings_total || 0,
      });
    }

    nextPageToken = data.next_page_token;
    if (!nextPageToken) break;
    await new Promise(resolve => setTimeout(resolve, 2000));
  }

  return results;
}

export interface KeywordSearchResult {
  results: PlaceResult[];
  /** True if Google still had MORE results than this call could return (3-page / 60
   *  cap reached with a next-page token). The cell is "saturated" and must be drilled
   *  down to capture the rest. Based on raw page fullness, NOT the post-exclusion
   *  count (exclusions can drop results below 60 even when the area is saturated). */
  saturated: boolean;
  /** Number of Google Places HTTP requests this call made (for cost accounting). */
  apiCalls: number;
}

/**
 * Like searchByKeyword, but reports whether the search center is SATURATED (Google
 * had more than the 60-result cap could return) so the caller can drill down into
 * finer sub-cells. Also reports the number of API calls made, for cost accounting.
 */
export async function searchByKeywordDetailed(
  lat: number, lng: number, radiusMeters: number, keyword: string, exclusionTypes: string[], locationName?: string,
): Promise<KeywordSearchResult> {
  const API_KEY = await getApiKey();
  const results: PlaceResult[] = [];
  let nextPageToken: string | undefined;
  let apiCalls = 0;
  let saturated = false;
  // IMPORTANT: localization comes ONLY from the lat/lng + radius below, NOT from a
  // text location phrase. Previously the query was `${keyword} in ${locationName}`,
  // where locationName was the territory label (e.g. "County A + County B"); Google
  // re-ranked against that free-text string, so a composed territory returned a
  // DIFFERENT set than its parts (non-deterministic, inaccurate). Keyword-only +
  // geographic bias makes results depend solely on WHERE we search (the hex center)
  // and the res-7 boundary geo-filter applied by the caller — so combined == union
  // of parts. `locationName` is intentionally unused now (kept for signature compat).
  void locationName;
  const query = keyword;

  for (let page = 0; page < 3; page++) {
    const url = new URL('https://maps.googleapis.com/maps/api/place/textsearch/json');
    url.searchParams.set('key', API_KEY);
    url.searchParams.set('query', query);
    url.searchParams.set('location', `${lat},${lng}`);
    url.searchParams.set('radius', String(radiusMeters));
    if (nextPageToken) url.searchParams.set('pagetoken', nextPageToken);

    const response = await fetch(url.toString());
    apiCalls++;
    if (!response.ok) break;
    const data = await response.json() as any;
    if (data.status === 'ZERO_RESULTS') break;
    if (data.status !== 'OK') {
      logger.error(`[GooglePlaces] TextSearch error: ${data.status} - ${data.error_message || ''}`);
      break;
    }

    for (const place of (data.results || [])) {
      const placeTypes: string[] = place.types || [];
      if (exclusionTypes.length > 0 && exclusionTypes.some((ex) => placeTypes.includes(ex))) continue;
      const formattedAddress = place.formatted_address || place.vicinity || '';
      results.push({
        place_id: place.place_id,
        name: place.name,
        address: formattedAddress,
        city: extractCity(formattedAddress),
        lat: place.geometry?.location?.lat,
        lng: place.geometry?.location?.lng,
        category: keyword,
        rating: place.rating || undefined,
        review_count: place.user_ratings_total || 0,
      });
    }

    nextPageToken = data.next_page_token;
    if (!nextPageToken) break;
    // A next-page token after the final (3rd) page means Google has still more
    // results than the 60-cap exposes → this center is saturated.
    if (page === 2) saturated = true;
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }

  return { results, saturated, apiCalls };
}

// Approximate H3 hexagon edge length (meters) per resolution, for sizing the
// Places search radius to a cell. (H3 res 4≈22.6km down to res 9≈0.17km.)
const H3_EDGE_METERS: Record<number, number> = {
  4: 22606, 5: 8544, 6: 3229, 7: 1220, 8: 461, 9: 174,
};
/** A search radius that comfortably covers a cell at the given resolution. */
function radiusForResolution(res: number): number {
  const edge = H3_EDGE_METERS[res] ?? 1220;
  return Math.round(edge * 1.3); // slight overlap so cell corners aren't missed
}

/** The finest resolution we'll drill to. Res 9 ≈ 0.17km edge — fine enough that a
 *  single cell rarely exceeds Google's 60-result cap even downtown. */
const MAX_DRILL_RESOLUTION = 9;

export interface DrillSearchResult {
  results: PlaceResult[];
  apiCalls: number;
  cellsSearched: number;
  cellsSaturatedAtMaxRes: number; // cells still saturated at the finest resolution (rare)
}

/**
 * Recursive density drill-down search for ONE category over ONE starting cell.
 *
 * Searches the cell; if the center is SATURATED (Google had more than the 60-result
 * cap), the cell is split into its finer H3 children and each child is searched —
 * recursively — until no cell is saturated or MAX_DRILL_RESOLUTION is reached. This
 * captures the FULL set of businesses in dense areas rather than silently keeping
 * only the first 60 per cell. Results are unioned and de-duplicated by place_id.
 *
 * Accuracy-first: cost scales with density (only saturated cells are split), which
 * is the intended trade-off — an accurate opportunity list matters more than calls.
 */
export async function searchCellRecursive(
  cellHex: string, keyword: string, exclusionTypes: string[], locationName: string | undefined,
  acc: { byId: Map<string, PlaceResult>; apiCalls: number; cellsSearched: number; cellsSaturatedAtMaxRes: number },
): Promise<void> {
  const res = h3.getResolution(cellHex);
  const [lat, lng] = h3.cellToLatLng(cellHex);
  const radius = radiusForResolution(res);

  const { results, saturated, apiCalls } = await searchByKeywordDetailed(lat, lng, radius, keyword, exclusionTypes, locationName);
  acc.apiCalls += apiCalls;
  acc.cellsSearched += 1;
  for (const p of results) if (!acc.byId.has(p.place_id)) acc.byId.set(p.place_id, p);

  if (!saturated) return;                       // got everything in this cell
  if (res >= MAX_DRILL_RESOLUTION) {            // can't drill finer — note it and stop
    acc.cellsSaturatedAtMaxRes += 1;
    return;
  }
  // Saturated: split into finer children and recurse each.
  const children = h3.cellToChildren(cellHex, res + 1);
  for (const child of children) {
    await searchCellRecursive(child, keyword, exclusionTypes, locationName, acc);
  }
}

/**
 * Search for places using Google Nearby Search from a specific point.
 * Used for per-hexagon searching to break the 60-result cap.
 * Returns up to 60 results (3 pages of 20).
 */
export async function searchHexArea(lat: number, lng: number, radiusMeters: number, type: string): Promise<PlaceResult[]> {
  const API_KEY = await getApiKey();
  const results: PlaceResult[] = [];
  let nextPageToken: string | undefined;

  for (let page = 0; page < 3; page++) {
    const url = new URL('https://maps.googleapis.com/maps/api/place/nearbysearch/json');
    url.searchParams.set('key', API_KEY);
    url.searchParams.set('location', `${lat},${lng}`);
    url.searchParams.set('radius', String(radiusMeters));
    url.searchParams.set('type', type);
    if (nextPageToken) {
      url.searchParams.set('pagetoken', nextPageToken);
    }

    const response = await fetch(url.toString());
    if (!response.ok) break;

    const data = await response.json() as any;
    if (data.status === 'ZERO_RESULTS') break;
    if (data.status !== 'OK') {
      logger.error(`[GooglePlaces] Nearby error: ${data.status} - ${data.error_message || ''}`);
      break;
    }

    for (const place of (data.results || [])) {
      // Post-filter: only include if the requested type is in the place's actual types
      const placeTypes: string[] = place.types || [];
      if (!placeTypes.includes(type)) continue;

      results.push({
        place_id: place.place_id,
        name: place.name,
        address: place.vicinity || place.formatted_address || '',
        lat: place.geometry?.location?.lat,
        lng: place.geometry?.location?.lng,
        category: type,
        rating: place.rating || undefined,
        review_count: place.user_ratings_total || 0,
      });
    }

    nextPageToken = data.next_page_token;
    if (!nextPageToken) break;
    await new Promise(resolve => setTimeout(resolve, 2000));
  }

  return results;
}

/**
 * Search for places using Google Places Text Search API.
 * Uses the territory location as the query region and the category type as a filter.
 * Returns up to 60 results (3 pages of 20).
 */
export async function searchByText(location: string, type: string): Promise<PlaceResult[]> {
  const API_KEY = await getApiKey();

  const results: PlaceResult[] = [];
  let nextPageToken: string | undefined;

  // Combine type + location for better results (e.g., "spa in Western New York")
  const query = `${type.replace(/_/g, ' ')} in ${location}`;

  for (let page = 0; page < 3; page++) {
    const url = new URL('https://maps.googleapis.com/maps/api/place/textsearch/json');
    url.searchParams.set('key', API_KEY);
    url.searchParams.set('query', query);
    url.searchParams.set('type', type);
    if (nextPageToken) {
      url.searchParams.set('pagetoken', nextPageToken);
    }

    const response = await fetch(url.toString());
    if (!response.ok) {
      logger.error(`[GooglePlaces] HTTP ${response.status}: ${response.statusText}`);
      break;
    }

    const data = await response.json() as any;
    if (data.status === 'ZERO_RESULTS') break;
    if (data.status !== 'OK') {
      logger.error(`[GooglePlaces] API error: ${data.status} - ${data.error_message || ''}`);
      throw new Error(`Google Places API error: ${data.status}`);
    }

    for (const place of (data.results || [])) {
      results.push({
        place_id: place.place_id,
        name: place.name,
        address: place.formatted_address || '',
        lat: place.geometry?.location?.lat,
        lng: place.geometry?.location?.lng,
        category: type,
        rating: place.rating || undefined,
        review_count: place.user_ratings_total || 0,
      });
    }

    nextPageToken = data.next_page_token;
    if (!nextPageToken) break;

    // Google requires a short delay before using the next page token
    await new Promise(resolve => setTimeout(resolve, 2000));
  }

  logger.info(`[GooglePlaces] Found ${results.length} places for type=${type} in "${location}" (query="${query}")`);
  return results;
}

/**
 * Geocode a location and retrieve its boundary polygon.
 * Uses Google Geocoding for accurate center point, then Nominatim for boundary polygon.
 */
export async function geocodePostalCode(location: string): Promise<{ lat: number; lng: number; geojson?: any; viewport?: { ne: { lat: number; lng: number }; sw: { lat: number; lng: number } } } | null> {
  // Use Google Geocoding for accurate center point
  const API_KEY = await getApiKey();

  const url = new URL('https://maps.googleapis.com/maps/api/geocode/json');
  url.searchParams.set('key', API_KEY);
  url.searchParams.set('address', location);

  const response = await fetch(url.toString());
  if (!response.ok) return null;

  const data = await response.json() as any;
  if (data.status !== 'OK' || !data.results || data.results.length === 0) return null;

  const geoResult = data.results[0];
  const coords = geoResult.geometry?.location;
  if (!coords) return null;

  const viewport = geoResult.geometry?.viewport;
  const bounds = viewport ? {
    ne: { lat: viewport.northeast.lat, lng: viewport.northeast.lng },
    sw: { lat: viewport.southwest.lat, lng: viewport.southwest.lng },
  } : undefined;

  // Try Nominatim forward search for boundary polygon (works for countries, states, cities)
  let geojson: any = undefined;
  try {
    const nomUrl = new URL('https://nominatim.openstreetmap.org/search');
    nomUrl.searchParams.set('q', location);
    nomUrl.searchParams.set('format', 'json');
    nomUrl.searchParams.set('polygon_geojson', '1');
    nomUrl.searchParams.set('limit', '1');

    const nomResponse = await fetch(nomUrl.toString(), {
      headers: { 'User-Agent': 'DayStream/1.0 (prospect-management)' },
    });

    if (nomResponse.ok) {
      const nomData = await nomResponse.json() as any[];
      if (nomData.length > 0 && nomData[0].geojson && (nomData[0].geojson.type === 'Polygon' || nomData[0].geojson.type === 'MultiPolygon')) {
        geojson = nomData[0].geojson;
      }
    }
  } catch { /* Boundary polygon is optional */ }

  return { lat: coords.lat, lng: coords.lng, geojson, viewport: bounds };
}

/**
 * A resolved territory candidate: a named administrative area with a true boundary.
 * Multiple candidates let the admin disambiguate (e.g. "Valencia" the city vs the
 * province vs the autonomous community) — like Google Maps resolving a name.
 */
export interface TerritoryCandidate {
  id: string;                 // stable ref: osm_type + osm_id (e.g. "relation/349043")
  label: string;              // human display name (Nominatim display_name)
  kind: string;               // normalized area kind: 'country'|'state'|'province'|'county'|'city'|'area'
  rawType: string;            // Nominatim class/type for debugging (e.g. 'boundary/administrative')
  lat: number;
  lng: number;
  viewport?: { ne: { lat: number; lng: number }; sw: { lat: number; lng: number } };
  geojson: any;               // Polygon | MultiPolygon boundary
}

// Nominatim `place` types that are genuine populated/administrative AREAS (as
// opposed to businesses, POIs, roads, etc.). A territory must be one of these.
const AREAL_PLACE_TYPES = new Set([
  'country', 'state', 'region', 'province', 'county', 'state_district', 'district',
  'municipality', 'city', 'town', 'village', 'borough', 'suburb', 'island', 'archipelago',
  'territory', 'department', 'canton',
]);

/**
 * Is this Nominatim result a usable territory (an administrative/populated AREA)
 * rather than a business, POI, road, address, etc.? Admin boundaries come back as
 * class='boundary' type='administrative'; populated areas as class='place' with an
 * areal type. Everything else (shop/amenity/office/industrial/building/highway/...)
 * is rejected — that's what let "Panhandle Landscape Solutions" slip through before.
 */
// Classes that are never a territory (businesses, land parcels, roads, buildings,
// addresses, natural features, etc.). Anything in these is rejected outright — this
// is what keeps "Panhandle Landscape Solutions" (landuse) and roads (highway) out.
const NON_TERRITORY_CLASSES = new Set([
  'shop', 'amenity', 'office', 'landuse', 'highway', 'building', 'craft', 'tourism',
  'leisure', 'man_made', 'natural', 'railway', 'aeroway', 'waterway', 'historic',
  'emergency', 'military', 'power', 'barrier', 'addr',
]);

/**
 * Is this Nominatim result a usable territory (an administrative or named region
 * AREA) rather than a business, POI, road, address, etc.?
 *   - Official admin areas: class='boundary' type='administrative'.
 *   - Named regions: class='boundary' with a region-ish type, OR class='place' with
 *     an areal type (state/region/county/city/island/...). OSM tags vernacular
 *     regions (e.g. "Finger Lakes", "Western New York") inconsistently as either, so
 *     we accept both and lean on geometry (Polygon/MultiPolygon) + the class blocklist.
 * Businesses/roads/parcels (shop/landuse/highway/...) are rejected.
 */
function isTerritoryResult(result: any): boolean {
  // jsonv2 uses `category`; older `json` format uses `class`. Accept either.
  const cls: string = result.category || result.class || '';
  const type: string = result.type || '';
  if (!cls) return false;
  if (NON_TERRITORY_CLASSES.has(cls)) return false;        // definitely not a territory
  if (cls === 'boundary') return true;                     // administrative or named region boundary
  if (cls === 'place' && AREAL_PLACE_TYPES.has(type)) return true; // populated/areal place
  return false;
}

/**
 * Map a Nominatim result's class/type/address to a friendly area kind, so the UI
 * can show "state" / "province" / "city" next to each candidate.
 */
function classifyArea(result: any): string {
  const addressType: string = result.addresstype || result.type || '';
  const cls: string = result.category || result.class || '';
  const map: Record<string, string> = {
    country: 'country',
    state: 'state',
    region: 'region',
    province: 'province',
    county: 'county',
    district: 'district',
    state_district: 'province',
    department: 'department',
    canton: 'canton',
    city: 'city',
    town: 'city',
    village: 'city',
    borough: 'city',
    suburb: 'city',
    municipality: 'city',
    island: 'island',
    archipelago: 'region',
    administrative: 'area',
  };
  if (map[addressType]) return map[addressType];
  if (cls === 'boundary') return 'area';
  if (cls === 'place') return 'city';
  return addressType || cls || 'area';
}

/**
 * Resolve a location string to a ranked list of boundary candidates (via Nominatim),
 * each with its true boundary polygon. Only candidates WITH a real Polygon/MultiPolygon
 * boundary are returned — informal names with no administrative boundary yield an empty
 * list, which the caller surfaces as "no precise boundary found" rather than silently
 * tiling a rectangle. Ranked by Nominatim importance (most prominent first).
 */
export async function resolveTerritoryCandidates(query: string, limit = 8): Promise<TerritoryCandidate[]> {
  const cacheKey = `search:${query.trim().toLowerCase()}`;
  const cached = await readGeoCache(cacheKey);
  if (cached) return cached as TerritoryCandidate[];

  const url = new URL('https://nominatim.openstreetmap.org/search');
  url.searchParams.set('q', query);
  url.searchParams.set('format', 'jsonv2');
  url.searchParams.set('polygon_geojson', '1');
  url.searchParams.set('addressdetails', '1');
  url.searchParams.set('limit', String(limit));

  // Throws GeoLookupUnavailableError on 429/5xx — callers must NOT treat that as
  // "no boundary" (which would mislabel a real area as approximate).
  const data = (await nominatimFetch(url)) as any[];

  const candidates: TerritoryCandidate[] = [];
  for (const r of data) {
    if (!isTerritoryResult(r)) continue; // administrative/populated AREAS only — not businesses/POIs
    const gj = r.geojson;
    if (!gj || (gj.type !== 'Polygon' && gj.type !== 'MultiPolygon')) continue; // real boundary required
    const bb = Array.isArray(r.boundingbox) ? r.boundingbox.map(Number) : null; // [south, north, west, east]
    candidates.push({
      id: `${r.osm_type}/${r.osm_id}`,
      label: r.display_name,
      kind: classifyArea(r),
      rawType: `${r.category || r.class}/${r.type}`,
      lat: parseFloat(r.lat),
      lng: parseFloat(r.lon),
      viewport: bb ? { ne: { lat: bb[1], lng: bb[3] }, sw: { lat: bb[0], lng: bb[2] } } : undefined,
      geojson: gj,
    });
  }
  // Nominatim returns in importance order; keep that. De-dup by id.
  const seen = new Set<string>();
  const deduped = candidates.filter((c) => (seen.has(c.id) ? false : (seen.add(c.id), true)));
  await writeGeoCache(cacheKey, 'search', deduped);
  return deduped;
}

/**
 * Look up a SINGLE area's boundary by its OSM reference (as returned in a
 * TerritoryCandidate.id, e.g. "relation/349043"). Used on save so the client can
 * send lightweight component refs instead of full geometry (which blows past the
 * request body size limit for a many-county composition). Returns the boundary
 * geojson + center, or null if not found / not a polygon.
 */
export async function lookupTerritoryBoundary(
  osmRef: string,
): Promise<{ geojson: any; lat: number; lng: number } | null> {
  const map = await lookupTerritoryBoundaries([osmRef]);
  return map.get(osmRef) ?? null;
}

/** Convert "<type>/<id>" to Nominatim's "<T><id>" lookup token (N/W/R). */
function osmRefToToken(osmRef: string): { token: string; ref: string } | null {
  const [type, id] = String(osmRef).split('/');
  const prefix = { node: 'N', way: 'W', relation: 'R' }[type as 'node' | 'way' | 'relation'];
  if (!prefix || !id) return null;
  return { token: `${prefix}${id}`, ref: osmRef };
}

/**
 * Batch-look up MANY areas' boundaries by OSM ref in a SINGLE Nominatim /lookup
 * call (comma-separated osm_ids, up to 50 per request). One request avoids the
 * rate-limiting / throttling that per-area calls hit, and keeps a many-county save
 * fast. Returns a map of osmRef -> { geojson, lat, lng } for those that resolved.
 */
export async function lookupTerritoryBoundaries(
  osmRefs: string[],
): Promise<Map<string, { geojson: any; lat: number; lng: number }>> {
  const out = new Map<string, { geojson: any; lat: number; lng: number }>();

  // Serve cached refs first; only hit Nominatim for the misses.
  const misses: string[] = [];
  for (const ref of osmRefs) {
    const cached = await readGeoCache(`lookup:${ref}`);
    if (cached) out.set(ref, cached as { geojson: any; lat: number; lng: number });
    else misses.push(ref);
  }

  const tokens = misses.map(osmRefToToken).filter((t): t is { token: string; ref: string } => !!t);
  // Nominatim /lookup accepts at most 50 osm_ids per request.
  for (let i = 0; i < tokens.length; i += 50) {
    const chunk = tokens.slice(i, i + 50);
    const byToken = new Map(chunk.map((t) => [t.token, t.ref]));
    const url = new URL('https://nominatim.openstreetmap.org/lookup');
    url.searchParams.set('osm_ids', chunk.map((t) => t.token).join(','));
    url.searchParams.set('format', 'jsonv2');
    url.searchParams.set('polygon_geojson', '1');

    // Throws GeoLookupUnavailableError on 429/5xx so a throttled save fails loudly
    // (and can be retried) rather than silently dropping counties.
    const data = (await nominatimFetch(url)) as any[];
    for (const r of data) {
      if (!r?.geojson || (r.geojson.type !== 'Polygon' && r.geojson.type !== 'MultiPolygon')) continue;
      const token = `${(r.osm_type || '')[0]?.toUpperCase()}${r.osm_id}`;
      const ref = byToken.get(token);
      if (ref) {
        const val = { geojson: r.geojson, lat: parseFloat(r.lat), lng: parseFloat(r.lon) };
        out.set(ref, val);
        await writeGeoCache(`lookup:${ref}`, 'lookup', val);
      }
    }
  }
  return out;
}
