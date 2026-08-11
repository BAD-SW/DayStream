import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor, fireEvent } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { BookingEdit } from '../src/pages/BookingEdit';
import * as servicesApi from '../src/api/services';
import * as customersApi from '../src/api/customers';
import * as resourcesApi from '../src/api/resources';
import * as bookingsApi from '../src/api/bookings';
import { apiClient } from '../src/api/client';

vi.mock('../src/api/services');
vi.mock('../src/api/customers');
vi.mock('../src/api/resources');
vi.mock('../src/api/bookings');
vi.mock('../src/api/client', () => ({ apiClient: { get: vi.fn(), put: vi.fn() } }));

const navigateMock = vi.fn();
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return { ...actual, useNavigate: () => navigateMock };
});

const MULTI_SERVICE = { id: 'svc-multi', name: 'Fire & Ice' };
const SOLO_SERVICE = { id: 'svc-solo', name: 'Solo Massage' };
const VARIANT = { id: 'var-1', name: '60 min', duration: 60, price: 5000, status: 'active' };
const MULTI_RULE = { id: 'rule-1', resource_ids: ['res-1'] };
const RESOURCE = { id: 'res-1', capacity: 3 };

const CUSTOMER_BOOKING = {
  id: 'booking-1', booking_reference: 'BK-2026-0001',
  service_id: MULTI_SERVICE.id, variant_id: VARIANT.id,
  customer_id: 'cust-1', customer_first_name: 'Jane', customer_last_name: 'Doe', customer_email: 'jane@example.com',
  walk_in_name: null, staff_id: 'staff-1', resource_id: 'res-1', participant_count: 2,
  start_time: '2026-08-17T14:00:00.000Z', end_time: '2026-08-17T15:00:00.000Z',
  status: 'confirmed', booking_type: 'individual', price: 5000, notes: 'Handle with care',
  created_at: '2026-08-01T00:00:00.000Z',
};

const WALKIN_BOOKING = {
  ...CUSTOMER_BOOKING,
  id: 'booking-2', customer_id: null, customer_first_name: null, customer_last_name: null, customer_email: undefined,
  walk_in_name: 'Drop-in Dana',
};

function apiClientGetMock(url: string) {
  if (url === '/v1/admin/businesses') return Promise.resolve({ data: { data: [{ id: 'biz-1', timezone: 'UTC' }] } });
  if (url === '/v1/locations') return Promise.resolve({ data: { data: [] } });
  if (url === '/v1/bookings/availability/combinations') return Promise.resolve({ data: { data: { timezone: 'UTC', slots: [] } } });
  return Promise.resolve({ data: { data: [] } });
}

