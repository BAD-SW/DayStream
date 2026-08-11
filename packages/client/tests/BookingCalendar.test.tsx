import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { render, screen } from '@testing-library/react';
import {
  buildServiceColorMap, QuickFilterBar, getFillState, ParticipantCountBadge,
  deriveServiceColumns, getVisibleServiceColumns, isServiceVisible, toggleServiceFilter, DayView, WeekView,
  CapacityStrip, filterSegmentsToDay, buildCapacityLanes,
  buildServiceSubcolumns, capacityForSubcolumn, layoutCapacityChannel,
  filterBlocksToDay, ResourceBlockOverlay,
  mergeBookingRanges, WeekModeToggle,
} from '../src/pages/BookingCalendar';

const SERVICE_COLOR_VARS = [
  '--cal-service-color-1', '--cal-service-color-2', '--cal-service-color-3', '--cal-service-color-4',
  '--cal-service-color-5', '--cal-service-color-6', '--cal-service-color-7', '--cal-service-color-8',
];

// Real service names come from a trimmed text input — constrain the arbitrary to exclude
// pathological whitespace (which the DOM's own text-node normalization would otherwise
// silently collapse, breaking exact-text assertions for reasons unrelated to the component).
const serviceArb = fc.record({
  id: fc.uuid(),
  name: fc.string({ minLength: 1, maxLength: 30 }).filter((s) => s === s.trim() && s.length > 0 && !/\s{2,}/.test(s) && !/[\n\r\t]/.test(s)),
});

const servicesArb = fc.uniqueArray(serviceArb, { minLength: 1, maxLength: 20, selector: (s) => s.id });

describe('buildServiceColorMap', () => {
  it('Feature: 34-capacity-aware-calendar, Property 1: Service colour assignment is deterministic and complete', () => {
    fc.assert(
      fc.property(servicesArb, (services) => {
        const map = buildServiceColorMap(services);
        expect(map.size).toBe(services.length);

        const sorted = [...services].sort((a, b) => a.name.localeCompare(b.name));
        sorted.forEach((svc, i) => {
          expect(map.get(svc.id)).toBe(SERVICE_COLOR_VARS[i % 8]);
        });

        // No two services within the same 0-7 palette cycle share a colour variable
        const seenInCycle = new Map<number, Set<string>>();
        sorted.forEach((svc, i) => {
          const cycle = Math.floor(i / 8);
          const set = seenInCycle.get(cycle) || new Set<string>();
          const varName = map.get(svc.id)!;
          expect(set.has(varName)).toBe(false);
          set.add(varName);
          seenInCycle.set(cycle, set);
        });
      }),
      { numRuns: 100 },
    );
  });

  it('cycles through the palette via modulo for more than 8 services', () => {
    const services = Array.from({ length: 9 }, (_, i) => ({ id: `id-${i}`, name: `Svc ${String(i).padStart(2, '0')}` }));
    const map = buildServiceColorMap(services);
    expect(map.get('id-0')).toBe(map.get('id-8'));
  });
});

describe('QuickFilterBar', () => {
  // Replaces the old separate service legend + checkbox/dropdown filters — one control now
  // serves as both the legend (every service always shown as a chip) and the filter.
  it('Feature: 34-capacity-aware-calendar, Property 2: Quick filter bar contains every service', () => {
    fc.assert(
      fc.property(servicesArb, (services) => {
        const colorMap = buildServiceColorMap(services);
        const { unmount } = render(<QuickFilterBar services={services} selected="all" onChange={() => {}} colorMap={colorMap} />);
        for (const svc of services) {
          expect(screen.getAllByText(svc.name).length).toBeGreaterThan(0);
        }
        unmount();
      }),
      { numRuns: 100 },
    );
  });

  it('renders nothing for an empty service list', () => {
    const { container } = render(<QuickFilterBar services={[]} selected="all" onChange={() => {}} colorMap={new Map()} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('clicking a service chip toggles it via onChange', () => {
    const services = [{ id: 'a', name: 'Alpha' }, { id: 'b', name: 'Beta' }];
    const colorMap = buildServiceColorMap(services);
    let selected: 'all' | Set<string> = 'all';
    const { getByText, rerender } = render(
      <QuickFilterBar services={services} selected={selected} onChange={(next) => { selected = next; }} colorMap={colorMap} />,
    );
    getByText('Alpha').click();
    expect(selected).toEqual(new Set(['b']));
    rerender(<QuickFilterBar services={services} selected={selected} onChange={(next) => { selected = next; }} colorMap={colorMap} />);
    getByText('All Services').click();
    expect(selected).toBe('all');
  });
});

describe('isServiceVisible / toggleServiceFilter', () => {
  it('Feature: 33-calendar-redesign: toggling a service off then back on returns to \'all\'', () => {
    fc.assert(
      fc.property(servicesArb, fc.integer({ min: 0 }), (services, idx) => {
        const svc = services[idx % services.length];
        const afterToggleOff = toggleServiceFilter('all', services, svc.id);
        expect(isServiceVisible(afterToggleOff, svc.id)).toBe(false);
        for (const other of services) {
          if (other.id !== svc.id) expect(isServiceVisible(afterToggleOff, other.id)).toBe(true);
        }
        const afterToggleOn = toggleServiceFilter(afterToggleOff, services, svc.id);
        expect(afterToggleOn).toBe('all');
      }),
      { numRuns: 100 },
    );
  });
});

describe('getFillState', () => {
  // Feature: 34-capacity-aware-calendar, Property 4: Fill state classification is complete and
  // mutually exclusive — extended (task 12.2.1) to cover count > capacity → 'over-capacity',
  // the admin-override signal added by feature 32's Requirement 6.
  it('Feature: 34-capacity-aware-calendar, Property 4: Fill state classification is complete and mutually exclusive', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 50 }).chain((capacity) =>
          fc.record({ capacity: fc.constant(capacity), count: fc.integer({ min: 0, max: capacity + 10 }) }),
        ),
        ({ count, capacity }) => {
          const state = getFillState(count, capacity);
          expect(['available', 'almost-full', 'full', 'over-capacity']).toContain(state);
          if (count > capacity) expect(state).toBe('over-capacity');
          else if (count === capacity) expect(state).toBe('full');
          else if (count === capacity - 1) expect(state).toBe('almost-full');
          else expect(state).toBe('available');
        },
      ),
      { numRuns: 100 },
    );
  });

  it('count one over capacity is over-capacity, not full', () => {
    expect(getFillState(4, 3)).toBe('over-capacity');
  });
});

