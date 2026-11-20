import { dateKey, windowBounds } from './config.js';

export function demoSnapshot(timezone, now = new Date()) {
  const base = new Date(now);
  base.setUTCHours(7, 0, 0, 0);
  base.setUTCDate(base.getUTCDate() + 1);
  const examples = [
    ['Community lunch', 'A shared meal and a chance to meet your neighbours.\n\nEveryone is welcome. Bring something to share if you can.', 'Community hall'],
    ['Evening concert', 'An evening of chamber music.\n\nDoors open 30 minutes before the performance.', 'Church'],
    ['Sunday gathering', 'Join us for worship, followed by refreshments.', 'Church'],
    ['Community pantry', 'A welcoming place to pick up groceries and enjoy a cup of tea.', 'Community hall'],
    ['Volunteer afternoon', 'Help prepare the garden for the coming season. All equipment is provided.', 'Church garden'],
  ];
  const events = Array.from({ length: 28 }, (_, i) => {
    const [title, description, location] = examples[i % examples.length];
    const start = new Date(base.getTime() + i * 12 * 86400_000);
    const end = new Date(start.getTime() + 90 * 60_000);
    return {
      id: `sample-${i}`, title, description, location,
      start: start.toISOString(), end: end.toISOString(),
      startDate: dateKey(start, timezone), endDate: dateKey(end, timezone),
      allDay: false, recurrence: '', imageUrl: null, registrationUrl: null, detailsUrl: null, tags: [],
    };
  });
  return { schemaVersion: 1, demo: true, generatedAt: now.toISOString(), timezone, window: windowBounds(now), events };
}
