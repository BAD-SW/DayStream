import { adminPool } from '../db/pool';

/**
 * Get navigation for a site (both header and footer).
 */
export async function getNavigation(siteId: string) {
  const { rows } = await adminPool.query(
    `SELECT * FROM web_navigation WHERE site_id = $1`,
    [siteId],
  );

  const result: { header: any | null; footer: any | null } = { header: null, footer: null };
  for (const row of rows) {
    if (row.nav_type === 'header') result.header = row;
    if (row.nav_type === 'footer') result.footer = row;
  }
  return result;
}

/**
 * Update (upsert) navigation for a site.
 */
export async function updateNavigation(
  siteId: string,
  navType: 'header' | 'footer',
  items: any[],
  settings?: Record<string, any>,
) {
  const { rows } = await adminPool.query(
    `INSERT INTO web_navigation (site_id, nav_type, items, settings)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (site_id, nav_type) DO UPDATE SET
       items = EXCLUDED.items,
       settings = EXCLUDED.settings
     RETURNING *`,
    [
      siteId,
      navType,
      JSON.stringify(items),
      JSON.stringify(settings || {}),
    ],
  );
  return rows[0];
}
