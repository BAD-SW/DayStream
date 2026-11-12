import 'dotenv/config';
import path from 'path';
import { adminPool } from './pool';
import { storage } from '../services/storage.service';
import { storagePaths } from '../utils/storage-paths';

/**
 * One-time move of stored files into the tenant / business / customer layout (spec 51, gap 1 —
 * design §1.2). Run on the current environment once; a real deployment starts empty and only ever
 * writes the new layout.
 *
 *   npm run storage:relayout -- --dry-run     list what would move, change nothing
 *   npm run storage:relayout                  move
 *
 * For every stored file reference it: works out the new path, copies the file there, reads the copy
 * back and compares it, updates the row, then deletes the old file. It works against whichever
 * storage backend is configured. Safe to run again: references already in the new layout are
 * skipped, and a file found already at its new path (an interrupted earlier run) is just pointed to.
 * A reference whose file is missing is reported and left unchanged. At the end it removes the old
 * top-level folders it emptied; files nobody references are listed and left in place.
 */

const DRY = process.argv.includes('--dry-run');
const NEW_ROOT = 'tenants/';

interface Report { moved: number; skipped: number; missing: string[]; errors: string[] }
const report: Report = { moved: 0, skipped: 0, missing: [], errors: [] };
const plan: string[] = [];
/** In a dry run: files that would move, so they aren't also reported as unreferenced. */
const plannedFrom = new Set<string>();

const base = (p: string) => path.posix.basename(p);
const urlOf = (p: string) => storage.getUrl(p);
/** A stored reference may be a bare path or a "/storage/…" URL. */
const toPath = (ref: string) => { const i = ref.indexOf('/storage/'); return (i >= 0 ? ref.slice(i + 9) : ref).replace(/^\/+/, ''); };

/** Copy one file to its new path, verify it, delete the old one. Returns whether the reference may be updated. */
async function moveFile(from: string, to: string): Promise<boolean> {
  if (from === to) return true;
  if (DRY) { plan.push(`${from}  ->  ${to}`); plannedFrom.add(from); return true; }
  const data = await storage.read(from);
  if (!data) {
    // An interrupted earlier run may already have moved it.
    if (await storage.exists(to)) return true;
    report.missing.push(from);
    return false;
  }
  await storage.save(to, data);
  const back = await storage.read(to);
  if (!back || !back.equals(data)) { report.errors.push(`Copy check failed: ${from}`); return false; }
  await storage.delete(from);
  return true;
}

/** Move every file under a folder, keeping the paths below it. */
async function moveFolder(fromFolder: string, toFolder: string): Promise<boolean> {
  const files = await storage.listFiles(fromFolder);
  if (files.length === 0) return (await storage.listFiles(toFolder)).length > 0 || DRY; // already moved, or nothing there
  let ok = true;
  for (const f of files) {
    const rest = f.slice(fromFolder.replace(/\/$/, '').length + 1);
    if (!(await moveFile(f, `${toFolder}/${rest}`))) ok = false;
  }
  return ok;
}

async function step(name: string, fn: () => Promise<void>) {
  const before = report.moved;
  try { await fn(); } catch (err: any) { report.errors.push(`${name}: ${err?.message || err}`); }
  console.log(`  ${name}: ${report.moved - before} ${DRY ? 'to move' : 'moved'}`);
}

async function update(sql: string, params: unknown[]) {
  if (!DRY) await adminPool.query(sql, params);
  report.moved++;
}

