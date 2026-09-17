import { useEffect, useMemo, useState } from 'react';
import { DayStatus, getAvailabilityDays, WidgetApiError } from '../../api/widget';

interface Props {
  businessId: string;
  serviceId: string;
  variantId: string;
  selectedDate: string | null;
  onSelectDate: (date: string) => void;
  onBack: () => void;
}

function currentMonth(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

function shiftMonth(month: string, delta: number): string {
  const [year, mon] = month.split('-').map(Number);
  const d = new Date(Date.UTC(year, mon - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

function monthLabel(month: string): string {
  const [year, mon] = month.split('-').map(Number);
  return new Date(Date.UTC(year, mon - 1, 1)).toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
}

const minSelectableMonth = currentMonth();

export function AvailabilityCalendarStep({ businessId, serviceId, variantId, selectedDate, onSelectDate, onBack }: Props) {
  const [month, setMonth] = useState(currentMonth());
  const [days, setDays] = useState<Record<string, DayStatus> | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    getAvailabilityDays(businessId, serviceId, variantId, month)
      .then((res) => { if (!cancelled) setDays(res.days); })
      .catch((err: WidgetApiError) => { if (!cancelled) setError(err.message); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [businessId, serviceId, variantId, month]);

  const cells = useMemo(() => {
    if (!days) return [];
    const dates = Object.keys(days).sort();
    if (dates.length === 0) return [];
    const firstWeekday = new Date(`${dates[0]}T00:00:00`).getDay();
    return [...Array(firstWeekday).fill(null), ...dates];
  }, [days]);

  return (
    <div className="dsw-step">
      <h2 className="dsw-step-title">Choose a date</h2>

      <div className="dsw-calendar-nav">
        <button
          type="button"
          className="dsw-btn dsw-btn--ghost"
          disabled={month <= minSelectableMonth}
          onClick={() => setMonth((m) => shiftMonth(m, -1))}
        >
          ‹
        </button>
        <span className="dsw-calendar-month">{monthLabel(month)}</span>
        <button type="button" className="dsw-btn dsw-btn--ghost" onClick={() => setMonth((m) => shiftMonth(m, 1))}>›</button>
      </div>

      {loading && <p className="dsw-step-text">Loading availability…</p>}
      {error && <p className="dsw-step-error">{error}</p>}

      {!loading && !error && (
        <div className="dsw-calendar-grid">
          {['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((d, i) => (
            <div key={`h-${i}`} className="dsw-calendar-weekday">{d}</div>
          ))}
          {cells.map((date, i) => {
            if (!date) return <div key={`blank-${i}`} />;
            const status = days?.[date];
            const isSelectable = status === 'available';
            return (
              <button
                type="button"
                key={date}
                disabled={!isSelectable}
                className={[
                  'dsw-calendar-day',
                  isSelectable ? 'dsw-calendar-day--available' : 'dsw-calendar-day--disabled',
                  selectedDate === date ? 'dsw-calendar-day--selected' : '',
                ].join(' ')}
                onClick={() => onSelectDate(date)}
              >
                {Number(date.slice(-2))}
              </button>
            );
          })}
        </div>
      )}

      <button type="button" className="dsw-btn dsw-btn--ghost" onClick={onBack}>Back</button>
    </div>
  );
}
