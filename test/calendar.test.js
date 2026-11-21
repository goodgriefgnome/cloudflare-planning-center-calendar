import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { remainingFreshness } from '../src/freshness.js';
import { config, dateKey, safeUrl, windowBounds } from '../src/config.js';
import { normalize, plainText } from '../src/normalize.js';
import { fetchInstances, instanceUrl, UpstreamError } from '../src/pco.js';
import worker, { getFreshSnapshot, handleFetch, SNAPSHOT_KEY, sync } from '../src/worker.js';
import { eventDates, keyForDate, monthDays, monthShift, timeLabel } from '../public/dates.js';

const now = new Date('2026-11-21T00:00:00Z');
const bounds = { from: now.toISOString(), to: '2027-11-21T00:00:00Z', timezone: 'Australia/Sydney' };

function fixture() {
  const event = { type: 'Event', id: 'event-1', attributes: { visible_in_church_center: true, link_only: false, approval_status: 'A', summary: 'Public summary', registration_url: 'https://example.org/register', internal_note: 'Secret' } };
  const time = { type: 'EventTime', id: 'time-1', attributes: { starts_at: '2026-11-22T23:00:00Z', ends_at: '2026-11-23T00:00:00Z', visible_on_widget_and_ical: true } };
  const instance = { type: 'EventInstance', id: 'instance-1', attributes: {
    kind: 'standard', canceled: false, all_day_event: false, name: 'Sunday gathering', location: 'Church',
    description: '<p>Hello &amp; welcome</p><p>Details</p>',
    starts_at: '2026-11-22T20:00:00Z', ends_at: '2026-11-23T03:00:00Z',
    church_center_url: 'https://example.org/event', image_url: 'javascript:alert(1)',
    internal_note: 'Do not publish',
  }, relationships: { event: { data: { type: event.type, id: event.id } }, event_times: { data: [{ type: time.type, id: time.id }] } } };
  return { instances: [instance], included: new Map([[`${event.type}:${event.id}`, event], [`${time.type}:${time.id}`, time]]), event, time, instance };
}

test('publishes occurrence overrides and public times, excluding private fields and unsafe URLs', () => {
  const result = normalize(fixture(), bounds);
  assert.equal(result.events.length, 1);
  const event = result.events[0];
  assert.equal(event.start, '2026-11-22T23:00:00.000Z');
  assert.equal(event.startDate, '2026-11-23');
  assert.equal(event.description, 'Hello & welcome\nDetails');
  assert.equal(event.imageUrl, null);
  assert.equal(event.internal_note, undefined);
  assert.equal(event.title, 'Sunday gathering');
});

for (const [attribute, value] of [['visible_in_church_center', false], ['link_only', true], ['link_only', undefined], ['approval_status', 'P'], ['approval_status', 'R']]) {
  test(`excludes event with ${attribute}=${value}`, () => {
    const f = fixture(); f.event.attributes[attribute] = value;
    assert.equal(normalize(f, bounds).events.length, 0);
  });
}
for (const [attribute, value] of [['canceled', true], ['canceled', undefined], ['kind', 'blockout']]) {
  test(`excludes occurrence with ${attribute}=${value}`, () => {
    const f = fixture(); f.instance.attributes[attribute] = value;
    assert.equal(normalize(f, bounds).events.length, 0);
  });
}

test('restricted/missing event and time resources fail closed', () => {
  const f = fixture(); f.included.delete('Event:event-1');
  assert.equal(normalize(f, bounds).events.length, 0);
  const g = fixture(); g.included.delete('EventTime:time-1');
  assert.equal(normalize(g, bounds).events.length, 0);
});

test('no raw booking-time fallback when no public times exist', () => {
  const f = fixture(); f.time.attributes.visible_on_widget_and_ical = false;
  assert.equal(normalize(f, bounds).events.length, 0);
  f.instance.attributes.published_starts_at = '10:00am';
  f.instance.attributes.published_ends_at = '11:00am';
  assert.equal(normalize(f, bounds).events.length, 0);
  f.instance.attributes.published_starts_at = '2026-11-23T10:00:00+11:00';
  f.instance.attributes.published_ends_at = '2026-11-23T11:00:00+11:00';
  assert.equal(normalize(f, bounds).events.length, 1);
});

