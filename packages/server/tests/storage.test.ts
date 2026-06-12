import { describe, it, expect } from 'vitest';
import { getStoragePath, isWithinTenantScope } from '../src/utils/storage';

describe('getStoragePath', () => {
  it('creates tenant-scoped path', () => {
    const result = getStoragePath('tenant-123', 'avatars/photo.jpg');
    expect(result).toContain('tenant-123');
    expect(result).toContain('avatars');
    expect(result).toContain('photo.jpg');
  });

  it('prevents path traversal', () => {
    const result = getStoragePath('tenant-123', '../../etc/passwd');
    expect(result).not.toContain('..');
    expect(result).toContain('tenant-123');
  });
});

describe('isWithinTenantScope', () => {
  it('returns true for valid tenant path', () => {
    expect(isWithinTenantScope('tenant-123', '/storage/tenant-123/files/doc.pdf')).toBe(true);
  });

  it('returns false for path outside tenant scope', () => {
    expect(isWithinTenantScope('tenant-123', '/storage/tenant-456/files/doc.pdf')).toBe(false);
  });

  it('returns false for path traversal attempt', () => {
    expect(isWithinTenantScope('tenant-123', '/storage/tenant-123/../tenant-456/secret.pdf')).toBe(false);
  });
});
