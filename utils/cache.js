const store = new Map();

/**
 * Returns cached data if fresh, otherwise calls fn(), caches the result, and returns it.
 * @param {string} key   - Cache key
 * @param {number} ttlMs - Time-to-live in milliseconds
 * @param {Function} fn  - Async function that returns the data to cache
 */
async function getCached(key, ttlMs, fn) {
  const hit = store.get(key);
  if (hit && Date.now() < hit.expiresAt) return hit.data;
  const data = await fn();
  store.set(key, { data, expiresAt: Date.now() + ttlMs });
  return data;
}

/**
 * Deletes all cache entries whose key starts with prefix.
 * Call this after mutations that affect cached data.
 */
function invalidate(prefix) {
  for (const key of store.keys()) {
    if (key.startsWith(prefix)) store.delete(key);
  }
}

module.exports = { getCached, invalidate };