test('handles all-day exclusive end dates without shifting local dates', () => {
  const f = fixture(); f.instance.attributes.all_day_event = true;
  f.time.attributes.starts_at = '2026-11-22T13:00:00Z';
  f.time.attributes.ends_at = '2026-11-24T13:00:00Z';
  const event = normalize(f, bounds).events[0];
  assert.equal(event.startDate, '2026-11-23');
  assert.equal(event.endDate, '2026-11-24');
  assert.deepEqual(eventDates(event, 'America/Los_Angeles'), { start: '2026-11-23', end: '2026-11-24' });
});

test('keeps ongoing events, removes outside-window events, deduplicates IDs', () => {
  const f = fixture(); f.instances.push(f.instance);
  assert.equal(normalize(f, bounds).events.length, 1);
  assert.equal(normalize(f, { ...bounds, from: '2026-11-22T23:30:00Z' }).events.length, 1);
  assert.equal(normalize(f, { ...bounds, from: '2026-11-24T00:00:00Z' }).events.length, 0);
});

test('HTML becomes bounded plain text; URL policy excludes executable and credential URLs', () => {
  assert.equal(plainText('<script>alert(1)</script><b>Text</b> &lt;b&gt;'), 'Text <b>');
  assert.equal(plainText('a'.repeat(500), 10).length, 10);
  for (const url of ['javascript:alert(1)', 'data:image/svg+xml,hi', 'http://example.org', 'https://user:pass@example.org']) assert.equal(safeUrl(url), null);
  assert.equal(safeUrl('https://example.org'), 'https://example.org/');
});

test('Sydney daylight saving, year rollover, leap-day windows and month grid', () => {
  assert.equal(dateKey('2026-10-03T14:30:00Z', 'Australia/Sydney'), '2026-10-04');
  assert.equal(keyForDate('2026-12-31T13:30:00Z', 'Australia/Sydney'), '2027-01-01');
  const label = timeLabel({ start: '2026-10-03T15:30:00Z', end: '2026-10-03T16:30:00Z', allDay: false }, 'Australia/Sydney');
  assert.match(label, /1:30.*3:30/);
  assert.equal(windowBounds(new Date('2028-02-29T12:00:00Z')).to, '2029-02-28T12:00:00.000Z');
  assert.equal(monthShift('2026-12', 1), '2027-01');
  assert.equal(monthDays('2028-02').filter((d) => d.inMonth).length, 29);
});

const secrets = { PCO_APPLICATION_ID: 'test-id', PCO_SECRET: 'test-secret' };
function page(data, next = null, included = []) {
  return Response.json({ data, included, links: { next } });
}

test('fetches every page, joins included data, sends auth and explicit version', async () => {
  const f = fixture(); const calls = [];
  const result = await fetchInstances(secrets, bounds.from, bounds.to, { fetcher: async (url, options) => {
    calls.push([url, options]);
    return calls.length === 1 ? page(f.instances, 'https://api.planningcenteronline.com/calendar/v2/event_instances?offset=100', [f.event]) : page([], null, [f.time]);
  } });
  assert.equal(result.pages, 2); assert.equal(result.included.size, 2);
  assert.equal(calls[0][1].headers.Authorization, `Basic ${btoa('test-id:test-secret')}`);
  assert.equal(calls[0][1].headers['X-PCO-API-Version'], '2026-06-22');
  assert.equal(calls[0][1].redirect, 'error');
  assert.match(instanceUrl(bounds.from, bounds.to), /fields%5BEventInstance%5D/);
});

