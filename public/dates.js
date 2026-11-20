export function keyForDate(value, timezone) {
  const parts = new Intl.DateTimeFormat('en', {
    timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date(value));
  const p = (type) => parts.find((part) => part.type === type).value;
  return `${p('year')}-${p('month')}-${p('day')}`;
}

export function monthShift(key, delta) {
  const [year, month] = key.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1 + delta, 1));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
}

export function labelDate(key, options) {
  return new Intl.DateTimeFormat('en-AU', { ...options, timeZone: 'UTC' }).format(new Date(`${key}T12:00:00Z`));
}

export function monthDays(key) {
  const [year, month] = key.split('-').map(Number);
  const first = new Date(Date.UTC(year, month - 1, 1));
  const offset = first.getUTCDay();
  const count = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return Array.from({ length: Math.ceil((offset + count) / 7) * 7 }, (_, i) => {
    const date = new Date(Date.UTC(year, month - 1, i - offset + 1));
    return { key: date.toISOString().slice(0, 10), day: date.getUTCDate(), inMonth: date.getUTCMonth() === month - 1 };
  });
}

export function eventDates(event, timezone) {
  // All-day dates belong to the source calendar and must never shift with the viewer's timezone.
  return event.allDay ? { start: event.startDate, end: event.endDate } : {
    start: keyForDate(event.start, timezone), end: keyForDate(Math.max(Date.parse(event.start), Date.parse(event.end) - 1), timezone),
  };
}

export function timeLabel(event, timezone) {
  if (event.allDay) {
    return event.startDate === event.endDate ? 'All day' : `All day · ${labelDate(event.startDate, { day: 'numeric', month: 'short' })} – ${labelDate(event.endDate, { day: 'numeric', month: 'short' })}`;
  }
  const fmt = new Intl.DateTimeFormat('en-AU', { timeZone: timezone, hour: 'numeric', minute: '2-digit' });
  const dateFmt = new Intl.DateTimeFormat('en-AU', { timeZone: timezone, day: 'numeric', month: 'short' });
  const { start, end } = eventDates(event, timezone);
  return start === end ? `${fmt.format(new Date(event.start))} – ${fmt.format(new Date(event.end))}` :
    `${dateFmt.format(new Date(event.start))}, ${fmt.format(new Date(event.start))} – ${dateFmt.format(new Date(event.end))}, ${fmt.format(new Date(event.end))}`;
}
