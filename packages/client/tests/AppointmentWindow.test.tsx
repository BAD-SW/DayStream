import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor, fireEvent } from '@testing-library/react';
import { CustomerPicker, ServicePicker, OptionChips, ParticipantsField } from '../src/components/booking/AppointmentWindow';
import type { SvcItem } from '../src/components/booking/AppointmentWindow';
import * as customersApi from '../src/api/customers';

vi.mock('../src/api/customers', async () => {
  const actual = await vi.importActual<typeof import('../src/api/customers')>('../src/api/customers');
  return { ...actual, getCustomers: vi.fn(), createCustomer: vi.fn(), getCustomer: vi.fn() };
});
const getCustomers = customersApi.getCustomers as unknown as ReturnType<typeof vi.fn>;

const variant = (id: string, name: string, price: number) => ({ id, name, duration: 60, price, pricing_model: 'fixed', display_order: 0, status: 'active' });
const svcs: SvcItem[] = Array.from({ length: 8 }, (_, i) => ({ id: 's' + i, name: `Service ${i}`, category_name: 'Recovery', booking_type: i === 0 ? 'shared' : 'individual', max_capacity: i === 0 ? 6 : 1, variants: [variant('v' + i, '60 min', 1000 + i * 100), variant('w' + i, '90 min', 2000)] }));

describe('New Appointment round 8 parts (THE-23 4.1)', () => {
  beforeEach(() => { getCustomers.mockResolvedValue({ data: [{ id: 'c1', first_name: 'Olivia', last_name: 'Cano', email: 'demo.newlead.olivia@transcend.test' }] }); });
  afterEach(() => { cleanup(); vi.clearAllMocks(); });

  it('customer search asks the booking search (name, surname, email before @, phone; never the domain)', async () => {
    const onCustomer = vi.fn();
    render(<CustomerPicker businessId="b1" customer={null} onCustomer={onCustomer} walk={false} onWalk={() => {}} walkName="" onWalkName={() => {}} />);
    const box = screen.getByLabelText('Search customers');
    expect(box.getAttribute('placeholder')).toContain('without @domain');
    fireEvent.change(box, { target: { value: 'olivia' } });
    await waitFor(() => expect(getCustomers).toHaveBeenCalledWith('b1', { search: 'olivia', search_mode: 'booking', limit: 6 }));
    fireEvent.click(await screen.findByText('Olivia Cano'));
    expect(onCustomer).toHaveBeenCalledWith(expect.objectContaining({ id: 'c1' }));
  });

  it('offers a new customer in place, prefilled from what was typed', async () => {
    render(<CustomerPicker businessId="b1" customer={null} onCustomer={() => {}} walk={false} onWalk={() => {}} walkName="" onWalkName={() => {}} />);
    fireEvent.change(screen.getByLabelText('Search customers'), { target: { value: 'Sara Pons' } });
    fireEvent.click(await screen.findByText(/New customer “Sara Pons”/));
    expect((screen.getByLabelText('First name') as HTMLInputElement).value).toBe('Sara');
    expect((screen.getByLabelText('Last name') as HTMLInputElement).value).toBe('Pons');
    expect((screen.getByText('Add and select') as HTMLButtonElement).disabled).toBe(true); // email or phone needed
  });

  it('services as boxes in pages of 6, with search', () => {
    const onService = vi.fn();
    render(<ServicePicker services={svcs} serviceId="" onService={onService} />);
    expect(screen.getAllByRole('button', { pressed: false }).filter((b) => b.className === 'svc')).toHaveLength(6);
    expect(screen.getByText('1 / 2')).toBeTruthy();
    fireEvent.click(screen.getByLabelText('Next services'));
    expect(screen.getByText('Service 7')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Search services'), { target: { value: 'Service 3' } });
    fireEvent.click(screen.getByText('Service 3'));
    expect(onService).toHaveBeenCalledWith('s3');
  });

  it('options as chips with price; participants only for shared rooms and groups', () => {
    const onVariant = vi.fn();
    const { rerender } = render(<><OptionChips svc={svcs[1]} variantId="v1" onVariant={onVariant} /><ParticipantsField svc={svcs[1]} parts={1} onParts={() => {}} ovr={false} onOvr={() => {}} /></>);
    expect(screen.getByText('60 min').closest('button')!.getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(screen.getByText('90 min'));
    expect(onVariant).toHaveBeenCalledWith('w1');
    expect(screen.queryByText(/Participants/)).toBeNull();
    rerender(<ParticipantsField svc={svcs[0]} parts={2} onParts={() => {}} ovr={false} onOvr={() => {}} />);
    expect(screen.getByText(/Participants/)).toBeTruthy();
    expect(screen.getByText('Override capacity limit')).toBeTruthy();
  });
});
