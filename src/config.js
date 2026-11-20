export function config(env) {
  const timezone = env.TIMEZONE || 'Australia/Sydney';
  new Intl.DateTimeFormat('en', { timeZone: timezone }).format();
  const maxAge = Number(env.MAX_SNAPSHOT_AGE_SECONDS || 2700);
  if (!Number.isFinite(maxAge) || maxAge < 60 || maxAge > 86400) {
    throw new Error('MAX_SNAPSHOT_AGE_SECONDS must be between 60 and 86400');
  }
  const origins = (env.ALLOWED_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean);
  for (const origin of origins) {
    if (new URL(origin).origin !== origin || !/^https?:\/\//.test(origin)) {
      throw new Error('ALLOWED_ORIGINS must contain exact HTTP(S) origins');
    }
  }
  return { timezone, maxAge, origins, fallbackUrl: safeUrl(env.FALLBACK_URL) };
}

export function safeUrl(value) {
  if (typeof value !== 'string' || value.length > 4096) return null;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password ? url.href : null;
  } catch { return null; }
}

export function dateKey(value, timezone) {
  const parts = new Intl.DateTimeFormat('en', {
    timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date(value));
  const part = (type) => parts.find((p) => p.type === type).value;
  return `${part('year')}-${part('month')}-${part('day')}`;
}

export function windowBounds(now) {
  // One calendar year; clamp leap day rather than overflowing into March.
  const end = new Date(now);
  const month = end.getUTCMonth();
  end.setUTCFullYear(end.getUTCFullYear() + 1);
  if (end.getUTCMonth() !== month) end.setUTCDate(0);
  return { from: now.toISOString(), to: end.toISOString() };
}
