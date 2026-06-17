/**
 * Generic case-insensitive substring matching filter.
 * Used for filtering tables, history entries, and saved queries.
 *
 * @param items - The list of items to filter
 * @param search - The search string to match against
 * @param extractor - A function that extracts the searchable field from each item
 * @returns Items whose extracted field contains the search string (case-insensitive)
 */
export function filterBySubstring<T>(
  items: T[],
  search: string,
  extractor: (item: T) => string
): T[] {
  if (!search) {
    return items;
  }

  const normalizedSearch = search.toLowerCase();

  return items.filter((item) => {
    const field = extractor(item);
    return field.toLowerCase().includes(normalizedSearch);
  });
}
