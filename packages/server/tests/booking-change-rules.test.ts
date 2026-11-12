import { describe, it, expect } from 'vitest';
import { computeChangeRules, checkChange } from '../src/services/booking-change-rules.service';
import { peakParticipants } from '../src/services/session-capacity';

const NOW = new Date('2026-11-11T12:00:00Z');
const FUTURE = '2026-11-12T10:00:00Z';
const PAST = '2026-11-11T09:00:00Z';

describe('booking change rules (CAL-19, CAL-22)', () => {
  it('future unpaid: everything can change', () => {
    const r = computeChangeRules({ status: 'confirmed', start_time: FUTURE }, false, NOW);
    expect(r).toMatchObject({ read_only: false, can_move: true, can_change_staff: true, can_change_offering: true, can_change_customer: true, reason: null });
  });
  it('completed, cancelled and no-show are view only', () => {
    for (const status of ['completed', 'cancelled', 'no_show']) {
      expect(computeChangeRules({ status, start_time: FUTURE }, false, NOW).read_only).toBe(true);
    }
  });
  it('started and unpaid: corrections allowed, no moving', () => {
    const r = computeChangeRules({ status: 'confirmed', start_time: PAST }, false, NOW);
    expect(r).toMatchObject({ read_only: false, can_move: false, can_change_staff: true, can_change_offering: true, can_change_customer: true, started: true });
    expect(checkChange(r, { staff: true }, NOW)).toBeNull();
    expect(checkChange(r, { start_time: FUTURE }, NOW)).toMatch(/can't be moved/);
  });
  it('checked in counts as started', () => {
    expect(computeChangeRules({ status: 'checked_in', start_time: PAST }, false, NOW).can_move).toBe(false);
  });
  it('paid and started: view only', () => {
    expect(computeChangeRules({ status: 'confirmed', start_time: PAST }, true, NOW).read_only).toBe(true);
  });
  it('paid future: move and staff yes; service, headcount and customer no', () => {
    const r = computeChangeRules({ status: 'confirmed', start_time: FUTURE }, true, NOW);
    expect(checkChange(r, { start_time: '2026-11-13T10:00:00Z', staff: true }, NOW)).toBeNull();
    expect(checkChange(r, { offering: true }, NOW)).toMatch(/paid/);
    expect(checkChange(r, { customer: true }, NOW)).toMatch(/paid/);
  });
  it('nothing moves into the past', () => {
    const r = computeChangeRules({ status: 'confirmed', start_time: FUTURE }, false, NOW);
    expect(checkChange(r, { start_time: PAST }, NOW)).toMatch(/past/);
  });
  it('notes only (no slot field) is always allowed', () => {
    const r = computeChangeRules({ status: 'completed', start_time: PAST }, true, NOW);
    expect(checkChange(r, {}, NOW)).toBeNull();
  });
});

describe('shared room places (CAL-17)', () => {
  const b = (s: string, e: string, n = 1) => ({ start_time: `2026-11-12T${s}:00Z`, end_time: `2026-11-12T${e}:00Z`, participant_count: n });
  const at = (s: string, e: string) => [new Date(`2026-11-12T${s}:00Z`), new Date(`2026-11-12T${e}:00Z`)] as const;
  it('counts bookings that started earlier and still overlap', () => {
    expect(peakParticipants([b('13:00', '14:00', 3), b('13:30', '14:30', 2)], ...at('13:45', '14:45'))).toBe(5);
  });
  it('takes the peak, not the sum of everything in the window', () => {
    // 13:00–13:30 (2 people) and 13:30–14:00 (3 people) never overlap: peak 3
    expect(peakParticipants([b('13:00', '13:30', 2), b('13:30', '14:00', 3)], ...at('13:00', '14:00'))).toBe(3);
  });
  it('ignores bookings outside the window', () => {
    expect(peakParticipants([b('11:00', '12:00', 4)], ...at('12:00', '13:00'))).toBe(0);
  });
});
