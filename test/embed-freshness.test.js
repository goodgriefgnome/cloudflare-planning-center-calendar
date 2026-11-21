import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deadlinePassed, displayLifetime } from '../public/freshness.js';

test('browser deadline subtracts travel time and cannot exceed 15 minutes', () => {
  assert.equal(displayLifetime(900_000, 250), 899_650);
  assert.equal(displayLifetime(999_999, 250), 899_650);
  assert.equal(displayLifetime(150, 100), 0);
  for (const value of [undefined, NaN, Infinity, -1]) assert.equal(displayLifetime(value, 100), 0);
});

test('either monotonic or wall-clock deadline expires data, including clock jumps and suspend', () => {
  const deadline = { monotonic: 5000, wall: 10000 };
  assert.equal(deadlinePassed(deadline, 4999, 9999), false);
  assert.equal(deadlinePassed(deadline, 5000, 9000), true);
  assert.equal(deadlinePassed(deadline, 4000, 10000), true);
  assert.equal(deadlinePassed(null, 0, 0), true);
});

// These tests exercise component lifecycle without a browser. Layout and the
// native dialog's focus behaviour still need visual browser QA.
globalThis.HTMLElement = class {};
globalThis.customElements = { get() {}, define() {} };
globalThis.document = { hidden: false, baseURI: 'https://website.example/' };
const { ChurchCalendar } = await import('../public/embed.js');

function component() {
  const view = Object.create(ChurchCalendar.prototype);
  Object.assign(view, {
    isConnected: true,
    getAttribute(name) { return name === 'api-url' ? 'https://calendar.example/api/events' : null; },
    main: { querySelector() { return false; } },
    dialog: { open: false, close() { this.open = false; } },
    render() { this.renderCount = (this.renderCount || 0) + 1; },
    showStatus(text) { this.status = text; },
  });
  return view;
}

function response(freshForMs = 5000) {
  return Response.json({ schemaVersion: 1, freshForMs, generatedAt: new Date().toISOString(),
    timezone: 'Australia/Sydney', window: { to: '2027-11-21T00:00:00Z' }, events: [] });
}

test('an open component clears expired events and its dialog before requesting a replacement', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  t.mock.method(globalThis, 'fetch', async () => response());
  const view = component(); await view.load();
  assert.ok(view.snapshot); assert.equal(view.renderCount, 1);
  view.dialog.open = true;
  let refreshes = 0;
  view.load = () => { refreshes++; assert.equal(view.snapshot, null); assert.equal(view.dialog.open, false); };
  t.mock.timers.tick(5000);
  assert.equal(refreshes, 1);
});

test('a response expired in transit is not rendered', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  t.mock.method(globalThis, 'fetch', async () => response(1));
  const view = component(); await view.load();
  assert.equal(view.renderCount, undefined); assert.equal(view.snapshot, null);
  assert.match(view.status, /temporarily unavailable/);
});

test('unsuccessful refresh clears data instead of falling back to old results', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  t.mock.method(globalThis, 'fetch', async () => new Response('{}', { status: 503 }));
  const view = component(); view.snapshot = { events: [{ title: 'Old' }] }; view.dialog.open = true;
  await view.load();
  assert.equal(view.snapshot, null); assert.equal(view.dialog.open, false);
  assert.match(view.status, /temporarily unavailable/);
});
