import { config, windowBounds } from './config.js';
import { demoSnapshot } from './demo.js';
import { fetchInstances, UpstreamError } from './pco.js';
import { normalize } from './normalize.js';

export const SNAPSHOT_KEY = 'public-snapshot-v1';

export async function sync(env, options = {}) {
  const started = Date.now();
  const now = options.now || new Date();
  try {
    const { timezone } = config(env);
    const window = windowBounds(now);
    const source = await fetchInstances(env, window.from, window.to, options);
    const { events, skipped } = normalize(source, { ...window, timezone });
    // Only one write, after every page succeeded. Never store raw upstream data.
    const snapshot = { schemaVersion: 1, demo: false, generatedAt: now.toISOString(), timezone, window, events };
    await env.CALENDAR.put(SNAPSHOT_KEY, JSON.stringify(snapshot));
    console.log(JSON.stringify({ action: 'sync', ok: true, events: events.length, skipped, pages: source.pages, durationMs: Date.now() - started }));
    return snapshot;
  } catch (error) {
    if (error instanceof UpstreamError && [401, 403].includes(error.status)) {
      await env.CALENDAR.delete(SNAPSHOT_KEY);
    }
    // Do not log request headers, credentials, upstream response bodies, or event data.
    console.error(JSON.stringify({ action: 'sync', ok: false, status: error instanceof UpstreamError ? error.status : null, durationMs: Date.now() - started }));
    throw error;
  }
}

export async function handleFetch(request, env) {
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
    const snapshot = demo ? demoSnapshot(settings.timezone) : await env.CALENDAR.get(SNAPSHOT_KEY, 'json');
    const age = snapshot ? (Date.now() - Date.parse(snapshot.generatedAt)) / 1000 : Infinity;
    const available = snapshot?.schemaVersion === 1 && age >= -60 && age < settings.maxAge;
    if (url.pathname === '/health') {
      return json({ available, demo, generatedAt: snapshot?.generatedAt || null }, available ? 200 : 503);
    }
    if (!available) return json({ error: 'Calendar temporarily unavailable', fallbackUrl: settings.fallbackUrl }, 503);
    // Never cache a snapshot beyond its freshness deadline.
    headers.set('Cache-Control', `public, max-age=${Math.max(0, Math.min(60, Math.floor(settings.maxAge - age)))}, must-revalidate`);
    if (request.method === 'HEAD') return new Response(null, { headers });
    return json({ ...snapshot, fallbackUrl: settings.fallbackUrl });
  }
  if (!['GET', 'HEAD'].includes(request.method)) return json({ error: 'Method not allowed' }, 405);
  if (!['/', '/index.html', '/embed.js', '/dates.js'].includes(url.pathname)) return new Response('Not found', { status: 404 });
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
    catch {
      return Response.json({ error: 'Calendar configuration or storage unavailable' }, { status: 503, headers: { 'Cache-Control': 'no-store' } });
    }
  },
  async scheduled(_controller, env, ctx) {
    if (env.DEMO_MODE !== 'true') ctx.waitUntil(sync(env));
  },
};
