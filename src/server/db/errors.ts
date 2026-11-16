/**
 * True when a database error is a unique-key violation (Postgres 23505). Works for postgres-js, PGlite and
 * PGlite running in a worker (the browser demo), where the error code can be lost crossing the worker boundary.
 */
export function isUniqueViolation(e: unknown): boolean {
  const seen = new Set<unknown>();
  let cur: unknown = e;
  while (cur && typeof cur === "object" && !seen.has(cur)) {
    seen.add(cur);
    const x = cur as { code?: unknown; message?: unknown; cause?: unknown };
    if (x.code === "23505") return true;
    if (typeof x.message === "string" && /duplicate key value violates unique constraint/i.test(x.message)) return true;
    cur = x.cause;
  }
  return false;
}
