import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the pool before importing the service
vi.mock('../src/db/pool', () => ({
  pool: { query: vi.fn() },
  adminPool: { query: vi.fn() },
}));

import { adminPool } from '../src/db/pool';
import { isFeatureEnabled, invalidateFlagCache } from '../src/services/feature-flag.service';

const mockQuery = adminPool.query as ReturnType<typeof vi.fn>;

describe('Feature Flag Service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    invalidateFlagCache();
  });

  it('returns false for unknown flag', async () => {
    mockQuery.mockResolvedValue({ rows: [] });
    const result = await isFeatureEnabled('nonexistent.flag', { tenantId: 'tenant-1' });
    expect(result).toBe(false);
  });

  it('returns global flag enabled state', async () => {
    mockQuery.mockResolvedValue({
      rows: [{ id: 'flag-1', key: 'feature.booking', scope: 'global', enabled: true, percentage: null }],
    });
    const result = await isFeatureEnabled('feature.booking', { tenantId: 'tenant-1' });
    expect(result).toBe(true);
  });

  it('returns global flag disabled state', async () => {
    mockQuery.mockResolvedValue({
      rows: [{ id: 'flag-1', key: 'feature.disabled', scope: 'global', enabled: false, percentage: null }],
    });
    const result = await isFeatureEnabled('feature.disabled', { tenantId: 'tenant-1' });
    expect(result).toBe(false);
  });

  it('checks tenant override for tenant-scoped flag', async () => {
    // First call loads all flags
    mockQuery.mockResolvedValueOnce({
      rows: [{ id: 'flag-2', key: 'feature.sms', scope: 'tenant', enabled: false, percentage: null }],
    });
    // Second call checks tenant override
    mockQuery.mockResolvedValueOnce({
      rows: [{ enabled: true }],
    });

    const result = await isFeatureEnabled('feature.sms', { tenantId: 'tenant-1' });
    expect(result).toBe(true);
  });

  it('falls back to default for tenant-scoped flag with no override', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ id: 'flag-2', key: 'feature.sms', scope: 'tenant', enabled: false, percentage: null }],
    });
    mockQuery.mockResolvedValueOnce({ rows: [] }); // no override

    const result = await isFeatureEnabled('feature.sms', { tenantId: 'tenant-1' });
    expect(result).toBe(false);
  });

  it('uses deterministic hash for percentage flags', async () => {
    mockQuery.mockResolvedValue({
      rows: [{ id: 'flag-3', key: 'feature.beta', scope: 'percentage', enabled: true, percentage: 50 }],
    });

    // Same tenant + flag should always return same result
    const result1 = await isFeatureEnabled('feature.beta', { tenantId: 'tenant-fixed' });
    invalidateFlagCache();
    mockQuery.mockResolvedValue({
      rows: [{ id: 'flag-3', key: 'feature.beta', scope: 'percentage', enabled: true, percentage: 50 }],
    });
    const result2 = await isFeatureEnabled('feature.beta', { tenantId: 'tenant-fixed' });
    expect(result1).toBe(result2); // deterministic
  });
});
