import './DayPicker.css';

export type DayStatus = 'available' | 'unavailable' | 'closed';

interface DayPickerProps {
  dayStatuses: Record<string, DayStatus>;
  viewedMonth: string; // YYYY-MM
  onMonthChange: (month: string) => void;
  onDaySelect: (date: string) => void;
  loading?: boolean;
  error?: string | null;
  onRetry?: () => void;
}

const WEEKDAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** Maps a day's status to the CSS variable that colours its cell. */
export function statusCssVar(status: DayStatus | undefined): string {
  if (status === 'available') return 'var(--color-success)';
  if (status === 'closed') return 'var(--color-error)';
  return 'var(--color-border)'; // unavailable, or no data yet
}

export function todayStr(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function currentMonthStr(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

/** A date (YYYY-MM-DD) is "past" if it's before today's date in the browser's local timezone. */
export function isPastDay(date: string, today: string = todayStr()): boolean {
  return date < today;
}

export function shiftMonth(month: string, delta: number): string {
  const [year, mon] = month.split('-').map(Number);
  const d = new Date(year, mon - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function monthLabel(month: string): string {
  const [year, mon] = month.split('-').map(Number);
  return new Date(year, mon - 1, 1).toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
}

function buildGridCells(viewedMonth: string): Array<string | null> {
  const [year, mon] = viewedMonth.split('-').map(Number);
  const leading = new Date(year, mon - 1, 1).getDay(); // 0=Sun
  const daysInMonth = new Date(year, mon, 0).getDate();
  const cells: Array<string | null> = [];
  for (let i = 0; i < leading; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(`${year}-${String(mon).padStart(2, '0')}-${String(d).padStart(2, '0')}`);
  return cells;
}

export function DayPicker({ dayStatuses, viewedMonth, onMonthChange, onDaySelect, loading, error, onRetry }: DayPickerProps) {
  const today = todayStr();
  const prevDisabled = viewedMonth <= currentMonthStr();
  const cells = buildGridCells(viewedMonth);

  return (
    <div className="day-picker">
      <div className="day-picker__header">
        <button
          type="button"
          className="day-picker__nav"
          disabled={prevDisabled || loading}
          onClick={() => onMonthChange(shiftMonth(viewedMonth, -1))}
          aria-label="Previous month"
        >
          ‹
        </button>
        <span className="day-picker__month-label">{monthLabel(viewedMonth)}</span>
        <button
          type="button"
          className="day-picker__nav"
          disabled={loading}
          onClick={() => onMonthChange(shiftMonth(viewedMonth, 1))}
          aria-label="Next month"
        >
          ›
        </button>
      </div>

      {error ? (
        <div className="day-picker__error">
          <p className="day-picker__error-message">{error}</p>
          {onRetry && (
            <button type="button" className="day-picker__retry" onClick={onRetry}>Retry</button>
          )}
        </div>
      ) : (
        <div className="day-picker__body">
          <div className="day-picker__weekdays">
            {WEEKDAY_LABELS.map((w) => <span key={w} className="day-picker__weekday">{w}</span>)}
          </div>
          <div className="day-picker__grid">
            {cells.map((date, idx) => {
              if (!date) return <span key={`blank-${idx}`} className="day-picker__cell day-picker__cell--blank" />;
              const status = dayStatuses[date];
              const past = isPastDay(date, today);
              const disabled = past || !!loading || status !== 'available';
              return (
                <button
                  key={date}
                  type="button"
                  className={`day-picker__cell${past ? ' day-picker__cell--past' : ''}`}
                  style={{ backgroundColor: statusCssVar(status) } as React.CSSProperties}
                  disabled={disabled}
                  aria-disabled={disabled}
                  data-status={status ?? 'unknown'}
                  onClick={() => { if (!disabled) onDaySelect(date); }}
                >
                  {Number(date.slice(-2))}
                </button>
              );
            })}
          </div>
          {loading && (
            <div className="day-picker__loading-overlay" role="status" aria-label="Loading availability">
              <span className="day-picker__spinner" />
            </div>
          )}
        </div>
      )}
    </div>
  );
}
