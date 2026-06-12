import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../src/db/pool', () => ({
  pool: { query: vi.fn() },
  adminPool: { query: vi.fn() },
}));

import { adminPool } from '../src/db/pool';
import { getConfig, setConfig, invalidateCache } from '../src/services/config.service';

const mockQuery = adminPool.query as ReturnType<typeof vi.fn>;

// Mock audit service to avoid DB calls
vi.mock('../src/services/audit.service', () => ({
  logAudit: vi.fn(),
}));

describe('Configuration Service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    invalidateCache('tenant-1');
  });

  it('returns tenant override when available', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ value: '#FF0000', data_type: 'string' }],
    });

    const result = await getConfig('tenant-1', 'brand.primary_color');
    expect(result).toBe('#FF0000');
  });

  it('falls back to default when no tenant override', async () => {
    // First call: tenant override query returns empty
    mockQuery.mockResolvedValueOnce({ rows: [] });
    // Second call: default value query
    mockQuery.mockResolvedValueOnce({
      rows: [{ default_value: '#C9A96E', data_type: 'string' }],
    });

    const result = await getConfig('tenant-1', 'brand.primary_color');
    expect(result).toBe('#C9A96E');
  });

  it('returns cached value on second call', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ value: 'cached-value', data_type: 'string' }],
    });

    await getConfig('tenant-1', 'brand.primary_color');
    const result = await getConfig('tenant-1', 'brand.primary_color');

    expect(result).toBe('cached-value');
    // Should only have called the DB once
    expect(mockQuery).toHaveBeenCalledTimes(1);
  });

  it('invalidates cache on set', async () => {
    // Populate cache
    mockQuery.mockResolvedValueOnce({
      rows: [{ value: 'old-value', data_type: 'string' }],
    });
    await getConfig('tenant-1', 'brand.primary_color');

    // Set new value (validates key exists + upserts)
    mockQuery.mockResolvedValueOnce({ rows: [{ data_type: 'string' }] }); // key exists check
    mockQuery.mockResolvedValueOnce({ rows: [] }); // upsert

    await setConfig('tenant-1', 'brand.primary_color', '#000000', 'user-1');

    // Next get should hit DB again (cache invalidated)
    mockQuery.mockResolvedValueOnce({
      rows: [{ value: '#000000', data_type: 'string' }],
    });
    const result = await getConfig('tenant-1', 'brand.primary_color');
    expect(result).toBe('#000000');
  });

  it('parses boolean values correctly', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ value: 'true', data_type: 'boolean' }],
    });

    const result = await getConfig('tenant-1', 'feature.online_booking');
    expect(result).toBe(true);
  });

  it('parses number values correctly', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ value: '30', data_type: 'number' }],
    });

    const result = await getConfig('tenant-1', 'limit.max_advance_booking_days');
    expect(result).toBe(30);
  });

  it('throws for unknown key on set', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] }); // key not found

    await expect(
      setConfig('tenant-1', 'nonexistent.key', 'value', 'user-1'),
    ).rejects.toThrow('does not exist');
  });
});
