import "server-only";
import { tooMany } from "./http";

/**
 * Fixed-window rate limiter.
 * - With UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN set, counters live in Upstash Redis, so limits hold
 *   across every server instance (INCR + PEXPIRE NX in one pipeline call).
 * - Otherwise counters are kept in memory per instance (fine for one server).
 * If Redis can't be reached the request is still limited, by the in-memory counter, rather than let through.
 * Login lockout and OTP attempt limits are also stored in the database, so those hold across instances regardless.
 */
const buckets = new Map<string, { count: number; resetAt: number }>();

function memory(key: string, limit: number, windowMs: number) {
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

async function redisCount(url: string, token: string, key: string, windowMs: number): Promise<number> {
  const res = await fetch(`${url.replace(/\/$/, "")}/pipeline`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify([["INCR", `rl:${key}`], ["PEXPIRE", `rl:${key}`, String(windowMs), "NX"]]),
    signal: AbortSignal.timeout(1500),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`redis ${res.status}`);
  const out = (await res.json()) as { result?: unknown; error?: string }[];
  const n = Number(out?.[0]?.result);
  if (!Number.isFinite(n)) throw new Error(out?.[0]?.error ?? "redis: bad reply");
  return n;
}

export async function rateLimit(key: string, limit: number, windowMs: number): Promise<void> {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (url && token) {
    let n: number | null = null;
    try {
      n = await redisCount(url, token, key, windowMs);
    } catch (e) {
      console.warn("[ratelimit] Redis unavailable, using in-memory limit:", e instanceof Error ? e.message : e);
    }
    if (n !== null) {
      if (n > limit) throw tooMany();
      return;
    }
  }
  memory(key, limit, windowMs);
}

export function resetRateLimitsForTests() {
  buckets.clear();
}
