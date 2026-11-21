import { config, windowBounds } from './config.js';
import { demoSnapshot } from './demo.js';
import { fetchInstances, UpstreamError } from './pco.js';
import { normalize } from './normalize.js';
import { hasSnapshot, needsRefresh, REFRESH_INTERVAL_MS } from './freshness.js';
import { CalendarError, diagnosticCode } from './errors.js';

export const SNAPSHOT_KEY = 'public-snapshot-v1';

// Coalesce requests within one Worker isolate. KV has no global lock: visitors
// in different isolates can occasionally perform duplicate (safe, read-only) refreshes.
const caches = new WeakMap();

function cacheState(env) {
  if (!env.CALENDAR) throw new CalendarError('CALENDAR_BINDING_MISSING');
  let state = caches.get(env.CALENDAR);
  if (!state) {
    state = { snapshot: null, pending: null, retryAt: 0 };
    caches.set(env.CALENDAR, state);
  }
  return state;
}

async function readSnapshot(env) {
  const state = cacheState(env);
  try {
    const stored = await env.CALENDAR.get(SNAPSHOT_KEY, 'json');
    const time = (s) => Date.parse(s?.fetchedAt || s?.generatedAt);
    if (hasSnapshot(stored) && (!hasSnapshot(state.snapshot) || time(stored) > time(state.snapshot))) state.snapshot = stored;
  } catch {
    if (!hasSnapshot(state.snapshot)) throw new CalendarError('KV_READ_FAILED');
  }
  return state.snapshot;
}

function startRefresh(env, options) {
  const clock = options.clock || Date.now;
  const state = cacheState(env);
  if (state.pending) return state.pending;
  if (clock() < state.retryAt) return null;
  const pending = sync(env, options).then((result) => {
    state.retryAt = 0;
    return result;
  }).catch((error) => {
    state.retryAt = clock() + 30_000;
    throw error;
  }).finally(() => { if (state.pending === pending) state.pending = null; });
  state.pending = pending;
  return pending;
}

export async function getSnapshot(env, options = {}) {
  const snapshot = await readSnapshot(env);
  const clock = options.clock || Date.now;
  if (hasSnapshot(snapshot)) {
    if (needsRefresh(snapshot, clock())) {
      const pending = startRefresh(env, options);
      if (pending) {
        // The response uses the existing cache immediately. Keep the refresh
        // alive after returning, and handle rejection without deleting cache.
        const background = pending.catch(() => {});
        options.waitUntil?.(background);
        return { snapshot, refreshing: true };
      }
    }
    return { snapshot, refreshing: false };
  }
  // Only a cache with no successful snapshot ever needs to wait for upstream.
  const pending = startRefresh(env, options);
  if (!pending) throw new CalendarError('CALENDAR_UNAVAILABLE');
  return { snapshot: await pending, refreshing: false };
}

export async function sync(env, options = {}) {
  const started = Date.now();
  const now = options.now || new Date(options.clock ? options.clock() : Date.now());
  let stage = 'CONFIG_INVALID';
  try {
    const { timezone } = config(env);
    const window = windowBounds(now);
    stage = 'PCO_FETCH_FAILED';
    const source = await fetchInstances(env, window.from, window.to, options);
    stage = 'EVENT_DATA_INVALID';
    const { events, skipped } = normalize(source, { ...window, timezone });
    // Only one write, after every page succeeded. Never store raw upstream data.
    const fetchedAt = new Date(options.clock ? options.clock() : Date.now()).toISOString();
    const snapshot = { schemaVersion: 1, demo: false, generatedAt: now.toISOString(), fetchedAt, timezone, window, events };
    stage = 'KV_WRITE_FAILED';
    await env.CALENDAR.put(SNAPSHOT_KEY, JSON.stringify(snapshot));
    cacheState(env).snapshot = snapshot;
    console.log(JSON.stringify({ action: 'sync', ok: true, events: events.length, skipped, pages: source.pages, durationMs: Date.now() - started }));
    return snapshot;
  } catch (error) {
    // Do not log request headers, credentials, upstream response bodies, or event data.
    const code = diagnosticCode(error, stage);
    console.error({ action: 'sync', ok: false, status: error instanceof UpstreamError ? error.status : null, code, durationMs: Date.now() - started });
    throw new CalendarError(code);
  }
}

