export const REFRESH_INTERVAL_MS = 15 * 60 * 1000;

export function hasSnapshot(snapshot) {
  return snapshot?.schemaVersion === 1 && Array.isArray(snapshot.events) &&
    Number.isFinite(Date.parse(snapshot.fetchedAt || snapshot.generatedAt));
}

export function needsRefresh(snapshot, now = Date.now()) {
  if (!hasSnapshot(snapshot)) return true;
  const fetched = Date.parse(snapshot.fetchedAt || snapshot.generatedAt);
  return fetched > now || now - fetched >= REFRESH_INTERVAL_MS;
}