test('never follows pagination to another origin or sends it credentials', async () => {
  let calls = 0;
  await assert.rejects(fetchInstances(secrets, bounds.from, bounds.to, { fetcher: async () => {
    calls++; return page([], 'https://attacker.example/calendar/v2/events');
  } }), /Unexpected Planning Center/);
  assert.equal(calls, 1);
});

test('detects pagination cycles rather than publishing a truncated snapshot', async () => {
  const start = instanceUrl(bounds.from, bounds.to);
  await assert.rejects(fetchInstances(secrets, bounds.from, bounds.to, { fetcher: async () => page([], start) }), /Pagination is incomplete/);
});

test('honours Retry-After and gives up with a bounded retry count', async () => {
  let calls = 0; const waits = [];
  await fetchInstances(secrets, bounds.from, bounds.to, {
    fetcher: async () => ++calls === 1 ? new Response('', { status: 429, headers: { 'Retry-After': '3' } }) : page([]),
    sleep: async (ms) => waits.push(ms),
  });
  assert.deepEqual(waits, [3000]);
  calls = 0;
  await assert.rejects(fetchInstances(secrets, bounds.from, bounds.to, {
    fetcher: async () => { calls++; return new Response('', { status: 503 }); }, sleep: async () => {},
  }), UpstreamError);
  assert.equal(calls, 4);
});

function memoryKV(initial) {
  const store = new Map(initial ? [[SNAPSHOT_KEY, JSON.stringify(initial)]] : []);
  return {
    store,
    async get(key, type) { const value = store.get(key); return value ? type === 'json' ? JSON.parse(value) : value : null; },
    async put(key, value) { store.set(key, value); }, async delete(key) { store.delete(key); },
  };
}
function environment(snapshot) {
  return { ...secrets, CALENDAR: memoryKV(snapshot), ALLOWED_ORIGINS: 'https://www.example.org', TIMEZONE: 'Australia/Sydney' };
}
function freshSnapshot() { return { schemaVersion: 1, generatedAt: new Date().toISOString(), events: [], timezone: 'Australia/Sydney', window: bounds }; }

test('sync replaces deleted/hidden events with a complete new snapshot', async () => {
  const env = environment({ ...freshSnapshot(), events: [{ id: 'old-event' }] });
  await sync(env, { now, fetcher: async () => page([]) });
  assert.deepEqual((await env.CALENDAR.get(SNAPSHOT_KEY, 'json')).events, []);
});

test('failed second page preserves previous snapshot; auth failure invalidates it', async () => {
  const old = freshSnapshot(); const env = environment(old); let calls = 0;
  await assert.rejects(sync(env, { now, fetcher: async () => {
    calls++; return calls === 1 ? page([], 'https://api.planningcenteronline.com/calendar/v2/event_instances?offset=100') : new Response('', { status: 400 });
  } }));
  assert.deepEqual(await env.CALENDAR.get(SNAPSHOT_KEY, 'json'), old);
  await assert.rejects(sync(env, { now, fetcher: async () => new Response('', { status: 403 }) }));
  assert.equal(await env.CALENDAR.get(SNAPSHOT_KEY, 'json'), null);
});

test('API allows configured origins and rejects others without permissive CORS', async () => {
  const env = environment(freshSnapshot());
  const allowed = await handleFetch(new Request('https://calendar.example.org/api/events', { headers: { Origin: 'https://www.example.org' } }), env);
  assert.equal(allowed.status, 200); assert.equal(allowed.headers.get('Access-Control-Allow-Origin'), 'https://www.example.org');
  assert.equal(allowed.headers.get('Vary'), 'Origin');
  const denied = await handleFetch(new Request('https://calendar.example.org/api/events', { headers: { Origin: 'https://attacker.example' } }), env);
  assert.equal(denied.status, 403); assert.equal(denied.headers.get('Access-Control-Allow-Origin'), null);
  const sameOrigin = await handleFetch(new Request('https://calendar.example.org/api/events'), env);
  assert.equal(sameOrigin.status, 200);
});

