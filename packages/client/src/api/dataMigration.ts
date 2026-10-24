import { apiClient } from './client';

/** Data migration import API (spec 50, Wave 1). */

export type ImportKind = 'customers' | 'payment_methods' | 'account_balances';

export interface ColumnProposal {
  index: number;
  column: string;
  field: string | null;
  confident: boolean;
}

export interface AnalyzeResult {
  hasHeader: boolean;
  columns: string[];
  proposedMapping: ColumnProposal[];
  sampleRows: string[][];
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

export async function listRuns(businessId: string): Promise<ImportRun[]> {
  const res = await apiClient.get('/v1/import/runs', { params: { business_id: businessId } });
  return res.data.data;
}
