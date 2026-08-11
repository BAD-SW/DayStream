import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { BookingCreate } from '../src/pages/BookingCreate';
import * as servicesApi from '../src/api/services';
import * as customersApi from '../src/api/customers';
import * as resourcesApi from '../src/api/resources';
import * as bookingsApi from '../src/api/bookings';
import { apiClient } from '../src/api/client';

vi.mock('../src/api/services');
vi.mock('../src/api/customers');
vi.mock('../src/api/resources');
vi.mock('../src/api/bookings');
vi.mock('../src/api/client', () => ({ apiClient: { get: vi.fn(), post: vi.fn() } }));

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

function apiClientGetMock(url: string) {
  if (url === '/v1/admin/businesses') return Promise.resolve({ data: { data: [{ id: 'biz-1', timezone: 'UTC' }] } });
  if (url === '/v1/locations') return Promise.resolve({ data: { data: [] } });
  if (url === '/v1/bookings/availability/combinations') return Promise.resolve({ data: { data: { timezone: 'UTC', slots: [] } } });
  return Promise.resolve({ data: { data: [] } });
}

describe('BookingCreate (feature 32 integration — task 7.1.1)', () => {
  beforeEach(() => {
    localStorage.setItem('business_id', 'biz-1');
    vi.mocked(servicesApi.getServices).mockResolvedValue({ data: [MULTI_SERVICE, SOLO_SERVICE] } as any);
    vi.mocked(servicesApi.getVariants).mockResolvedValue([VARIANT] as any);
    vi.mocked(servicesApi.getAvailability).mockImplementation((serviceId: string) =>
      Promise.resolve(serviceId === MULTI_SERVICE.id ? [MULTI_RULE] as any : []),
    );
    vi.mocked(resourcesApi.getResource).mockResolvedValue(RESOURCE as any);
    vi.mocked(bookingsApi.getAvailabilityDays).mockResolvedValue({ timezone: 'UTC', days: {} });
    vi.mocked(bookingsApi.createBooking).mockResolvedValue({ id: 'booking-1' } as any);
    vi.mocked(apiClient.get).mockImplementation(apiClientGetMock as any);
  });

  afterEach(() => {
    cleanup();
    localStorage.clear();
    vi.clearAllMocks();
  });

  function renderPage() {
    return render(<MemoryRouter><BookingCreate /></MemoryRouter>);
  }

  async function selectServiceAndVariant(serviceName: string) {
    await waitFor(() => expect(screen.getByText(serviceName)).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText('Service *'), { target: { value: serviceName === MULTI_SERVICE.name ? MULTI_SERVICE.id : SOLO_SERVICE.id } });
    await waitFor(() => expect(screen.getByLabelText('Duration / Option *')).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText('Duration / Option *'), { target: { value: VARIANT.id } });
  }

  it('shows the participant count field for a service linked to a multi-capacity resource', async () => {
    renderPage();
    await selectServiceAndVariant(MULTI_SERVICE.name);
    await waitFor(() => expect(screen.getByLabelText('Number of participants')).toBeInTheDocument());
  });

  it('hides the participant count field for a service with no multi-capacity resource', async () => {
    renderPage();
    await selectServiceAndVariant(SOLO_SERVICE.name);
    await waitFor(() => expect(screen.getByLabelText('Duration / Option *')).toHaveValue(VARIANT.id));
    expect(screen.queryByLabelText('Number of participants')).not.toBeInTheDocument();
  });

  it('resets the participant count field (and its calendar) when the service changes away from a multi-capacity one', async () => {
    renderPage();
    await selectServiceAndVariant(MULTI_SERVICE.name);
    await waitFor(() => expect(screen.getByLabelText('Number of participants')).toBeInTheDocument());

    fireEvent.change(screen.getByLabelText('Service *'), { target: { value: SOLO_SERVICE.id } });
    await waitFor(() => expect(screen.queryByLabelText('Number of participants')).not.toBeInTheDocument());
  });

  it('includes participant_count in the createBooking call when submitting', async () => {
    const now = new Date();
    const tomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
    const dateStr = `${tomorrow.getFullYear()}-${String(tomorrow.getMonth() + 1).padStart(2, '0')}-${String(tomorrow.getDate()).padStart(2, '0')}`;
    const slotStart = `${dateStr}T14:00:00.000Z`;

    vi.mocked(bookingsApi.getAvailabilityDays).mockResolvedValue({ timezone: 'UTC', days: { [dateStr]: 'available' } });
    vi.mocked(apiClient.get).mockImplementation(((url: string) => {
      if (url === '/v1/bookings/availability/combinations') {
        return Promise.resolve({
          data: {
            data: {
              timezone: 'UTC',
              slots: [{
                start_time: slotStart, end_time: `${dateStr}T15:00:00.000Z`, duration: 60,
                location_id: null, location_name: null,
                staff_id: 'staff-1', staff_first_name: 'Jamie', staff_last_name: 'Lee',
                capacity_remaining: 3,
              }],
            },
          },
        });
      }
      return apiClientGetMock(url);
    }) as any);

    renderPage();
    await selectServiceAndVariant(MULTI_SERVICE.name);
    await waitFor(() => expect(screen.getByLabelText('Number of participants')).toBeInTheDocument());

    fireEvent.change(screen.getByLabelText('Number of participants'), { target: { value: '2' } });
    expect(screen.getByLabelText('Number of participants')).toHaveValue(2);

    fireEvent.click(screen.getByLabelText('Walk-in'));

    // Drive the calendar: wait for tomorrow's day cell to be clickable, click it (enters slot-picker).
    await waitFor(() => expect((screen.getByText(String(tomorrow.getDate())).closest('button') as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(screen.getByText(String(tomorrow.getDate())).closest('button')!);

    // Select the fetched time slot.
    const slotLabel = new Date(slotStart).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', timeZone: 'UTC' });
    await waitFor(() => expect(screen.getByRole('button', { name: slotLabel })).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: slotLabel }));

    await waitFor(() => expect(screen.getByRole('button', { name: 'Create Booking' })).not.toBeDisabled());
    fireEvent.click(screen.getByRole('button', { name: 'Create Booking' }));

    await waitFor(() => expect(bookingsApi.createBooking).toHaveBeenCalled());
    expect(bookingsApi.createBooking).toHaveBeenCalledWith(expect.objectContaining({
      participant_count: 2,
      override_rules: false,
      start_time: slotStart,
      staff_id: 'staff-1',
    }));
  });

  it('calendar resets on service change (day selection made under one service does not carry over)', async () => {
    const now = new Date();
    const tomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
    const dateStr = `${tomorrow.getFullYear()}-${String(tomorrow.getMonth() + 1).padStart(2, '0')}-${String(tomorrow.getDate()).padStart(2, '0')}`;
    vi.mocked(bookingsApi.getAvailabilityDays).mockResolvedValue({ timezone: 'UTC', days: { [dateStr]: 'available' } });

    renderPage();
    await selectServiceAndVariant(MULTI_SERVICE.name);
    await waitFor(() => expect((screen.getByText(String(tomorrow.getDate())).closest('button') as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(screen.getByText(String(tomorrow.getDate())).closest('button')!);
    expect(screen.getByText('← Back to calendar')).toBeInTheDocument();

    // Switching service clears selectedVariant, which unmounts the AvailabilityCalendar entirely
    // (it's only rendered while a variant is selected) — so the prior day selection cannot persist.
    fireEvent.change(screen.getByLabelText('Service *'), { target: { value: SOLO_SERVICE.id } });
    await waitFor(() => expect((screen.getByLabelText('Duration / Option *') as HTMLSelectElement).value).toBe(''));
    expect(screen.queryByText('← Back to calendar')).not.toBeInTheDocument();
  });
});
