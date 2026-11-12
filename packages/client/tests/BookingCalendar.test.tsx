import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { render, screen } from '@testing-library/react';
import {
  buildServiceColorMap, QuickFilterBar, ParticipantCountBadge,
  deriveServiceColumns, getVisibleServiceColumns, isServiceVisible, toggleServiceFilter,
  filterBlocksToDay, ResourceBlockOverlay,
  pillPages, pillWidth, topServices,
  isOffHours, slotView, columnsPerPage, zonedToIso, zonedParts, TimeGrid,
} from '../src/pages/BookingCalendar';
import { fireEvent } from '@testing-library/react';

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
    // CAL-23 (11 Nov 2026): from All, a click shows only that service
    getByText('Alpha').click();
    expect(selected).toEqual(new Set(['a']));
    rerender(<QuickFilterBar services={services} selected={selected} onChange={(next) => { selected = next; }} colorMap={colorMap} />);
    getByText('All').click();
    expect(selected).toBe('all');
  });
});

describe('isServiceVisible / toggleServiceFilter', () => {
  it('Feature: 33-calendar-redesign: toggling a service off then back on returns to \'all\'', () => {
    fc.assert(
      fc.property(servicesArb, fc.integer({ min: 0 }), (services, idx) => {
        // CAL-23 (11 Nov 2026): from All a click shows only that service; clicking it again goes back to All
        const svc = services[idx % services.length];
        const only = toggleServiceFilter('all', services, svc.id);
        if (services.length <= 1) { expect(only).toBe('all'); return; }
        expect(isServiceVisible(only, svc.id)).toBe(true);
        for (const other of services) {
          if (other.id !== svc.id) expect(isServiceVisible(only, other.id)).toBe(false);
        }
        expect(toggleServiceFilter(only, services, svc.id)).toBe('all');
      }),
      { numRuns: 100 },
    );
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

describe('pillPages (CAL-23)', () => {
  const names = Array.from({ length: 14 }, (_, i) => `Service number ${i + 1}`);
  it('one page when every pill fits (or the width is unknown)', () => {
    expect(pillPages(0, names)).toHaveLength(1);
    expect(pillPages(5000, names)).toHaveLength(1);
  });
  it('otherwise pages that each fit next to All and the arrows, covering every service once', () => {
    const pages = pillPages(900, names);
    expect(pages.length).toBeGreaterThan(1);
    expect(pages.flat()).toEqual(names.map((_, i) => i));
    for (const p of pages) expect(60 + 8 + 110 + p.reduce((x, i) => x + pillWidth(names[i]) + 8, 0)).toBeLessThanOrEqual(900 + pillWidth(names[p[0]]) + 8);
  });
});

describe('topServices (CAL-15)', () => {
  it('puts the fullest first and leaves out services with nothing booked', () => {
    const top = topServices([
      { service_id: 'a', booked: 2, capacity: 10 },
      { service_id: 'b', booked: 5, capacity: 6 },
      { service_id: 'c', booked: 0, capacity: 8 },
    ]);
    expect(top.map((x) => x.service_id)).toEqual(['b', 'a']);
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

describe('Calendar 11 Nov 2026 design', () => {
  it('CAL-hours: grey outside the business hours and on closed days; no hours set up = never grey', () => {
    expect(isOffHours(undefined, 3 * 60)).toBe(false);
    expect(isOffHours({ open: '09:00', close: '20:00' }, 8 * 60 + 30)).toBe(true);
    expect(isOffHours({ open: '09:00', close: '20:00' }, 9 * 60)).toBe(false);
    expect(isOffHours({ open: '09:00', close: '20:00' }, 19 * 60 + 30)).toBe(false);
    expect(isOffHours({ open: '09:00', close: '20:00' }, 20 * 60)).toBe(true);
    expect(isOffHours({ closed: true, reason: 'Closed on Sundays' }, 12 * 60)).toBe(true);
  });

  it('CAL-7 b: a number only where there is a booking and room left; never 0/x, x/x or 1/1', () => {
    expect(slotView({ booked: 2, left: 1 })).toEqual({ label: '2/3', full: false, none: false });
    expect(slotView({ booked: 0, left: 3 })).toEqual({ label: null, full: false, none: false });
    expect(slotView({ booked: 3, left: 0 })).toEqual({ label: null, full: true, none: false });
    expect(slotView({ booked: 1, left: 0 })).toEqual({ label: null, full: true, none: false }); // a float tank: never 1/1
    expect(slotView(undefined)).toEqual({ label: null, full: false, none: true }); // nobody can take it: stripes (CAL-21)
  });

  it('CAL-20: Day columns per page fit the width, at most 6', () => {
    expect(columnsPerPage(2000)).toBe(6);
    expect(columnsPerPage(60 + 170 * 4 + 10)).toBe(4);
    expect(columnsPerPage(200)).toBe(1);
  });

  it('times are the business\'s local time', () => {
    const iso = zonedToIso('2026-11-12', '10:00', 'Europe/Madrid');
    expect(iso).toBe('2026-11-12T09:00:00.000Z');
    expect(zonedParts(new Date(iso), 'Europe/Madrid')).toEqual({ date: '2026-11-12', minutes: 600 });
  });

  const baseCol = (over: Partial<Parameters<typeof TimeGrid>[0]['columns'][number]> = {}) => ({
    key: 'sv:a', date: '2099-01-05', header: 'Massage', bookings: [] as any[],
    onNew: () => {}, label: (bk: any) => bk.customer_name, ...over,
  });

  it('TimeGrid (hub): grey outside hours, the blue + at the right of free cells, the number, a box per booking', () => {
    const calls: number[] = [];
    const { container } = render(
      <TimeGrid
        hourRange={{ start: 8, end: 10 }} timezone="UTC" colorMap={new Map()} onBookingClick={() => {}} ghost={null}
        dayHours={{ '2099-01-05': { open: '09:00', close: '20:00' } }}
        columns={[baseCol({
          bookings: [{ id: 'b1', service_id: 'a', service_name: 'Massage', customer_name: 'Ana', start_time: '2099-01-05T09:00:00Z', end_time: '2099-01-05T10:00:00Z', payment_status: 'paid' }],
          slot: (m) => (m === 9 * 60 ? { label: '1/3', full: false, none: false, tip: '1 booked, 2 more possible' } : { label: null, full: false, none: false, tip: '' }),
          onNew: (m) => calls.push(m),
        })]}
      />,
    );
    const cells = container.querySelectorAll('.c2');
    expect(cells).toHaveLength(4); // 8:00, 8:30, 9:00, 9:30
    expect(cells[0].classList.contains('off')).toBe(true);
    expect(cells[1].classList.contains('off')).toBe(true);
    expect(cells[2].classList.contains('off')).toBe(false);
    expect(cells[0].querySelector('.cnew')).toBeNull();
    // the + is in the cell that has a booking too (it sits at the right, the box leaves that edge free)
    expect(cells[2].querySelector('.cnew span')!.textContent).toBe('+');
    expect(cells[2].querySelector('.capn')!.textContent).toBe('1/3');
    const box = cells[2].querySelector('.bk2') as HTMLElement;
    expect(box.textContent).toBe('Ana');
    expect(box.style.width).toContain('100% - 36px');
    expect(box.style.height).toBe(`${2 * 30 - 4}px`);
    fireEvent.click(cells[3].querySelector('.cnew')!);
    expect(calls).toEqual([9 * 60 + 30]);
  });

  it('TimeGrid: an empty time nobody can take gets the stripes and no +; a full time has no +', () => {
    const { container } = render(
      <TimeGrid
        hourRange={{ start: 9, end: 10 }} timezone="UTC" colorMap={new Map()} onBookingClick={() => {}} ghost={null} dayHours={{}}
        columns={[baseCol({ slot: (m) => (m === 9 * 60 ? { label: null, full: false, none: true, tip: 'nobody' } : { label: null, full: true, none: false, tip: '' }) })]}
      />,
    );
    const cells = container.querySelectorAll('.c2');
    expect(cells[0].classList.contains('nocap')).toBe(true);
    expect(cells[0].querySelector('.cnew')).toBeNull();
    expect(cells[1].classList.contains('nocap')).toBe(false);
    expect(cells[1].querySelector('.cnew')).toBeNull();
  });

  it('CAL-4 a: the dashed preview is as long as the chosen option and names it', () => {
    const { container } = render(
      <TimeGrid
        hourRange={{ start: 9, end: 12 }} timezone="UTC" colorMap={new Map()} onBookingClick={() => {}} dayHours={{}}
        ghost={{ colKey: 'sv:a', date: '2099-01-05', start: 9 * 60 + 30, len: 90, label: 'Massage 90 min' }}
        columns={[baseCol()]}
      />,
    );
    const g = container.querySelector('.gh') as HTMLElement;
    expect(g.textContent).toBe('New · Massage 90 min09:30–11:00');
    expect(g.style.height).toBe(`${(90 / 30) * 30 - 4}px`);
  });

  it('more than 3 bookings at one time in Week: 2 boxes and +N', () => {
    const bk = (id: string) => ({ id, service_id: 'a', service_name: 'Massage', customer_name: id, start_time: '2099-01-05T09:00:00Z', end_time: '2099-01-05T10:00:00Z' });
    const { container } = render(
      <TimeGrid hourRange={{ start: 9, end: 10 }} timezone="UTC" colorMap={new Map()} onBookingClick={() => {}} ghost={null} dayHours={{}} maxPerTime={3}
        columns={[baseCol({ bookings: [bk('A'), bk('B'), bk('C'), bk('D')] })]} />,
    );
    expect(container.querySelectorAll('.bk2.sc')).toHaveLength(2);
    expect(container.querySelector('.bk2.more')!.textContent).toBe('+2');
  });

  it('past times and closed days offer no +', () => {
    const { container } = render(
      <TimeGrid
        hourRange={{ start: 9, end: 10 }} timezone="UTC" colorMap={new Map()} onBookingClick={() => {}} ghost={null} dayHours={{}}
        columns={[baseCol({ date: '2000-01-03' }), baseCol({ key: 'sv:b', closed: true })]}
      />,
    );
    expect(container.querySelectorAll('.cnew')).toHaveLength(0);
  });
});
