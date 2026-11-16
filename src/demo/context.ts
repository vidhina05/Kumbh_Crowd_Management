/**
 * Per-request context for the in-browser backend. Requests are handled one at a time (see backend.ts),
 * so a module-level "current request" is safe here — this mirrors what Next.js keeps per request on a server.
 */
export type CookieJar = Map<string, string>;

let current: { cookies: CookieJar } = { cookies: new Map() };

export function setRequestContext(ctx: { cookies: CookieJar }) {
  current = ctx;
}

export function requestCookies(): CookieJar {
  return current.cookies;
}
