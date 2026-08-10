const buckets = new Map();
const WINDOW_MS = 60_000;

/** Simple in-memory per-key token bucket. Returns true if the request is allowed. */
export function rateLimit(key, limitPerWindow) {
  const now = Date.now();
  const entry = buckets.get(key) ?? { count: 0, windowStart: now };
  if (now - entry.windowStart > WINDOW_MS) {
    entry.count = 0;
    entry.windowStart = now;
  }
  entry.count += 1;
  buckets.set(key, entry);
  return entry.count <= limitPerWindow;
}

// Evict stale buckets so this doesn't grow unbounded on a long-running
// process — every 5 minutes, drop anything whose window is long over.
setInterval(
  () => {
    const now = Date.now();
    for (const [key, entry] of buckets) {
      if (now - entry.windowStart > 5 * WINDOW_MS) buckets.delete(key);
    }
  },
  5 * WINDOW_MS,
).unref();