test('API refreshes expired data before responding and does not cache responses', async () => {
  const request = new Request('https://calendar.example.org/api/events');
  const stale = { ...freshSnapshot(), generatedAt: new Date(Date.now() - 900_000).toISOString() };
  const env = environment(stale); let calls = 0;
  const response = await handleFetch(request, env, { fetcher: async () => { calls++; return page([]); } });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('Cache-Control'), 'no-store');
  const data = await response.json();
  assert.ok(data.freshForMs > 0 && data.freshForMs <= 900_000);
  assert.notEqual(data.generatedAt, stale.generatedAt);
  assert.equal(calls, 1);
  const cached = await handleFetch(request, env, { fetcher: async () => { throw new Error('Unexpected refresh'); } });
  assert.equal(cached.status, 200);
});

test('API never serves an expired snapshot on refresh failure', async () => {
  const env = environment({ ...freshSnapshot(), generatedAt: new Date(Date.now() - 901_000).toISOString(), events: [{ title: 'Expired event' }] });
  const response = await handleFetch(new Request('https://calendar.example.org/api/events'), env, { fetcher: async () => new Response('', { status: 400 }) });
  assert.equal(response.status, 503);
  assert.equal(response.headers.get('Cache-Control'), 'no-store');
  assert.equal(response.headers.get('Retry-After'), '30');
  assert.equal((await response.json()).events, undefined);
});

test('cold start waits for a complete refresh', async () => {
  const env = environment(); let calls = 0;
  const response = await handleFetch(new Request('https://calendar.example.org/api/events'), env, { fetcher: async () => { calls++; return page([]); } });
  assert.equal(response.status, 200); assert.equal(calls, 1);
  assert.deepEqual((await response.json()).events, []);
});

test('simultaneous visitors in one isolate share one complete refresh', async () => {
  const env = environment(); let calls = 0; let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const options = { fetcher: async () => { calls++; await gate; return page([]); } };
  const requests = Array.from({ length: 12 }, () => getFreshSnapshot(env, options));
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(calls, 1); release();
  const snapshots = await Promise.all(requests);
  assert.ok(snapshots.every((snapshot) => snapshot === snapshots[0]));
});

test('failed refresh releases the local lock for the next visitor', async () => {
  const env = environment();
  await assert.rejects(getFreshSnapshot(env, { fetcher: async () => new Response('', { status: 400 }) }));
  const snapshot = await getFreshSnapshot(env, { fetcher: async () => page([]) });
  assert.ok(remainingFreshness(snapshot) > 0);
});

test('KV propagation cannot cause expired data to be returned after a refresh', async () => {
  const env = environment();
  env.CALENDAR.get = async () => ({ ...freshSnapshot(), generatedAt: new Date(Date.now() - 901_000).toISOString(), events: [{ title: 'Old replica' }] });
  const response = await handleFetch(new Request('https://calendar.example.org/api/events'), env, { fetcher: async () => page([]) });
  assert.equal(response.status, 200);
  assert.deepEqual((await response.json()).events, []);
});

test('health checks and preflights do not call Planning Center or refresh', async () => {
  const env = environment(); const options = { fetcher: async () => { throw new Error('Monitoring must not refresh'); } };
  const health = await handleFetch(new Request('https://calendar.example.org/health'), env, options);
  assert.equal(health.status, 503);
  const preflight = await handleFetch(new Request('https://calendar.example.org/api/events', { method: 'OPTIONS', headers: { Origin: 'https://www.example.org' } }), env, options);
  assert.equal(preflight.status, 204);
  assert.equal(await env.CALENDAR.get(SNAPSHOT_KEY, 'json'), null);
});

test('freshness expires at exactly 15 minutes and rejects future/invalid timestamps', () => {
  const timestamp = now.getTime(); const snapshot = { schemaVersion: 1, generatedAt: now.toISOString() };
  assert.equal(remainingFreshness(snapshot, timestamp), 900_000);
  assert.equal(remainingFreshness(snapshot, timestamp + 899_999), 1);
  assert.equal(remainingFreshness(snapshot, timestamp + 900_000), 0);
  assert.equal(remainingFreshness(snapshot, timestamp - 1), 0);
  assert.equal(remainingFreshness({ ...snapshot, generatedAt: 'bad' }, timestamp), 0);
});

