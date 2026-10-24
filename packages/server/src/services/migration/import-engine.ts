import * as XLSX from 'xlsx';

/**
 * Shared data-migration import engine (spec 50-data-migration, Wave 1).
 *
 * The format-agnostic core every entity import shares: parse a CSV or Excel file
 * into a raw grid, decide whether the first row is a header, and propose a
 * column→field mapping — by header name when a header exists, by the column's
 * VALUES when it doesn't (or when a header doesn't match). Everything here is a
 * pure function of its inputs (no DB, no IO beyond parsing the provided bytes),
 * so it is directly unit-testable.
 *
 * Entity-specific steps (reference matching, validation, landing) live in each
 * entity's import service; this module only turns bytes into a confirmed,
 * field-mapped set of rows.
 */

// ---------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------

/** A parsed file: a raw grid of string cells. Row 0 may or may not be a header. */
export interface ParsedGrid {
  grid: string[][];
}

/**
 * Parse an uploaded file (CSV or .xlsx) into a raw grid of strings. The first
 * worksheet is used for Excel. Cells are normalised to strings so downstream
 * validation is format-agnostic (dates arrive as text and validate like CSV).
 * Does NOT assume row 0 is a header — that is decided by detectHeaderRow.
 */
export function parseFileToGrid(buffer: Buffer, fileName: string): ParsedGrid {
  const isExcel = /\.xlsx?$/i.test(fileName);
  if (isExcel) return { grid: parseExcel(buffer) };
  return { grid: parseCsv(buffer.toString('utf8')) };
}

function parseExcel(buffer: Buffer): string[][] {
  const wb = XLSX.read(buffer, { type: 'buffer' });
  const firstSheetName = wb.SheetNames[0];
  if (!firstSheetName) return [];
  const sheet = wb.Sheets[firstSheetName];
  // header:1 → array-of-arrays (raw grid); raw:false → formatted strings; defval
  // keeps empty cells as '' so column counts stay aligned across rows.
  const rows = XLSX.utils.sheet_to_json<string[]>(sheet, { header: 1, raw: false, defval: '' });
  return rows.map((r) => (Array.isArray(r) ? r.map((c) => String(c ?? '').trim()) : []));
}

/** CSV parse into a grid (handles quoted fields and escaped quotes). */
export function parseCsv(text: string): string[][] {
  const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/);
  // Drop a trailing empty line (common when files end with a newline).
  while (lines.length > 0 && lines[lines.length - 1].trim() === '') lines.pop();
  return lines.map(parseCsvLine);
}

function parseCsvLine(line: string): string[] {
  const result: string[] = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') { current += '"'; i++; }
      else inQuotes = !inQuotes;
    } else if (ch === ',' && !inQuotes) {
      result.push(current.trim());
      current = '';
    } else {
      current += ch;
    }
  }
  result.push(current.trim());
  return result;
}

// ---------------------------------------------------------------------------
// Value classification (shared by header detection and value-based mapping)
// ---------------------------------------------------------------------------

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
// Phone: 7-15 digits, allowing +, spaces, (), -, . separators.
const PHONE_RE = /^\+?[\d][\d\s().-]{5,}$/;
const DATE_RE = /^\d{4}[-/]\d{1,2}[-/]\d{1,2}$|^\d{1,2}[-/]\d{1,2}[-/]\d{2,4}$/;
const NUMBER_RE = /^-?\d+(?:[.,]\d+)?$/;
const MONEY_RE = /^[-+]?[$€£]?\s?\d{1,3}(?:[,.\s]?\d{3})*(?:[.,]\d{1,2})?$/;

export type CellKind = 'email' | 'phone' | 'date' | 'number' | 'money' | 'empty' | 'text';

/** Classify a single cell by what it looks like. */
export function classifyCell(value: string): CellKind {
  const v = (value ?? '').trim();
  if (v === '') return 'empty';
  if (EMAIL_RE.test(v)) return 'email';
  if (DATE_RE.test(v)) return 'date';
  if (PHONE_RE.test(v) && (v.replace(/\D/g, '').length >= 7)) return 'phone';
  if (NUMBER_RE.test(v)) return 'number';
  if (MONEY_RE.test(v)) return 'money';
  return 'text';
}

