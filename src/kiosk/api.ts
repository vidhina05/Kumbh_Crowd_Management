"use client";

/** Kiosk → server calls. The device credentials live in this kiosk's localStorage, set once by staff. */
export type KioskCreds = { id: string; token: string };

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public extra: Record<string, unknown> = {},
  ) {
    super(message);
  }
  get offline() {
    return this.status === 0;
  }
}

const CREDS_KEY = "kiosk.creds";
const OUTBOX_KEY = "kiosk.outbox";

export function loadCreds(): KioskCreds | null {
  try {
    const v = JSON.parse(localStorage.getItem(CREDS_KEY) ?? "null");
    return v && typeof v.id === "string" && typeof v.token === "string" ? v : null;
  } catch {
    return null;
  }
}
export function saveCreds(c: KioskCreds) {
  localStorage.setItem(CREDS_KEY, JSON.stringify(c));
}
export function clearCreds() {
  localStorage.removeItem(CREDS_KEY);
}

export async function kioskFetch<T>(path: string, opts: { method?: string; body?: unknown; pilgrimToken?: string | null; creds?: KioskCreds | null; timeoutMs?: number } = {}): Promise<T> {
  const creds = opts.creds ?? loadCreds();
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (creds) {
    headers["X-Kiosk-Id"] = creds.id;
    headers["X-Kiosk-Token"] = creds.token;
  }
  if (opts.pilgrimToken) headers["X-Pilgrim-Token"] = opts.pilgrimToken;
  let res: Response;
  try {
    res = await fetch(path, {
      method: opts.method ?? (opts.body ? "POST" : "GET"),
      headers,
      body: opts.body ? JSON.stringify(opts.body) : undefined,
      signal: AbortSignal.timeout(opts.timeoutMs ?? 20_000),
      cache: "no-store",
    });
  } catch {
    throw new ApiError(0, "offline", "No connection");
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const e = (data as { error?: { code?: string; message?: string } }).error ?? {};
    throw new ApiError(res.status, e.code ?? "error", e.message ?? "Request failed", data.error ?? {});
  }
  return data as T;
}

/**
 * Offline outbox for help and missing-person reports: if the network is down, the request is kept
 * on this kiosk and re-sent when the connection returns. The server de-duplicates by clientRequestId.
 */
type OutboxItem = { path: string; body: unknown; at: number };

export function queue(path: string, body: unknown) {
  const items = readOutbox();
  items.push({ path, body, at: Date.now() });
  localStorage.setItem(OUTBOX_KEY, JSON.stringify(items.slice(-50)));
}

function readOutbox(): OutboxItem[] {
  try {
    return JSON.parse(localStorage.getItem(OUTBOX_KEY) ?? "[]");
  } catch {
    return [];
  }
}

export function outboxSize() {
  return readOutbox().length;
}

export async function flushOutbox() {
  const items = readOutbox();
  if (!items.length) return 0;
  const left: OutboxItem[] = [];
  for (const it of items) {
    try {
      await kioskFetch(it.path, { body: it.body });
    } catch (e) {
      if (e instanceof ApiError && (e.offline || e.status >= 500)) left.push(it);
      // 4xx: the request itself is invalid — drop it rather than retry forever.
    }
  }
  localStorage.setItem(OUTBOX_KEY, JSON.stringify(left));
  return items.length - left.length;
}
