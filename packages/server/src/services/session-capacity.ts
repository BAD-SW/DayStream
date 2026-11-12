/**
 * Shared rooms (CAL-17, 11 Nov 2026): sessions can start at any time (one person 13:00–14:00,
 * another 13:30–14:30). The places taken are the most people in the room at the same moment
 * during the new booking's time, whatever their start times.
 * Group sessions (a class with a set start) still count only the bookings at the same start.
 */
export function peakParticipants(
  bookings: Array<{ start_time: string | Date; end_time: string | Date; participant_count?: number | null }>,
  start: Date,
  end: Date,
): number {
  const s = start.getTime(); const e = end.getTime();
  const overlapping = bookings
    .map((b) => ({ a: new Date(b.start_time).getTime(), z: new Date(b.end_time).getTime(), n: b.participant_count || 1 }))
    .filter((b) => b.a < e && b.z > s);
  if (!overlapping.length) return 0;
  // The count only changes where a booking starts, so the peak is at one of those moments (or at the window start)
  const points = [s, ...overlapping.map((b) => b.a).filter((a) => a > s && a < e)];
  let peak = 0;
  for (const t of points) {
    const n = overlapping.filter((b) => b.a <= t && b.z > t).reduce((x, b) => x + b.n, 0);
    if (n > peak) peak = n;
  }
  return peak;
}
