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
// Value-pattern signals (Wave 4 — spec 50 §15.1)
// ---------------------------------------------------------------------------

// A patterned identifier: a short alphabetic/alphanumeric prefix, a separator, and digits
// (e.g. LEG-10001, L-1, CUST000123, ACC_4421). Distinctive enough to propose with some
// confidence. A BARE number is deliberately NOT matched here — it is indistinguishable from
// any other integer column by shape, and is handled by profile signals (uniqueness + integer
// shape + position) in profileColumns instead.
const PATTERNED_ID_RE = /^[A-Za-z][A-Za-z]{0,9}[-_/ ]?\d{1,}$/;

/** True when a value looks like a plain integer (no decimals, currency, sign-as-data, spaces). */
function isPlainInteger(v: string): boolean {
  return /^\d{1,}$/.test(v.trim());
}

/** True when a value looks like a patterned identifier (prefix + digits). */
export function looksLikePatternedId(value: string): boolean {
  return PATTERNED_ID_RE.test((value ?? '').trim());
}

// Modest bundled name dictionaries (NOT exhaustive by design — spec 50 §15.5). The decision
// is which of two adjacent text columns scores higher as given-names vs surnames, so a
// representative sample that separates the columns by rate is all that's needed; unknown names
// simply don't score, they don't mislead. Lowercased for case-insensitive lookup.
const COMMON_FIRST_NAMES = new Set([
  'james', 'john', 'robert', 'michael', 'william', 'david', 'richard', 'joseph', 'thomas', 'charles',
  'christopher', 'daniel', 'matthew', 'anthony', 'mark', 'donald', 'steven', 'paul', 'andrew', 'joshua',
  'mary', 'patricia', 'jennifer', 'linda', 'elizabeth', 'barbara', 'susan', 'jessica', 'sarah', 'karen',
  'nancy', 'lisa', 'margaret', 'sandra', 'ashley', 'kimberly', 'emily', 'donna', 'michelle', 'carol',
  'avery', 'jordan', 'camila', 'noah', 'sophia', 'mateo', 'riley', 'emma', 'lucas', 'isabella',
  'liam', 'olivia', 'ethan', 'mia', 'aiden', 'ava', 'mason', 'amelia', 'logan', 'harper',
  'alex', 'sam', 'jose', 'maria', 'ana', 'carlos', 'luis', 'juan', 'sofia', 'diego',
  'grace', 'chloe', 'ella', 'lily', 'zoe', 'nathan', 'owen', 'leo', 'max', 'jack',
]);
const COMMON_SURNAMES = new Set([
  'smith', 'johnson', 'williams', 'brown', 'jones', 'garcia', 'miller', 'davis', 'rodriguez', 'martinez',
  'hernandez', 'lopez', 'gonzalez', 'wilson', 'anderson', 'thomas', 'taylor', 'moore', 'jackson', 'martin',
  'lee', 'perez', 'thompson', 'white', 'harris', 'sanchez', 'clark', 'ramirez', 'lewis', 'robinson',
  'walker', 'young', 'allen', 'king', 'wright', 'scott', 'torres', 'nguyen', 'hill', 'flores',
  'morgan', 'rossi', 'patel', 'bennett', 'kim', 'wilson', 'davis', 'nunez', 'russo', 'ferrari',
  'bianchi', 'romano', 'colombo', 'ricci', 'marino', 'greco', 'bruno', 'gallo', 'conti', 'costa',
]);

/** Fraction of a column's non-empty single-token values present in a name dictionary. */
export function nameDictionaryScore(values: string[], dict: Set<string>): number {
  const tokens = values
    .map((v) => (v ?? '').trim().toLowerCase())
    .filter((v) => v !== '' && /^[a-zà-ÿ'-]+$/i.test(v)); // single alphabetic token (names, incl. accents)
  if (tokens.length === 0) return 0;
  const hits = tokens.filter((t) => dict.has(t)).length;
  return hits / tokens.length;
}

/** Parse a cell to a Date for distribution analysis (reuses the engine's date shapes), or null. */
function parseDateLoose(value: string): Date | null {
  const s = (value ?? '').trim();
  if (!s) return null;
  const iso = s.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/);
  if (iso) { const d = new Date(Date.UTC(+iso[1], +iso[2] - 1, +iso[3])); return isNaN(d.getTime()) ? null : d; }
  const mdy = s.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{2,4})$/);
  if (mdy) {
    let y = +mdy[3]; if (y < 100) y += y < 50 ? 2000 : 1900;
    const d = new Date(Date.UTC(y, +mdy[1] - 1, +mdy[2]));
    return isNaN(d.getTime()) ? null : d;
  }
  return null;
}