test('time spent fetching upstream pages counts toward the snapshot age', async () => {
  let time = now.getTime();
  await assert.rejects(getFreshSnapshot(environment(), {
    clock: () => time,
    fetcher: async () => { time += 900_000; return page([]); },
  }), /SNAPSHOT_EXPIRED/);
});

test('deployment has no cron schedule or scheduled handler', () => {
  const wrangler = readFileSync(new URL('../wrangler.jsonc', import.meta.url), 'utf8');
  assert.match(wrangler, /"crons"\s*:\s*\[\s*\]/);
  assert.equal(worker.scheduled, undefined);
});

test('sample data only appears when explicitly enabled, production without snapshot fails closed', async () => {
  const request = new Request('https://calendar.example.org/api/events');
  assert.equal((await handleFetch(request, { ...environment(), PCO_APPLICATION_ID: '' })).status, 503);
  const demo = await handleFetch(request, { ...environment(), DEMO_MODE: 'true' });
  assert.equal((await demo.json()).demo, true);
});

test('asset responses permit cross-origin modules and restrict framing of standalone page', async () => {
  const env = { ...environment(), ASSETS: { fetch: async () => new Response('asset') } };
  const script = await handleFetch(new Request('https://calendar.example.org/embed.js'), env);
  assert.equal(script.headers.get('Access-Control-Allow-Origin'), '*');
  const html = await handleFetch(new Request('https://calendar.example.org/'), env);
  assert.match(html.headers.get('Content-Security-Policy'), /frame-ancestors 'self' https:\/\/www.example.org/);
  assert.equal((await handleFetch(new Request('https://calendar.example.org/.dev.vars'), env)).status, 404);
});

test('configuration rejects wildcard origins', () => {
  assert.throws(() => config({ ALLOWED_ORIGINS: '*' }));
});

test('diagnostics distinguish missing credentials, upstream HTTP errors and KV failures', async () => {
  const request = new Request('https://calendar.example.org/api/events');
  const missing = await handleFetch(request, { ...environment(), PCO_APPLICATION_ID: '' });
  assert.equal((await missing.json()).code, 'PCO_CREDENTIALS_MISSING');
  const upstream = await handleFetch(request, environment(), { fetcher: async () => new Response('private upstream body', { status: 400 }) });
  const upstreamData = await upstream.json();
  assert.equal(upstreamData.code, 'PCO_HTTP_400');
  assert.ok(!JSON.stringify(upstreamData).includes('private upstream body'));
  const missingKV = await handleFetch(request, { ...environment(), CALENDAR: undefined });
  assert.equal((await missingKV.json()).code, 'CALENDAR_BINDING_MISSING');
  const readEnv = environment();
  readEnv.CALENDAR.get = async () => { throw new Error('private exception text'); };
  const read = await handleFetch(request, readEnv);
  assert.equal((await read.json()).code, 'KV_READ_FAILED');
  const writeEnv = environment();
  writeEnv.CALENDAR.put = async () => { throw new Error('private exception text'); };
  const write = await handleFetch(request, writeEnv, { fetcher: async () => page([]) });
  assert.equal((await write.json()).code, 'KV_WRITE_FAILED');
});

test('diagnostics never expose raw network errors or arbitrary error codes', async () => {
  const request = new Request('https://calendar.example.org/api/events');
  const error = new Error('test-secret in URL or transport error'); error.code = 'test-secret';
  const response = await handleFetch(request, environment(), { fetcher: async () => { throw error; } });
  const body = await response.text();
  assert.equal(JSON.parse(body).code, 'PCO_FETCH_FAILED');
  assert.ok(!body.includes('test-secret'));
});
