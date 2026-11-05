import { describe, it, expect } from 'vitest';
import { getBookings } from '../src/services/booking.service';
import { getCustomers } from '../src/services/customer.service';

/**
 * The bookings list filtered by date_from / date_to (E2E BKG-02, run 20261104-1: date_to failed
 * with "cannot cast type integer to date" after a placeholder lost its "$"). Newest first works too.
 */
const BIZ = '00000000-0000-0000-0000-000000000002';

describe('Bookings list by dates', () => {
  it('filters by a from / to day without failing', async () => {
    const r = await getBookings({ businessId: BIZ, dateFrom: '2026-11-09', dateTo: '2026-11-09', page: 1, limit: 100 });
    expect(Array.isArray(r.bookings)).toBe(true);
    for (const b of r.bookings) expect(new Date(b.start_time).getTime()).toBeLessThan(new Date('2026-11-11T00:00:00Z').getTime());
  });

  it('lists newest first when asked', async () => {
    const r = await getBookings({ businessId: BIZ, page: 1, limit: 20, order: 'desc' });
    const times = r.bookings.map((b: any) => new Date(b.start_time).getTime());
    expect(times).toEqual([...times].sort((a, b) => b - a));
  });
});

describe('People list by "added" dates', () => {
  it('filters by created_to without failing (same lost "$" as the bookings list)', async () => {
    const r: any = await getCustomers(BIZ, { created_from: '2020-01-01', created_to: '2030-12-31', page: 1, limit: 5 } as any);
    expect(r).toBeTruthy();
  });
});
