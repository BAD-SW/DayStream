import { useEffect, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import * as bookingsApi from '../api/bookings';
import { AppointmentWindow } from '../components/booking/AppointmentWindow';
import { zonedParts, hhmm } from '../utils/zonedTime';

/**
 * /bookings/new and /bookings/:id/edit: the round 8 New / Edit Appointment screen as a page (the calendar
 * opens the same screen as a window). /bookings/new reads service, variant, date, time (ISO), staff,
 * location and customer from the address.
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
  const t = params.get('time');
  const prefill = mode === 'new' ? {
    serviceId: params.get('service') || undefined,
    variantId: params.get('variant') || undefined,
    date: params.get('date') || undefined,
    time: t ? hhmm(zonedParts(new Date(t), timezone).minutes) : null,
    staffId: params.get('staff') || undefined,
    locationId: params.get('location') || undefined,
    customerId: params.get('customer') || undefined,
  } : undefined;
  return (
    <AppointmentWindow
      businessId={businessId}
      timezone={timezone}
      mode={mode}
      bookingId={id}
      prefill={prefill}
      onClose={() => navigate('/bookings')}
      onSaved={() => navigate('/bookings')}
    />
  );
}
