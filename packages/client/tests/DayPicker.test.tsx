import { describe, it, expect, vi, afterEach } from 'vitest';
import fc from 'fast-check';
import { render, screen, cleanup } from '@testing-library/react';
import { DayPicker, isPastDay, statusCssVar, currentMonthStr, type DayStatus } from '../src/components/booking/DayPicker';

afterEach(cleanup);

describe('DayPicker', () => {
  it('renders a 7-column weekday header and one cell per day of the month', () => {
    render(
      <DayPicker
        dayStatuses={{}}
        viewedMonth="2026-09"
        onMonthChange={vi.fn()}
        onDaySelect={vi.fn()}
      />,
    );
    for (const day of ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']) {
      expect(screen.getByText(day)).toBeInTheDocument();
    }
    // September 2026 has 30 days
    expect(screen.getByText('30')).toBeInTheDocument();
    expect(screen.queryByText('31')).not.toBeInTheDocument();
  });

  it('shows an inline error with a retry button instead of the grid when error is set', () => {
    const onRetry = vi.fn();
    render(
      <DayPicker
        dayStatuses={{}}
        viewedMonth="2026-09"
        onMonthChange={vi.fn()}
        onDaySelect={vi.fn()}
        error="Failed to load calendar availability"
        onRetry={onRetry}
      />,
    );
    expect(screen.getByText('Failed to load calendar availability')).toBeInTheDocument();
    const retryBtn = screen.getByRole('button', { name: 'Retry' });
    retryBtn.click();
    expect(onRetry).toHaveBeenCalledOnce();
    expect(screen.queryByText('Sun')).not.toBeInTheDocument();
  });

  it('shows a loading indicator and disables day interaction while loading', () => {
    render(
      <DayPicker
        dayStatuses={{ '2026-09-15': 'available' }}
        viewedMonth="2026-09"
        onMonthChange={vi.fn()}
        onDaySelect={vi.fn()}
        loading
      />,
    );
    expect(screen.getByRole('status', { name: 'Loading availability' })).toBeInTheDocument();
    const cell = screen.getByText('15').closest('button')!;
    expect(cell).toBeDisabled();
  });

  it('calls onDaySelect only when an available day is clicked, not an unavailable/closed one', () => {
    const onDaySelect = vi.fn();
    render(
      <DayPicker
        dayStatuses={{ '2026-09-15': 'available', '2026-09-16': 'unavailable', '2026-09-17': 'closed' }}
        viewedMonth="2026-09"
        onMonthChange={vi.fn()}
        onDaySelect={onDaySelect}
      />,
    );
    screen.getByText('15').closest('button')!.click();
    screen.getByText('16').closest('button')!.click();
    screen.getByText('17').closest('button')!.click();
    expect(onDaySelect).toHaveBeenCalledOnce();
    expect(onDaySelect).toHaveBeenCalledWith('2026-09-15');
  });

  it('disables the previous-month nav button when viewedMonth is the current month', () => {
    render(
      <DayPicker
        dayStatuses={{}}
        viewedMonth={currentMonthStr()}
        onMonthChange={vi.fn()}
        onDaySelect={vi.fn()}
      />,
    );
    expect(screen.getByRole('button', { name: 'Previous month' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Next month' })).not.toBeDisabled();
  });

  describe('Property 5: Past days are always non-interactive (task 4.1.2)', () => {
    // Feature: 32-smart-booking-flow, Property 5: any date before today renders disabled regardless of status
    it('isPastDay correctly classifies dates relative to a fixed "today"', () => {
      fc.assert(
        fc.property(
          fc.integer({ min: 2020, max: 2035 }), fc.integer({ min: 1, max: 12 }), fc.integer({ min: 1, max: 28 }),
          fc.integer({ min: 2020, max: 2035 }), fc.integer({ min: 1, max: 12 }), fc.integer({ min: 1, max: 28 }),
          (y1, m1, d1, y2, m2, d2) => {
            const date = `${y1}-${String(m1).padStart(2, '0')}-${String(d1).padStart(2, '0')}`;
            const today = `${y2}-${String(m2).padStart(2, '0')}-${String(d2).padStart(2, '0')}`;
            expect(isPastDay(date, today)).toBe(date < today);
          },
        ),
        { numRuns: 100 },
      );
    });

    it('a past day cell is always rendered disabled, regardless of its availability status', () => {
      fc.assert(
        fc.property(
          fc.constantFrom<DayStatus>('available', 'unavailable', 'closed'),
          (status) => {
            cleanup();
            // Fixed viewedMonth in the past relative to "today" (system clock), so every day in it is past.
            render(
              <DayPicker
                dayStatuses={{ '2020-01-15': status }}
                viewedMonth="2020-01"
                onMonthChange={vi.fn()}
                onDaySelect={vi.fn()}
              />,
            );
            const cell = screen.getByText('15').closest('button')!;
            expect(cell).toBeDisabled();
          },
        ),
        { numRuns: 100 },
      );
    });
  });

  describe('Property 6: Day status maps to correct CSS variable (task 4.1.1)', () => {
    // Feature: 32-smart-booking-flow, Property 6: rendered cell background matches statusCssVar(status)
    it('statusCssVar returns the correct token for every DayStatus', () => {
      expect(statusCssVar('available')).toBe('var(--color-success)');
      expect(statusCssVar('unavailable')).toBe('var(--color-border)');
      expect(statusCssVar('closed')).toBe('var(--color-error)');
      expect(statusCssVar(undefined)).toBe('var(--color-border)');
    });

    it('every rendered future day cell carries the CSS variable matching its status', () => {
      fc.assert(
        fc.property(
          fc.constantFrom<DayStatus>('available', 'unavailable', 'closed'),
          (status) => {
            cleanup();
            // Fixed viewedMonth far in the future so no cell is disabled by the past-day rule.
            render(
              <DayPicker
                dayStatuses={{ '2099-06-15': status }}
                viewedMonth="2099-06"
                onMonthChange={vi.fn()}
                onDaySelect={vi.fn()}
              />,
            );
            const cell = screen.getByText('15').closest('button')! as HTMLButtonElement;
            expect(cell.style.backgroundColor).toBe(statusCssVar(status));
          },
        ),
        { numRuns: 100 },
      );
    });
  });
});
