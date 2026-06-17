import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the query pool
vi.mock('../query-pool', () => {
  const mockClient = {
    query: vi.fn(),
    release: vi.fn(),
  };
  return {
    queryPool: {
      connect: vi.fn().mockResolvedValue(mockClient),
    },
  };
});

import { SchemaService } from '../schema.service';
import { queryPool } from '../query-pool';

describe('SchemaService', () => {
  let service: SchemaService;
  let mockClient: { query: ReturnType<typeof vi.fn>; release: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    vi.clearAllMocks();
    service = new SchemaService();
    mockClient = (queryPool as any).connect.__mock?.results?.[0]?.value;
    // Re-setup the mock client for each test
    mockClient = {
      query: vi.fn(),
      release: vi.fn(),
    };
    (queryPool.connect as any).mockResolvedValue(mockClient);
  });

  describe('getTables', () => {
    it('should return tables with their columns from the public schema', async () => {
      mockClient.query
        // SET LOCAL tenant context
        .mockResolvedValueOnce({ rows: [] })
        // information_schema.tables query
        .mockResolvedValueOnce({
          rows: [
            { table_name: 'customers' },
            { table_name: 'bookings' },
          ],
        })
        // information_schema.columns query
        .mockResolvedValueOnce({
          rows: [
            { table_name: 'customers', column_name: 'id', data_type: 'uuid', is_nullable: 'NO' },
            { table_name: 'customers', column_name: 'name', data_type: 'character varying', is_nullable: 'NO' },
            { table_name: 'customers', column_name: 'email', data_type: 'character varying', is_nullable: 'YES' },
            { table_name: 'bookings', column_name: 'id', data_type: 'uuid', is_nullable: 'NO' },
            { table_name: 'bookings', column_name: 'customer_id', data_type: 'uuid', is_nullable: 'NO' },
          ],
        });

      const result = await service.getTables('tenant-123');

      expect(result).toEqual([
        {
          tableName: 'customers',
          columns: [
            { columnName: 'id', dataType: 'uuid', isNullable: false },
            { columnName: 'name', dataType: 'character varying', isNullable: false },
            { columnName: 'email', dataType: 'character varying', isNullable: true },
          ],
        },
        {
          tableName: 'bookings',
          columns: [
            { columnName: 'id', dataType: 'uuid', isNullable: false },
            { columnName: 'customer_id', dataType: 'uuid', isNullable: false },
          ],
        },
      ]);
    });

    it('should set tenant context before querying', async () => {
      mockClient.query
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [] });

      await service.getTables('tenant-abc');

      expect(mockClient.query).toHaveBeenCalledWith(
        'SET LOCAL app.current_tenant_id = $1',
        ['tenant-abc'],
      );
    });

    it('should exclude default internal tables', async () => {
      mockClient.query
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({
          rows: [
            { table_name: 'customers' },
            { table_name: 'migrations' },
            { table_name: 'audit_log' },
            { table_name: 'login_attempts' },
            { table_name: 'refresh_tokens' },
            { table_name: 'password_history' },
            { table_name: 'query_history' },
            { table_name: 'bookings' },
          ],
        })
        .mockResolvedValueOnce({
          rows: [
            { table_name: 'customers', column_name: 'id', data_type: 'uuid', is_nullable: 'NO' },
            { table_name: 'bookings', column_name: 'id', data_type: 'uuid', is_nullable: 'NO' },
          ],
        });

      const result = await service.getTables('tenant-123');

      const tableNames = result.map((t) => t.tableName);
      expect(tableNames).toContain('customers');
      expect(tableNames).toContain('bookings');
      expect(tableNames).not.toContain('migrations');
      expect(tableNames).not.toContain('audit_log');
      expect(tableNames).not.toContain('login_attempts');
      expect(tableNames).not.toContain('refresh_tokens');
      expect(tableNames).not.toContain('password_history');
      expect(tableNames).not.toContain('query_history');
    });

    it('should exclude tables starting with pg_ prefix', async () => {
      mockClient.query
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({
          rows: [
            { table_name: 'customers' },
            { table_name: 'pg_stat_activity' },
            { table_name: 'pg_settings' },
          ],
        })
        .mockResolvedValueOnce({
          rows: [
            { table_name: 'customers', column_name: 'id', data_type: 'uuid', is_nullable: 'NO' },
          ],
        });

      const result = await service.getTables('tenant-123');

      const tableNames = result.map((t) => t.tableName);
      expect(tableNames).toEqual(['customers']);
    });

    it('should return empty array when no visible tables exist', async () => {
      mockClient.query
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({
          rows: [
            { table_name: 'migrations' },
            { table_name: 'audit_log' },
          ],
        });

      const result = await service.getTables('tenant-123');

      expect(result).toEqual([]);
    });

    it('should return empty array when no tables exist at all', async () => {
      mockClient.query
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [] });

      const result = await service.getTables('tenant-123');

      expect(result).toEqual([]);
    });

    it('should support a configurable exclusion list', async () => {
      const customService = new SchemaService({
        excludedTables: ['custom_internal_table', 'another_hidden'],
      });

      mockClient.query
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({
          rows: [
            { table_name: 'customers' },
            { table_name: 'custom_internal_table' },
            { table_name: 'another_hidden' },
            { table_name: 'migrations' }, // not excluded with custom list
          ],
        })
        .mockResolvedValueOnce({
          rows: [
            { table_name: 'customers', column_name: 'id', data_type: 'uuid', is_nullable: 'NO' },
            { table_name: 'migrations', column_name: 'id', data_type: 'integer', is_nullable: 'NO' },
          ],
        });

      const result = await customService.getTables('tenant-123');

      const tableNames = result.map((t) => t.tableName);
      expect(tableNames).toContain('customers');
      expect(tableNames).toContain('migrations'); // not excluded with custom config
      expect(tableNames).not.toContain('custom_internal_table');
      expect(tableNames).not.toContain('another_hidden');
    });

    it('should always release the client connection', async () => {
      mockClient.query.mockRejectedValueOnce(new Error('DB error'));

      await expect(service.getTables('tenant-123')).rejects.toThrow('DB error');
      expect(mockClient.release).toHaveBeenCalled();
    });

    it('should correctly map is_nullable YES/NO to boolean', async () => {
      mockClient.query
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({
          rows: [{ table_name: 'users' }],
        })
        .mockResolvedValueOnce({
          rows: [
            { table_name: 'users', column_name: 'id', data_type: 'uuid', is_nullable: 'NO' },
            { table_name: 'users', column_name: 'bio', data_type: 'text', is_nullable: 'YES' },
          ],
        });

      const result = await service.getTables('tenant-123');

      expect(result[0].columns[0].isNullable).toBe(false);
      expect(result[0].columns[1].isNullable).toBe(true);
    });
  });
});
