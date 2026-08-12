import { logger } from '../middleware/logger';
import { adminPool } from '../db/pool';

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

  // Append location name to query for geographic restriction
  const query = locationName ? `${keyword} in ${locationName}` : keyword;

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
