const CODES = new Set([
  'PCO_CREDENTIALS_MISSING', 'PCO_FETCH_FAILED', 'PCO_RESPONSE_INVALID',
  'CALENDAR_BINDING_MISSING', 'KV_READ_FAILED', 'KV_WRITE_FAILED',
  'CONFIG_INVALID', 'EVENT_DATA_INVALID', 'SNAPSHOT_EXPIRED', 'CALENDAR_UNAVAILABLE',
]);

export class CalendarError extends Error {
  constructor(code) { super(code); this.code = code; }
}

export function diagnosticCode(error, fallback = 'CALENDAR_UNAVAILABLE') {
  // Return only application-owned identifiers. Never expose exception messages,
  // request URLs, response bodies, secrets, or arbitrary error.code properties.
  const code = error instanceof CalendarError ? error.code : null;
  return CODES.has(code) || /^PCO_HTTP_[1-5]\d{2}$/.test(code || '') ? code : fallback;
}
