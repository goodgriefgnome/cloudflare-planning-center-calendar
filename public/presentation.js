import { eventDates, keyForDate, labelDate } from './dates.js';

function clockParts(value, timezone) {
  const parts = new Intl.DateTimeFormat('en-AU', {
    timeZone: timezone, hour: 'numeric', minute: '2-digit', hour12: true,
  }).formatToParts(new Date(value));
  const get = (type) => parts.find((part) => part.type === type)?.value || '';
  return { clock: `${get('hour')}${get('minute') === '00' ? '' : `:${get('minute')}`}`, period: get('dayPeriod').toLowerCase() };
}

function shortDate(key, reference) {
  return labelDate(key, { day: 'numeric', month: 'short', ...(key.slice(0, 4) !== reference.slice(0, 4) ? { year: 'numeric' } : {}) });
}

function zoneName(value, timezone) {
  return new Intl.DateTimeFormat('en-AU', { timeZone: timezone, timeZoneName: 'short' })
    .formatToParts(new Date(value)).find((part) => part.type === 'timeZoneName').value;
}

export function timeLabel(event, timezone) {
  if (event.allDay) return event.startDate === event.endDate ? '' : `until ${shortDate(event.endDate, event.startDate)}`;
  const start = keyForDate(event.start, timezone), end = keyForDate(event.end, timezone);
  const a = clockParts(event.start, timezone), b = clockParts(event.end, timezone);
  const aFull = a.clock + a.period, bFull = b.clock + b.period;
  const duration = Date.parse(event.end) - Date.parse(event.start);
  if (duration >= 0 && duration <= 60_000) return `at ${aFull}`;
  if (start === end) {
    // A repeated wall-clock hour during daylight-saving changes is still a range.
    if (aFull === bFull && zoneName(event.start, timezone) !== zoneName(event.end, timezone)) {
      return `${aFull} ${zoneName(event.start, timezone)}–${bFull} ${zoneName(event.end, timezone)}`;
    }
    return `${a.clock}${a.period === b.period ? '' : a.period}–${bFull}`;
  }
  const days = (Date.parse(`${end}T12:00:00Z`) - Date.parse(`${start}T12:00:00Z`)) / 86400_000;
  return days === 1 ? `${aFull}–${bFull} next day` : `${aFull} · until ${shortDate(end, start)}, ${bFull}`;
}

export function recurrenceLabel(value) {
  if (typeof value !== 'string') return '';
  // Non-recurring occurrences also have a prose schedule in this API field.
  // Only pattern descriptions belong in the subtitle; dates already have headings.
  const pattern = value.trim();
  if (!/^(?:every\b|(?:the\s+)?(?:first|second|third|fourth|fifth|last)\b|daily\b|weekly\b|monthly\b|yearly\b|annually\b|weekdays\b|weekends\b)/i.test(pattern)) return '';
  const label = pattern.replace(/\s+(?:beginning|starting)\b.*$/i, '')
    .replace(/\s+(?:from|at)\s+.*$/i, '').replace(/^the\s+/i, '')
    .replace(/\s+of every month$/i, ' of each month').trim();
  return label ? label[0].toUpperCase() + label.slice(1) : '';
}

export function eventSubtitle(event, timezone) {
  return [timeLabel(event, timezone), recurrenceLabel(event.recurrence)].filter(Boolean).join(' · ');
}

export function eventDetailsLabel(event, timezone) {
  const { start, end } = eventDates(event, timezone);
  const fullDate = (key) => labelDate(key, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  if (event.allDay) return start === end ? fullDate(start) : `${fullDate(start)} – ${fullDate(end)}`;
  // timeLabel already supplies the end date for multi-day ranges.
  const time = timeLabel(event, timezone);
  return `${fullDate(start)}${time.startsWith('at ') ? ` ${time}` : ` · ${time}`}`;
}

function comparable(value) {
  return String(value || '').normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}

export function additionalDescription(event, timezone) {
  const description = typeof event.description === 'string' ? event.description.trim() : '';
  const text = comparable(description);
  if (!text) return '';
  const alreadyShown = [event.title, event.location, event.registrationUrl, event.recurrence,
    timeLabel(event, timezone), recurrenceLabel(event.recurrence), eventSubtitle(event, timezone), eventDetailsLabel(event, timezone)];
  return alreadyShown.some((value) => comparable(value) === text) ? '' : description;
}
