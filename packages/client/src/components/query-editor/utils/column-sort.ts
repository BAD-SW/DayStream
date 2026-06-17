/**
 * Sort direction for column sorting.
 */
export type SortDirection = 'asc' | 'desc';

/**
 * Sorts an array of row objects by a specified column.
 * - Handles null/undefined values by placing them last regardless of sort direction.
 * - Handles numeric and string comparisons appropriately.
 *
 * @param rows - The array of row objects to sort
 * @param column - The column name to sort by
 * @param direction - The sort direction ('asc' or 'desc')
 * @returns A new sorted array (does not mutate the original)
 */
export function sortByColumn(
  rows: Record<string, unknown>[],
  column: string,
  direction: SortDirection
): Record<string, unknown>[] {
  return [...rows].sort((a, b) => {
    const aVal = a[column];
    const bVal = b[column];

    // Null/undefined values go last regardless of direction
    const aIsNull = aVal == null;
    const bIsNull = bVal == null;

    if (aIsNull && bIsNull) return 0;
    if (aIsNull) return 1;
    if (bIsNull) return -1;

    let comparison: number;

    // Numeric comparison when both values are numbers
    if (typeof aVal === 'number' && typeof bVal === 'number') {
      comparison = aVal - bVal;
    } else {
      // String comparison (convert to string for consistent ordering)
      const aStr = String(aVal);
      const bStr = String(bVal);
      comparison = aStr.localeCompare(bStr);
    }

    return direction === 'asc' ? comparison : -comparison;
  });
}
