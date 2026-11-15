import "server-only";
import { NextResponse } from "next/server";
import { z, type ZodType } from "zod";

export class HttpError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public extra?: Record<string, unknown>,
  ) {
    super(message);
  }
}

export const badRequest = (msg: string, extra?: Record<string, unknown>) => new HttpError(400, "bad_request", msg, extra);
export const unauthorized = (msg = "Please sign in.") => new HttpError(401, "unauthorized", msg);
export const forbidden = (msg = "Your role can't do this.") => new HttpError(403, "forbidden", msg);
export const notFound = (msg = "Not found.") => new HttpError(404, "not_found", msg);
export const conflict = (msg: string, extra?: Record<string, unknown>) => new HttpError(409, "conflict", msg, extra);
export const tooMany = (msg = "Too many attempts. Please wait a minute and try again.") => new HttpError(429, "rate_limited", msg);
export const unavailable = (code: string, msg: string) => new HttpError(503, code, msg);

export function json(data: unknown, init?: number | ResponseInit) {
  return NextResponse.json(data, typeof init === "number" ? { status: init } : init);
}

/** Wrap a route handler: consistent JSON errors, no stack traces or internals leaked to clients. */
export function handler<A extends unknown[]>(fn: (...args: A) => Promise<Response>) {
  return async (...args: A): Promise<Response> => {
    try {
      return await fn(...args);
    } catch (err) {
      if (err instanceof HttpError) {
        return json({ error: { code: err.code, message: err.message, ...(err.extra ?? {}) } }, err.status);
      }
      if (err instanceof z.ZodError) {
        return json({ error: { code: "bad_request", message: "Some values are not valid." } }, 400);
      }
      // Log server-side only. Never echo internal errors (they can contain SQL or secrets).
      console.error("[api] unhandled error:", err instanceof Error ? err.message : err);
      return json({ error: { code: "server_error", message: "Something went wrong on our side. Please try again." } }, 500);
    }
  };
}

const MAX_BODY_BYTES = 1_500_000; // photos are ≤ ~200 KB each, a family has ≤ 12 members

export async function parseBody<T>(req: Request, schema: ZodType<T>): Promise<T> {
  const len = Number(req.headers.get("content-length") ?? "0");
  if (len > MAX_BODY_BYTES) throw new HttpError(413, "too_large", "Request is too large.");
  let raw: unknown;
  try {
    const text = await req.text();
    if (text.length > MAX_BODY_BYTES) throw new HttpError(413, "too_large", "Request is too large.");
    raw = text ? JSON.parse(text) : {};
  } catch (e) {
    if (e instanceof HttpError) throw e;
    throw badRequest("Body must be valid JSON.");
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    throw badRequest("Some fields are missing or not valid.", {
      fields: parsed.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
    });
  }
  return parsed.data;
}

export function parseQuery<T>(url: string, schema: ZodType<T>): T {
  const params = Object.fromEntries(new URL(url).searchParams.entries());
  const parsed = schema.safeParse(params);
  if (!parsed.success) throw badRequest("Some query parameters are not valid.");
  return parsed.data;
}

/**
 * CSRF defence for cookie-authenticated (admin) mutations: the request must come from our own origin.
 * Admin cookies are also SameSite=Strict.
 */
export function assertSameOrigin(req: Request) {
  const origin = req.headers.get("origin");
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
  if (!origin || !host) throw forbidden("Cross-site request blocked.");
  try {
    if (new URL(origin).host !== host) throw forbidden("Cross-site request blocked.");
  } catch (e) {
    if (e instanceof HttpError) throw e;
    throw forbidden("Cross-site request blocked.");
  }
}

export function clientIp(req: Request): string {
  return (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim() || req.headers.get("x-real-ip") || "local";
}

export const zId = z.string().uuid();
