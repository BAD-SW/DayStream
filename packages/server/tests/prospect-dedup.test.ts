import { describe, it, expect } from 'vitest';

import {
  normalizeNameTokens,
  nameSimilarity,
  haversineMeters,
  normalizeAddress,
  isSameBusiness,
  clusterBusinesses,
  coalesceField,
  DedupRecord,
} from '../src/services/prospect-dedup';

/**
 * De-dup fixtures from spec 31 design §5. Identity = name + location.
 *   - Advanced Care PT: same name, 6 different addresses  -> 6 distinct (do NOT merge)
 *   - Susan Naturally:  different name strings, same place -> merge
 *   - Grand Island PT vs Island Aesthetics: near + shared token, different -> do NOT merge
 */

describe('normalizeNameTokens', () => {
  it('lowercases, strips punctuation, drops filler words', () => {
    expect(normalizeNameTokens('The Susan Naturally Day Spa, LLC')).toEqual([
      'susan',
      'naturally',
      'day',
      'spa',
    ]);
  });

  it('keeps spa/salon as meaningful tokens', () => {
    expect(normalizeNameTokens('Thairapy Salon')).toEqual(['thairapy', 'salon']);
  });

  it('handles empty / whitespace', () => {
    expect(normalizeNameTokens('')).toEqual([]);
    expect(normalizeNameTokens('   ')).toEqual([]);
  });
});

describe('nameSimilarity', () => {
  it('returns 1 when one name is fully contained in the other (token-wise)', () => {
    expect(
      nameSimilarity('Susan Naturally Day Spa', 'Susan Naturally Day Spa featuring Susan Ciminelli'),
    ).toBe(1);
  });

  it('is low for names that only share a generic token', () => {
    const s = nameSimilarity('Grand Island Physical Therapy', 'Island Aesthetics');
    expect(s).toBeLessThan(0.6);
  });

  it('returns 0 when a name has no comparable tokens', () => {
    expect(nameSimilarity('', 'Anything')).toBe(0);
  });
});

describe('normalizeAddress', () => {
  it('lowercases, strips punctuation, and canonicalizes street abbreviations', () => {
    expect(normalizeAddress('636 N French Rd')).toBe('636 north french road');
    expect(normalizeAddress('636 n. french road')).toBe('636 north french road');
    expect(normalizeAddress('12 W Main St., Ste 4')).toBe('12 west main street suite 4');
  });

  it('treats differently-formatted versions of the same address as equal', () => {
    expect(normalizeAddress('636 N French Rd')).toBe(normalizeAddress('636 N. French Road'));
  });

  it('returns empty string for nullish/empty input', () => {
    expect(normalizeAddress(null)).toBe('');
    expect(normalizeAddress(undefined)).toBe('');
    expect(normalizeAddress('   ')).toBe('');
  });
});

describe('haversineMeters', () => {
  it('is ~0 for identical points', () => {
    expect(haversineMeters(42.9, -78.8, 42.9, -78.8)).toBeCloseTo(0, 5);
  });

  it('matches a known short distance (~111m per 0.001 lat deg)', () => {
    const d = haversineMeters(42.9, -78.8, 42.901, -78.8);
    expect(d).toBeGreaterThan(100);
    expect(d).toBeLessThan(120);
  });
});

describe('isSameBusiness', () => {
  it('merges same place with slightly different name strings (Susan Naturally)', () => {
    const a: DedupRecord = { name: 'Susan Naturally Day Spa', lat: 42.9000, lng: -78.8000 };
    const b: DedupRecord = {
      name: 'Susan Naturally Day Spa featuring Susan Ciminelli',
      lat: 42.90005,
      lng: -78.80005,
    };
    expect(isSameBusiness(a, b)).toBe(true);
  });

  it('does NOT merge same name at different addresses (Advanced Care chain)', () => {
    const a: DedupRecord = { name: 'Advanced Care Physical Therapy', lat: 42.9000, lng: -78.8000 };
    const b: DedupRecord = { name: 'Advanced Care Physical Therapy', lat: 43.0000, lng: -78.9000 };
    expect(isSameBusiness(a, b)).toBe(false);
  });

  it('merges same name + SAME address even when coordinates are far apart (Silk Massage bad geocode)', () => {
    // Real case: two "Silk Massage Spa" records at "636 N French Rd", one mis-geocoded ~4km east.
    const a: DedupRecord = { name: 'Silk Massage Spa', address: '636 N French Rd', lat: 43.03596, lng: -78.80113 };
    const b: DedupRecord = { name: 'Silk Massage Spa', address: '636 N French Rd', lat: 43.03495, lng: -78.75414 };
    expect(haversineMeters(a.lat, a.lng, b.lat, b.lng)).toBeGreaterThan(3000); // genuinely far apart
    expect(isSameBusiness(a, b)).toBe(true); // ...but same name + same address -> merge
  });

  it('merges across minor address formatting differences (Rd vs Road)', () => {
    const a: DedupRecord = { name: 'Silk Massage Spa', address: '636 N French Rd', lat: 43.036, lng: -78.801 };
    const b: DedupRecord = { name: 'Silk Massage Spa', address: '636 N. French Road', lat: 43.20, lng: -78.60 };
    expect(isSameBusiness(a, b)).toBe(true);
  });

  it('does NOT merge same name + DIFFERENT address far apart (true multi-location, with addresses)', () => {
    const a: DedupRecord = { name: 'Advanced Care Physical Therapy', address: '100 Elm St', lat: 42.90, lng: -78.80 };
    const b: DedupRecord = { name: 'Advanced Care Physical Therapy', address: '55 Oak Ave', lat: 43.00, lng: -78.90 };
    expect(isSameBusiness(a, b)).toBe(false);
  });

  it('does NOT merge DIFFERENT names that happen to share an address (suite neighbors)', () => {
    const a: DedupRecord = { name: 'Silk Massage Spa', address: '636 N French Rd', lat: 43.036, lng: -78.801 };
    const b: DedupRecord = { name: 'Elite Dental Group', address: '636 N French Rd', lat: 43.036, lng: -78.801 };
    expect(isSameBusiness(a, b)).toBe(false); // names must still agree
  });

  it('does NOT merge near neighbors that only share a generic token', () => {
    const a: DedupRecord = { name: 'Grand Island Physical Therapy', lat: 43.0200, lng: -78.9600 };
    const b: DedupRecord = { name: 'Island Aesthetics', lat: 43.02005, lng: -78.96005 };
    expect(isSameBusiness(a, b)).toBe(false);
  });
});

