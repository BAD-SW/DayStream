import { describe, it, expect, vi, afterEach } from 'vitest';
import fc from 'fast-check';
import { render, screen, cleanup } from '@testing-library/react';
import { SlotPicker, isSlotClickable } from '../src/components/booking/SlotPicker';

afterEach(cleanup);

describe('SlotPicker', () => {
  it('calls onBack when the back button is clicked', () => {
    const onBack = vi.fn();
    render(
      <SlotPicker slots={[]} participantCount={1} selectedTime={null} onSlotSelect={vi.fn()} onBack={onBack} businessTimezone="UTC" />,
    );
    screen.getByText('← Back to calendar').click();
    expect(onBack).toHaveBeenCalledOnce();
  });

  it('shows "No availability for this day" when slots is empty and not loading', () => {
    render(
      <SlotPicker slots={[]} participantCount={1} selectedTime={null} onSlotSelect={vi.fn()} onBack={vi.fn()} businessTimezone="UTC" />,
    );
    expect(screen.getByText('No availability for this day')).toBeInTheDocument();
  });

  it('shows a loading indicator instead of the grid or empty message while loading', () => {
    render(
      <SlotPicker slots={[]} participantCount={1} selectedTime={null} onSlotSelect={vi.fn()} onBack={vi.fn()} businessTimezone="UTC" loading />,
    );
    expect(screen.getByRole('status', { name: 'Loading time slots' })).toBeInTheDocument();
    expect(screen.queryByText('No availability for this day')).not.toBeInTheDocument();
  });

  it('renders slot times formatted in the given businessTimezone', () => {
    render(
      <SlotPicker
        slots={[{ start_time: '2026-09-15T14:00:00.000Z' }]}
        participantCount={1}
        selectedTime={null}
        onSlotSelect={vi.fn()}
        onBack={vi.fn()}
        businessTimezone="UTC"
      />,
    );
    expect(screen.getByText('02:00 PM')).toBeInTheDocument();
  });

  it('calls onSlotSelect with start_time when an available slot is clicked', () => {
    const onSlotSelect = vi.fn();
    render(
      <SlotPicker
        slots={[{ start_time: '2026-09-15T14:00:00.000Z', capacity_remaining: 3 }]}
        participantCount={1}
        selectedTime={null}
        onSlotSelect={onSlotSelect}
        onBack={vi.fn()}
        businessTimezone="UTC"
      />,
    );
    screen.getByRole('button', { name: '02:00 PM' }).click();
    expect(onSlotSelect).toHaveBeenCalledWith('2026-09-15T14:00:00.000Z');
  });

  it('does not call onSlotSelect when an over-capacity slot is clicked', () => {
    const onSlotSelect = vi.fn();
    render(
      <SlotPicker
        slots={[{ start_time: '2026-09-15T14:00:00.000Z', capacity_remaining: 1 }]}
        participantCount={3}
        selectedTime={null}
        onSlotSelect={onSlotSelect}
        onBack={vi.fn()}
        businessTimezone="UTC"
      />,
    );
    screen.getByRole('button', { name: '02:00 PM' }).click();
    expect(onSlotSelect).not.toHaveBeenCalled();
  });

  it('an over-capacity slot stays clickable when overrideCapacity is true, and still calls onSlotSelect', () => {
    // Found via manual browser testing: the admin-override path (Requirement 6) is useless if the
    // very slot it's meant to override can never be selected in the first place.
    const onSlotSelect = vi.fn();
    render(
      <SlotPicker
        slots={[{ start_time: '2026-09-15T14:00:00.000Z', capacity_remaining: 1 }]}
        participantCount={3}
        selectedTime={null}
        onSlotSelect={onSlotSelect}
        onBack={vi.fn()}
        businessTimezone="UTC"
        overrideCapacity
      />,
    );
    const btn = screen.getByRole('button', { name: '02:00 PM' }) as HTMLButtonElement;
    expect(btn.disabled).toBe(false);
    // Distinct "overriding" style, not the same look as a genuinely blocked over-capacity slot —
    // reusing that style would visually tell the admin the slot can't be clicked when it can.
    expect(btn).toHaveClass('slot-picker__slot--overriding');
    expect(btn).not.toHaveClass('slot-picker__slot--over-capacity');
    btn.click();
    expect(onSlotSelect).toHaveBeenCalledWith('2026-09-15T14:00:00.000Z');
  });

  it('applies the selected style class to the slot matching selectedTime', () => {
    render(
      <SlotPicker
        slots={[{ start_time: '2026-09-15T14:00:00.000Z', capacity_remaining: 3 }]}
        participantCount={1}
        selectedTime="2026-09-15T14:00:00.000Z"
        onSlotSelect={vi.fn()}
        onBack={vi.fn()}
        businessTimezone="UTC"
      />,
    );
    expect(screen.getByRole('button', { name: '02:00 PM' })).toHaveClass('slot-picker__slot--selected');
  });

  describe('Property 8: Slot capacity state correctly gates interactivity (task 5.1.1)', () => {
    // Feature: 32-smart-booking-flow, Property 8: slot clickable iff capacity_remaining >= participantCount
    it('isSlotClickable matches capacity_remaining >= participantCount for any pair, treating undefined as unconstrained', () => {
      fc.assert(
        fc.property(
          fc.option(fc.integer({ min: 0, max: 50 }), { nil: undefined }),
          fc.integer({ min: 1, max: 50 }),
          (capacityRemaining, participantCount) => {
            const expected = (capacityRemaining ?? Infinity) >= participantCount;
            expect(isSlotClickable(capacityRemaining, participantCount)).toBe(expected);
          },
        ),
        { numRuns: 100 },
      );
    });

    it('the rendered slot is disabled iff isSlotClickable is false, for any (capacity_remaining, participantCount)', () => {
      fc.assert(
        fc.property(
          fc.option(fc.integer({ min: 0, max: 10 }), { nil: undefined }),
          fc.integer({ min: 1, max: 10 }),
          (capacityRemaining, participantCount) => {
            cleanup();
            render(
              <SlotPicker
                slots={[{ start_time: '2026-09-15T14:00:00.000Z', capacity_remaining: capacityRemaining }]}
                participantCount={participantCount}
                selectedTime={null}
                onSlotSelect={vi.fn()}
                onBack={vi.fn()}
                businessTimezone="UTC"
              />,
            );
            const btn = screen.getByRole('button', { name: '02:00 PM' }) as HTMLButtonElement;
            expect(btn.disabled).toBe(!isSlotClickable(capacityRemaining, participantCount));
          },
        ),
        { numRuns: 100 },
      );
    });
  });
});
