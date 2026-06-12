import { describe, it, expect } from 'vitest';
import { paginateSQL, paginationMeta } from '../src/utils/pagination';

describe('paginateSQL', () => {
  it('generates correct SQL clause for first page', () => {
    const result = paginateSQL(
      { page: 1, limit: 20, sort: 'created_at', order: 'desc' },
      ['created_at', 'name'],
    );
    expect(result.clause).toBe('ORDER BY created_at desc LIMIT 20 OFFSET 0');
    expect(result.offset).toBe(0);
  });

  it('generates correct offset for page 3', () => {
    const result = paginateSQL(
      { page: 3, limit: 10, sort: 'name', order: 'asc' },
      ['created_at', 'name'],
    );
    expect(result.clause).toBe('ORDER BY name asc LIMIT 10 OFFSET 20');
    expect(result.offset).toBe(20);
  });

  it('falls back to created_at for disallowed sort columns', () => {
    const result = paginateSQL(
      { page: 1, limit: 20, sort: 'password_hash', order: 'desc' },
      ['created_at', 'name'],
    );
    expect(result.clause).toContain('ORDER BY created_at');
  });
});

describe('paginationMeta', () => {
  it('calculates total pages correctly', () => {
    const meta = paginationMeta(55, { page: 1, limit: 20, sort: 'created_at', order: 'desc' });
    expect(meta.total).toBe(55);
    expect(meta.totalPages).toBe(3);
    expect(meta.page).toBe(1);
    expect(meta.limit).toBe(20);
  });

  it('returns 1 page for 0 results', () => {
    const meta = paginationMeta(0, { page: 1, limit: 20, sort: 'created_at', order: 'desc' });
    expect(meta.totalPages).toBe(0);
  });

  it('handles exact page boundary', () => {
    const meta = paginationMeta(40, { page: 2, limit: 20, sort: 'created_at', order: 'desc' });
    expect(meta.totalPages).toBe(2);
  });
});