export async function handleFetch(request, env, options = {}) {
  const url = new URL(request.url);
  const settings = config(env);
  const origin = request.headers.get('Origin');
  const allowed = origin === url.origin || settings.origins.includes(origin);
  const headers = new Headers({
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    Vary: 'Origin',
  });
  if (allowed && origin) headers.set('Access-Control-Allow-Origin', origin);
  const json = (body, status = 200) => {
    const h = new Headers(headers);
    h.set('Content-Type', 'application/json; charset=utf-8');
    if (!h.has('Cache-Control')) h.set('Cache-Control', 'no-store');
    return new Response(JSON.stringify(body), { status, headers: h });
  };
  if (url.pathname === '/api/events' || url.pathname === '/health') {
    if (origin && !allowed) return json({ error: 'Origin is not allowed' }, 403);
    if (request.method === 'OPTIONS') {
      headers.set('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
      headers.set('Access-Control-Max-Age', '600');
      return new Response(null, { status: 204, headers });
    }
    if (!['GET', 'HEAD'].includes(request.method)) {
      headers.set('Allow', 'GET, HEAD, OPTIONS');
      return json({ error: 'Method not allowed' }, 405);
    }
    const demo = env.DEMO_MODE === 'true';
    if (url.pathname === '/health') {
      // Monitoring must not create Planning Center traffic.
      const snapshot = demo ? demoSnapshot(settings.timezone) : await readSnapshot(env);
      const available = hasSnapshot(snapshot);
      return json({ available, stale: needsRefresh(snapshot), demo, generatedAt: snapshot?.generatedAt || null, fetchedAt: snapshot?.fetchedAt || snapshot?.generatedAt || null }, available ? 200 : 503);
    }
    let result;
    try { result = demo ? { snapshot: demoSnapshot(settings.timezone), refreshing: false } : await getSnapshot(env, options); }
    catch (error) {
      headers.set('Retry-After', '30');
      return json({ error: 'Calendar temporarily unavailable', code: diagnosticCode(error), fallbackUrl: settings.fallbackUrl }, 503);
    }
    const { snapshot, refreshing } = result;
    // KV is the cache; do not let an HTTP cache hide a newly fetched snapshot.
    headers.set('Cache-Control', 'no-store');
    if (request.method === 'HEAD') return new Response(null, { headers });
    // A display lease keeps already-cached older embeds working during rollout;
    // the current embed uses refreshAfterMs and never expires displayed data.
    return json({ ...snapshot, refreshing, stale: needsRefresh(snapshot), refreshAfterMs: refreshing ? 10_000 : 60_000, freshForMs: REFRESH_INTERVAL_MS, fallbackUrl: settings.fallbackUrl });
  }
  if (!['GET', 'HEAD'].includes(request.method)) return json({ error: 'Method not allowed' }, 405);
  if (!['/', '/index.html', '/embed.js', '/dates.js', '/freshness.js'].includes(url.pathname)) return new Response('Not found', { status: 404 });
  const asset = await env.ASSETS.fetch(request);
  const assetHeaders = new Headers(asset.headers);
  assetHeaders.set('X-Content-Type-Options', 'nosniff');
  assetHeaders.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  if (url.pathname.endsWith('.js')) {
    // Module scripts are public and can load cross-origin. Only the events API uses an origin allowlist.
    assetHeaders.set('Access-Control-Allow-Origin', '*');
    assetHeaders.set('Cache-Control', 'public, max-age=300');
  } else {
    assetHeaders.set('Cache-Control', 'no-cache');
    assetHeaders.set('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src https:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'self' " + settings.origins.join(' '));
  }
  return new Response(asset.body, { status: asset.status, headers: assetHeaders });
}

export default {
  async fetch(request, env, ctx) {
    try { return await handleFetch(request, env, { waitUntil: (promise) => ctx.waitUntil(promise) }); }
    catch (error) {
      const code = diagnosticCode(error, 'CONFIG_INVALID');
      console.error({ action: 'request', ok: false, code });
      return Response.json({ error: 'Calendar configuration or storage unavailable', code }, { status: 503, headers: { 'Cache-Control': 'no-store' } });
    }
  },
};
