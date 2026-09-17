import { useEffect, useMemo, useState } from 'react';
import { getAvailabilitySlots, WidgetApiError, WidgetAvailabilityCombo } from '../../api/widget';
import { formatDayLabel, formatTimeLabel } from './format';

interface Props {
  businessId: string;
  serviceId: string;
  variantId: string;
  date: string;
  expiredNotice: boolean;
  onSelectSlot: (combo: WidgetAvailabilityCombo) => void;
  onBack: () => void;
}

/**
 * Mirrors BookingCreate.tsx's (admin) location/staff filter logic exactly, against the
 * same combinations endpoint — a location/staff filter row only renders when there's an
 * actual choice to make (more than one option); when there's exactly one, its name is
 * still shown as a resolved line so the visitor always sees who/where, even without a
 * decision to make. `location_id` is display/filtering only — it's never sent to
 * createBooking, matching how the admin flow already treats it (apt_bookings has no
 * location column; the booking is tied to staff_id, from which a location is inferable).
 */
export function TimeSlotPickerStep({ businessId, serviceId, variantId, date, expiredNotice, onSelectSlot, onBack }: Props) {
  const [combos, setCombos] = useState<WidgetAvailabilityCombo[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [selectedLocation, setSelectedLocation] = useState<string | null>(null);
  const [selectedStaff, setSelectedStaff] = useState<string | null>(null);
  const [selectedTime, setSelectedTime] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setSelectedLocation(null);
    setSelectedStaff(null);
    setSelectedTime(null);
    getAvailabilitySlots(businessId, serviceId, variantId, date, date)
      .then((res) => { if (!cancelled) setCombos(res); })
      .catch((err: WidgetApiError) => { if (!cancelled) setError(err.message); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [businessId, serviceId, variantId, date]);

  const availableLocations = useMemo(() => {
    const map = new Map<string, string>();
    (combos || [])
      .filter((c) => !selectedStaff || c.staff_id === selectedStaff)
      .forEach((c) => { if (c.location_id && c.location_name) map.set(c.location_id, c.location_name); });
    return Array.from(map.entries()).map(([id, name]) => ({ id, name }));
  }, [combos, selectedStaff]);

  const availableStaff = useMemo(() => {
    const map = new Map<string, string>();
    (combos || [])
      .filter((c) => !selectedLocation || c.location_id === selectedLocation)
      .forEach((c) => { if (c.staff_id) map.set(c.staff_id, `${c.staff_first_name} ${c.staff_last_name}`); });
    return Array.from(map.entries()).map(([id, name]) => ({ id, name }));
  }, [combos, selectedLocation]);

  const times = useMemo(() => {
    const set = new Set<string>();
    (combos || [])
      .filter((c) => (!selectedLocation || c.location_id === selectedLocation) && (!selectedStaff || c.staff_id === selectedStaff))
      .forEach((c) => set.add(c.start_time));
    return Array.from(set).sort();
  }, [combos, selectedLocation, selectedStaff]);

  const resolvedLocationName = selectedLocation
    ? availableLocations.find((l) => l.id === selectedLocation)?.name
    : availableLocations.length === 1 ? availableLocations[0].name : null;

  const resolvedStaffName = selectedStaff
    ? availableStaff.find((s) => s.id === selectedStaff)?.name
    : availableStaff.length === 1 ? availableStaff[0].name : null;

  function handleSelectTime(time: string) {
    setSelectedTime(time);
    const match = (combos || []).find((c) =>
      c.start_time === time
      && (!selectedLocation || c.location_id === selectedLocation)
      && (!selectedStaff || c.staff_id === selectedStaff));
    if (match) onSelectSlot(match);
  }

  return (
    <div className="dsw-step">
      <h2 className="dsw-step-title">Choose a time</h2>
      <p className="dsw-step-text">{formatDayLabel(date)}</p>

      {(resolvedLocationName || resolvedStaffName) && (
        <p className="dsw-step-text dsw-resolved">
          {resolvedLocationName && <span>📍 {resolvedLocationName}</span>}
          {resolvedStaffName && <span>🧑 {resolvedStaffName}</span>}
        </p>
      )}

      {expiredNotice && (
        <p className="dsw-step-notice">Your hold on the previous time slot expired. Please pick a new time.</p>
      )}

      {loading && <p className="dsw-step-text">Loading times…</p>}
      {error && <p className="dsw-step-error">{error}</p>}

      {!loading && !error && (
        <>
          {availableLocations.length > 1 && (
            <div className="dsw-filter-row">
              <span className="dsw-label">Location</span>
              <div className="dsw-filter-chips">
                <button
                  type="button"
                  className={`dsw-chip ${selectedLocation === null ? 'dsw-chip--active' : ''}`}
                  onClick={() => setSelectedLocation(null)}
                >
                  Any
                </button>
                {availableLocations.map((l) => (
                  <button
                    key={l.id}
                    type="button"
                    className={`dsw-chip ${selectedLocation === l.id ? 'dsw-chip--active' : ''}`}
                    onClick={() => setSelectedLocation(selectedLocation === l.id ? null : l.id)}
                  >
                    {l.name}
                  </button>
                ))}
              </div>
            </div>
          )}

          {availableStaff.length > 1 && (
            <div className="dsw-filter-row">
              <span className="dsw-label">Staff</span>
              <div className="dsw-filter-chips">
                <button
                  type="button"
                  className={`dsw-chip ${selectedStaff === null ? 'dsw-chip--active' : ''}`}
                  onClick={() => setSelectedStaff(null)}
                >
                  Any
                </button>
                {availableStaff.map((s) => (
                  <button
                    key={s.id}
                    type="button"
                    className={`dsw-chip ${selectedStaff === s.id ? 'dsw-chip--active' : ''}`}
                    onClick={() => setSelectedStaff(selectedStaff === s.id ? null : s.id)}
                  >
                    {s.name}
                  </button>
                ))}
              </div>
            </div>
          )}

          {times.length === 0 && <p className="dsw-step-text">No times available for this selection.</p>}

          {times.length > 0 && (
            <div className="dsw-slot-grid">
              {times.map((time) => (
                <button
                  key={time}
                  type="button"
                  className={`dsw-slot ${selectedTime === time ? 'dsw-slot--selected' : ''}`}
                  onClick={() => handleSelectTime(time)}
                >
                  {formatTimeLabel(time)}
                </button>
              ))}
            </div>
          )}
        </>
      )}

      <button type="button" className="dsw-btn dsw-btn--ghost" onClick={onBack}>Back</button>
    </div>
  );
}