// ---------------------------------------------------------------------------
// Header-row detection (is row 0 labels or data?)
// ---------------------------------------------------------------------------

export interface HeaderDetection {
  hasHeader: boolean;
  confidence: number; // 0..1
}

/**
 * Decide whether row 0 is a header by comparing its character against the rows
 * below. A header row reads as labels (plain text, no emails/phones/dates/money
 * in it) while the data rows below carry value-shaped cells. If row 0 looks like
 * the same kind of data as the rows below, there is no header.
 */
export function detectHeaderRow(grid: string[][]): HeaderDetection {
  if (grid.length === 0) return { hasHeader: false, confidence: 0 };
  if (grid.length === 1) {
    // One row only: treat as a header if it's all plain text (nothing to import
    // from a single data row anyway), else as data.
    const allText = grid[0].every((c) => { const k = classifyCell(c); return k === 'text' || k === 'empty'; });
    return { hasHeader: allText, confidence: 0.5 };
  }

  const header = grid[0];
  const sample = grid.slice(1, Math.min(grid.length, 21)); // up to 20 data rows

  // Per column, does the body carry value-shaped cells while the header cell is text?
  let columnsWhereHeaderIsLabelOverData = 0;
  let columnsConsidered = 0;
  for (let c = 0; c < header.length; c++) {
    const headerKind = classifyCell(header[c]);
    const bodyKinds = sample.map((r) => classifyCell(r[c] ?? ''));
    const bodyValueShaped = bodyKinds.filter((k) => k !== 'text' && k !== 'empty').length;
    const bodyNonEmpty = bodyKinds.filter((k) => k !== 'empty').length;
    if (bodyNonEmpty === 0) continue; // nothing to judge in this column
    columnsConsidered++;
    // Header looks like a label (text) AND the body is mostly value-shaped → a
    // telltale header-over-data column.
    if ((headerKind === 'text' || headerKind === 'empty') && bodyValueShaped >= Math.ceil(bodyNonEmpty / 2)) {
      columnsWhereHeaderIsLabelOverData++;
    }
  }

  if (columnsConsidered === 0) {
    // All columns are free text on both sides — ambiguous. Default to treating
    // row 0 as a header (the common case for exports), low confidence.
    return { hasHeader: true, confidence: 0.4 };
  }
  const ratio = columnsWhereHeaderIsLabelOverData / columnsConsidered;
  // A header is indicated when a meaningful share of columns are label-over-data.
  return { hasHeader: ratio >= 0.4, confidence: ratio };
}

// ---------------------------------------------------------------------------
// Column identification (name-based + value-based)
// ---------------------------------------------------------------------------

/** A target field an import can map a column to. Entity imports pass their set. */
export interface FieldDef {
  field: string;
  /** Synonyms matched against a normalised header (lowercased, alnum only). */
  synonyms: string[];
  /** Cell kinds whose dominance strongly implies this field (value-based). */
  valueKinds?: CellKind[];
}

export interface ColumnProposal {
  /** Column index. */
  index: number;
  /** The header label when hasHeader, else a positional label ("Column 1"). */
  column: string;
  /** Proposed field, or null when nothing confident matched. */
  field: string | null;
  /** True when the match is confident (pre-filled; needs no owner action). */
  confident: boolean;
}

