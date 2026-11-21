// Worker-console diagnostics only. Public API responses still use safe codes.
export function errorInfo(error, depth = 0) {
  if (!(error instanceof Error)) return { name: typeof error, message: 'Non-Error exception' };
  // JSON parser errors can quote event content from the input. Keep their type
  // and stack frames, but omit the input-bearing message and stack first line.
  const syntax = error instanceof SyntaxError;
  const info = {
    name: error.name,
    message: syntax ? 'Syntax error (input omitted)' : error.message,
    stack: syntax ? error.stack?.split('\n').filter((line) => /^\s+at /.test(line)).join('\n') : error.stack,
  };
  if (typeof error.code === 'string' || typeof error.code === 'number') info.code = error.code;
  if (depth < 2 && error.cause) info.cause = errorInfo(error.cause, depth + 1);
  return info;
}

export function logDiagnostic(env, fields, level = 'log') {
  const credentials = [env.PCO_APPLICATION_ID, env.PCO_SECRET];
  if (credentials.every(Boolean)) {
    try { credentials.push(btoa(`${credentials[0]}:${credentials[1]}`)); } catch { /* Invalid credentials must still be loggable. */ }
  }
  const secrets = credentials.filter((value) => typeof value === 'string' && value.length)
    .flatMap((value) => {
      try { return [value, encodeURIComponent(value)]; } catch { return [value]; }
    }).sort((a, b) => b.length - a.length);
  const clean = (value) => {
    if (typeof value !== 'string') return value;
    for (const secret of secrets) value = value.split(secret).join('[REDACTED]');
    return value.replace(/\b(Basic|Bearer)\s+[A-Za-z0-9+/=_\-.]+/gi, '$1 [REDACTED]')
      .replace(/(https?:\/\/)[^\s/@]+:[^\s/@]+@/gi, '$1[REDACTED]@').slice(0, 8000);
  };
  const record = JSON.parse(JSON.stringify({ timestamp: new Date().toISOString(), ...fields }, (_key, value) => clean(value)));
  console[level](record);
}