describe('BookingEdit (parity with BookingCreate)', () => {
  beforeEach(() => {
    localStorage.setItem('business_id', 'biz-1');
    vi.mocked(servicesApi.getServices).mockResolvedValue({ data: [MULTI_SERVICE, SOLO_SERVICE] } as any);
    vi.mocked(servicesApi.getVariants).mockResolvedValue([VARIANT] as any);
    vi.mocked(servicesApi.getAvailability).mockImplementation((serviceId: string) =>
      Promise.resolve(serviceId === MULTI_SERVICE.id ? [MULTI_RULE] as any : []),
    );
    vi.mocked(resourcesApi.getResource).mockResolvedValue(RESOURCE as any);
    vi.mocked(bookingsApi.getAvailabilityDays).mockResolvedValue({ timezone: 'UTC', days: {} });
    vi.mocked(bookingsApi.updateBooking).mockResolvedValue({ id: 'booking-1' } as any);
    vi.mocked(apiClient.get).mockImplementation(apiClientGetMock as any);
  });

  afterEach(() => {
    cleanup();
    localStorage.clear();
    vi.clearAllMocks();
  });

  function renderPage(booking: any) {
    vi.mocked(bookingsApi.getBooking).mockResolvedValue(booking as any);
    return render(
      <MemoryRouter initialEntries={[`/bookings/${booking.id}/edit`]}>
        <Routes><Route path="/bookings/:id/edit" element={<BookingEdit />} /></Routes>
      </MemoryRouter>,
    );
  }

  it('pre-fills the customer field with the real customer\'s name — not blank (regression)', async () => {
    renderPage(CUSTOMER_BOOKING);
    await waitFor(() => expect(screen.getByText(/Jane Doe/)).toBeInTheDocument());
    expect(screen.getByText(/jane@example\.com/)).toBeInTheDocument();
    // The "Walk-in" toggle must reflect that this is a real customer, not a walk-in.
    expect(screen.getByLabelText('Walk-in')).not.toBeChecked();
  });

  it('pre-fills the walk-in toggle and name for a walk-in booking — the exact reported blank-field bug', async () => {
    renderPage(WALKIN_BOOKING);
    await waitFor(() => expect(screen.getByLabelText('Walk-in')).toBeChecked());
    expect(screen.getByPlaceholderText('Name (optional)')).toHaveValue('Drop-in Dana');
    // No stray blank customer-search box should be showing.
    expect(screen.queryByPlaceholderText('Search by name, email, or phone...')).not.toBeInTheDocument();
  });

  it('pre-fills service, variant, and participant count from the existing booking', async () => {
    renderPage(CUSTOMER_BOOKING);
    await waitFor(() => expect((screen.getByLabelText('Service *') as HTMLSelectElement).value).toBe(MULTI_SERVICE.id));
    await waitFor(() => expect((screen.getByLabelText('Duration / Option *') as HTMLSelectElement).value).toBe(VARIANT.id));
    await waitFor(() => expect(screen.getByLabelText('Number of participants')).toHaveValue(2));
  });

  it('renders the day-picker calendar (not a native date input) once a variant is loaded', async () => {
    renderPage(CUSTOMER_BOOKING);
    await waitFor(() => expect((screen.getByLabelText('Duration / Option *') as HTMLSelectElement).value).toBe(VARIANT.id));
    // DayPicker renders month navigation controls; a native <input type="date"> would not.
    await waitFor(() => expect(screen.getByLabelText('Previous month')).toBeInTheDocument());
    expect(document.querySelector('input[type="date"]')).not.toBeInTheDocument();
  });

  it('hides the participant count field for a service with no multi-capacity resource', async () => {
    renderPage({ ...CUSTOMER_BOOKING, service_id: SOLO_SERVICE.id });
    await waitFor(() => expect((screen.getByLabelText('Duration / Option *') as HTMLSelectElement).value).toBe(VARIANT.id));
    expect(screen.queryByLabelText('Number of participants')).not.toBeInTheDocument();
  });

  it('sends the new participant count and real customer_id when saving, without corrupting it to null', async () => {
    // The day-picker only enables a cell whose status is 'available' — the booking's own day must
    // be marked available or the click to re-enter the slot picker is a no-op.
    vi.mocked(bookingsApi.getAvailabilityDays).mockResolvedValue({ timezone: 'UTC', days: { '2026-08-17': 'available' } });
    // The combo-fetch effect runs once during hydration (participant_count isn't in its deps,
    // matching BookingCreate's own behaviour) — so the slot data must be in place before render,
    // not swapped in after the fact.
    vi.mocked(apiClient.get).mockImplementation(((url: string) => {
      if (url === '/v1/bookings/availability/combinations') {
        return Promise.resolve({
          data: { data: { timezone: 'UTC', slots: [{
            start_time: CUSTOMER_BOOKING.start_time, end_time: CUSTOMER_BOOKING.end_time, duration: 60,
            location_id: null, location_name: null,
            staff_id: 'staff-1', staff_first_name: 'Jamie', staff_last_name: 'Lee', capacity_remaining: 3,
          }] } } });
      }
      return apiClientGetMock(url);
    }) as any);

    renderPage(CUSTOMER_BOOKING);
    await waitFor(() => expect(screen.getByLabelText('Number of participants')).toHaveValue(2));

    fireEvent.change(screen.getByLabelText('Number of participants'), { target: { value: '3' } });

    // Re-select the already-hydrated day to reach the slot picker, then the already-hydrated time.
    await waitFor(() => expect(screen.getByRole('button', { name: '17' })).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: '17' }));

    const slotLabel = new Date(CUSTOMER_BOOKING.start_time).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', timeZone: 'UTC' });
    await waitFor(() => expect(screen.getByRole('button', { name: slotLabel })).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: slotLabel }));

    await waitFor(() => expect(screen.getByRole('button', { name: 'Save Changes' })).not.toBeDisabled());
    fireEvent.click(screen.getByRole('button', { name: 'Save Changes' }));

    await waitFor(() => expect(bookingsApi.updateBooking).toHaveBeenCalled());
    expect(bookingsApi.updateBooking).toHaveBeenCalledWith('booking-1', 'biz-1', expect.objectContaining({
      customer_id: 'cust-1',
      walk_in_name: null,
      participant_count: 3,
      staff_id: 'staff-1',
    }));
  });
});
