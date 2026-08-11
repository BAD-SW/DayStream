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
  lat?: number;
  lng?: number;
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
  const MAX_RADIUS = 50000; // Google's max per request

  if (radiusMeters <= MAX_RADIUS) {
    const results = await searchSingleArea(lat, lng, radiusMeters, type);
    logger.info(`[GooglePlaces] Found ${results.length} places for type=${type} near ${lat},${lng} (radius=${radiusMeters}m)`);
    return results;
  }

  // For larger areas, search from center + ring points
  const allResults = new Map<string, PlaceResult>();
  const radiusKm = radiusMeters / 1000;

  // Center search
  const centerResults = await searchSingleArea(lat, lng, MAX_RADIUS, type);
  for (const place of centerResults) {
    allResults.set(place.place_id, place);
  }

  // Ring searches — place points at 45km offset so their 50km circles cover 0-95km from center
  const stepKm = 45;
  const rings = Math.ceil((radiusKm - 50) / stepKm);
  for (let ring = 1; ring <= rings; ring++) {
    const offsetKm = ring * stepKm;
    const numPoints = Math.max(6, ring * 6);
    for (let i = 0; i < numPoints; i++) {
      const angle = (2 * Math.PI * i) / numPoints;
      const pointLat = lat + (offsetKm / 111.32) * Math.cos(angle);
      const pointLng = lng + (offsetKm / (111.32 * Math.cos(lat * Math.PI / 180))) * Math.sin(angle);

      const places = await searchSingleArea(pointLat, pointLng, MAX_RADIUS, type);
      for (const place of places) {
        if (allResults.has(place.place_id)) continue;
        // Only include if within requested radius from original center
        if (place.lat && place.lng) {
          const dist = haversineKm(lat, lng, place.lat, place.lng);
          if (dist > radiusKm) continue;
        }
        allResults.set(place.place_id, place);
      }
    }
  }

  logger.info(`[GooglePlaces] Found ${allResults.size} places for type=${type} near ${lat},${lng} (radius=${radiusKm}km, ${rings} ring(s))`);
  return Array.from(allResults.values());
}

function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

async function searchSingleArea(lat: number, lng: number, radiusMeters: number, type: string): Promise<PlaceResult[]> {
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

  // For each result, optionally fetch details (phone, website) if needed
  // Skipping detail fetch for speed — basic info is sufficient for prospect list
  // Details can be enriched later on demand

  return results;
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


/**
 * Geocode a postal code to lat/lng using Google Geocoding API.
 */
export async function geocodePostalCode(postalCode: string): Promise<{ lat: number; lng: number } | null> {
  const API_KEY = await getApiKey();

  const url = new URL('https://maps.googleapis.com/maps/api/geocode/json');
  url.searchParams.set('key', API_KEY);
  url.searchParams.set('address', postalCode);

  const response = await fetch(url.toString());
  if (!response.ok) return null;

  const data = await response.json() as any;
  if (data.status !== 'OK' || !data.results || data.results.length === 0) return null;

  const location = data.results[0].geometry?.location;
  if (!location) return null;

  return { lat: location.lat, lng: location.lng };
}
