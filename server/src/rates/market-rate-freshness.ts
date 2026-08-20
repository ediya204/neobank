export const MAX_MARKET_FETCH_AGE_MS = 2 * 60 * 1000;
export const MAX_MARKET_SOURCE_AGE_MS = 5 * 60 * 1000;
export const MAX_MARKET_CLOCK_SKEW_MS = 30 * 1000;

export function marketSourceTimestampsAreFresh(
  fetchedAtValue: string,
  updatedAtValue: string,
  now = Date.now()
) {
  const fetchedAt = new Date(fetchedAtValue).getTime();
  const updatedAt = new Date(updatedAtValue).getTime();
  return (
    Number.isFinite(fetchedAt) &&
    Number.isFinite(updatedAt) &&
    fetchedAt >= now - MAX_MARKET_FETCH_AGE_MS &&
    fetchedAt <= now + MAX_MARKET_CLOCK_SKEW_MS &&
    updatedAt >= now - MAX_MARKET_SOURCE_AGE_MS &&
    updatedAt <= now + MAX_MARKET_CLOCK_SKEW_MS
  );
}
