/**
 * JSON export utility.
 *
 * - JSON array of objects
 * - Each row is an object with column names as keys
 * - null values as JSON null
 * - Pretty-printed with 2-space indentation
 */

/**
 * Generates a JSON string from columns and rows.
 * Each row is represented as an object with only the specified column keys.
 * null values are preserved as JSON null.
 *
 * @param columns - Array of column header names
 * @param rows - Array of row objects with column names as keys
 * @returns The pretty-printed JSON string
 */
export function generateJson(
  columns: string[],
  rows: Record<string, unknown>[]
): string {
  const output = rows.map((row) => {
    const obj: Record<string, unknown> = {};
    for (const col of columns) {
      const value = row[col];
      obj[col] = value === undefined ? null : value;
    }
    return obj;
  });

  return JSON.stringify(output, null, 2);
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
 * Triggers a browser download of the JSON export.
 * Filename pattern: query-results-{YYYY-MM-DD-HHmmss}.json
 *
 * @param columns - Array of column header names
 * @param rows - Array of row objects with column names as keys
 */
export function downloadJson(
  columns: string[],
  rows: Record<string, unknown>[]
): void {
  const json = generateJson(columns, rows);
  const filename = `query-results-${getTimestampForFilename()}.json`;

  const blob = new Blob([json], { type: 'application/json;charset=utf-8' });
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
