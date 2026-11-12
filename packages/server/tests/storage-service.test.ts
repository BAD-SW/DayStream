import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { backendFor, testStorage } from '../src/services/storage.service';

/** The local backend, against a throwaway folder (no database or S3 needed). */
describe('local storage — no empty folders left behind', () => {
  let root: string;
  beforeEach(() => { root = fs.mkdtempSync(path.join(os.tmpdir(), 'ds-storage-')); });
  afterEach(() => { fs.rmSync(root, { recursive: true, force: true }); });

  const custDir = 'tenants/t1/businesses/b1/private/customers/c1';

  it('saves and reads a file', async () => {
    const s = backendFor({ storage_type: 'local', local_path: root });
    await s.save(`${custDir}/forms/f1.pdf`, Buffer.from('pdf'));
    expect((await s.read(`${custDir}/forms/f1.pdf`))?.toString()).toBe('pdf');
    expect(await s.exists(`${custDir}/forms/f1.pdf`)).toBe(true);
  });

  it('deleting the last file in a folder removes the empty folders up to the private anchor', async () => {
    const s = backendFor({ storage_type: 'local', local_path: root });
    await s.save(`${custDir}/documents/d1.pdf`, Buffer.from('x'));
    await s.delete(`${custDir}/documents/d1.pdf`);
    expect(fs.existsSync(path.join(root, custDir, 'documents'))).toBe(false);
    expect(fs.existsSync(path.join(root, custDir))).toBe(false);
    expect(fs.existsSync(path.join(root, 'tenants/t1/businesses/b1/private'))).toBe(true); // anchor kept
  });

  it('deleting one file keeps folders that still hold other files', async () => {
    const s = backendFor({ storage_type: 'local', local_path: root });
    await s.save(`${custDir}/documents/d1.pdf`, Buffer.from('x'));
    await s.save(`${custDir}/forms/f1.pdf`, Buffer.from('y'));
    await s.delete(`${custDir}/documents/d1.pdf`);
    expect(fs.existsSync(path.join(root, custDir, 'documents'))).toBe(false);
    expect(fs.existsSync(path.join(root, custDir, 'forms', 'f1.pdf'))).toBe(true);
  });

  it('deleting a customer folder removes the folder itself and everything in it', async () => {
    const s = backendFor({ storage_type: 'local', local_path: root });
    await s.save(`${custDir}/documents/d1.pdf`, Buffer.from('x'));
    await s.save(`${custDir}/photos/p1.jpg`, Buffer.from('y'));
    await s.deleteDirectory(custDir);
    expect(fs.existsSync(path.join(root, custDir))).toBe(false);
    expect(fs.existsSync(path.join(root, 'tenants/t1/businesses/b1/private/customers'))).toBe(false); // emptied parent pruned
  });

  it('refuses paths outside the storage root', async () => {
    const s = backendFor({ storage_type: 'local', local_path: root });
    await expect(s.save('../escape.txt', Buffer.from('x'))).rejects.toThrow(/outside the storage root/);
    expect(await s.read('../../etc/passwd')).toBeNull();
    await expect(s.deleteDirectory('.')).rejects.toThrow(/storage root/);
  });

  it('Test Connection writes, reads back and deletes a test file, leaving nothing behind', async () => {
    const result = await testStorage({ storage_type: 'local', local_path: root });
    expect(result.ok).toBe(true);
    expect(fs.readdirSync(root)).toEqual([]);
  });

  it('Test Connection reports an incomplete S3 configuration instead of crashing', async () => {
    const result = await testStorage({ storage_type: 'aws_s3', s3_bucket: '' });
    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/no bucket/);
  });
});

import { storagePaths, pathFromReference } from '../src/utils/storage-paths';

describe('storagePaths — one layout, by tenant, business and customer', () => {
  const T = '11111111-1111-1111-1111-111111111111';
  const B = '22222222-2222-2222-2222-222222222222';
  const C = '33333333-3333-3333-3333-333333333333';

  it('puts customer files in the customer folder, by kind', () => {
    const base = `tenants/${T}/businesses/${B}/private/customers/${C}`;
    expect(storagePaths.customerFolder(T, B, C)).toBe(base);
    expect(storagePaths.customerDocument(T, B, C, 'pdf')).toMatch(new RegExp(`^${base}/documents/[0-9a-f-]{36}\\.pdf$`));
    expect(storagePaths.customerPhoto(T, B, C, 'JPG')).toMatch(new RegExp(`^${base}/photos/[0-9a-f-]{36}\\.jpg$`));
    expect(storagePaths.customerForm(T, B, C, 'sub-1')).toBe(`${base}/forms/sub-1.pdf`);
    expect(storagePaths.customerDataExport(T, B, C)).toMatch(new RegExp(`^${base}/data-exports/[0-9a-f-]{36}\\.pdf$`));
  });

  it('puts business and tenant files in their public folders', () => {
    expect(storagePaths.businessLogo(T, B, 'png')).toMatch(new RegExp(`^tenants/${T}/businesses/${B}/public/branding/logo-`));
    expect(storagePaths.productImageFolder(T, B, 'p1')).toBe(`tenants/${T}/businesses/${B}/public/products/p1`);
    expect(storagePaths.websiteMedia(T, 'a b.png')).toBe(`tenants/${T}/tenant/public/website/a_b.png`);
    expect(storagePaths.staffPhoto(T, 's1', 'jpg')).toMatch(new RegExp(`^tenants/${T}/tenant/public/staff/s1-`));
  });

  it('refuses ids that would change the path shape', () => {
    expect(() => storagePaths.customerFolder(T, B, '../other')).toThrow();
    expect(() => storagePaths.businessRoot('a/b', B)).toThrow();
    expect(storagePaths.customerDocument(T, B, C, '../../x')).toMatch(/\.bin$/);
  });

  it('reads a storage path out of a stored URL or bare path', () => {
    expect(pathFromReference('/storage/tenants/x/a.png')).toBe('tenants/x/a.png');
    expect(pathFromReference('http://localhost:4001/storage/tenants/x/a.png')).toBe('tenants/x/a.png');
    expect(pathFromReference('products/b/p/original/f.jpg')).toBe('products/b/p/original/f.jpg');
    expect(pathFromReference(null)).toBeNull();
  });
});
