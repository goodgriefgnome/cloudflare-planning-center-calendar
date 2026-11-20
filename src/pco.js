const ROOT = 'https://api.planningcenteronline.com';

export class UpstreamError extends Error {
  constructor(status) {
    super(`Planning Center request failed (${status})`);
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
} = {}) {
  if (!env.PCO_APPLICATION_ID || !env.PCO_SECRET) throw new Error('Planning Center secrets are missing');
  const deadline = clock() + 120_000;
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
    let response;
    for (let attempt = 0; attempt < 4; attempt++) {
      const remaining = deadline - clock();
      if (remaining <= 0) throw new Error('Sync deadline exceeded');
      response = await fetcher(url, { headers, redirect: 'error', signal: AbortSignal.timeout(Math.min(15_000, remaining)) });
      if (response.ok) break;
      if (![429, 500, 502, 503, 504].includes(response.status) || attempt === 3) {
        throw new UpstreamError(response.status);
      }
      const retryAfter = response.headers.get('Retry-After');
      const seconds = retryAfter === null ? NaN : Number(retryAfter);
      const delay = Number.isFinite(seconds) ? Math.max(1000, seconds * 1000) : 1000 * 2 ** attempt;
      if (clock() + delay >= deadline) throw new UpstreamError(response.status);
      await response.body?.cancel();
      await sleep(delay);
    }
    const page = await response.json();
    if (!Array.isArray(page.data) || (page.included && !Array.isArray(page.included))) throw new Error('Invalid Planning Center response');
    instances.push(...page.data);
    for (const resource of page.included || []) included.set(`${resource.type}:${resource.id}`, resource);
    next = page.links?.next || null;
    // Pace pagination from the current user rate headers; no assumed fixed quota.
    const count = Number(response.headers.get('X-PCO-API-Request-Rate-Count'));
    const limit = Number(response.headers.get('X-PCO-API-Request-Rate-Limit'));
    const period = parseFloat(response.headers.get('X-PCO-API-Request-Rate-Period'));
    if (next && limit > 0 && count >= limit * 0.8 && period > 0) {
      const delay = period * 1000;
      if (clock() + delay >= deadline) throw new Error('Rate limit would exceed sync deadline');
      await sleep(delay);
    }
  }
  return { instances, included, pages: visited.size };
}
