import { test } from 'node:test';
import assert from 'node:assert/strict';
import { additionalDescription, eventDetailsLabel, eventSubtitle, recurrenceLabel, timeLabel } from '../public/presentation.js';

const zone = 'Australia/Sydney';
function timed(start, end, extra = {}) {
  return { title: 'Community lunch', start: `2026-11-22T${start}:00+11:00`, end: `2026-11-22T${end}:00+11:00`, allDay: false, ...extra };
}

for (const [start, end, expected] of [
  ['18:00', '18:00', 'at 6pm'],
  ['18:00', '19:00', '6–7pm'],
  ['09:30', '11:00', '9:30–11am'],
  ['11:00', '14:00', '11am–2pm'],
  ['12:00', '13:15', '12–1:15pm'],
  ['00:00', '01:00', '12–1am'],
]) {
  test(`compact time ${start} to ${end}: ${expected}`, () => assert.equal(timeLabel(timed(start, end), zone), expected));
}

test('midnight is shown as the next day rather than an ordinary same-day range', () => {
  const event = timed('23:00', '00:00', { end: '2026-11-23T00:00:00+11:00' });
  assert.equal(timeLabel(event, zone), '11pm–12am next day');
});

test('longer events use only the end date in their list subtitle', () => {
  assert.equal(timeLabel(timed('18:00', '10:00', { end: '2026-11-24T10:00:00+11:00' }), zone), '6pm · until 24 Nov, 10am');
  assert.equal(timeLabel({ start: '2026-12-30T18:00:00+11:00', end: '2027-01-02T10:00:00+11:00', allDay: false }, zone), '6pm · until 2 Jan 2027, 10am');
});

test('an all-day one-off event has no subtitle, including verbose API schedule prose', () => {
  const event = { title: 'Visit from X', allDay: true, startDate: '2026-11-29', endDate: '2026-11-29',
    recurrence: 'Sunday, November 29, 2026 from start of day to end of day' };
  assert.equal(eventSubtitle(event, zone), '');
  assert.equal(eventDetailsLabel(event, zone), 'Sunday 29 November 2026');
});

test('multi-day all-day events show continuation dates and date-only details', () => {
  const event = { title: 'Retreat', allDay: true, startDate: '2026-11-22', endDate: '2026-11-24' };
  assert.equal(eventSubtitle(event, zone), 'until 24 Nov');
  assert.equal(eventDetailsLabel(event, zone), 'Sunday 22 November 2026 – Tuesday 24 November 2026');
});

test('recurrence keeps the pattern and removes duplicate times and the original start date', () => {
  assert.equal(recurrenceLabel('Every other Tuesday from 10:00am to 11:00am beginning 03/11/2026'), 'Every other Tuesday');
  assert.equal(recurrenceLabel('The second Sunday of every month from 11:30am to 2:00pm beginning 08/11/2026'), 'Second Sunday of each month');
  assert.equal(recurrenceLabel('Every Sunday from start of day to end of day'), 'Every Sunday');
  assert.equal(recurrenceLabel('Saturday, November 21, 2026 from 6:00pm to 7:00pm'), '');
  assert.equal(eventSubtitle(timed('10:00', '11:00', { recurrence: 'Every other Tuesday from 10:00am to 11:00am beginning 03/11/2026' }), zone), '10–11am · Every other Tuesday');
});

test('all-day repeating events show only the repeating pattern', () => {
  assert.equal(eventSubtitle({ allDay: true, startDate: '2026-11-22', endDate: '2026-11-22', recurrence: 'Every Sunday from start of day to end of day beginning 01/11/2026' }, zone), 'Every Sunday');
});

test('details show the full date once and compact time, including time points', () => {
  assert.equal(eventDetailsLabel(timed('11:30', '14:00'), zone), 'Sunday 22 November 2026 · 11:30am–2pm');
  assert.equal(eventDetailsLabel(timed('18:00', '18:00'), zone), 'Sunday 22 November 2026 at 6pm');
});

test('an actual range across repeated DST wall time does not become a time point', () => {
  const event = { allDay: false, start: '2026-04-04T15:30:00Z', end: '2026-04-04T16:30:00Z' };
  assert.equal(timeLabel(event, zone), '2:30am AEDT–2:30am AEST');
});

test('location, registration and image alone do not require a details panel', () => {
  const event = timed('10:00', '11:00', { location: 'Church hall', registrationUrl: 'https://example.org/register', imageUrl: 'https://example.org/image.jpg' });
  assert.equal(additionalDescription(event, zone), '');
  for (const description of ['Community lunch', '  COMMUNITY LUNCH.  ', 'Church hall', '10–11am']) {
    assert.equal(additionalDescription({ ...event, description }, zone), '');
  }
});

test('a description that adds information makes details available', () => {
  const event = timed('10:00', '11:00', { description: 'Community lunch\nBring something to share.' });
  assert.equal(additionalDescription(event, zone), event.description);
});

test('descriptions that only repeat a recurring schedule do not open details', () => {
  const event = timed('10:00', '11:00', { recurrence: 'Every other Tuesday from 10:00am to 11:00am beginning 03/11/2026' });
  for (const description of [event.recurrence, 'Every other Tuesday', '10–11am']) {
    assert.equal(additionalDescription({ ...event, description }, zone), '');
  }
});
