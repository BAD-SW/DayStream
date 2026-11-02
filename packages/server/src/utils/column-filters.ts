/**
 * Column filters sent by the shared table (David, 2026-11-02): per column, a list of chosen values
 * ('' = empty), a "contains" text, or a date range (calendar days 'YYYY-MM-DD' in the business's
 * time zone). Each list endpoint names which columns can be filtered and the SQL behind them.
 */

export interface ColumnFilter { values?: string[]; contains?: string; from?: string; to?: string }
export type ColumnFilters = Record<string, ColumnFilter>;

export interface FilterableColumn {
  /** SQL for the column's value. */
  expr: string;
  kind?: 'text' | 'date';
  /** SQL for how a value is named in the filter list (e.g. a staff member's name for an id). */
  label?: string;
}

const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** Reads the `cf` query parameter (JSON) into column filters, keeping only well-formed entries. */
export function parseColumnFilters(raw: unknown): ColumnFilters {
  if (!raw) return {};
  let obj: any;
  try { obj = typeof raw === 'string' ? JSON.parse(raw) : raw; } catch { return {}; }
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return {};
  const out: ColumnFilters = {};
  for (const [key, f] of Object.entries<any>(obj)) {
    if (!f || typeof f !== 'object') continue;
    const cf: ColumnFilter = {};
    if (Array.isArray(f.values)) cf.values = f.values.slice(0, 1000).map((v: unknown) => (v == null ? '' : String(v)));
    if (typeof f.contains === 'string' && f.contains.trim()) cf.contains = f.contains.trim().slice(0, 200);
    if (typeof f.from === 'string' && DAY.test(f.from)) cf.from = f.from;
    if (typeof f.to === 'string' && DAY.test(f.to)) cf.to = f.to;
    if (cf.values?.length || cf.contains || cf.from || cf.to) out[key] = cf;
  }
  return out;
}

const ACCENTED = 'áàäâãåéèëêíìïîóòöôõúùüûñç';
const UNACCENTED = 'aaaaaaeeeeiiiiooooouuuunc';
const plain = (expr: string) => `TRANSLATE(LOWER(COALESCE((${expr})::text, '')), '${ACCENTED}', '${UNACCENTED}')`;

/**
 * Adds one SQL condition per filtered column to `conditions`, with its values in `params`.
 * `tzExpr` is SQL for the business's time zone (date ranges are calendar days there).
 */
export function addColumnFilterConditions(
  filters: ColumnFilters,
  columns: Record<string, FilterableColumn>,
  conditions: string[],
  params: any[],
  tzExpr: string,
  skipKey?: string,
): void {
  for (const [key, f] of Object.entries(filters)) {
    const col = columns[key];
    if (!col || key === skipKey) continue;
    if (col.kind === 'date') {
      const day = `((${col.expr}) AT TIME ZONE ${tzExpr})::date`;
      if (f.from) { params.push(f.from); conditions.push(`${day} >= $${params.length}::date`); }
      if (f.to) { params.push(f.to); conditions.push(`${day} <= $${params.length}::date`); }
      continue;
    }
    if (f.values?.length) {
      const wantsEmpty = f.values.includes('');
      const real = f.values.filter((v) => v !== '');
      const parts: string[] = [];
      if (real.length) { params.push(real); parts.push(`(${col.expr})::text = ANY($${params.length}::text[])`); }
      if (wantsEmpty) parts.push(`COALESCE((${col.expr})::text, '') = ''`);
      conditions.push(`(${parts.join(' OR ')})`);
    }
    if (f.contains) {
      params.push(`%${f.contains}%`);
      conditions.push(`${plain(col.expr)} LIKE ${plain(`$${params.length}`)}`);
    }
  }
}

/** SQL selecting each value of one column (with its label and count) under the given conditions. */
export function columnValuesSql(col: FilterableColumn, from: string, where: string): string {
  const label = col.label || col.expr;
  return `SELECT COALESCE((${col.expr})::text, '') AS value, MAX(COALESCE((${label})::text, '')) AS label, COUNT(*)::int AS count
            FROM ${from} WHERE ${where}
           GROUP BY 1 ORDER BY 3 DESC, 1 LIMIT 1000`;
}
