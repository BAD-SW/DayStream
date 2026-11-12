import crypto from 'crypto';
import { adminPool } from '../db/pool';

/**
 * Every stored file's path (spec 51, gap 1 — design §1.2). One layout, separated by tenant and
 * business (and customer for customer files), so no feature builds a path by hand:
 *
 *   tenants/{tenantId}/
 *     tenant/public/website/{file}            CMS media (the website is the tenant's)
 *     tenant/public/staff/{staffId}-{uuid}.{ext}  staff photos (staff belong to the tenant)
 *     businesses/{businessId}/
 *       public/branding/logo-{uuid}.{ext}, favicon-{uuid}.{ext}
 *       public/resources/{resourceId}-{uuid}.{ext}
 *       public/products/{merchandiseId}/{size}/{fileId}.{ext}
 *       public/services/{serviceId}/{size}/{fileId}.{ext}
 *       private/customers/{customerId}/
 *         documents/{uuid}.{ext}, photos/{uuid}.{ext}, forms/{submissionId}.pdf, data-exports/{uuid}.pdf
 *
 * A `private` segment is never served by the public /storage route. File names carry a random id
 * so a replaced logo or photo gets a new URL (no stale browser caches).
 */

/** Ids are UUIDs or similar; refuse anything that could change the path's shape. */
function seg(value: string, what: string): string {
  const v = String(value ?? '');
  if (!/^[A-Za-z0-9_-]+$/.test(v)) throw new Error(`Invalid ${what} for a storage path`);
  return v;
}
function ext(value: string): string {
  const e = String(value ?? '').toLowerCase().replace(/^\./, '');
  return /^[a-z0-9]{1,8}$/.test(e) ? e : 'bin';
}
const rid = () => crypto.randomUUID();

const tenantRoot = (t: string) => `tenants/${seg(t, 'tenant id')}`;
const businessRoot = (t: string, b: string) => `${tenantRoot(t)}/businesses/${seg(b, 'business id')}`;

export const storagePaths = {
  tenantRoot,
  businessRoot,

  // --- Customer files (private) ---
  customerFolder: (t: string, b: string, c: string) => `${businessRoot(t, b)}/private/customers/${seg(c, 'customer id')}`,
  customerDocument: (t: string, b: string, c: string, fileExt: string) => `${storagePaths.customerFolder(t, b, c)}/documents/${rid()}.${ext(fileExt)}`,
  customerPhoto: (t: string, b: string, c: string, fileExt: string) => `${storagePaths.customerFolder(t, b, c)}/photos/${rid()}.${ext(fileExt)}`,
  customerForm: (t: string, b: string, c: string, submissionId: string) => `${storagePaths.customerFolder(t, b, c)}/forms/${seg(submissionId, 'submission id')}.pdf`,
  customerChart: (t: string, b: string, c: string, chartId: string) => `${storagePaths.customerFolder(t, b, c)}/charts/${seg(chartId, 'chart id')}.pdf`,
  customerDataExport: (t: string, b: string, c: string) => `${storagePaths.customerFolder(t, b, c)}/data-exports/${rid()}.pdf`,

  // --- Business files (public) ---
  businessLogo: (t: string, b: string, fileExt: string) => `${businessRoot(t, b)}/public/branding/logo-${rid()}.${ext(fileExt)}`,
  businessFavicon: (t: string, b: string, fileExt: string) => `${businessRoot(t, b)}/public/branding/favicon-${rid()}.${ext(fileExt)}`,
  resourcePhoto: (t: string, b: string, resourceId: string, fileExt: string) => `${businessRoot(t, b)}/public/resources/${seg(resourceId, 'resource id')}-${rid()}.${ext(fileExt)}`,
  /** Folder holding a product's image sizes (original/, medium/, thumbnail/). */
  productImageFolder: (t: string, b: string, merchandiseId: string) => `${businessRoot(t, b)}/public/products/${seg(merchandiseId, 'product id')}`,
  /** Folder holding a service's image sizes (original/, large/, medium/, thumbnail/). */
  serviceImageFolder: (t: string, b: string, serviceId: string) => `${businessRoot(t, b)}/public/services/${seg(serviceId, 'service id')}`,

  // --- Tenant files (public) ---
  websiteMedia: (t: string, fileName: string) => `${tenantRoot(t)}/tenant/public/website/${String(fileName).replace(/[^A-Za-z0-9._-]/g, '_')}`,
  staffPhoto: (t: string, staffId: string, fileExt: string) => `${tenantRoot(t)}/tenant/public/staff/${seg(staffId, 'staff id')}-${rid()}.${ext(fileExt)}`,
};

/** A storage path from a stored reference that may be a public URL ("/storage/…") or a bare path. */
export function pathFromReference(ref: string | null | undefined): string | null {
  if (!ref) return null;
  const s = String(ref);
  const i = s.indexOf('/storage/');
  return (i >= 0 ? s.slice(i + '/storage/'.length) : s).replace(/^\/+/, '') || null;
}

const tenantCache = new Map<string, string>();

/** The tenant a business belongs to (it never changes), for building its storage paths. */
export async function tenantOfBusiness(businessId: string): Promise<string> {
  const hit = tenantCache.get(businessId);
  if (hit) return hit;
  const { rows } = await adminPool.query('SELECT tenant_id FROM sys_businesses WHERE id = $1', [businessId]);
  if (!rows[0]?.tenant_id) throw new Error('Business not found');
  tenantCache.set(businessId, rows[0].tenant_id);
  return rows[0].tenant_id;
}
