export const MAX_SNAPSHOT_AGE_MS = 15 * 60 * 1000;

export function remainingFreshness(snapshot, now = Date.now()) {
  const generated = Date.parse(snapshot?.generatedAt);
  if (snapshot?.schemaVersion !== 1 || !Number.isFinite(generated) || generated > now) return 0;
  return Math.max(0, MAX_SNAPSHOT_AGE_MS - (now - generated));
}
