import { describe, it, expect } from 'vitest';
import { QUARTER_HOURS, endFrom, durationBetween, endNotAfterStart } from './eventTiming';
import { normaliseTime } from '../design-system/components/forms/QuarterTimeInput';

describe('event timing (Create Event form)', () => {
  it('offers every quarter of an hour', () => {
    expect(QUARTER_HOURS).toHaveLength(96);
    expect(QUARTER_HOURS.slice(0, 3)).toEqual(['00:00', '00:15', '00:30']);
    expect(QUARTER_HOURS[QUARTER_HOURS.length - 1]).toBe('23:45');
  });

  it('works out the end from the start and the duration, across days', () => {
    expect(endFrom('2026-11-04', '09:00', { amount: 1.5, unit: 'hours' })).toEqual({ date: '2026-11-04', time: '10:30' });
    expect(endFrom('2026-11-04', '19:20', { amount: 6, unit: 'hours' })).toEqual({ date: '2026-11-05', time: '01:20' });
    expect(endFrom('2026-11-04', '09:00', { amount: 2, unit: 'days' })).toEqual({ date: '2026-11-06', time: '09:00' });
    // The night the clocks change in Spain makes no difference: wall-clock arithmetic.
    expect(endFrom('2026-10-24', '20:00', { amount: 1, unit: 'days' })).toEqual({ date: '2026-10-25', time: '20:00' });
    expect(endFrom('', '09:00', { amount: 1, unit: 'hours' })).toBeNull();
  });

  it('works out the duration from a changed end', () => {
    expect(durationBetween('2026-11-04', '09:00', '2026-11-04', '11:45', 'hours')).toEqual({ amount: 2.75, unit: 'hours' });
    expect(durationBetween('2026-11-04', '09:00', '2026-11-06', '09:00', 'days')).toEqual({ amount: 2, unit: 'days' });
    expect(durationBetween('2026-11-04', '09:00', '2026-11-05', '12:00', 'days')).toEqual({ amount: 27, unit: 'hours' });
    expect(durationBetween('2026-11-04', '09:00', '2026-11-04', '08:00', 'hours')).toBeNull();
  });

  it('flags an end that is not after the start', () => {
    expect(endNotAfterStart('2026-11-04', '09:00', '2026-11-04', '09:00')).toBe(true);
    expect(endNotAfterStart('2026-11-04', '09:00', '2026-11-04', '09:15')).toBe(false);
    expect(endNotAfterStart('2026-11-04', '09:00', '', '')).toBe(false);
  });
});


describe('typed times', () => {
  it('accepts the usual ways of typing a time', () => {
    expect(normaliseTime('9')).toBe('09:00');
    expect(normaliseTime('930')).toBe('09:30');
    expect(normaliseTime('2020')).toBe('20:20');
    expect(normaliseTime('20.20')).toBe('20:20');
    expect(normaliseTime('9:5')).toBe('09:05');
    expect(normaliseTime('24:00')).toBeNull();
    expect(normaliseTime('ten')).toBeNull();
  });
});
