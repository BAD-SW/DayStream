import { useTranslation } from 'react-i18next';
import { formatDayLabel, formatTimeLabel } from './format';

interface Props {
  productName: string;
  startTime: string;
  locationName?: string | null;
  staffName?: string | null;
}

/** Requirement (staff/location visibility) — shown from Customer Details onward so the
 * visitor always sees who/where before confirming, even on services with a single
 * staff member and location where there was nothing to actively choose. */
export function AppointmentSummary({ productName, startTime, locationName, staffName }: Props) {
  const { t } = useTranslation('widget');
  return (
    <div className="dsw-summary dsw-summary--stacked">
      <div className="dsw-confirmation-row">
        <span className="dsw-label">{t('summary.service')}</span>
        <span>{productName}</span>
      </div>
      <div className="dsw-confirmation-row">
        <span className="dsw-label">{t('summary.when')}</span>
        <span>{t('summary.whenValue', { day: formatDayLabel(startTime.slice(0, 10)), time: formatTimeLabel(startTime) })}</span>
      </div>
      {locationName && (
        <div className="dsw-confirmation-row">
          <span className="dsw-label">{t('summary.location')}</span>
          <span>{locationName}</span>
        </div>
      )}
      {staffName && (
        <div className="dsw-confirmation-row">
          <span className="dsw-label">{t('summary.with')}</span>
          <span>{staffName}</span>
        </div>
      )}
    </div>
  );
}
