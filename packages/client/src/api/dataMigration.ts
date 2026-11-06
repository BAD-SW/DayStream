import { apiClient } from './client';

/** Data migration import API (spec 50, Waves 1-4). */

/** Graded confidence in an auto-proposed column mapping (Wave 4). */
export type Confidence = 'certain' | 'likely' | 'unknown';

export type ImportKind =
  | 'customers' | 'payment_methods' | 'memberships' | 'packages'
  | 'appointments' | 'account_balances' | 'transactions' | 'notes';

export interface ColumnProposal {
  index: number;
  column: string;
  field: string | null;
  confident: boolean;
  /** Graded confidence (Wave 4): `likely` mappings are pre-selected but flagged to confirm. */
  confidence?: Confidence;
}

/** A before/after sample of a row the engine realigned (Wave 4). */
export interface RepairSample {
  row: number;
  before: string[];
  after: string[];
}

/** Row-alignment repair summary (Wave 4): rows auto-corrected and rows that couldn't be. */
export interface RepairInfo {
  repaired: number;
  unresolved: number;
  samples: RepairSample[];
  /** Present on analyze (preview); on trial/commit the unresolved rows appear in `failures` too. */
  failures?: { row: number; reason: string }[];
}

/** Per-row alignment outcome for the three-tab staging UI (Stage B). */
export type RowAlignment = 'ok' | 'repaired' | 'unresolved';
export interface AnalyzedRow {
  row: number;            // 1-based source row number
  alignment: RowAlignment;
  cells: string[];        // aligned cells (ok/repaired) or raw cells (unresolved)
  raw: string[];          // original cells as read from the file
  reason?: string;        // present when unresolved
}

/** Opaque column-profile blob from analyze, passed back to realignRow (shape mirrors the engine). */
export type ColumnProfile = Record<string, unknown>;

export interface AnalyzeResult {
  hasHeader: boolean;
  columns: string[];
  proposedMapping: ColumnProposal[];
  sampleRows: string[][];
  width: number;          // canonical column count (for the per-cell shift editor)
  profiles: ColumnProfile[]; // canonical profiles, passed back to realignRow
  repair?: RepairInfo;
  rows: AnalyzedRow[];    // every data row with its bucket + cells
}

export interface RealignResult {
  cells: string[];
  aligned: boolean;
  /** When not aligned: what's wrong, naming the column. */
  reason?: string;
}

export interface RowFailure {
  row: number;
  field: string;
  message: string;
}

export interface ImportResult {
  runId: string | null;
  total: number;
  imported: number;
  matched: number;
  failed: number;
  failures: RowFailure[];
  /** Rows that DID import but need the owner's attention (e.g. a membership with no card on file). */
  warnings?: RowFailure[];
  /** Row-alignment repair outcomes (Wave 4): auto-corrected and flagged-for-review rows. */
  repair?: RepairInfo;
}

export interface ImportRun {
  id: string;
  entity: ImportKind;
  file_name: string | null;
  total_rows: number;
  imported: number;
  matched: number;
  failed: number;
  is_trial: boolean;
  performed_by_name: string | null;
  created_at: string;
}

/** Analyze an uploaded file: detect header + columns and propose a mapping. */
export async function analyze(kind: ImportKind, file: File): Promise<AnalyzeResult> {
  const form = new FormData();
  form.append('file', file);
  const res = await apiClient.post(`/v1/import/${kind}/analyze`, form, {
    headers: { 'Content-Type': 'multipart/form-data' },
  });
  return res.data.data;
}

/** Run a trial (writes nothing) or commit (writes). `mapping` is column-index → field. */
async function run(
  kind: ImportKind, commit: boolean, file: File, businessId: string,
  mapping: Record<number, string>, hasHeader: boolean,
): Promise<ImportResult> {
  const form = new FormData();
  form.append('file', file);
  form.append('business_id', businessId);
  form.append('mapping', JSON.stringify(mapping));
  form.append('has_header', String(hasHeader));
  const res = await apiClient.post(`/v1/import/${kind}/${commit ? 'commit' : 'trial'}`, form, {
    headers: { 'Content-Type': 'multipart/form-data' },
  });
  return res.data.data;
}

export function trial(kind: ImportKind, file: File, businessId: string, mapping: Record<number, string>, hasHeader: boolean) {
  return run(kind, false, file, businessId, mapping, hasHeader);
}
export function commit(kind: ImportKind, file: File, businessId: string, mapping: Record<number, string>, hasHeader: boolean) {
  return run(kind, true, file, businessId, mapping, hasHeader);
}

/**
 * Commit (or trial) an explicit set of already-aligned rows — the accepted "Mapped" bucket from
 * the three-tab staging UI (Stage B). `rows` are aligned cell arrays; `mapping` is column-index →
 * field. Only these rows are imported; record-level dedup makes repeated commits safe.
 */
async function runRows(
  kind: ImportKind, commit: boolean, businessId: string,
  mapping: Record<number, string>, rows: string[][], fileName: string | null,
): Promise<ImportResult> {
  const res = await apiClient.post(`/v1/import/${kind}/${commit ? 'commit-rows' : 'trial-rows'}`, {
    business_id: businessId, mapping, rows, file_name: fileName,
  });
  return res.data.data;
}

export function trialRows(kind: ImportKind, businessId: string, mapping: Record<number, string>, rows: string[][], fileName: string | null) {
  return runRows(kind, false, businessId, mapping, rows, fileName);
}
export function commitRows(kind: ImportKind, businessId: string, mapping: Record<number, string>, rows: string[][], fileName: string | null) {
  return runRows(kind, true, businessId, mapping, rows, fileName);
}

/** Commit one batch of a larger import without recording a run (call recordRun once at the end). */
export async function commitRowsBatch(
  kind: ImportKind, businessId: string, mapping: Record<number, string>, rows: string[][], fileName: string | null,
): Promise<ImportResult> {
  const res = await apiClient.post(`/v1/import/${kind}/commit-rows`, {
    business_id: businessId, mapping, rows, file_name: fileName, defer_record: true,
  });
  return res.data.data;
}

/** Record a single summary run for a batched commit. */
export async function recordRun(
  kind: ImportKind, businessId: string, fileName: string | null,
  totals: { total: number; imported: number; matched: number; failed: number },
): Promise<void> {
  await apiClient.post(`/v1/import/${kind}/record-run`, { business_id: businessId, file_name: fileName, ...totals });
}

/**
 * Re-align one row after a per-cell shift (the ← / → arrows). `index` is the shifted column and
 * `direction` the arrow used; the server holds the columns before the shift fixed and
 * intelligently re-positions the remaining values by profile-fit. Returns the settled cells and
 * whether the row now fully lines up.
 */
export async function realignRow(
  kind: ImportKind, cells: string[], profiles: ColumnProfile[], index: number, direction: 'left' | 'right' | 'check',
): Promise<RealignResult> {
  const res = await apiClient.post(`/v1/import/${kind}/realign-row`, { cells, profiles, index, direction });
  return res.data.data;
}

export async function listRuns(businessId: string): Promise<ImportRun[]> {
  const res = await apiClient.get('/v1/import/runs', { params: { business_id: businessId } });
  return res.data.data;
}