describe('clusterBusinesses', () => {
  it('keeps all 6 locations of a same-named chain distinct', () => {
    const chain: DedupRecord[] = [
      { name: 'Advanced Care Physical Therapy', lat: 42.90, lng: -78.80 },
      { name: 'Advanced Care Physical Therapy', lat: 42.95, lng: -78.85 },
      { name: 'Advanced Care Physical Therapy', lat: 43.00, lng: -78.90 },
      { name: 'Advanced Care Physical Therapy', lat: 43.05, lng: -78.95 },
      { name: 'Advanced Care Physical Therapy', lat: 43.10, lng: -79.00 },
      { name: 'Advanced Care Physical Therapy', lat: 43.15, lng: -79.05 },
    ];
    const clusters = clusterBusinesses(chain);
    expect(clusters).toHaveLength(6);
  });

  it('merges name variants at the same place into one cluster, preferring the fuller name', () => {
    const records: DedupRecord[] = [
      { name: 'Susan Naturally Day Spa', lat: 42.9000, lng: -78.8000 },
      { name: 'Susan Naturally Day Spa featuring Susan Ciminelli', lat: 42.90005, lng: -78.80005 },
    ];
    const clusters = clusterBusinesses(records);
    expect(clusters).toHaveLength(1);
    expect(clusters[0].records).toHaveLength(2);
    expect(clusters[0].canonical.name).toBe('Susan Naturally Day Spa featuring Susan Ciminelli');
  });

  it('does not merge distinct near-neighbor businesses', () => {
    const records: DedupRecord[] = [
      { name: 'Grand Island Physical Therapy', lat: 43.0200, lng: -78.9600 },
      { name: 'Island Aesthetics', lat: 43.02005, lng: -78.96005 },
    ];
    const clusters = clusterBusinesses(records);
    expect(clusters).toHaveLength(2);
  });

  it('collapses a mis-geocoded duplicate (same name + address, far apart) into one cluster', () => {
    const records: DedupRecord[] = [
      { name: 'Silk Massage Spa', address: '636 N French Rd', lat: 43.03596, lng: -78.80113 },
      { name: 'Silk Massage Spa', address: '636 N French Rd', lat: 43.03495, lng: -78.75414 },
    ];
    const clusters = clusterBusinesses(records);
    expect(clusters).toHaveLength(1);
    expect(clusters[0].records).toHaveLength(2);
  });

  it('handles a mixed batch correctly', () => {
    const records: DedupRecord[] = [
      // chain x2 distinct locations
      { name: 'Advanced Care Physical Therapy', lat: 42.90, lng: -78.80 },
      { name: 'Advanced Care Physical Therapy', lat: 43.00, lng: -78.90 },
      // same place name variants -> 1
      { name: 'Susan Naturally Day Spa', lat: 42.9500, lng: -78.8500 },
      { name: 'Susan Naturally Day Spa featuring Susan Ciminelli', lat: 42.95005, lng: -78.85005 },
      // distinct near neighbors -> 2
      { name: 'Grand Island Physical Therapy', lat: 43.0200, lng: -78.9600 },
      { name: 'Island Aesthetics', lat: 43.02005, lng: -78.96005 },
    ];
    const clusters = clusterBusinesses(records);
    // 2 (chain) + 1 (susan) + 2 (near neighbors) = 5
    expect(clusters).toHaveLength(5);
  });
});

describe('coalesceField', () => {
  it('returns the first non-empty value across cluster records', () => {
    const records: DedupRecord[] = [
      { name: 'A', lat: 0, lng: 0, phone: '' },
      { name: 'A', lat: 0, lng: 0, phone: '716-555-0100' },
      { name: 'A', lat: 0, lng: 0, phone: '716-555-0200' },
    ];
    expect(coalesceField(records, 'phone')).toBe('716-555-0100');
  });

  it('returns null when no record has the field', () => {
    const records: DedupRecord[] = [
      { name: 'A', lat: 0, lng: 0 },
      { name: 'A', lat: 0, lng: 0, website: null },
    ];
    expect(coalesceField(records, 'website')).toBeNull();
  });
});
