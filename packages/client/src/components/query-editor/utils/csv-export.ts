/**
 * RFC 4180 compliant CSV export utility.
 *
 * - Column headers as the first row
 * - Comma delimiter
 * - Double-quote enclosure for fields containing commas, quotes, or newlines
 * - Null values as empty fields
 * - UTF-8 encoding
 */

/**
 * Escapes a single field value according to RFC 4180.
 * Fields containing commas, double quotes, or newlines are enclosed in double quotes.
 * Double quotes within fields are escaped by doubling them.
 */
function escapeField(value: unknown): string {
  if (value === null || value === undefined) {
    return '';
  }

  const str = typeof value === 'string' ? value : String(value);

  // If the field contains a comma, double-quote, or newline, enclose in quotes
  if (str.includes(',') || str.includes('"') || str.includes('\n') || str.includes('\r')) {
    return '"' + str.replace(/"/g, '""') + '"';
  }

  return str;
}

/**
 * Generates an RFC 4180 compliant CSV string from columns and rows.
 *
 * @param columns - Array of column header names
 * @param rows - Array of row objects with column names as keys
 * @returns The CSV string
 */
export function generateCsv(
  columns: string[],
  rows: Record<string, unknown>[]
): string {
  const lines: string[] = [];

  // Header row
  lines.push(columns.map(escapeField).join(','));

  // Data rows
  for (const row of rows) {
    const fields = columns.map((col) => escapeField(row[col]));
    lines.push(fields.join(','));
  }

  return lines.join('\r\n');
}

/**
 * Generates a timestamp string in the format YYYY-MM-DD-HHmmss for filenames.
 */
function getTimestampForFilename(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  const hours = String(now.getHours()).padStart(2, '0');
  const minutes = String(now.getMinutes()).padStart(2, '0');
  const seconds = String(now.getSeconds()).padStart(2, '0');
  return `${year}-${month}-${day}-${hours}${minutes}${seconds}`;
}

/**
 * Triggers a browser download of the CSV export.
 * Filename pattern: query-results-{YYYY-MM-DD-HHmmss}.csv
 *
 * @param columns - Array of column header names
 * @param rows - Array of row objects with column names as keys
 */
export function downloadCsv(
  columns: string[],
  rows: Record<string, unknown>[]
): void {
  const csv = generateCsv(columns, rows);
  const filename = `query-results-${getTimestampForFilename()}.csv`;

  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);

  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.style.display = 'none';
  document.body.appendChild(link);
  link.click();

  // Cleanup
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
