const MAX_AGE_MS = 15 * 60 * 1000;

// Subtract the entire request duration (not just the return journey), with a
// small safety margin. Do not rely on the visitor's clock matching the server.
export function displayLifetime(freshForMs, elapsedMs) {
  if (!Number.isFinite(freshForMs) || !Number.isFinite(elapsedMs) || elapsedMs < 0) return 0;
  return Math.max(0, Math.min(MAX_AGE_MS, freshForMs) - elapsedMs - 100);
}

export function deadlinePassed(deadline, monotonicNow, wallNow) {
  return !deadline || monotonicNow >= deadline.monotonic || wallNow >= deadline.wall;
}