describe('deriveServiceColumns', () => {
  it('Feature: 34-capacity-aware-calendar, Property 5: Day view column count equals distinct services with bookings', () => {
    fc.assert(
      fc.property(
        fc.array(fc.record({ service_id: fc.uuid(), service_name: fc.string({ minLength: 1, maxLength: 20 }) }), { minLength: 0, maxLength: 30 }),
        (bookings) => {
          const distinctIds = new Set(bookings.map((b) => b.service_id));
          const columns = deriveServiceColumns(bookings);
          expect(columns.length).toBe(distinctIds.size);
        },
      ),
      { numRuns: 100 },
    );
  });
});

describe('getVisibleServiceColumns', () => {
  it('Feature: 34-capacity-aware-calendar, Property 7: Service column toggle produces correct visible column set', () => {
    fc.assert(
      fc.property(
        servicesArb.chain((services) => fc.tuple(fc.constant(services), fc.subarray(services.map((s) => s.id)))),
        ([services, selectedIds]) => {
          const selected = new Set(selectedIds);
          const visible = getVisibleServiceColumns(services, selected);
          const expected = services.filter((s) => selected.has(s.id));
          expect(visible).toEqual(expected);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('"all" selection makes every service visible', () => {
    const services = [{ id: 'a', name: 'Alpha' }, { id: 'b', name: 'Beta' }];
    expect(getVisibleServiceColumns(services, 'all')).toEqual(services);
  });
});

describe('DayView', () => {
  const dayServiceArb = fc.record({ id: fc.uuid(), name: fc.string({ minLength: 1, maxLength: 15 }).filter((s) => s === s.trim() && s.length > 0) });
  const dayServicesArb = fc.uniqueArray(dayServiceArb, { minLength: 1, maxLength: 4, selector: (s) => s.id });

  const dayBookingsArb = dayServicesArb.chain((services) =>
    fc.array(
      fc.record({
        id: fc.uuid(),
        service: fc.constantFrom(...services),
        hour: fc.integer({ min: 7, max: 19 }),
      }).map(({ id, service, hour }) => {
        const start = new Date(Date.UTC(2026, 0, 15, hour, 0, 0));
        const end = new Date(start.getTime() + 60 * 60000);
        return {
          id,
          service_id: service.id,
          service_name: service.name,
          customer_name: 'Test Customer',
          staff_name: '',
          status: 'confirmed',
          booking_type: 'individual',
          booking_reference: 'BK-TEST',
          resource_id: null,
          resource_capacity: null,
          participant_count: 1,
          start_time: start.toISOString(),
          end_time: end.toISOString(),
        };
      }),
      { minLength: 0, maxLength: 10 },
    ),
  );

  it('Feature: 34-capacity-aware-calendar, Property 3: Booking block background uses service colour, not status colour', () => {
    fc.assert(
      fc.property(dayBookingsArb, (bookings) => {
        const colorMap = buildServiceColorMap(deriveServiceColumns(bookings));
        const { container, unmount } = render(
          <DayView bookings={bookings} resourceTimelines={{}} date="2026-01-15" timezone="UTC" onBookingClick={() => {}} serviceColorMap={colorMap} />,
        );

        // Exclude the column wrapper divs — they also carry data-service-id, but only booking
        // blocks apply a `background` style.
        const blocks = container.querySelectorAll('[data-service-id]:not([data-testid="service-column"])');
        blocks.forEach((block) => {
          const serviceId = block.getAttribute('data-service-id')!;
          const expectedVar = colorMap.get(serviceId)!;
          const bg = (block as HTMLElement).style.background;
          expect(bg).toBe(`var(${expectedVar})`);
          // Never one of the old hardcoded STATUS_COLORS hex values
          expect(bg).not.toMatch(/#[0-9A-Fa-f]{6}/);
        });

        unmount();
      }),
      { numRuns: 100 },
    );
  });

  it('Feature: 34-capacity-aware-calendar, Property 6: Booking blocks are placed only in their matching service column', () => {
    fc.assert(
      fc.property(dayBookingsArb, (bookings) => {
        const colorMap = buildServiceColorMap(deriveServiceColumns(bookings));
        const { container, unmount } = render(
          <DayView bookings={bookings} resourceTimelines={{}} date="2026-01-15" timezone="UTC" onBookingClick={() => {}} serviceColorMap={colorMap} />,
        );

        const columns = container.querySelectorAll('[data-testid="service-column"]');
        columns.forEach((col) => {
          const colServiceId = col.getAttribute('data-service-id');
          const blocks = col.querySelectorAll('[data-service-id]');
          blocks.forEach((block) => {
            expect(block.getAttribute('data-service-id')).toBe(colServiceId);
          });
        });

        unmount();
      }),
      { numRuns: 100 },
    );
  });

  it('item 3c-b: a booking block\'s left border reflects its payment status, independent of its service colour fill', () => {
    const services = [{ id: 'svc-1', name: 'Massage' }];
    const bookingBase = {
      service_id: 'svc-1', service_name: 'Massage', customer_name: 'Test Customer', staff_name: '',
      status: 'confirmed', booking_type: 'individual', booking_reference: 'BK-TEST',
      resource_id: null, resource_capacity: null, participant_count: 1,
      start_time: '2026-01-15T10:00:00.000Z', end_time: '2026-01-15T11:00:00.000Z',
    };
    const bookings = [
      { ...bookingBase, id: 'paid', payment_status: 'paid' },
      { ...bookingBase, id: 'partial', payment_status: 'partial', start_time: '2026-01-15T12:00:00.000Z', end_time: '2026-01-15T13:00:00.000Z' },
      { ...bookingBase, id: 'unpaid', payment_status: 'unpaid', start_time: '2026-01-15T14:00:00.000Z', end_time: '2026-01-15T15:00:00.000Z' },
      { ...bookingBase, id: 'no-status', start_time: '2026-01-15T16:00:00.000Z', end_time: '2026-01-15T17:00:00.000Z' },
    ];
    const colorMap = buildServiceColorMap(services);
    const { container } = render(
      <DayView bookings={bookings} date="2026-01-15" timezone="UTC" onBookingClick={() => {}} serviceColorMap={colorMap} />,
    );
    const blocks = [...container.querySelectorAll('[data-service-id="svc-1"]:not([data-testid="service-column"])')] as HTMLElement[];
    // All four blocks share the same service colour fill regardless of payment status.
    blocks.forEach((b) => expect(b.style.background).toBe(`var(${colorMap.get('svc-1')})`));
    expect(blocks.find((b) => b.title.includes('Paid'))!.style.borderLeftColor).toBe('var(--color-success)');
    expect(blocks.find((b) => b.title.includes('Partially paid'))!.style.borderLeftColor).toBe('var(--color-warning)');
    expect(blocks.filter((b) => b.title.includes('Unpaid')).length).toBe(2); // explicit 'unpaid' + the one with no status at all
    blocks.filter((b) => b.title.includes('Unpaid')).forEach((b) => expect(b.style.borderLeftColor).toBe('var(--color-error)'));
  });
});

describe('WeekView', () => {
  const weekServiceArb = fc.record({ id: fc.uuid(), name: fc.string({ minLength: 1, maxLength: 15 }).filter((s) => s === s.trim() && s.length > 0) });
  const weekServicesArb = fc.uniqueArray(weekServiceArb, { minLength: 1, maxLength: 4, selector: (s) => s.id });

  function bookingsForServices(services: Array<{ id: string; name: string }>) {
    return fc.array(
      fc.record({
        id: fc.uuid(),
        service: fc.constantFrom(...services),
        dayOffset: fc.integer({ min: 0, max: 6 }),
        hour: fc.integer({ min: 7, max: 19 }),
      }).map(({ id, service, dayOffset, hour }) => {
        // Week of 2026-01-11 (Sun) – 2026-01-17 (Sat)
        const start = new Date(Date.UTC(2026, 0, 11 + dayOffset, hour, 0, 0));
        const end = new Date(start.getTime() + 60 * 60000);
        return {
          id, service_id: service.id, service_name: service.name,
          customer_name: 'Test Customer', staff_name: '', status: 'confirmed',
          booking_type: 'individual', booking_reference: 'BK-TEST',
          resource_id: null, resource_capacity: null, participant_count: 1,
          start_time: start.toISOString(), end_time: end.toISOString(),
        };
      }),
      { minLength: 0, maxLength: 15 },
    );
  }

  const weekScenarioArb = weekServicesArb.chain((services) =>
    fc.tuple(
      bookingsForServices(services),
      fc.oneof(
        fc.constant('all' as const),
        fc.subarray(services.map((s) => s.id)).map((ids) => new Set(ids)),
      ),
    ).map(([bookings, selectedServices]) => ({ services, bookings, selectedServices })),
  );

  function renderWeek(services: any[], bookings: any[], selectedServices: 'all' | Set<string>) {
    const colorMap = buildServiceColorMap(services);
    return render(
      <WeekView
        bookings={bookings}
        resourceTimelines={{}}
        date="2026-01-14"
        timezone="UTC"
        onBookingClick={() => {}}
        serviceColorMap={colorMap}
        selectedServices={selectedServices}
        onSelectedServicesChange={() => {}}
      />,
    );
  }

  it('Feature: 34-capacity-aware-calendar, Property 8: Week view always renders exactly 7 day columns', () => {
    fc.assert(
      fc.property(weekScenarioArb, ({ services, bookings, selectedServices }) => {
        const { container, unmount } = renderWeek(services, bookings, selectedServices);
        const headers = container.querySelectorAll('[data-testid="week-day-header"]');
        expect(headers.length).toBe(7);
        unmount();
      }),
      { numRuns: 100 },
    );
  });

  it('Feature: 34-capacity-aware-calendar, Property 9: Week view service filter limits visible bookings to selected services', () => {
    const nonEmptySubsetScenarioArb = weekServicesArb.chain((services) =>
      fc.tuple(
        bookingsForServices(services),
        fc.subarray(services.map((s) => s.id), { minLength: 1 }),
      ).map(([bookings, ids]) => ({ services, bookings, selected: new Set(ids) })),
    );

    fc.assert(
      fc.property(nonEmptySubsetScenarioArb, ({ services, bookings, selected }) => {
        const { container, unmount } = renderWeek(services, bookings, selected);
        const blocks = container.querySelectorAll('[data-service-id]');
        blocks.forEach((block) => {
          expect(selected.has(block.getAttribute('data-service-id')!)).toBe(true);
        });
        unmount();
      }),
      { numRuns: 100 },
    );
  });

  it('Feature: 34-capacity-aware-calendar, Property 10: Week view "All Services" renders all bookings', () => {
    fc.assert(
      fc.property(
        weekServicesArb.chain((services) => bookingsForServices(services).map((bookings) => ({ services, bookings }))),
        ({ services, bookings }) => {
          const { container, unmount } = renderWeek(services, bookings, 'all');
          const blocks = container.querySelectorAll('[data-service-id]');
          expect(blocks.length).toBe(bookings.length);
          unmount();
        },
      ),
      { numRuns: 100 },
    );
  });

  describe('Summary mode (item 3c-e)', () => {
    it('renders one subcolumn per visible service per day, with no per-booking detail text', () => {
      const services = [{ id: 'svc-a', name: 'Massage' }, { id: 'svc-b', name: 'Facial' }];
      const bookings = [
        { id: 'bk-1', service_id: 'svc-a', service_name: 'Massage', customer_name: 'Alice Example', staff_name: '', status: 'confirmed', booking_type: 'individual', booking_reference: 'BK-1', resource_id: null, resource_capacity: null, participant_count: 1, start_time: '2026-01-14T10:00:00.000Z', end_time: '2026-01-14T11:00:00.000Z' },
        { id: 'bk-2', service_id: 'svc-b', service_name: 'Facial', customer_name: 'Bob Example', staff_name: '', status: 'confirmed', booking_type: 'individual', booking_reference: 'BK-2', resource_id: null, resource_capacity: null, participant_count: 1, start_time: '2026-01-14T12:00:00.000Z', end_time: '2026-01-14T13:00:00.000Z' },
      ];
      const colorMap = buildServiceColorMap(services);
      const { container } = render(
        <WeekView
          bookings={bookings}
          resourceTimelines={{}}
          date="2026-01-14"
          timezone="UTC"
          onBookingClick={() => {}}
          serviceColorMap={colorMap}
          selectedServices="all"
          onSelectedServicesChange={() => {}}
          mode="summary"
        />,
      );
      const summaryDays = container.querySelectorAll('[data-testid="week-day-summary"]');
      expect(summaryDays.length).toBe(7);
      // Every summary day gets a subcolumn for every visible service, booked or not that day.
      summaryDays.forEach((day) => {
        expect(day.querySelectorAll('[data-testid="week-summary-subcolumn"]').length).toBe(2);
      });
      // No customer names or per-booking times leak into summary mode.
      expect(container.textContent).not.toContain('Alice Example');
      expect(container.textContent).not.toContain('Bob Example');
    });

    it('clicking a day in summary mode calls onDayClick with that day\'s date', () => {
      const services = [{ id: 'svc-a', name: 'Massage' }];
      const bookings = [
        { id: 'bk-1', service_id: 'svc-a', service_name: 'Massage', customer_name: 'Alice', staff_name: '', status: 'confirmed', booking_type: 'individual', booking_reference: 'BK-1', resource_id: null, resource_capacity: null, participant_count: 1, start_time: '2026-01-14T10:00:00.000Z', end_time: '2026-01-14T11:00:00.000Z' },
      ];
      const colorMap = buildServiceColorMap(services);
      let clicked: string | null = null;
      const { container } = render(
        <WeekView
          bookings={bookings}
          resourceTimelines={{}}
          date="2026-01-14"
          timezone="UTC"
          onBookingClick={() => {}}
          serviceColorMap={colorMap}
          selectedServices="all"
          onSelectedServicesChange={() => {}}
          mode="summary"
          onDayClick={(d) => { clicked = d; }}
        />,
      );
      const wednesday = container.querySelectorAll('[data-testid="week-day-summary"]')[3] as HTMLElement; // Sun=0 -> Wed=3
      wednesday.click();
      expect(clicked).toBe('2026-01-14');
    });
  });
});

describe('mergeBookingRanges (item 3c-e)', () => {
  it('a single booking produces one range matching its own position', () => {
    const bookings = [{ start_time: '2026-01-15T10:00:00.000Z', end_time: '2026-01-15T11:00:00.000Z' }];
    const ranges = mergeBookingRanges(bookings, 'UTC');
    expect(ranges.length).toBe(1);
  });

  it('overlapping and back-to-back bookings merge into one contiguous range', () => {
    const bookings = [
      { start_time: '2026-01-15T10:00:00.000Z', end_time: '2026-01-15T11:00:00.000Z' },
      { start_time: '2026-01-15T11:00:00.000Z', end_time: '2026-01-15T12:00:00.000Z' }, // back-to-back
      { start_time: '2026-01-15T11:30:00.000Z', end_time: '2026-01-15T12:30:00.000Z' }, // overlaps the second
    ];
    const ranges = mergeBookingRanges(bookings, 'UTC');
    expect(ranges.length).toBe(1);
  });

  it('bookings with a gap between them stay as separate ranges', () => {
    const bookings = [
      { start_time: '2026-01-15T10:00:00.000Z', end_time: '2026-01-15T11:00:00.000Z' },
      { start_time: '2026-01-15T14:00:00.000Z', end_time: '2026-01-15T15:00:00.000Z' },
    ];
    const ranges = mergeBookingRanges(bookings, 'UTC');
    expect(ranges.length).toBe(2);
  });

  it('returns an empty array for no bookings', () => {
    expect(mergeBookingRanges([], 'UTC')).toEqual([]);
  });
});

describe('WeekModeToggle (item 3c-e)', () => {
  it('highlights the active mode and calls onChange with the clicked mode', () => {
    let selected: string | null = null;
    const { getByText, rerender } = render(<WeekModeToggle mode="detail" onChange={(m) => { selected = m; }} />);
    expect(getByText('Detail')).toBeInTheDocument();
    getByText('Summary').click();
    expect(selected).toBe('summary');
    rerender(<WeekModeToggle mode="summary" onChange={(m) => { selected = m; }} />);
    getByText('Detail').click();
    expect(selected).toBe('detail');
  });
});

describe('ParticipantCountBadge', () => {
  // A booking always shows its OWN participant count — never a shared/aggregate resource figure
  // (that ambiguity, found via real-world testing, is exactly what the capacity timeline strip
  // replaces). Only rendered when the resource is actually multi-capacity.
  it('renders this booking\'s own participant count when capacity > 1', () => {
    render(<ParticipantCountBadge count={2} capacity={3} />);
    expect(screen.getByText('2 people')).toBeInTheDocument();
  });

  it('uses singular wording for exactly 1 participant', () => {
    render(<ParticipantCountBadge count={1} capacity={3} />);
    expect(screen.getByText('1 person')).toBeInTheDocument();
  });

  it('renders nothing when capacity is null (no linked resource)', () => {
    const { container } = render(<ParticipantCountBadge count={2} capacity={null} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('renders nothing when count is null', () => {
    const { container } = render(<ParticipantCountBadge count={null} capacity={5} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('renders nothing when capacity is 1 (single-capacity resource — nothing to distinguish)', () => {
    const { container } = render(<ParticipantCountBadge count={1} capacity={1} />);
    expect(container).toBeEmptyDOMElement();
  });
});

describe('filterSegmentsToDay', () => {
  it('keeps only segments whose start falls on the given day', () => {
    const segments = [
      { start_time: '2026-01-15T10:00:00.000Z', end_time: '2026-01-15T11:00:00.000Z', booked: 2, capacity: 3 },
      { start_time: '2026-01-16T10:00:00.000Z', end_time: '2026-01-16T11:00:00.000Z', booked: 1, capacity: 3 },
    ];
    const result = filterSegmentsToDay(segments, '2026-01-15', 'UTC');
    expect(result).toEqual([segments[0]]);
  });

  it('returns an empty array when no segment falls on the given day', () => {
    const segments = [{ start_time: '2026-01-16T10:00:00.000Z', end_time: '2026-01-16T11:00:00.000Z', booked: 1, capacity: 3 }];
    expect(filterSegmentsToDay(segments, '2026-01-15', 'UTC')).toEqual([]);
  });
});

describe('CapacityStrip', () => {
  it('renders nothing for an empty segment list', () => {
    const { container } = render(<CapacityStrip segments={[]} timezone="UTC" />);
    expect(container).toBeEmptyDOMElement();
  });

  it('renders one positioned element per segment, with a title summarizing booked/capacity and the time range', () => {
    const segments = [
      { start_time: '2026-01-15T15:00:00.000Z', end_time: '2026-01-15T15:30:00.000Z', booked: 2, capacity: 3 },
      { start_time: '2026-01-15T15:30:00.000Z', end_time: '2026-01-15T16:00:00.000Z', booked: 4, capacity: 3 },
    ];
    const { container } = render(<CapacityStrip segments={segments} timezone="UTC" />);
    const rendered = container.querySelectorAll('[title]');
    expect(rendered.length).toBe(2);
    expect(rendered[0].getAttribute('title')).toContain('2/3 booked');
    expect(rendered[1].getAttribute('title')).toContain('4/3 booked');
  });

  it('an over-capacity segment fills 100% width with the over-capacity colour, no separate "available" portion', () => {
    const segments = [{ start_time: '2026-01-15T15:00:00.000Z', end_time: '2026-01-15T16:00:00.000Z', booked: 4, capacity: 3 }];
    const { container } = render(<CapacityStrip segments={segments} timezone="UTC" />);
    const fill = container.querySelector('[title]')!.firstElementChild as HTMLElement;
    expect(fill.style.width).toBe('100%');
    expect(fill.style.background).toBe('var(--color-capacity-override)');
    // Only the fill child plus the numeric label — no second "available" sliver when over capacity.
    expect(container.querySelector('[title]')!.children.length).toBe(2);
  });

  it('a partially-booked segment splits proportionally into filled and available portions', () => {
    const segments = [{ start_time: '2026-01-15T15:00:00.000Z', end_time: '2026-01-15T16:00:00.000Z', booked: 1, capacity: 4 }];
    const { container } = render(<CapacityStrip segments={segments} timezone="UTC" />);
    const seg = container.querySelector('[title]')!;
    const [fill, available] = Array.from(seg.children) as HTMLElement[];
    expect(fill.style.width).toBe('25%');
    expect(available.style.width).toBe('75%');
  });

  // The colour-only strip was the reported ambiguity ("you have lost the numbers") — the raw
  // booked/capacity figures must be readable directly on the strip, not just in a hover tooltip.
  it('renders the booked/capacity numbers as visible text on the segment, including when overbooked', () => {
    const segments = [{ start_time: '2026-01-15T15:00:00.000Z', end_time: '2026-01-15T16:00:00.000Z', booked: 4, capacity: 3 }];
    render(<CapacityStrip segments={segments} timezone="UTC" />);
    expect(screen.getByText('4/3')).toBeInTheDocument();
  });

  it('prefixes the tooltip with entityLabel so side-by-side lanes (e.g. two staff members) are distinguishable', () => {
    const segments = [{ start_time: '2026-01-15T15:00:00.000Z', end_time: '2026-01-15T16:00:00.000Z', booked: 1, capacity: 4 }];
    const { container } = render(<CapacityStrip segments={segments} timezone="UTC" entityLabel="Nicole Santos" />);
    expect(container.querySelector('[title]')!.getAttribute('title')).toContain('Nicole Santos: ');
  });
});

describe('buildCapacityLanes', () => {
  it('produces one lane per distinct resource and one per distinct staff member, staff labelled by name', () => {
    const bookings = [
      { resource_id: 'res-1', staff_id: null },
      { resource_id: 'res-1', staff_id: 'staff-1', staff_name: 'Coach One' },
      { resource_id: null, staff_id: 'staff-2', staff_name: 'Coach Two' },
    ];
    const lanes = buildCapacityLanes(bookings);
    expect(lanes).toEqual([
      { id: 'res-1', kind: 'resource' },
      { id: 'staff-1', kind: 'staff', label: 'Coach One' },
      { id: 'staff-2', kind: 'staff', label: 'Coach Two' },
    ]);
  });

  it('returns no lanes when no booking has a resource or staff member', () => {
    expect(buildCapacityLanes([{ resource_id: null, staff_id: null }])).toEqual([]);
  });
});

describe('buildServiceSubcolumns (item 3c-c)', () => {
  it('returns a single "all" subcolumn when no booking has a staff member', () => {
    const bookings = [{ resource_id: 'r1' }, { resource_id: 'r1' }];
    expect(buildServiceSubcolumns(bookings)).toEqual([{ key: 'all', bookings }]);
  });

  it('splits into one subcolumn per staff member, sorted by name, when the service is staff-linked', () => {
    const b1 = { staff_id: 's2', staff_name: 'Zoe' };
    const b2 = { staff_id: 's1', staff_name: 'Amir' };
    const b3 = { staff_id: 's1', staff_name: 'Amir' };
    const subs = buildServiceSubcolumns([b1, b2, b3]);
    expect(subs).toEqual([
      { key: 's1', label: 'Amir', bookings: [b2, b3] },
      { key: 's2', label: 'Zoe', bookings: [b1] },
    ]);
  });

  it('groups staffless bookings under "Unassigned" when the service is otherwise staff-linked', () => {
    const b1 = { staff_id: 's1', staff_name: 'Amir' };
    const b2 = { staff_id: null };
    const subs = buildServiceSubcolumns([b1, b2]);
    expect(subs.find((s) => s.key === 'unassigned')).toEqual({ key: 'unassigned', label: 'Unassigned', bookings: [b2] });
  });
});

describe('capacityForSubcolumn (item 3c-c)', () => {
  it('uses resource_capacity for the "all" subcolumn', () => {
    const sub = { key: 'all', bookings: [{ resource_capacity: 3, service_max_capacity: 5 }] };
    expect(capacityForSubcolumn(sub)).toBe(3);
  });

  it('uses service_max_capacity for a staff subcolumn', () => {
    const sub = { key: 's1', bookings: [{ resource_capacity: 3, service_max_capacity: 4 }] };
    expect(capacityForSubcolumn(sub)).toBe(4);
  });

  it('returns null for an empty subcolumn', () => {
    expect(capacityForSubcolumn({ key: 'all', bookings: [] })).toBeNull();
  });
});

describe('layoutCapacityChannel (item 3c-c: booking width reflects capacity share)', () => {
  const at = (h: number, m = 0) => `2026-01-15T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00.000Z`;

  it('falls back to equal-share time packing when capacity is null', () => {
    const bookings = [
      { id: 'a', start_time: at(10), end_time: at(11), participant_count: 1 },
      { id: 'b', start_time: at(10, 30), end_time: at(11, 30), participant_count: 1 },
    ];
    const { blocks, availableBlocks } = layoutCapacityChannel(bookings, null, 'UTC');
    expect(availableBlocks).toEqual([]);
    expect(blocks.length).toBe(2);
    expect(blocks[0].width).toBeCloseTo(49, 0); // legacy layout: equal share minus its small gap
  });

  it('a single booking fills its capacity share, with the remainder shown as an available block', () => {
    const bookings = [{ id: 'a', start_time: at(10), end_time: at(11), participant_count: 1 }];
    const { blocks, availableBlocks } = layoutCapacityChannel(bookings, 3, 'UTC');
    expect(blocks.length).toBe(1);
    expect(blocks[0].left).toBe(0);
    expect(blocks[0].width).toBeCloseTo(100 / 3, 5);
    expect(availableBlocks.length).toBe(1);
    expect(availableBlocks[0].left).toBeCloseTo(100 / 3, 5);
    expect(availableBlocks[0].width).toBeCloseTo(200 / 3, 5);
  });

  it('two concurrent bookings that exactly fill capacity leave no available block', () => {
    const bookings = [
      { id: 'a', start_time: at(10), end_time: at(11), participant_count: 2 },
      { id: 'b', start_time: at(10), end_time: at(11), participant_count: 1 },
    ];
    const { blocks, availableBlocks } = layoutCapacityChannel(bookings, 3, 'UTC');
    expect(availableBlocks).toEqual([]);
    expect(blocks.reduce((s, b) => s + b.width, 0)).toBeCloseTo(100, 5);
  });

  it('overbooked concurrent bookings shrink to fit 100% width instead of overflowing, with no available sliver', () => {
    const bookings = [
      { id: 'a', start_time: at(10), end_time: at(11), participant_count: 3 },
      { id: 'b', start_time: at(10), end_time: at(11), participant_count: 1 },
    ];
    const { blocks, availableBlocks } = layoutCapacityChannel(bookings, 3, 'UTC');
    expect(availableBlocks).toEqual([]);
    expect(blocks.reduce((s, b) => s + b.width, 0)).toBeCloseTo(100, 5);
    const a = blocks.find((b) => b.booking.id === 'a')!;
    const b = blocks.find((b) => b.booking.id === 'b')!;
    expect(a.width / b.width).toBeCloseTo(3, 5); // the 3:1 participant ratio survives the shrink
  });

  it('non-overlapping bookings form independent clusters, each using the full capacity-share width', () => {
    const bookings = [
      { id: 'a', start_time: at(10), end_time: at(11), participant_count: 1 },
      { id: 'b', start_time: at(12), end_time: at(13), participant_count: 1 },
    ];
    const { blocks } = layoutCapacityChannel(bookings, 3, 'UTC');
    for (const b of blocks) {
      expect(b.left).toBe(0);
      expect(b.width).toBeCloseTo(100 / 3, 5);
    }
  });

  it('a later booking reclaims an earlier-vacated slot instead of stacking off the edge (regression)', () => {
    // Real reported scenario: A 3:00-4:00 and C 3:30-4:00 both end exactly when D 4:00-5:00
    // starts; B 3:30-5:00 spans across all of it. A naive "stack after the rightmost active
    // booking" placement pushes D off the right edge at near-zero width instead of reusing A's or
    // C's newly-freed column.
    const bookings = [
      { id: 'a', start_time: at(15, 0), end_time: at(16, 0), participant_count: 1 },
      { id: 'b', start_time: at(15, 30), end_time: at(17, 0), participant_count: 1 },
      { id: 'c', start_time: at(15, 30), end_time: at(16, 0), participant_count: 1 },
      { id: 'd', start_time: at(16, 0), end_time: at(17, 0), participant_count: 1 },
    ];
    const { blocks } = layoutCapacityChannel(bookings, 3, 'UTC');
    const d = blocks.find((b) => b.booking.id === 'd')!;
    expect(d.width).toBeCloseTo(100 / 3, 1);
    expect(d.left).toBeLessThan(70);
    // No two blocks active at the same moment may occupy overlapping horizontal space.
    for (const x of blocks) {
      for (const y of blocks) {
        if (x === y) continue;
        const timeOverlap = x.top < y.top + y.height && y.top < x.top + x.height;
        const spaceOverlap = x.left < y.left + y.width && y.left < x.left + x.width;
        expect(timeOverlap && spaceOverlap).toBe(false);
      }
    }
  });
});

describe('filterBlocksToDay (item 1: resource blocks)', () => {
  it('keeps only blocks whose start falls on the given day', () => {
    const blocks = [
      { start_time: '2026-01-15T08:00:00.000Z', end_time: '2026-01-15T10:00:00.000Z', reason: 'Plumber visit' },
      { start_time: '2026-01-16T08:00:00.000Z', end_time: '2026-01-16T10:00:00.000Z', reason: 'Repaint' },
    ];
    expect(filterBlocksToDay(blocks, '2026-01-15', 'UTC')).toEqual([blocks[0]]);
  });

  it('returns an empty array when no block falls on the given day', () => {
    const blocks = [{ start_time: '2026-01-16T08:00:00.000Z', end_time: '2026-01-16T10:00:00.000Z', reason: null }];
    expect(filterBlocksToDay(blocks, '2026-01-15', 'UTC')).toEqual([]);
  });
});

describe('ResourceBlockOverlay (item 1: resource blocks)', () => {
  it('renders nothing for an empty block list', () => {
    const { container } = render(<ResourceBlockOverlay blocks={[]} timezone="UTC" />);
    expect(container).toBeEmptyDOMElement();
  });

  it('renders one overlay per block, labelled with its reason', () => {
    const blocks = [
      { start_time: '2026-01-15T08:00:00.000Z', end_time: '2026-01-15T10:00:00.000Z', reason: 'Plumber visit' },
    ];
    render(<ResourceBlockOverlay blocks={blocks} timezone="UTC" />);
    const overlay = screen.getByTestId('resource-block');
    expect(overlay.getAttribute('title')).toBe('Blocked: Plumber visit');
    expect(screen.getByText('Blocked: Plumber visit')).toBeInTheDocument();
  });

  it('falls back to a plain "Blocked" label when no reason is given', () => {
    const blocks = [{ start_time: '2026-01-15T08:00:00.000Z', end_time: '2026-01-15T10:00:00.000Z', reason: null }];
    render(<ResourceBlockOverlay blocks={blocks} timezone="UTC" />);
    expect(screen.getByTestId('resource-block').getAttribute('title')).toBe('Blocked');
  });
});
