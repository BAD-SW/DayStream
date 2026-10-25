import { GoogleAuth, Impersonated } from 'google-auth-library';
import { adminPool } from '../db/pool';
import { logger } from '../middleware/logger';

/**
 * Google Cloud usage service — reads the AUTHORITATIVE Places API call count for the
 * current billing month directly from Google Cloud Monitoring (not a self-tally).
 *
 * KEYLESS AUTH (Application Default Credentials). We deliberately do NOT use a
 * downloaded service-account key: the org policy iam.disableServiceAccountKeyCreation
 * forbids key files, and long-lived keys are a security risk. Instead we authenticate
 * with ADC, which resolves credentials from the environment:
 *   - Local dev: `gcloud auth application-default login` (a cached user credential).
 *   - Production (AWS etc.): workload identity federation or an attached identity.
 * Optionally, a service account may be IMPERSONATED (config.impersonate_service_account)
 * so the caller's ADC principal only needs the Token Creator role on that SA — useful
 * in production where a dedicated SA holds the Monitoring Viewer grant.
 *
 * Why a credential at all and not the Places API key: an API key authorizes calls TO a
 * data service (Places); it cannot read a project's usage/billing metrics. Usage lives
 * behind the Cloud Monitoring API, which requires an OAuth2 identity with the Monitoring
 * Viewer role. Same Google Cloud project, different auth.
 *
 * Billing window: Google's free monthly thresholds reset on the first of the month in
 * US/Pacific time. We compute the current window in that timezone.
 */

const MONITORING_SCOPE = 'https://www.googleapis.com/auth/monitoring.read';
const DEFAULT_FREE_THRESHOLD = 10000;
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 min — Monitoring data is near-real-time; avoid hammering it
const HTTP_TIMEOUT_MS = 12000;

/** The metric that counts API requests per consumed service. */
const REQUEST_COUNT_METRIC = 'serviceruntime.googleapis.com/api/request_count';
/**
 * Prospect generation's cost is Places Text Search. In Cloud Monitoring the Places API
 * reports under the resource label `places-backend.googleapis.com` (NOT `maps.googleapis.com`,
 * which was the original wrong guess and always read 0). Verified against the live project:
 * places-backend ≈ the bulk of calls; maps-backend (JS embeds) and geocoding-backend are
 * minor. We meter the PLACES backend specifically, since the free threshold is per-SKU and
 * that's the one generation can push toward a limit.
 */
const PLACES_SERVICE = 'places-backend.googleapis.com';

export interface UsageResult {
  status: 'ok' | 'not_configured' | 'error';
  message?: string;
  calls_this_month?: number;
  free_threshold?: number;
  remaining?: number;
  /** ISO start of the current billing window (PT month start, as UTC instant). */
  period_start?: string;
  /** ISO end/reset instant — first of next month in PT, as UTC instant. */
  resets_on?: string;
  /** Human label for the window, e.g. "Oct 1 – Oct 31, 2026 (PT)". */
  period_label?: string;
  /** When this reading was taken (for the "as of" note). */
  as_of?: string;
}

interface GoogleCloudConfig {
  project_id: string;
  free_threshold?: number;
  /** Optional: a service account to impersonate (email). ADC principal needs Token Creator on it. */
  impersonate_service_account?: string;
}

let cache: { at: number; result: UsageResult } | null = null;

/**
 * Load the google_cloud config from sys_system_configurations. With ADC there is no
 * secret to store — only the project id, an optional impersonation target, and the
 * free threshold. Returns null when no project id is configured.
 */
async function loadConfig(): Promise<GoogleCloudConfig | null> {
  const { rows } = await adminPool.query(
    `SELECT config_data FROM sys_system_configurations WHERE category = 'google_cloud'`,
  );
  const data = rows[0]?.config_data;
  const projectId = data?.project_id || process.env.GOOGLE_CLOUD_PROJECT || '';
  if (!projectId) return null;
  return {
    project_id: projectId,
    free_threshold: typeof data?.free_threshold === 'number' ? data.free_threshold : undefined,
    impersonate_service_account: data?.impersonate_service_account || undefined,
  };
}

/**
 * Obtain an OAuth2 access token via Application Default Credentials, optionally
 * impersonating a service account. Throws a clear error if ADC isn't available.
 */
