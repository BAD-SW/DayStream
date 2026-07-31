import { describe, it, expect } from 'vitest';
import { formatBreadcrumb, truncateSegment } from '../src/utils/breadcrumb';
import type { ActiveContext } from '@daystream/shared';

function ctx(overrides: Partial<ActiveContext>): ActiveContext {
  return {
    contextLevel: 'system',
    tenantId: null,
    businessId: null,
    displayName: '',
    ...overrides,
  };
}

describe('formatBreadcrumb', () => {
  it('renders just the platform name at system level', () => {
    expect(formatBreadcrumb(ctx({ contextLevel: 'system' }), 'system')).toEqual(['DayStream']);
  });

  it('renders platform + tenant name at tenant level', () => {
    const context = ctx({ contextLevel: 'tenant', tenantId: 't1', displayName: 'Transcend Health' });
    expect(formatBreadcrumb(context, 'system')).toEqual(['DayStream', 'Transcend Health']);
    expect(formatBreadcrumb(context, 'tenant')).toEqual(['DayStream', 'Transcend Health']);
  });

  it('renders platform + tenant + business name at business level for system/tenant persona', () => {
    const context = ctx({
      contextLevel: 'business',
      tenantId: 't1',
      businessId: 'b1',
      displayName: 'Transcend Mallorca',
      tenantDisplayName: 'Transcend Health',
    });
    expect(formatBreadcrumb(context, 'system')).toEqual(['DayStream', 'Transcend Health', 'Transcend Mallorca']);
    expect(formatBreadcrumb(context, 'tenant')).toEqual(['DayStream', 'Transcend Health', 'Transcend Mallorca']);
  });

  it('renders only the business name, no ancestors, for business persona', () => {
    const context = ctx({
      contextLevel: 'business',
      tenantId: 't1',
      businessId: 'b1',
      displayName: 'Transcend Mallorca',
      tenantDisplayName: 'Transcend Health',
    });
    expect(formatBreadcrumb(context, 'business')).toEqual(['Transcend Mallorca']);
  });

  it('renders only the business name for customer persona', () => {
    const context = ctx({ contextLevel: 'business', displayName: 'Transcend Mallorca' });
    expect(formatBreadcrumb(context, 'customer')).toEqual(['Transcend Mallorca']);
  });
});

describe('truncateSegment', () => {
  it('leaves short labels untouched', () => {
    expect(truncateSegment('Short Name')).toEqual({ label: 'Short Name', truncated: false });
  });

  it('truncates labels longer than 24 characters with an ellipsis', () => {
    const long = 'A Very Long Organization Name Indeed';
    const result = truncateSegment(long);
    expect(result.truncated).toBe(true);
    expect(result.label.endsWith('…')).toBe(true);
    expect(result.label.length).toBe(25); // 24 chars + ellipsis
  });

  it('does not truncate a label exactly 24 characters long', () => {
    const exact = 'A'.repeat(24);
    expect(truncateSegment(exact)).toEqual({ label: exact, truncated: false });
  });
});
