import "server-only";
import { tooMany } from "./http";

/**
 * Fixed-window rate limiter kept in memory. It protects each server instance; on a multi-instance
 * deployment add a shared store (e.g. Upstash Redis) — see README "Scaling". Login lockout and OTP
 * attempt limits are also stored in the database, so those hold across instances.
 */
const buckets = new Map<string, { count: number; resetAt: number }>();

export function rateLimit(key: string, limit: number, windowMs: number) {
  const now = Date.now();
  const b = buckets.get(key);
  if (!b || b.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
  } else {
    b.count += 1;
    if (b.count > limit) throw tooMany();
  }
  if (buckets.size > 50_000) {
    for (const [k, v] of buckets) if (v.resetAt <= now) buckets.delete(k);
  }
}

export function resetRateLimitsForTests() {
  buckets.clear();
}
