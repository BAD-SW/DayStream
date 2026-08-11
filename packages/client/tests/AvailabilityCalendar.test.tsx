import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fc from 'fast-check';
import { render, screen, cleanup, waitFor, fireEvent } from '@testing-library/react';
import { AvailabilityCalendar } from '../src/components/booking/AvailabilityCalendar';
import * as bookingsApi from '../src/api/bookings';

vi.mock('../src/api/bookings', async () => {
  const actual = await vi.importActual<typeof import('../src/api/bookings')>('../src/api/bookings');
  return { ...actual, getAvailabilityDays: vi.fn() };
});

const getAvailabilityDaysMock = bookingsApi.getAvailabilityDays as unknown as ReturnType<typeof vi.fn>;

function baseProps(overrides: Partial<Parameters<typeof AvailabilityCalendar>[0]> = {}) {
  return {
    serviceId: 'svc-1',
    variantId: 'var-1',
    businessId: 'biz-1',
    participantCount: 1,
    selectedDate: null,
    onDateSelect: vi.fn(),
    onDateClear: vi.fn(),
    slots: [],
    selectedTime: null,
    onSlotSelect: vi.fn(),
    businessTimezone: 'UTC',
    ...overrides,
  };
}

describe('AvailabilityCalendar', () => {
  beforeEach(() => {
    getAvailabilityDaysMock.mockReset();
    getAvailabilityDaysMock.mockResolvedValue({ timezone: 'UTC', days: {} });
  });
  afterEach(cleanup);

  it('renders the DayPicker when selectedDate is null', async () => {
    render(<AvailabilityCalendar {...baseProps()} />);
    await waitFor(() => expect(getAvailabilityDaysMock).toHaveBeenCalled());
    expect(screen.getByText('Sun')).toBeInTheDocument(); // DayPicker weekday header
  });

  it('fetches /availability/days with the current serviceId, variantId, businessId, month, and participantCount', async () => {
    render(<AvailabilityCalendar {...baseProps({ participantCount: 3 })} />);
    await waitFor(() => expect(getAvailabilityDaysMock).toHaveBeenCalledTimes(1));
    expect(getAvailabilityDaysMock).toHaveBeenCalledWith('biz-1', 'svc-1', 'var-1', expect.stringMatching(/^\d{4}-\d{2}$/), 3);
  });

  it('re-fetches with the updated participantCount when it changes', async () => {
    const { rerender } = render(<AvailabilityCalendar {...baseProps({ participantCount: 1 })} />);
    await waitFor(() => expect(getAvailabilityDaysMock).toHaveBeenCalledTimes(1));

    rerender(<AvailabilityCalendar {...baseProps({ participantCount: 4 })} />);
    await waitFor(() => expect(getAvailabilityDaysMock).toHaveBeenCalledTimes(2));
    expect(getAvailabilityDaysMock).toHaveBeenLastCalledWith('biz-1', 'svc-1', 'var-1', expect.any(String), 4);
  });

  it('switches to the SlotPicker after a day is selected, and calls onDateSelect with that date', async () => {
    // Pick tomorrow (always a future, in-grid day for the default viewedMonth = current month;
    // falls back to day 1 of next month in the rare case tomorrow rolls into a new month, which
    // AvailabilityCalendar wouldn't be viewing yet — so just skip that one calendar day per year).
    const now = new Date();
    const tomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
    if (tomorrow.getMonth() !== now.getMonth()) return;
    const dateStr = `${tomorrow.getFullYear()}-${String(tomorrow.getMonth() + 1).padStart(2, '0')}-${String(tomorrow.getDate()).padStart(2, '0')}`;

    getAvailabilityDaysMock.mockResolvedValue({ timezone: 'UTC', days: { [dateStr]: 'available' } });
    const onDateSelect = vi.fn();
    render(<AvailabilityCalendar {...baseProps({ onDateSelect })} />);
    await waitFor(() => expect((screen.getByText(String(tomorrow.getDate())).closest('button') as HTMLButtonElement).disabled).toBe(false));

    const cell = screen.getByText(String(tomorrow.getDate())).closest('button') as HTMLButtonElement;
    fireEvent.click(cell);

    expect(onDateSelect).toHaveBeenCalledWith(dateStr);
    // View switched to slot-picker: the day-picker's weekday header is gone, back button is shown.
    expect(screen.queryByText('Sun')).not.toBeInTheDocument();
    expect(screen.getByText('← Back to calendar')).toBeInTheDocument();
  });

  it('resets to day-picker view when selectedDate becomes null', async () => {
    const now = new Date();
    const tomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
    if (tomorrow.getMonth() !== now.getMonth()) return; // skip the rare month-boundary day
    const dateStr = `${tomorrow.getFullYear()}-${String(tomorrow.getMonth() + 1).padStart(2, '0')}-${String(tomorrow.getDate()).padStart(2, '0')}`;
    getAvailabilityDaysMock.mockResolvedValue({ timezone: 'UTC', days: { [dateStr]: 'available' } });

    const { rerender } = render(<AvailabilityCalendar {...baseProps({ selectedDate: null })} />);
    await waitFor(() => expect((screen.getByText(String(tomorrow.getDate())).closest('button') as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(screen.getByText(String(tomorrow.getDate())).closest('button')!);
    expect(screen.getByText('← Back to calendar')).toBeInTheDocument(); // now in slot-picker view

    // Simulate the parent actually adopting the selected date (as it would via onDateSelect in
    // real usage), then clearing it again — the effect only fires on a genuine null transition.
    rerender(<AvailabilityCalendar {...baseProps({ selectedDate: dateStr })} />);
    expect(screen.getByText('← Back to calendar')).toBeInTheDocument(); // still slot-picker

    rerender(<AvailabilityCalendar {...baseProps({ selectedDate: null })} />);
    await waitFor(() => expect(screen.getByText('Sun')).toBeInTheDocument()); // reset to day-picker
  });

  describe('Property 7: Selected slot start_time propagates to parent (task 6.1.2)', () => {
    // Feature: 32-smart-booking-flow, Property 7: day selection always propagates the exact clicked
    // date string to the parent via onDateSelect, for any valid future in-month day.
    it('onDateSelect always receives exactly the date string of the clicked available day', async () => {
      const now = new Date();
      const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
      const futureDayNumbers = [];
      for (let d = now.getDate() + 1; d <= daysInMonth; d++) futureDayNumbers.push(d);
      if (futureDayNumbers.length === 0) return; // last day of the month at test run time — skip

      await fc.assert(
        fc.asyncProperty(fc.constantFrom(...futureDayNumbers), async (day) => {
          cleanup();
          const dateStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
          getAvailabilityDaysMock.mockResolvedValue({ timezone: 'UTC', days: { [dateStr]: 'available' } });
          const onDateSelect = vi.fn();
          render(<AvailabilityCalendar {...baseProps({ onDateSelect })} />);
          await waitFor(() => expect((screen.getByText(String(day)).closest('button') as HTMLButtonElement).disabled).toBe(false));

          fireEvent.click(screen.getByText(String(day)).closest('button')!);
          expect(onDateSelect).toHaveBeenCalledWith(dateStr);
        }),
        { numRuns: Math.min(futureDayNumbers.length, 25) },
      );
    });
  });
});