async function getAccessToken(impersonate?: string): Promise<string> {
  const auth = new GoogleAuth({ scopes: [MONITORING_SCOPE] });

  if (impersonate) {
    const sourceClient = await auth.getClient();
    const impersonated = new Impersonated({
      sourceClient,
      targetPrincipal: impersonate,
      targetScopes: [MONITORING_SCOPE],
      lifetime: 3600,
    });
    const { token } = await impersonated.getAccessToken();
    if (!token) throw new Error('Impersonated credential returned no access token');
    return token;
  }

  const token = await auth.getAccessToken();
  if (!token) {
    throw new Error(
      'No Application Default Credentials available. Run `gcloud auth application-default login` locally, ' +
      'or attach a workload identity in production.',
    );
  }
  return token;
}

async function timedFetch(url: string, init?: RequestInit): Promise<Response> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), HTTP_TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: ctrl.signal });
  } finally {
    clearTimeout(timer);
  }
}

/**
 * The current billing window in US/Pacific: [start of this PT month, start of next PT month).
 * Returns UTC Date instants plus a human label.
 */
function currentPacificMonthWindow(nowUtc = new Date()): { start: Date; end: Date; label: string } {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Los_Angeles', year: 'numeric', month: 'numeric', day: 'numeric',
    hour: 'numeric', minute: 'numeric', second: 'numeric', hour12: false,
  });
  const parts = Object.fromEntries(fmt.formatToParts(nowUtc).map((p) => [p.type, p.value]));
  const ptYear = Number(parts.year);
  const ptMonth = Number(parts.month); // 1-12

  const startUtc = pacificWallClockToUtc(ptYear, ptMonth, 1);
  const nextMonth = ptMonth === 12 ? 1 : ptMonth + 1;
  const nextYear = ptMonth === 12 ? ptYear + 1 : ptYear;
  const endUtc = pacificWallClockToUtc(nextYear, nextMonth, 1);

  // Month name must be derived IN Pacific time, not the server's local zone: formatting a
  // UTC-midnight instant without a timeZone rolls back a day on servers behind UTC (e.g.
  // Oct 1 00:00 UTC prints "Sep 30" in US zones). Read it from the startUtc instant in PT.
  const monthName = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Los_Angeles', month: 'short' })
    .format(startUtc);
  const lastDay = new Date(endUtc.valueOf() - 86400000); // day before next month's start
  const lastDayPt = Number(
    Object.fromEntries(
      new Intl.DateTimeFormat('en-US', { timeZone: 'America/Los_Angeles', day: 'numeric' })
        .formatToParts(lastDay).map((p) => [p.type, p.value]),
    ).day,
  );
  const label = `${monthName} 1 – ${monthName} ${lastDayPt}, ${ptYear} (PT)`;
  return { start: startUtc, end: endUtc, label };
}

/** Convert a PT wall-clock (y, m, d at 00:00:00) to the corresponding UTC instant. */
function pacificWallClockToUtc(year: number, month: number, day: number): Date {
  const guess = Date.UTC(year, month - 1, day, 0, 0, 0);
  const offsetMin = pacificOffsetMinutes(new Date(guess));
  return new Date(guess - offsetMin * 60000);
}

/** The UTC offset of America/Los_Angeles (in minutes, negative) at a given instant. */
function pacificOffsetMinutes(at: Date): number {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Los_Angeles', timeZoneName: 'shortOffset',
    year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric',
  });
  const tz = dtf.formatToParts(at).find((p) => p.type === 'timeZoneName')?.value || 'GMT-8';
  const m = tz.match(/GMT([+-]\d{1,2})(?::?(\d{2}))?/);
  if (!m) return -480; // default PST
  const hours = Number(m[1]);
  const mins = m[2] ? Number(m[2]) : 0;
  return hours * 60 + (hours < 0 ? -mins : mins);
}

/**
 * Query Cloud Monitoring for the summed request_count to maps.googleapis.com over the
 * window. Uses ALIGN_DELTA / REDUCE_SUM aggregation and sums the returned points.
 */
