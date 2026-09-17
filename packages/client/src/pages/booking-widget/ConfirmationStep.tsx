import { WidgetBooking } from '../../api/widget';
import { sendToParent } from './postMessage';

interface Props {
  booking: WidgetBooking;
  /** Client-side only — apt_bookings has no location column (matches the admin app), so
   * this comes from the selected availability combo, not the booking API response. */
  locationName?: string | null;
}

export function ConfirmationStep({ booking, locationName }: Props) {
  const start = new Date(booking.start_time);

  return (
    <div className="dsw-step dsw-step--confirmation">
      <div className="dsw-confirmation-icon">✓</div>
      <h2 className="dsw-step-title">Booking confirmed</h2>
      <p className="dsw-step-text">You're all set — a confirmation email is on its way.</p>

      <div className="dsw-confirmation-card">
        <div className="dsw-confirmation-row">
          <span className="dsw-label">Reference</span>
          <span>{booking.booking_reference}</span>
        </div>
        <div className="dsw-confirmation-row">
          <span className="dsw-label">Service</span>
          <span>{booking.service_name}</span>
        </div>
        <div className="dsw-confirmation-row">
          <span className="dsw-label">Date &amp; time</span>
          <span>{start.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}</span>
        </div>
        {locationName && (
          <div className="dsw-confirmation-row">
            <span className="dsw-label">Location</span>
            <span>{locationName}</span>
          </div>
        )}
        {booking.staff_name && (
          <div className="dsw-confirmation-row">
            <span className="dsw-label">With</span>
            <span>{booking.staff_name}</span>
          </div>
        )}
      </div>

      <button type="button" className="dsw-btn dsw-btn--primary" onClick={() => sendToParent('daystream:close')}>
        Done
      </button>
    </div>
  );
}
