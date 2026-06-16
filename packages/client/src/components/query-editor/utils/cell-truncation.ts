/**
 * Maximum number of characters to display before truncating.
 */
const MAX_DISPLAY_LENGTH = 256;

/**
 * Display information for a cell value.
 */
export interface CellDisplayInfo {
  /** The truncated or full display value */
  displayValue: string;
  /** Whether the value was truncated */
  isTruncated: boolean;
  /** The full string representation of the value */
  fullValue: string;
}

/**
 * Takes a cell value and returns display info with truncation applied if needed.
 * Truncates string representation at 256 characters.
 *
 * @param value - The cell value (can be any type)
 * @returns Display info with truncated value and metadata
 */
export function truncateCellValue(value: unknown): CellDisplayInfo {
  if (value === null || value === undefined) {
    const stringValue = value === null ? 'NULL' : '';
    return {
      displayValue: stringValue,
      isTruncated: false,
      fullValue: stringValue,
    };
  }

  const fullValue = typeof value === 'string' ? value : String(value);

  if (fullValue.length <= MAX_DISPLAY_LENGTH) {
    return {
      displayValue: fullValue,
      isTruncated: false,
      fullValue,
    };
  }

  return {
    displayValue: fullValue.slice(0, MAX_DISPLAY_LENGTH),
    isTruncated: true,
    fullValue,
  };
}
