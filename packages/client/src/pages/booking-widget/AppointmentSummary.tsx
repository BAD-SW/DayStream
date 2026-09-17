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
  return (
    <div className="dsw-summary dsw-summary--stacked">
      <div className="dsw-confirmation-row">
        <span className="dsw-label">Service</span>
        <span>{productName}</span>
      </div>
      <div className="dsw-confirmation-row">
        <span className="dsw-label">When</span>
        <span>{formatDayLabel(startTime.slice(0, 10))} · {formatTimeLabel(startTime)}</span>
      </div>
      {locationName && (
        <div className="dsw-confirmation-row">
          <span className="dsw-label">Location</span>
          <span>{locationName}</span>
        </div>
      )}
      {staffName && (
        <div className="dsw-confirmation-row">
          <span className="dsw-label">With</span>
          <span>{staffName}</span>
        </div>
      )}
    </div>
  );
}
