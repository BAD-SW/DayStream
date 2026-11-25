import i18n, { currentLocale } from '../../i18n';
import { formatDate, formatTime } from '../../utils/format';

/** Money is stored as integer cents throughout DayStream — never floats (see CLAUDE.md). */
export function formatMoney(cents: number, currency = 'EUR'): string {
  return new Intl.NumberFormat(currentLocale(), { style: 'currency', currency }).format(cents / 100);
}

/** "45 min", "1 h" or "1 h 30 min", in the language shown. */
export function formatDuration(minutes: number): string {
  if (minutes < 60) return i18n.t('widget:duration.minutes', { minutes });
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0
    ? i18n.t('widget:duration.hours', { hours })
    : i18n.t('widget:duration.hoursMinutes', { hours, minutes: rest });
}

/** A day ("2026-11-24") as a short weekday, month and day. */
export function formatDayLabel(dateStr: string): string {
  return formatDate(new Date(`${dateStr}T00:00:00`), { weekday: 'short', month: 'short', day: 'numeric' });
}

export function formatTimeLabel(isoString: string): string {
  return formatTime(isoString);
}
