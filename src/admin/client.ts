"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { BASE_PATH, withBase } from "@/shared/base";

export class AdminApiError extends Error {
  constructor(public status: number, public code: string, message: string) {
    super(message);
  }
}

/** Same-origin API call with the session cookie. A 401 sends the user back to sign-in. */
export async function api<T>(url: string, opts: { method?: string; body?: unknown } = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, {
      method: opts.method ?? (opts.body !== undefined ? "POST" : "GET"),
      headers: opts.body !== undefined ? { "Content-Type": "application/json" } : undefined,
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
      credentials: "same-origin",
      cache: "no-store",
    });
  } catch {
    throw new AdminApiError(0, "offline", "Can't reach the server. Check your connection.");
  }
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && typeof window !== "undefined" && !url.includes("/auth/login")) {
    location.href = withBase(`/admin/login?next=${encodeURIComponent(location.pathname.slice(BASE_PATH.length))}`);
  }
  if (!res.ok) {
    const e = (data as { error?: { code?: string; message?: string } }).error ?? {};
    throw new AdminApiError(res.status, e.code ?? "error", e.message ?? "Something went wrong.");
  }
  return data as T;
}

/** Fetch now and again every `ms` milliseconds while the tab is visible. Shows when the data was last updated. */
export function usePoll<T>(url: string | null, ms = 10_000) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);
  const urlRef = useRef(url);
  urlRef.current = url;

  const reload = useCallback(async () => {
    const u = urlRef.current;
    if (!u) return;
    try {
      const d = await api<T>(u);
      if (urlRef.current === u) {
        setData(d);
        setError(null);
        setUpdatedAt(new Date());
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong.");
    }
  }, []);

  useEffect(() => {
    if (!url) return;
    void reload();
    const iv = setInterval(() => document.visibilityState === "visible" && void reload(), ms);
    return () => clearInterval(iv);
  }, [url, ms, reload]);

  return { data, error, reload, updatedAt };
}

export function ago(d: string | Date | null | undefined): string {
  if (!d) return "never";
  const s = Math.round((Date.now() - new Date(d).getTime()) / 1000);
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return `${Math.round(s / 86400)} d ago`;
}

export function istTime(d: string | Date): string {
  return new Date(d).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Kolkata", hour12: false });
}

export function istDateTime(d: string | Date): string {
  return new Date(d).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Kolkata", hour12: false });
}
