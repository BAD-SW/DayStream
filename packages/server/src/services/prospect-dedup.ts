/**
 * Prospect de-duplication & reconciliation (spec 31 design §5).
 *
 * Identity is NAME + LOCATION, never name alone. Two records are the same business only if
 * they are at essentially the same place AND their names are fuzzy-similar. This preserves
 * multi-location chains (same name, different addresses = distinct) and merges the same
 * place recorded with slightly different name strings.
 *
 * Pure functions (no I/O) so they can be unit-tested against the design's fixtures:
 *   - Advanced Care PT: same name, 6 different addresses  -> 6 distinct (do NOT merge)
 *   - Susan Naturally:  different name strings, same place -> merge
 *   - Grand Island PT vs Island Aesthetics: near + shared token, different -> do NOT merge
 */

/** Minimal shape needed for de-dup. Any candidate/prospect can be adapted to this. */
export interface DedupRecord {
  name: string;
  lat: number;
  lng: number;
  [extra: string]: any; // carries through source fields for reconcile
}

/** Tunable thresholds. */
export const DEDUP_PROXIMITY_METERS = 120;   // "same place" radius
export const DEDUP_NAME_SIMILARITY = 0.6;    // min token-overlap (containment-style) to call names equal

// Filler tokens stripped from names before comparison (keep this conservative — do NOT strip
// words that distinguish businesses). "spa"/"salon" are intentionally NOT filler here because
// they can be the only distinguishing token; we rely on proximity + overlap instead.
const FILLER = new Set(['the', 'llc', 'inc', 'pc', 'llp', 'co', 'company', 'featuring', 'and', '&', 'of', 'at', 'a', 'an']);

/** Normalize a name to comparable tokens. */
export function normalizeNameTokens(name: string): string[] {
  return (name || '')
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, ' ')
    .split(/\s+/)
    .filter((w) => w && !FILLER.has(w));
}

/** Containment-style token overlap: intersection / size of the smaller token set (0..1). */
export function nameSimilarity(a: string, b: string): number {
  const ta = new Set(normalizeNameTokens(a));
  const tb = new Set(normalizeNameTokens(b));
  if (ta.size === 0 || tb.size === 0) return 0;
  let inter = 0;
  for (const t of ta) if (tb.has(t)) inter++;
  return inter / Math.min(ta.size, tb.size);
}

/** Great-circle distance in meters. */
export function haversineMeters(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

/**
 * Are two records the same business? Requires BOTH:
 *   - proximity within DEDUP_PROXIMITY_METERS, AND
 *   - name similarity >= DEDUP_NAME_SIMILARITY (or one name contained in the other).
 */
export function isSameBusiness(
  a: DedupRecord, b: DedupRecord,
  proximityM = DEDUP_PROXIMITY_METERS, nameSim = DEDUP_NAME_SIMILARITY,
): boolean {
  if (!Number.isFinite(a.lat) || !Number.isFinite(b.lat)) return false;
  if (haversineMeters(a.lat, a.lng, b.lat, b.lng) > proximityM) return false;
  const an = normalizeNameTokens(a.name).join(' ');
  const bn = normalizeNameTokens(b.name).join(' ');
  if (an && bn && (an.includes(bn) || bn.includes(an))) return true; // containment (Susan Naturally)
  return nameSimilarity(a.name, b.name) >= nameSim;
}

export interface DedupCluster<T extends DedupRecord> {
  records: T[];      // all records that collapsed into one business
  canonical: T;      // the chosen representative
}

/**
 * Cluster records into distinct businesses. Greedy single-link within the proximity+name
 * rule. Because "same business" requires BOTH location and name agreement, multi-location
 * chains (same name, far apart) never cluster, and near-neighbors with different names
 * (Grand Island PT vs Island Aesthetics) never cluster.
 *
 * `canonicalPick` chooses the representative (default: the record with the longest/richest
 * name, which tends to be the more official/complete one — e.g. prefers the version WITH
 * "featuring Susan Ciminelli" as the fuller label; callers can override).
 */
export function clusterBusinesses<T extends DedupRecord>(
  records: T[],
  opts?: { proximityM?: number; nameSim?: number; canonicalPick?: (records: T[]) => T },
): DedupCluster<T>[] {
  const proximityM = opts?.proximityM ?? DEDUP_PROXIMITY_METERS;
  const nameSim = opts?.nameSim ?? DEDUP_NAME_SIMILARITY;
  const pick = opts?.canonicalPick ?? ((rs: T[]) => rs.reduce((best, r) => (r.name.length > best.name.length ? r : best), rs[0]));

  const clusters: T[][] = [];
  for (const rec of records) {
    let placed = false;
    for (const cluster of clusters) {
      // match against any member already in the cluster (single-link)
      if (cluster.some((m) => isSameBusiness(m, rec, proximityM, nameSim))) {
        cluster.push(rec);
        placed = true;
        break;
      }
    }
    if (!placed) clusters.push([rec]);
  }
  return clusters.map((records) => ({ records, canonical: pick(records) }));
}

/** First non-empty value across cluster records for a field (reconcile "best field"). */
export function coalesceField<T extends DedupRecord>(records: T[], field: keyof T): any {
  for (const r of records) {
    const v = r[field];
    if (v !== null && v !== undefined && v !== '') return v;
  }
  return null;
}
