import { decodeHTML } from 'entities';
import { dateKey, safeUrl } from './config.js';

export function plainText(value, max = 16000) {
  if (typeof value !== 'string') return '';
  // This output is always rendered using textContent, never interpreted as HTML.
  return decodeHTML(value.replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, '')
    .replace(/<\s*br\s*\/?\s*>/gi, '\n').replace(/<\/(p|div|li|h[1-6])\s*>/gi, '\n')
    .replace(/<[^>]*>/g, '')).replace(/\r/g, '').replace(/\n{3,}/g, '\n\n').trim().slice(0, max);
}

function timestamp(value) {
  // Require an explicit offset. Date-only and locale-formatted public strings are not instants.
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/.test(value)) return null;
  const time = Date.parse(value);
  return Number.isFinite(time) ? time : null;
}

function lookup(ref, included, type) {
  return ref?.type === type ? included.get(`${type}:${ref.id}`) : null;
}

export function normalize({ instances, included }, { from, to, timezone }) {
  const events = new Map();
  let skipped = 0;
  for (const instance of instances) {
    const a = instance.attributes || {};
    const event = lookup(instance.relationships?.event?.data, included, 'Event');
    const e = event?.attributes;
    if (instance.type !== 'EventInstance' || !e || e.visible_in_church_center !== true || e.link_only !== false ||
        e.approval_status !== 'A' || a.kind !== 'standard' || a.canceled !== false || typeof a.all_day_event !== 'boolean') {
      skipped++; continue;
    }
    const timeRefs = instance.relationships?.event_times?.data;
    const times = Array.isArray(timeRefs) ? timeRefs.map((r) => lookup(r, included, 'EventTime')) : [];
    // A missing referenced time could hide an incomplete public schedule: fail closed.
    if (times.some((time) => !time)) { skipped++; continue; }
    const publicTimes = times.filter((time) => time.attributes?.visible_on_widget_and_ical === true);
    let start, end;
    if (publicTimes.length) {
      const ranges = publicTimes.map(({ attributes: t }) => [timestamp(t.starts_at), timestamp(t.ends_at)]);
      if (ranges.some(([s, f]) => s === null || f === null || f < s)) { skipped++; continue; }
      start = Math.min(...ranges.map(([s]) => s));
      end = Math.max(...ranges.map(([, f]) => f));
    } else {
      // Never fall back to starts_at/ends_at: those can expose setup and teardown.
      start = timestamp(a.published_starts_at);
      end = timestamp(a.published_ends_at);
    }
    if (start === null || end === null || end < start || end < Date.parse(from) || start >= Date.parse(to)) { skipped++; continue; }
    const title = plainText(a.name, 300);
    if (!title) { skipped++; continue; }
    const tags = (instance.relationships?.tags?.data || []).map((ref) => lookup(ref, included, 'Tag'))
      .filter(Boolean).map((tag) => ({ id: String(tag.id), name: plainText(tag.attributes?.name, 100) }));
    events.set(String(instance.id), {
      id: String(instance.id), eventId: String(event.id), title,
      start: new Date(start).toISOString(), end: new Date(end).toISOString(),
      allDay: a.all_day_event,
      // End dates are exclusive for all-day schedules; make the display date inclusive.
      startDate: dateKey(start, timezone), endDate: dateKey(Math.max(start, end - 1), timezone),
      location: plainText(a.location, 1000),
      description: plainText(a.description) || plainText(e.summary),
      recurrence: plainText(a.recurrence_description, 500),
      imageUrl: safeUrl(a.image_url), detailsUrl: safeUrl(a.church_center_url),
      registrationUrl: safeUrl(e.registration_url), tags,
    });
  }
  return { events: [...events.values()].sort((a, b) => a.start.localeCompare(b.start) || a.id.localeCompare(b.id)), skipped };
}
