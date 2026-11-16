import { afterEach, describe, expect, it, vi } from "vitest";
import { isUniqueViolation } from "@/server/db/errors";
import { rateLimit, resetRateLimitsForTests } from "@/server/ratelimit";

describe("isUniqueViolation", () => {
  it("recognises Postgres 23505 directly, as a cause, and by message (browser worker)", () => {
    expect(isUniqueViolation({ code: "23505" })).toBe(true);
    expect(isUniqueViolation(new Error("Failed query", { cause: { code: "23505" } }))).toBe(true);
    expect(isUniqueViolation(new Error('duplicate key value violates unique constraint "help_requests_code_key"'))).toBe(true);
    expect(isUniqueViolation(new Error("Failed query", { cause: new Error("duplicate key value violates unique constraint \"x\"") }))).toBe(true);
    expect(isUniqueViolation(new Error("syntax error"))).toBe(false);
    expect(isUniqueViolation(null)).toBe(false);
  });
});

describe("rateLimit", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    resetRateLimitsForTests();
  });

  it("limits in memory when Redis isn't configured", async () => {
    vi.stubEnv("UPSTASH_REDIS_REST_URL", "");
    for (let i = 0; i < 3; i++) await rateLimit("t:mem", 3, 60_000);
    await expect(rateLimit("t:mem", 3, 60_000)).rejects.toMatchObject({ status: 429 });
  });

  it("uses Upstash Redis (INCR + PEXPIRE NX pipeline) when configured", async () => {
    vi.stubEnv("UPSTASH_REDIS_REST_URL", "https://example.upstash.io");
    vi.stubEnv("UPSTASH_REDIS_REST_TOKEN", "tok");
    let n = 0;
    const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
      n += 1;
      return new Response(JSON.stringify([{ result: n }, { result: n === 1 ? 1 : 0 }]), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);
    await rateLimit("t:redis", 2, 60_000);
    await rateLimit("t:redis", 2, 60_000);
    await expect(rateLimit("t:redis", 2, 60_000)).rejects.toMatchObject({ status: 429 });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://example.upstash.io/pipeline");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer tok");
    expect(JSON.parse(String(init.body))).toEqual([["INCR", "rl:t:redis"], ["PEXPIRE", "rl:t:redis", "60000", "NX"]]);
  });

  it("still limits (in memory) if Redis is down", async () => {
    vi.stubEnv("UPSTASH_REDIS_REST_URL", "https://example.upstash.io");
    vi.stubEnv("UPSTASH_REDIS_REST_TOKEN", "tok");
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("network down"); }));
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    await rateLimit("t:down", 1, 60_000);
    await expect(rateLimit("t:down", 1, 60_000)).rejects.toMatchObject({ status: 429 });
  });
});
