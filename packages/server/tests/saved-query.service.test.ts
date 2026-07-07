import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../src/db/pool', () => ({
  pool: { query: vi.fn() },
  adminPool: { query: vi.fn() },
}));

import { pool } from '../src/db/pool';
import { SavedQueryService, SavedQueryServiceError } from '../src/services/query-editor/saved-query.service';

const mockQuery = pool.query as ReturnType<typeof vi.fn>;

describe('SavedQueryService', () => {
  let service: SavedQueryService;

  const USER_ID = '00000000-0000-0000-0000-000000000001';
  const TENANT_ID = '00000000-0000-0000-0000-000000000002';
  const QUERY_ID = '00000000-0000-0000-0000-000000000003';

  beforeEach(() => {
    vi.clearAllMocks();
    service = new SavedQueryService();
  });

  describe('create()', () => {
    it('creates a saved query with valid input', async () => {
      const now = new Date().toISOString();
      mockQuery
        .mockResolvedValueOnce({ rows: [{ count: 0 }] }) // count check
        .mockResolvedValueOnce({ rows: [] }) // uniqueness check
        .mockResolvedValueOnce({
          rows: [{
            id: QUERY_ID,
            tenant_id: TENANT_ID,
            user_id: USER_ID,
            name: 'My Query',
            description: 'A test query',
            query_text: 'SELECT 1',
            created_at: now,
            updated_at: now,
          }],
        });

      const result = await service.create(USER_ID, TENANT_ID, {
        name: 'My Query',
        description: 'A test query',
        queryText: 'SELECT 1',
      });

      expect(result.id).toBe(QUERY_ID);
      expect(result.name).toBe('My Query');
      expect(result.description).toBe('A test query');
      expect(result.queryText).toBe('SELECT 1');
    });

    it('rejects empty name', async () => {
      await expect(
        service.create(USER_ID, TENANT_ID, { name: '', queryText: 'SELECT 1' }),
      ).rejects.toMatchObject({ code: 'INVALID_NAME' });
    });

    it('rejects whitespace-only name', async () => {
      await expect(
        service.create(USER_ID, TENANT_ID, { name: '   ', queryText: 'SELECT 1' }),
      ).rejects.toMatchObject({ code: 'INVALID_NAME' });
    });

    it('rejects name exceeding 100 characters', async () => {
      const longName = 'a'.repeat(101);
      await expect(
        service.create(USER_ID, TENANT_ID, { name: longName, queryText: 'SELECT 1' }),
      ).rejects.toMatchObject({ code: 'INVALID_NAME' });
    });

    it('accepts name with exactly 100 characters', async () => {
      const name = 'a'.repeat(100);
      const now = new Date().toISOString();
      mockQuery
        .mockResolvedValueOnce({ rows: [{ count: 0 }] })
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({
          rows: [{
            id: QUERY_ID,
            tenant_id: TENANT_ID,
            user_id: USER_ID,
            name,
            description: null,
            query_text: 'SELECT 1',
            created_at: now,
            updated_at: now,
          }],
        });

      const result = await service.create(USER_ID, TENANT_ID, { name, queryText: 'SELECT 1' });
      expect(result.name).toBe(name);
    });

    it('rejects description exceeding 500 characters', async () => {
      const longDesc = 'a'.repeat(501);
      await expect(
        service.create(USER_ID, TENANT_ID, { name: 'Test', description: longDesc, queryText: 'SELECT 1' }),
      ).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    });

    it('rejects query text exceeding 10000 characters', async () => {
      const longQuery = 'a'.repeat(10001);
      await expect(
        service.create(USER_ID, TENANT_ID, { name: 'Test', queryText: longQuery }),
      ).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    });

    it('rejects empty query text', async () => {
      await expect(
        service.create(USER_ID, TENANT_ID, { name: 'Test', queryText: '' }),
      ).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    });

    it('rejects duplicate name for the same user', async () => {
      mockQuery
        .mockResolvedValueOnce({ rows: [{ count: 5 }] }) // count check
        .mockResolvedValueOnce({ rows: [{ id: 'existing-id' }] }); // uniqueness check finds duplicate

      await expect(
        service.create(USER_ID, TENANT_ID, { name: 'Existing', queryText: 'SELECT 1' }),
      ).rejects.toMatchObject({ code: 'DUPLICATE_NAME' });
    });

    it('rejects when save limit (50) is reached', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [{ count: 50 }] }); // count check

      await expect(
        service.create(USER_ID, TENANT_ID, { name: 'New Query', queryText: 'SELECT 1' }),
      ).rejects.toMatchObject({ code: 'SAVE_LIMIT' });
    });
  });

  describe('update()', () => {
    it('updates a saved query with valid input', async () => {
      const now = new Date().toISOString();
      // getById call
      mockQuery.mockResolvedValueOnce({
        rows: [{
          id: QUERY_ID,
          tenant_id: TENANT_ID,
          user_id: USER_ID,
          name: 'Old Name',
          description: null,
          query_text: 'SELECT 1',
          created_at: now,
          updated_at: now,
        }],
      });
      // name uniqueness check
      mockQuery.mockResolvedValueOnce({ rows: [] });
      // update query
      mockQuery.mockResolvedValueOnce({
        rows: [{
          id: QUERY_ID,
          tenant_id: TENANT_ID,
          user_id: USER_ID,
          name: 'New Name',
          description: null,
          query_text: 'SELECT 1',
          created_at: now,
          updated_at: now,
        }],
      });

      const result = await service.update(QUERY_ID, USER_ID, { name: 'New Name' });
      expect(result.name).toBe('New Name');
    });

    it('throws NOT_FOUND when query does not exist', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [] }); // getById returns nothing

      await expect(
        service.update(QUERY_ID, USER_ID, { name: 'Test' }),
      ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    });

    it('rejects duplicate name on update', async () => {
      const now = new Date().toISOString();
      // getById
      mockQuery.mockResolvedValueOnce({
        rows: [{
          id: QUERY_ID,
          tenant_id: TENANT_ID,
          user_id: USER_ID,
          name: 'Original',
          description: null,
          query_text: 'SELECT 1',
          created_at: now,
          updated_at: now,
        }],
      });
      // uniqueness check finds duplicate
      mockQuery.mockResolvedValueOnce({ rows: [{ id: 'other-id' }] });

      await expect(
        service.update(QUERY_ID, USER_ID, { name: 'Taken Name' }),
      ).rejects.toMatchObject({ code: 'DUPLICATE_NAME' });
    });

    it('skips uniqueness check when name is unchanged', async () => {
      const now = new Date().toISOString();
      // getById
      mockQuery.mockResolvedValueOnce({
        rows: [{
          id: QUERY_ID,
          tenant_id: TENANT_ID,
          user_id: USER_ID,
          name: 'Same Name',
          description: null,
          query_text: 'SELECT 1',
          created_at: now,
          updated_at: now,
        }],
      });
      // update query (no uniqueness check needed)
      mockQuery.mockResolvedValueOnce({
        rows: [{
          id: QUERY_ID,
          tenant_id: TENANT_ID,
          user_id: USER_ID,
          name: 'Same Name',
          description: 'New description',
          query_text: 'SELECT 1',
          created_at: now,
          updated_at: now,
        }],
      });

      const result = await service.update(QUERY_ID, USER_ID, { name: 'Same Name', description: 'New description' });
      expect(result.description).toBe('New description');
      // Should have called query only twice (getById + update), no uniqueness check
      expect(mockQuery).toHaveBeenCalledTimes(2);
    });

    it('returns existing query when no fields to update', async () => {
      const now = new Date().toISOString();
      mockQuery.mockResolvedValueOnce({
        rows: [{
          id: QUERY_ID,
          tenant_id: TENANT_ID,
          user_id: USER_ID,
          name: 'Test',
          description: null,
          query_text: 'SELECT 1',
          created_at: now,
          updated_at: now,
        }],
      });

      const result = await service.update(QUERY_ID, USER_ID, {});
      expect(result.name).toBe('Test');
      expect(mockQuery).toHaveBeenCalledTimes(1); // only getById
    });
  });

  describe('delete()', () => {
    it('deletes a saved query by id and userId', async () => {
      mockQuery.mockResolvedValueOnce({ rowCount: 1 });

      await expect(service.delete(QUERY_ID, USER_ID)).resolves.toBeUndefined();
      expect(mockQuery).toHaveBeenCalledWith(
        'DELETE FROM sys_saved_queries WHERE id = $1 AND user_id = $2',
        [QUERY_ID, USER_ID],
      );
    });

    it('throws NOT_FOUND when query does not exist', async () => {
      mockQuery.mockResolvedValueOnce({ rowCount: 0 });

      await expect(
        service.delete(QUERY_ID, USER_ID),
      ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    });
  });

  describe('list()', () => {
    it('returns queries ordered by updated_at DESC', async () => {
      const now = new Date().toISOString();
      mockQuery.mockResolvedValueOnce({
        rows: [
          { id: '1', tenant_id: TENANT_ID, user_id: USER_ID, name: 'Query B', description: null, query_text: 'SELECT 2', created_at: now, updated_at: now },
          { id: '2', tenant_id: TENANT_ID, user_id: USER_ID, name: 'Query A', description: null, query_text: 'SELECT 1', created_at: now, updated_at: now },
        ],
      });

      const results = await service.list(USER_ID, TENANT_ID);
      expect(results).toHaveLength(2);
      expect(results[0].name).toBe('Query B');

      // Verify ORDER BY clause
      const queryCall = mockQuery.mock.calls[0][0] as string;
      expect(queryCall).toContain('ORDER BY updated_at DESC');
    });

    it('supports search by name/description', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [] });

      await service.list(USER_ID, TENANT_ID, { search: 'test' });

      const queryCall = mockQuery.mock.calls[0][0] as string;
      expect(queryCall).toContain('LOWER(name) LIKE $3');
      expect(queryCall).toContain('LOWER(COALESCE(description,');
      expect(mockQuery.mock.calls[0][1]).toContain('%test%');
    });

    it('returns empty array when no queries found', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [] });

      const results = await service.list(USER_ID, TENANT_ID);
      expect(results).toEqual([]);
    });
  });

  describe('getById()', () => {
    it('returns a saved query when found', async () => {
      const now = new Date().toISOString();
      mockQuery.mockResolvedValueOnce({
        rows: [{
          id: QUERY_ID,
          tenant_id: TENANT_ID,
          user_id: USER_ID,
          name: 'Test',
          description: 'A description',
          query_text: 'SELECT 1',
          created_at: now,
          updated_at: now,
        }],
      });

      const result = await service.getById(QUERY_ID, USER_ID);
      expect(result).not.toBeNull();
      expect(result!.id).toBe(QUERY_ID);
      expect(result!.name).toBe('Test');
    });

    it('returns null when not found', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [] });

      const result = await service.getById(QUERY_ID, USER_ID);
      expect(result).toBeNull();
    });
  });
});
