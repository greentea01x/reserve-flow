import { AppError } from './errors.js';

/**
 * In-process sliding-window rate limiter (spec §0; C-13: single instance, memory store is
 * the design, not a shortcut). Each createApp/router factory builds its own instances, so
 * test apps never share buckets. Throws 429 RATE_LIMITED with retry_after_seconds in
 * details; app.onError copies that into the Retry-After header.
 * ponytail: swap for a shared store only if we ever run more than one API instance.
 */
export function createRateLimiter(limit: number, windowMs = 60_000) {
  const hits = new Map<string, number[]>();

  return function assertWithinLimit(key: string): void {
    const now = Date.now();
    const cutoff = now - windowMs;

    // Lazy sweep so abandoned keys cannot grow the map without bound.
    if (hits.size > 10_000) {
      for (const [existingKey, stamps] of hits) {
        if ((stamps.at(-1) ?? 0) <= cutoff) {
          hits.delete(existingKey);
        }
      }
    }

    const stamps = (hits.get(key) ?? []).filter((stamp) => stamp > cutoff);
    if (stamps.length >= limit) {
      hits.set(key, stamps);
      const retryAfterSeconds = Math.max(
        1,
        Math.ceil(((stamps[0] as number) + windowMs - now) / 1000),
      );
      throw new AppError('RATE_LIMITED', 'Too many requests', {
        details: { retry_after_seconds: retryAfterSeconds },
      });
    }
    stamps.push(now);
    hits.set(key, stamps);
  };
}
