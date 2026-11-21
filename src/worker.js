import { config, windowBounds } from './config.js';
import { demoSnapshot } from './demo.js';
import { fetchInstances, UpstreamError } from './pco.js';
import { normalize } from './normalize.js';
import { remainingFreshness } from './freshness.js';
import { CalendarError, diagnosticCode } from './errors.js';

export const SNAPSHOT_KEY = 'public-snapshot-v1';

// Coalesce requests within one Worker isolate. KV has no global lock: visitors
// in different isolates can occasionally perform duplicate (safe, read-only) refreshes.
const refreshes = new WeakMap();

async function readSnapshot(env) {
  if (!env.CALENDAR) throw new CalendarError('CALENDAR_BINDING_MISSING');
  try { return await env.CALENDAR.get(SNAPSHOT_KEY, 'json'); }
  catch { throw new CalendarError('KV_READ_FAILED'); }
}

export async function getFreshSnapshot(env, options = {}) {
  const clock = options.clock || Date.now;
  const snapshot = await readSnapshot(env);
  if (remainingFreshness(snapshot, clock()) > 1000) return snapshot;
  const existing = refreshes.get(env.CALENDAR);
  if (existing) return existing;
  const pending = sync(env, options).then((result) => {
    if (remainingFreshness(result, clock()) <= 0) throw new CalendarError('SNAPSHOT_EXPIRED');
    return result;
  });
  refreshes.set(env.CALENDAR, pending);
  try { return await pending; }
  finally { if (refreshes.get(env.CALENDAR) === pending) refreshes.delete(env.CALENDAR); }
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
    const snapshot = { schemaVersion: 1, demo: false, generatedAt: now.toISOString(), timezone, window, events };
    stage = 'KV_WRITE_FAILED';
    await env.CALENDAR.put(SNAPSHOT_KEY, JSON.stringify(snapshot));
    console.log(JSON.stringify({ action: 'sync', ok: true, events: events.length, skipped, pages: source.pages, durationMs: Date.now() - started }));
    return snapshot;
  } catch (error) {
    if (error instanceof UpstreamError && [401, 403].includes(error.status)) {
      try { await env.CALENDAR.delete(SNAPSHOT_KEY); }
      catch { stage = 'KV_WRITE_FAILED'; }
    }
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
      const available = remainingFreshness(snapshot) > 0;
      return json({ available, demo, generatedAt: snapshot?.generatedAt || null }, available ? 200 : 503);
    }
    let snapshot;
    try { snapshot = demo ? demoSnapshot(settings.timezone) : await getFreshSnapshot(env, options); }
    catch (error) {
      headers.set('Retry-After', '30');
      return json({ error: 'Calendar temporarily unavailable', code: diagnosticCode(error), fallbackUrl: settings.fallbackUrl }, 503);
    }
    const freshForMs = remainingFreshness(snapshot);
    if (freshForMs <= 0) return json({ error: 'Calendar temporarily unavailable', code: 'SNAPSHOT_EXPIRED', fallbackUrl: settings.fallbackUrl }, 503);
    // Reuse KV, not browser/CDN responses. Every response carries its remaining
    // lifetime so a page left open also removes the data at the deadline.
    headers.set('Cache-Control', 'no-store');
    if (request.method === 'HEAD') return new Response(null, { headers });
    return json({ ...snapshot, freshForMs, fallbackUrl: settings.fallbackUrl });
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
  async fetch(request, env) {
    try { return await handleFetch(request, env); }
    catch (error) {
      const code = diagnosticCode(error, 'CONFIG_INVALID');
      console.error({ action: 'request', ok: false, code });
      return Response.json({ error: 'Calendar configuration or storage unavailable', code }, { status: 503, headers: { 'Cache-Control': 'no-store' } });
    }
  },
};
