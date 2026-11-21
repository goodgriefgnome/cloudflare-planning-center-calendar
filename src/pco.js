import { CalendarError } from './errors.js';
import { errorInfo, logDiagnostic } from './diagnostics.js';

const ROOT = 'https://api.planningcenteronline.com';

export class UpstreamError extends CalendarError {
  constructor(status) {
    super(`PCO_HTTP_${status}`);
    this.status = status;
  }
}

export function instanceUrl(from, to) {
  const url = new URL('/calendar/v2/event_instances', ROOT);
  url.search = new URLSearchParams({
    include: 'event,event_times,tags',
    'where[ends_at][gte]': from,
    'where[starts_at][lt]': to,
    order: 'starts_at', per_page: '100',
    'fields[EventInstance]': 'all_day_event,canceled,church_center_url,description,ends_at,image_url,kind,location,name,published_ends_at,published_starts_at,recurrence_description,starts_at,event,event_times,tags',
    'fields[Event]': 'approval_status,link_only,visible_in_church_center,summary,registration_url',
    'fields[EventTime]': 'starts_at,ends_at,visible_on_widget_and_ical',
    'fields[Tag]': 'name',
  });
  return url.href;
}

function checkedUrl(value) {
  const url = new URL(value, ROOT);
  if (url.origin !== ROOT || !url.pathname.startsWith('/calendar/v2/') || url.username || url.password) {
    throw new Error('Unexpected Planning Center pagination URL');
  }
  return url;
}

export async function fetchInstances(env, from, to, {
  fetcher = fetch,
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  clock = Date.now,
  syncId = null,
} = {}) {
  if (!env.PCO_APPLICATION_ID || !env.PCO_SECRET) throw new CalendarError('PCO_CREDENTIALS_MISSING');
  const deadline = clock() + 120_000;
  const log = (phase, fields = {}, level = 'log') => logDiagnostic(env, { action: 'pco', syncId, phase, ...fields }, level);
  const headers = {
    Authorization: `Basic ${btoa(`${env.PCO_APPLICATION_ID}:${env.PCO_SECRET}`)}`,
    'User-Agent': env.PCO_USER_AGENT || 'Planning Center Calendar Embed (https://github.com/goodgriefgnome/cloudflare-planning-center-calendar)',
    'X-PCO-API-Version': env.PCO_API_VERSION || '2026-06-22',
    Accept: 'application/vnd.api+json',
  };
  const instances = [], included = new Map(), visited = new Set();
  let next = instanceUrl(from, to);
  while (next) {
    if (visited.has(next) || visited.size >= 200) throw new Error('Pagination is incomplete or exceeds the sync budget');
    visited.add(next);
    const url = checkedUrl(next);
    // Log the validated endpoint and numeric pagination offset, never arbitrary
    // query values, request headers, response bodies, or returned event records.
    const context = { page: visited.size, endpoint: url.origin + url.pathname,
      offset: /^\d+$/.test(url.searchParams.get('offset') || '') ? Number(url.searchParams.get('offset')) : null };
    let response;
    for (let attempt = 0; attempt < 4; attempt++) {
      const remaining = deadline - clock();
      if (remaining <= 0) throw new Error('Sync deadline exceeded');
      // Workers supports follow/manual, but not redirect:error. Manual mode
      // leaves all 3xx responses for the !ok check below and never forwards auth.
      const started = clock();
      const timeoutMs = Math.min(15_000, remaining);
      log('request', { ...context, attempt: attempt + 1, timeoutMs, remainingMs: remaining, apiVersion: headers['X-PCO-API-Version'] });
      try {
        response = await fetcher(url, { headers, redirect: 'manual', signal: AbortSignal.timeout(timeoutMs) });
      } catch (error) {
        log('fetch_error', { ...context, attempt: attempt + 1, durationMs: clock() - started, error: errorInfo(error) }, 'error');
        throw error;
      }
      log('response', { ...context, attempt: attempt + 1, status: response.status, durationMs: clock() - started,
        contentType: response.headers.get('Content-Type'), contentLength: response.headers.get('Content-Length'),
        retryAfter: response.headers.get('Retry-After'), requestId: response.headers.get('X-Request-Id'),
        rateCount: response.headers.get('X-PCO-API-Request-Rate-Count'),
        rateLimit: response.headers.get('X-PCO-API-Request-Rate-Limit'),
        ratePeriod: response.headers.get('X-PCO-API-Request-Rate-Period') });
      if (response.ok) break;
      if (![429, 500, 502, 503, 504].includes(response.status) || attempt === 3) {
        throw new UpstreamError(response.status);
      }
      const retryAfter = response.headers.get('Retry-After');
      const seconds = retryAfter === null ? NaN : Number(retryAfter);
      const delay = Number.isFinite(seconds) ? Math.max(1000, seconds * 1000) : 1000 * 2 ** attempt;
      if (clock() + delay >= deadline) {
        log('retry_budget_exceeded', { ...context, status: response.status, delayMs: delay, remainingMs: deadline - clock() }, 'error');
        throw new UpstreamError(response.status);
      }
      log('retry', { ...context, attempt: attempt + 1, nextAttempt: attempt + 2, status: response.status, delayMs: delay });
      await response.body?.cancel();
      await sleep(delay);
    }
    let page;
    try { page = await response.json(); }
    catch (error) {
      log('parse_error', { ...context, status: response.status, error: errorInfo(error) }, 'error');
      throw new CalendarError('PCO_RESPONSE_INVALID');
    }
    if (!Array.isArray(page?.data) || (page.included && !Array.isArray(page.included))) {
      log('invalid_response', { ...context, dataType: Array.isArray(page?.data) ? 'array' : typeof page?.data,
        includedType: Array.isArray(page?.included) ? 'array' : typeof page?.included }, 'error');
      throw new CalendarError('PCO_RESPONSE_INVALID');
    }
    instances.push(...page.data);
    for (const resource of page.included || []) included.set(`${resource.type}:${resource.id}`, resource);
    next = page.links?.next || null;
    log('page_complete', { ...context, records: page.data.length, included: (page.included || []).length,
      totalRecords: instances.length, totalIncluded: included.size, hasNext: !!next, remainingMs: deadline - clock() });
    // Pace pagination from the current user rate headers; no assumed fixed quota.
    const count = Number(response.headers.get('X-PCO-API-Request-Rate-Count'));
    const limit = Number(response.headers.get('X-PCO-API-Request-Rate-Limit'));
    const period = parseFloat(response.headers.get('X-PCO-API-Request-Rate-Period'));
    if (next && limit > 0 && count >= limit * 0.8 && period > 0) {
      const delay = period * 1000;
      if (clock() + delay >= deadline) throw new Error('Rate limit would exceed sync deadline');
      log('rate_limit_wait', { ...context, delayMs: delay, rateCount: count, rateLimit: limit, remainingMs: deadline - clock() });
      await sleep(delay);
    }
  }
  return { instances, included, pages: visited.size };
}
