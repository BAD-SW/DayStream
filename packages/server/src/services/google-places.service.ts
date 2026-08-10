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
  throw new Error('GOOGLE_PLACES_API_KEY not configured. Set it under Configuration → API Keys.');
}

interface PlaceResult {
  place_id: string;
  name: string;
  address: string;
  phone?: string;
  website?: string;
  category?: string;
  rating?: number;
  review_count?: number;
}

/**
 * Search for places near a location using Google Places Nearby Search API.
 * Returns up to 60 results (3 pages of 20).
 */
export async function searchNearbyPlaces(lat: number, lng: number, radiusMeters: number, type: string): Promise<PlaceResult[]> {
  const API_KEY = await getApiKey();

  const results: PlaceResult[] = [];
  let nextPageToken: string | undefined;

  for (let page = 0; page < 3; page++) {
    const url = new URL('https://maps.googleapis.com/maps/api/place/nearbysearch/json');
    url.searchParams.set('key', API_KEY);
    url.searchParams.set('location', `${lat},${lng}`);
    url.searchParams.set('radius', String(Math.min(radiusMeters, 50000))); // max 50km per request
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
    if (data.status !== 'OK' && data.status !== 'ZERO_RESULTS') {
      logger.error(`[GooglePlaces] API error: ${data.status} - ${data.error_message || ''}`);
      if (data.status === 'ZERO_RESULTS') break;
      throw new Error(`Google Places API error: ${data.status}`);
    }

    for (const place of (data.results || [])) {
      results.push({
        place_id: place.place_id,
        name: place.name,
        address: place.vicinity || place.formatted_address || '',
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

  // For each result, optionally fetch details (phone, website) if needed
  // This is a separate API call per place — expensive. Only do for the first batch.
  const detailedResults: PlaceResult[] = [];
  for (const place of results) {
    try {
      const details = await getPlaceDetails(place.place_id);
      detailedResults.push({ ...place, phone: details.phone, website: details.website, address: details.address || place.address });
    } catch {
      detailedResults.push(place); // Use basic info if details fail
    }
  }

  logger.info(`[GooglePlaces] Found ${detailedResults.length} places for type=${type} near ${lat},${lng}`);
  return detailedResults;
}

/**
 * Get place details (phone, website) for a specific place.
 */
async function getPlaceDetails(placeId: string): Promise<{ phone?: string; website?: string; address?: string }> {
  let API_KEY: string;
  try { API_KEY = await getApiKey(); } catch { return {}; }

  const url = new URL('https://maps.googleapis.com/maps/api/place/details/json');
  url.searchParams.set('key', API_KEY);
  url.searchParams.set('place_id', placeId);
  url.searchParams.set('fields', 'formatted_phone_number,website,formatted_address');

  const response = await fetch(url.toString());
  if (!response.ok) return {};

  const data = await response.json() as any;
  if (data.status !== 'OK') return {};

  return {
    phone: data.result?.formatted_phone_number || undefined,
    website: data.result?.website || undefined,
    address: data.result?.formatted_address || undefined,
  };
}
