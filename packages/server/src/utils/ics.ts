/**
 * A calendar invite (.ics) for one appointment, and the "add to calendar" links that go with it
 * (spec 51, gap 3). The invite is attached to the appointment email when the business's template
 * uses the Add to Calendar placeholder; the Google and Outlook links need no attachment.
 */
export interface CalendarEvent {
  /** Stable id, so adding it twice updates the entry instead of duplicating it. */
  uid: string;
  title: string;
  start: string;   // ISO timestamp
  end: string;     // ISO timestamp
  description?: string;
  location?: string;
}

const pad = (n: number) => String(n).padStart(2, '0');
/** 20261111T144500Z */
function utcStamp(iso: string): string {
  const d = new Date(iso);
  return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`;
}

/** Escapes a text value for an iCalendar property. */
function icsText(v: string): string {
  return v.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
}

/** Lines longer than 75 characters are folded, as the format requires. */
function fold(line: string): string {
  const out: string[] = [];
  let rest = line;
  while (rest.length > 74) { out.push(rest.slice(0, 74)); rest = ` ${rest.slice(74)}`; }
  out.push(rest);
  return out.join('\r\n');
}

export function buildIcs(ev: CalendarEvent): string {
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//DayStream//Appointments//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:${ev.uid}@daystream`,
    `DTSTAMP:${utcStamp(new Date().toISOString())}`,
    `DTSTART:${utcStamp(ev.start)}`,
    `DTEND:${utcStamp(ev.end)}`,
    `SUMMARY:${icsText(ev.title)}`,
    ...(ev.description ? [`DESCRIPTION:${icsText(ev.description)}`] : []),
    ...(ev.location ? [`LOCATION:${icsText(ev.location)}`] : []),
    'END:VEVENT',
    'END:VCALENDAR',
  ];
  return `${lines.map(fold).join('\r\n')}\r\n`;
}

const attr = (s: string) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** The Google and Outlook links and a note about the attached invite, as one line of HTML. */
export function calendarLinksHtml(ev: CalendarEvent): string {
  const q = encodeURIComponent;
  const google = `https://calendar.google.com/calendar/render?action=TEMPLATE&text=${q(ev.title)}&dates=${utcStamp(ev.start)}/${utcStamp(ev.end)}`
    + `${ev.description ? `&details=${q(ev.description)}` : ''}${ev.location ? `&location=${q(ev.location)}` : ''}`;
  const outlook = `https://outlook.live.com/calendar/0/deeplink/compose?path=${q('/calendar/action/compose')}&rru=addevent&subject=${q(ev.title)}`
    + `&startdt=${q(new Date(ev.start).toISOString())}&enddt=${q(new Date(ev.end).toISOString())}`
    + `${ev.description ? `&body=${q(ev.description)}` : ''}${ev.location ? `&location=${q(ev.location)}` : ''}`;
  return `<span>Add to calendar: <a href="${attr(google)}">Google</a> · <a href="${attr(outlook)}">Outlook</a> · Apple Calendar and others: open the attached invite.ics</span>`;
}

/** Marker the sender looks for to know the template used the Add to Calendar placeholder. */
export const CALENDAR_LINKS_MARKER = 'calendar.google.com/calendar/render';
