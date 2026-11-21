import { test } from 'node:test';
import assert from 'node:assert/strict';

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

function response(refreshAfterMs = 5000) {
  return Response.json({ schemaVersion: 1, refreshAfterMs, fetchedAt: new Date().toISOString(), generatedAt: new Date().toISOString(),
    timezone: 'Australia/Sydney', window: { to: '2027-11-21T00:00:00Z' }, events: [] });
}

test('a visible component rechecks without erasing cached events or its dialog', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  t.mock.method(globalThis, 'fetch', async () => response());
  const view = component(); await view.load();
  const previous = view.snapshot; assert.ok(previous);
  view.dialog.open = true; let refreshes = 0;
  view.load = () => { refreshes++; assert.equal(view.snapshot, previous); assert.equal(view.dialog.open, true); };
  t.mock.timers.tick(5000);
  assert.equal(refreshes, 1);
});

test('an old successful response is displayed rather than rejected on age', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const old = '2020-01-01T00:00:00Z';
  t.mock.method(globalThis, 'fetch', async () => Response.json({ schemaVersion: 1, generatedAt: old, fetchedAt: old,
    timezone: 'Australia/Sydney', window: { to: '2027-11-21T00:00:00Z' }, events: [] }));
  const view = component(); await view.load();
  assert.equal(view.renderCount, 1); assert.equal(view.snapshot.fetchedAt, old);
});

test('an unsuccessful recheck preserves displayed data and its dialog', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  t.mock.method(globalThis, 'fetch', async () => new Response('{}', { status: 503 }));
  const view = component(); const old = { events: [{ title: 'Cached event' }] };
  view.snapshot = old; view.dialog.open = true;
  await view.load();
  assert.equal(view.snapshot, old); assert.equal(view.dialog.open, true);
  assert.equal(view.status, undefined);
});

test('a cold failure still shows the unavailable state', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  t.mock.method(globalThis, 'fetch', async () => new Response('{}', { status: 503 }));
  const view = component(); await view.load();
  assert.equal(view.snapshot, null); assert.match(view.status, /temporarily unavailable/);
});
