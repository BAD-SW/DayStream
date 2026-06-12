/**
 * Generate a URL-friendly slug from a string.
 */
export function generateSlug(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // strip accents
    .replace(/[^a-z0-9]+/g, '-')    // replace non-alphanumeric with hyphens
    .replace(/^-+|-+$/g, '')        // trim leading/trailing hyphens
    .substring(0, 100);             // max length
}