/**
 * Given the parsed dates of a column, a score (0..1) for how birth-date-like it is: birth dates
 * skew well into the past and span many years; join/created dates cluster in recent years. Used
 * to assign DOB vs joined when a file has two date columns (spec 50 §15.1). Higher = more DOB-like.
 */
/** The most common soft text sub-kind across a column's values. */
function dominantTextSubKindOf(values: string[]): TextSubKind {
  const counts = new Map<TextSubKind, number>();
  for (const v of values) { const k = textSubKind(v); counts.set(k, (counts.get(k) ?? 0) + 1); }
  let best: TextSubKind = 'other'; let bestN = 0;
  for (const [k, n] of counts) if (n > bestN) { best = k; bestN = n; }
  return best;
}

export function birthDateLikeness(values: string[]): number {
  const dates = values.map(parseDateLoose).filter((d): d is Date => d !== null);
  if (dates.length === 0) return 0;
  const now = Date.now();
  const yearsAgo = dates.map((d) => (now - d.getTime()) / (365.25 * 24 * 3600 * 1000));
  const meanAge = yearsAgo.reduce((a, b) => a + b, 0) / yearsAgo.length;
  const spanYears = Math.max(...dates.map((d) => d.getUTCFullYear())) - Math.min(...dates.map((d) => d.getUTCFullYear()));
  // Normalise: a mean age around 40+ and a wide spread (decades) read as DOB; a recent, tight
  // cluster reads as a join date. Map to 0..1 with simple, legible thresholds.
  const ageSignal = Math.min(Math.max((meanAge - 5) / 45, 0), 1);   // 5y→0, 50y→1
  const spanSignal = Math.min(spanYears / 30, 1);                    // 30y spread → 1
  return (ageSignal * 0.7) + (spanSignal * 0.3);
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
 *
 * When the import's field definitions are given, row 0 is also a header if at least
 * two of its cells are known column names (e.g. "Surname", "Email") and none of its
 * cells looks like a value (email, phone, date, amount). Without this, a file whose
 * columns are mostly free text (ids, names, tags, notes) was read as having no header
 * row, because too few of its columns hold value-shaped data (D-57).
 */
export function detectHeaderRow(grid: string[][], fields?: FieldDef[]): HeaderDetection {
  if (grid.length === 0) return { hasHeader: false, confidence: 0 };
  if (fields && fields.length) {
    const names = new Set<string>();
    for (const f of fields) for (const syn of f.synonyms) names.add(normalizeHeader(syn));
    const kinds = grid[0].map((c) => classifyCell(c));
    const known = grid[0].filter((c) => names.has(normalizeHeader(c))).length;
    if (known >= 2 && kinds.every((k) => k === 'text' || k === 'empty')) {
      return { hasHeader: true, confidence: 0.9 };
    }
  }
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

/** Graded confidence in a proposed mapping (Wave 4 — spec 50 §15.2). */
export type Confidence = 'certain' | 'likely' | 'unknown';

export interface ColumnProposal {
  /** Column index. */
  index: number;
  /** The header label when hasHeader, else a positional label ("Column 1"). */
  column: string;
  /** Proposed field, or null when nothing confident matched. */
  field: string | null;
  /**
   * True when the match is confident (pre-filled; needs no owner action).
   * Retained for backward compatibility; `confidence === 'certain'` is the graded form.
   */
  confident: boolean;
  /**
   * Graded confidence: `certain` = decisive (known header / value shape), `likely` = inferred
   * (dictionary / distribution / id-by-profile) and worth a glance, `unknown` = unmapped.
   */
  confidence: Confidence;
}

/** A per-column profile over ALL data rows (Wave 4 — spec 50 §15.1). Pure function of the grid. */
export interface ColumnProfile {
  index: number;
  /** Dominant cell kind among non-empty cells, and how dominant (0..1). */
  dominantKind: CellKind;
  dominance: number;
  nonEmpty: number;
  total: number;
  /** Signals for identifier detection. */
  allPatternedId: boolean;   // every non-empty value is a patterned id (LEG-10001)
  allPlainInteger: boolean;  // every non-empty value is a bare integer
  allUnique: boolean;        // every non-empty value distinct (strong id signal)
  hasNegativeOrDecimal: boolean; // excludes a balance/amount column from being an id
  /** Name-dictionary scores (0..1). */
  firstNameScore: number;
  lastNameScore: number;
  /** Birth-date likeness (0..1) when the column is date-dominant. */
  birthLikeness: number;
  /** Dominant soft sub-kind of a text column (locale/shortcode/taglist/sentence/word), for repair tiebreaks. */
  dominantTextSubKind: TextSubKind;
}

/**
 * Build a profile per column from all data rows. Pure; drives the smarter detection in
 * detectColumns and the row-repair fitter. `dataRows` must already exclude the header row.
 */
export function profileColumns(dataRows: string[][], width: number): ColumnProfile[] {
  const profiles: ColumnProfile[] = [];
  for (let c = 0; c < width; c++) {
    const cells = dataRows.map((r) => (r[c] ?? '').trim());
    const nonEmptyCells = cells.filter((v) => v !== '');
    const kinds = nonEmptyCells.map(classifyCell);

    const counts = new Map<CellKind, number>();
    for (const k of kinds) counts.set(k, (counts.get(k) ?? 0) + 1);
    let dominantKind: CellKind = 'empty'; let dominantN = 0;
    for (const [k, n] of counts) if (n > dominantN) { dominantKind = k; dominantN = n; }
    const dominance = nonEmptyCells.length ? dominantN / nonEmptyCells.length : 0;

    const seen = new Set<string>();
    let allUnique = nonEmptyCells.length > 0;
    for (const v of nonEmptyCells) { if (seen.has(v)) { allUnique = false; break; } seen.add(v); }

    profiles.push({
      index: c,
      dominantKind: nonEmptyCells.length ? dominantKind : 'empty',
      dominance,
      nonEmpty: nonEmptyCells.length,
      total: cells.length,
      allPatternedId: nonEmptyCells.length > 0 && nonEmptyCells.every(looksLikePatternedId),
      allPlainInteger: nonEmptyCells.length > 0 && nonEmptyCells.every(isPlainInteger),
      allUnique,
      hasNegativeOrDecimal: nonEmptyCells.some((v) => /[.-]/.test(v)),
      firstNameScore: nameDictionaryScore(nonEmptyCells, COMMON_FIRST_NAMES),
      lastNameScore: nameDictionaryScore(nonEmptyCells, COMMON_SURNAMES),
      birthLikeness: dominantKind === 'date' ? birthDateLikeness(nonEmptyCells) : 0,
      dominantTextSubKind: dominantTextSubKindOf(nonEmptyCells),
    });
  }
  return profiles;
}

/**
 * A row's "shape signature": the sequence of (position, hard value kind) for its NON-text,
 * non-empty cells — i.e. where the email/phone/date/money values sit. Rows that share a
 * signature share a column alignment. A legitimately blank optional field (a missing DOB or
 * gender) does NOT change the signature, so sparse-but-consistent rows group together; only an
 * actual shift of shaped values produces a different signature. This is what lets the majority
 * define the canonical structure (spec 50 §15.1, per the three-tab staging model).
 */
export function rowShapeSignature(row: string[]): string {
  const parts: string[] = [];
  for (let c = 0; c < row.length; c++) {
    const v = (row[c] ?? '').trim();
    if (v === '') continue;
    const k = classifyCell(v);
    if (k === 'text' || k === 'number') continue; // text & bare numbers are too generic to anchor
    parts.push(`${c}:${k}`);
  }
  return parts.join(',');
}

/**
 * Derive the CANONICAL column profiles from the MAJORITY row shape, not from all rows. Rows are
 * grouped by their shape signature; the largest group defines the structure and profiles are
 * built from that cohort only. This prevents a cluster of shifted rows from polluting detection
 * (the bug where a majority of country-dropped rows made the country column look like free text
 * and erased the join-date column). Falls back to all-rows profiling when nothing anchors a shape.
 */
export function canonicalProfiles(dataRows: string[][], width: number): {
  profiles: ColumnProfile[];
  canonicalSignature: string;
  cohortSize: number;
} {
  if (dataRows.length === 0) {
    return { profiles: profileColumns(dataRows, width), canonicalSignature: '', cohortSize: 0 };
  }
  const groups = new Map<string, string[][]>();
  for (const row of dataRows) {
    const sig = rowShapeSignature(row);
    if (!groups.has(sig)) groups.set(sig, []);
    groups.get(sig)!.push(row);
  }
  // Largest cohort wins; an empty signature (no shaped anchors at all) is a weak last resort.
  let bestSig = ''; let bestRows: string[][] = [];
  for (const [sig, rows] of groups) {
    const better = rows.length > bestRows.length
      || (rows.length === bestRows.length && sig !== '' && bestSig === '');
    if (better) { bestSig = sig; bestRows = rows; }
  }
  const cohort = bestRows.length > 0 ? bestRows : dataRows;
  return { profiles: profileColumns(cohort, width), canonicalSignature: bestSig, cohortSize: bestRows.length };
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
  // Profile from the MAJORITY row shape so a cluster of shifted rows can't erase a real column
  // (e.g. the country column disappearing because most rows had dropped it). §15.1.
  const profiles = canonicalProfiles(dataRows, width).profiles;
  const fieldSet = new Set(fields.map((f) => f.field));

  // byName: normalised synonym → field (first wins on collision).
  const byName = new Map<string, string>();
  for (const f of fields) for (const s of f.synonyms) if (!byName.has(normalizeHeader(s))) byName.set(normalizeHeader(s), f.field);

  const used = new Set<string>(); // a field maps to at most one column
  const result: Array<{ field: string | null; confidence: Confidence }> =
    Array.from({ length: width }, () => ({ field: null, confidence: 'unknown' as Confidence }));

  const claim = (c: number, field: string, confidence: Confidence) => {
    if (used.has(field) || !fieldSet.has(field)) return false;
    result[c] = { field, confidence };
    used.add(field);
    return true;
  };

  // A column carries a "deliberate foreign header" when there IS a header row and this column's
  // header is a non-empty label that matched no known field. That label is a user signal the
  // column is something we don't model (e.g. "Loyalty #"), so value-shape *inference* (id by
  // pattern/number, name by dictionary, date-role) must NOT override it — only the decisive,
  // self-evident value shapes (email/phone) may, as they already did before Wave 4.
  const hasForeignHeader = (c: number): boolean => {
    if (!hasHeader) return false;
    const h = normalizeHeader(headerRow[c] ?? '');
    return h !== '' && !byName.has(h);
  };

  // --- Pass 1: header name match → CERTAIN (only when there's a header). ---
  if (hasHeader) {
    for (let c = 0; c < width; c++) {
      const named = byName.get(normalizeHeader(headerRow[c] ?? ''));
      if (named) claim(c, named, 'certain');
    }
  }

  // --- Pass 2: decisive value shapes → CERTAIN (email, phone, money; and a patterned id). ---
  // These are self-evident from the values regardless of header.
  for (let c = 0; c < width; c++) {
    if (result[c].field) continue;
    const p = profiles[c];
    if (p.nonEmpty === 0) continue;
    if (p.dominance >= 0.8 && p.dominantKind !== 'text' && p.dominantKind !== 'empty') {
      const candidate = fields.find((f) => f.valueKinds?.includes(p.dominantKind) && !used.has(f.field));
      // A single date column maps certainly; two date columns are disambiguated in pass 4.
      const dateColumns = profiles.filter((q) => q.dominantKind === 'date' && q.dominance >= 0.8).length;
      if (candidate && !(p.dominantKind === 'date' && dateColumns > 1)) {
        claim(c, candidate.field, 'certain');
        continue;
      }
    }
    if (p.allPatternedId && fieldSet.has('legacy_customer_id') && !hasForeignHeader(c)) {
      // A patterned id (LEG-10001) is distinctive enough to be certain when nothing contradicts
      // it, but a deliberate foreign header (e.g. "Loyalty #") suppresses the inference entirely.
      claim(c, 'legacy_customer_id', 'certain');
    }
  }

  // --- Pass 3: bare-number identifier → LIKELY (uniqueness + integer shape + leading position). ---
  // A bare number is indistinguishable by value from a balance/points/count, so this is a
  // low-confidence proposal, never asserted; of equally id-shaped columns, the leftmost wins.
  if (fieldSet.has('legacy_customer_id') && !used.has('legacy_customer_id')) {
    const idCandidates = profiles
      .filter((p) => !result[p.index].field && p.nonEmpty > 0 && p.allPlainInteger && p.allUnique
        && !p.hasNegativeOrDecimal && !hasForeignHeader(p.index))
      .sort((a, b) => a.index - b.index); // position tie-breaker: leftmost
    if (idCandidates.length) claim(idCandidates[0].index, 'legacy_customer_id', 'likely');
  }

  // --- Pass 4: name dictionaries + date-role → LIKELY (inferred, worth a glance). ---
  // Inference is suppressed on columns with a deliberate foreign header.
  assignNamesByDictionary(profiles, result, used, fieldSet, claim, hasForeignHeader);
  assignDateRoles(profiles, result, used, fieldSet, claim, hasForeignHeader);

  // --- Assemble proposals. ---
  const proposals: ColumnProposal[] = [];
  for (let c = 0; c < width; c++) {
    const label = hasHeader ? (headerRow[c] ?? `Column ${c + 1}`) : `Column ${c + 1}`;
    const { field, confidence } = result[c];
    proposals.push({ index: c, column: label, field, confident: confidence === 'certain', confidence });
  }
  return proposals;
}

type ClaimFn = (c: number, field: string, confidence: Confidence) => boolean;

/**
 * Pick the first-name column as the text column that scores highest on given-names (above a
 * floor), then infer the adjacent remaining text column as last name. Both are LIKELY — a
 * confidence-scored suggestion, never asserted (spec 50 §15.2/§15.5).
 */
function assignNamesByDictionary(
  profiles: ColumnProfile[],
  result: Array<{ field: string | null; confidence: Confidence }>,
  used: Set<string>,
  fieldSet: Set<string>,
  claim: ClaimFn,
  isForeignHeader: (c: number) => boolean,
): void {
  const wantFirst = fieldSet.has('first_name') && !used.has('first_name');
  const wantLast = fieldSet.has('last_name') && !used.has('last_name');
  if (!wantFirst && !wantLast) return;

  const textCols = profiles.filter(
    (p) => !result[p.index].field && p.nonEmpty > 0 && !isForeignHeader(p.index)
      && (p.firstNameScore > 0 || p.lastNameScore > 0),
  );
  if (textCols.length === 0) return;

  const FLOOR = 0.3; // at least ~a third of the column's tokens are recognised names
  if (wantFirst) {
    const firstCol = [...textCols]
      .filter((p) => p.firstNameScore >= FLOOR && p.firstNameScore >= p.lastNameScore)
      .sort((a, b) => b.firstNameScore - a.firstNameScore)[0];
    if (firstCol) {
      claim(firstCol.index, 'first_name', 'likely');
      // Infer last name as the best surname-scoring OTHER text column (prefer an adjacent one).
      if (wantLast && !used.has('last_name')) {
        const lastCandidates = profiles.filter(
          (p) => !result[p.index].field && p.nonEmpty > 0 && !isForeignHeader(p.index)
            && (p.lastNameScore > 0 || p.firstNameScore > 0),
        );
        const adjacent = lastCandidates.find((p) => Math.abs(p.index - firstCol.index) === 1);
        const best = [...lastCandidates].sort((a, b) => b.lastNameScore - a.lastNameScore)[0];
        const pick = adjacent ?? best;
        if (pick) claim(pick.index, 'last_name', 'likely');
      }
    }
  } else if (wantLast) {
    const lastCol = [...textCols]
      .filter((p) => p.lastNameScore >= FLOOR)
      .sort((a, b) => b.lastNameScore - a.lastNameScore)[0];
    if (lastCol) claim(lastCol.index, 'last_name', 'likely');
  }
}

/**
 * When two or more date columns remain, assign DOB vs a join date by distribution: the most
 * birth-date-like column (older, wider spread) → date_of_birth; the least → joined. Both LIKELY.
 */
function assignDateRoles(
  profiles: ColumnProfile[],
  result: Array<{ field: string | null; confidence: Confidence }>,
  used: Set<string>,
  fieldSet: Set<string>,
  claim: ClaimFn,
  isForeignHeader: (c: number) => boolean,
): void {
  const dateCols = profiles.filter(
    (p) => !result[p.index].field && !isForeignHeader(p.index) && p.dominantKind === 'date' && p.dominance >= 0.8,
  );
  if (dateCols.length < 2) return; // a single leftover date column is handled by the value pass

  const sorted = [...dateCols].sort((a, b) => b.birthLikeness - a.birthLikeness);
  if (fieldSet.has('date_of_birth')) claim(sorted[0].index, 'date_of_birth', 'likely');
  if (fieldSet.has('joined')) claim(sorted[sorted.length - 1].index, 'joined', 'likely');
}

// ---------------------------------------------------------------------------
// Profile-driven row-alignment repair (Wave 4 — spec 50 §15.3)
// ---------------------------------------------------------------------------

/**
 * The value kind each mapped column expects, derived from the column profiles. A column that
 * is dominantly one value shape (email/phone/date/money) expects that shape; a free-text or
 * mixed column expects 'text' (which anything satisfies). Used to score whether a row's cells
 * line up with their columns, so a shifted row can be detected even when its cell count matches.
 */
export function expectedKinds(profiles: ColumnProfile[]): CellKind[] {
  return profiles.map((p) => {
    if (p.nonEmpty === 0) return 'text';
    if (p.dominance >= 0.8 && p.dominantKind !== 'text' && p.dominantKind !== 'empty') return p.dominantKind;
    return 'text';
  });
}

/** Does a single cell satisfy a column's expected kind? Empty satisfies anything (optional value). */
function cellFits(value: string, expected: CellKind): boolean {
  const v = (value ?? '').trim();
  if (v === '') return true;          // an empty cell is allowed in any column
  if (expected === 'text') return true; // a free-text column accepts anything
  return classifyCell(v) === expected;
}

/**
 * Soft sub-classification of a free-text value, used ONLY as a tiebreaker when the hard
 * value kinds (email/phone/date/money) can't pinpoint where a dropped value sits among a run of
 * text columns. These are gentle shape hints, not authoritative: a locale code (`en-US`), a
 * short code (`US`), a tag list (`a;b`), a sentence (notes), or a short word (a name/gender).
 */
export type TextSubKind = 'locale' | 'shortcode' | 'taglist' | 'sentence' | 'word' | 'other';

export function textSubKind(value: string): TextSubKind {
  const v = (value ?? '').trim();
  if (v === '') return 'other';
  if (/^[a-z]{2}[-_][A-Za-z]{2}$/.test(v)) return 'locale';           // en-US, it-IT
  if (v.includes(';')) return 'taglist';                              // fitness;new-member
  if (/\s/.test(v.trim()) && v.length > 12) return 'sentence';        // a notes sentence
  if (/^[A-Za-z]{2,3}$/.test(v)) return 'shortcode';                  // US, GB, USA
  if (/^[\p{L}][\p{L}'’-]*$/u.test(v)) return 'word';                 // a single word (name/gender)
  return 'other';
}

/**
 * Score how badly a row's cells line up with the expected column kinds (lower is better; 0 is a
 * clean fit). Two kinds of evidence, both needed to catch a left-shift where free-text columns
 * mask the problem:
 *  1. a NON-EMPTY cell whose value violates its shape-constrained column (e.g. a sentence in the
 *     email column) — a direct misfit; and
 *  2. a shape-constrained column that is EMPTY while a value OF THAT SHAPE sits elsewhere in a
 *     column that doesn't require it (e.g. the joined date column is empty but a date is sitting
 *     in the free-text notes column) — the tell-tale that a value was dropped and the rest shifted.
 * Free-text columns accept anything, so a shift only reveals itself through the shaped columns it
 * disturbs; counting the shaped columns that fail to receive their value is what exposes it.
 */
function misfitScore(row: string[], expected: CellKind[]): number {
  let bad = 0;
  // (1) wrong-shaped values in shape-constrained columns.
  for (let c = 0; c < expected.length; c++) {
    const v = (row[c] ?? '').trim();
    if (v === '') continue;
    if (!cellFits(v, expected[c])) bad++;
  }
  // (2) a shape-constrained column left empty while a value of its shape is misplaced elsewhere.
  for (let c = 0; c < expected.length; c++) {
    const want = expected[c];
    if (want === 'text') continue;
    const here = (row[c] ?? '').trim();
    if (here !== '' && cellFits(here, want)) continue; // satisfied
    // Column c is unsatisfied. Is there a value of this shape sitting in a non-matching column?
    const misplaced = row.some((cell, idx) => {
      const cv = (cell ?? '').trim();
      return cv !== '' && idx !== c && expected[idx] !== want && classifyCell(cv) === want;
    });
    if (misplaced) bad++;
  }
  return bad;
}

export type RowAlignment = 'ok' | 'repaired' | 'unresolved';

export interface RowRepairResult {
  /** The row's cells after any repair (unchanged when ok/unresolved). */
  cells: string[];
  alignment: RowAlignment;
  /** The original cells, present when the row was repaired (for a before/after review sample). */
  before?: string[];
  /** Plain-language reason when unresolved (for the failure report). */
  reason?: string;
}

/**
 * Realign one row against the expected column kinds. The detector is profile-fit, NOT column
 * count: a row that already has the right number of cells but whose shaped values sit in the
 * wrong columns (a dropped value compensated by a trailing empty cell) is still caught.
 *
 * Candidate repairs tried, each re-scored by misfitScore:
 *  - the row as-is;
 *  - drop a trailing empty cell (the dropped-value-plus-trailing-empty case) then, for each
 *    position, insert an empty cell — i.e. "a value went missing at slot k, everything after
 *    shifted left, and an empty was appended to keep the count";
 *  - for a too-LONG row (an unquoted delimiter over-split a free-text column), re-join the
 *    overflow back into the first free-text column.
 *
 * Exactly one candidate reaching misfit 0 (and strictly better than as-is) → repaired.
 * As-is already fits → ok. Zero fit, or two-plus distinct candidates tie at the best score
 * → unresolved (never guess), with a reason.
 */
export function repairRow(row: string[], profiles: ColumnProfile[]): RowRepairResult {
  const expected = expectedKinds(profiles);
  const width = expected.length;
  const asIs = misfitScore(padOrTrimless(row, width), expected);
  if (asIs === 0 && row.length === width) return { cells: row.slice(), alignment: 'ok' };

  // Build candidate alignments (each normalised to `width` cells for scoring).
  const candidates: string[][] = [];
  const seen = new Set<string>();
  const add = (cells: string[]) => {
    const norm = cells.slice(0, width);
    while (norm.length < width) norm.push('');
    const key = norm.join('\u0001');
    if (!seen.has(key)) { seen.add(key); candidates.push(norm); }
  };

  // Case A: drop one trailing empty, then try inserting an empty at each slot (a value was
  // dropped mid-row, the rest shifted left, and a trailing empty was appended).
  const trimmed = row.slice();
  while (trimmed.length > 0 && (trimmed[trimmed.length - 1] ?? '').trim() === '' && trimmed.length > width - 1) {
    trimmed.pop();
  }
  if (trimmed.length === width - 1) {
    for (let k = 0; k < width; k++) {
      const c = trimmed.slice();
      c.splice(k, 0, '');
      add(c);
    }
  }

  // Case B: row is too long — re-join the overflow into the first free-text column.
  if (row.length > width) {
    const firstText = expected.indexOf('text');
    if (firstText >= 0) {
      const overflow = row.length - width;
      const c = row.slice();
      const joined = c.slice(firstText, firstText + overflow + 1).join(', ');
      c.splice(firstText, overflow + 1, joined);
      add(c);
    }
  }

  // Score candidates by HARD misfit (shaped columns). Among the best, break ties by SOFT fit —
  // how well each value's text sub-kind matches its column's dominant sub-kind — which is what
  // separates "dropped country" from "dropped gender" when both leave the shaped columns happy.
  const scored = candidates.map((c) => ({
    c, hard: misfitScore(c, expected), soft: softMisfit(c, profiles),
  }));
  if (scored.length === 0) {
    return unresolved(row, asIs);
  }
  const minHard = Math.min(...scored.map((s) => s.hard));
  if (minHard > 0) return unresolved(row, asIs); // nothing lines the shaped columns up cleanly
  const hardWinners = scored.filter((s) => s.hard === minHard);
  const minSoft = Math.min(...hardWinners.map((s) => s.soft));
  const best = hardWinners.filter((s) => s.soft === minSoft);

  if (best.length === 1 && (asIs > 0 || row.length !== width)) {
    return { cells: best[0].c, alignment: 'repaired', before: row.slice() };
  }
  if (asIs === 0) return { cells: padOrTrimless(row, width), alignment: 'ok' };
  return unresolved(row, asIs, best.length > 1);
}

function unresolved(row: string[], _asIs: number, tie = false): RowRepairResult {
  return {
    cells: row.slice(),
    alignment: 'unresolved',
    reason: tie
      ? 'the row lines up more than one way — a value is probably missing; fix the row and re-import'
      : 'the row\u2019s values do not line up with the columns — a value may be missing or an extra separator split a field',
  };
}

/**
 * Soft misfit: among alignments that satisfy the hard shaped columns equally, count how many
 * non-empty text cells land in a text column whose dominant sub-kind they don't match (a
 * sentence in a shortcode column, a locale code in a sentence column, …). Lower is better; this
 * is the tiebreaker that places a dropped value in the right free-text slot.
 */
function softMisfit(row: string[], profiles: ColumnProfile[]): number {
  let bad = 0;
  for (let c = 0; c < profiles.length; c++) {
    const p = profiles[c];
    if (p.dominantKind !== 'text' && p.dominantKind !== 'empty') continue; // only text columns
    const v = (row[c] ?? '').trim();
    if (v === '') continue;
    const want = p.dominantTextSubKind;
    if (want === 'other') continue; // no clear expectation → no penalty
    if (textSubKind(v) !== want) bad++;
  }
  return bad;
}

/** Pad a row with empty strings to `width` without trimming real cells (only for scoring). */
function padOrTrimless(row: string[], width: number): string[] {
  const c = row.slice();
  while (c.length < width) c.push('');
  return c;
}

export interface RepairSummary {
  rows: string[][];        // repaired/ok rows, aligned to the column width
  repaired: number;
  unresolved: number;
  /** Up to a few before/after samples of repaired rows for the review step. */
  samples: Array<{ row: number; before: string[]; after: string[] }>;
  /** Per-row failures for unresolved rows: 1-based row number + reason. */
  failures: Array<{ row: number; reason: string }>;
  /**
   * Per-row outcome for the three-tab staging UI (Stage B): the 1-based source row, its aligned
   * cells, how it was classified, and the raw cells + reason for the Error tab's shift editor.
   */
  perRow: Array<{
    row: number;
    alignment: RowAlignment;      // ok | repaired | unresolved
    cells: string[];              // aligned cells (for ok/repaired); raw cells for unresolved
    raw: string[];                // the original cells as read from the file
    reason?: string;              // present when unresolved
  }>;
}

/**
 * Apply row-alignment repair across all data rows. The canonical column structure is derived
 * from the MAJORITY row shape (not all rows), so a cluster of shifted rows cannot pollute the
 * profiles used to judge alignment (spec 50 §15.1/§15.3, three-tab staging model). A caller may
 * pass pre-computed profiles (e.g. tests, or to reuse a known-clean cohort); otherwise the
 * majority cohort is computed from `dataRows`. Pure.
 */
export function repairRows(dataRows: string[][], profilesOrWidth: ColumnProfile[] | number): RepairSummary {
  const profiles = Array.isArray(profilesOrWidth)
    ? profilesOrWidth
    : canonicalProfiles(dataRows, profilesOrWidth).profiles;
  const out: string[][] = [];
  const samples: RepairSummary['samples'] = [];
  const failures: RepairSummary['failures'] = [];
  const perRow: RepairSummary['perRow'] = [];
  let repaired = 0;
  let unresolvedCount = 0;

  for (let i = 0; i < dataRows.length; i++) {
    const res = repairRow(dataRows[i], profiles);
    out.push(res.cells);
    perRow.push({ row: i + 1, alignment: res.alignment, cells: res.cells, raw: dataRows[i].slice(), reason: res.reason });
    if (res.alignment === 'repaired') {
      repaired++;
      if (samples.length < 5) samples.push({ row: i + 1, before: res.before!, after: res.cells });
    } else if (res.alignment === 'unresolved') {
      unresolvedCount++;
      failures.push({ row: i + 1, reason: res.reason! });
    }
  }
  return { rows: out, repaired, unresolved: unresolvedCount, samples, failures, perRow };
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