async function fetchCallCount(
  projectId: string, accessToken: string, start: Date, end: Date,
): Promise<number> {
  const filter =
    `metric.type="${REQUEST_COUNT_METRIC}" AND resource.labels.service="${PLACES_SERVICE}"`;
  const params = new URLSearchParams();
  params.set('filter', filter);
  params.set('interval.startTime', start.toISOString());
  params.set('interval.endTime', end.toISOString());
  const alignmentSec = Math.max(60, Math.ceil((end.getTime() - start.getTime()) / 1000));
  params.set('aggregation.alignmentPeriod', `${alignmentSec}s`);
  params.set('aggregation.perSeriesAligner', 'ALIGN_DELTA');
  params.set('aggregation.crossSeriesReducer', 'REDUCE_SUM');
  params.set('view', 'FULL');

  const url =
    `https://monitoring.googleapis.com/v3/projects/${encodeURIComponent(projectId)}/timeSeries?${params.toString()}`;

  let total = 0;
  let pageToken: string | undefined;
  let pages = 0;
  do {
    const pagedUrl = pageToken ? `${url}&pageToken=${encodeURIComponent(pageToken)}` : url;
    const resp = await timedFetch(pagedUrl, { headers: { Authorization: `Bearer ${accessToken}` } });
    if (!resp.ok) {
      const text = await resp.text().catch(() => '');
      throw new Error(`Monitoring API HTTP ${resp.status}: ${text.slice(0, 300)}`);
    }
    const json: any = await resp.json();
    for (const series of json.timeSeries || []) {
      for (const pt of series.points || []) {
        const v = pt.value || {};
        total += Number(v.int64Value ?? v.doubleValue ?? 0);
      }
    }
    pageToken = json.nextPageToken || undefined;
    pages++;
  } while (pageToken && pages < 20);

  return Math.round(total);
}

/**
 * Get the current-month authoritative Places/Maps API usage. Cached for CACHE_TTL_MS.
 * Never throws — returns a status object so callers/UI can degrade gracefully.
 */
export async function getPlacesUsage(force = false): Promise<UsageResult> {
  if (!force && cache && Date.now() - cache.at < CACHE_TTL_MS) return cache.result;
  const result = await computeUsage();
  cache = { at: Date.now(), result };
  return result;
}

async function computeUsage(): Promise<UsageResult> {
  let config: GoogleCloudConfig | null;
  try {
    config = await loadConfig();
  } catch (err: any) {
    return { status: 'error', message: `Could not read configuration: ${err.message}` };
  }
  if (!config) {
    return {
      status: 'not_configured',
      message: 'Usage monitoring is not configured. Set the Google Cloud project ID under Configuration → API Keys (authentication uses Application Default Credentials).',
      free_threshold: DEFAULT_FREE_THRESHOLD,
    };
  }

  const threshold = config.free_threshold ?? DEFAULT_FREE_THRESHOLD;
  const { start, end, label } = currentPacificMonthWindow();

  try {
    const token = await getAccessToken(config.impersonate_service_account);
    const nowUtc = new Date();
    const effectiveEnd = end.getTime() > nowUtc.getTime() ? nowUtc : end;
    const calls = await fetchCallCount(config.project_id, token, start, effectiveEnd);
    return {
      status: 'ok',
      calls_this_month: calls,
      free_threshold: threshold,
      remaining: Math.max(0, threshold - calls),
      period_start: start.toISOString(),
      resets_on: end.toISOString(),
      period_label: label,
      as_of: nowUtc.toISOString(),
    };
  } catch (err: any) {
    logger.error('[GoogleCloudUsage] Failed to read usage', { error: err.message });
    // ADC-missing is the common "not yet set up" case — report it as not_configured so
    // the UI shows the setup hint rather than a scary error.
    const adcMissing = /Application Default Credentials|Could not load the default credentials/i.test(err.message || '');
    if (adcMissing) {
      return {
        status: 'not_configured',
        message: 'Application Default Credentials are not available. Run `gcloud auth application-default login` locally, or attach a workload identity in production.',
        free_threshold: threshold,
      };
    }
    return { status: 'error', message: `Could not read usage from Google: ${err.message}`, free_threshold: threshold };
  }
}

/** Drop the cached reading (e.g. after the configuration changes). */
export function invalidateUsageCache(): void {
  cache = null;
}
