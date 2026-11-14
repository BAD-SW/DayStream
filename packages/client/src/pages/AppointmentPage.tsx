import { useEffect, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import * as bookingsApi from '../api/bookings';
import { AppointmentWindow } from '../components/booking/AppointmentWindow';
import { zonedParts, hhmm } from '../utils/zonedTime';

/**
 * /bookings/new and /bookings/:id/edit: the one New / Edit Appointment screen. The list, the calendar,
 * a customer, the Inbox... all open it here, so there is one screen to look at and to change.
 *
 * /bookings/new reads from the address: service, variant, date, time (HH:MM or ISO), staff, location,
 * customer (or customer_id), walk_in, walk_in_name, participants. Both read `return`: where to go back
 * to when the screen is closed or saved (a /bookings… address; default /bookings). Saving hands the
 * message to that screen.
 */
export function AppointmentPage({ mode }: { mode: 'new' | 'edit' }) {
  const navigate = useNavigate();
  const { id } = useParams();
  const [params] = useSearchParams();
  const businessId = localStorage.getItem('business_id') || '';
  const [timezone, setTimezone] = useState<string | null>(null);
  useEffect(() => {
    bookingsApi.getBookingFilters(businessId).then((f) => setTimezone(f.timezone || 'UTC')).catch(() => setTimezone('UTC'));
  }, [businessId]);
  if (!timezone) return null;

  const wanted = params.get('return') || '';
  const back = wanted.startsWith('/bookings') ? wanted : '/bookings';
  const t = params.get('time');
  const parts = Number(params.get('participants'));
  const prefill = mode === 'new' ? {
    serviceId: params.get('service') || undefined,
    variantId: params.get('variant') || undefined,
    date: params.get('date') || undefined,
    time: !t ? null : /^\d{2}:\d{2}$/.test(t) ? t : hhmm(zonedParts(new Date(t), timezone).minutes),
    staffId: params.get('staff') || undefined,
    locationId: params.get('location') || undefined,
    customerId: params.get('customer') || params.get('customer_id') || undefined,
    walkIn: params.get('walk_in') === '1',
    walkInName: params.get('walk_in_name') || undefined,
    participants: Number.isInteger(parts) && parts > 0 ? parts : undefined,
  } : undefined;
  return (
    <AppointmentWindow
      businessId={businessId}
      timezone={timezone}
      mode={mode}
      bookingId={id}
      prefill={prefill}
      onClose={() => navigate(back)}
      onSaved={(message) => navigate(back, { state: { toast: message } })}
    />
  );
}

/** The address of the New Appointment screen, filled in, coming back to `returnTo`. */
export function newAppointmentPath(p: {
  date?: string; time?: string | null; serviceId?: string; variantId?: string; staffId?: string; locationId?: string;
  customerId?: string; walkIn?: boolean; walkInName?: string; participants?: number;
}, returnTo: string): string {
  const q = new URLSearchParams();
  if (p.serviceId) q.set('service', p.serviceId);
  if (p.variantId) q.set('variant', p.variantId);
  if (p.date) q.set('date', p.date);
  if (p.time) q.set('time', p.time);
  if (p.staffId && p.staffId !== 'any') q.set('staff', p.staffId);
  if (p.locationId) q.set('location', p.locationId);
  if (p.customerId) q.set('customer', p.customerId);
  if (p.walkIn) q.set('walk_in', '1');
  if (p.walkInName) q.set('walk_in_name', p.walkInName);
  if (p.participants && p.participants > 1) q.set('participants', String(p.participants));
  q.set('return', returnTo);
  return `/bookings/new?${q.toString()}`;
}

/** The address of the Edit Appointment screen, coming back to `returnTo`. */
export function editAppointmentPath(bookingId: string, returnTo: string): string {
  return `/bookings/${bookingId}/edit?return=${encodeURIComponent(returnTo)}`;
}