/** Normalise a header for name matching: lowercase, strip non-alphanumerics. */
export function normalizeHeader(h: string): string {
  return (h ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

/**
 * Propose a field per column. With a header, match by name first; fall back to
 * value-based inference when the header doesn't match (or there is no header).
 * `sampleRows` are the data rows (already excluding the header row).
 */
export function detectColumns(
  grid: string[][],
  hasHeader: boolean,
  fields: FieldDef[],
): ColumnProposal[] {
  if (grid.length === 0) return [];
  const headerRow = grid[0] ?? [];
  const width = Math.max(...grid.map((r) => r.length), 0);
  const dataRows = hasHeader ? grid.slice(1) : grid;
  const sample = dataRows.slice(0, 50);

  // byName: normalised synonym → field (first wins on collision).
  const byName = new Map<string, string>();
  for (const f of fields) for (const s of f.synonyms) if (!byName.has(normalizeHeader(s))) byName.set(normalizeHeader(s), f.field);

  const used = new Set<string>(); // a field maps to at most one column
  const proposals: ColumnProposal[] = [];

  for (let c = 0; c < width; c++) {
    const label = hasHeader ? (headerRow[c] ?? `Column ${c + 1}`) : `Column ${c + 1}`;
    let field: string | null = null;
    let confident = false;

    // 1. Name match (only when there's a header).
    if (hasHeader) {
      const named = byName.get(normalizeHeader(headerRow[c] ?? ''));
      if (named && !used.has(named)) { field = named; confident = true; }
    }

    // 2. Value-based inference (no header, or header didn't match).
    if (!field) {
      const kinds = sample.map((r) => classifyCell(r[c] ?? ''));
      const nonEmpty = kinds.filter((k) => k !== 'empty');
      if (nonEmpty.length > 0) {
        // Dominant kind among non-empty cells.
        const counts = new Map<CellKind, number>();
        for (const k of nonEmpty) counts.set(k, (counts.get(k) ?? 0) + 1);
        let dominant: CellKind = 'text'; let dominantN = 0;
        for (const [k, n] of counts) if (n > dominantN) { dominant = k; dominantN = n; }
        const dominance = dominantN / nonEmpty.length;
        if (dominance >= 0.8 && dominant !== 'text') {
          const candidate = fields.find((f) => f.valueKinds?.includes(dominant) && !used.has(f.field));
          if (candidate) { field = candidate.field; confident = true; }
        }
      }
    }

    if (field) used.add(field);
    proposals.push({ index: c, column: label, field, confident });
  }

  return proposals;
}

/** Build the working rows from a grid + confirmed mapping (field → row object). */
export function applyMapping(
  grid: string[][],
  hasHeader: boolean,
  mapping: Record<number, string>, // column index → field
): Array<Record<string, string>> {
  const dataRows = hasHeader ? grid.slice(1) : grid;
  return dataRows.map((row) => {
    const obj: Record<string, string> = {};
    for (const [idxStr, field] of Object.entries(mapping)) {
      if (!field) continue;
      const idx = Number(idxStr);
      obj[field] = (row[idx] ?? '').trim();
    }
    return obj;
  });
}

/** The customer-field definitions shared by the Customers import. */
export const CUSTOMER_FIELDS: FieldDef[] = [
  { field: 'legacy_customer_id', synonyms: ['legacyid', 'legacycustomerid', 'externalid', 'oldid', 'customerid', 'id'] },
  { field: 'email', synonyms: ['email', 'emailaddress', 'mail'], valueKinds: ['email'] },
  { field: 'first_name', synonyms: ['firstname', 'first', 'givenname', 'fname'] },
  { field: 'last_name', synonyms: ['lastname', 'last', 'surname', 'familyname', 'lname'] },
  { field: 'phone', synonyms: ['phone', 'mobile', 'cell', 'telephone', 'phonenumber', 'contactnumber'], valueKinds: ['phone'] },
  { field: 'date_of_birth', synonyms: ['dob', 'dateofbirth', 'birthdate', 'birthday'], valueKinds: ['date'] },
  { field: 'gender', synonyms: ['gender', 'sex'] },
  { field: 'preferred_language', synonyms: ['language', 'lang', 'locale', 'preferredlanguage'] },
  { field: 'country', synonyms: ['country', 'countryname'] },
  { field: 'notes', synonyms: ['notes', 'note', 'comments', 'remarks'] },
  { field: 'tags', synonyms: ['tags', 'tag', 'labels'] },
  { field: 'joined', synonyms: ['joined', 'joindate', 'customersince', 'createddate', 'dateadded', 'signupdate'], valueKinds: ['date'] },
];
