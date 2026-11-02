import { describe, it, expect } from 'vitest';
import { parseColumnFilters, addColumnFilterConditions } from '../src/utils/column-filters';

// Amount filter (decision 7): a range in cents, either end open.
describe('column filters: amounts', () => {
  it('reads min / max (decimals kept, e.g. 7.5 hours) and drops what is not a number', () => {
    expect(parseColumnFilters(JSON.stringify({ amount: { min: 7.5, max: 10000 } }))).toEqual({ amount: { min: 7.5, max: 10000 } });
    expect(parseColumnFilters(JSON.stringify({ amount: { min: 'x' } }))).toEqual({});
  });

  it('turns a range into numbered SQL conditions', () => {
    const conditions: string[] = ['t.business_id = $1'];
    const params: any[] = ['biz'];
    addColumnFilterConditions({ amount: { min: 4000, max: 10000 } }, { amount: { expr: 't.amount', kind: 'amount' } }, conditions, params, "'UTC'");
    expect(conditions.slice(1)).toEqual(['(t.amount)::numeric >= $2', '(t.amount)::numeric <= $3']);
    expect(params).toEqual(['biz', 4000, 10000]);
  });

  it('an open end adds only the other condition', () => {
    const conditions: string[] = [];
    const params: any[] = [];
    addColumnFilterConditions({ amount: { max: 0 } }, { amount: { expr: 't.amount', kind: 'amount' } }, conditions, params, "'UTC'");
    expect(conditions).toEqual(['(t.amount)::numeric <= $1']);
    expect(params).toEqual([0]);
  });
});
