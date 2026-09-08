/**
 * Calendar file built by hand: the format is small, and a dependency here would
 * be a dependency in the critical path of an invitation.
 */

/** Minutes a zone is ahead of UTC at that instant. */
function offsetMinutes(instant: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(instant);

  const read = (type: Intl.DateTimeFormatPartTypes): number =>
    Number(parts.find((part) => part.type === type)?.value ?? '0');

  // `read('hour')` can be 24 for midnight in some locales; Date.UTC normalizes it.
  const asUtc = Date.UTC(
    read('year'),
    read('month') - 1,
    read('day'),
    read('hour'),
    read('minute'),
    read('second'),
  );
  return (asUtc - instant.getTime()) / 60000;
}

/**
 * Turns a wall-clock date and time at the venue into a real instant. Two passes,
 * because the offset itself depends on the instant across a DST boundary.
 */
export function wallClockToUtc(isoDate: string, time: string, timeZone: string): Date {
  const naive = new Date(`${isoDate}T${time}:00Z`).getTime();
  let guess = naive - offsetMinutes(new Date(naive), timeZone) * 60000;
  guess = naive - offsetMinutes(new Date(guess), timeZone) * 60000;
  return new Date(guess);
}

function stamp(date: Date): string {
  return `${date.toISOString().replace(/[-:]/g, '').split('.')[0] ?? ''}Z`;
}

function escapeText(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/;/g, '\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
}

/** iCalendar limits a line to 75 octets; continuations start with a space. */
function fold(line: string): string {
  const bytes = Buffer.from(line, 'utf8');
  if (bytes.length <= 75) return line;

  const chunks: string[] = [];
  let start = 0;
  while (start < bytes.length) {
    let end = Math.min(start + (start === 0 ? 75 : 74), bytes.length);
    // Never split a multi-byte character — Arabic would come out as mojibake.
    while (end > start && end < bytes.length && (bytes[end] ?? 0) >= 0x80 && (bytes[end] ?? 0) < 0xc0) {
      end -= 1;
    }
    chunks.push(bytes.subarray(start, end).toString('utf8'));
    start = end;
  }
  return chunks.join('\r\n ');
}

export interface CalendarEvent {
  uid: string;
  start: Date;
  /** Invitations rarely state an end time; three hours is the honest default. */
  durationHours?: number;
  summary: string;
  description: string;
  location: string;
  url: string;
}

export function buildIcs(event: CalendarEvent): string {
  const end = new Date(event.start.getTime() + (event.durationHours ?? 3) * 60 * 60 * 1000);

  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Citas//Invitations//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:${event.uid}`,
    `DTSTAMP:${stamp(new Date())}`,
    `DTSTART:${stamp(event.start)}`,
    `DTEND:${stamp(end)}`,
    fold(`SUMMARY:${escapeText(event.summary)}`),
    fold(`DESCRIPTION:${escapeText(event.description)}`),
    fold(`LOCATION:${escapeText(event.location)}`),
    fold(`URL:${escapeText(event.url)}`),
    'END:VEVENT',
    'END:VCALENDAR',
  ];

  return `${lines.join('\r\n')}\r\n`;
}
