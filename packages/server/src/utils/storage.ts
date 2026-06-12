import path from 'path';

/**
 * Generate a tenant-scoped file storage path.
 * All uploaded files are stored under a tenant-specific directory.
 *
 * Example: getStoragePath('tenant-uuid', 'avatars/user1.jpg')
 *   → '/storage/tenant-uuid/avatars/user1.jpg'
 */
export function getStoragePath(tenantId: string, filePath: string): string {
  // Prevent path traversal attacks
  const safePath = path.normalize(filePath).replace(/^(\.\.(\/|\\|$))+/, '');
  return path.join('/storage', tenantId, safePath);
}

/**
 * Validate that a given path belongs to the specified tenant.
 * Returns true if the path is within the tenant's storage scope.
 */
export function isWithinTenantScope(tenantId: string, fullPath: string): boolean {
  const tenantRoot = path.normalize(path.join('/storage', tenantId));
  const normalizedPath = path.normalize(fullPath);
  return normalizedPath.startsWith(tenantRoot);
}
