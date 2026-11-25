import { useTranslation } from 'react-i18next';
import { WidgetBooking } from '../../api/widget';
import { formatDateTime } from '../../utils/format';
import { sendToParent } from './postMessage';

interface Props {
  booking: WidgetBooking;
  /** Client-side only — apt_bookings has no location column (matches the admin app), so
   * this comes from the selected availability combo, not the booking API response. */
  locationName?: string | null;
}

export function ConfirmationStep({ booking, locationName }: Props) {
  const { t } = useTranslation('widget');

  return (
    <div className="dsw-step dsw-step--confirmation">
      <div className="dsw-confirmation-icon">✓</div>
      <h2 className="dsw-step-title">{t('confirmation.title')}</h2>
      <p className="dsw-step-text">{t('confirmation.message')}</p>

      <div className="dsw-confirmation-card">
        <div className="dsw-confirmation-row">
          <span className="dsw-label">{t('confirmation.reference')}</span>
          <span>{booking.booking_reference}</span>
        </div>
        <div className="dsw-confirmation-row">
          <span className="dsw-label">{t('confirmation.service')}</span>
          <span>{booking.service_name}</span>
        </div>
        <div className="dsw-confirmation-row">
          <span className="dsw-label">{t('confirmation.dateTime')}</span>
          <span>{formatDateTime(booking.start_time)}</span>
        </div>
        {locationName && (
          <div className="dsw-confirmation-row">
            <span className="dsw-label">{t('confirmation.location')}</span>
            <span>{locationName}</span>
          </div>
        )}
        {booking.staff_name && (
          <div className="dsw-confirmation-row">
            <span className="dsw-label">{t('confirmation.with')}</span>
            <span>{booking.staff_name}</span>
          </div>
        )}
      </div>

      <button type="button" className="dsw-btn dsw-btn--primary" onClick={() => sendToParent('daystream:close')}>
        {t('confirmation.done')}
      </button>
    </div>
  );
}
