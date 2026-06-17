import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../db/pool', () => ({
  pool: { query: vi.fn() },
  adminPool: { query: vi.fn() },
}));

vi.mock('../../../middleware/logger', () => ({
  logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn() },
}));

import { pool } from '../../../db/pool';
import { QueryHistoryService } from '../query-history.service';

const mockQuery = pool.query as ReturnType<typeof vi.fn>;

describe('QueryHistoryService', () => {
  let service: QueryHistoryService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new QueryHistoryService();
  });

  describe('record()', () => {
    it('inserts a history entry with all fields', async () => {
      mockQuery.mockResolvedValue({ rows: [], rowCount: 1 });

      await service.record({
        userId: 'user-1',
        tenantId: 'tenant-1',
        queryText: 'SELECT * FROM users',
        executionTimeMs: 150,
        rowCount: 42,
        status: 'success',
      });

      expect(mockQuery).toHaveBeenCalledTimes(1);
      const [sql, params] = mockQuery.mock.calls[0];
      expect(sql).toContain('INSERT INTO query_history');
      expect(params).toEqual([
        'tenant-1',
        'user-1',
        'SELECT * FROM users',
        150,
        42,
        'success',
      ]);
    });

    it('truncates query text exceeding 10,000 characters', async () => {
      mockQuery.mockResolvedValue({ rows: [], rowCount: 1 });

      const longQuery = 'SELECT ' + 'x'.repeat(10_000);
      await service.record({
        userId: 'user-1',
        tenantId: 'tenant-1',
        queryText: longQuery,
        executionTimeMs: 200,
        rowCount: 0,
        status: 'error',
      });

      const [, params] = mockQuery.mock.calls[0];
      expect((params[2] as string).length).toBe(10_000);
    });

    it('does not truncate query text at exactly 10,000 characters', async () => {
      mockQuery.mockResolvedValue({ rows: [], rowCount: 1 });

      const exactQuery = 'x'.repeat(10_000);
      await service.record({
        userId: 'user-1',
        tenantId: 'tenant-1',
        queryText: exactQuery,
        executionTimeMs: 100,
        rowCount: 5,
        status: 'success',
      });

      const [, params] = mockQuery.mock.calls[0];
      expect((params[2] as string).length).toBe(10_000);
    });

    it('throws when database insert fails', async () => {
      mockQuery.mockRejectedValue(new Error('Connection refused'));

      await expect(
        service.record({
          userId: 'user-1',
          tenantId: 'tenant-1',
          queryText: 'SELECT 1',
          executionTimeMs: 10,
          rowCount: 1,
          status: 'success',
        }),
      ).rejects.toThrow('Connection refused');
    });
  });

  describe('list()', () => {
    const mockRows = [
      {
        id: 'entry-1',
        user_id: 'user-1',
        tenant_id: 'tenant-1',
        query_text: 'SELECT * FROM orders',
        execution_time_ms: 300,
        row_count: 10,
        status: 'success',
        created_at: new Date('2024-01-15T10:00:00Z'),
      },
      {
        id: 'entry-2',
        user_id: 'user-1',
        tenant_id: 'tenant-1',
        query_text: 'SELECT count(*) FROM users',
        execution_time_ms: 50,
        row_count: 1,
        status: 'success',
        created_at: new Date('2024-01-14T09:00:00Z'),
      },
    ];

    it('returns entries for the specified user and tenant', async () => {
      mockQuery.mockResolvedValue({ rows: mockRows });

      const result = await service.list('user-1', 'tenant-1');

      expect(result).toHaveLength(2);
      expect(result[0].id).toBe('entry-1');
      expect(result[0].userId).toBe('user-1');
      expect(result[0].tenantId).toBe('tenant-1');
      expect(result[0].queryText).toBe('SELECT * FROM orders');
      expect(result[0].executionTimeMs).toBe(300);
      expect(result[0].rowCount).toBe(10);
      expect(result[0].status).toBe('success');
      expect(result[0].createdAt).toBe('2024-01-15T10:00:00.000Z');
    });

    it('applies case-insensitive search filter using ILIKE', async () => {
      mockQuery.mockResolvedValue({ rows: [] });

      await service.list('user-1', 'tenant-1', { search: 'orders' });

      const [sql, params] = mockQuery.mock.calls[0];
      expect(sql).toContain('ILIKE');
      expect(params).toContain('%orders%');
    });

    it('defaults to limit of 100', async () => {
      mockQuery.mockResolvedValue({ rows: [] });

      await service.list('user-1', 'tenant-1');

      const [sql, params] = mockQuery.mock.calls[0];
      expect(sql).toContain('LIMIT');
      expect(params[params.length - 1]).toBe(100);
    });

    it('caps limit at 100 even if higher value provided', async () => {
      mockQuery.mockResolvedValue({ rows: [] });

      await service.list('user-1', 'tenant-1', { limit: 500 });

      const [, params] = mockQuery.mock.calls[0];
      expect(params[params.length - 1]).toBe(100);
    });

    it('uses custom limit when within bounds', async () => {
      mockQuery.mockResolvedValue({ rows: [] });

      await service.list('user-1', 'tenant-1', { limit: 25 });

      const [, params] = mockQuery.mock.calls[0];
      expect(params[params.length - 1]).toBe(25);
    });

    it('orders by created_at DESC', async () => {
      mockQuery.mockResolvedValue({ rows: [] });

      await service.list('user-1', 'tenant-1');

      const [sql] = mockQuery.mock.calls[0];
      expect(sql).toContain('ORDER BY created_at DESC');
    });
  });

  describe('purgeOlderThan()', () => {
    it('deletes entries older than the specified number of days', async () => {
      mockQuery.mockResolvedValue({ rowCount: 15 });

      const result = await service.purgeOlderThan(30);

      expect(result).toBe(15);
      const [sql, params] = mockQuery.mock.calls[0];
      expect(sql).toContain('DELETE FROM query_history');
      expect(sql).toContain("INTERVAL '1 day' * $1");
      expect(params).toEqual([30]);
    });

    it('defaults to 90 days when no argument is provided', async () => {
      mockQuery.mockResolvedValue({ rowCount: 0 });

      await service.purgeOlderThan();

      const [, params] = mockQuery.mock.calls[0];
      expect(params).toEqual([90]);
    });

    it('returns 0 when no entries are purged', async () => {
      mockQuery.mockResolvedValue({ rowCount: 0 });

      const result = await service.purgeOlderThan(7);

      expect(result).toBe(0);
    });
  });
});
