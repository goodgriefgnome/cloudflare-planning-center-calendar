import { test } from 'node:test';
import assert from 'node:assert/strict';
import { errorInfo, logDiagnostic } from '../src/diagnostics.js';
import { fetchInstances } from '../src/pco.js';
import { handleFetch, sync } from '../src/worker.js';

const secrets = { PCO_APPLICATION_ID: 'fixture-app-id', PCO_SECRET: 'fixture-secret/+' };
const from = '2026-11-21T00:00:00Z', to = '2027-11-21T00:00:00Z';
function capture(t) {
  const records = [];
  for (const level of ['log', 'error']) t.mock.method(console, level, (record) => records.push(record));
  return records;
}
function environment() {
  return { ...secrets, CALENDAR: { get: async () => null, put: async () => {} } };
}

test('private diagnostics preserve exception details but redact credentials and authorization tokens', (t) => {
  const records = capture(t);
  const basic = btoa(`${secrets.PCO_APPLICATION_ID}:${secrets.PCO_SECRET}`);
  const error = new TypeError(`Transport failed: ${secrets.PCO_SECRET} Basic ${basic}`, { cause: new Error('connection reset') });
  logDiagnostic(secrets, { action: 'fixture', error: errorInfo(error),
    encoded: encodeURIComponent(secrets.PCO_SECRET), bearer: 'Bearer private-token', url: 'https://user:password@example.org/' }, 'error');
  assert.equal(records[0].error.name, 'TypeError');
  assert.match(records[0].error.message, /Transport failed/);
  assert.match(records[0].error.stack, /diagnostics.test.js/);
  assert.equal(records[0].error.cause.message, 'connection reset');
  const text = JSON.stringify(records);
  for (const value of [secrets.PCO_SECRET, encodeURIComponent(secrets.PCO_SECRET), basic, 'private-token', 'user:password']) {
    assert.ok(!text.includes(value), value);
  }
});

test('upstream logs contain attempts, HTTP headers, waits and pagination progress without event content', async (t) => {
  const records = capture(t); let calls = 0; const waits = [];
  await fetchInstances(secrets, from, to, { syncId: 'fixture-sync', sleep: async (ms) => waits.push(ms), fetcher: async () => {
    calls++;
    if (calls === 1) return new Response('PRIVATE RESPONSE BODY', { status: 429, headers: { 'Retry-After': '2', 'X-Request-Id': 'request-1' } });
    return Response.json({ data: [{ id: 'PRIVATE EVENT RECORD' }], included: [], links: { next: calls === 2 ? '/calendar/v2/event_instances?offset=100&secret=NEVER LOG THIS QUERY' : null } });
  } });
  assert.deepEqual(waits, [2000]);
  assert.equal(records.find((r) => r.phase === 'response').status, 429);
  assert.equal(records.find((r) => r.phase === 'response').requestId, 'request-1');
  assert.equal(records.find((r) => r.phase === 'retry').delayMs, 2000);
  assert.equal(records.find((r) => r.phase === 'request' && r.page === 2).offset, 100);
  assert.equal(records.filter((r) => r.phase === 'page_complete').at(-1).totalRecords, 2);
  assert.ok(records.every((r) => r.syncId === 'fixture-sync'));
  assert.ok(!JSON.stringify(records).includes('PRIVATE'));
  assert.ok(!JSON.stringify(records).includes('NEVER LOG'));
});

test('transport failures log the original exception and refresh stage without exposing it publicly', async (t) => {
  const records = capture(t);
  const response = await handleFetch(new Request('https://calendar.example/api/events'), environment(), {
    fetcher: async () => { throw new TypeError(`network connection closed ${secrets.PCO_SECRET}`); },
  });
  assert.equal(response.status, 503);
  const body = await response.text();
  assert.equal(JSON.parse(body).code, 'PCO_FETCH_FAILED');
  assert.ok(!body.includes('network connection closed'));
  const failure = records.find((r) => r.action === 'sync' && r.phase === 'failed');
  assert.equal(failure.stage, 'PCO_FETCH_FAILED');
  assert.equal(failure.error.name, 'TypeError');
  assert.match(failure.error.message, /network connection closed/);
  const upstream = records.find((r) => r.phase === 'fetch_error');
  assert.equal(upstream.syncId, failure.syncId);
  assert.equal(upstream.attempt, 1);
  assert.ok(!JSON.stringify(records).includes(secrets.PCO_SECRET));
});

test('invalid JSON logs parser type and stack without quoting response content', async (t) => {
  const records = capture(t);
  await assert.rejects(sync(environment(), { fetcher: async () => new Response('PRIVATE EVENT CONTENT') }));
  const parser = records.find((r) => r.phase === 'parse_error');
  assert.equal(parser.error.name, 'SyntaxError');
  assert.ok(parser.error.stack);
  assert.ok(!JSON.stringify(records).includes('PRIVATE EVENT CONTENT'));
});

test('cache and refresh failures log KV exceptions and the subsequent backoff', async (t) => {
  const records = capture(t); const env = environment();
  env.CALENDAR.put = async () => { throw new Error('KV write quota exceeded'); };
  const options = { fetcher: async () => Response.json({ data: [] }) };
  const request = new Request('https://calendar.example/api/events');
  assert.equal((await handleFetch(request, env, options)).status, 503);
  const failure = records.find((r) => r.action === 'sync' && r.phase === 'failed');
  assert.equal(failure.stage, 'KV_WRITE_FAILED');
  assert.equal(failure.error.message, 'KV write quota exceeded');
  assert.equal((await handleFetch(request, env, options)).status, 503);
  const backoff = records.find((r) => r.phase === 'refresh_backoff');
  assert.equal(backoff.snapshotAvailable, false);
  assert.ok(backoff.retryInMs > 0); assert.ok(backoff.retryAt);
  const readEnv = environment(); readEnv.CALENDAR.get = async () => { throw new Error('KV connection failed'); };
  await handleFetch(request, readEnv);
  assert.equal(records.find((r) => r.phase === 'read_error').error.message, 'KV connection failed');
});
