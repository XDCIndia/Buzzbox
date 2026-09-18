/* In-memory fixed-window rate limiter.
 *
 * Suited to this app's single-process standalone deployment (better-sqlite3,
 * one Node server). Not shared across processes — if the app is ever scaled
 * horizontally, back this with Redis or the DB instead.
 *
 * Design notes:
 * - Injectable `now` keeps the logic unit-testable without fake timers.
 * - Expired buckets are pruned lazily on access; no setInterval timers
 *   (a background timer previously caused the CI test-runner hang).
 * - Bucket count is capped so an attacker rotating spoofed IPs cannot grow
 *   the map unboundedly: when full, the oldest bucket is evicted.
 */

export interface RateLimitOptions {
  /** Maximum attempts allowed per window. */
  max: number;
  /** Window length in milliseconds. */
  windowMs: number;
  /** Injected clock for tests; defaults to Date.now. */
  now?: () => number;
}

export interface RateLimitResult {
  allowed: boolean;
  /** Attempts made in the current window (including this one). */
  count: number;
  /** Milliseconds until the window resets. */
  retryAfterMs: number;
}

interface Bucket {
  /** Window start epoch ms. */
  start: number;
  count: number;
}

const MAX_BUCKETS = 10_000;
const buckets = new Map<string, Bucket>();

export function rateLimit(key: string, opts: RateLimitOptions): RateLimitResult {
  const now = opts.now ? opts.now() : Date.now();

  // Lazy prune: drop expired buckets when the map gets large.
  if (buckets.size > MAX_BUCKETS / 2) {
    for (const [k, b] of buckets) {
      if (now - b.start >= opts.windowMs) buckets.delete(k);
    }
  }

  let bucket = buckets.get(key);
  if (!bucket || now - bucket.start >= opts.windowMs) {
    if (!bucket && buckets.size >= MAX_BUCKETS) {
      // Evict the oldest bucket to make room.
      let oldestKey: string | null = null;
      let oldestStart = Infinity;
      for (const [k, b] of buckets) {
        if (b.start < oldestStart) {
          oldestStart = b.start;
          oldestKey = k;
        }
      }
      if (oldestKey) buckets.delete(oldestKey);
    }
    bucket = { start: now, count: 0 };
    buckets.set(key, bucket);
  }

  bucket.count += 1;
  const retryAfterMs = bucket.start + opts.windowMs - now;

  return {
    allowed: bucket.count <= opts.max,
    count: bucket.count,
    retryAfterMs: Math.max(0, retryAfterMs),
  };
}

/** Test-only: clear all buckets between tests. */
export function resetRateLimits(): void {
  buckets.clear();
}
