import { describe, it, expect, vi } from 'vitest';
import fc from 'fast-check';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { ParticipantCountField } from '../src/components/booking/ParticipantCountField';

describe('ParticipantCountField', () => {
  it('renders a labelled number input when maxCapacity > 1', () => {
    render(<ParticipantCountField value={1} onChange={vi.fn()} maxCapacity={5} />);
    const input = screen.getByLabelText('Number of participants') as HTMLInputElement;
    expect(input).toBeInTheDocument();
    expect(input.type).toBe('number');
    expect(input.min).toBe('1');
  });

  it('renders nothing when maxCapacity <= 1', () => {
    const { container } = render(<ParticipantCountField value={1} onChange={vi.fn()} maxCapacity={1} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('caps max at remainingCapacity when provided, falling back to maxCapacity otherwise', () => {
    render(<ParticipantCountField value={1} onChange={vi.fn()} maxCapacity={10} remainingCapacity={3} />);
    const input = screen.getByLabelText('Number of participants') as HTMLInputElement;
    expect(input.max).toBe('3');
  });

  it('uses maxCapacity as max when remainingCapacity is not provided', () => {
    render(<ParticipantCountField value={1} onChange={vi.fn()} maxCapacity={10} />);
    const input = screen.getByLabelText('Number of participants') as HTMLInputElement;
    expect(input.max).toBe('10');
  });

  it('does not clamp to remainingCapacity/maxCapacity when overrideCapacity is true', () => {
    // Found via manual browser testing: without this, the admin-override checkbox (Requirement 6)
    // let staff check the box but the input itself still silently capped them at the normal limit.
    const onChange = vi.fn();
    render(<ParticipantCountField value={1} onChange={onChange} maxCapacity={3} remainingCapacity={1} overrideCapacity />);
    const input = screen.getByLabelText('Number of participants') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '7' } });
    expect(onChange).toHaveBeenCalledWith(7);
  });

  it('still clamps to remainingCapacity when overrideCapacity is false', () => {
    const onChange = vi.fn();
    render(<ParticipantCountField value={1} onChange={onChange} maxCapacity={3} remainingCapacity={1} />);
    const input = screen.getByLabelText('Number of participants') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '7' } });
    expect(onChange).toHaveBeenCalledWith(1);
  });

  describe('Property 1: Participant field visibility matches resource capacity (task 3.1.1)', () => {
    // Feature: 32-smart-booking-flow, Property 1: field visible iff maxCapacity > 1
    it('field is present in the DOM iff maxCapacity > 1', () => {
      fc.assert(
        fc.property(fc.integer({ min: -5, max: 30 }), (maxCapacity) => {
          cleanup();
          const { container } = render(<ParticipantCountField value={1} onChange={vi.fn()} maxCapacity={maxCapacity} />);
          const input = container.querySelector('#participant-count-input');
          if (maxCapacity > 1) {
            expect(input).not.toBeNull();
          } else {
            expect(input).toBeNull();
          }
        }),
        { numRuns: 100 },
      );
    });
  });
});