async function main() {
  console.log(`Storage re-layout${DRY ? ' (dry run: nothing is changed)' : ''}`);

  // --- Customer documents ---
  await step('Customer documents', async () => {
    const { rows } = await adminPool.query(`SELECT id, tenant_id, business_id, customer_id, storage_path FROM cus_documents WHERE storage_path NOT LIKE $1`, [`${NEW_ROOT}%`]);
    for (const r of rows) {
      const to = `${storagePaths.customerFolder(r.tenant_id, r.business_id, r.customer_id)}/documents/${base(r.storage_path)}`;
      if (await moveFile(r.storage_path, to)) await update('UPDATE cus_documents SET storage_path = $2 WHERE id = $1', [r.id, to]);
    }
  });

  // --- Customer photos ---
  await step('Customer photos', async () => {
    const { rows } = await adminPool.query(`SELECT id, tenant_id, business_id, photo_path FROM cus_customers WHERE photo_path IS NOT NULL AND photo_path NOT LIKE $1`, [`${NEW_ROOT}%`]);
    for (const r of rows) {
      const to = `${storagePaths.customerFolder(r.tenant_id, r.business_id, r.id)}/photos/${base(r.photo_path)}`;
      if (await moveFile(r.photo_path, to)) await update('UPDATE cus_customers SET photo_path = $2 WHERE id = $1', [r.id, to]);
    }
  });

  // --- Personal-data exports ---
  await step('Personal-data exports', async () => {
    const { rows } = await adminPool.query(`SELECT id, tenant_id, business_id, customer_id, storage_path FROM cus_data_exports WHERE storage_path NOT LIKE $1`, [`${NEW_ROOT}%`]);
    for (const r of rows) {
      const to = `${storagePaths.customerFolder(r.tenant_id, r.business_id, r.customer_id)}/data-exports/${base(r.storage_path)}`;
      if (await moveFile(r.storage_path, to)) await update('UPDATE cus_data_exports SET storage_path = $2 WHERE id = $1', [r.id, to]);
    }
  });

  // --- Business logos and favicons (stored as /storage/ URLs) ---
  await step('Business logos and favicons', async () => {
    const { rows } = await adminPool.query(`SELECT id, tenant_id, logo_url, favicon_url FROM sys_businesses WHERE logo_url LIKE '%/storage/%' OR favicon_url LIKE '%/storage/%'`);
    for (const r of rows) {
      for (const col of ['logo_url', 'favicon_url'] as const) {
        const ref: string | null = r[col];
        if (!ref || !ref.includes('/storage/') || toPath(ref).startsWith(NEW_ROOT)) continue;
        const from = toPath(ref);
        const to = `${storagePaths.businessRoot(r.tenant_id, r.id)}/public/branding/${base(from)}`;
        if (await moveFile(from, to)) await update(`UPDATE sys_businesses SET ${col} = $2 WHERE id = $1`, [r.id, urlOf(to)]);
      }
    }
  });

  // --- Website media (tenant) ---
  await step('Website media', async () => {
    const { rows } = await adminPool.query(
      `SELECT id, tenant_id, file_path, thumbnail_path, medium_path, large_path FROM web_media_files WHERE file_path NOT LIKE $1`, [`${NEW_ROOT}%`]);
    for (const r of rows) {
      const cols = ['file_path', 'thumbnail_path', 'medium_path', 'large_path'] as const;
      const next: Record<string, string | null> = {};
      let ok = true;
      for (const col of cols) {
        const from: string | null = r[col];
        if (!from) { next[col] = null; continue; }
        const to = from.startsWith(NEW_ROOT) ? from : storagePaths.websiteMedia(r.tenant_id, base(from));
        if (!(await moveFile(from, to))) ok = false;
        next[col] = to;
      }
      if (ok) await update('UPDATE web_media_files SET file_path = $2, thumbnail_path = $3, medium_path = $4, large_path = $5 WHERE id = $1',
        [r.id, next.file_path, next.thumbnail_path, next.medium_path, next.large_path]);
    }
  });

  // --- Resource photos ---
  await step('Resource photos', async () => {
    const { rows } = await adminPool.query(`SELECT id, tenant_id, business_id, photo_path FROM res_resources WHERE photo_path IS NOT NULL AND photo_path NOT LIKE $1`, [`${NEW_ROOT}%`]);
    for (const r of rows) {
      const from = toPath(r.photo_path);
      const to = `${storagePaths.businessRoot(r.tenant_id, r.business_id)}/public/resources/${base(from)}`;
      if (await moveFile(from, to)) await update('UPDATE res_resources SET photo_path = $2 WHERE id = $1', [r.id, to]);
    }
  });

  // --- Staff photos (tenant) ---
  await step('Staff photos', async () => {
    const { rows } = await adminPool.query(`SELECT id, tenant_id, profile_photo_path FROM stf_profiles WHERE profile_photo_path IS NOT NULL AND profile_photo_path NOT LIKE $1`, [`${NEW_ROOT}%`]);
    for (const r of rows) {
      const from = toPath(r.profile_photo_path);
      const to = `${storagePaths.tenantRoot(r.tenant_id)}/tenant/public/staff/${base(from)}`;
      if (await moveFile(from, to)) await update('UPDATE stf_profiles SET profile_photo_path = $2 WHERE id = $1', [r.id, to]);
    }
  });

  // --- Product images: the whole product folder (original + sizes) ---
  await step('Product images', async () => {
    const { rows } = await adminPool.query(
      `SELECT m.id, m.business_id, b.tenant_id, m.image_url FROM prd_merchandise m JOIN sys_businesses b ON b.id = m.business_id
        WHERE m.image_url IS NOT NULL AND m.image_url NOT LIKE $1`, [`${NEW_ROOT}%`]);
    for (const r of rows) {
      const from = toPath(r.image_url);
      const oldFolder = from.replace(/\/original\/.*$/, '');
      const newFolder = storagePaths.productImageFolder(r.tenant_id, r.business_id, r.id);
      if (oldFolder === from) { report.errors.push(`Product image has an unexpected path: ${from}`); continue; }
      if (await moveFolder(oldFolder, newFolder)) {
        await update('UPDATE prd_merchandise SET image_url = $2 WHERE id = $1', [r.id, newFolder + from.slice(oldFolder.length)]);
      }
    }
  });

  // --- Service images: each service's folder (original + sizes), all its image rows ---
  await step('Service images', async () => {
    const { rows } = await adminPool.query(
      `SELECT i.id, i.service_id, s.business_id, b.tenant_id, i.file_path FROM svc_images i
         JOIN svc_services s ON s.id = i.service_id JOIN sys_businesses b ON b.id = s.business_id
        WHERE i.file_path NOT LIKE $1 ORDER BY i.service_id`, [`${NEW_ROOT}%`]);
    const movedFolders = new Map<string, boolean>();
    for (const r of rows) {
      const from = toPath(r.file_path);
      const oldFolder = from.replace(/\/original\/.*$/, '');
      if (oldFolder === from) { report.errors.push(`Service image has an unexpected path: ${from}`); continue; }
      const newFolder = storagePaths.serviceImageFolder(r.tenant_id, r.business_id, r.service_id);
      if (!movedFolders.has(oldFolder)) movedFolders.set(oldFolder, await moveFolder(oldFolder, newFolder));
      if (movedFolders.get(oldFolder)) {
        await update('UPDATE svc_images SET file_path = $2 WHERE id = $1', [r.id, newFolder + from.slice(oldFolder.length)]);
      }
    }
  });

  // --- Old folders: remove the ones now empty; list files nobody references ---
  const LEGACY = ['private/customer-documents', 'private/customer-photos', 'private/data-exports', 'private', 'businesses', 'cms', 'resources', 'staff', 'products', 'services'];
  const leftovers: string[] = [];
  for (const folder of LEGACY) {
    const files = (await storage.listFiles(folder)).filter((f) => !plannedFrom.has(f));
    if (files.length === 0) { if (!DRY) await storage.deleteDirectory(folder).catch(() => {}); }
    else if (!folder.startsWith('private/') || folder === 'private') leftovers.push(...files.filter((f) => !leftovers.includes(f)));
  }

  console.log('');
  if (DRY) {
    console.log(`Would move ${plan.length} file(s) and update ${report.moved} reference(s):`);
    for (const line of plan) console.log(`  ${line}`);
  } else {
    console.log(`Updated ${report.moved} reference(s).`);
  }
  if (report.missing.length) { console.log(`Missing (reference left unchanged): ${report.missing.length}`); report.missing.forEach((m) => console.log(`  ${m}`)); }
  if (report.errors.length) { console.log(`Errors: ${report.errors.length}`); report.errors.forEach((e) => console.log(`  ${e}`)); }
  if (leftovers.length) {
    console.log(`Files in the old folders that nothing references (left in place): ${leftovers.length}`);
    leftovers.slice(0, 50).forEach((f) => console.log(`  ${f}`));
    if (leftovers.length > 50) console.log(`  … and ${leftovers.length - 50} more`);
  }
  await adminPool.end();
  process.exit(report.errors.length ? 1 : 0);
}

main().catch(async (err) => {
  console.error('Storage re-layout failed:', err?.message || err);
  await adminPool.end().catch(() => {});
  process.exit(1);
});
