import { useEffect, useState } from 'react';
import { useContextManager } from '../context/ContextManager';
import { getBookingsView } from '../api/bookingsView';
import type { BookingsView } from '../api/bookingsView';
import { Bookings } from '../pages/Bookings';
import { BookingCalendar } from '../pages/BookingCalendar';

/**
 * What staff see at /bookings (spec 51, gap 3): the calendar, or the list with the Waiting list.
 * The staff member's own choice on their profile comes first, then the business setting
 * (Settings > System). Without a business in view, or if the choice cannot be read, the calendar.
 */
export function BookingsHome() {
  const businessId = useContextManager().activeContext.businessId;
  const [view, setView] = useState<BookingsView | null>(businessId ? null : 'calendar');

  useEffect(() => {
    if (!businessId) { setView('calendar'); return; }
    let stale = false;
    setView(null);
    getBookingsView(businessId)
      .then((r) => { if (!stale) setView(r.view); })
      .catch(() => { if (!stale) setView('calendar'); });
    return () => { stale = true; };
  }, [businessId]);

  // Nothing until the choice is known, so the other screen never flashes first.
  if (!view) return null;
  return view === 'list' ? <Bookings /> : <BookingCalendar />;
}
