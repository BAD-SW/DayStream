import { describe, it, expect } from 'vitest';
import { underMaintenance, type MaintenanceWindow } from '../src/services/required-resources.service';

// D-81: a recurring window with no weekday is a daily window and blocks every day.
const window = (day_of_week: number | null): MaintenanceWindow => ({
  resource_id: 'r1', maintenance_type: 'recurring', day_of_week, specific_date: null,
  start_time: '06:00', end_time: '07:00', start_minutes: 360, end_minutes: 420,
} as MaintenanceWindow);

describe('underMaintenance', () => {
  const wed = [new Date('2026-11-04T06:30:00Z'), new Date('2026-11-04T06:45:00Z')] as const; // a Wednesday

  it('a daily window (no weekday) blocks a slot on any day', () => {
    expect(underMaintenance([window(null)], 'r1', wed[0], wed[1], 'UTC')).toBe(true);
  });

  it('a weekly window blocks only its weekday', () => {
    expect(underMaintenance([window(3)], 'r1', wed[0], wed[1], 'UTC')).toBe(true);
    expect(underMaintenance([window(1)], 'r1', wed[0], wed[1], 'UTC')).toBe(false);
  });

  it('a slot outside the window hours is free', () => {
    expect(underMaintenance([window(null)], 'r1', new Date('2026-11-04T08:00:00Z'), new Date('2026-11-04T09:00:00Z'), 'UTC')).toBe(false);
  });
});
